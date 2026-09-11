import dayjs from 'dayjs'
import {
  doc, getDoc, getDocs, collection, query, where, runTransaction, serverTimestamp
} from 'firebase/firestore'
import { db } from '@/firebase'

type KpiMeta = {
  unit: 'count' | 'ZAR' | 'percent' | 'text'
  department?: string
}

/** Period key used to fetch targets. If you pass ctx.quarter like '2025-Q1', we use it; else YYYY-MM. */
function resolvePeriodKey(ctx?: { quarter?: string }) {
  if (ctx?.quarter && /^20\d{2}-Q[1-4]$/.test(ctx.quarter)) return ctx.quarter
  return dayjs().format('YYYY-MM')
}

/** Read KPI unit/department from kpiDefinitions/{kpiId}. */
async function fetchKpiMeta(kpiIds: string[]): Promise<Record<string, KpiMeta>> {
  const out: Record<string, KpiMeta> = {}
  for (const id of kpiIds) {
    try {
      const snap = await getDoc(doc(db, 'kpiDefinitions', id))
      if (snap.exists()) {
        const d = snap.data() as any
        out[id] = {
          unit: (d.unit || 'count') as KpiMeta['unit'],
          department: d.department || undefined
        }
      } else {
        out[id] = { unit: 'count' }
      }
    } catch {
      out[id] = { unit: 'count' }
    }
  }
  return out
}

/** Read the target for a (kpiId, periodKey). Falls back to kpiDefinitions.target if no period target. */
async function fetchTargetsForPeriod(
  kpiIds: string[],
  periodKey: string
): Promise<Record<string, number>> {
  const out: Record<string, number> = {}

  // 1) try kpiTargets (period-based)
  for (const kpiId of kpiIds) {
    try {
      const qs = await getDocs(query(
        collection(db, 'kpiTargets'),
        where('kpiId', '==', kpiId),
        where('periodKey', '==', periodKey)
      ))
      if (!qs.empty) {
        const t = Number(qs.docs[0].data()?.target || 0)
        if (t > 0) {
          out[kpiId] = t
          continue
        }
      }
    } catch {}
    // 2) fallback to default target in kpiDefinitions
    try {
      const defSnap = await getDoc(doc(db, 'kpiDefinitions', kpiId))
      if (defSnap.exists()) {
        const t = Number((defSnap.data() as any)?.target || 0)
        if (t > 0) out[kpiId] = t
      }
    } catch {}
    // if both missing, leave undefined → we’ll handle as 0 later
  }
  return out
}

// keep your cleanUndefined helper
const cleanUndefined = (obj: any) => {
  if (obj == null || typeof obj !== 'object') return obj
  const out: any = Array.isArray(obj) ? [] : {}
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined) continue
    out[k] = cleanUndefined(v)
  }
  return out
}

type Context = {
  participantId: string
  programId?: string

  areaOfSupport?: string
  quarter?: string
  payload?: any
}

export async function applyKpiDeltas(
  ctx: Context,
  deltas: Record<string, { mode: 'increment' | 'set' | 'max'; value: number }>
) {
  if (!ctx.participantId) return

  const programId = ctx.programId || 'unknown'
  const pRef = doc(db, 'kpiProgress', programId, 'participants', ctx.participantId)
  const sRef = doc(db, 'kpiProgress', programId, 'summary', 'overview')

  // ---------- EXTRA READS (outside txn) ----------
  const kpiIds = Object.keys(deltas)
  const periodKey = resolvePeriodKey(ctx)
  const [metaById, targetsById] = await Promise.all([
    fetchKpiMeta(kpiIds),
    fetchTargetsForPeriod(kpiIds, periodKey)
  ])

  await runTransaction(db, async (tx) => {
    // ---- ALL READS FIRST
    const [pSnap, sSnap] = await Promise.all([tx.get(pRef), tx.get(sRef)])

    // Participant doc (holds per-participant raw + percent)
    const pData = pSnap.exists() ? pSnap.data() as any : {
      participantId: ctx.participantId,
      programId,
      values: {},
      rawValues: {},
      history: [],
      lastPeriodKey: periodKey
    }
    const pValues: Record<string, number> = { ...(pData.values || {}) }
    const pRaw: Record<string, number> = { ...(pData.rawValues || {}) }
    const pHistory: any[] = Array.isArray(pData.history) ? [...pData.history] : []

    // Program summary doc (aggregates of all participants in this program)
    const sData = sSnap.exists() ? (sSnap.data() as any) : { values: {}, rawValues: {} }
    const sValues: Record<string, number> = { ...(sData.values || {}) }
    const sRaw: Record<string, number> = { ...(sData.rawValues || {}) }

    // ---- APPLY DELTAS
    for (const [kpiId, { mode, value }] of Object.entries(deltas)) {
      const unit = metaById[kpiId]?.unit || 'count'

      if (unit === 'percent') {
        // Work in raw first, then compute percent = raw / target * 100
        const prevRawP = Number(pRaw[kpiId] || 0)
        const prevRawS = Number(sRaw[kpiId] || 0)

        const nextRawP =
          mode === 'increment' ? prevRawP + value :
          mode === 'set'       ? value :
          Math.max(prevRawP, value)

        const nextRawS =
          mode === 'increment' ? prevRawS + value :
          mode === 'set'       ? value :
          Math.max(prevRawS, value)

        pRaw[kpiId] = nextRawP
        sRaw[kpiId] = nextRawS

        const target = Number(targetsById[kpiId] || 0)
        const nextPctP = target > 0 ? Math.max(0, Math.min(100, (nextRawP / target) * 100)) : 0
        const nextPctS = target > 0 ? Math.max(0, Math.min(100, (nextRawS / target) * 100)) : 0

        pValues[kpiId] = nextPctP
        sValues[kpiId] = nextPctS

        pHistory.push(cleanUndefined({
          at: new Date(),
          kpiId,
          unit,
          deltaRaw: mode === 'increment' ? value : (nextRawP - prevRawP),
          percentAfter: nextPctP,
          department: ctx.areaOfSupport || null,
          programId,
          periodKey
        }))
      } else {
        // count / ZAR (or anything numeric that isn't percent): accumulate directly
        const prevP = Number(pValues[kpiId] || 0)
        const prevS = Number(sValues[kpiId] || 0)
        const nextP =
          mode === 'increment' ? prevP + value :
          mode === 'set'       ? value :
          Math.max(prevP, value)
        const nextS =
          mode === 'increment' ? prevS + value :
          mode === 'set'       ? value :
          Math.max(prevS, value)
        pValues[kpiId] = nextP
        sValues[kpiId] = nextS

        pHistory.push(cleanUndefined({
          at: new Date(),
          kpiId,
          unit,
          delta: mode === 'increment' ? value : (nextP - prevP),
          department: ctx.areaOfSupport || null,
          programId,
          periodKey
        }))
      }
    }

    // ---- WRITES
    tx.set(
      pRef,
      cleanUndefined({
        ...pData,
        values: pValues,
        rawValues: Object.keys(pRaw).length ? pRaw : undefined,
        history: pHistory,
        lastPeriodKey: periodKey,
        updatedAt: serverTimestamp()
      }),
      { merge: true }
    )

    tx.set(
      sRef,
      cleanUndefined({
        values: sValues,
        rawValues: Object.keys(sRaw).length ? sRaw : undefined,
        updatedAt: serverTimestamp(),
        lastPeriodKey: periodKey
      }),
      { merge: true }
    )
  })
}
