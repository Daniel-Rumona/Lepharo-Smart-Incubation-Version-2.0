const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const Module = require('node:module')
const test = require('node:test')
const ts = require('typescript')

const sourcePath = join(__dirname, 'smeIdentityLogic.ts')
const mod = new Module(sourcePath, module)
mod._compile(ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText, sourcePath)
const { decideSmeLink, pickOwnParticipant } = mod.exports

const sme = (extra = {}) => ({ role: 'incubatee', ...extra })

test('links both sides when neither is set', () => {
    assert.deepEqual(decideSmeLink({ uid: 'u1', user: sme(), participantId: 'p1', participant: {} }), {
        ok: true, userPatch: { participantId: 'p1' }, participantPatch: { uid: 'u1' },
    })
})

test('fills only the missing side, and nothing when already linked', () => {
    assert.deepEqual(decideSmeLink({ uid: 'u1', user: sme({ participantId: 'p1' }), participantId: 'p1', participant: {} }), {
        ok: true, userPatch: null, participantPatch: { uid: 'u1' },
    })
    assert.deepEqual(decideSmeLink({ uid: 'u1', user: sme({ participantId: 'p1' }), participantId: 'p1', participant: { uid: 'u1' } }), {
        ok: true, userPatch: null, participantPatch: null,
    })
})

test('refuses staff, missing participants and links pointing elsewhere', () => {
    const refuse = (input) => decideSmeLink({ uid: 'u1', participantId: 'p1', user: sme(), participant: {}, ...input }).reason
    assert.equal(refuse({ user: { role: 'coordinator' } }), 'not_sme')
    assert.equal(refuse({ user: { role: 'training_sme' } }), 'not_sme')
    assert.equal(refuse({ user: null }), 'not_sme')
    assert.equal(refuse({ participant: null }), 'participant_missing')
    assert.equal(refuse({ user: sme({ participantId: 'p2' }) }), 'user_linked_elsewhere')
    assert.equal(refuse({ participant: { uid: 'u2' } }), 'participant_linked_elsewhere')
    assert.equal(refuse({ otherClaimantUids: ['u2'] }), 'participant_claimed')
    assert.equal(refuse({ otherClaimantUids: ['u1'] }), undefined)
})

test('picks the participant carrying the uid before one matching the email', () => {
    const candidates = [{ id: 'p1', data: { email: 'a@x.com' } }, { id: 'p2', data: { uid: 'u1' } }]
    assert.equal(pickOwnParticipant({ uid: 'u1', email: 'a@x.com', candidates }), 'p2')
})

test('picks the one participant with the email, case-insensitively', () => {
    const candidates = [{ id: 'p1', data: { email: ' A@X.com' } }, { id: 'p1', data: { email: ' A@X.com' } }]
    assert.equal(pickOwnParticipant({ uid: 'u1', email: 'a@x.com', candidates }), 'p1')
})

test('picks nothing when several match or there is no email', () => {
    const candidates = [{ id: 'p1', data: { email: 'a@x.com' } }, { id: 'p2', data: { email: 'A@x.com' } }]
    assert.equal(pickOwnParticipant({ uid: 'u1', email: 'a@x.com', candidates }), null)
    assert.equal(pickOwnParticipant({ uid: 'u1', email: '', candidates }), null)
})
