const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const Module = require('node:module')
const test = require('node:test')
const ts = require('typescript')

const p = join(__dirname, 'events.ts')
const mod = new Module(p, module)
mod._compile(ts.transpileModule(readFileSync(p, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, p)
const E = mod.exports

const now = Date.parse('2026-10-09T08:00:00Z')
const A = { id: 'a1', programId: 'p1', branchId: 'b1', assignedAt: '2026-09-01T08:00:00Z', assigneeCompletedAt: '2026-09-10T08:00:00Z', updatedAt: '2026-10-01T00:00:00Z' }
const ctx = (collection, revision = 1) => ({ collection, revision, now })

test('only evidenced milestones become events; updatedAt never does', () => {
  const { events } = E.deriveEvents(A, ctx('assignedInterventions'))
  assert.deepEqual(events.map(e => e.milestone).sort(), ['assigned', 'delivery'])
  assert.ok(events.every(e => e.timeBasis === 'source_timestamp' && e.occurredAt <= now))
})

test('future and invalid dates are reported and excluded', () => {
  const r = E.deriveEvents({ ...A, assigneeCompletedAt: '2027-01-01', participantConfirmedAt: 'nonsense' }, ctx('assignedInterventions'))
  assert.equal(r.events.length, 1)
  assert.equal(r.issues.length, 2)
})

test('replay is deterministic under duplicates and reordering', () => {
  const mov = { id: 'm1', programId: 'p1', assignedInterventionId: 'a1', hodApprovedAt: '2026-09-20T08:00:00Z' }
  const ev = [...E.deriveEvents(A, ctx('assignedInterventions')).events, ...E.deriveEvents(mov, ctx('movDocuments')).events]
  const forward = E.projectStates(ev)
  const shuffled = E.projectStates([...ev].reverse().concat(ev))
  assert.deepEqual(forward, shuffled)
  assert.equal(forward[0].reached.approved.at, Date.parse('2026-09-20T08:00:00Z'))
})

test('a correction supersedes by revision whatever the arrival order', () => {
  const old = E.deriveEvents(A, ctx('assignedInterventions', 1)).events
  const fixed = E.deriveEvents({ ...A, assigneeCompletedAt: '2026-09-12T08:00:00Z' }, ctx('assignedInterventions', 2)).events
  for (const [first, second] of [[old, fixed], [fixed, old]]) {
    const s = E.projectStates(E.mergeEvents(first, second))
    assert.equal(s[0].reached.delivery.at, Date.parse('2026-09-12T08:00:00Z'))
  }
})

test('a deletion removes the milestone from projections', () => {
  const live = E.deriveEvents(A, ctx('assignedInterventions', 1)).events
  const gone = E.deriveEvents(null, ctx('assignedInterventions', 2), { removedDoc: A }).events
  assert.ok(gone.every(e => e.deleted))
  assert.equal(E.projectStates(E.mergeEvents(live, gone)).length, 0)
})

test('multiple MOVs keep the earliest evidenced time and count sources', () => {
  const m = (id, at) => ({ id, programId: 'p1', assignedInterventionId: 'a1', hodApprovedAt: at })
  const ev = ['2026-09-22T00:00:00Z', '2026-09-20T00:00:00Z'].flatMap((at, i) => E.deriveEvents(m('m' + i, at), ctx('movDocuments')).events)
  const r = E.projectStates(ev)[0].reached.approved
  assert.equal(r.at, Date.parse('2026-09-20T00:00:00Z'))
  assert.equal(r.sources, 2)
})

test('import observations keep occurrence unknown and are never orphans', () => {
  const o = E.observeAtImport('a1', 'confirmed', A, ctx('assignedInterventions'))
  assert.equal(o.occurredAt, null)
  assert.equal(o.timeBasis, 'observed_at_import')
  const rec = E.reconcile(E.projectStates([o]), [{ collection: 'assignedInterventions', docs: [{ ...A }] }], now)
  assert.ok(!rec.discrepancies.some(d => d.kind === 'orphan_event'))
})

test('reconcile finds missing, orphan and mismatched events', () => {
  const states = E.projectStates(E.deriveEvents(A, ctx('assignedInterventions')).events)
  assert.equal(E.reconcile(states, [{ collection: 'assignedInterventions', docs: [A] }], now).discrepancies.length, 0)
  const changed = { ...A, assigneeCompletedAt: '2026-09-11T08:00:00Z', participantConfirmedAt: '2026-09-12T08:00:00Z' }
  const kinds = E.reconcile(states, [{ collection: 'assignedInterventions', docs: [changed] }], now).discrepancies.map(d => d.kind).sort()
  assert.deepEqual(kinds, ['missing_event', 'time_mismatch'])
  const orphan = E.reconcile(states, [{ collection: 'assignedInterventions', docs: [{ ...A, assigneeCompletedAt: null }] }], now).discrepancies
  assert.ok(orphan.some(d => d.kind === 'orphan_event' && d.milestone === 'delivery'))
})

test('synthetic provenance is carried through', () => {
  const e = E.deriveEvents({ ...A, id: 'dtseed_x', dataOrigin: 'synthetic', seedRunId: 'run1' }, ctx('assignedInterventions')).events[0]
  assert.equal(e.dataOrigin, 'synthetic')
  assert.equal(e.seedRunId, 'run1')
})
