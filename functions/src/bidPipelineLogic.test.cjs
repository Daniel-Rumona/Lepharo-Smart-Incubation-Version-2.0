const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const Module = require('node:module')
const test = require('node:test')
const ts = require('typescript')

const sourcePath = join(__dirname, 'bidPipelineLogic.ts')
const mod = new Module(sourcePath, module)
mod._compile(ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText, sourcePath)
const L = mod.exports

test('stages move forward only along the pipeline', () => {
    assert.equal(L.canMove('interested', 'shortlisted'), true)
    assert.equal(L.canMove('shortlisted', 'submitted'), true)
    assert.equal(L.canMove('submitted', 'awarded'), true)
    assert.equal(L.canMove('submitted', 'lost'), true)
    assert.equal(L.canMove('invited', 'awarded'), false)
    assert.equal(L.canMove('awarded', 'lost'), false)
    assert.equal(L.isClosedStage('lost'), true)
    assert.equal(L.isClosedStage('submitted'), false)
    assert.equal(L.isBidStage('awarded'), true)
    assert.equal(L.isBidStage('won'), false)
})

test('a lost bid tells the SME why and what would help', () => {
    const m = L.stageMessage('lost', { title: 'PPE supply', lostReason: 'price', lostNote: 'Came in 18% above the winner.' })
    assert.equal(m.headline, 'Not successful: PPE supply')
    assert.equal(m.details, 'Reason: Price too high. Came in 18% above the winner. Next time: Tender pricing and costing support.')
    assert.equal(m.whatsapp, true)
})

test('awards and shortlists are messaged; the SME\'s own answers are not', () => {
    assert.match(L.stageMessage('awarded', { title: 'PPE', buyer: 'Bokamoso' }).details, /Bokamoso awarded/)
    assert.equal(L.stageMessage('shortlisted', { title: 'PPE' }).whatsapp, true)
    assert.equal(L.stageMessage('submitted', { title: 'PPE' }).whatsapp, false)
    assert.equal(L.stageMessage('interested', { title: 'PPE' }), null)
    assert.equal(L.stageMessage('withdrawn', { title: 'PPE' }), null)
})

test('contract totals and unscheduled value', () => {
    const t = L.contractTotals(100000, [
        { id: '1', title: 'First delivery', dueDate: null, amount: 30000, status: 'paid' },
        { id: '2', title: 'Second delivery', dueDate: null, amount: 30000, status: 'delivered' },
        { id: '3', title: 'Final', dueDate: null, amount: 20000, status: 'pending' }
    ])
    assert.deepEqual(t, { value: 100000, scheduled: 80000, unscheduled: 20000, delivered: 60000, paid: 30000 })
})

test('overdue milestones are pending and past due', () => {
    const now = new Date('2026-11-15')
    const overdue = L.overdueMilestones([
        { id: '1', title: 'a', dueDate: new Date('2026-11-01'), amount: 1, status: 'pending' },
        { id: '2', title: 'b', dueDate: new Date('2026-11-01'), amount: 1, status: 'delivered' },
        { id: '3', title: 'c', dueDate: new Date('2026-12-01'), amount: 1, status: 'pending' },
        { id: '4', title: 'd', dueDate: null, amount: 1, status: 'pending' }
    ], now)
    assert.deepEqual(overdue.map(m => m.id), ['1'])
})

test('bid history counts the funnel, win rate and top lost reasons', () => {
    const h = L.bidHistory([
        { status: 'invited' },
        { status: 'declined' },
        { status: 'interested' },
        { status: 'submitted' },
        { status: 'awarded' },
        { status: 'lost', lostReason: 'price' },
        { status: 'lost', lostReason: 'price' },
        { status: 'lost', lostReason: 'nonsense' }
    ])
    assert.equal(h.invited, 8)
    assert.equal(h.interested, 6) // interested, submitted, awarded and three lost
    assert.equal(h.submitted, 5)
    assert.equal(h.won, 1)
    assert.equal(h.lost, 3)
    assert.equal(h.winRate, 25)
    assert.deepEqual(h.lostReasons.map(r => [r.key, r.count]), [['price', 2], ['other', 1]])
    assert.equal(L.bidHistory([{ status: 'invited' }]).winRate, null)
})
