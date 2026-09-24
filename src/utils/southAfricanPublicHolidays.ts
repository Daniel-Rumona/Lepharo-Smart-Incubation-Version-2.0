// Statutory dates and Sunday observance: https://www.gov.za/about-sa/public-holidays
// Additional proclamations (reviewed 2026-09-21):
// https://www.gov.za/document?field_gcisdoc_doctype=545&field_gcisdoc_subjects=All&search_query=Holidays
// Newly proclaimed one-off holidays must be added here; recurring dates are calculated.
const proclaimedDates = new Set([
  '2021-11-01', '2022-12-27', '2023-12-15', '2024-05-29', '2026-11-04'
])

const dateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

const calendars = new Map<number, Set<string>>()

export const isSouthAfricanPublicHoliday = (date: Date): boolean => {
  const year = date.getFullYear()
  if (!Number.isFinite(year)) return false
  if (!calendars.has(year)) {
    const dates = [[1, 1], [3, 21], [4, 27], [5, 1], [6, 16], [8, 9], [9, 24], [12, 16], [12, 25], [12, 26]]
      .map(([month, day]) => new Date(year, month - 1, day))

    // Gregorian Easter (Meeus/Jones/Butcher); Good Friday and Family Day move yearly.
    const a = year % 19
    const b = Math.floor(year / 100)
    const c = year % 100
    const d = Math.floor(b / 4)
    const e = b % 4
    const f = Math.floor((b + 8) / 25)
    const g = Math.floor((b - f + 1) / 3)
    const h = (19 * a + b - d - g + 15) % 30
    const i = Math.floor(c / 4)
    const k = c % 4
    const l = (32 + 2 * e + 2 * i - h - k) % 7
    const m = Math.floor((a + 11 * h + 22 * l) / 451)
    const month = Math.floor((h + l - 7 * m + 114) / 31)
    const day = ((h + l - 7 * m + 114) % 31) + 1
    dates.push(new Date(year, month - 1, day - 2), new Date(year, month - 1, day + 1))

    const calendar = new Set(dates.map(dateKey))
    for (const holiday of dates) {
      if (holiday.getDay() === 0) {
        const observed = new Date(holiday)
        observed.setDate(observed.getDate() + 1)
        calendar.add(dateKey(observed))
      }
    }
    calendars.set(year, calendar)
  }
  return proclaimedDates.has(dateKey(date)) || calendars.get(year)!.has(dateKey(date))
}
