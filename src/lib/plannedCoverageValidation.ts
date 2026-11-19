export const plannedCoverageWordCount = (value: unknown): number =>
    (Array.isArray(value) ? value.join(' ') : String(value || '')).trim().split(/\s+/).filter(Boolean).length

export const hasMinimumPlannedCoverage = (value: unknown): boolean => plannedCoverageWordCount(value) >= 5

export const validatePlannedCoverage = (_rule: unknown, value: unknown): Promise<void> =>
    hasMinimumPlannedCoverage(value)
        ? Promise.resolve()
        : Promise.reject(new Error('Enter at least 5 words.'))
