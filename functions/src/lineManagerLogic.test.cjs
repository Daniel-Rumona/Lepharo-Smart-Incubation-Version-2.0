const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const Module = require('node:module')
const test = require('node:test')
const ts = require('typescript')

const sourcePath = join(__dirname, 'lineManagerLogic.ts')
const mod = new Module(sourcePath, module)
mod._compile(ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText, sourcePath)
const { defaultLineManagerId, lineManagerPatches, normalizeStaffRole } = mod.exports

const staff = [
    { id: 'ceo', role: 'director' },
    { id: 'hodA', role: 'operations', departmentId: 'deptA' },
    { id: 'hodB', role: 'Head Of Department', departmentId: 'deptB' },
    { id: 'ccNorth', role: 'projectadmin', assignedBranch: 'north', departmentId: 'deptA' },
    { id: 'ccSouth', role: 'projectadmin', assignedBranch: 'south' },
    { id: 'coordA', role: 'coordinator', departmentId: 'deptA', assignedBranch: 'north' },
    { id: 'empNorth', role: 'employee', assignedBranch: 'north' },
    { id: 'recSouth', role: 'receptionist', assignedBranch: 'south' },
    { id: 'empNowhere', role: 'employee', assignedBranch: 'east' },
    { id: 'hrOfficer', role: 'hr', departmentId: 'deptB' },
    { id: 'sme', role: 'incubatee' },
]
const managerOf = (id, people = staff) => defaultLineManagerId(people.find(p => p.id === id), people)

test('role spellings normalise', () => {
    assert.equal(normalizeStaffRole('Head Of Department'), 'operations')
    assert.equal(normalizeStaffRole('center_coordinator'), 'projectadmin')
    assert.equal(normalizeStaffRole('incubatee'), '')
})

test('HoD reports to the CEO', () => {
    assert.equal(managerOf('hodA'), 'ceo')
    assert.equal(managerOf('hodB'), 'ceo')
})

test('coordinators and HR report to their department HoD', () => {
    assert.equal(managerOf('coordA'), 'hodA')
    assert.equal(managerOf('hrOfficer'), 'hodB')
})

test('employees and receptionists report to their branch centre coordinator', () => {
    assert.equal(managerOf('empNorth'), 'ccNorth')
    assert.equal(managerOf('recSouth'), 'ccSouth')
})

test('centre coordinators report to their HoD, else the CEO', () => {
    assert.equal(managerOf('ccNorth'), 'hodA')
    assert.equal(managerOf('ccSouth'), 'ceo')
})

test('missing managers fall back up the chain', () => {
    assert.equal(managerOf('empNowhere'), 'ceo')
    const noCc = staff.map(p => (p.id === 'ccSouth' ? { ...p, status: 'Inactive' } : p))
    assert.equal(managerOf('recSouth', noCc), 'ceo')
})

test('directors and non-staff have no line manager', () => {
    assert.equal(managerOf('ceo'), null)
    assert.equal(managerOf('sme'), null)
})

test('patches skip manual overrides and unchanged managers', () => {
    const people = staff.map(p => {
        if (p.id === 'empNorth') return { ...p, lineManagerId: 'hodB', lineManagerSource: 'manual' }
        if (p.id === 'recSouth') return { ...p, lineManagerId: 'ccSouth' }
        return p
    })
    const ids = lineManagerPatches(people).map(p => p.id)
    assert.ok(!ids.includes('empNorth'))
    assert.ok(!ids.includes('recSouth'))
    assert.ok(!ids.includes('sme'))
    assert.ok(ids.includes('coordA'))
})
