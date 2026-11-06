/**
 * The project admin report's Compliance tab, in two parts:
 *
 * - Onboarding compliance: GAP Analysis, pre-incubation contract and MOA. Each is
 *   complete once the SME has signed and ROM has confirmed or countersigned.
 * - Programme compliance: the documents each SME's programme requires, by status.
 *
 * Statuses follow the staff Compliance page: the stored document status, matched to
 * the programme's master requirement list by its preset id.
 */
import {
    canonicalAgreementId,
    normalizeComplianceId,
    type AgreementTemplate,
    type ComplianceRequirement
} from '@/services/complianceResolver'
import { hasSmeGapSubmission, isIncubateeAgreementSigned } from '@/utils/agreementStatus'
import type { ComplianceRecord } from './complianceData'

export const ONBOARDING_DOCUMENTS = [
    { id: 'gap-analysis', label: 'GAP Analysis' },
    { id: 'pre-incubation-contract', label: 'Pre-incubation contract' },
    { id: 'moa', label: 'Memorandum of Agreement (MOA)' }
] as const

export type OnboardingState = 'complete' | 'awaiting-rom' | 'not-signed' | 'not-due'

export type OnboardingRow = {
    id: string
    label: string
    /** SMEs this document applies to. */
    required: number
    complete: number
    awaitingRom: number
    notSigned: number
    /** MOA only: SMEs whose MOA isn't available to sign yet. */
    notDue: number
}

export type DocumentRow = {
    key: string
    title: string
    required: number
    valid: number
    expiring: number
    pending: number
    attention: number
    missing: number
}

export type ProgrammeCompliance = {
    id: string
    name: string
    smes: number
    fullyCompliant: number
    documents: DocumentRow[]
}

export type ComplianceTrend = {
    categories: string[]
    onboarded: number[]
    gap: number[]
    pre: number[]
    moa: number[]
}

export type ComplianceModel = {
    onboarded: number
    /** SMEs with every onboarding document that applies to them complete. */
    fullyOnboarded: number
    onboarding: OnboardingRow[]
    programmes: ProgrammeCompliance[]
    trend: ComplianceTrend
}

const toDate = (value: any): Date | null => {
    if (!value) return null
    if (typeof value?.toDate === 'function') return value.toDate()
    if (typeof value?.seconds === 'number') return new Date(value.seconds * 1000)
    const date = value instanceof Date ? value : new Date(value)
    return Number.isNaN(date.getTime()) ? null : date
}

const romSigned = (agreement: any) =>
    Boolean(agreement?.romSignatureURL || agreement?.romSignatureUrl || agreement?.romSignedAt || agreement?.fullyConfirmedAt)

const uploadKey = (upload: any) =>
    normalizeComplianceId(upload?.slug || upload?.presetId || upload?.preset || upload?.type || upload?.documentName)

const uploadStatus = (upload: any) => String(upload?.status || 'pending').trim().toLowerCase()

type DocumentBucket = 'valid' | 'expiring' | 'pending' | 'attention' | 'missing'

const bucketOf = (status: string): DocumentBucket => {
    if (status === 'valid' || status === 'signed') return 'valid'
    if (status === 'expiring-soon') return 'expiring'
    if (status === 'pending') return 'pending'
    if (status === 'missing') return 'missing'
    return 'attention' // expired, queried, invalid, rejected
}

