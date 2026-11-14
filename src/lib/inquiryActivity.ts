// One newest-first activity list for an inquiry: emails, logged notes, status
// changes and its follow-ups (booked, done, cancelled, escalated, handed back).

import { formatDayTime } from './followUpBuckets'

export type ActivityKind =
    | 'received'
    | 'status'
    | 'email'
    | 'note'
    | 'followup-booked'
    | 'followup-done'
    | 'followup-cancelled'
    | 'escalated'
    | 'returned'

export type ActivityItem = {
    key: string
    at: Date
    kind: ActivityKind
    title: string
    body?: string
    by?: string
}

type Communication = {
    id?: string
    type?: string
    message?: string
    sentAt?: Date | null
    sentBy?: string
    sentByName?: string
    isInternal?: boolean
    noteKind?: 'call' | 'visit' | 'internal'
}

type StatusEntry = { status: string; changedAt?: Date | null; changedBy?: string; changedByName?: string; notes?: string }

type ActivityFollowUp = {
    id: string
    followUpType?: string
    scheduledDate?: Date | null
    status: string
    createdAt?: Date | null
    completedAt?: Date | null
    updatedAt?: Date | null
    outcome?: string
    completedByName?: string
    assignedToName?: string
    createdVia?: string
    escalation?: {
        departmentName?: string
        note?: string
        byName?: string
        at?: Date | null
        status?: string
        returnNote?: string
        returnedByName?: string
        returnedAt?: Date | null
    } | null
}

const NOTE_TITLE: Record<string, string> = { call: 'Logged a call', visit: 'Logged a visit', internal: 'Internal note' }

/** Old records store the sender's id as the name, or nothing useful at all. */
const looksLikeId = (value?: string) => !value || /^[A-Za-z0-9]{20,}$/.test(value.trim())

export function buildInquiryActivity(input: {
    submittedAt?: Date | null
    sourceLabel?: string
    communications?: Communication[]
    statusHistory?: StatusEntry[]
    followUps?: ActivityFollowUp[]
    /** uid → name, for entries that stored only the id. */
    names?: Record<string, string>
}): ActivityItem[] {
    const names = input.names || {}
    const who = (uid?: string, stored?: string) => {
        if (stored && !looksLikeId(stored) && stored !== 'System') return stored
        if (uid && names[uid]) return names[uid]
        if (uid === 'system') return 'System'
        return stored && !looksLikeId(stored) ? stored : undefined
    }
    const items: ActivityItem[] = []

    if (input.submittedAt) {
        items.push({
            key: 'received',
            at: input.submittedAt,
            kind: 'received',
            title: input.sourceLabel ? `Inquiry received · ${input.sourceLabel}` : 'Inquiry received'
        })
    }

    ;(input.statusHistory || []).forEach((entry, index) => {
        if (!entry.changedAt) return
        // The first "New" entry is the inquiry being created, already shown as "received".
        if (index === 0 && entry.status === 'New') return
        items.push({
            key: `status-${index}`,
            at: entry.changedAt,
            kind: 'status',
            title: `Status changed to ${entry.status}`,
            body: entry.notes || undefined,
            by: who(entry.changedBy, entry.changedByName)
        })
    })

    ;(input.communications || []).forEach((c, index) => {
        if (!c.sentAt) return
        const by = who(c.sentBy, c.sentByName)
        if (c.type === 'note') {
            items.push({
                key: `comm-${c.id || index}`,
                at: c.sentAt,
                kind: 'note',
                title: NOTE_TITLE[c.noteKind || 'internal'] || 'Note',
                body: c.message,
                by
            })
            return
        }
        const message = c.message || ''
        if (c.isInternal) {
            items.push({ key: `comm-${c.id || index}`, at: c.sentAt, kind: 'note', title: 'Internal note', body: message, by })
            return
        }
        const [first, ...rest] = message.split('\n\n')
        const subject = /^Subject:/i.test(first) ? first.replace(/^Subject:\s*/i, '') : ''
        items.push({
            key: `comm-${c.id || index}`,
            at: c.sentAt,
            kind: 'email',
            title: subject ? `Emailed the SME: ${subject}` : 'Emailed the SME',
            body: subject ? rest.join('\n\n') : message,
            by
        })
    })

    ;(input.followUps || []).forEach(f => {
        const how = f.followUpType ? ` (${f.followUpType})` : ''
        if (f.createdAt) {
            items.push({
                key: `fu-booked-${f.id}`,
                at: f.createdAt,
                kind: 'followup-booked',
                title: f.scheduledDate ? `Follow-up booked for ${formatDayTime(f.scheduledDate)}${how}` : `Follow-up booked${how}`,
                by: f.createdVia === 'portal' ? 'Created from the SME portal' : who(undefined, f.assignedToName)
            })
        }
        const esc = f.escalation
        if (esc?.at) {
            items.push({
                key: `fu-esc-${f.id}`,
                at: esc.at,
                kind: 'escalated',
                title: `Escalated to ${esc.departmentName || 'a department'}`,
                body: esc.note || undefined,
                by: esc.byName
            })
        }
        if (esc?.status === 'returned' && esc.returnedAt) {
            items.push({
                key: `fu-ret-${f.id}`,
                at: esc.returnedAt,
                kind: 'returned',
                title: `Handed back to reception`,
                body: esc.returnNote || undefined,
                by: esc.returnedByName
            })
        }
        if (f.status === 'Completed' && (f.completedAt || f.updatedAt)) {
            items.push({
                key: `fu-done-${f.id}`,
                at: (f.completedAt || f.updatedAt) as Date,
                kind: 'followup-done',
                title: `Follow-up done${how}`,
                body: f.outcome || undefined,
                by: f.completedByName
            })
        }
        if (f.status === 'Cancelled' && f.updatedAt) {
            items.push({ key: `fu-cancel-${f.id}`, at: f.updatedAt, kind: 'followup-cancelled', title: `Follow-up cancelled${how}` })
        }
    })

    return items.sort((a, b) => b.at.getTime() - a.at.getTime())
}
