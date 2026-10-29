const assert = require('node:assert/strict')
const test = require('node:test')
const { planTrainingAttendees } = require('./training-attendees-plan.cjs')

const NOW = '2026-10-27T10:00:00.000Z'

const enrollment = (id, overrides = {}) => ({
    id,
    data: {
        trainingId: 't1',
        name: 'Thandi Mokoena',
        companyName: 'Mokoena Bakery',
        email: 'Thandi@Example.com',
        userId: `uid_${id}`,
        categories: ['Finance'],
        details: { idNumber: '9001010000080', phone: '0820000000' },
        documents: [
            { label: 'ID Copy', url: 'https://x/id.pdf', name: 'id.pdf' },
            { label: 'CIPC', url: 'https://x/cipc.pdf', name: 'cipc.pdf' },
        ],
        status: 'enrolled',
        ...overrides,
    },
})

const invitation = (id, smeId, overrides = {}) => ({
    id,
    data: { smeId, groupKey: 'training:t1:ps_1', interventionId: 'training_t1', ...overrides },
})

const smeUser = (participantId, overrides = {}) => ({ role: 'training_sme', participantId, trainingId: 't1', ...overrides })

const run = (input) => planTrainingAttendees({ users: {}, invitations: [], existingAttendeeIds: [], now: NOW, ...input })

test('creates the director record from the enrollment, with only their own ID document', () => {
    const plan = run({ enrollments: [enrollment('e1')], users: { uid_e1: smeUser('e1') } })
    assert.equal(plan.attendees.length, 1)
    const a = plan.attendees[0]
    assert.equal(a.id, 'e1_director')
    assert.equal(a.data.kind, 'director')
    assert.equal(a.data.enrollmentId, 'e1')
    assert.equal(a.data.email, 'thandi@example.com')
    assert.equal(a.data.idNumber, '9001010000080')
    assert.deepEqual(a.data.idDocument, { url: 'https://x/id.pdf', name: 'id.pdf' })
    assert.equal(a.data.userId, 'uid_e1')
    assert.equal(a.data.status, 'active')
    assert.equal('dataOrigin' in a.data, false)
})

test('a director attends only when they already have training invitations', () => {
    const plan = run({
        enrollments: [enrollment('e1'), enrollment('e2')],
        invitations: [invitation('inv1', 'e1')],
    })
    const byId = Object.fromEntries(plan.attendees.map((a) => [a.id, a.data]))
    assert.equal(byId.e1_director.attends, true)
    assert.equal(byId.e2_director.attends, false)
})

test('training invitations without an attendee are attributed to the director; others are left alone', () => {
    const plan = run({
        enrollments: [enrollment('e1')],
        invitations: [
            invitation('inv1', 'e1'),
            invitation('inv2', 'e1', { attendeeId: 'someone_else' }),
            invitation('inv3', 'e1', { groupKey: 'intervention:abc' }),
        ],
    })
    assert.deepEqual(plan.invitationPatches, [
        { id: 'inv1', enrollmentId: 'e1', patch: { attendeeId: 'e1_director', attendeeName: 'Thandi Mokoena', attendeeKind: 'director' } },
    ])
})

test('invitation patches touch only the attendee fields (no email trigger fields, no updatedAt)', () => {
    const plan = run({ enrollments: [enrollment('e1')], invitations: [invitation('inv1', 'e1')] })
    assert.deepEqual(Object.keys(plan.invitationPatches[0].patch).sort(), ['attendeeId', 'attendeeKind', 'attendeeName'])
})

test('the login gets trainingRole and trainingAttendeeId, plus trainingId when missing', () => {
    const plan = run({ enrollments: [enrollment('e1')], users: { uid_e1: smeUser('e1', { trainingId: '' }) } })
    assert.deepEqual(plan.userPatches, [
        { uid: 'uid_e1', enrollmentId: 'e1', patch: { trainingRole: 'director', trainingAttendeeId: 'e1_director', trainingId: 't1' } },
    ])
})

test('a login that is not a training SME, or belongs to another enrollment, is not patched', () => {
    const plan = run({
        enrollments: [enrollment('e1'), enrollment('e2'), enrollment('e3')],
        users: { uid_e1: { role: 'operations' }, uid_e2: smeUser('other') },
    })
    assert.equal(plan.userPatches.length, 0)
    assert.equal(plan.warnings.length, 3)
})

test('re-running plans nothing once everything is in place', () => {
    const plan = run({
        enrollments: [enrollment('e1')],
        users: { uid_e1: smeUser('e1', { trainingRole: 'director', trainingAttendeeId: 'e1_director' }) },
        invitations: [invitation('inv1', 'e1', { attendeeId: 'e1_director' })],
        existingAttendeeIds: ['e1_director'],
    })
    assert.equal(plan.attendees.length, 0)
    assert.equal(plan.userPatches.length, 0)
    assert.equal(plan.invitationPatches.length, 0)
    assert.equal(plan.skipped.attendeesPresent, 1)
})

test('synthetic enrollments keep their mark so nothing about them notifies anyone', () => {
    const plan = run({ enrollments: [enrollment('dtseed_e9'), enrollment('e2', { dataOrigin: 'synthetic' })] })
    plan.attendees.forEach((a) => {
        assert.equal(a.data.dataOrigin, 'synthetic')
        assert.equal(a.data.suppressNotifications, true)
    })
})

test('older records use the fixed ID slot; missing email and orphan invitations are warned about', () => {
    const plan = run({
        enrollments: [enrollment('e1', { documents: undefined, idDocument: { url: 'https://x/old.pdf', name: 'old.pdf' }, email: '', userId: '' })],
        invitations: [invitation('inv9', 'not_an_enrollment')],
    })
    assert.deepEqual(plan.attendees[0].data.idDocument, { url: 'https://x/old.pdf', name: 'old.pdf' })
    assert.equal('userId' in plan.attendees[0].data, false)
    assert.equal(plan.warnings.length, 2)
    assert.match(plan.warnings.join('\n'), /no email/)
    assert.match(plan.warnings.join('\n'), /not_an_enrollment/)
})
