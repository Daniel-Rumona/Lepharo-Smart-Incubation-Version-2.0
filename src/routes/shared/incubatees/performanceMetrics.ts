type RecordData = Record<string, any>
export type PerformanceMonth = { month: string; revenue: number | null; permanent: number | null; temporary: number | null }
const months = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const numeric = (value: unknown): number | null => {
    if (value == null || value === '') return null
    const number = Number(value)
    return Number.isFinite(number) && number >= 0 ? number : null
}
const timestamp = (value: any): number => {
    const date = value?.toDate?.() || (value?.seconds != null ? new Date(value.seconds * 1000) : value)
    return date ? new Date(date).getTime() || 0 : 0
}

// A month must have an explicit year; submission dates are not reporting dates.
export function performanceMonthKey(value: unknown, year?: unknown): string | null {
    const label = String(value || '').trim().toLowerCase()
    const iso = label.match(/^(\d{4})-(\d{1,2})(?:$|-\d{2})/)
    if (iso && Number(iso[2]) >= 1 && Number(iso[2]) <= 12) return `${iso[1]}-${iso[2].padStart(2, '0')}`
    const named = label.match(/^([a-z]+)(?:\s+(\d{4}))?$/)
    if (!named) return null
    const index = months.findIndex(month => month === named[1] || month.slice(0, 3) === named[1])
    const explicitYear = String(named[2] || year || '')
    return index >= 0 && /^\d{4}$/.test(explicitYear) ? `${explicitYear}-${String(index + 1).padStart(2, '0')}` : null
}

export function buildPerformanceMonths(history: RecordData[], participant: RecordData | null): PerformanceMonth[] {
    const result = new Map<string, PerformanceMonth>()
    const get = (month: string) => {
        if (!result.has(month)) result.set(month, { month, revenue: null, permanent: null, temporary: null })
        return result.get(month)!
    }
    for (const [key, value] of Object.entries(participant?.revenueHistory?.monthly || {})) {
        const month = performanceMonthKey(key, participant?.revenueHistory?.year)
        if (month) get(month).revenue = numeric(value)
    }
    for (const [key, value] of Object.entries(participant?.headcountHistory?.monthly || {}) as [string, any][]) {
        const month = performanceMonthKey(key, participant?.headcountHistory?.year)
        if (month) Object.assign(get(month), { permanent: numeric(value?.permanent), temporary: numeric(value?.temporary) })
    }
    // Latest submission wins per month and field; missing fields preserve the
    // preceding reported value, and an explicit zero remains a valid report.
    const sorted = [...history].sort((a, b) =>
        (timestamp(a.updatedAt) || timestamp(a.createdAt)) - (timestamp(b.updatedAt) || timestamp(b.createdAt))
    )
    for (const row of sorted) {
        const month = performanceMonthKey(row.month, row.year)
        if (!month) continue
        const target = get(month)
        const values = { revenue: numeric(row.revenue), permanent: numeric(row.headPermanent), temporary: numeric(row.headTemporary) }
        for (const field of ['revenue', 'permanent', 'temporary'] as const) {
            if (values[field] !== null) target[field] = values[field]
        }
    }
    return [...result.values()].sort((a, b) => a.month.localeCompare(b.month))
}

export function summarizePerformanceMonths(months: PerformanceMonth[], start: string | null, end: string) {
    let totalRevenue = 0
    let currentEmployees = 0
    for (const row of [...months].sort((a, b) => a.month.localeCompare(b.month))) {
        if (row.month > end) continue
        if (!start || row.month >= start) totalRevenue += row.revenue ?? 0
        if (row.permanent !== null || row.temporary !== null) currentEmployees = (row.permanent ?? 0) + (row.temporary ?? 0)
    }
    return { totalRevenue, currentEmployees }
}
