import type { EventRecord } from '@/services/eventService'

export type StoryInvitee = { key: string; label: string; email: string; id: string }

/** Keep invitation counts distinct from confirmed attendance. */
export const getStoryInvitees = (event?: EventRecord): StoryInvitee[] => {
    if (!event) return []
    const people = new Map<string, StoryInvitee>()
    const emails = new Set<string>()
    const ids = new Set<string>()
    const rows = [
        ...(Array.isArray(event?.participants) ? event.participants : []),
        ...(Array.isArray(event?.participantsEmails) ? event.participantsEmails : []),
        ...(Array.isArray(event?.invitedEmails) ? event.invitedEmails : [])
    ]
    rows.forEach((row: any, index) => {
        const email = String(typeof row === 'string' ? row : row?.email || '').trim().toLowerCase()
        const id = String(row?.id || '').trim()
        const label = String(row?.beneficiaryName || row?.name || email).trim()
        if (!label && !id) return
        if ((email && emails.has(email)) || (id && ids.has(id))) return
        const key = email || id || `invitee-${index}`
        people.set(key, { key, label: label || 'Invited participant', email, id })
        if (email) emails.add(email)
        if (id) ids.add(id)
    })
    return [...people.values()]
}
