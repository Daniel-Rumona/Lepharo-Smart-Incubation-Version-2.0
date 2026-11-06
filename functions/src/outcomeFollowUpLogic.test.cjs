const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const Module = require('node:module')
const test = require('node:test')
const ts = require('typescript')

const sourcePath = join(__dirname, 'outcomeFollowUpLogic.ts')
const mod = new Module(sourcePath, module)
mod._compile(ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText, sourcePath)
const {
    isConfirmed, followUpDays, dueAtFrom, shouldRemind, shouldEscalate,
    smeToAssessment, deriveConfidence, hasDeliverableFile, isFacilitatorAnswer, isSmeAnswer
} = mod.exports

const day = 24 * 60 * 60 * 1000
const now = new Date('2026-10-20T08:00:00Z')

test('a follow-up is scheduled only once the work is confirmed', () => {
    assert.equal(isConfirmed({ participantCompletionStatus: 'confirmed' }), true)
    assert.equal(isConfirmed({ assignmentStatus: 'completed' }), true)
    assert.equal(isConfirmed({ assignmentStatus: 'in-progress', participantCompletionStatus: 'pending' }), false)
    assert.equal(isConfirmed(undefined), false)
})

test('days default to 60 and never go below 1', () => {
    assert.equal(followUpDays({ followUpAfterDays: 30 }), 30)
    assert.equal(followUpDays({}), 60)
    assert.equal(followUpDays({ followUpAfterDays: 0 }), 60)
    assert.equal(dueAtFrom(new Date(0), 2).getTime(), 2 * day)
})

test('reminders: not before due, first one at due, then every 3 days, capped at 4', () => {
    const dueAt = new Date(now.getTime() - day)
    assert.equal(shouldRemind({ dueAt: new Date(now.getTime() + day), lastRemindedAt: null }, now), false)
    assert.equal(shouldRemind({ dueAt, lastRemindedAt: null }, now), true)
    assert.equal(shouldRemind({ dueAt, remindersSent: 1, lastRemindedAt: new Date(now.getTime() - 2 * day) }, now), false)
    assert.equal(shouldRemind({ dueAt, remindersSent: 1, lastRemindedAt: new Date(now.getTime() - 3 * day) }, now), true)
    assert.equal(shouldRemind({ dueAt, remindersSent: 4, lastRemindedAt: new Date(now.getTime() - 30 * day) }, now), false)
    assert.equal(shouldRemind({ dueAt, status: 'answered', lastRemindedAt: null }, now), false)
})

test('the HOD is told once, on the third reminder', () => {
    assert.deepEqual([1, 2, 3, 4].map(shouldEscalate), [false, false, true, false])
})

test('answers are validated and the SME answer maps onto the same scale', () => {
    assert.equal(isFacilitatorAnswer('achieved'), true)
    assert.equal(isFacilitatorAnswer('system_observed'), false)
    assert.equal(isSmeAnswer('yes'), true)
    assert.equal(isSmeAnswer('achieved'), false)
    assert.deepEqual(['yes', 'partly', 'no'].map(smeToAssessment), ['achieved', 'partial', 'not_yet'])
})

test('confidence is derived, and can never be system_observed', () => {
    assert.equal(deriveConfidence({ byRole: 'sme', hasDeliverable: true }), 'self_reported')
    assert.equal(deriveConfidence({ byRole: 'facilitator', hasDeliverable: false }), 'facilitator_verified')
    assert.equal(deriveConfidence({ byRole: 'hod', hasDeliverable: true }), 'artefact_supported')
})

test('deliverable detection: legacy poe files count, other roles and non-links do not', () => {
    assert.equal(hasDeliverableFile([{ link: 'https://x/a', type: 'poe' }]), true)
    assert.equal(hasDeliverableFile([{ link: 'https://x/a', role: 'other', type: 'poe' }]), false)
    assert.equal(hasDeliverableFile([{ link: 'https://x/a', type: 'signed_agreement' }]), false)
    assert.equal(hasDeliverableFile([{ link: 'nope', type: 'poe' }]), false)
    assert.equal(hasDeliverableFile(undefined), false)
})
