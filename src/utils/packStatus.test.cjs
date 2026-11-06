const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const Module = require('node:module')
const test = require('node:test')
const ts = require('typescript')

const sourcePath = join(__dirname, 'packStatus.ts')
const compiled = ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText
const mod = new Module(sourcePath)
mod.filename = sourcePath
mod.paths = Module._nodeModulePaths(__dirname)
mod._compile(compiled, sourcePath)
const { PACK_STATUS, normalizePackStatus, packStatusLabel } = mod.exports

test('the old pack statuses read as the new ones', () => {
    assert.equal(normalizePackStatus('submitted_to_me'), PACK_STATUS.AWAITING_CC)
    assert.equal(normalizePackStatus('confirmed'), PACK_STATUS.AWAITING_ME)
})

test('current and later statuses are unchanged, whatever the case or spacing', () => {
    assert.equal(normalizePackStatus('awaiting_cc'), 'awaiting_cc')
    assert.equal(normalizePackStatus(' Awaiting_ME '), 'awaiting_me')
    assert.equal(normalizePackStatus('validated'), 'validated')
    assert.equal(normalizePackStatus('invoice_redeemable'), 'invoice_redeemable')
})

test('empty and unknown values do not throw', () => {
    assert.equal(normalizePackStatus(undefined), '')
    assert.equal(normalizePackStatus(null), '')
    assert.equal(normalizePackStatus('something_else'), 'something_else')
    assert.equal(packStatusLabel(undefined), '—')
})

test('labels name who is next', () => {
    assert.equal(packStatusLabel('submitted_to_me'), 'Awaiting Center Coordinator')
    assert.equal(packStatusLabel('confirmed'), 'Awaiting M&E validation')
})
