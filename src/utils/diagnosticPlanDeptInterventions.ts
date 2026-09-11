import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/firebase'

const toDateSafe = (v: any) => {
    if (!v) return null
    if (typeof v?.toDate === 'function') return v.toDate()
    if (v?.seconds) return new Date(v.seconds * 1000)
    const d = new Date(v)
    return isNaN(d.getTime()) ? null : d
}

const getSubmittedDeptIdStrict = (intv: any) => {
    const did = String(intv?.departmentId || '').trim()
    if (did) return did
    const abd = String(intv?.addedByDeptId || '').trim()
    if (abd) return abd
    return ''
}

async function getLatestDiagnosticPlan(participantId: string) {
    const snap = await getDocs(
        query(collection(db, 'diagnosticPlans'), where('participantId', '==', participantId))
    )
    if (snap.empty) return null

    let latest = snap.docs[0]
    let latestMs = toDateSafe(latest.data()?.createdAt)?.getTime?.() || 0

    for (const d of snap.docs) {
        const ms = toDateSafe(d.data()?.createdAt)?.getTime?.() || 0
        if (ms >= latestMs) {
            latest = d
            latestMs = ms
        }
    }

    return { id: latest.id, ref: latest.ref, data: latest.data() as any }
}

export type DeptInterventionsSummary = {
    participantId: string
    planId: string | null
    deptId: string
    scope: 'dept' | 'deptChildren'
    deptIdsUsed: string[]
    count: number
    hasInterventions: boolean
    interventions: any[] // raw interventions for optional UI use
}

/**
 * Returns whether a department has interventions for a participant (and how many).
 * - dept scope: counts only interventions where departmentId/addedByDeptId === deptId
 * - parent scope: counts interventions in childDeptIds (excluding parent dept by default)
 */
export async function getDeptInterventionsForParticipant(args: {
    participantId: string
    deptId: string
    childDeptIds?: string[]
    includeOwnDeptInChildScope?: boolean
    requireConfirmedOnly?: boolean
}): Promise<DeptInterventionsSummary> {
    const participantId = String(args.participantId || '').trim()
    const deptId = String(args.deptId || '').trim()
    if (!participantId) throw new Error('participantId is required')
    if (!deptId) throw new Error('deptId is required')

    const latest = await getLatestDiagnosticPlan(participantId)
    const plan = latest?.data || null

    const all = Array.isArray(plan?.interventions) ? plan.interventions : []

    // optional: only count depts that actually confirmed (uses confirmedByDeptId map)
    const confirmedMap: Record<string, any> = (plan?.confirmedByDeptId || {}) as any
    const isConfirmedDept = (did: string) => {
        const v = confirmedMap?.[did]
        return v === true || (v && typeof v === 'object' && v.confirmed === true)
    }

    const hasChildren = Array.isArray(args.childDeptIds) && args.childDeptIds.length > 0
    const scope: DeptInterventionsSummary['scope'] = hasChildren ? 'deptChildren' : 'dept'

    let deptIdsUsed: string[] = hasChildren ? args.childDeptIds!.map(String) : [deptId]
    if (hasChildren && args.includeOwnDeptInChildScope !== true) {
        deptIdsUsed = deptIdsUsed.filter((x) => String(x).trim() !== deptId)
    }
    deptIdsUsed = deptIdsUsed.map((x) => String(x).trim()).filter(Boolean)

    const interventions = all.filter((intv: any) => {
        const did = getSubmittedDeptIdStrict(intv)
        if (!did) return false
        if (!deptIdsUsed.includes(did)) return false
        if (args.requireConfirmedOnly) return isConfirmedDept(did)
        return true
    })

    return {
        participantId,
        planId: latest?.id || null,
        deptId,
        scope,
        deptIdsUsed,
        count: interventions.length,
        hasInterventions: interventions.length > 0,
        interventions
    }
}

  const isConfirmed = (v: any) => v === true || (v && typeof v === 'object' && v.confirmed === true)

  export function countDeptInterventionsInPlan(
    plan: any,
    deptIds: string[],
    opts?: { requireConfirmedOnly?: boolean }
  ) {
    const ids = (deptIds || []).map((x) => String(x).trim()).filter(Boolean)
    if (!plan || !Array.isArray(plan?.interventions) || !ids.length) {
      return { count: 0, hasInterventions: false }
    }

    const confirmedByDeptId: Record<string, any> = (plan?.confirmedByDeptId || {}) as any

    const count = plan.interventions.filter((intv: any) => {
      const did = getSubmittedDeptIdStrict(intv)
      if (!did) return false
      if (!ids.includes(did)) return false
      if (opts?.requireConfirmedOnly) return isConfirmed(confirmedByDeptId?.[did])
      return true
    }).length

    return { count, hasInterventions: count > 0 }
  }
