export const OPERATING_DAYS = [
  { key: 'monday', label: 'Monday' },
  { key: 'tuesday', label: 'Tuesday' },
  { key: 'wednesday', label: 'Wednesday' },
  { key: 'thursday', label: 'Thursday' },
  { key: 'friday', label: 'Friday' },
  { key: 'saturday', label: 'Saturday' },
  { key: 'sunday', label: 'Sunday' }
] as const

export type OperatingDay = typeof OPERATING_DAYS[number]['key']
export type BranchDayHours = { closed: boolean; opens: string; closes: string }
export type BranchOperatingHours = Record<OperatingDay, BranchDayHours>

export const LEGACY_SHIFT: BranchDayHours = { closed: false, opens: '07:00', closes: '15:00' }

export const clockMinutes = (time: string): number => {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return NaN
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

export const defaultOperatingHours = (): BranchOperatingHours =>
  Object.fromEntries(OPERATING_DAYS.map(({ key }, index) => [
    key, { ...LEGACY_SHIFT, closed: index >= 5 }
  ])) as BranchOperatingHours

export const validateOperatingHours = (hours: BranchOperatingHours): void => {
  for (const { key, label } of OPERATING_DAYS) {
    const day = hours?.[key]
    if (!day || typeof day.closed !== 'boolean') throw new Error(`${label}: choose open or closed.`)
    if (day.closed) continue
    if (!Number.isFinite(clockMinutes(day.opens)) || !Number.isFinite(clockMinutes(day.closes))) {
      throw new Error(`${label}: enter valid opening and closing times.`)
    }
    if (clockMinutes(day.closes) <= clockMinutes(day.opens)) {
      throw new Error(`${label}: closing time must be after opening time (same day).`)
    }
  }
}

export const getDayHours = (hours: BranchOperatingHours, date: Date): BranchDayHours =>
  hours[OPERATING_DAYS[(date.getDay() + 6) % 7].key]

export const plannedMinutes = (shift: BranchDayHours): number =>
  shift.closed ? 0 : clockMinutes(shift.closes) - clockMinutes(shift.opens)

export const lateMinutes = (checkIn: string, shift: BranchDayHours): number =>
  shift.closed ? 0 : Math.max(0, clockMinutes(checkIn) - clockMinutes(shift.opens))

export const overtimeMinutes = (checkIn: string, checkOut: string, shift: BranchDayHours): number => {
  const start = clockMinutes(checkIn)
  let end = clockMinutes(checkOut)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0
  if (end < start) end += 24 * 60
  // On closed days, all recorded work requires overtime approval.
  return Math.max(0, end - (shift.closed ? start : Math.max(start, clockMinutes(shift.closes))))
}
