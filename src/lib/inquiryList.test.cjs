const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const Module = require('node:module')
const test = require('node:test')
const ts = require('typescript')

// inquiryList imports followUpBuckets; compile both and wire the import.
const load = (file, requireMap = {}) => {
    const path = join(__dirname, file)
    const mod = new Module(path, module)
    mod.require = id => requireMap[id] || require(id)
    mod._compile(ts.transpileModule(readFileSync(path, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
    }).outputText, path)
    return mod.exports
}
const buckets = load('followUpBuckets.ts')
const { inquiryInTab, followUpStateByInquiry, INQUIRY_STATUSES } = load('inquiryList.ts', { './followUpBuckets': buckets })

const now = new Date(2026, 10, 6, 14, 30)
const at = (d, h = 0, m = 0) => new Date(2026, 10, d, h, m)

test('every status is in exactly one of Open and Closed', () => {
    for (const status of INQUIRY_STATUSES) {
        assert.notEqual(inquiryInTab(status, 'open'), inquiryInTab(status, 'closed'), status)
        assert.equal(inquiryInTab(status, 'all'), true)
    }
    assert.equal(inquiryInTab('Contacted', 'open'), true)
    assert.equal(inquiryInTab('Lost', 'closed'), true)
    // An unknown status is never hidden: it counts as open.
    assert.equal(inquiryInTab('Follow-up Required', 'open'), true)
})

test('New is its own tab and also open', () => {
    assert.equal(inquiryInTab('New', 'new'), true)
    assert.equal(inquiryInTab('New', 'open'), true)
    assert.equal(inquiryInTab('In Progress', 'new'), false)
})

test('the most pressing open follow-up describes the inquiry', () => {
    const states = followUpStateByInquiry([
        { inquiryId: 'a', status: 'Pending', scheduledDate: at(9) },
        { inquiryId: 'a', status: 'Pending', scheduledDate: at(4) },
        { inquiryId: 'a', status: 'Completed', scheduledDate: at(1) },
        { inquiryId: 'b', status: 'Pending', scheduledDate: at(6, 10) },
        { inquiryId: 'c', status: 'Pending', scheduledDate: at(2), escalatedToUids: ['x'], escalation: { departmentName: 'Legal Advisory Services' } },
        { inquiryId: 'd', status: 'Completed', scheduledDate: at(2) }
    ], now)
    assert.deepEqual(states.get('a'), { label: '2 days overdue', tone: 'overdue' })
    assert.deepEqual(states.get('b'), { label: 'Today, 10:00', tone: 'today' })
    assert.deepEqual(states.get('c'), { label: 'With Legal Advisory Services', tone: 'escalated' })
    assert.equal(states.has('d'), false)
})
