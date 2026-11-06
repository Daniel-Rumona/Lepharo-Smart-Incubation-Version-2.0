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

const lifecycle = load('assignmentLifecycleService.ts')
const rules = load('interventionClosureRules.ts', { './assignmentLifecycleService': lifecycle })
const { validateClosure, splitForClosure, closureId, closedAssignmentPatch, statusAfterReopen, canCloseSupport, isClosedAssignment } = rules

const row = (patch = {}) => ({
    assignmentStatus: 'in-progress',
    assigneeAcceptanceStatus: 'accepted',
    participantAcceptanceStatus: 'accepted',
    assigneeCompletionStatus: 'pending',
    participantCompletionStatus: 'pending',
    ...patch
})

test('a reason is required, and "other" needs a note', () => {
    assert.match(validateClosure({}), /reason/i)
    assert.match(validateClosure({ reason: 'nonsense' }), /reason/i)
    assert.match(validateClosure({ reason: 'other', note: '  ' }), /note/i)
    assert.equal(validateClosure({ reason: 'other', note: 'Moved abroad' }), null)
    assert.equal(validateClosure({ reason: 'goal_met' }), null)
})

test('one closure per programme, SME and intervention', () => {
    assert.equal(closureId({ programId: 'p1', participantId: 's1', interventionId: 'i1' }), 'p1__s1__i1')
    assert.equal(closureId({ participantId: 's1', interventionId: 'i1' }), 'noprog__s1__i1')
})

test('only undelivered work is cancelled; delivered and awaiting-confirmation work is kept', () => {
    const undelivered = row()
    const awaitingAcceptance = row({ participantAcceptanceStatus: 'pending', assignmentStatus: 'assigned' })
    const awaitingConfirmation = row({ assigneeCompletionStatus: 'completed' })
    const completed = row({ assignmentStatus: 'completed', participantCompletionStatus: 'confirmed', assigneeCompletionStatus: 'completed' })
    const alreadyClosed = row({ assignmentStatus: 'cancelled', supportClosedAt: 1 })
    const { toClose, keep } = splitForClosure([undelivered, awaitingAcceptance, awaitingConfirmation, completed, alreadyClosed])
    assert.deepEqual(toClose, [undelivered, awaitingAcceptance])
    assert.deepEqual(keep, [awaitingConfirmation, completed])
})

test('closing keeps the old status so a reopen restores it', () => {
    const patch = closedAssignmentPatch({ previousStatus: 'in-progress', closureId: 'c', reason: 'goal_met', byUid: 'u', byName: 'N', at: 5 })
    assert.equal(patch.assignmentStatus, 'cancelled')
    assert.equal(statusAfterReopen({ assignmentStatusBeforeClosure: 'in-progress' }), 'in-progress')
    assert.equal(statusAfterReopen({}), 'assigned')
    assert.equal(isClosedAssignment({ ...patch }), true)
})

test('a closed assignment reads as "Support Closed", not a plain cancellation, and is not open', () => {
    const closed = lifecycle.resolveAssignmentLifecycle(row({ assignmentStatus: 'cancelled', supportClosedAt: 1 }))
    assert.equal(closed.label, 'Support Closed')
    assert.equal(closed.isOpen, false)
    assert.equal(closed.key, 'cancelled')
    assert.equal(lifecycle.resolveAssignmentLifecycle(row({ assignmentStatus: 'cancelled' })).label, 'Cancelled')
})

test('only HODs and admins may close', () => {
    assert.equal(canCloseSupport('operations'), true)
    assert.equal(canCloseSupport('coordinator'), false)
    assert.equal(canCloseSupport('incubatee'), false)
})
