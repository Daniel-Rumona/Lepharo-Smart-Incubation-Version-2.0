const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const Module = require('node:module')
const test = require('node:test')
const ts = require('typescript')

const sourcePath = join(__dirname, 'phoneLoginLogic.ts')
const mod = new Module(sourcePath, module)
mod.paths = Module._nodeModulePaths(__dirname)
mod._compile(ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText, sourcePath)
const L = mod.exports

const NOW = 1_800_000_000_000
const MIN = 60 * 1000

test('South African numbers in every common shape become 27 + 9 digits', () => {
    for (const input of ['082 123 4567', '0821234567', '+27 82 123 4567', '27821234567', '+27 (0)82-123-4567', '0027821234567']) {
        assert.equal(L.normalizeLoginPhone(input), '27821234567', input)
    }
})

test('other countries need their country code; junk is refused', () => {
    assert.equal(L.normalizeLoginPhone('+263 77 123 4567'), '263771234567')
    assert.equal(L.normalizeLoginPhone('263771234567'), '263771234567')
    for (const input of ['', null, '12345', '082123456', '+27 82 123 45678', 'not a number']) {
        assert.equal(L.normalizeLoginPhone(input), null, String(input))
    }
})

test('codes are six digits and only their salted hash is compared', () => {
    for (let i = 0; i < 50; i++) assert.match(L.newLoginCode(), /^\d{6}$/)
    const hash = L.hashLoginCode('012345', 's1')
    assert.equal(hash, L.hashLoginCode('012345', 's1'))
    assert.notEqual(hash, L.hashLoginCode('012345', 's2'))
    assert.notEqual(hash, '012345')
})

test('sending: a minute between codes, five per number and twenty per IP an hour', () => {
    assert.deepEqual(L.decideCodeSend({ now: NOW }), { ok: true })
    const cooldown = L.decideCodeSend({ now: NOW, numberSends: [NOW - 20 * 1000] })
    assert.equal(cooldown.reason, 'cooldown')
    assert.equal(cooldown.retryAfterMs, 40 * 1000)
    const five = [50, 40, 30, 20, 10].map(m => NOW - m * MIN)
    assert.equal(L.decideCodeSend({ now: NOW, numberSends: five }).reason, 'number_limit')
    assert.equal(L.decideCodeSend({ now: NOW, numberSends: five.map(t => t - 60 * MIN) }).ok, true, 'older than an hour no longer counts')
    const twenty = Array.from({ length: 20 }, (_, i) => NOW - (i + 2) * MIN)
    assert.equal(L.decideCodeSend({ now: NOW, ipSends: twenty }).reason, 'ip_limit')
})

const stored = (extra = {}) => ({ codeHash: L.hashLoginCode('123456', 'salt'), salt: 'salt', purpose: 'login', expiresAt: NOW + MIN, attempts: 0, ...extra })

test('the right code within five minutes and five tries signs in', () => {
    assert.deepEqual(L.decideCodeCheck({ now: NOW, stored: stored(), code: '123456', purpose: 'login' }), { ok: true })
    assert.deepEqual(L.decideCodeCheck({ now: NOW, stored: stored(), code: ' 123456 ', purpose: 'login' }), { ok: true })
})

test('wrong, expired, exhausted, missing or mismatched codes are refused', () => {
    const check = (s, code = '123456', purpose = 'login', uid) => L.decideCodeCheck({ now: NOW, stored: s, code, purpose, uid })
    assert.deepEqual(check(stored(), '654321'), { ok: false, reason: 'wrong_code', burnsAttempt: true })
    assert.equal(check(stored(), 'abc').reason, 'wrong_code')
    assert.equal(check(stored({ expiresAt: NOW - 1 })).reason, 'expired')
    assert.equal(check(stored({ attempts: 5 })).reason, 'too_many_attempts')
    assert.equal(check(null).reason, 'no_code')
    assert.equal(check(stored(), '123456', 'register').reason, 'wrong_purpose')
    assert.equal(check(stored({ purpose: 'change', uid: 'u1' }), '123456', 'change', 'u2').reason, 'wrong_purpose')
    assert.deepEqual(check(stored({ purpose: 'change', uid: 'u1' }), '123456', 'change', 'u1'), { ok: true })
})
