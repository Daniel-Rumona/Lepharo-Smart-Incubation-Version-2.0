import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/firebase'

export type GrowthScoreComponentKey =
    | 'compliance'
    | 'interventions'
    | 'roadmap'
    | 'responsiveness'

export type GrowthScoreComponent = {
    key: GrowthScoreComponentKey
    label: string
    score: number
    maximum: number
    detail: string
}

export type GrowthScore = {
    total: number
    band: 'Starting' | 'Building momentum' | 'On track' | 'Growth ready'
    components: GrowthScoreComponent[]
}

const asDate = (value: any): Date | null => {
    if (!value) return null
    if (value instanceof Date) return value
    if (typeof value?.toDate === 'function') return value.toDate()
    if (typeof value?.seconds === 'number') return new Date(value.seconds * 1000)
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
}

const isComplete = (assignment: any) =>
    String(assignment?.assignmentStatus || assignment?.status || '').toLowerCase() === 'completed' ||
    String(assignment?.participantCompletionStatus || '').toLowerCase() === 'confirmed'

const isConfirmed = (value: any) =>
    value === true || (value && typeof value === 'object' && value.confirmed === true)

const bandFor = (score: number): GrowthScore['band'] => {
    if (score >= 85) return 'Growth ready'
    if (score >= 65) return 'On track'
    if (score >= 35) return 'Building momentum'
    return 'Starting'
}

/**
 * Calculates a transparent 100-point score from activity already verified in
 * the platform. It is intentionally read-only: it does not persist or alter
 * any SME, programme, intervention, or compliance data.
 */
export async function loadGrowthScore(email: string): Promise<GrowthScore | null> {
    const normalizedEmail = String(email || '').trim()
    if (!normalizedEmail) return null

    const [participantSnapshot, applicationsSnapshot] = await Promise.all([
        getDocs(query(collection(db, 'participants'), where('email', '==', normalizedEmail))),
        getDocs(query(collection(db, 'applications'), where('email', '==', normalizedEmail)))
    ])

    const participant = participantSnapshot.docs[0]
    if (!participant) return null

    const acceptedApplication = applicationsSnapshot.docs
        .map(item => ({ id: item.id, ...item.data() } as any))
        .find(item => String(item.applicationStatus || '').toLowerCase() === 'accepted')

    const participantId = participant.id
    const [interventionsSnapshot, plansSnapshot] = await Promise.all([
        getDocs(query(collection(db, 'assignedInterventions'), where('participantId', '==', participantId))),
        getDocs(query(collection(db, 'diagnosticPlans'), where('participantId', '==', participantId)))
    ])

    const interventions = interventionsSnapshot.docs.map(item => item.data() as any)
    const completed = interventions.filter(isComplete)

    const documents = Array.isArray(acceptedApplication?.complianceDocuments)
        ? acceptedApplication.complianceDocuments
        : []
    const verifiedDocuments = documents.filter((document: any) =>
        ['valid', 'approved', 'signed'].includes(String(document?.status || '').toLowerCase())
    )
    const complianceScore = documents.length
        ? Math.round((verifiedDocuments.length / documents.length) * 30)
        : 0

    const interventionScore = interventions.length
        ? Math.round((completed.length / interventions.length) * 30)
        : 0

    const latestPlan = plansSnapshot.docs
        .map(item => item.data() as any)
        .sort((left, right) => (asDate(right.createdAt)?.getTime() || 0) - (asDate(left.createdAt)?.getTime() || 0))[0]
    const planInterventions = Array.isArray(latestPlan?.interventions) ? latestPlan.interventions : []
    const departmentIds: string[] = Array.from(new Set<string>(planInterventions
        .map((item: any) => String(item?.departmentId || item?.addedByDeptId || '').trim())
        .filter((id: string) => Boolean(id))))
    const participantConfirmations = latestPlan?.incubateeDepartmentConfirmationsByDeptId ||
        latestPlan?.incubateeDepartmentConfirmations || {}
    const confirmedDepartments = departmentIds.filter(id => isConfirmed(participantConfirmations[id]))
    const roadmapScore = latestPlan?.finalConfirmation
        ? 20
        : departmentIds.length
            ? Math.round((confirmedDepartments.length / departmentIds.length) * 20)
            : 0

    // SMEs are not expected to submit operational reports. Instead, reward
    // meaningful responses to interventions: accepting/declining an offer and
    // confirming/rejecting a completed intervention when confirmation is due.
    let responseOpportunities = 0
    let responses = 0
    interventions.forEach(intervention => {
        const acceptance = String(intervention?.participantAcceptanceStatus || '').toLowerCase()
        responseOpportunities += 1
        if (['accepted', 'declined'].includes(acceptance)) responses += 1

        const assigneeCompleted = String(intervention?.assigneeCompletionStatus || '').toLowerCase() === 'completed' ||
            String(intervention?.assignmentStatus || intervention?.status || '').toLowerCase() === 'completed'
        if (assigneeCompleted) {
            responseOpportunities += 1
            const completion = String(intervention?.participantCompletionStatus || '').toLowerCase()
            if (['confirmed', 'rejected'].includes(completion)) responses += 1
        }
    })
    const responsivenessScore = responseOpportunities
        ? Math.round((responses / responseOpportunities) * 20)
        : 0

    const components: GrowthScoreComponent[] = [
        { key: 'compliance', label: 'Compliance', score: complianceScore, maximum: 30, detail: documents.length ? `${verifiedDocuments.length} of ${documents.length} documents verified` : 'No compliance documents recorded yet' },
        { key: 'interventions', label: 'Interventions', score: interventionScore, maximum: 30, detail: interventions.length ? `${completed.length} of ${interventions.length} interventions completed` : 'No interventions assigned yet' },
        { key: 'roadmap', label: 'Roadmap', score: roadmapScore, maximum: 20, detail: latestPlan?.finalConfirmation ? 'Growth plan finalised' : departmentIds.length ? `${confirmedDepartments.length} of ${departmentIds.length} roadmap areas confirmed` : 'No confirmed roadmap areas yet' },
        { key: 'responsiveness', label: 'SME responsiveness', score: responsivenessScore, maximum: 20, detail: responseOpportunities ? `${responses} of ${responseOpportunities} requested intervention responses completed` : 'No intervention responses requested yet' }
    ]

    const total = components.reduce((sum, component) => sum + component.score, 0)
    return { total, band: bandFor(total), components }
}
