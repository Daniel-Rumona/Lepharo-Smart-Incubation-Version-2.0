import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { runInNewContext } from 'node:vm'
import test from 'node:test'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const loadTs = (relativePath, imports = {}) => {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  })
  const exports = {}
  runInNewContext(outputText, { exports, console, Error, require: id => {
    if (!(id in imports)) throw new Error(`Unexpected dependency: ${id}`)
    return imports[id]
  } })
  return exports
}
const holidays = loadTs('../src/utils/southAfricanPublicHolidays.ts')
const hours = loadTs('../src/utils/branchOperatingHours.ts', { './southAfricanPublicHolidays': holidays })
const { defaultOperatingHours, getDayHours, plannedMinutes, lateMinutes, overtimeMinutes, validateOperatingHours } = hours
const customShift = { closed: false, opens: '08:30', closes: '16:45' }

test('legacy branches default to a 40-hour Mon–Fri week with independent days', () => {
  const schedule = defaultOperatingHours()
  assert.equal(Object.values(schedule).reduce((total, day) => total + plannedMinutes(day), 0), 2400)
  assert.equal(schedule.saturday.closed, true)
  schedule.monday.opens = '09:00'
  assert.equal(schedule.tuesday.opens, '07:00')
  assert.equal(defaultOperatingHours().monday.opens, '07:00')
})

test('custom opening/closing determine planned hours, late arrival and overtime', () => {
  assert.equal(plannedMinutes(customShift), 495)
  assert.equal(lateMinutes('08:29', customShift), 0)
  assert.equal(lateMinutes('08:30', customShift), 0)
  assert.equal(lateMinutes('08:42', customShift), 12)
  assert.equal(overtimeMinutes('08:30', '16:45', customShift), 0)
  assert.equal(overtimeMinutes('08:30', '17:15', customShift), 30)
  assert.equal(overtimeMinutes('08:30', '15:30', customShift), 0)
})

test('overtime never includes time before an after-hours clock-in', () => {
  assert.equal(overtimeMinutes('18:00', '19:00', customShift), 60)
})

test('closed-day attendance has no lateness or target and all work requires overtime approval', () => {
  const closed = { ...customShift, closed: true }
  assert.equal(plannedMinutes(closed), 0)
  assert.equal(lateMinutes('10:00', closed), 0)
  assert.equal(overtimeMinutes('10:00', '12:30', closed), 150)
})

test('Saturday operating hours and Sunday closure resolve by local calendar day', () => {
  const schedule = defaultOperatingHours()
  schedule.saturday = { closed: false, opens: '09:00', closes: '13:00' }
  assert.equal(plannedMinutes(getDayHours(schedule, new Date(2026, 7, 29))), 240)
  assert.equal(plannedMinutes(getDayHours(schedule, new Date(2026, 7, 30))), 0)
})

test('validation rejects incomplete, malformed, equal, and overnight opening windows', () => {
  assert.throws(() => validateOperatingHours({}), /Monday/)
  for (const [opens, closes] of [['25:00', '26:00'], ['08:00', '08:00'], ['18:00', '06:00'], ['', '17:00'], ['8:00', '17:00']]) {
    const schedule = defaultOperatingHours()
    schedule.monday = { closed: false, opens, closes }
    assert.throws(() => validateOperatingHours(schedule), /Monday/)
  }
  const allClosed = defaultOperatingHours()
  Object.values(allClosed).forEach(day => { day.closed = true })
  assert.doesNotThrow(() => validateOperatingHours(allClosed))
})

test('captured shift remains stable when the branch schedule changes', () => {
  const schedule = defaultOperatingHours()
  const captured = structuredClone(getDayHours(schedule, new Date(2026, 7, 28)))
  schedule.friday.closes = '18:00'
  assert.equal(overtimeMinutes('07:00', '16:00', captured), 60)
  assert.equal(overtimeMinutes('07:00', '16:00', schedule.friday), 0)
})

const makeService = () => {
  const writes = []
  const firebase = {
    collection: (_, name) => name,
    doc: (_, collection, id) => `${collection}/${id}`,
    query: (...args) => args,
    where: (...args) => args,
    getDocs: async () => ({ empty: true, docs: [] }),
    serverTimestamp: () => 'SERVER_TIMESTAMP',
    addDoc: async (path, data) => { writes.push({ path, data }); return { id: 'branch-1' } },
    updateDoc: async (path, data) => { writes.push({ path, data }) }
  }
  const { branchService } = loadTs('../src/services/branchService.ts', {
    'firebase/firestore': firebase,
    '@/firebase': { db: {} },
    '@/utils/branchOperatingHours': hours
  })
  return { branchService, writes }
}

test('create persists the operating schedule and existing contact/coordinator fields', async () => {
  const { branchService, writes } = makeService()
  const schedule = defaultOperatingHours()
  schedule.monday = customShift
  await branchService.createBranch({ name: 'Test branch', location: 'Test, Gauteng',
    contactEmail: 'centre@example.com', contactPhone: '0123456789',
    centreCoordinatorUserId: 'coordinator-1', centreCoordinatorName: 'Coordinator', operatingHours: schedule })
  assert.equal(writes.length, 1)
  assert.equal(writes[0].data.operatingHours.monday.opens, '08:30')
  assert.equal(writes[0].data.contact.email, 'centre@example.com')
  assert.equal(writes[0].data.centreCoordinatorUserId, 'coordinator-1')
})

