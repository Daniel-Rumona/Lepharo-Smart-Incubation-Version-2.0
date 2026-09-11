// src/utils/buildMonthlyInterventionTrackerRows.ts
import type { InterventionRow } from "@/utils/monthlyReportDocx"
import { doc, getDoc } from "firebase/firestore"
import { db } from "@/firebase"

export type AssignedLite = {
  participantId?: string
  beneficiaryName?: string
  participantEmail?: string
  areaOfSupport?: string
  interventionTitle?: string
  status?: string
  createdAt?: any
  updatedAt?: any
  completedAt?: any
  movAttached?: boolean
}

export type ApplicationLite = {
  participantId: string
  stage?: string
  beneficiaryName?: string
}

export type ParticipantLite = {
  id: string // doc id == participantId
  beneficiaryName?: string
  email?: string
  phone?: string
  sector?: string
}

const norm = (s: any) => String(s ?? "").trim()
const low = (s: any) => norm(s).toLowerCase()
const tsToDate = (v: any): Date | undefined => v?.toDate?.() ?? (v instanceof Date ? v : undefined)

const pickDate = (d: AssignedLite) => {
  const ts = tsToDate(d.completedAt) || tsToDate(d.updatedAt) || tsToDate(d.createdAt)
  return ts ? ts.toISOString().slice(0, 10) : ""
}

function contactFromParticipant(p?: ParticipantLite, fallbackEmail?: string) {
  const email = norm(p?.email || fallbackEmail)
  const phone = norm(p?.phone)
  if (phone && email) return `${phone} • ${email}`
  if (phone) return phone
  if (email) return email
  return "—"
}

async function fetchParticipantsByIds(participantIds: string[]) {
  const out = new Map<string, ParticipantLite>()
  await Promise.all(
    participantIds.map(async pid => {
      try {
        const snap = await getDoc(doc(db, "participants", pid))
        if (!snap.exists()) return
        const x = snap.data() as any
        out.set(pid, {
          id: pid,
          beneficiaryName: x.beneficiaryName,
          email: x.email,
          phone: x.phone,
          sector: x.sector
        })
      } catch {
        // ignore
      }
    })
  )
  return out
}

export async function buildMonthlyInterventionTrackerRows(params: {
  assigned: AssignedLite[]
  deptKeyFromArea: (area?: string) => string

  // you already fetch applications in the report builder
  applicationsByParticipantId: Map<string, ApplicationLite>

  // optional override if you already have them
  participantsByParticipantId?: Map<string, ParticipantLite>
}): Promise<InterventionRow[]> {
  const { assigned, deptKeyFromArea, applicationsByParticipantId } = params

  // Build participant lookup (prefer supplied map, else fetch by doc id)
  const participantIds = Array.from(
    new Set(assigned.map(a => norm(a.participantId)).filter(Boolean))
  )

  const participantsByParticipantId =
    params.participantsByParticipantId || (await fetchParticipantsByIds(participantIds))

  // Group by participantId first; if missing, group by beneficiary name
  const groups = new Map<string, AssignedLite[]>()
  for (const ai of assigned) {
    const pid = norm(ai.participantId)
    const nameKey = low(ai.beneficiaryName)
    const key = pid ? `pid:${pid}` : nameKey ? `name:${nameKey}` : `unknown:${Math.random()}`
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key)!.push(ai)
  }

  // stable ordering: SME name then participantId
  const entries = Array.from(groups.entries()).sort((a, b) => {
    const aPid = norm(a[1][0]?.participantId)
    const bPid = norm(b[1][0]?.participantId)
    const aP = aPid ? participantsByParticipantId.get(aPid) : undefined
    const bP = bPid ? participantsByParticipantId.get(bPid) : undefined

    const aName =
      norm(aP?.beneficiaryName) ||
      norm(applicationsByParticipantId.get(aPid || "")?.beneficiaryName) ||
      norm(a[1][0]?.beneficiaryName)

    const bName =
      norm(bP?.beneficiaryName) ||
      norm(applicationsByParticipantId.get(bPid || "")?.beneficiaryName) ||
      norm(b[1][0]?.beneficiaryName)

    return aName.toLowerCase().localeCompare(bName.toLowerCase())
  })

  const rows: InterventionRow[] = []

  for (const [, items] of entries) {
    items.sort((x, y) => pickDate(x).localeCompare(pickDate(y)))

    const first = items[0]
    const pid = norm(first.participantId)

    const app = pid ? applicationsByParticipantId.get(pid) : undefined
    const p = pid ? participantsByParticipantId.get(pid) : undefined

    const smmeName =
      norm(p?.beneficiaryName) || norm(app?.beneficiaryName) || norm(first.beneficiaryName) || "Unknown SMME"

    const stage = norm(app?.stage) || "—"
    const sector = norm(p?.sector) || "—"
    const contact = contactFromParticipant(p, first.participantEmail)

    items.forEach((ai, idx) => {
      const dept = deptKeyFromArea(ai.areaOfSupport)
      const title = norm(ai.interventionTitle) || "Unknown Intervention"

      rows.push({
        smmeName: idx === 0 ? smmeName : "",
        contact: idx === 0 ? contact : "",
        stage: idx === 0 ? stage : "",
        sector: idx === 0 ? sector : "",
        intervention: `${dept} — ${title}`,
        movAttached: !!ai.movAttached,
        date: pickDate(ai) || undefined
      })
    })
  }

  return rows
}
