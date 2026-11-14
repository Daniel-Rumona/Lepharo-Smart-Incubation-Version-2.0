const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const Module = require('node:module')
const test = require('node:test')
const ts = require('typescript')

const sourcePath = join(__dirname, 'applicationLifecycleLogic.ts')
const mod = new Module(sourcePath, module)
mod._compile(ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText, sourcePath)
const L = mod.exports

test('new application records its first status', () => {
    const entry = L.historyEntryFor(undefined, { applicationStatus: 'pending' })
    assert.equal(entry.fromStatus, null)
    assert.equal(entry.toStatus, 'pending')
    assert.equal(entry.source, 'system')
})

test('unchanged status records nothing', () => {
    assert.equal(L.historyEntryFor({ applicationStatus: 'pending' }, { applicationStatus: 'Pending ' }), null)
    assert.equal(L.historyEntryFor({ applicationStatus: 'accepted' }, null), null)
})

test('rejection keeps who decided and the reason', () => {
    const entry = L.historyEntryFor(
        { applicationStatus: 'pending' },
        { applicationStatus: 'rejected', decision: { status: 'rejected', reason: 'Outside area', decidedBy: { uid: 'u1', email: 'a@x.com' } } }
    )
    assert.deepEqual(entry, {
        fromStatus: 'pending', toStatus: 'rejected', decidedByUid: 'u1', decidedByEmail: 'a@x.com',
        reason: 'Outside area', reopenedFrom: null, source: 'decision'
    })
})

test('reopen is recorded with the status it came from', () => {
    const entry = L.historyEntryFor(
        { applicationStatus: 'rejected' },
        { applicationStatus: 'pending', decision: { status: 'pending', reopenedFrom: 'rejected', decidedBy: { uid: 'u2' } } }
    )
    assert.equal(entry.toStatus, 'pending')
    assert.equal(entry.reopenedFrom, 'rejected')
    assert.equal(entry.decidedByUid, 'u2')
})

test('a stale decision for another status is not credited', () => {
    // Onboarding flips the status without touching the old decision record.
    const entry = L.historyEntryFor(
        { applicationStatus: 'rejected' },
        { applicationStatus: 'accepted', decision: { status: 'rejected', decidedBy: { uid: 'u1' }, reason: 'x' } }
    )
    assert.equal(entry.source, 'system')
    assert.equal(entry.decidedByUid, null)
    assert.equal(entry.reason, null)
})

test('pending since uses the reopen time when reopened', () => {
    const submitted = new Date('2026-01-01')
    const reopened = new Date('2026-03-01')
    assert.equal(L.pendingSince({ submittedAt: submitted }).toISOString(), submitted.toISOString())
    assert.equal(
        L.pendingSince({ submittedAt: submitted, decision: { status: 'pending', reopenedFrom: 'rejected', decidedAt: { toDate: () => reopened } } }).toISOString(),
        reopened.toISOString()
    )
    assert.equal(L.pendingSince({ createdAt: '2026-02-02' }).toISOString().slice(0, 10), '2026-02-02')
    assert.equal(L.pendingSince({}), null)
})

test('escalation steps', () => {
    assert.equal(L.escalationStep(6), null)
    assert.deepEqual(L.escalationStep(7), { key: 'reminder-7', level: 'reminder' })
    assert.deepEqual(L.escalationStep(13), { key: 'reminder-7', level: 'reminder' })
    assert.deepEqual(L.escalationStep(14), { key: 'escalated-14', level: 'escalated' })
    assert.deepEqual(L.escalationStep(20), { key: 'escalated-14', level: 'escalated' })
    assert.deepEqual(L.escalationStep(21), { key: 'escalated-21', level: 'escalated' })
    assert.deepEqual(L.escalationStep(40), { key: 'escalated-35', level: 'escalated' })
})
