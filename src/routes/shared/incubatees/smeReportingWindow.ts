import dayjs, { type Dayjs } from 'dayjs'
import type { DashboardDateRange } from '@/lib/useDashboardDateRange'

/** Expand All time from the available record dates; yearless monthly arrays cover the current year. */
export const smeReportingWindow = (range: DashboardDateRange, dates: unknown[] = []): [Dayjs, Dayjs] => {
    if (range) return range
    const now = dayjs()
    const starts = dates.map((value: any) => {
        if (!value) return null
        const parsed = dayjs(value?.toDate?.() ?? (typeof value?.seconds === 'number' ? value.seconds * 1000 : value))
        return parsed.isValid() && !parsed.isAfter(now) ? parsed : null
    }).filter((date): date is Dayjs => date !== null)
    const start = starts.reduce((earliest, date) => date.isBefore(earliest) ? date : earliest, now.startOf('year'))
    return [start.startOf('month'), now.endOf('month')]
}
