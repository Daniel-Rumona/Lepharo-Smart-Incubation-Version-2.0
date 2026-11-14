const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const Module = require('node:module')
const test = require('node:test')
const ts = require('typescript')

const sourcePath = join(__dirname, 'sessionCopilotLogic.ts')
const mod = new Module(sourcePath, module)
mod._compile(ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText, sourcePath)
const L = mod.exports

const session = (date, extra = {}) => ({
    date, held: true, title: 'Session', summary: 'Worked on it', reasonNotHeld: '', attendance: 'attended', actions: [], nextFocus: '', ...extra
})

test('history keeps only earlier recorded sessions, newest first', () => {
    const history = L.summariseHistory({
        sessionStart: '2026-05-01T09:00:00Z',
        sessions: [
            session('2026-03-01T09:00:00Z', { summary: 'first' }),
            session('2026-04-01T09:00:00Z', { summary: 'second' }),
            session('2026-04-15T09:00:00Z', { held: null, summary: 'not recorded yet' }),
            session('2026-06-01T09:00:00Z', { summary: 'later' })
        ],
        plannedSessions: 4,
        attendanceByAppointment: { a: { outcome: 'attended' }, b: { outcome: 'no_show' }, c: { outcome: 'attended' } }
    })
    assert.deepEqual(history.previous.map(s => s.summary), ['second', 'first'])
    assert.equal(history.heldCount, 2)
    assert.equal(history.attendedCount, 2)
    assert.equal(history.noShowCount, 1)
    assert.equal(history.plannedSessions, 4)
})

test('open actions and focus come from the last session that was held', () => {
    const history = L.summariseHistory({
        sessionStart: '2026-05-01T09:00:00Z',
        sessions: [
            session('2026-03-01T09:00:00Z', { actions: ['old action'], nextFocus: 'old focus' }),
            session('2026-04-01T09:00:00Z', { actions: ['Send bank statements', ' '], nextFocus: 'Cash flow forecast' }),
            session('2026-04-20T09:00:00Z', { held: false, reasonNotHeld: 'SME unavailable' })
        ],
        plannedSessions: 0,
        attendanceByAppointment: {}
    })
    assert.deepEqual(history.openActions, ['Send bank statements'])
    assert.equal(history.lastFocus, 'Cash flow forecast')
    assert.equal(history.plannedSessions, 1)
    assert.equal(history.previous[0].held, false)
})

test('business snapshot compares the latest month with three months earlier', () => {
    const snap = L.businessSnapshot([
        { month: '2026-01', revenue: 20000, jobs: 4 },
        { month: '2026-04', revenue: 23000, jobs: 5 },
        { month: '2026-03', revenue: 21000, jobs: 4 }
    ])
    assert.equal(snap.month, '2026-04')
    assert.equal(snap.revenueChangePercent, 15)
    assert.equal(snap.jobsChange, 1)
    assert.equal(L.businessSnapshot([]), null)
})

test('briefs are for the facilitator, their department and managers only', () => {
    const appt = { assigneeId: 'u1', assigneeEmail: 'Coach@x.co', departmentId: 'd1' }
    assert.ok(L.canSeeBrief({ role: 'Coordinator', ids: ['u1'], email: '', departmentId: '' }, appt))
    assert.ok(L.canSeeBrief({ role: 'coordinator', ids: [], email: 'coach@x.co', departmentId: '' }, appt))
    assert.ok(L.canSeeBrief({ role: 'coordinator', ids: [], email: '', departmentId: 'd1' }, appt))
    assert.ok(L.canSeeBrief({ role: 'operations', ids: [], email: '', departmentId: 'other' }, appt))
    assert.ok(!L.canSeeBrief({ role: 'coordinator', ids: ['u2'], email: 'x@y', departmentId: 'd2' }, appt))
    assert.ok(!L.canSeeBrief({ role: 'incubatee', ids: ['u1'], email: '', departmentId: 'd1' }, appt))
    assert.ok(!L.canSeeBrief({ role: 'funder', ids: [], email: '', departmentId: '' }, appt))
})
