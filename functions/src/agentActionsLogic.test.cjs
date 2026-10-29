const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const Module = require('node:module')
const test = require('node:test')
const ts = require('typescript')

const sourcePath = join(__dirname, 'agentActionsLogic.ts')
const mod = new Module(sourcePath, module)
mod._compile(ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText, sourcePath)
const L = mod.exports

test('cleanIdList dedupes, trims, drops path-like ids and caps the list', () => {
    assert.deepEqual(L.cleanIdList([' a ', 'a', 'b', '', 'users/x', null]), ['a', 'b'])
    assert.deepEqual(L.cleanIdList('solo'), ['solo'])
    assert.deepEqual(L.cleanIdList(undefined), [])
    assert.equal(L.cleanIdList(Array.from({ length: 80 }, (_, i) => `p${i}`)).length, L.MAX_RECIPIENTS)
})

test('validDate accepts real calendar dates only', () => {
    assert.equal(L.validDate('2026-11-02'), '2026-11-02')
    assert.equal(L.validDate('2026-02-30'), null)
    assert.equal(L.validDate('2 Nov 2026'), null)
})

test('only managers and coordinators can act, and SMEs never can', () => {
    for (const groups of Object.values(L.KIND_ROLE_GROUPS)) {
        assert.ok(!groups.includes('external'))
        assert.ok(!groups.includes('unknown'))
    }
    assert.ok(!L.KIND_ROLE_GROUPS.assign_intervention.includes('director'))
    assert.ok(L.KIND_ROLE_GROUPS.send_compliance_reminder.includes('coordinator'))
})

test('shortText collapses whitespace and truncates', () => {
    assert.equal(L.shortText('  a\n\n b  ', 10), 'a b')
    assert.equal(L.shortText('abcdef', 3), 'abc')
})
