const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

function load(relative, mocks = {}) {
    const filename = path.join(__dirname, relative)
    const loaded = new Module(filename, module)
    loaded.paths = module.paths
    const originalRequire = loaded.require.bind(loaded)
    loaded.require = id => Object.hasOwn(mocks, id) ? mocks[id] : originalRequire(id)
    loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true }
    }).outputText, filename)
    return loaded.exports
}
const {
    complianceEffectiveExpiry,
    normalizeComplianceRequirements,
    selectDepartmentRequirements
} = load('complianceResolver.ts', { '@/firebase': { db: null } })

const ymd = date => [date.getFullYear(), date.getMonth() + 1, date.getDate()].join('-')

test('a department setup selects programme requirements and keeps programme fields', () => {
    const programme = normalizeComplianceRequirements([
        { key: 'TAX_CLEARANCE', title: 'Tax Clearance', hasExpiry: true, expiryMonths: 12, requiredAtApplication: true },
        { key: 'CERTIFIED_ID', title: 'Certified ID' }
    ])
    const department = normalizeComplianceRequirements([
        // Stale copy: different title, no requiredAtApplication, its own expiry.
        { presetId: 'tax-clearance', title: 'Old title', hasExpiry: true, expiryMonths: 6 }
    ]).map(row => ({ ...row, departmentId: 'finance' }))

    const selected = selectDepartmentRequirements(programme, department)

    assert.equal(selected.length, 1)
    assert.equal(selected[0].title, 'Tax Clearance')
    assert.equal(selected[0].requiredAtApplication, true)
    assert.equal(selected[0].expiryMonths, 6)
    assert.equal(selected[0].departmentId, 'finance')
})

test('a department row whose programme requirement was deleted drops out', () => {
    const programme = normalizeComplianceRequirements([{ key: 'CERTIFIED_ID', title: 'Certified ID' }])
    const department = normalizeComplianceRequirements([{ presetId: 'bank-letter', title: 'Bank Letter' }])
    assert.deepEqual(selectDepartmentRequirements(programme, department), [])
})

test('effective expiry: the validity period from the issue date wins over a stored expiry', () => {
    const expiry = complianceEffectiveExpiry(
        { issueDate: new Date(2026, 0, 15), expiryDate: new Date(2030, 0, 1) },
        { hasExpiry: true, expiryMonths: 12 }
    )
    assert.equal(ymd(expiry), '2027-1-15')
})

test('effective expiry clamps to the last day of a shorter month', () => {
    const expiry = complianceEffectiveExpiry(
        { issueDate: new Date(2026, 0, 31) },
        { hasExpiry: true, expiryMonths: 1 }
    )
    assert.equal(ymd(expiry), '2026-2-28')
})

test('effective expiry falls back to the stored date without a policy or issue date', () => {
    const stored = new Date(2027, 5, 1)
    assert.equal(ymd(complianceEffectiveExpiry({ expiryDate: stored }, { hasExpiry: false })), '2027-6-1')
    assert.equal(ymd(complianceEffectiveExpiry({ expiryDate: stored }, { hasExpiry: true, expiryMonths: 12 })), '2027-6-1')
    assert.equal(complianceEffectiveExpiry({}, { hasExpiry: true, expiryMonths: 12 }), null)
})
