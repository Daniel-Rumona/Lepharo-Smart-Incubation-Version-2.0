import {
    complianceDocumentKey,
    complianceEffectiveExpiry,
    complianceTitleKey as titleKey,
    resolveComplianceDocumentStatus,
    type ComplianceRequirement
} from '@/services/complianceResolver'

export function buildDashboardComplianceRows(
    requirements: ComplianceRequirement[], embedded: any[], uploads: any[], now = new Date()
) {
    // Subcollection records take precedence over legacy embedded records,
    // matching the document management page, so the last match wins.
    const candidates = [...embedded, ...uploads].filter(document =>
        !(document.kind === 'agreement' || document.type === 'agreement' || document.agreementId)
    )
    return requirements.filter(requirement => requirement.kind === 'upload').map(requirement => {
        // Matched on the shared requirement key (presetId) as the staff pages do,
        // or on the title for older uploads saved with only a title.
        const requirementTitle = titleKey(requirement.title)
        const uploaded = candidates.filter(document =>
            complianceDocumentKey(document) === `upload:${requirement.id}` ||
            titleKey(document.type || document.title || document.documentName || document.name) === requirementTitle
        ).pop()
        const document = uploaded || { status: 'missing' }
        const expiry = uploaded ? complianceEffectiveExpiry(document, requirement) : null
        const status = resolveComplianceDocumentStatus(document, expiry, now)
        return {
            key: requirement.id || requirement.key || requirement.title,
            title: requirement.title,
            status,
            expiry,
            outstanding: !['valid', 'approved', 'expiring-soon'].includes(status)
        }
    })
}
