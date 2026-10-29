import { message } from 'antd'
import {
    collection,
    doc,
    getDoc,
    getDocs,
    orderBy,
    query,
    serverTimestamp,
    updateDoc,
    where
} from 'firebase/firestore'
import { db } from '@/firebase'
import { isCompulsoryIntervention } from '@/utils/compulsoryInterventions'
import {
    approveDiagnosticPlanMovBySmme,
    createOrUpdateDiagnosticPlanMovDraft
} from '@/services/movService'

/**
 * SME (incubatee) sign-off of a diagnostic / developmental plan, one
 * department at a time. The Developmental Plan page and the post-login
 * pending-plan prompt both confirm through here so the Firestore writes stay
 * identical.
 */

export type DevPlanDept = {
    id: string
    name: string
}

export type SmeDeptConfirm = {
    confirmed: boolean
    confirmedAt?: any
    confirmedByEmail?: string
}

type IdentityLike = {
    email?: string | null
    participantId?: string | null
    participantDocId?: string | null
    profileId?: string | null
    id?: string | null
    uid?: string | null
}

/** Whether a plan intervention belongs to a department, by departmentId. */
export const belongsToDept = (iv: any, dept: DevPlanDept) => {
    const ivDeptId = String(iv?.departmentId || '')
    return !!ivDeptId && !!dept.id && ivDeptId === dept.id
}

const getCreatedAtValue = (d: any) => {
    const c = d?.createdAt
    if (!c) return 0
    if (typeof c?.toMillis === 'function') return c.toMillis()
    if (typeof c?.seconds === 'number') return c.seconds * 1000
    if (typeof c === 'number') return c
    if (typeof c === 'string') {
        const t = Date.parse(c)
        return Number.isNaN(t) ? 0 : t
    }
    return 0
}

// Resolve the same canonical participant record used by the interventions page.
// Auth uid, participant document id, and email can legitimately differ.
export const resolveIncubateeParticipantId = async (user: IdentityLike): Promise<string | null> => {
    if (!user?.email) return null

    const candidateIds = Array.from(new Set([
        user.participantId,
        user.participantDocId,
        user.profileId,
        user.id,
        user.uid
    ].map(value => String(value || '').trim()).filter(Boolean)))

    for (const id of candidateIds) {
        const snapshot = await getDoc(doc(db, 'participants', id))
        if (snapshot.exists()) return snapshot.id
    }

    const exact = await getDocs(query(collection(db, 'participants'), where('email', '==', user.email)))
    if (exact.docs[0]) return exact.docs[0].id

    // Only staff may scan participants; for an SME this finds nothing.
    const normalizedEmail = String(user.email).trim().toLowerCase()
    const participants = await getDocs(collection(db, 'participants')).catch(() => null)
    return participants?.docs.find(item =>
        String(item.data()?.email || '').trim().toLowerCase() === normalizedEmail
    )?.id || null
}

// Sort client-side so plan loading never depends on a composite index.
export const loadLatestDiagnosticPlan = async (participantId: string) => {
    const plansSnap = await getDocs(
        query(collection(db, 'diagnosticPlans'), where('participantId', '==', participantId))
    )
    const latestDoc = [...plansSnap.docs].sort((a, b) =>
        getCreatedAtValue(b.data()) - getCreatedAtValue(a.data())
    )[0]
    return latestDoc ? { id: latestDoc.id, data: (latestDoc.data() as any) || {} } : null
}

/** Departments an SME signs off on: those flagged interventionsDepartment === true. */
export const loadDevPlanDepartments = async (): Promise<DevPlanDept[]> => {
    const snap = await getDocs(query(collection(db, 'departments'), orderBy('name', 'asc')))
    return snap.docs
        .map(d => {
            const data = d.data() as any
            return {
                id: d.id,
                name: data.name || data.departmentName || d.id,
                interventionsDepartment: data.interventionsDepartment
            }
        })
        .filter(d => d.interventionsDepartment === true)
        .map(({ id, name }) => ({ id, name }))
}

/** Catalog interventions for one department (used to recognise compulsory items). */
export const loadDeptInterventionCatalog = async (dept: DevPlanDept) => {
    const snap = await getDocs(
        query(collection(db, 'interventions'), where('departmentId', '==', dept.id))
    )
    return snap.docs.map(x => {
        const data = x.data() as any
        return {
            id: x.id,
            compulsory: data.compulsory === true,
            title: data.title || data.name || data.interventionTitle || 'Untitled',
            departmentId: data.departmentId || dept.id
        }
    })
}

/**
 * Departments waiting on the SME: the department has confirmed, the SME has
 * not, the plan is not finalized, and the department's items are not all
 * compulsory (those need no sign-off). Mirrors what the Developmental Plan
 * page lets the SME confirm.
 */
export const pendingSmeDepartments = (
    plan: any,
    departments: DevPlanDept[],
    catalogByDeptId: Record<string, any[]>
): DevPlanDept[] => {
    if (!plan || plan.finalConfirmation) return []
    const deptConfirmedById: Record<string, boolean> = plan.confirmedByDeptId || {}
    const smeConfirmedById: Record<string, SmeDeptConfirm> =
        plan.incubateeDepartmentConfirmationsByDeptId || {}

    return departments.filter(dept => {
        if (!deptConfirmedById[dept.id] || smeConfirmedById[dept.id]?.confirmed) return false
        return !isCompulsoryOnlyDept(plan, dept, catalogByDeptId[dept.id] || [])
    })
}

