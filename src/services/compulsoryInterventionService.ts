import { collection, doc, getDocs, query, runTransaction, serverTimestamp, where } from 'firebase/firestore'
import { db } from '@/firebase'
import { mergeCompulsoryInterventions } from '@/utils/compulsoryInterventions'

/** Add requirements only; never manufacture department or SME signatures. */
export async function ensureCompulsoryPlan(app: any, definitions: any[], knownPlan?: any) {
    if (!app.participantId || !definitions.some(item => item.compulsory === true)) return knownPlan
    let plan = knownPlan
    if (!plan) {
        const constraints = [where('participantId', '==', app.participantId)]
        if (app.programId) constraints.push(where('programId', '==', app.programId))
        const snapshot = await getDocs(query(collection(db, 'diagnosticPlans'), ...constraints))
        plan = snapshot.docs.map(item => ({ ...item.data(), id: item.id } as any))
            .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0))[0]
    }
    if (plan && Array.isArray(plan.interventions) &&
        mergeCompulsoryInterventions(plan.interventions, definitions).length === plan.interventions.length) return plan
    // A stable ID makes simultaneous first-time allocation idempotent.
    const ref = doc(db, 'diagnosticPlans', plan?.id || `compulsory_${encodeURIComponent(app.programId || 'default')}_${encodeURIComponent(app.participantId)}`)
    return runTransaction(db, async transaction => {
        const snapshot = await transaction.get(ref)
        const current = snapshot.exists() ? snapshot.data() : {
            participantId: app.participantId,
            programId: app.programId || null,
        }
        const items = Array.isArray(current.interventions) ? current.interventions : []
        const interventions = mergeCompulsoryInterventions(items, definitions)
        if (!snapshot.exists() || interventions.length !== items.length) {
            transaction.set(ref, {
                ...current, interventions, updatedAt: serverTimestamp(),
                ...(!snapshot.exists() ? { createdAt: serverTimestamp() } : {}),
            }, { merge: true })
        }
        return { ...current, interventions, id: ref.id }
    })
}

export async function allocateCompulsoryPlans(definitions: any[]) {
    const applications = await getDocs(query(collection(db, 'applications'), where('applicationStatus', '==', 'accepted')))
    for (const application of applications.docs) {
        await ensureCompulsoryPlan(application.data(), definitions)
    }
}
