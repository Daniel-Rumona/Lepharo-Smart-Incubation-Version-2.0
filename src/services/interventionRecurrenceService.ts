export type SupportedRecurrencePreset = 'as-needed' | 'weekly' | 'bi-weekly' | 'monthly'

export const SUPPORTED_RECURRENCE_OPTIONS = [
    { value: 'as-needed', label: 'As needed' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'bi-weekly', label: 'Every two weeks' },
    { value: 'monthly', label: 'Once a month' }
] as const

export const supportedRecurrenceFrom = (
    ...records: Array<Record<string, any> | null | undefined>
): SupportedRecurrencePreset | null => {
    for (const record of records) {
        if (!record) continue

        const raw = String(
            record.recurrencePreset ||
            record.recurrenceFrequency ||
            record.frequency ||
            ''
        ).trim().toLowerCase()

        if (['as-needed', 'as needed', 'ad-hoc', 'ad hoc', 'once-off', 'once off', 'once'].includes(raw)) {
            return 'as-needed'
        }
        if (raw === 'weekly') return 'weekly'
        if (['bi-weekly', 'biweekly', 'fortnightly', 'every two weeks'].includes(raw)) {
            return 'bi-weekly'
        }
        if (['monthly', 'once a month'].includes(raw)) return 'monthly'

        const recurrence = record.recurrence
        if (recurrence?.unit === 'week' && Number(recurrence.every) === 1) return 'weekly'
        if (recurrence?.unit === 'week' && Number(recurrence.every) === 2) return 'bi-weekly'
        if (recurrence?.unit === 'month' && Number(recurrence.every) === 1) return 'monthly'
    }

    return null
}

export const needsRecurrenceSelection = (
    assignment?: Record<string, any> | null,
    definition?: Record<string, any> | null
) => {
    if (supportedRecurrenceFrom(assignment, definition)) return false

    return true
}

export const recurrencePatch = (preset: SupportedRecurrencePreset) => {
    if (preset === 'as-needed') {
        return {
            recurring: false,
            assignmentMode: 'ad-hoc',
            recurrencePreset: null,
            recurrence: null,
            recurrenceStrict: null,
            recurrenceFrequency: 'as-needed',
            frequency: 'as-needed'
        }
    }

    const recurrence =
        preset === 'weekly'
            ? { every: 1, unit: 'week' }
            : preset === 'bi-weekly'
                ? { every: 2, unit: 'week' }
                : { every: 1, unit: 'month' }

    return {
        recurring: true,
        assignmentMode: 'recurring',
        recurrencePreset: preset,
        recurrence,
        recurrenceFrequency: preset,
        frequency: preset
    }
}
