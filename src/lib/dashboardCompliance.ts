import dayjs from 'dayjs'
import { resolveComplianceDocumentStatus, type ComplianceRequirement } from '@/services/complianceResolver'

// Keep matching consistent with the incubatee compliance page.
const documentKey = (value: unknown) => String(value ?? '').toLowerCase()
    .replace(/\(signed\)/g, '')
    .replace(/\b(docs|documents)\b/g, 'document')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

const asDate = (value: any): Date | null => {
    if (!value) return null
    const date = value?.toDate?.() || (typeof value?.seconds === 'number'
        ? new Date(value.seconds * 1000) : new Date(value))
    return Number.isNaN(date.getTime()) ? null : date
}

export function buildDashboardComplianceRows(
    requirements: ComplianceRequirement[], embedded: any[], uploads: any[], now = new Date()
) {
    const byType = new Map<string, any>()
    // Subcollection records take precedence over legacy embedded records,
    // matching the document management page.
    for (const document of [...embedded, ...uploads]) {
        if (document.kind === 'agreement' || document.type === 'agreement' || document.agreementId) continue
        const key = documentKey(document.type || document.title || document.documentName || document.name)
        if (key) byType.set(key, document)
    }
    return requirements.filter(requirement => requirement.kind === 'upload').map(requirement => {
        const uploaded = byType.get(documentKey(requirement.title))
        const document = uploaded || { status: 'missing' }
        const issued = asDate(document.issueDate) || asDate(document.createdAt)
        const expiry = asDate(document.expiryDate) || (requirement.hasExpiry && requirement.expiryMonths && issued
            ? dayjs(issued).add(requirement.expiryMonths, 'month').toDate() : null)
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
