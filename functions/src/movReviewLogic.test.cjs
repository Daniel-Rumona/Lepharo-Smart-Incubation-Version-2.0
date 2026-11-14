const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const Module = require('node:module')
const test = require('node:test')
const ts = require('typescript')

const sourcePath = join(__dirname, 'movReviewLogic.ts')
const mod = new Module(sourcePath, module)
mod._compile(ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText, sourcePath)
const { awaitingReview, hasEvidence, hiddenFrom, reviewRow, orderForReview, checkQueryMessage } = mod.exports

test('to review means confirmed by the SME, not approved and not queried', () => {
    assert.equal(awaitingReview({ smmeAccepted: true, status: 'awaiting_hod' }), true)
    assert.equal(awaitingReview({ participantCompletionStatus: 'Confirmed' }), true)
    assert.equal(awaitingReview({ confirmationOverride: { by: 'hod' } }), true)
    assert.equal(awaitingReview({ status: 'awaiting_smme' }), false, 'the SME has not confirmed')
    assert.equal(awaitingReview({ smmeAccepted: true, approvedByHod: true, status: 'approved' }), false)
    assert.equal(awaitingReview({ smmeAccepted: true, status: 'queried' }), false)
})

test('evidence is a POE link, a resource link, notes or a signed pre-incubation agreement', () => {
    assert.equal(hasEvidence({ poeUrls: ['https://x'] }), true)
    assert.equal(hasEvidence({ resources: [{ link: 'https://y' }] }), true)
    assert.equal(hasEvidence({ resources: [{ link: 'not a link' }] }), false)
    assert.equal(hasEvidence({ evidenceNotes: ' Register attached ' }), true)
    assert.equal(hasEvidence({ preIncubationAgreement: true }), true)
    assert.equal(hasEvidence({}), false)
})

test('control records are hidden from people outside the control domain', () => {
    const mov = { facilitatorEmail: 'tester@quantilytix.co.za' }
    assert.equal(hiddenFrom(mov, 'hod@lepharo.co.za'), true)
    assert.equal(hiddenFrom(mov, 'legal@quantilytix.co.za'), false)
    assert.equal(hiddenFrom({ facilitatorEmail: 'a@lepharo.co.za' }, 'hod@lepharo.co.za'), false)
    assert.equal(hiddenFrom({ sessions: [{ assigneeEmail: 'x@quantilytix.co.za' }] }, 'hod@lepharo.co.za'), true, 'nested emails count')
    assert.equal(hiddenFrom({ meta: { isDummy: true } }, 'hod@lepharo.co.za'), true, 'dummy markers count')
})

test('rows name the SME and flag weak evidence; the longest waiting come first', () => {
    const row = reviewRow('m1', { smmeCompanyName: 'Kudu Glass', interventionTitle: 'Contract Management', poeUrls: ['https://x'], evidenceCheck: { verdict: 'weak', summary: 'Register unsigned' }, smmeAcceptedAt: 200 })
    assert.equal(row.sme, 'Kudu Glass')
    assert.equal(row.evidenceWarning, 'weak')
    assert.equal(reviewRow('m2', { evidenceCheck: { verdict: 'strong' } }).evidenceWarning, null)
    const ordered = orderForReview([row, { ...row, movId: 'old', confirmedAt: 100 }, { ...row, movId: 'undated', confirmedAt: 0 }])
    assert.deepEqual(ordered.map(r => r.movId), ['old', 'm1', 'undated'])
})

test('a query says enough for the facilitator to act on', () => {
    assert.deepEqual(checkQueryMessage('fix it'), { problem: 'query_too_short' })
    assert.deepEqual(checkQueryMessage('  The register   is unsigned, please re-upload '), { message: 'The register is unsigned, please re-upload' })
})
