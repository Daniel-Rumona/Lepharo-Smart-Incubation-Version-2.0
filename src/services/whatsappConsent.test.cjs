const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const Module = require('node:module')
const test = require('node:test')
const ts = require('typescript')

const sourcePath = join(__dirname, 'whatsappConsent.ts')
const mod = new Module(sourcePath, module)
mod._compile(ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText, sourcePath)
const { normalizeWhatsAppNumber, needsWhatsAppPrompt, buildConsent, consentedNumber } = mod.exports

test('numbers are normalised to +country digits; a leading 0 means South Africa', () => {
    assert.equal(normalizeWhatsAppNumber('082 123 4567'), '+27821234567')
    assert.equal(normalizeWhatsAppNumber('+27 82 123 4567'), '+27821234567')
    assert.equal(normalizeWhatsAppNumber('0027821234567'), '+27821234567')
    assert.equal(normalizeWhatsAppNumber('+263 77 123 4567'), '+263771234567')
    assert.equal(normalizeWhatsAppNumber('12345'), null)
    assert.equal(normalizeWhatsAppNumber(''), null)
})

test('SMEs who were never asked are prompted; answered ones are not', () => {
    assert.equal(needsWhatsAppPrompt({}), true)
    assert.equal(needsWhatsAppPrompt(null), true)
    assert.equal(needsWhatsAppPrompt({ whatsappConsent: { status: 'declined', answeredAt: 1, version: 1 } }), false)
    assert.equal(needsWhatsAppPrompt({ whatsappConsent: { status: 'granted', answeredAt: 1, version: 1, number: '+27821234567' } }), false)
    assert.equal(needsWhatsAppPrompt({ whatsappConsent: { status: 'granted', answeredAt: 1, version: 0 } }), true)
})

test('granting needs a valid number; declining needs none', () => {
    assert.match(buildConsent({ status: 'granted', number: 'abc', source: 'welcome', now: 1 }).error, /valid/i)
    const yes = buildConsent({ status: 'granted', number: '0821234567', source: 'welcome', now: 1 })
    assert.equal(yes.consent.number, '+27821234567')
    const no = buildConsent({ status: 'declined', source: 'login-prompt', now: 1 })
    assert.equal(no.consent.status, 'declined')
    assert.equal(no.consent.number, undefined)
})

test('only a granted consent yields a number to send to', () => {
    assert.equal(consentedNumber({ whatsappConsent: { status: 'granted', number: '+27821234567' } }), '+27821234567')
    assert.equal(consentedNumber({ whatsappConsent: { status: 'declined', number: '+27821234567' } }), null)
    assert.equal(consentedNumber({}), null)
})
