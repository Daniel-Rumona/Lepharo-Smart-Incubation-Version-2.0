const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

function load(relative) {
    const filename = path.join(__dirname, relative)
    const loaded = new Module(filename, module)
    loaded.paths = module.paths
    loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }
    }).outputText, filename)
    return loaded.exports
}
const {
    getDepartmentRole,
    departmentHasRole,
    departmentIdForRole,
    departmentNameOf,
    normalizeDepartmentRoles
} = load('departmentRoleLogic.ts')

const departments = [
    { id: 'rom', name: 'ROM (Recruitment, Onboarding and Maintenance)' },
    { id: 'rom-sub', name: 'Onboarding Desk', parentDepartmentId: 'rom' },
    { id: 'rom-sub-sub', name: 'Night Desk', parentDeptId: 'rom-sub' },
    { id: 'me', name: 'Renamed Oversight Unit' },
    { id: 'me-own', name: 'Training under M&E', parentDepartmentId: 'me' },
    { id: 'plain', name: 'Something Else' }
]
const roles = { rom: 'rom', monitoring: 'me', training: 'me-own' }

test('a department resolves to the role assigned to its id, whatever its name', () => {
    assert.equal(getDepartmentRole('rom', roles, departments), 'rom')
    assert.equal(getDepartmentRole('me', roles, departments), 'monitoring')
})

test('sub-departments inherit their nearest ancestor role', () => {
    assert.equal(getDepartmentRole('rom-sub', roles, departments), 'rom')
    assert.equal(getDepartmentRole('rom-sub-sub', roles, departments), 'rom')
    assert.ok(departmentHasRole('rom-sub-sub', 'rom', roles, departments))
})

test('a sub-department with its own role keeps it', () => {
    assert.equal(getDepartmentRole('me-own', roles, departments), 'training')
    assert.ok(departmentHasRole('me-own', 'monitoring', roles, departments))
})

test('departments without a role resolve to null', () => {
    assert.equal(getDepartmentRole('plain', roles, departments), null)
    assert.equal(getDepartmentRole('', roles, departments), null)
    assert.equal(getDepartmentRole('missing', roles, departments), null)
    assert.equal(departmentHasRole('plain', 'hr', roles, departments), false)
})

test('a parent cycle does not loop forever', () => {
    const cyclic = [{ id: 'a', parentDepartmentId: 'b' }, { id: 'b', parentDepartmentId: 'a' }]
    assert.equal(getDepartmentRole('a', { hr: 'b' }, cyclic), 'hr')
    assert.equal(getDepartmentRole('a', {}, cyclic), null)
})

test('names, ids and settings normalisation', () => {
    assert.equal(departmentNameOf('me', departments), 'Renamed Oversight Unit')
    assert.equal(departmentNameOf('missing', departments), 'Unassigned')
    assert.equal(departmentNameOf('', departments, '-'), '-')
    assert.equal(departmentIdForRole('rom', roles), 'rom')
    assert.equal(departmentIdForRole('hr', roles), null)
    assert.deepEqual(
        normalizeDepartmentRoles({ rom: ' rom ', hr: '', unknown: 'x', updatedAt: 1 }),
        { rom: 'rom' }
    )
})
