const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const Module = require('node:module')
const test = require('node:test')
const ts = require('typescript')

const sourcePath = join(__dirname, 'watchesLogic.ts')
const mod = new Module(sourcePath, module)
mod._compile(ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText, sourcePath)
const L = mod.exports

const NOW = Date.parse('2026-11-03T06:30:00Z')
const DAY = 86400000
const risk = (id, level, extra = {}) => ({
    participantId: id, participantName: `SME ${id}`, programId: 'rustenburg', level, score: 70, ownerIds: ['coord'], reasons: ['Missed sessions'], ...extra
})
const world = (extra = {}) => ({ risk: [], nextSession: new Map(), impact: [], assignments: [], ...extra })
const ALL = { kind: 'all' }

test('an SME risk watch finds High risk SMEs in its programme, and only new ones fire', () => {
    const spec = L.normaliseSpec({ type: 'sme_risk', programId: 'rustenburg', programName: 'Rustenburg' }).spec
    const w = world({ risk: [risk('a', 'High'), risk('b', 'Medium'), risk('c', 'High', { programId: 'other' }), risk('d', 'Critical')] })
    assert.deepEqual(L.currentMatches(spec, w, ALL, NOW).map(m => m.key), ['a', 'd'], 'Critical is worse than High, so it counts')
    const matches = L.currentMatches(spec, world({ risk: [risk('a', 'High')] }), ALL, NOW)
    // a was already High when the watch was set: baseline, not news.
    assert.deepEqual(L.nextWatchState(spec, ['a'], matches).fired, [])
    const later = L.currentMatches(spec, world({ risk: [risk('a', 'High'), risk('b', 'High')] }), ALL, NOW)
    const state = L.nextWatchState(spec, ['a'], later)
    assert.deepEqual(state.fired.map(m => m.key), ['b'])
    assert.equal(state.done, false, 'a programme-wide watch keeps running')
})

test('no session booked means none in the window', () => {
    const spec = L.normaliseSpec({ type: 'sme_risk', noSessionDays: 14 }).spec
    const w = world({
        risk: [risk('booked', 'High'), risk('later', 'High'), risk('none', 'High')],
        nextSession: new Map([['booked', NOW + 3 * DAY], ['later', NOW + 30 * DAY]])
    })
    assert.deepEqual(L.currentMatches(spec, w, ALL, NOW).map(m => m.key), ['later', 'none'])
})

test('Medium also counts High; one SME watch ends when it fires', () => {
    const spec = L.normaliseSpec({ type: 'sme_risk', participantId: 'b', level: 'medium' }).spec
    const matches = L.currentMatches(spec, world({ risk: [risk('b', 'Medium')] }), ALL, NOW)
    assert.equal(matches.length, 1)
    assert.equal(L.nextWatchState(spec, [], matches).done, true)
})

test('something that stops matching and matches again is news again', () => {
    const spec = L.normaliseSpec({ type: 'sme_risk' }).spec
    let keys = ['a']
    keys = L.nextWatchState(spec, keys, []).keys
    assert.deepEqual(L.nextWatchState(spec, keys, [{ key: 'a', title: '', detail: '', link: '' }]).fired.length, 1)
})

test('watches only see what their owner may see', () => {
    const spec = L.normaliseSpec({ type: 'sme_risk' }).spec
    const w = world({ risk: [risk('mine', 'High'), risk('theirs', 'High', { ownerIds: ['someone'], programId: 'other' })] })
    assert.deepEqual(L.currentMatches(spec, w, { kind: 'own', uid: 'coord' }, NOW).map(m => m.key), ['mine'])
    assert.deepEqual(L.currentMatches(spec, w, { kind: 'programmes', programmeIds: ['other'] }, NOW).map(m => m.key), ['theirs'])
    assert.equal(L.visibilityFor('Project Admin', [], 'u'), null, 'unknown spellings are not guessed')
    assert.deepEqual(L.visibilityFor('projectadmin', ['p1'], 'u'), { kind: 'programmes', programmeIds: ['p1'] })
    assert.equal(L.visibilityFor('incubatee', [], 'u'), null)
})

test('an impact watch fires once the result is reportable, then ends', () => {
    const spec = L.normaliseSpec({ type: 'impact_reportable', interventionId: 'cfp', interventionTitle: 'Cash Flow Planning' }).spec
    const row = (status, metric = 'revenue') => ({ programId: 'p1', interventionId: 'cfp', interventionTitle: 'Cash Flow Planning', metric, status, headline: 'Linked to growth.' })
    assert.equal(L.currentMatches(spec, world({ impact: [row('early')] }), ALL, NOW).length, 0)
    const matches = L.currentMatches(spec, world({ impact: [row('reportable'), row('early', 'jobs')] }), ALL, NOW)
    assert.equal(matches.length, 1)
    assert.match(matches[0].link, /impact\?intervention=cfp/)
    assert.equal(L.nextWatchState(spec, [], matches).done, true)
    assert.ok(L.normaliseSpec({ type: 'impact_reportable' }).error)
})

test('an intervention watch fires when the SME completes it', () => {
    const spec = L.normaliseSpec({ type: 'intervention_done', participantId: 's1', participantName: 'Dante', interventionId: 'ip' }).spec
    const a = (status, interventionId = 'ip') => ({ id: `${interventionId}-${status}`, participantId: 's1', participantName: 'Dante', programId: 'p1', interventionId, interventionTitle: 'IP Advisory', status, assigneeId: 'coord', completedAt: NOW })
    assert.equal(L.currentMatches(spec, world({ assignments: [a('in-progress'), a('completed', 'other')] }), ALL, NOW).length, 0)
    assert.equal(L.currentMatches(spec, world({ assignments: [a('completed')] }), ALL, NOW)[0].title, 'Dante completed IP Advisory')
})

test('specs keep only what their type uses and read in plain words', () => {
    const { spec } = L.normaliseSpec({ type: 'sme_risk', programName: 'Rustenburg', programId: 'r', noSessionDays: '14', interventionId: 'x' })
    assert.equal(spec.interventionId, undefined)
    assert.equal(L.describeWatch(spec), 'Tell me when any SME in Rustenburg goes High or Critical risk with no session booked in the next 14 days.')
    assert.ok(L.normaliseSpec({ type: 'delete_everything' }).error)
})

test('names match exactly first, else by every word', () => {
    const items = [{ id: '1', name: 'Rustenburg Mining Services' }, { id: '2', name: 'Rustenburg' }, { id: '3', name: 'Mining Co' }]
    assert.deepEqual(L.matchByName('rustenburg', items).map(i => i.id), ['2'])
    assert.deepEqual(L.matchByName('mining', items).map(i => i.id), ['1', '3'])
    assert.deepEqual(L.matchByName('  ', items), [])
})
