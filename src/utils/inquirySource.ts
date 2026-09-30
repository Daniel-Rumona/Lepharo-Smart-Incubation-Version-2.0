/*
  An inquiry has two separate facts that used to be mixed in one "source" list:
    - the channel it came through (walk-in, phone, social media ...)  -> `source`
    - who it is from (an incubated SME or not)                         -> `sourceType`
  Older records hold "SME", "Beneficiary", "system" or an audience name in
  `source`; these helpers read both shapes so lists and filters stay consistent.
*/

export type InquiryChannel =
    | 'Walk-in'
    | 'Phone'
    | 'Email'
    | 'Website'
    | 'Social Media'
    | 'Event'
    | 'Referral'
    | 'System'
    | 'Other'

export type InquiryAudience = 'Incubatee' | 'Non-Incubatee'

type ChannelOption = {
    value: InquiryChannel
    label: string
    mode: 'In person' | 'Remote' | 'Online'
}

/** Channels staff can pick when logging an inquiry by hand. */
export const MANUAL_CHANNELS: ChannelOption[] = [
    { value: 'Walk-in', label: 'Walk-in', mode: 'In person' },
    { value: 'Event', label: 'Event', mode: 'In person' },
    { value: 'Phone', label: 'Phone call', mode: 'Remote' },
    { value: 'Email', label: 'Email', mode: 'Online' },
    { value: 'Website', label: 'Website', mode: 'Online' },
    { value: 'Social Media', label: 'Social media', mode: 'Online' },
    { value: 'Referral', label: 'Referral', mode: 'Remote' },
    { value: 'Other', label: 'Other', mode: 'Remote' }
]

/** Set by the platform when an SME submits through their portal; never picked by hand. */
const SYSTEM_CHANNEL: ChannelOption = { value: 'System', label: 'Platform portal', mode: 'Online' }

export const ALL_CHANNELS: ChannelOption[] = [...MANUAL_CHANNELS, SYSTEM_CHANNEL]

export const channelOption = (channel: InquiryChannel) =>
    ALL_CHANNELS.find(option => option.value === channel) || MANUAL_CHANNELS[MANUAL_CHANNELS.length - 1]

/** "Walk-in (in person)" */
export const channelLabel = (channel: InquiryChannel) => {
    const option = channelOption(channel)
    return `${option.label} (${option.mode.toLowerCase()})`
}

const PORTAL_VALUES = new Set(['sme', 'beneficiary', 'system', 'incubatee'])
// Legacy audience names once stored in `source`. A bare "system" is an applicant, not an incubated SME.
const INCUBATED_VALUES = new Set(['sme', 'beneficiary', 'incubatee'])

export const resolveInquiryChannel = (raw?: string | null): InquiryChannel => {
    const text = String(raw || '').trim()
    if (!text) return 'Other'
    if (PORTAL_VALUES.has(text.toLowerCase())) return 'System'
    return ALL_CHANNELS.find(option => option.value.toLowerCase() === text.toLowerCase())?.value || 'Other'
}

export const AUDIENCE_LABEL: Record<InquiryAudience, string> = {
    Incubatee: 'Incubated SME',
    'Non-Incubatee': 'Non-Incubatee'
}

export const resolveInquiryAudience = (inquiry: {
    source?: string | null
    sourceType?: string | null
    programId?: string | null
}): InquiryAudience => {
    if (inquiry.sourceType === 'Incubatee' || inquiry.sourceType === 'Non-Incubatee') return inquiry.sourceType
    if (INCUBATED_VALUES.has(String(inquiry.source || '').trim().toLowerCase())) return 'Incubatee'
    return inquiry.programId ? 'Incubatee' : 'Non-Incubatee'
}
