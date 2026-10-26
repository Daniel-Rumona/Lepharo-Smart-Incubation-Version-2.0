import type { ComplianceRequirement } from '@/services/complianceResolver'
import { complianceMatchKey, resolveComplianceRows } from '@twin/rules'

// One compliance reader for dashboards and the digital twin
// (functions/src/twin/rules.ts): sub-collection uploads override the legacy
// embedded copies, matched to requirements like the incubatee compliance page.
export function buildDashboardComplianceRows(
    requirements: ComplianceRequirement[], embedded: any[], uploads: any[], now = new Date()
) {
    const uploadRequirements = requirements.filter(requirement => requirement.kind === 'upload')
    if (!uploadRequirements.length) return []
    const rows = resolveComplianceRows({
        requirements: uploadRequirements.map(requirement => ({
            key: complianceMatchKey(requirement.title),
            title: requirement.title,
            hasExpiry: requirement.hasExpiry,
            expiryMonths: requirement.expiryMonths
        })),
        embedded,
        uploads,
        now
    })
    return rows.map((row, index) => {
        const requirement = uploadRequirements[index]
        return {
            key: requirement.id || requirement.key || requirement.title,
            title: requirement.title,
            status: row.status,
            expiry: row.expiry,
            outstanding: !row.covered
        }
    })
}
