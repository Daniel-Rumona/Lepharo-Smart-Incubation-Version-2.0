/**
 * Survey fields that are answered from the SME's own profile.
 *
 * The builder marks a field with `prefill: <key>`; the response page resolves
 * that key against the signed-in user and their participant record and seeds
 * the form with it. Both sides import from here so a key can never mean one
 * thing in the builder and another to the responder.
 *
 * Prefilled answers are editable and SURVEY-ONLY: correcting one changes the
 * saved response, never the user or participant document.
 */

export type PrefillKey = 'firstName' | 'lastName' | 'email'

/** Everything the resolver is allowed to read from. */
export type PrefillSources = {
    /** AppIdentity from useFullIdentity() — spreads the whole user profile. */
    user?: Record<string, any> | null
    /** The matching `participants` document, when one was found. */
    participant?: Record<string, any> | null
}

/**
 * Splits a single display name into first / rest.
 * "Thabo Mokoena Ndlovu" -> { first: 'Thabo', last: 'Mokoena Ndlovu' }
 */
const splitName = (full: string): { first: string; last: string } => {
    const parts = String(full || '')
        .trim()
        .split(/\s+/)
        .filter(Boolean)
    if (parts.length === 0) return { first: '', last: '' }
    if (parts.length === 1) return { first: parts[0], last: '' }
    return { first: parts[0], last: parts.slice(1).join(' ') }
}

const firstNonEmpty = (...values: any[]): string => {
    for (const value of values) {
        const text = String(value ?? '').trim()
        if (text) return text
    }
    return ''
}

/**
 * Resolve one prefill key to a value, or '' when nothing is known.
 *
 * Explicit firstName/lastName on the profile win; otherwise the display name is
 * split, because most records in this system only carry a single `name`.
 */
export const resolvePrefillValue = (
    key: PrefillKey,
    { user, participant }: PrefillSources
): string => {
    const displayName = firstNonEmpty(
        user?.name,
        user?.fullName,
        user?.displayName,
        participant?.participantName,
        participant?.ownerName
    )
    const split = splitName(displayName)

    switch (key) {
        case 'firstName':
            return firstNonEmpty(
                user?.firstName,
                participant?.firstName,
                split.first
            )
        case 'lastName':
            return firstNonEmpty(
                user?.lastName,
                user?.surname,
                participant?.lastName,
                split.last
            )
        case 'email':
            return firstNonEmpty(user?.email, participant?.email)
        default:
            return ''
    }
}

/** Shape of a field a section preset contributes to the builder. */
export type PrefillSectionField = {
    label: string
    type: string
    prefill: PrefillKey
}

export type PrefillSection = {
    /** Stable id, stored on nothing — only used to pick a preset in the UI. */
    key: string
    /** Heading inserted above the fields. */
    title: string
    description: string
    fields: PrefillSectionField[]
}

export const PREFILL_SECTIONS: PrefillSection[] = [
    {
        key: 'contactInfo',
        title: 'Contact Info',
        description: 'Answered automatically from the SME’s profile.',
        fields: [
            { label: 'Name', type: 'text', prefill: 'firstName' },
            { label: 'Last Name', type: 'text', prefill: 'lastName' },
            { label: 'Contact Email', type: 'email', prefill: 'email' }
        ]
    }
]

/** Human label for the badge shown on a prefilled field in the builder. */
export const PREFILL_LABELS: Record<PrefillKey, string> = {
    firstName: 'First name',
    lastName: 'Last name',
    email: 'Email address'
}

export const isPrefillKey = (value: unknown): value is PrefillKey =>
    value === 'firstName' || value === 'lastName' || value === 'email'
