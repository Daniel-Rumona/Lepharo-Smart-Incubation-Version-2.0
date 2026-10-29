import { collection, getDocs } from 'firebase/firestore'
import { db } from '@/firebase'
import {
    listAgreementTemplates,
    resolveComplianceRequirements,
    type AgreementTemplate,
    type ComplianceRequirement
} from '@/services/complianceResolver'
import { mergeAgreementSources } from '@/utils/agreementStatus'

/** One onboarded SME's agreements and uploaded documents, as the Compliance page reads them. */
export type ComplianceRecord = {
    appId: string
    participantId: string
    programId: string
    programName: string
    application: any
    participant: any
    manual: boolean
    /** Agreements by canonical id: the agreements subcollection over signedAgreements. */
    agreements: Record<string, any>
    /** Uploaded documents: the embedded list, then the complianceDocuments subcollection (which wins). */
    uploads: any[]
}

export type ComplianceSource = {
    records: ComplianceRecord[]
    /** The programme's master requirement list (not a department's selection). */
    requirementsByProgram: Record<string, ComplianceRequirement[]>
    templates: AgreementTemplate[]
}

export async function loadComplianceSource(
    apps: any[],
    participantById: Map<string, any>
): Promise<ComplianceSource> {
    const programIds = Array.from(new Set(apps.map(app => String(app.programId || '').trim()).filter(Boolean)))

    const [templates, requirementEntries, records] = await Promise.all([
        listAgreementTemplates().catch(() => [] as AgreementTemplate[]),
        Promise.all(
            programIds.map(async programId => {
                try {
                    const resolved = await resolveComplianceRequirements(programId)
                    return [programId, resolved.requirements] as const
                } catch (error) {
                    console.warn('Programme requirements could not be loaded.', programId, error)
                    return [programId, [] as ComplianceRequirement[]] as const
                }
            })
        ),
        Promise.all(
            apps
                .filter(app => app.participantId)
                .map(async (app): Promise<ComplianceRecord> => {
                    const participant = participantById.get(app.participantId) || {}
                    const [agreementSnap, uploadSnap] = await Promise.all([
                        getDocs(collection(db, 'applications', app.id, 'agreements')).catch(() => null),
                        getDocs(collection(db, 'applications', app.id, 'complianceDocuments')).catch(() => null)
                    ])
                    const subAgreements = Object.fromEntries((agreementSnap?.docs || []).map(d => [d.id, d.data()]))
                    const embedded = Array.isArray(participant.complianceDocuments) && participant.complianceDocuments.length
                        ? participant.complianceDocuments
                        : Array.isArray(app.complianceDocuments)
                            ? app.complianceDocuments
                            : []
                    return {
                        appId: app.id,
                        participantId: String(app.participantId),
                        programId: String(app.programId || ''),
                        programName: app.programName || '',
                        application: app,
                        participant,
                        manual: app.manuallyCreated === true || app.manualApplication === true,
                        agreements: mergeAgreementSources(
                            subAgreements,
                            app.signedAgreements || participant.signedAgreements || {}
                        ),
                        uploads: [...embedded, ...(uploadSnap?.docs || []).map(d => d.data())]
                    }
                })
        )
    ])

    return { records, requirementsByProgram: Object.fromEntries(requirementEntries), templates }
}
