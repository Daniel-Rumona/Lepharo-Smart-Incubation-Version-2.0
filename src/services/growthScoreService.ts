import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/firebase'
import {
    computeGrowthScore,
    normalizeProgramRequirements,
    normalizeText,
    pickPlanForProgramme,
    resolveComplianceRows,
    scopeToProgramme,
    summarizeCompliance,
    type GrowthScore
} from '@twin/rules'

// The score itself lives in the shared twin rules so the SME's card, the
// digital twin and the nightly saved records always agree.
export type { GrowthScore, GrowthScoreComponent, GrowthScoreComponentKey } from '@twin/rules'

const docsOf = (snapshot: { docs: Array<{ id: string; data: () => any }> }) =>
    snapshot.docs.map(item => ({ id: item.id, ...item.data() } as Record<string, any>))

/**
 * Calculates a transparent 100-point score from activity already verified in
 * the platform. It is read-only: it never persists or alters SME data.
 *
 * The email only identifies the signed-in SME. Everything after that is read
 * by participant id and scoped to the SME's accepted programme, and compliance
 * comes from the complianceDocuments sub-collection measured against the
 * programme's requirements.
 */
export async function loadGrowthScore(email: string): Promise<GrowthScore | null> {
    const normalizedEmail = String(email || '').trim()
    if (!normalizedEmail) return null

    const participantSnapshot = await getDocs(
        query(collection(db, 'participants'), where('email', '==', normalizedEmail))
    )
    const participant = participantSnapshot.docs[0]
    if (!participant) return null
    const participantId = participant.id

    const [applicationsById, applicationsByEmail, assignmentsSnapshot, plansSnapshot] = await Promise.all([
        getDocs(query(collection(db, 'applications'), where('participantId', '==', participantId))),
        getDocs(query(collection(db, 'applications'), where('email', '==', normalizedEmail))),
        getDocs(query(collection(db, 'assignedInterventions'), where('participantId', '==', participantId))),
        getDocs(query(collection(db, 'diagnosticPlans'), where('participantId', '==', participantId)))
    ])

    const applications = [...docsOf(applicationsById), ...docsOf(applicationsByEmail)]
    const application = applications.find(item => normalizeText(item.applicationStatus).toLowerCase() === 'accepted')
    const programId = normalizeText(application?.programId) || null

    const [uploadsSnapshot, programSnapshot] = await Promise.all([
        application
            ? getDocs(collection(db, 'applications', application.id, 'complianceDocuments'))
            : Promise.resolve(null),
        programId ? getDoc(doc(db, 'programs', programId)) : Promise.resolve(null)
    ])

    const compliance = summarizeCompliance(resolveComplianceRows({
        requirements: normalizeProgramRequirements(programSnapshot?.exists() ? programSnapshot.data()?.programRequirements || [] : []),
        embedded: Array.isArray(application?.complianceDocuments) ? application!.complianceDocuments : [],
        uploads: uploadsSnapshot ? docsOf(uploadsSnapshot) : []
    }))

    return computeGrowthScore({
        assignments: scopeToProgramme(docsOf(assignmentsSnapshot), programId),
        compliance,
        diagnosticPlan: pickPlanForProgramme(docsOf(plansSnapshot), programId)
    })
}
