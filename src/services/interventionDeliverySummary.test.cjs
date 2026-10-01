const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const Module = require('node:module')
const test = require('node:test')
const ts = require('typescript')

const load = (file, requires = {}) => {
    const sourcePath = join(__dirname, file)
    const mod = new Module(sourcePath, module)
    mod.require = (name) => (name in requires ? requires[name] : require(name))
    mod._compile(ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
    }).outputText, sourcePath)
    return mod.exports
}
const { summariseDelivery } = load('interventionDeliverySummary.ts', {
    './assignmentLifecycleService': load('assignmentLifecycleService.ts'),
    './deliverableFiles': load('deliverableFiles.ts')
})

const base = {
    assigneeAcceptanceStatus: 'accepted', participantAcceptanceStatus: 'accepted',
    assigneeCompletionStatus: 'pending', participantCompletionStatus: 'pending', assignmentStatus: 'in-progress'
}
const now = Date.parse('2026-11-01T00:00:00Z')
const ts_ = (iso) => ({ toMillis: () => Date.parse(iso) })

test('delivery, MOV, deliverable and outcome are counted separately', () => {
    const result = summariseDelivery([
        { ...base },
        { ...base, assigneeCompletionStatus: 'completed' },
        { ...base, assignmentStatus: 'completed', participantCompletionStatus: 'confirmed', assigneeCompletionStatus: 'completed',
          resources: [{ link: 'https://x/a', type: 'poe' }], outcome: { status: 'achieved' } },
        { ...base, assignmentStatus: 'completed', participantCompletionStatus: 'confirmed', assigneeCompletionStatus: 'completed',
          outcome: { status: 'not_yet' } },
        { ...base, assignmentStatus: 'cancelled', supportClosedAt: 1 },
        { ...base, assignmentStatus: 'cancelled' }
    ], [{ status: 'approved' }, { status: 'awaiting_hod' }])
    assert.equal(result.assigned, 4)
    assert.equal(result.inDelivery, 1)
    assert.equal(result.awaitingSme, 1)
    assert.equal(result.completed, 2)
    assert.equal(result.closed, 1)
    assert.equal(result.movApproved, 1)
    assert.equal(result.deliverableReceived, 1)
    assert.equal(result.outcomeAchieved, 1)
    assert.equal(result.outcomeNotYet, 1)
})

test('a completed intervention is not counted as an achieved outcome', () => {
    const result = summariseDelivery([
        { ...base, assignmentStatus: 'completed', participantCompletionStatus: 'confirmed', assigneeCompletionStatus: 'completed' }
    ])
    assert.equal(result.completed, 1)
    assert.equal(result.outcomeAchieved, 0)
})

test('only unanswered check-backs that have fallen due are counted', () => {
    const result = summariseDelivery([], [], [
        { dueAt: ts_('2026-10-01T00:00:00Z') },
        { dueAt: ts_('2026-10-01T00:00:00Z'), answer: 'achieved' },
        { dueAt: ts_('2026-12-01T00:00:00Z') }
    ], now)
    assert.equal(result.checkBackDue, 1)
})
