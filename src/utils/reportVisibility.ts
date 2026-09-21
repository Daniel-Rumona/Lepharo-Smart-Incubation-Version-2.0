import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/firebase'

const CONTROL_DOMAIN = '@quantilytix.co.za'

export type ReportVisibilityContext = {
    hiddenUserIds: Set<string>
    hiddenParticipantIds: Set<string>
    hiddenEmails: Set<string>
}

export const isQuantilytixControlEmail = (value: unknown): boolean =>
    String(value || '').trim().toLowerCase().endsWith(CONTROL_DOMAIN)

export const canViewControlReportData = (viewerEmail?: unknown): boolean =>
    isQuantilytixControlEmail(viewerEmail)

const EMAIL_FIELDS = [
    'email', 'participantEmail', 'applicantEmail', 'smeEmail', 'beneficiaryEmail',
    'assigneeEmail', 'consultantEmail', 'coordinatorEmail', 'ownerEmail', 'createdByEmail'
]

const containsControlEmail = (value: unknown, seen = new Set<object>()): boolean => {
    if (typeof value === 'string') return isQuantilytixControlEmail(value)
    if (!value || typeof value !== 'object') return false
    if (seen.has(value as object)) return false
    seen.add(value as object)
    if (Array.isArray(value)) return value.some(item => containsControlEmail(item, seen))
    return Object.entries(value as Record<string, unknown>).some(([key, nested]) =>
        key.toLowerCase().includes('email') && typeof nested === 'string'
            ? isQuantilytixControlEmail(nested)
            : containsControlEmail(nested, seen)
    )
}

// Only explicit dummy markers hide records; manual capture is not a dummy marker.
const containsDummyMarker = (value: unknown, seen = new Set<object>()): boolean => {
    if (!value || typeof value !== 'object') return false
    if (seen.has(value as object)) return false
    seen.add(value as object)
    if (Array.isArray(value)) return value.some(item => containsDummyMarker(item, seen))
    return Object.entries(value as Record<string, unknown>).some(([key, nested]) => {
        const normalizedKey = key.toLowerCase()
        if (['isdummy', 'dummy'].includes(normalizedKey) && nested === true) return true
        return containsDummyMarker(nested, seen)
    })
}

/** Hides seeded control-account records from ordinary report viewers. */
export const loadReportVisibilityContext = async (
    viewerEmail?: unknown,
): Promise<ReportVisibilityContext> => {
    const context: ReportVisibilityContext = { hiddenUserIds: new Set(), hiddenParticipantIds: new Set(), hiddenEmails: new Set() }
    if (canViewControlReportData(viewerEmail)) return context

    const snap = await getDocs(query(collection(db, 'users')))
    snap.docs.forEach(docSnap => {
        const data = docSnap.data() as any
        if (isQuantilytixControlEmail(data.email)) {
            context.hiddenUserIds.add(docSnap.id)
            ;[data.uid, data.authUid, data.userId, data.id].filter(Boolean).forEach((id: unknown) => context.hiddenUserIds.add(String(id)))
            context.hiddenEmails.add(String(data.email).trim().toLowerCase())
        }
    })
    const participantSnap = await getDocs(collection(db, 'participants'))
    participantSnap.docs.forEach(docSnap => {
        const data = docSnap.data() as any
        if (isQuantilytixControlEmail(data.email)) {
            context.hiddenParticipantIds.add(docSnap.id)
            ;[data.id, data.participantId, data.uid].filter(Boolean).forEach((id: unknown) => context.hiddenParticipantIds.add(String(id)))
        }
    })
    return context
}

const HIDDEN_ID_FIELDS = ['assigneeId', 'assigneeUid', 'assignedTo', 'coordinatorId', 'coordinatorUid', 'consultantId', 'facilitatorId', 'ownerId', 'createdById', 'createdBy', 'assignedBy', 'userId', 'userUid']
const PARTICIPANT_ID_FIELDS = ['participantId', 'participantID', 'participant', 'incubateeId', 'beneficiaryId', 'smeId']

export const isReportRecordVisible = (record: Record<string, unknown>, viewerEmail?: unknown, context?: ReportVisibilityContext): boolean => {
    if (canViewControlReportData(viewerEmail)) return true
    if (EMAIL_FIELDS.some(field => isQuantilytixControlEmail(record[field])) || containsControlEmail(record) || containsDummyMarker(record)) return false
    if (context && HIDDEN_ID_FIELDS.some(field => context.hiddenUserIds.has(String(record[field] || '')))) return false
    if (context && PARTICIPANT_ID_FIELDS.some(field => context.hiddenParticipantIds.has(String(record[field] || '')))) return false
    return true
}

export const filterReportRecords = <T extends Record<string, unknown>>(records: T[], viewerEmail?: unknown, context?: ReportVisibilityContext): T[] =>
    records.filter(record => isReportRecordVisible(record, viewerEmail, context))

/** Applies control-account visibility to MOV rows and nested consolidated-pack rows. */
export const filterMovRecords = <T extends Record<string, any>>(records: T[], viewerEmail?: unknown): T[] => {
    if (canViewControlReportData(viewerEmail)) return records
    return records.flatMap(record => {
        const nestedKeys = ['interventions', 'interventionsSnapshot']
        const present = nestedKeys.filter(key => Array.isArray(record[key]))
        if (!present.length) return isReportRecordVisible(record, viewerEmail) ? [record] : []

        const next = { ...record }
        let hasVisible = false
        present.forEach(key => {
            const visible = record[key].filter((row: Record<string, unknown>) => isReportRecordVisible(row, viewerEmail))
            next[key] = visible
            if (visible.length) hasVisible = true
        })
        return hasVisible ? [next] : []
    })
}
