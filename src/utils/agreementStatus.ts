import { canonicalAgreementId } from '@/services/complianceResolver'

/** A record existing is not enough: the SME/incubatee must actually have signed it. */
export const isIncubateeAgreementSigned = (value: any, agreementIdValue?: unknown) => {
    if (value === true) return true
    if (!value || typeof value !== 'object') return false
    const agreementId = canonicalAgreementId(agreementIdValue || value.agreementId)
    const hasSignature = Boolean(value.participantSignatureURL || value.participantSignatureUrl ||
        value.signatureURL || value.signatureUrl || value.userSignatureURL || value.signer?.signatureURL)
    const participantFlag = value.participantSigned === true || value.smmeSigned === true
    if (agreementId === 'gap-analysis') return value.signed === true || participantFlag || hasSignature
    if (agreementId === 'pre-incubation-contract') return participantFlag || hasSignature
    return participantFlag || (value.signed === true && (hasSignature || Boolean(value.signerName)))
}

const hasCompletedGapMarker = (value: any) => {
    if (!value || typeof value !== 'object') return false
    return String(value.gapAnalysisStatus || '').trim().toLowerCase() === 'completed' ||
        Boolean(value.gapSubmittedAt)
}

/**
 * GAP is complete from the SME's perspective as soon as it has been submitted.
 * Operations confirmation is a separate staff-side lifecycle step and must not
 * keep the submission in the SME's outstanding actions.
 */
export const hasSmeGapSubmission = ({
    application,
    participant,
    agreement,
    gapRecords = []
}: {
    application?: any
    participant?: any
    agreement?: any
    gapRecords?: any[]
}) => isIncubateeAgreementSigned(agreement, 'gap-analysis') ||
    hasCompletedGapMarker(application) ||
    hasCompletedGapMarker(participant) ||
    gapRecords.some(record => Boolean(record?.submittedAt || record?.createdAt || record?.id))

export const mergeAgreementSources = (subcollection: Record<string, any> = {}, embedded: Record<string, any> = {}) => {
    const merged: Record<string, any> = {}
    Object.entries(embedded || {}).forEach(([key, value]) => {
        const agreementId = canonicalAgreementId(key)
        merged[agreementId] = value === true ? { agreementId, signed: true } : { agreementId, ...(value as any) }
    })
    Object.entries(subcollection || {}).forEach(([key, value]) => {
        const agreementId = canonicalAgreementId(key)
        merged[agreementId] = { ...(merged[agreementId] || {}), ...(value as any), agreementId }
    })
    return merged
}
