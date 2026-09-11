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
const resolver = load('../services/complianceResolver.ts', { '@/firebase': { db: null } })
const { buildDashboardComplianceRows } = load('dashboardCompliance.ts', { '@/services/complianceResolver': resolver })
const now = new Date('2026-09-08T12:00:00Z')
const upload = (title, extra = {}) => ({ id: title, key: title, title, kind: 'upload', ...extra })

test('required missing uploads count, agreements and unrelated uploads never enter the modal', () => {
    const rows = buildDashboardComplianceRows([
        upload('Tax certificate'), { id: 'moa', title: 'MOA', kind: 'agreement' }
    ], [], [{ type: 'MOA', status: 'pending' }, { type: 'Other', status: 'pending' }], now)
    assert.equal(rows.length, 1)
    assert.equal(rows[0].title, 'Tax certificate')
    assert.equal(rows[0].status, 'missing')
    assert.equal(rows[0].outstanding, true)
})

test('canonical uploads override embedded records with normalized document names', () => {
    const rows = buildDashboardComplianceRows([upload('Registration documents')],
        [{ type: 'Registration docs', status: 'invalid' }],
        [{ title: 'Registration Document', status: 'approved' }], now)
    assert.equal(rows[0].status, 'valid')
    assert.equal(rows[0].outstanding, false)
})

test('expired approved uploads count and policy expiry uses the recorded issue date', () => {
    const rows = buildDashboardComplianceRows([upload('Tax', { hasExpiry: true, expiryMonths: 12 })], [],
        [{ type: 'Tax', status: 'approved', issueDate: '2025-01-01' }], now)
    assert.equal(rows[0].status, 'expired')
    assert.equal(rows[0].outstanding, true)
})

test('pending review counts; valid documents nearing expiry are still covered', () => {
    const rows = buildDashboardComplianceRows([upload('Tax'), upload('Registration')], [], [
        { type: 'Tax', status: 'pending' },
        { type: 'Registration', status: 'approved', expiryDate: '2026-09-20' }
    ], now)
    assert.deepEqual(rows.map(row => [row.status, row.outstanding]), [['pending', true], ['expiring-soon', false]])
})

test('agreement-marked records cannot satisfy an upload requirement', () => {
    const rows = buildDashboardComplianceRows([upload('Tax')], [],
        [{ type: 'Tax', kind: 'agreement', status: 'approved' }], now)
    assert.equal(rows[0].status, 'missing')
})
