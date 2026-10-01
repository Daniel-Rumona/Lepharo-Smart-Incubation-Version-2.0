const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const Module = require('node:module')
const test = require('node:test')
const ts = require('typescript')

const sourcePath = join(__dirname, 'evidenceModel.ts')
const serviceModule = new Module(sourcePath, module)
serviceModule._compile(ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText, sourcePath)
const { resolveEvidenceModel, resolveDeliverableName, getDeliverableView, getOutcomeState, DEFAULT_EVIDENCE_MODEL } =
    serviceModule.exports

test('a programme with no evidenceModel behaves as it does today', () => {
    assert.deepEqual(resolveEvidenceModel(undefined), DEFAULT_EVIDENCE_MODEL)
    assert.deepEqual(resolveEvidenceModel({ evidenceModel: { serviceEvidence: 'bogus' } }), DEFAULT_EVIDENCE_MODEL)
    assert.equal(DEFAULT_EVIDENCE_MODEL.serviceEvidence, 'mov')
})

test('deliverable name: snapshot, then definition, then generic; never a filename', () => {
    const named = { deliverable: 'named' }
    assert.equal(resolveDeliverableName({ definitionSnapshot: { deliverableName: 'Cash Flow Forecast' } }, null, named).name, 'Cash Flow Forecast')
    assert.equal(resolveDeliverableName({}, { outcomeDef: { deliverable: { name: 'Business Plan' } } }, named).name, 'Business Plan')
    assert.equal(resolveDeliverableName({ resources: [{ label: 'x.xlsx' }] }, {}, named).isConfigured, false)
    assert.equal(resolveDeliverableName({ definitionSnapshot: { deliverableName: 'X' } }, null).name, 'Proof of Execution')
})

test('legacy poe resources are deliverables; agreements and links are not; duplicates collapse', () => {
    const view = getDeliverableView({
        resources: [
            { link: 'https://a/1', type: 'poe', label: 'f.xlsx' },
            { link: 'https://a/1', type: 'poe' },
            { link: 'https://a/2', type: 'signed_agreement' },
            { link: 'https://a/3', type: 'document' },
            { link: 'not-a-url', type: 'poe' }
        ]
    })
    assert.deepEqual(view.files.map(f => f.link), ['https://a/1', 'https://a/3'])
})

test('legacy assignments read as not tracked; system_observed is never trusted from the cache', () => {
    assert.equal(getOutcomeState({}, {}).status, 'not_tracked')
    assert.equal(getOutcomeState({}, { outcomeDef: { intendedOutcome: 'x' } }).status, 'pending')
    const cached = { outcome: { status: 'achieved', confidence: 'system_observed' } }
    assert.equal(getOutcomeState(cached, {}).confidence, 'not_evidenced')
    assert.equal(getOutcomeState(cached, {}, { hasDetectorEvidence: true }).confidence, 'system_observed')
})

test('buildOutcomeDef: empty input stores nothing; outcome type fills defaults without system mechanisms', () => {
    const { buildOutcomeDef } = serviceModule.exports
    assert.equal(buildOutcomeDef({}), null)
    assert.equal(buildOutcomeDef({ deliverableName: '  ' }), null)
    const def = buildOutcomeDef({ deliverableName: 'Cash Flow Forecast', intendedOutcome: 'SME maintains a forecast', outcomeType: 'process_implemented', fromSuggestion: true })
    assert.equal(def.origin, 'ai_suggested')
    assert.equal(def.deliverable.required, true)
    assert.equal(def.followUpAfterDays, 60)
    assert.ok(!def.acceptedMechanisms.some(m => /system|integration/.test(m)))
    assert.equal(buildOutcomeDef({ deliverableName: 'X', outcomeType: 'nonsense' }).outcomeType, undefined)
    assert.equal(buildOutcomeDef({ intendedOutcome: 'y', followUpAfterDays: 45 }).followUpAfterDays, 45)
})

test('buildOutcomeDef: follow-up choices are stored; SME check-in only applies when follow-up is on', () => {
    const { buildOutcomeDef } = serviceModule.exports
    const on = buildOutcomeDef({ intendedOutcome: 'y', followUpRequired: true, smeCheckIn: true })
    assert.deepEqual(on.followUp, { required: true, smeCheckIn: true })
    assert.equal(on.followUpAfterDays, 60)
    const off = buildOutcomeDef({ intendedOutcome: 'y', followUpRequired: false, smeCheckIn: true, followUpAfterDays: 30 })
    assert.deepEqual(off.followUp, { required: false, smeCheckIn: false })
    assert.equal(off.followUpAfterDays, undefined)
    assert.equal(buildOutcomeDef({ deliverableName: 'X', followUpRequired: true }).followUp, undefined)
})
