import { useEffect, useMemo, useState } from 'react'
import dayjs, { type Dayjs } from 'dayjs'

/**
 * The reporting window every dashboard reads from.
 *
 * Deliberately built on the same window-global + custom-event mechanism as
 * useActiveProgramId rather than a React context: the two filters sit side by
 * side in the topbar and are consumed by pages far down the tree, so they should
 * behave identically. It also means the topbar control does not have to be an
 * ancestor of the dashboards it filters.
 *
 * Defaults to the current month. Showing every record ever created is what makes
 * a dashboard a register.
 */

export type DashboardDateRange = [Dayjs, Dayjs] | null

const STORAGE_KEY = 'lph-dashboard-date-range'
const EVENT = 'dashboard-date-filter-changed'
const GLOBAL = '__DASHBOARD_DATE_RANGE__'

type SerialisedRange = { from: string; to: string } | null

export const currentMonthRange = (): [Dayjs, Dayjs] => [
    dayjs().startOf('month'),
    dayjs().endOf('month')
]

const serialise = (range: DashboardDateRange): SerialisedRange =>
    range ? { from: range[0].toISOString(), to: range[1].toISOString() } : null

const deserialise = (value: SerialisedRange): DashboardDateRange => {
    if (!value?.from || !value?.to) return null
    const from = dayjs(value.from)
    const to = dayjs(value.to)
    return from.isValid() && to.isValid() ? [from, to] : null
}

/** Reads the stored window, falling back to the current month on first run. */
const readInitial = (): DashboardDateRange => {
    if (typeof window === 'undefined') return currentMonthRange()

    const live = (window as any)[GLOBAL] as SerialisedRange | undefined
    if (live !== undefined) return deserialise(live ?? null)

    try {
        const raw = window.localStorage.getItem(STORAGE_KEY)
        // An explicit "null" means the user chose All time; only a missing key
        // falls back to the current month.
        if (raw === 'null') return null
        if (raw) return deserialise(JSON.parse(raw) as SerialisedRange)
    } catch {
        // Storage unavailable or corrupt — fall through to the default.
    }

    return currentMonthRange()
}

/** Broadcasts a new window to every dashboard listening. */
export const setDashboardDateRange = (range: DashboardDateRange) => {
    if (typeof window === 'undefined') return

    const payload = serialise(range)
    ;(window as any)[GLOBAL] = payload

    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload))
    } catch {
        // Non-fatal: the choice just will not survive a reload.
    }

    window.dispatchEvent(new CustomEvent(EVENT, { detail: { range: payload } }))
}

export function useDashboardDateRange() {
    const [range, setRange] = useState<DashboardDateRange>(readInitial)

    useEffect(() => {
        if (typeof window === 'undefined') return

        // Publish the resolved default so the topbar control and any dashboard
        // mounting later agree on the same window.
        if ((window as any)[GLOBAL] === undefined) {
            ;(window as any)[GLOBAL] = serialise(range)
        }

        const onChange = (event: Event) => {
            const detail = (event as CustomEvent<{ range: SerialisedRange }>).detail
            setRange(deserialise(detail?.range ?? null))
        }

        window.addEventListener(EVENT, onChange)
        return () => window.removeEventListener(EVENT, onChange)
        // Intentionally mount-only: `range` is used to seed the global once, and
        // re-running on every change would rebind the listener needlessly.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const label = useMemo(() => {
        if (!range) return 'All time'

        const [from, to] = range
        const now = dayjs()

        if (from.isSame(now.startOf('month'), 'day') && to.isSame(now.endOf('month'), 'day')) {
            return 'This month'
        }

        const sameYear = from.isSame(to, 'year')
        return `${from.format(sameYear ? 'DD MMM' : 'DD MMM YYYY')} – ${to.format('DD MMM YYYY')}`
    }, [range])

    /** True when the window is anything other than the default current month. */
    const isCustom = useMemo(() => {
        if (!range) return true
        const now = dayjs()
        return !(
            range[0].isSame(now.startOf('month'), 'day') &&
            range[1].isSame(now.endOf('month'), 'day')
        )
    }, [range])

    /**
     * Does a record fall inside the window?
     *
     * Records with no usable date are kept rather than dropped — silently hiding
     * work because a timestamp is missing is worse than showing it in the wrong
     * period.
     */
    const withinRange = useMemo(() => {
        if (!range) return () => true

        const start = range[0].startOf('day')
        const end = range[1].endOf('day')

        return (value: any) => {
            if (!value) return true

            const parsed =
                typeof value?.toDate === 'function'
                    ? dayjs(value.toDate())
                    : value?.seconds
                        ? dayjs(value.seconds * 1000)
                        : dayjs(value)

            if (!parsed.isValid()) return true
            return !parsed.isBefore(start) && !parsed.isAfter(end)
        }
    }, [range])

    return { range, setRange: setDashboardDateRange, label, isCustom, withinRange }
}
