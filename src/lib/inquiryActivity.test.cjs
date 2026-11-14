const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const Module = require('node:module')
const test = require('node:test')
const ts = require('typescript')

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
const { buildInquiryActivity } = load('inquiryActivity.ts', { './followUpBuckets': buckets })

const at = (d, h = 0, m = 0) => new Date(2026, 10, d, h, m)
const uid = 'UwlnOcHPnranbwZQW0gWo5JrxWo1'

test('everything lands in one list, newest first', () => {
    const items = buildInquiryActivity({
        submittedAt: at(1, 9),
        sourceLabel: 'Walk-in',
        statusHistory: [
            { status: 'New', changedAt: at(1, 9), changedBy: uid, notes: 'Inquiry created' },
            { status: 'Contacted', changedAt: at(6, 15), changedBy: uid, notes: 'Follow-up completed' }
        ],
        communications: [
            { id: 'e1', type: 'response', message: 'Subject: Thank you\n\nDear Thabo', sentAt: at(2, 10), sentBy: uid, sentByName: 'System' },
            { id: 'n1', type: 'note', noteKind: 'call', message: 'Called, left a message', sentAt: at(3, 11), sentBy: uid, sentByName: 'Amanda Zuma', isInternal: true }
        ],
        followUps: [
            { id: 'f1', followUpType: 'Email', scheduledDate: at(6, 9, 30), status: 'Completed', createdAt: at(4), completedAt: at(6, 14), outcome: 'Sent the link', completedByName: 'Amanda Zuma' }
        ],
        names: { [uid]: 'Receptionist Rusternberg' }
    })
    assert.deepEqual(items.map(i => i.kind), ['status', 'followup-done', 'followup-booked', 'note', 'email', 'received'])
    // The creating "New" entry is not repeated; "received" stands for it.
    assert.equal(items.filter(i => i.kind === 'status').length, 1)
    assert.equal(items.find(i => i.kind === 'email').title, 'Emailed the SME: Thank you')
    assert.equal(items.find(i => i.kind === 'email').body, 'Dear Thabo')
    // "System" or an id is replaced by the real name when we know it.
    assert.equal(items.find(i => i.kind === 'email').by, 'Receptionist Rusternberg')
    assert.equal(items.find(i => i.kind === 'note').title, 'Logged a call')
    assert.equal(items.find(i => i.kind === 'followup-booked').title, 'Follow-up booked for Fri 6 Nov, 09:30 (Email)')
})

test('escalation and hand-back show who and why', () => {
    const items = buildInquiryActivity({
        followUps: [{
            id: 'f2', status: 'Pending', scheduledDate: at(9),
            escalation: { departmentName: 'Legal Advisory Services', note: 'Trademark advice', byName: 'Amanda', at: at(6, 10), status: 'returned', returnNote: 'Needs Finance', returnedByName: 'Lebo', returnedAt: at(6, 12) }
        }]
    })
    assert.deepEqual(items.map(i => [i.kind, i.title, i.by]), [
        ['returned', 'Handed back to reception', 'Lebo'],
        ['escalated', 'Escalated to Legal Advisory Services', 'Amanda']
    ])
})
