const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const Module = require('node:module')
const test = require('node:test')
const ts = require('typescript')

const sourcePath = join(__dirname, 'welcomeSteps.ts')
const mod = new Module(sourcePath, module)
mod._compile(ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText, sourcePath)
const { mustChangePasswordFor, welcomeStepKeys, pendingWelcomeSteps, needsWelcomeSetup } = mod.exports

test('an explicit flag wins; with none, staff must change and SMEs need not', () => {
    assert.equal(mustChangePasswordFor(true, 'incubatee'), true)
    assert.equal(mustChangePasswordFor(false, 'operations'), false)
    assert.equal(mustChangePasswordFor(undefined, 'operations'), true)
    assert.equal(mustChangePasswordFor(undefined, 'director'), true)
    assert.equal(mustChangePasswordFor(undefined, 'incubatee'), false)
    assert.equal(mustChangePasswordFor(null, 'incubatee'), false)
})

test('a default password shows ONLY the password step, for every role', () => {
    for (const role of ['incubatee', 'director', 'operations', 'consultant', 'system_admin']) {
        assert.deepEqual(welcomeStepKeys({ role, passwordOnly: true, mustRegisterCompany: true }), ['password'])
    }
})

test('without a default password the normal steps run, never including the password step', () => {
    assert.deepEqual(welcomeStepKeys({ role: 'incubatee', passwordOnly: false, mustRegisterCompany: true }),
        ['welcome', 'signature', 'popia', 'whatsapp'])
    assert.deepEqual(welcomeStepKeys({ role: 'operations', passwordOnly: false, mustRegisterCompany: true }),
        ['welcome', 'signature', 'popia'])
    assert.deepEqual(welcomeStepKeys({ role: 'director', passwordOnly: false, mustRegisterCompany: true }),
        ['welcome', 'directorProfile', 'signature', 'popia'])
    assert.deepEqual(welcomeStepKeys({ role: 'director', passwordOnly: false, mustRegisterCompany: false }),
        ['welcome', 'signature', 'popia'])
})

test('every role signs POPIA, after the signature it is signed with', () => {
    for (const role of ['incubatee', 'director', 'operations', 'consultant', 'system_admin']) {
        const keys = welcomeStepKeys({ role, passwordOnly: false, mustRegisterCompany: true })
        assert.ok(keys.includes('popia'), role)
        assert.ok(keys.indexOf('signature') < keys.indexOf('popia'), role)
    }
})

test('a visit asks only for what is missing, behind the welcome screen', () => {
    const keys = welcomeStepKeys({ role: 'incubatee', passwordOnly: false, mustRegisterCompany: true })
    assert.deepEqual(pendingWelcomeSteps(keys, {}, true), ['welcome', 'signature', 'popia', 'whatsapp'])
    assert.deepEqual(pendingWelcomeSteps(keys, { popia: true, whatsapp: true }, false), ['welcome', 'signature'])
    assert.deepEqual(pendingWelcomeSteps(keys, { signature: true }, true), ['welcome', 'popia', 'whatsapp'])
    assert.deepEqual(pendingWelcomeSteps(keys, { signature: true, popia: true, whatsapp: true }, true), [])
})

test('WhatsApp is only asked on a first visit', () => {
    const keys = welcomeStepKeys({ role: 'incubatee', passwordOnly: false, mustRegisterCompany: true })
    assert.deepEqual(pendingWelcomeSteps(keys, { signature: true, popia: true }, false), [])
    assert.deepEqual(pendingWelcomeSteps(keys, { signature: true }, false), ['welcome', 'popia'])
})

test('a password-only visit has no welcome screen', () => {
    assert.deepEqual(pendingWelcomeSteps(['password'], {}, false), ['password'])
})

test('signing in goes through setup until password, signature and POPIA are all in place', () => {
    const ready = { role: 'operations', firstLoginDone: true, mustChangePassword: false, hasSignature: true, popiaSigned: true }
    assert.equal(needsWelcomeSetup(ready), false)
    assert.equal(needsWelcomeSetup({ ...ready, hasSignature: false }), true)
    assert.equal(needsWelcomeSetup({ ...ready, popiaSigned: false }), true)
    assert.equal(needsWelcomeSetup({ ...ready, mustChangePassword: true }), true)
    assert.equal(needsWelcomeSetup({ ...ready, firstLoginDone: false }), false)
    assert.equal(needsWelcomeSetup({ ...ready, role: 'incubatee', firstLoginDone: false }), true)
})
