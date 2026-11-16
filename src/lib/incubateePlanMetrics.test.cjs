const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const ts = require('typescript')
const Module = require('node:module')
const path = require('node:path')
const filename = path.join(__dirname, 'incubateePlanMetrics.ts')
const loaded = new Module(filename, module)
loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS }
}).outputText, filename)
const { canShowIncubateePlanMetrics: show } = loaded.exports
const accepted = { finalConfirmation: true, incubateeConfirmation: true }

test('staff finalisation does not reveal intervention counts before SME acceptance', () => {
    assert.equal(show({ finalConfirmation: true }, false, 0, 'sme', 'sme'), false)
    assert.equal(show({ finalConfirmation: true, incubateeConfirmation: false }, false, 3, 'sme', 'sme'), false)
    assert.equal(show(null, false, 0, 'sme', 'sme'), false)
})

test('counts appear only after the plan and SME confirmation are complete', () => {
    assert.equal(show(accepted, false, 0, 'sme', 'sme'), true)
    assert.equal(show({ incubateeConfirmation: true }, false, 0, 'sme', 'sme'), false)
    assert.equal(show(accepted, false, 3, 'sme', 'sme'), false)
})

test('loading and stale participant data cannot reveal intervention counts', () => {
    assert.equal(show(accepted, true, 0, 'sme', 'sme'), false)
    assert.equal(show(accepted, false, 0, 'previous', 'sme'), false)
    assert.equal(show(accepted, false, 0, '', ''), false)
})
