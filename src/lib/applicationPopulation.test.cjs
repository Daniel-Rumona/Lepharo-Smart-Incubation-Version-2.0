const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const Module = require('node:module')
const test = require('node:test')
const ts = require('typescript')
const sourcePath = join(__dirname, 'applicationPopulation.ts')
const mod = new Module(sourcePath, module)
mod._compile(ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText, sourcePath)
const { applicationDecisionStatus, applicationProgramId, isAcceptedApplication } = mod.exports

test('current decisions override stale acceptance evidence', () => {
    for (const status of ['withdrawn', 'rejected', 'pending']) {
        assert.equal(isAcceptedApplication({ applicationStatus: status, status: 'accepted', acceptedAt: 123 }), false)
    }
    assert.equal(isAcceptedApplication({ applicationStatus: ' Accepted ' }), true)
})
test('legacy acceptance is used only without a current status', () => {
    for (const app of [{ status: 'accepted' }, { decision: { status: 'accepted' } }, { acceptedAt: 123 }]) {
        assert.equal(isAcceptedApplication(app), true)
    }
    assert.equal(applicationDecisionStatus({}), 'pending')
})
test('withdrawals do not subtract from unrelated accepted applications', () => {
    const apps = [{ applicationStatus: 'accepted' }, { applicationStatus: 'accepted' }, { applicationStatus: 'withdrawn', acceptedAt: 123 }]
    assert.equal(apps.filter(isAcceptedApplication).length, 2)
})
test('legacy programme fields resolve to the same scope', () => {
    for (const app of [{ programId: ' p ' }, { programID: 'p' }, { program: { id: 'p' } }, { program: 'p' }]) {
        assert.equal(applicationProgramId(app), 'p')
    }
    assert.equal(applicationProgramId({}), '')
})
