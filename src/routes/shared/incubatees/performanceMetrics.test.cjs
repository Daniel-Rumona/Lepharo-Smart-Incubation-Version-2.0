const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')
const filename = path.join(__dirname, 'performanceMetrics.ts')
const loaded = new Module(filename, module)
loaded.paths = module.paths
loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText, filename)
const { buildPerformanceMonths: build, summarizePerformanceMonths: summarize, performanceMonthKey: key } = loaded.exports

test('revenue keeps years separate and obeys the inclusive reporting months', () => {
    const months = build([
        { month: 'January 2025', revenue: 100 },
        { month: 'January 2026', revenue: 200 },
        { month: 'February 2026', revenue: 300 }
    ], null)
    assert.equal(summarize(months, '2026-01', '2026-01').totalRevenue, 200)
    assert.equal(summarize(months, null, '2026-01').totalRevenue, 300)
})
test('latest correction wins regardless of input order and preserves zero', () => {
    const rows = [
        { month: 'March 2026', revenue: 0, headPermanent: 0, createdAt: '2026-04-02' },
        { month: 'March 2026', revenue: 900, headPermanent: 20, createdAt: '2026-04-01' }
    ]
    for (const history of [rows, [...rows].reverse()]) {
        assert.deepEqual(summarize(build(history, null), null, '2026-03'), { totalRevenue: 0, currentEmployees: 0 })
    }
})
test('headcount uses latest reporting month at or before end, even before range start', () => {
    const months = build([
        { month: 'December 2025', headPermanent: 50 },
        { month: 'January 2026', headPermanent: 4, headTemporary: 2 },
        { month: 'March 2026', headPermanent: 90 }
    ], null)
    assert.equal(summarize(months, '2026-02', '2026-02').currentEmployees, 6)
    assert.equal(summarize(months, '2025-01', '2025-02').currentEmployees, 0)
})
test('dated profile fallback and submission precedence are applied per field', () => {
    const months = build([{ month: '2026-01', revenue: 40, headPermanent: 3 }], {
        revenueHistory: { monthly: { '2026-01': 20, '2026-02': 60 } },
        headcountHistory: { monthly: { '2026-01': { permanent: 8, temporary: 2 } } }
    })
    assert.deepEqual(summarize(months, null, '2026-02'), { totalRevenue: 100, currentEmployees: 5 })
})
test('undated legacy months are not silently attributed to a year', () => {
    assert.deepEqual(build([{ month: 'January', revenue: 100, createdAt: '2026-01-03' }], {
        revenueHistory: { monthly: { January: 500 } },
        headcountHistory: { monthly: { December: { permanent: 80 } } }
    }), [])
    assert.equal(key('January', 2026), '2026-01')
    assert.equal(key('2026-13'), null)
})
test('updated timestamps determine latest revision and invalid values do not poison totals', () => {
    const months = build([
        { month: 'Jan 2026', revenue: 10, createdAt: { seconds: 1 }, updatedAt: { seconds: 5 } },
        { month: '2026-01', revenue: 20, createdAt: { seconds: 3 } },
        { month: '2026-02', revenue: 'invalid', headPermanent: -5 }
    ], null)
    assert.deepEqual(summarize(months, null, '2026-02'), { totalRevenue: 10, currentEmployees: 0 })
})
