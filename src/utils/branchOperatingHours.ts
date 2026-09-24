import { isSouthAfricanPublicHoliday } from './southAfricanPublicHolidays'

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
export type OperatingHoursRules = {
  defaultHours: BranchDayHours
  workingDays: OperatingDay[]
  dayOverrides: Partial<Record<OperatingDay, BranchDayHours>>
  publicHolidays: BranchDayHours | null
}
// Keep the resolved weekday fields for existing consumers and legacy branches.
export type BranchOperatingHours = Record<OperatingDay, BranchDayHours> & {
  rules?: OperatingHoursRules
}

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

const validateDayHours = (day: BranchDayHours, label: string): void => {
    if (!day || typeof day.closed !== 'boolean') throw new Error(`${label}: choose open or closed.`)
    if (day.closed) return
    if (!Number.isFinite(clockMinutes(day.opens)) || !Number.isFinite(clockMinutes(day.closes))) {
      throw new Error(`${label}: enter valid opening and closing times.`)
    }
    if (clockMinutes(day.closes) <= clockMinutes(day.opens)) {
      throw new Error(`${label}: closing time must be after opening time (same day).`)
    }
}

export const validateOperatingHours = (hours: BranchOperatingHours): void => {
  for (const { key, label } of OPERATING_DAYS) validateDayHours(hours?.[key], label)
  if (hours.rules) {
    validateDayHours(hours.rules.defaultHours, 'Default hours')
    if (hours.rules.publicHolidays) validateDayHours(hours.rules.publicHolidays, 'Public holidays')
    if (!Array.isArray(hours.rules.workingDays) || hours.rules.workingDays.some(day => !OPERATING_DAYS.some(({ key }) => key === day))) {
      throw new Error('Choose valid working days.')
    }
    for (const { key, label } of OPERATING_DAYS) {
      const override = hours.rules.dayOverrides[key]
      if (override) validateDayHours(override, label)
    }
  }
}

export const operatingHoursFromRules = (rules: OperatingHoursRules): BranchOperatingHours => ({
  ...Object.fromEntries(OPERATING_DAYS.map(({ key }) => [key, {
    ...(rules.dayOverrides[key] || { ...rules.defaultHours, closed: !rules.workingDays.includes(key) })
  }])) as Record<OperatingDay, BranchDayHours>,
  rules
})

export const operatingHoursToRules = (hours: BranchOperatingHours): OperatingHoursRules => {
  if (hours.rules) return hours.rules
  // Infer the most common open hours without altering any legacy weekday schedule.
  const openDays = OPERATING_DAYS.map(({ key }) => hours[key]).filter(day => !day.closed)
  const sameHours = (a: BranchDayHours, b: BranchDayHours) => a.opens === b.opens && a.closes === b.closes
  const defaultHours = [...openDays].sort((a, b) =>
    openDays.filter(day => sameHours(day, b)).length - openDays.filter(day => sameHours(day, a)).length
  )[0] || LEGACY_SHIFT
  return {
    defaultHours: { ...defaultHours },
    workingDays: OPERATING_DAYS.filter(({ key }) => !hours[key].closed).map(({ key }) => key),
    dayOverrides: Object.fromEntries(OPERATING_DAYS
      .filter(({ key }) => !hours[key].closed && !sameHours(hours[key], defaultHours))
      .map(({ key }) => [key, { ...hours[key] }])),
    publicHolidays: null
  }
}

export const getDayHours = (hours: BranchOperatingHours, date: Date): BranchDayHours => {
  if (hours.rules?.publicHolidays && isSouthAfricanPublicHoliday(date)) return hours.rules.publicHolidays
  return hours[OPERATING_DAYS[(date.getDay() + 6) % 7].key]
}

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