test('update persists hours and nested contact fields without erasing other branch fields', async () => {
  const { branchService, writes } = makeService()
  await branchService.updateBranch('branch-1', { operatingHours: defaultOperatingHours(), contactEmail: 'new@example.com' })
  assert.equal(writes[0].path, 'branches/branch-1')
  assert.equal(writes[0].data['contact.email'], 'new@example.com')
  assert.equal('contact' in writes[0].data, false)
  assert.equal('contactEmail' in writes[0].data, false)
  assert.equal('centreCoordinatorUserId' in writes[0].data, false)
  assert.equal(writes[0].data.operatingHours.friday.closes, '15:00')
})

test('invalid schedules fail before any Firestore write', async () => {
  const { branchService, writes } = makeService()
  await assert.rejects(() => branchService.updateBranch('branch-1', { operatingHours: {} }), /Monday/)
  assert.equal(writes.length, 0)
})

test('legacy schedules round-trip without changing open times or closed days', () => {
  const legacy = defaultOperatingHours()
  legacy.monday = { closed: false, opens: '09:00', closes: '16:00' }
  legacy.saturday = { closed: false, opens: '08:00', closes: '12:00' }
  const rules = hours.operatingHoursToRules(legacy)
  assert.equal(rules.defaultHours.opens, '07:00')
  assert.equal(Object.keys(rules.dayOverrides).length, 2)
  const converted = hours.operatingHoursFromRules(rules)
  for (const { key } of hours.OPERATING_DAYS) {
    assert.equal(converted[key].closed, legacy[key].closed)
    if (!legacy[key].closed) assert.equal(JSON.stringify(converted[key]), JSON.stringify(legacy[key]))
  }
})

test('default changes update ordinary days, preserve exceptions, and removal restores defaults', () => {
  const rules = hours.operatingHoursToRules(defaultOperatingHours())
  rules.dayOverrides.monday = { closed: false, opens: '10:00', closes: '14:00' }
  rules.defaultHours = customShift
  let schedule = hours.operatingHoursFromRules(rules)
  assert.equal(schedule.monday.opens, '10:00')
  assert.equal(schedule.tuesday.opens, '08:30')
  assert.equal(schedule.saturday.closed, true)
  delete rules.dayOverrides.monday
  schedule = hours.operatingHoursFromRules(rules)
  assert.equal(schedule.monday.opens, '08:30')
  rules.dayOverrides.saturday = customShift
  assert.equal(hours.operatingHoursFromRules(rules).saturday.closed, false)
  delete rules.dayOverrides.saturday
  assert.equal(hours.operatingHoursFromRules(rules).saturday.closed, true)
})

test('holiday calendar includes Easter, observed Mondays, and declared holidays', () => {
  const { isSouthAfricanPublicHoliday: isHoliday } = holidays
  for (const [year, month, day] of [
    [2026, 1, 1], [2026, 3, 21], [2026, 4, 3], [2026, 4, 6], [2026, 4, 27],
    [2026, 5, 1], [2026, 6, 16], [2026, 8, 9], [2026, 8, 10], [2026, 9, 24],
    [2026, 11, 4], [2026, 12, 16], [2026, 12, 25], [2026, 12, 26],
    [2027, 3, 22], [2027, 3, 26], [2027, 3, 29], [2027, 12, 27], [2024, 5, 29]
  ]) assert.equal(isHoliday(new Date(year, month - 1, day)), true, `${year}-${month}-${day}`)
  // A Saturday holiday does not create a Monday holiday; school holidays are not public holidays.
  for (const [month, day] of [[3, 23], [4, 5], [6, 15], [8, 11]]) {
    assert.equal(isHoliday(new Date(2026, month - 1, day)), false)
  }
})

test('holiday hours override weekday exceptions and feed attendance calculations', () => {
  const rules = hours.operatingHoursToRules(defaultOperatingHours())
  rules.dayOverrides.monday = { closed: false, opens: '10:00', closes: '14:00' }
  rules.publicHolidays = { closed: false, opens: '09:00', closes: '12:00' }
  const schedule = hours.operatingHoursFromRules(rules)
  const shift = getDayHours(schedule, new Date(2026, 7, 10))
  assert.equal(shift.opens, '09:00')
  assert.equal(plannedMinutes(shift), 180)
  assert.equal(lateMinutes('09:15', shift), 15)
  assert.equal(overtimeMinutes('09:15', '13:00', shift), 60)
  assert.equal(getDayHours(schedule, new Date(2026, 7, 17)).opens, '10:00')
  assert.equal(getDayHours(schedule, new Date(2026, 7, 9)).closed, false)
  rules.publicHolidays = { ...customShift, closed: true }
  assert.equal(getDayHours(hours.operatingHoursFromRules(rules), new Date(2026, 7, 10)).closed, true)
  rules.publicHolidays = null
  assert.equal(getDayHours(hours.operatingHoursFromRules(rules), new Date(2026, 7, 10)).opens, '10:00')
})

test('invalid holiday hours are rejected before writing, and rules persist when valid', async () => {
  const { branchService, writes } = makeService()
  const rules = hours.operatingHoursToRules(defaultOperatingHours())
  rules.publicHolidays = { closed: false, opens: '17:00', closes: '09:00' }
  await assert.rejects(() => branchService.updateBranch('branch-1', {
    operatingHours: hours.operatingHoursFromRules(rules)
  }), /Public holidays/)
  assert.equal(writes.length, 0)
  rules.publicHolidays = customShift
  await branchService.updateBranch('branch-1', { operatingHours: hours.operatingHoursFromRules(rules) })
  assert.equal(writes[0].data.operatingHours.rules.publicHolidays.opens, '08:30')
  assert.equal('contact' in writes[0].data, false)
})
