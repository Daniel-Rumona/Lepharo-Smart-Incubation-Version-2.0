const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const Module = require('node:module')
const test = require('node:test')
const ts = require('typescript')

// Run the actual TypeScript service with Node's built-in test runner.
const sourcePath = join(__dirname, 'assignmentLifecycleService.ts')
const serviceModule = new Module(sourcePath, module)
serviceModule._compile(ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText, sourcePath)
const {
    resolveAssignmentLifecycle,
    buildParticipantLifecycleTransition,
    assignmentReminderReason
} = serviceModule.exports

const assignment = (patch = {}) => ({
    participantId: 'sme-1',
    assignmentStatus: 'in-progress',
    assigneeAcceptanceStatus: 'accepted',
    appointmentResponseStatus: 'pending',
    participantAcceptanceStatus: 'pending',
    assigneeCompletionStatus: 'pending',
    participantCompletionStatus: 'pending',
    computedProgress: 20,
    ...patch
})

const attendance = (outcome = 'attended', patch = {}) => ({
    'appointment-1': { outcome, ...patch }
})

test('recorded attendance clears the RSVP gate at 20% without claiming acceptance or completion', () => {
    const record = assignment({ sessionAttendanceByAppointment: attendance() })
    const before = JSON.stringify(record)
    const lifecycle = resolveAssignmentLifecycle(record)
    assert.equal(lifecycle.key, 'in-delivery')
    assert.equal(lifecycle.participantAcceptance, 'pending')
    assert.equal(lifecycle.participantCompletion, 'pending')
    assert.equal(assignmentReminderReason(record), null)
    assert.throws(() => buildParticipantLifecycleTransition('confirm-completion', record), /not awaiting SME completion/)
    assert.equal(JSON.stringify(record), before)
})

test('an attended SME can confirm or reject after facilitator completion without an RSVP', () => {
    const record = assignment({
        sessionAttendanceByAppointment: attendance(),
        assigneeCompletionStatus: 'completed',
        computedProgress: 100
    })
    assert.equal(resolveAssignmentLifecycle(record).key, 'awaiting-participant-confirmation')
    assert.equal(assignmentReminderReason(record), 'confirmation')
    const confirmed = buildParticipantLifecycleTransition('confirm-completion', record, {
        feedback: { rating: 4, comments: 'Delivered as agreed' }
    })
    assert.equal(confirmed.participantCompletionStatus, 'confirmed')
    assert.equal(confirmed.assignmentStatus, 'completed')
    assert.equal(confirmed.feedback.rating, 4)
    assert.equal(resolveAssignmentLifecycle({ ...record, ...confirmed }).key, 'completed')
    const rejected = buildParticipantLifecycleTransition('reject-completion', record, { reason: 'Work remains' })
    assert.equal(rejected.participantCompletionStatus, 'rejected')
    assert.equal(resolveAssignmentLifecycle({ ...record, ...rejected }).key, 'participant-rejected')
    assert.throws(() => buildParticipantLifecycleTransition('reject-completion', record), /rejection reason/)
    for (const patch of [confirmed, rejected]) {
        assert.equal(Object.hasOwn(patch, 'participantAcceptanceStatus'), false)
        assert.equal(Object.hasOwn(patch, 'appointmentResponseStatus'), false)
        assert.equal(Object.hasOwn(patch, 'participantAcceptedAt'), false)
    }
})

for (const [name, patch] of [
    ['no attendance', {}],
    ['no-show', { sessionAttendanceByAppointment: attendance('no_show') }],
    ['unverified', { sessionAttendanceByAppointment: attendance('unverified') }],
    ['meeting not held', { sessionAttendanceByAppointment: attendance('attended', { held: false }) }],
    ['percentage only', { computedProgress: 100, tracking: { sessionsLogged: 5 } }],
    ['shared group attendance only', { lastSessionCoverage: { held: true, smeAttendance: 'attended' } }]
]) {
    test(`${name} does not bypass a pending response before facilitator completion`, () => {
        const record = assignment({ ...patch, assigneeCompletionStatus: 'pending' })
        assert.equal(resolveAssignmentLifecycle(record).key, 'awaiting-participant-acceptance')
        assert.equal(assignmentReminderReason(record), 'acceptance')
        assert.throws(() => buildParticipantLifecycleTransition('confirm-completion', record), /not awaiting SME completion/)
    })
}

test('facilitator completion advances to SME confirmation without fabricating RSVP acceptance', () => {
    const record = assignment({
        assigneeCompletionStatus: 'completed',
        participantAcceptanceStatus: 'pending'
    })
    const lifecycle = resolveAssignmentLifecycle(record)
    assert.equal(lifecycle.key, 'awaiting-participant-confirmation')
    assert.equal(lifecycle.participantAcceptance, 'pending')
    assert.doesNotThrow(() => buildParticipantLifecycleTransition('confirm-completion', record))
})

test('group members use their own attendance, not shared delivery progress', () => {
    const common = { groupKey: 'group-1', computedProgress: 100, assigneeCompletionStatus: 'completed' }
    const present = assignment({ ...common, sessionAttendanceByAppointment: attendance() })
    const absent = assignment({ ...common, participantId: 'sme-2', sessionAttendanceByAppointment: attendance('no_show') })
    assert.equal(resolveAssignmentLifecycle(present).key, 'awaiting-participant-confirmation')
    assert.equal(resolveAssignmentLifecycle(absent).key, 'awaiting-participant-acceptance')
})

test('attendance corrections remove the bypass unless another attended session remains', () => {
    const record = assignment({ sessionAttendanceByAppointment: attendance() })
    assert.equal(resolveAssignmentLifecycle(record).key, 'in-delivery')
    record.sessionAttendanceByAppointment['appointment-1'].outcome = 'no_show'
    assert.equal(resolveAssignmentLifecycle(record).key, 'awaiting-participant-acceptance')
    record.sessionAttendanceByAppointment['appointment-2'] = { outcome: 'attended', held: true }
    assert.equal(resolveAssignmentLifecycle(record).key, 'in-delivery')
})

for (const [patch, expected] of [
    [{ appointmentResponseStatus: 'declined' }, 'participant-declined'],
    [{ assigneeAcceptanceStatus: 'declined' }, 'needs-reassignment'],
    [{ assignmentStatus: 'cancelled' }, 'cancelled'],
    [{ assignmentStatus: 'needs-reassignment' }, 'needs-reassignment'],
    [{ participantCompletionStatus: 'rejected' }, 'participant-rejected']
]) {
    test(`attendance does not override ${expected}`, () => {
        const record = assignment({ sessionAttendanceByAppointment: attendance(), ...patch })
        assert.equal(resolveAssignmentLifecycle(record).key, expected)
        assert.throws(() => buildParticipantLifecycleTransition('confirm-completion', record), /not awaiting SME completion/)
    })
}

test('existing explicit acceptance still permits the normal completion flow', () => {
    const pending = assignment({ computedProgress: 0 })
    const accepted = buildParticipantLifecycleTransition('accept-assignment', pending)
    const record = { ...pending, ...accepted, assigneeCompletionStatus: 'completed' }
    assert.equal(resolveAssignmentLifecycle(record).key, 'awaiting-participant-confirmation')
    assert.equal(buildParticipantLifecycleTransition('confirm-completion', record).participantCompletionStatus, 'confirmed')
})
