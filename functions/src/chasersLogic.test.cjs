const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const Module = require('node:module')
const test = require('node:test')
const ts = require('typescript')

const sourcePath = join(__dirname, 'chasersLogic.ts')
const mod = new Module(sourcePath, module)
mod._compile(ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText, sourcePath)
const L = mod.exports

// Monday 3 November 2026, 08:00 SAST; the deadline is Friday the 7th.
const NOW = Date.parse('2026-11-03T06:00:00Z')
const DAY = 86400000
const spec = L.normaliseChaserSpec({ stage: 'awaiting_hod', deadline: '2026-11-07' }, NOW).spec
const items = () => [
    L.newItem('movDocuments', 'a', 'Zungu Trading – Cash Flow Planning', 'awaiting_hod'),
    L.newItem('movDocuments', 'b', 'Karoo Agri – Contract Management', 'awaiting_hod'),
]
const statuses = entries => new Map(Object.entries(entries))

test('a chaser needs a deadline it can reach and something to chase', () => {
    assert.match(L.normaliseChaserSpec({ stage: 'awaiting_hod' }, NOW).error, /date/)
    assert.match(L.normaliseChaserSpec({ stage: 'awaiting_hod', deadline: '2026-11-01' }, NOW).error, /passed/)
    assert.match(L.normaliseChaserSpec({ stage: 'awaiting_hod', deadline: '2027-03-01' }, NOW).error, /60 days/)
    assert.match(L.normaliseChaserSpec({ deadline: '2026-11-07' }, NOW).error, /Which MOVs/)
    assert.equal(L.normaliseChaserSpec({ stage: 'awaiting_hod', deadline: '2026-11-07', maxNudges: 9 }, NOW).spec.maxNudges, 3)
    assert.equal(spec.maxNudges, 2, 'two nudges each unless the person says otherwise')
    assert.equal(L.normaliseChaserSpec({ stage: 'delete_everything', departmentName: 'Legal', deadline: '2026-11-07' }, NOW).spec.stage, undefined)
})

test('the description says what, until when, and the allowance', () => {
    const text = L.describeChaser({ ...spec, departmentName: 'Legal Advisory Services' }, 6)
    assert.match(text, /^Chase 6 MOVs waiting for HOD approval in Legal Advisory Services until .*7 Nov.*, nudging whoever has to act at most 2 times each\.$/)
})

test('the first run nudges every waiting item, and the next nudge waits for the gap', () => {
    const first = L.planRun(spec, NOW, items(), statuses({ a: 'awaiting_hod', b: 'awaiting_hod' }), new Set(), NOW)
    assert.deepEqual(first.nudge, ['a', 'b'])
    // Four days to Friday over two nudges: two days apart.
    assert.equal(L.nudgeGapDays(NOW, spec.deadline, 2), 2)
    const nudged = first.items.map(item => ({ ...item, nudges: 1, lastNudgeAt: NOW }))
    assert.deepEqual(L.planRun(spec, NOW, nudged, statuses({ a: 'awaiting_hod', b: 'awaiting_hod' }), new Set(), NOW + DAY).nudge, [])
    assert.deepEqual(L.planRun(spec, NOW, nudged, statuses({ a: 'awaiting_hod', b: 'awaiting_hod' }), new Set(), NOW + 2 * DAY).nudge, ['a', 'b'])
})

test('someone else reminding today means the chaser waits a day without spending a nudge', () => {
    const plan = L.planRun(spec, NOW, items(), statuses({ a: 'awaiting_hod', b: 'awaiting_hod' }), new Set(['a']), NOW)
    assert.deepEqual(plan.nudge, ['b'])
})

test('an approved item is finished; when all are, the chaser is done', () => {
    const plan = L.planRun(spec, NOW, items(), statuses({ a: 'approved', b: 'awaiting_hod' }), new Set(), NOW)
    assert.deepEqual(plan.finished, ['a'])
    assert.equal(plan.allDone, false)
    const all = L.planRun(spec, NOW, plan.items, statuses({ b: 'approved' }), new Set(), NOW + DAY)
    assert.deepEqual(all.finished, ['b'])
    assert.equal(all.allDone, true)
})

test('a MOV that moves to the next person starts a fresh allowance for them', () => {
    const spent = items().map(item => ({ ...item, nudges: 2, lastNudgeAt: NOW - 3 * DAY, asked: true }))
    const plan = L.planRun(spec, NOW - 3 * DAY, spent, statuses({ a: 'queried', b: 'awaiting_hod' }), new Set(), NOW)
    const a = plan.items.find(item => item.id === 'a')
    assert.equal(a.nudges, 0)
    assert.equal(a.asked, false)
    assert.deepEqual(plan.nudge, ['a'], 'the facilitator is nudged; b has used its allowance and was already asked about')
})

test('an item that used its allowance is put to the owner once, never escalated on its own', () => {
    const spent = items().map(item => ({ ...item, nudges: 2, lastNudgeAt: NOW - 3 * DAY }))
    const plan = L.planRun(spec, NOW - 2 * DAY, spent, statuses({ a: 'awaiting_hod', b: 'awaiting_hod' }), new Set(), NOW)
    assert.deepEqual(plan.nudge, [])
    assert.deepEqual(plan.ask, ['a', 'b'])
    const asked = plan.items.map(item => ({ ...item, asked: true }))
    assert.deepEqual(L.planRun(spec, NOW - 2 * DAY, asked, statuses({ a: 'awaiting_hod', b: 'awaiting_hod' }), new Set(), NOW + DAY).ask, [])
    // One more round from the owner: a third nudge.
    const extra = asked.map(item => ({ ...item, extra: 1, asked: false }))
    assert.deepEqual(L.planRun(spec, NOW - 2 * DAY, extra, statuses({ a: 'awaiting_hod', b: 'awaiting_hod' }), new Set(), NOW + DAY).nudge, ['a', 'b'])
})

test('test records are tracked but never nudged; past the deadline nothing is nudged', () => {
    const skipped = items().map(item => ({ ...item, skipped: 'test record' }))
    assert.deepEqual(L.planRun(spec, NOW, skipped, statuses({ a: 'awaiting_hod', b: 'approved' }), new Set(), NOW).nudge, [])
    const late = L.planRun(spec, NOW, items(), statuses({ a: 'awaiting_hod', b: 'awaiting_hod' }), new Set(), Date.parse('2026-11-08T06:00:00Z'))
    assert.equal(late.pastDeadline, true)
    assert.deepEqual(late.nudge, [])
    assert.equal(late.expired, false)
    assert.equal(L.planRun(spec, NOW, items(), statuses({}), new Set(), Date.parse('2026-11-15T06:00:00Z')).expired, true)
})

test('progress and what is waiting read plainly', () => {
    const plan = L.planRun(spec, NOW, items(), statuses({ a: 'approved', b: 'awaiting_hod' }), new Set(), NOW)
    assert.equal(L.progressLine(plan.items), '1 of 2 done')
    assert.equal(L.waitingList(plan.items), 'Karoo Agri – Contract Management (the HOD)')
})
