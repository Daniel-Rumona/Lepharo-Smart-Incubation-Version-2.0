import dayjs, { type Dayjs } from "dayjs";
import type { DashboardDateRange } from "@/lib/useDashboardDateRange";

/**
 * Month maths for the Finance page: which monthly rows fall inside the topbar
 * reporting period, which month to report on, and per-SME period figures.
 */

export type MonthPoint = {
    month: string;
    monthLabel?: string;
    revenue: number;
    expenses?: number;
    profit?: number;
};

/** The fields of a finance client the period figures need. */
export type FinanceClientLike = {
    id: string;
    name: string;
    email?: string;
    revenue: number | null;
    monthlyFinance: MonthPoint[];
    documents: unknown[];
    loadingStats: boolean;
    statsError?: string;
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** First day of the month a row covers: "2026-03", "2026-3" or "Mar 2026". */
export const monthStart = (row: { month?: string; monthLabel?: string }): Dayjs | null => {
    const key = String(row.month || "").trim();
    const iso = key.match(/^(\d{4})-(\d{1,2})/);
    if (iso) return dayjs(new Date(Number(iso[1]), Number(iso[2]) - 1, 1));

    const text = String(row.monthLabel || row.month || "").trim().toLowerCase();
    const named = text.match(/^([a-z]{3})[a-z]*\s+(\d{4})$/);
    if (named && MONTHS.includes(named[1])) {
        return dayjs(new Date(Number(named[2]), MONTHS.indexOf(named[1]), 1));
    }

    const parsed = dayjs(text);
    return parsed.isValid() ? parsed.startOf("month") : null;
};

export const monthName = (row: { month?: string; monthLabel?: string }) => {
    const start = monthStart(row);
    return start ? start.format("MMM YYYY") : String(row.monthLabel || row.month || "");
};

export const inPeriod = (row: MonthPoint, range: DashboardDateRange) => {
    if (!range) return true;
    const start = monthStart(row);
    if (!start) return false;
    return !start.isAfter(range[1], "day") && !start.endOf("month").isBefore(range[0], "day");
};

/** Rows in calendar order; rows without a readable month keep their place at the end. */
export const sortMonths = <T extends MonthPoint>(rows: T[]): T[] =>
    rows
        .map((row, index) => ({ row, index, start: monthStart(row) }))
        .sort((a, b) => {
            if (a.start && b.start) return a.start.valueOf() - b.start.valueOf();
            if (a.start) return -1;
            if (b.start) return 1;
            return a.index - b.index;
        })
        .map(({ row }) => row);

/**
 * Index of the month to report on: the last one in the period, skipping the
 * running month when an earlier one is available, because a partial month
 * always reads as a fall.
 */
export const latestIndex = (rows: MonthPoint[], range: DashboardDateRange) => {
    const currentMonth = dayjs().startOf("month");
    let fallback = -1;
    for (let i = rows.length - 1; i >= 0; i--) {
        if (!inPeriod(rows[i], range)) continue;
        if (fallback < 0) fallback = i;
        const start = monthStart(rows[i]);
        if (!start || !start.isSame(currentMonth, "month")) return i;
    }
    return fallback;
};

/** Short rand amount for headline figures: R 2.50M, R 812K. */
export const compactMoney = (value?: number | null) => {
    if (value === null || value === undefined) return "—";
    const n = Number(value || 0);
    const abs = Math.abs(n);
    if (abs >= 1_000_000_000) return `R ${(n / 1_000_000_000).toFixed(2)}B`;
    if (abs >= 1_000_000) return `R ${(n / 1_000_000).toFixed(2)}M`;
    if (abs >= 10_000) return `R ${(n / 1_000).toFixed(0)}K`;
    return `R ${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
};

export type Momentum = "growing" | "flat" | "declining";

export type PeriodStats = {
    /** Revenue in the period; the account total for All time. */
    periodRevenue: number | null;
    latest: {
        label: string;
        revenue: number;
        previous: number | null;
        /** Percentage change on the month before; null when that month had no revenue. */
        change: number | null;
    } | null;
    momentum: Momentum | null;
    /** Up to six months of revenue ending at the reported month. */
    sparkline: number[];
};

const percentChange = (current: number, previous: number | null) => {
    if (previous === null || previous <= 0) return null;
    return Math.round(((current - previous) / previous) * 100);
};

export const seriesPeriodStats = (
    unsorted: MonthPoint[],
    range: DashboardDateRange,
    allTimeRevenue?: number | null,
): PeriodStats => {
    const rows = sortMonths(unsorted);
    const inRange = rows.filter((row) => inPeriod(row, range));
    const periodRevenue = range
        ? inRange.reduce((sum, row) => sum + Number(row.revenue || 0), 0)
        : allTimeRevenue ?? (rows.length ? rows.reduce((sum, row) => sum + Number(row.revenue || 0), 0) : null);

    const i = latestIndex(rows, range);
    if (i < 0) return { periodRevenue, latest: null, momentum: null, sparkline: [] };

    const current = Number(rows[i].revenue || 0);
    const previous = i > 0 ? Number(rows[i - 1].revenue || 0) : null;
    const momentum: Momentum | null =
        previous === null ? null : current > previous ? "growing" : current < previous ? "declining" : "flat";

    return {
        periodRevenue,
        latest: {
            label: monthName(rows[i]),
            revenue: current,
            previous,
            change: percentChange(current, previous),
        },
        momentum,
        sparkline: rows.slice(Math.max(0, i - 5), i + 1).map((row) => Number(row.revenue || 0)),
    };
};

/** Adds every client's months together, keyed by calendar month. */
export const aggregateMonths = (series: MonthPoint[][]): MonthPoint[] => {
    const totals = new Map<string, MonthPoint>();
    series.forEach((rows) =>
        rows.forEach((row) => {
            const start = monthStart(row);
            const key = start ? start.format("YYYY-MM") : String(row.month || row.monthLabel || "");
            if (!key) return;
            const entry = totals.get(key) || {
                month: key,
                monthLabel: start ? start.format("MMM YYYY") : row.monthLabel,
                revenue: 0,
                expenses: 0,
                profit: 0,
            };
            entry.revenue += Number(row.revenue || 0);
            entry.expenses = Number(entry.expenses || 0) + Number(row.expenses || 0);
            entry.profit = Number(entry.profit || 0) + Number(row.profit || 0);
            totals.set(key, entry);
        }),
    );
    return sortMonths(Array.from(totals.values()));
};
