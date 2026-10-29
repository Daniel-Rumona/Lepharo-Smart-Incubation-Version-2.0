import type { SmeRow } from './participantsData'

/**
 * The SME filters: one definition per filter drives the popover, the matching
 * and Reset. Adding a filter means adding one entry to FILTER_DEFS.
 */

export type FilterKey = 'gender' | 'group' | 'sector' | 'province' | 'branch' | 'hub' | 'bee' | 'ownership' | 'gap'

export type ParticipantFilterState = { search: string } & Record<FilterKey, string>

export const FILTER_KEYS: FilterKey[] = ['gender', 'group', 'sector', 'province', 'branch', 'hub', 'bee', 'ownership', 'gap']

export const DEFAULT_PARTICIPANT_FILTERS: ParticipantFilterState = {
    search: '',
    ...(Object.fromEntries(FILTER_KEYS.map(k => [k, 'all'])) as Record<FilterKey, string>)
}

/** A filter choice as the popover shows it. */
export type ChoiceDef = { key: FilterKey; label: string; allLabel: string; values: string[] }

const clean = (v: unknown) => String(v ?? '').trim()
/** "female" / "FEMALE " → "Female", so differently-typed values are one option. */
const titleCase = (v: unknown) => {
    const t = clean(v)
    return t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : ''
}

/** A share of 51% or more is majority ownership (the B-BBEE threshold). */
const MAJORITY = 51
const majority = (pct: unknown) => Number(pct) >= MAJORITY

/** B-BBEE levels as "Level 1" … "Level 8", "Non-compliant" kept as written. */
const beeLabel = (v: unknown) => {
    const t = clean(v)
    if (!t) return ''
    const n = t.match(/^(?:level\s*)?(\d+\+?)$/i)
    return n ? `Level ${n[1]}` : titleCase(t)
}

type FilterDef = {
    label: string
    allLabel: string
    /** The option(s) a row belongs to. Ownership can match several. */
    valuesOf: (row: SmeRow) => string[]
    /** Fixed option order; otherwise options sort alphabetically (numbers naturally). */
    order?: string[]
}

export const FILTER_DEFS: Record<FilterKey, FilterDef> = {
    gender: { label: 'Gender', allLabel: 'All genders', valuesOf: r => [titleCase(r.gender)] },
    group: { label: 'Group', allLabel: 'All groups', valuesOf: r => [clean(r.group)] },
    sector: { label: 'Sector', allLabel: 'All sectors', valuesOf: r => [clean(r.sector)] },
    province: { label: 'Province', allLabel: 'All provinces', valuesOf: r => [clean(r.province)] },
    branch: { label: 'Branch', allLabel: 'All branches', valuesOf: r => [clean(r.branchName)] },
    hub: { label: 'Hub', allLabel: 'All hubs', valuesOf: r => [clean(r.hub)] },
    bee: { label: 'B-BBEE level', allLabel: 'All levels', valuesOf: r => [beeLabel(r.beeLevel)] },
    ownership: {
        label: 'Majority owned (51%+)',
        allLabel: 'Any ownership',
        order: ['Black', 'Women', 'Youth'],
        valuesOf: r => [
            majority(r.ownership?.blackOwnedPercent) ? 'Black' : '',
            majority(r.ownership?.femaleOwnedPercent) ? 'Women' : '',
            majority(r.ownership?.youthOwnedPercent) ? 'Youth' : ''
        ]
    },
    gap: {
        label: 'GAP analysis',
        allLabel: 'Any GAP status',
        order: ['Completed', 'Not completed'],
        valuesOf: r => [r.gapCompleted ? 'Completed' : 'Not completed']
    }
}

const naturalSort = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true })

/**
 * The filters worth showing for these rows: only those with two or more
 * options. A filter where every SME shares one value (e.g. a single group)
 * can't narrow the list, so it stays out of the popover. The hub filter also
 * needs the programme to be multi-branch.
 */
export const buildChoices = (rows: SmeRow[], options: { showHub: boolean }): ChoiceDef[] =>
    FILTER_KEYS.filter(key => key !== 'hub' || options.showHub).flatMap(key => {
        const def = FILTER_DEFS[key]
        const perRow = rows.map(r => def.valuesOf(r).filter(Boolean))
        const values = Array.from(new Set(perRow.flat()))
        if (values.length < 2) return []
        const sorted = def.order ? def.order.filter(v => values.includes(v)) : values.sort(naturalSort)
        return [{ key, label: def.label, allLabel: def.allLabel, values: sorted }]
    })

/** True when the row passes every active choice filter (search is handled separately). */
export const matchesChoices = (row: SmeRow, filters: ParticipantFilterState, activeKeys: FilterKey[]) =>
    activeKeys.every(key => filters[key] === 'all' || FILTER_DEFS[key].valuesOf(row).includes(filters[key]))
