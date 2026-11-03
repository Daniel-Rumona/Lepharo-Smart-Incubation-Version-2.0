const assert = require('node:assert/strict')
const test = require('node:test')
const { planSmeIdentity, planRequestOwners } = require('./sme-identity-plan.cjs')

const user = (uid, data = {}) => ({ uid, data: { role: 'incubatee', email: `${uid}@example.com`, ...data } })
const participant = (id, data = {}) => ({ id, data: { ...data } })

test('links a login to the one participant with its email, both ways', () => {
    const { outcomes } = planSmeIdentity({
        users: [user('u1', { email: 'Thandi@Example.com ' })],
        participants: [participant('p1', { email: 'thandi@example.com' })],
    })
    assert.deepEqual(outcomes.toLink, [
        { uid: 'u1', participantId: 'p1', source: 'email', userPatch: { participantId: 'p1' }, participantPatch: { uid: 'u1' } },
    ])
})

test('prefers the auth email over the users doc email and flags the difference', () => {
    const { outcomes, emailMismatches } = planSmeIdentity({
        users: [user('u1', { email: 'old@example.com' })],
        participants: [participant('p1', { email: 'new@example.com' }), participant('p2', { email: 'old@example.com' })],
        authEmails: new Map([['u1', 'New@Example.com']]),
    })
    assert.equal(outcomes.toLink[0].participantId, 'p1')
    assert.deepEqual(emailMismatches, [{ uid: 'u1' }])
})

test('only incubatee logins are considered', () => {
    const { smeUserCount, outcomes } = planSmeIdentity({
        users: [user('staff', { role: 'coordinator' }), user('trainee', { role: 'training_sme' })],
        participants: [participant('p1', { email: 'staff@example.com' })],
    })
    assert.equal(smeUserCount, 0)
    assert.equal(outcomes.toLink.length, 0)
})

test('an existing users.participantId only fills the missing participants.uid', () => {
    const { outcomes } = planSmeIdentity({
        users: [user('u1', { participantId: 'p9', email: 'other@example.com' })],
        participants: [participant('p9', {})],
    })
    assert.deepEqual(outcomes.toLink, [
        { uid: 'u1', participantId: 'p9', source: 'usersParticipantId', userPatch: null, participantPatch: { uid: 'u1' } },
    ])
})

test('a participant already carrying the uid wins over email', () => {
    const { outcomes } = planSmeIdentity({
        users: [user('u1')],
        participants: [participant('p1', { email: 'u1@example.com' }), participant('p2', { uid: 'u1' })],
    })
    assert.deepEqual(outcomes.toLink, [
        { uid: 'u1', participantId: 'p2', source: 'participantUid', userPatch: { participantId: 'p2' }, participantPatch: null },
    ])
})

test('fully linked logins plan nothing (re-run is a no-op)', () => {
    const { outcomes } = planSmeIdentity({
        users: [user('u1', { participantId: 'p1' })],
        participants: [participant('p1', { uid: 'u1', email: 'u1@example.com' })],
    })
    assert.equal(outcomes.toLink.length, 0)
    assert.deepEqual(outcomes.alreadyLinked, [{ uid: 'u1', participantId: 'p1' }])
})

test('several participants with the same email are reported, not guessed', () => {
    const { outcomes } = planSmeIdentity({
        users: [user('u1')],
        participants: [participant('p1', { email: 'u1@example.com' }), participant('p2', { email: 'U1@example.com' })],
    })
    assert.equal(outcomes.toLink.length, 0)
    assert.deepEqual(outcomes.ambiguous, [{ uid: 'u1', participantIds: ['p1', 'p2'], source: 'email' }])
})

test('no matching participant and no email are reported', () => {
    const { outcomes } = planSmeIdentity({
        users: [user('u1'), user('u2', { email: '' })],
        participants: [],
    })
    assert.deepEqual(outcomes.noParticipant, [{ uid: 'u1' }])
    assert.deepEqual(outcomes.noEmail, [{ uid: 'u2' }])
})

test('a participant linked to another login is left alone', () => {
    const { outcomes } = planSmeIdentity({
        users: [user('u1')],
        participants: [participant('p1', { email: 'u1@example.com', uid: 'u7' })],
    })
    assert.equal(outcomes.toLink.length, 0)
    assert.deepEqual(outcomes.participantLinkedToOtherUser, [{ uid: 'u1', participantId: 'p1', otherUid: 'u7' }])
})

test('two logins claiming one participant are both left alone', () => {
    const { outcomes } = planSmeIdentity({
        users: [user('u1', { email: 'same@example.com' }), user('u2', { email: 'SAME@example.com' })],
        participants: [participant('p1', { email: 'same@example.com' })],
    })
    assert.equal(outcomes.toLink.length, 0)
    assert.deepEqual(outcomes.participantClaimedByMultipleUsers, [{ participantId: 'p1', uids: ['u1', 'u2'] }])
})

test('users.participantId pointing at a missing participant is reported', () => {
    const { outcomes } = planSmeIdentity({
        users: [user('u1', { participantId: 'gone' })],
        participants: [participant('p1', { email: 'u1@example.com' })],
    })
    assert.equal(outcomes.toLink.length, 0)
    assert.deepEqual(outcomes.linkedToMissingParticipant, [{ uid: 'u1', participantId: 'gone' }])
})

test('resource requests get the one SME login with their email, and nothing is guessed', () => {
    const users = [user('u1', { email: 'A@x.com' }), user('u2', { email: 'dup@x.com' }), user('u3', { email: 'dup@x.com' }), user('staff', { role: 'coordinator', email: 's@x.com' })]
    const requests = [
        { id: 'r1', data: { requestedByEmail: 'a@x.com' } },
        { id: 'r2', data: { requestedByEmail: 'a@x.com', requestedByUid: 'u9' } },
        { id: 'r3', data: { requestedByEmail: 'dup@x.com' } },
        { id: 'r4', data: { requestedByEmail: 's@x.com' } },
        { id: 'r5', data: {} },
    ]
    const { patches, unmatched } = planRequestOwners({ requests, users })
    assert.deepEqual(patches, [{ id: 'r1', patch: { requestedByUid: 'u1' } }])
    assert.equal(unmatched, 3)
})
