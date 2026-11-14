// Who an inquiry is from: an incubated SME, a business that wants to join, a
// funder, a stakeholder, or an ordinary visitor. Decided in one place for the
// inquiry form, the contacts directory and the inquiry analytics.
//
// Only an incubated SME is tied to a programme ("Incubatee" audience); every
// other type is a non-incubatee inquiry, as before.

export const INQUIRY_CONTACT_TYPES = ['Incubatee', 'Potential Incubatee', 'Funder', 'Stakeholder', 'Visitor'] as const
export type InquiryContactType = (typeof INQUIRY_CONTACT_TYPES)[number]

export const CONTACT_TYPE_LABEL: Record<InquiryContactType, string> = {
    Incubatee: 'Incubated SME',
    'Potential Incubatee': 'Potential incubatee',
    Funder: 'Funder',
    Stakeholder: 'Stakeholder',
    Visitor: 'Visitor'
}

export const CONTACT_TYPE_HINT: Record<InquiryContactType, string> = {
    Incubatee: 'An SME on one of our programmes',
    'Potential Incubatee': 'A business that wants to join',
    Funder: 'A sponsor, investor or funding body',
    Stakeholder: 'Government, a partner, NGO or institution',
    Visitor: 'Anyone else at the desk'
}

/** The inquiry types that make sense for each kind of contact. */
export const INQUIRY_TYPES_FOR: Record<InquiryContactType, string[]> = {
    Incubatee: ['General Information', 'Incubation Program', 'Funding', 'Mentorship', 'Office Space', 'Training', 'Networking', 'Other'],
    'Potential Incubatee': ['Incubation Program', 'General Information', 'Funding', 'Training', 'Mentorship', 'Office Space', 'Other'],
    Funder: ['Partnership', 'Funding', 'Networking', 'General Information', 'Other'],
    Stakeholder: ['Partnership', 'Networking', 'General Information', 'Training', 'Other'],
    Visitor: ['General Information', 'Office Space', 'Training', 'Networking', 'Other']
}

/** Businesses get industry and business stage; funders and stakeholders do not. */
export const asksBusinessDetails = (type: InquiryContactType) => type === 'Incubatee' || type === 'Potential Incubatee'

/** Funders and stakeholders always come from an organisation. */
export const needsOrganisation = (type: InquiryContactType) => type === 'Funder' || type === 'Stakeholder'

/** Only inquiries about a business go to an intervention department by default. */
export const needsDepartment = (type: InquiryContactType) => type === 'Incubatee' || type === 'Potential Incubatee'

/** The older two-way audience the rest of the app still reads. */
export const sourceTypeFor = (type: InquiryContactType) => (type === 'Incubatee' ? 'Incubatee' : 'Non-Incubatee')

const isContactType = (value: unknown): value is InquiryContactType =>
    typeof value === 'string' && (INQUIRY_CONTACT_TYPES as readonly string[]).includes(value)

/**
 * The contact type of an inquiry: the one recorded on it, or for inquiries from
 * before it was recorded, Incubatee for an SME's and Potential Incubatee for one
 * classed "Potential". Anything else is unknown (null).
 */
export function inquiryContactType(inquiry: {
    contactType?: unknown
    sourceType?: string | null
    programId?: string | null
    participantId?: string | null
    classification?: string | null
}, isIncubatee: boolean): InquiryContactType | null {
    if (isContactType(inquiry.contactType)) return inquiry.contactType
    if (isIncubatee) return 'Incubatee'
    if (inquiry.classification === 'Potential') return 'Potential Incubatee'
    return null
}

/** Industry and business stage: quick screening of a business that wants to join. An SME's are on its profile. */
export const asksScreening = (type: InquiryContactType) => type === 'Potential Incubatee'

/** The classification the older reports read, now decided by the contact type rather than asked. */
export const classificationFor = (type: InquiryContactType) => (type === 'Potential Incubatee' ? 'Potential' : 'General')

// ---- Why someone walked in ----

export const VISIT_PURPOSES = ['inquiry', 'session', 'meeting', 'documents', 'event'] as const
export type VisitPurpose = (typeof VISIT_PURPOSES)[number]

export const VISIT_PURPOSE_LABEL: Record<VisitPurpose, string> = {
    inquiry: 'New inquiry',
    session: 'Attending a session',
    meeting: 'Meeting a staff member',
    documents: 'Documents',
    event: 'Event or workshop'
}

export const VISIT_PURPOSE_HINT: Record<VisitPurpose, string> = {
    inquiry: 'They have a question or need help',
    session: 'Here for a booked session: check them in',
    meeting: 'Here to see someone on the team',
    documents: 'Dropping off or collecting documents',
    event: 'Here for an event or workshop at the centre'
}

/** Only an incubated SME has booked sessions to attend. */
export const visitPurposesFor = (type: InquiryContactType): VisitPurpose[] =>
    VISIT_PURPOSES.filter(purpose => purpose !== 'session' || type === 'Incubatee')

export const isVisitPurpose = (value: unknown): value is VisitPurpose =>
    typeof value === 'string' && (VISIT_PURPOSES as readonly string[]).includes(value)
