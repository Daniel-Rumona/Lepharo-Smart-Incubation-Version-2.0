const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const Module = require('node:module')
const test = require('node:test')
const ts = require('typescript')

const load = (file, requires = {}) => {
    const sourcePath = join(__dirname, file)
    const mod = new Module(sourcePath, module)
    mod.require = (name) => (name in requires ? requires[name] : require(name))
    mod._compile(ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
    }).outputText, sourcePath)
    return mod.exports
}
const { splitMovRequirement, missingMovAssignmentIds } = load('completionMovRules.ts', {
    './assignmentLifecycleService': load('assignmentLifecycleService.ts')
})

test('a single delivery always needs its MOV', () => {
    const { required, notRequired } = splitMovRequirement([{ id: 'a' }])
    assert.deepEqual(required.map(r => r.id), ['a'])
    assert.equal(notRequired.length, 0)
})

test('in a group only SMEs with recorded attendance need a MOV', () => {
    const attended = { id: 'x', groupKey: 'g', sessionAttendanceByAppointment: { s1: { outcome: 'attended', held: true } } }
    const absent = { id: 'y', groupKey: 'g', sessionAttendanceByAppointment: { s1: { outcome: 'absent', held: true } } }
    const unknown = { id: 'z', groupKey: 'g' }
    const { required, notRequired } = splitMovRequirement([attended, absent, unknown])
    assert.deepEqual(required.map(r => r.id), ['x'])
    assert.deepEqual(notRequired.map(r => r.id), ['y', 'z'])
})

test('missing MOVs are those required with no file', () => {
    assert.deepEqual(missingMovAssignmentIds([{ id: 'a' }, { id: 'b' }], { a: { name: 'f.pdf' } }), ['b'])
    assert.deepEqual(missingMovAssignmentIds([{ id: 'a' }], { a: {} }), [])
})
