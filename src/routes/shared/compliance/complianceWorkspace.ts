/**
 * View model for the staff Compliance workspace: one row per SME, each
 * requirement's state grouped by who has to act next, and the toolbar's
 * filters and sort orders. Pure, so the list, detail and tiles agree.
 */

import type { ComplianceAiReview } from '@/services/complianceVerificationService'

/** The document's AI suggestion, unless it was made for a file since replaced. */
export const currentAiReview = (document: any): ComplianceAiReview | null => {
    const review = document?.aiReview
    if (!review || typeof review !== 'object' || !review.recommendation) return null
    if (review.url && document?.url && review.url !== document.url) return null
    return review as ComplianceAiReview
}

/** Who acts next on a requirement. */
export type ComplianceBucket = 'action' | 'review' | 'expiring' | 'valid'

/**
 * - action: the SME has to upload, sign, replace or renew (missing, expired,
 *   invalid, queried, rejected).
 * - review: staff have to verify an upload or countersign an agreement (pending).
 * - expiring: valid, but expires within 30 days.
 * - valid: nothing to do.
 */
export const bucketOfState = (state: string): ComplianceBucket => {
    const value = String(state || '').toLowerCase()
    if (value === 'valid' || value === 'signed') return 'valid'
    if (value === 'expiring-soon') return 'expiring'
    if (value === 'pending') return 'review'
    return 'action'
}

export const BUCKET_META: Record<
    ComplianceBucket,
    { title: string; countLabel: string; tone: 'danger' | 'info' | 'warning' | 'success' }
> = {
    action: { title: 'Needs SME action', countLabel: 'for the SME', tone: 'danger' },
    review: { title: 'Awaiting review', countLabel: 'to review', tone: 'info' },
    expiring: { title: 'Expiring soon', countLabel: 'expiring', tone: 'warning' },
    valid: { title: 'Valid', countLabel: 'valid', tone: 'success' }
}

/** One requirement for one SME, as the detail panel shows it. */
export type RequirementEntry<Requirement = any, Document = any> = {
    key: string
    title: string
    kind: 'upload' | 'agreement'
    state: string
    bucket: ComplianceBucket
    /** Status label, e.g. "Awaiting ROM signature". */
    label: string
    /** antd tag colour for the state. */
    color: string
    /** "12 Mar 2027", "12 mo" or "—" when the requirement doesn't expire. */
    expiryText: string
    expiresAt: Date | null
    requirement: Requirement
    document?: Document
}

/** One SME's row in the list. */
export type ComplianceView = {
    participantId: string
    name: string
    email: string
    programId: string
    programName: string
    branchName: string
    gapGroup: string
    covered: number
    required: number
    counts: Record<ComplianceBucket, number> & { expired: number }
    /** Earliest expiry among this SME's documents still valid or expiring. */
    nextExpiry: Date | null
    lastUpload: Date | null
    moaSigned: boolean
    /** Titles of requirements this SME hasn't covered, for the document filter. */
    outstanding: string[]
}

export type ComplianceSegment = 'all' | ComplianceBucket | 'compliant'
export type ComplianceSort = 'outstanding' | 'expiring' | 'name' | 'recent'

export type ComplianceFilterState = {
    search: string
    segment: Exclude<ComplianceSegment, 'valid'>
    programme: string
    branch: string
    group: string
    document: string
    sort: ComplianceSort
}

export const DEFAULT_COMPLIANCE_FILTERS: ComplianceFilterState = {
    search: '',
    segment: 'all',
    programme: 'all',
    branch: 'all',
    group: 'all',
    document: 'all',
    sort: 'outstanding'
}

export const isFullyCompliant = (view: ComplianceView) => view.required > 0 && view.covered === view.required

export const matchesSegment = (view: ComplianceView, segment: ComplianceFilterState['segment']) => {
    if (segment === 'all') return true
    if (segment === 'compliant') return isFullyCompliant(view)
    return view.counts[segment] > 0
}

const ratio = (view: ComplianceView) => (view.required ? view.covered / view.required : 1)
const time = (date: Date | null, fallback: number) => (date ? date.getTime() : fallback)

export const complianceSorters: Record<ComplianceSort, (a: ComplianceView, b: ComplianceView) => number> = {
    // Least covered first, then most to action.
    outstanding: (a, b) => ratio(a) - ratio(b) || b.counts.action - a.counts.action || a.name.localeCompare(b.name),
    expiring: (a, b) =>
        time(a.nextExpiry, Infinity) - time(b.nextExpiry, Infinity) || a.name.localeCompare(b.name),
    name: (a, b) => a.name.localeCompare(b.name),
    recent: (a, b) => time(b.lastUpload, 0) - time(a.lastUpload, 0) || a.name.localeCompare(b.name)
}

/** The row's one-line summary tag: the most urgent thing about this SME. */
export const viewHeadline = (view: ComplianceView): { label: string; color: string } => {
    if (!view.required) return { label: 'Not configured', color: 'default' }
    if (view.counts.expired) return { label: `${view.counts.expired} expired`, color: 'red' }
    if (view.counts.action) return { label: `${view.counts.action} outstanding`, color: 'volcano' }
    if (view.counts.review) return { label: `${view.counts.review} to review`, color: 'blue' }
    if (view.counts.expiring) return { label: `${view.counts.expiring} expiring`, color: 'orange' }
    return { label: 'Compliant', color: 'green' }
}

export const distinctValues = (values: string[]) =>
    Array.from(new Set(values.map(value => value.trim()).filter(value => value && value !== '—'))).sort((a, b) =>
        a.localeCompare(b)
    )
