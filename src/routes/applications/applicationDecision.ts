import { collection, doc, getDoc, getDocs, query, serverTimestamp, updateDoc, where } from 'firebase/firestore'
import { auth, db } from '@/firebase'
import { ensureCompulsoryPlan } from '@/services/compulsoryInterventionService'
import type { ApplicationStatus } from './applicationData'

/**
 * Writes an application decision and its side effects. Kept out of the
 * components so the confirmation copy in DecisionBar can describe exactly
 * what happens here:
 *
 *   accept  → status + decision record, the applicant's user is flagged for
 *             first-login onboarding, compulsory interventions are added
 *   reject  → status + decision record with the reason
 *   reopen  → back to pending; acceptance side effects are NOT undone
 */

const decidedBy = () => ({
    uid: auth.currentUser?.uid || null,
    email: auth.currentUser?.email || null
})

const flagFirstLogin = async (applicationId: string, participantId?: string, email?: string | null) => {
    const patch = { firstLoginComplete: false, acceptance: { applicationId, acceptedAt: serverTimestamp() } }
    try {
        if (participantId) {
            const ref = doc(db, 'users', participantId)
            if ((await getDoc(ref)).exists()) {
                await updateDoc(ref, patch)
                return
            }
        }
        if (email) {
            const users = await getDocs(query(collection(db, 'users'), where('email', '==', email)))
            await Promise.all(users.docs.map(d => updateDoc(d.ref, patch)))
        }
    } catch (e) {
        // The decision itself is already saved; onboarding can be re-triggered.
        console.error('[applications] could not flag first login:', e)
    }
}

/** Adds the compulsory interventions the application doesn't already require. Returns how many were added. */
const addCompulsoryInterventions = async (applicationId: string) => {
    const ref = doc(db, 'applications', applicationId)
    const snap = await getDoc(ref)
    if (!snap.exists()) return 0
    const app = snap.data() as any

    const current: any[] = app?.interventions?.required ?? app?.requiredInterventions ?? []
    const have = new Set(current.map(x => x?.id || x?.interventionId))

    const compulsorySnap = await getDocs(query(collection(db, 'interventions'), where('compulsory', '==', true)))
    const compulsory = compulsorySnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
    await ensureCompulsoryPlan(app, compulsory)

    const toAdd = compulsory
        .filter(iv => !have.has(iv.id))
        .map(iv => ({
            id: iv.id,
            title: iv.interventionTitle || iv.title || 'Intervention',
            departmentId: iv.departmentId || null
        }))
    if (!toAdd.length) return 0

    const field = app?.interventions?.required ? 'interventions.required' : 'requiredInterventions'
    await updateDoc(ref, { [field]: [...current, ...toAdd], updatedAt: serverTimestamp() })
    return toAdd.length
}

export type DecisionResult = { addedInterventions: number }

export const decideApplication = async (
    applicationId: string,
    status: Exclude<ApplicationStatus, 'pending'>,
    reason?: string
): Promise<DecisionResult> => {
    const ref = doc(db, 'applications', applicationId)
    const snap = await getDoc(ref)
    if (!snap.exists()) throw new Error('Application not found')
    const app = snap.data() as any

    const applicantEmail = app.applicantEmail || app.email || null
    const update: Record<string, any> = {
        applicationStatus: status,
        applicantEmail,
        applicantName: app.applicantName || app.beneficiaryName || app.businessName || null,
        programName: app.programName || app.program?.name || null,
        decision: {
            status,
            decidedAt: serverTimestamp(),
            decidedBy: decidedBy(),
            ...(status === 'rejected' && reason ? { reason } : {})
        },
        updatedAt: serverTimestamp()
    }
    if (status === 'accepted') {
        if (!app.acceptedAt) update.acceptedAt = serverTimestamp()
        update.rejectedAt = null
    } else {
        update.rejectedAt = serverTimestamp()
        if (reason) update.rejectionReason = reason
    }

    await updateDoc(ref, update)

    if (status !== 'accepted') return { addedInterventions: 0 }
    await flagFirstLogin(applicationId, app.participantId, applicantEmail)
    return { addedInterventions: await addCompulsoryInterventions(applicationId) }
}

export const reopenApplication = async (applicationId: string, previous: ApplicationStatus) => {
    await updateDoc(doc(db, 'applications', applicationId), {
        applicationStatus: 'pending',
        decision: {
            status: 'pending',
            decidedAt: serverTimestamp(),
            decidedBy: decidedBy(),
            reopenedFrom: previous
        },
        updatedAt: serverTimestamp()
    })
}
