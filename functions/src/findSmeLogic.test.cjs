const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const Module = require('node:module')
const test = require('node:test')
const ts = require('typescript')

const sourcePath = join(__dirname, 'findSmeLogic.ts')
const mod = new Module(sourcePath, module)
mod._compile(ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText, sourcePath)
const { findScope, smesWithConfirmedPlans, smesWithOpenWork, confirmedDeptIds } = mod.exports

test('the search scope follows the real role, not the WhatsApp menu group', () => {
    assert.equal(findScope({ role: 'coordinator', roleGroup: 'coordinator' }), 'own_work')
    assert.equal(findScope({ role: 'projectadmin', roleGroup: 'coordinator' }), 'programmes', 'centre coordinators oversee their programmes')
    assert.equal(findScope({ role: 'operations', roleGroup: 'hod', departmentId: 'legal' }), 'department_plans')
    assert.equal(findScope({ role: 'operations', roleGroup: 'hod' }), 'programmes', 'a HOD without a department')
    assert.equal(findScope({ role: 'employee', roleGroup: 'employee' }), 'programmes')
})

test('a department counts as confirmed in either confirmation map', () => {
    assert.deepEqual([...confirmedDeptIds({ smmeConfirmedByDeptId: { legal: true, hr: false }, incubateeDepartmentConfirmationsByDeptId: { fin: { confirmed: true }, ops: { confirmed: false } } })].sort(), ['fin', 'legal'])
})

test('a HOD finds SMEs whose plan both the department and the SME signed off', () => {
    const plans = [
        { id: 'plan-a', data: { participantId: 'a', confirmedByDeptId: { legal: true }, smmeConfirmedByDeptId: { legal: true } } },
        { id: 'b', data: { confirmedByDeptId: { legal: { confirmed: true } }, incubateeDepartmentConfirmationsByDeptId: { legal: { confirmed: true } } } },
        { id: 'plan-c', data: { participantId: 'c', confirmedByDeptId: { legal: true }, smmeConfirmedByDeptId: { finance: true, legal: false } } },
        { id: 'plan-d', data: { participantId: 'd', smmeConfirmedByDeptId: { legal: true } } },
    ]
    assert.deepEqual([...smesWithConfirmedPlans(plans, 'legal')].sort(), ['a', 'b'], "c lacks the SME's sign-off, d the department's")
})

test('a coordinator finds SMEs they have open interventions with', () => {
    const rows = [
        { participantId: 'a', assignmentStatus: 'in-progress' },
        { participantId: 'b', assignmentStatus: 'completed' },
        { participantId: 'c', assignmentStatus: 'Cancelled' },
        { participantId: 'd' },
    ]
    assert.deepEqual([...smesWithOpenWork(rows)].sort(), ['a', 'd'])
})
