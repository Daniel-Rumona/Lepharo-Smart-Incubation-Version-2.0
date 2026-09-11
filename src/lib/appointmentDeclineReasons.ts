export const APPOINTMENT_DECLINE_REASON_OPTIONS = [
    {
        value: 'schedule-conflict',
        label: 'I have a scheduling conflict'
    },
    {
        value: 'date-time-not-suitable',
        label: 'The proposed date or time does not work for me'
    },
    {
        value: 'delivery-method-not-suitable',
        label: 'The delivery method does not work for me'
    },
    {
        value: 'location-or-travel',
        label: 'I cannot attend at the proposed location'
    },
    {
        value: 'health-or-personal-emergency',
        label: 'Health issue or personal emergency'
    },
    {
        value: 'other',
        label: 'Other'
    }
] as const

export type AppointmentDeclineReasonCode =
    (typeof APPOINTMENT_DECLINE_REASON_OPTIONS)[number]['value']

export const getAppointmentDeclineReasonLabel = (
    code?: string
) =>
    APPOINTMENT_DECLINE_REASON_OPTIONS.find(option => option.value === code)?.label || ''

const TIME_PROPOSAL_REASON_CODES = new Set<AppointmentDeclineReasonCode>([
    'schedule-conflict',
    'date-time-not-suitable',
    'health-or-personal-emergency'
])

export const appointmentDeclineReasonAllowsTimeProposal = (
    code?: string
) => TIME_PROPOSAL_REASON_CODES.has(code as AppointmentDeclineReasonCode)

export const buildAppointmentDeclineReason = (
    code?: string,
    details?: string
) => {
    const normalizedCode = String(code || '').trim() as AppointmentDeclineReasonCode
    const label = getAppointmentDeclineReasonLabel(normalizedCode)
    const normalizedDetails = String(details || '').trim()

    if (!label) {
        throw new Error('Please select a reason for declining.')
    }
    if (normalizedCode === 'other' && !normalizedDetails) {
        throw new Error('Please provide your reason in your own words.')
    }

    return {
        code: normalizedCode,
        label,
        details: normalizedCode === 'other' ? normalizedDetails : '',
        text: normalizedCode === 'other' ? normalizedDetails : label
    }
}