export function buildComplianceModel({
    records,
    requirementsByProgram,
    templates,
    romConfirmed,
    now = new Date(),
    monthKeys,
    monthKeyOf,
    monthLabel
}: {
    records: ComplianceRecord[]
    requirementsByProgram: Record<string, ComplianceRequirement[]>
    templates: AgreementTemplate[]
    /** Participants whose GAP Analysis ROM has confirmed. */
    romConfirmed: Set<string>
    now?: Date
    monthKeys: string[]
    monthKeyOf: (record: ComplianceRecord) => string | null
    monthLabel: (key: string) => string
}): ComplianceModel {
    const delayMonths = (agreementId: string) => {
        const template = templates.find(t => canonicalAgreementId(t.agreementId || t.id) === agreementId)
        const months = Number(template?.availabilityDelayMonths)
        return months > 0 ? months : 0
    }

    const onboarding = new Map<string, OnboardingRow>(
        ONBOARDING_DOCUMENTS.map(d => [d.id, { id: d.id, label: d.label, required: 0, complete: 0, awaitingRom: 0, notSigned: 0, notDue: 0 }])
    )
    const programmes = new Map<string, ProgrammeCompliance & { rows: Map<string, DocumentRow> }>()
    const monthly = new Map<string, { onboarded: number; gap: number; pre: number; moa: number }>()
    let fullyOnboarded = 0

    records.forEach(record => {
        const requirements = requirementsByProgram[record.programId] || []
        const requiredAgreements = new Set(
            requirements.filter(r => r.kind === 'agreement').map(r => canonicalAgreementId(r.agreementId || r.id))
        )
        // Uploads by key; later entries (the subcollection) win, as on the Compliance page.
        const uploads = new Map<string, any>()
        record.uploads.forEach(upload => {
            const key = uploadKey(upload)
            if (key) uploads.set(key, upload)
        })

        // ---- Onboarding documents
        let allComplete = true
        const signedByMonth = { gap: false, pre: false, moa: false }
        ONBOARDING_DOCUMENTS.forEach(({ id }) => {
            // Programmes that list agreements decide which apply; older ones without a list get all three.
            if (requiredAgreements.size && !requiredAgreements.has(id)) return
            const agreement = record.agreements[id]
            let state: OnboardingState

            if (record.manual) {
                // Migrated SMEs upload their signed paper copy instead of signing in the system.
                const upload = uploads.get(id)
                const bucket = upload ? bucketOf(uploadStatus(upload)) : 'missing'
                const signedHere = isIncubateeAgreementSigned(agreement, id)
                state = bucket === 'valid' || bucket === 'expiring' || (signedHere && romSigned(agreement))
                    ? 'complete'
                    : upload || signedHere
                        ? 'awaiting-rom'
                        : 'not-signed'
            } else {
                const smeSigned = id === 'gap-analysis'
                    ? hasSmeGapSubmission({ application: record.application, participant: record.participant, agreement })
                    : isIncubateeAgreementSigned(agreement, id)
                const romDone = id === 'gap-analysis' ? romConfirmed.has(record.participantId) || romSigned(agreement) : romSigned(agreement)
                state = smeSigned ? (romDone ? 'complete' : 'awaiting-rom') : 'not-signed'

                const delay = delayMonths(id)
                if (state === 'not-signed' && delay) {
                    const accepted = toDate(record.application?.acceptedAt || record.application?.dateAccepted)
                    const due = accepted ? new Date(accepted) : null
                    due?.setMonth(due.getMonth() + delay)
                    if (!due || now < due) state = 'not-due'
                }
            }

            const row = onboarding.get(id)!
            if (state === 'not-due') {
                row.notDue += 1
                return
            }
            row.required += 1
            if (state === 'complete') row.complete += 1
            else if (state === 'awaiting-rom') row.awaitingRom += 1
            else row.notSigned += 1
            if (state !== 'complete') allComplete = false
            if (state !== 'not-signed') {
                if (id === 'gap-analysis') signedByMonth.gap = true
                else if (id === 'moa') signedByMonth.moa = true
                else signedByMonth.pre = true
            }
        })
        if (allComplete) fullyOnboarded += 1

        const month = monthKeyOf(record)
        if (month) {
            const m = monthly.get(month) || { onboarded: 0, gap: 0, pre: 0, moa: 0 }
            m.onboarded += 1
            if (signedByMonth.gap) m.gap += 1
            if (signedByMonth.pre) m.pre += 1
            if (signedByMonth.moa) m.moa += 1
            monthly.set(month, m)
        }

        // ---- Programme documents (uploads, leaving out the onboarding agreements above)
        const onboardingIds = new Set<string>(ONBOARDING_DOCUMENTS.map(d => d.id))
        const documents = requirements.filter(r => r.kind === 'upload' && !onboardingIds.has(r.id))
        const programmeId = record.programId || 'none'
        if (!programmes.has(programmeId)) {
            programmes.set(programmeId, {
                id: programmeId,
                name: record.programName || 'Programme not set',
                smes: 0,
                fullyCompliant: 0,
                documents: [],
                rows: new Map()
            })
        }
        const programme = programmes.get(programmeId)!
        programme.smes += 1
        let compliant = documents.length > 0
        documents.forEach(requirement => {
            const key = requirement.presetId || requirement.id
            const upload = uploads.get(key)
            const bucket = upload ? bucketOf(uploadStatus(upload)) : 'missing'
            if (!programme.rows.has(key)) {
                programme.rows.set(key, { key, title: requirement.title, required: 0, valid: 0, expiring: 0, pending: 0, attention: 0, missing: 0 })
            }
            const row = programme.rows.get(key)!
            row.required += 1
            row[bucket] += 1
            if (bucket !== 'valid' && bucket !== 'expiring') compliant = false
        })
        if (compliant) programme.fullyCompliant += 1
    })

    const keys = monthKeys.length ? monthKeys : Array.from(monthly.keys()).sort()
    const series = (pick: 'onboarded' | 'gap' | 'pre' | 'moa') => keys.map(k => monthly.get(k)?.[pick] || 0)

    return {
        onboarded: records.length,
        fullyOnboarded,
        onboarding: Array.from(onboarding.values()),
        programmes: Array.from(programmes.values())
            .map(({ rows, ...programme }) => ({
                ...programme,
                // Least covered first
                documents: Array.from(rows.values()).sort(
                    (a, b) => (a.valid + a.expiring) / a.required - (b.valid + b.expiring) / b.required || a.title.localeCompare(b.title)
                )
            }))
            .sort((a, b) => b.smes - a.smes || a.name.localeCompare(b.name)),
        trend: {
            categories: keys.map(monthLabel),
            onboarded: series('onboarded'),
            gap: series('gap'),
            pre: series('pre'),
            moa: series('moa')
        }
    }
}
