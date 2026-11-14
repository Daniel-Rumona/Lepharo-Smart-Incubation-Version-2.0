const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const Module = require('node:module')
const test = require('node:test')
const ts = require('typescript')

const sourcePath = join(__dirname, 'proposalNotificationLogic.ts')
const mod = new Module(sourcePath, module)
mod._compile(ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText, sourcePath)
const L = mod.exports

const base = {
    proposalNumber: 'PR-2026-004',
    title: 'Township retail support',
    clientName: 'Gauteng DED',
    status: 'Draft',
    owner: { type: 'Individual', id: 'owner-1', name: 'Thandi' },
    contributors: [{ id: 'c-1', name: 'Sipho' }, { id: 'c-2', name: 'Lerato' }],
    createdBy: { id: 'creator', name: 'Naledi' },
    updatedBy: { id: 'creator', name: 'Naledi' }
}

test('a new proposal tells the owner and contributors, never the creator', () => {
    const events = L.proposalEvents('p1', null, base)
    assert.equal(events.length, 2)
    assert.deepEqual(events[0].recipientIds, ['owner-1'])
    assert.equal(events[0].headline, 'You own proposal PR-2026-004 "Township retail support"')
    assert.deepEqual(events[1].recipientIds, ['c-1', 'c-2'])
    assert.ok(events.every(event => !event.recipientIds.includes('creator')))
})

test('a creator who owns the proposal is not told about it', () => {
    const own = { ...base, owner: { type: 'Individual', id: 'creator', name: 'Naledi' }, contributors: [] }
    assert.deepEqual(L.proposalEvents('p1', null, own), [])
})

test('a department owner is resolved by the caller', () => {
    const dept = { ...base, owner: { type: 'Department', id: 'dept-1', name: 'ROM' }, contributors: [] }
    const [event] = L.proposalEvents('p1', null, dept)
    assert.equal(event.includeOwnerGroup, true)
    assert.deepEqual(event.recipientIds, [])
    // A typed-in owner with no id is not a group and nobody can be told.
    const typed = { ...base, owner: { type: 'Individual', id: null, name: 'Someone' }, contributors: [] }
    assert.deepEqual(L.proposalEvents('p1', null, typed), [])
})

test('a status change tells the whole team except whoever moved it', () => {
    const after = { ...base, status: 'Accepted', updatedBy: { id: 'c-1', name: 'Sipho' } }
    const [event] = L.proposalEvents('p1', { ...base, status: 'Under review' }, after, 'Client signed off the budget')
    assert.equal(event.kind, 'status')
    assert.deepEqual(event.recipientIds.sort(), ['c-2', 'creator', 'owner-1'])
    assert.deepEqual(event.channels, ['inApp', 'email', 'whatsapp'])
    assert.equal(event.headline, 'PR-2026-004 "Township retail support" is now Accepted')
    assert.match(event.details, /Under review to Accepted\. Note: Client signed off the budget$/)
})

test('the generated status note is not repeated', () => {
    const after = { ...base, status: 'Submitted' }
    const [event] = L.proposalEvents('p1', base, after, 'Status changed from Draft to Submitted')
    assert.doesNotMatch(event.details, /Note:/)
    assert.deepEqual(event.channels, ['inApp', 'email'])
})

test('moves inside preparation stay in-app', () => {
    assert.deepEqual(L.statusChannels('In preparation'), ['inApp'])
    assert.deepEqual(L.statusChannels('Archived'), ['inApp'])
    assert.deepEqual(L.statusChannels('Rejected'), ['inApp', 'email', 'whatsapp'])
})

test('an edit tells only the people newly added', () => {
    const after = {
        ...base,
        owner: { type: 'Individual', id: 'owner-2', name: 'Kagiso' },
        contributors: [...base.contributors, { id: 'c-3', name: 'Ayanda' }]
    }
    const events = L.proposalEvents('p1', base, after)
    assert.deepEqual(events.map(event => event.recipientIds), [['owner-2'], ['c-3']])
    assert.deepEqual(L.proposalEvents('p1', base, { ...base, title: 'Renamed' }), [])
})

test('handing ownership to a centre tells that centre once', () => {
    const after = { ...base, owner: { type: 'Centre', id: 'branch-1', name: 'Soweto' } }
    const [event] = L.proposalEvents('p1', base, after)
    assert.equal(event.includeOwnerGroup, true)
    assert.deepEqual(L.proposalEvents('p1', after, { ...after }), [])
})

test('deadline reminders go out a week, two days, on the day and a day late', () => {
    const draft = { ...base, status: 'In preparation' }
    assert.equal(L.deadlineReminder(draft, '2026-11-09', '2026-11-02').key, 'week')
    assert.equal(L.deadlineReminder(draft, '2026-11-04', '2026-11-02').key, 'twoDays')
    assert.equal(L.deadlineReminder(draft, '2026-11-02', '2026-11-02').key, 'today')
    assert.equal(L.deadlineReminder(draft, '2026-11-01', '2026-11-02').key, 'overdue')
    assert.equal(L.deadlineReminder(draft, '2026-11-05', '2026-11-02'), null)
    assert.equal(L.deadlineReminder(draft, '2026-10-20', '2026-11-02'), null)
})

test('submitted or archived proposals get no deadline reminders', () => {
    assert.equal(L.deadlineReminder({ ...base, status: 'Submitted' }, '2026-11-02', '2026-11-02'), null)
    assert.equal(L.deadlineReminder({ ...base, isArchived: true }, '2026-11-02', '2026-11-02'), null)
})
