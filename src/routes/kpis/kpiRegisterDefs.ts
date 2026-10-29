import type { KPI } from '@/components/kpis/builder/kpiModel'
import { prettySourceLabel } from '@/components/kpis/builder/kpiModel'

/**
 * The register's filters and sorts. One definition per filter drives the
 * popover, the matching and Reset, like the Participants page.
 */

export type KpiFilterKey = 'department' | 'tracking' | 'measure' | 'source' | 'scope' | 'ownership' | 'target'

export type KpiFilterState = { search: string } & Record<KpiFilterKey, string>

export const KPI_FILTER_KEYS: KpiFilterKey[] = ['department', 'tracking', 'measure', 'source', 'scope', 'ownership', 'target']

export const DEFAULT_KPI_FILTERS: KpiFilterState = {
    search: '',
    ...(Object.fromEntries(KPI_FILTER_KEYS.map(k => [k, 'all'])) as Record<KpiFilterKey, string>)
}

export type KpiChoiceDef = { key: KpiFilterKey; label: string; allLabel: string; values: string[] }

export const isManual = (k: KPI) => k.trackingMode === 'manual'
export const isDeliverable = (k: KPI) => k.kpiKind === 'qualitative'
export const isShared = (k: KPI) => Boolean(k.sharedKpiMode) || k.belongsToMe === false
export const hasTarget = (k: KPI) => typeof k.latestTarget === 'number'

type FilterDef = {
    label: string
    allLabel: string
    valueOf: (k: KPI) => string
    order?: string[]
}

export const KPI_FILTER_DEFS: Record<KpiFilterKey, FilterDef> = {
    department: { label: 'Department', allLabel: 'All departments', valueOf: k => String(k.department || '').trim() },
    tracking: { label: 'Tracking', allLabel: 'Any tracking', order: ['Live', 'Manual'], valueOf: k => (isManual(k) ? 'Manual' : 'Live') },
    measure: { label: 'Measured as', allLabel: 'Any measure', order: ['Number', 'Deliverable'], valueOf: k => (isDeliverable(k) ? 'Deliverable' : 'Number') },
    // Only live KPIs read from a data source; manual ones have none to filter by.
    source: { label: 'Data source', allLabel: 'All sources', valueOf: k => (isManual(k) || !k.sourceType ? '' : prettySourceLabel(k.sourceType)) },
    scope: { label: 'Applies to', allLabel: 'Any scope', order: ['This programme', 'All programmes'], valueOf: k => (k.appliesToAllPrograms ? 'All programmes' : 'This programme') },
    ownership: { label: 'Ownership', allLabel: 'Any ownership', order: ['One department', 'Shared'], valueOf: k => (isShared(k) ? 'Shared' : 'One department') },
    target: { label: 'Target', allLabel: 'Any target', order: ['Set', 'Not set'], valueOf: k => (hasTarget(k) ? 'Set' : 'Not set') }
}

/** Filters worth showing: only those with two or more options among these KPIs. */
export const buildKpiChoices = (kpis: KPI[]): KpiChoiceDef[] =>
    KPI_FILTER_KEYS.flatMap(key => {
        const def = KPI_FILTER_DEFS[key]
        const values = Array.from(new Set(kpis.map(def.valueOf).filter(Boolean)))
        if (values.length < 2) return []
        const sorted = def.order ? def.order.filter(v => values.includes(v)) : values.sort((a, b) => a.localeCompare(b))
        return [{ key, label: def.label, allLabel: def.allLabel, values: sorted }]
    })

export const matchesKpiFilters = (k: KPI, filters: KpiFilterState, activeKeys: KpiFilterKey[]) => {
    const search = filters.search.trim().toLowerCase()
    if (search && ![k.kpiLabel, k.department, prettySourceLabel(k.sourceType), k.deliverable]
        .filter(Boolean)
        .some(v => String(v).toLowerCase().includes(search))) return false
    return activeKeys.every(key => filters[key] === 'all' || KPI_FILTER_DEFS[key].valueOf(k) === filters[key])
}

export type KpiSort = 'name' | 'department' | 'newest' | 'needsTarget'

const toMillis = (v: any) => (v?.seconds ? v.seconds * 1000 : v ? new Date(v).getTime() || 0 : 0)

export const sortKpis = (kpis: KPI[], sort: KpiSort) => {
    const byName = (a: KPI, b: KPI) => a.kpiLabel.localeCompare(b.kpiLabel)
    const rows = [...kpis]
    if (sort === 'department') return rows.sort((a, b) => String(a.department || '').localeCompare(String(b.department || '')) || byName(a, b))
    if (sort === 'newest') return rows.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt) || byName(a, b))
    if (sort === 'needsTarget') return rows.sort((a, b) => Number(hasTarget(a)) - Number(hasTarget(b)) || byName(a, b))
    return rows.sort(byName)
}

/** A target in its unit: R 25 000, 40%, 120. */
export const formatTarget = (k: KPI, value?: number | null) => {
    if (typeof value !== 'number') return '—'
    if (k.unit === 'ZAR') return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(value)
    if (k.unit === 'percent') return `${value}%`
    return new Intl.NumberFormat('en-ZA').format(value)
}

/** "2026-Q3" → "Q3 2026", "2026-08" → "Aug 2026". */
export const formatPeriodKey = (key?: string | null) => {
    if (!key) return ''
    const q = key.match(/^(\d{4})-Q(\d)$/)
    if (q) return `Q${q[2]} ${q[1]}`
    const m = key.match(/^(\d{4})-(\d{2})$/)
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, 1).toLocaleDateString('en-ZA', { month: 'short', year: 'numeric' })
    return key
}
