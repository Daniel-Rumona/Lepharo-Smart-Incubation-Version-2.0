import { scheduleFields, storedStrict, type SchedulePreset } from '@/lib/recurrence'

export type SupportedRecurrencePreset = SchedulePreset

export const SUPPORTED_RECURRENCE_OPTIONS = [
    { value: 'as-needed', label: 'As needed' },
    { value: 'weekly', label: 'Weekly' },
    { value: 'bi-weekly', label: 'Every two weeks' },
    { value: 'monthly', label: 'Once a month' }
] as const

/** Assignment fields for a chosen frequency, keeping the strictness already set on the assignment or its definition. */
export const assignmentRecurrencePatch = (
    preset: SupportedRecurrencePreset,
    assignment?: Record<string, any> | null,
    definition?: Record<string, any> | null
) => scheduleFields(preset, { strict: storedStrict(assignment, definition) })