/** True when every intervention a department has on the plan is compulsory (no sign-off needed). */
export const isCompulsoryOnlyDept = (plan: any, dept: DevPlanDept, catalog: any[]) => {
    const ivs = ((plan?.interventions || []) as any[]).filter(iv => belongsToDept(iv, dept))
    return ivs.length > 0 && ivs.every(iv => isCompulsoryIntervention(iv, catalog))
}

/**
 * Finalizes the plan once the SME has confirmed every department that needs
 * sign-off. Compulsory-only departments have nothing to confirm, so they never
 * hold finalization back. Pass the catalogs the caller already has; any other
 * department's catalog is read only if its sign-off is still outstanding.
 */
export const finalizeIfAllSmeConfirmed = async ({
    planId,
    departments,
    catalogByDeptId = {},
    onFinalizing
}: {
    planId: string
    departments: DevPlanDept[]
    catalogByDeptId?: Record<string, any[]>
    onFinalizing?: (finalizing: boolean) => void
}) => {
    if (!planId || !departments.length) return

    const planRef = doc(db, 'diagnosticPlans', planId)
    const snap = await getDoc(planRef)
    const data = snap.exists() ? (snap.data() as any) : {}
    if (data?.finalConfirmation) return

    const conf: Record<string, SmeDeptConfirm> = data?.incubateeDepartmentConfirmationsByDeptId || {}

    let anyConfirmed = false
    for (const dept of departments) {
        if (conf?.[dept.id]?.confirmed) {
            anyConfirmed = true
            continue
        }
        const catalog = catalogByDeptId[dept.id] ?? await loadDeptInterventionCatalog(dept)
        // An unconfirmed department that needs sign-off keeps the plan open.
        if (!isCompulsoryOnlyDept(data, dept, catalog)) return
    }

    // Finalization records the SME's agreement, so at least one department
    // must actually have been confirmed by them.
    if (anyConfirmed) {
        onFinalizing?.(true)
        try {
            await updateDoc(planRef, {
                incubateeConfirmation: true,
                incubateeConfirmationAt: serverTimestamp(),
                finalConfirmation: true,
                finalConfirmationAt: serverTimestamp(),
                finalConfirmationMode: 'incubatee_confirmed_all_departments_by_id'
            })
        } finally {
            onFinalizing?.(false)
        }
    }
}

/**
 * Records the SME's confirmation of one department, signs that department's
 * plan MOV, then finalizes the plan once every department that needs sign-off
 * is confirmed.
 * Shows the same progress / result messages wherever it is called from.
 * Resolves true when the confirmation itself was written.
 */
export const confirmDepartmentBySme = async ({
    planId,
    plan,
    participantId,
    userEmail,
    dept,
    departments,
    catalogByDeptId,
    onFinalizing
}: {
    planId: string
    plan: any
    participantId: string | null
    userEmail: string
    dept: DevPlanDept
    departments: DevPlanDept[]
    /** Department intervention catalogs the caller already has (see finalizeIfAllSmeConfirmed). */
    catalogByDeptId?: Record<string, any[]>
    onFinalizing?: (finalizing: boolean) => void
}): Promise<boolean> => {
    const deptId = dept.id
    const msgKey = `confirm-${deptId}`

    // SME can only confirm AFTER department has confirmed (id-based)
    const deptOk = !!plan?.confirmedByDeptId?.[deptId]
    if (!deptOk) {
        message.warning('This department has not confirmed yet.')
        return false
    }

    try {
        message.loading({ key: msgKey, content: 'Confirming department offer…', duration: 0 })

        const planRef = doc(db, 'diagnosticPlans', planId)

        await updateDoc(planRef, {
            [`incubateeDepartmentConfirmationsByDeptId.${deptId}`]: {
                confirmed: true,
                confirmedAt: serverTimestamp(),
                confirmedByEmail: userEmail
            }
        })

        message.success({ key: msgKey, content: `Confirmed: ${dept.name}` })
    } catch (e) {
        console.error(e)
        message.error({ key: msgKey, content: 'Could not confirm this department.' })
        return false
    }

    // Confirmation is the primary action. A department may not yet
    // have a diagnostic-plan MOV, so that follow-up must never turn a
    // successful confirmation into a false failure message.
    if (participantId) {
        try {
            // Older confirmed departments may predate the per-
            // department MOV. Recreate it first, then apply the SME
            // signature as one continuous confirmation action.
            await createOrUpdateDiagnosticPlanMovDraft({
                db,
                user: { email: userEmail },
                diagnosticPlanId: planId,
                participantId,
                programId: String(plan?.programId || ''),
                departmentId: deptId,
                departmentName: dept.name,
                status: 'awaiting_smme'
            })
            await approveDiagnosticPlanMovBySmme({
                db,
                diagnosticPlanId: planId,
                departmentId: deptId,
                smmeId: participantId,
                signerSignatureUrl: ''
            })
        } catch (movError) {
            console.error('Department confirmed, but its MOV could not be signed:', movError)
            message.warning({
                key: msgKey,
                content: `Confirmed: ${dept.name}. The MOV signature still needs attention.`
            })
        }
    }

    try {
        await finalizeIfAllSmeConfirmed({ planId, departments, catalogByDeptId, onFinalizing })
    } catch (finalizeError) {
        console.warn('Department confirmed, but finalization could not run:', finalizeError)
    }

    return true
}
