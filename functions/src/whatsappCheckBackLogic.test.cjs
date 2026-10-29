const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const Module = require('node:module')
const test = require('node:test')
const ts = require('typescript')

const sourcePath = join(__dirname, 'whatsappCheckBackLogic.ts')
const mod = new Module(sourcePath, module)
mod._compile(ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText, sourcePath)
const { facilitatorDispatch, smeDispatch, decideFollowUpTap, cleanVariable, firstName } = mod.exports

const base = { assigneeId: 'staff-1', participantId: 'p-1', smeCheckIn: true }
const tap = (patch) => decideFollowUpTap({ followUp: base, staffOwnerIds: [], participantIds: [], smeConsentNumberMatches: false, code: 'ACHIEVED', ...patch })

test('the facilitator message carries three variables and three button payloads in template order', () => {
    const d = facilitatorDispatch({ followUpId: 'f1', to: '27821234567', facilitatorName: 'Thabo Nkosi', interventionTitle: 'Cash\nFlow   Management', smeName: 'Mokoena Trading' })
    assert.equal(d.template, 'lph_checkback_facilitator')
    assert.deepEqual(d.variables, ['Thabo', 'Cash Flow Management', 'Mokoena Trading'])
    assert.deepEqual(d.buttons.map(b => b.payload), ['LPH|FU|f1|ACHIEVED', 'LPH|FU|f1|PARTIAL', 'LPH|FU|f1|NOT_YET'])
})

test('the SME message carries two variables and the three SME buttons', () => {
    const d = smeDispatch({ followUpId: 'f1', to: '27821234567', smeName: 'Sipho Dlamini', interventionTitle: 'Marketing' })
    assert.equal(d.template, 'lph_checkback_sme')
    assert.deepEqual(d.variables, ['Sipho', 'Marketing'])
    assert.deepEqual(d.buttons.map(b => b.payload), ['LPH|FU|f1|YES', 'LPH|FU|f1|PARTLY', 'LPH|FU|f1|NO'])
})

test('variables are single-line with fallbacks', () => {
    assert.equal(cleanVariable('  a \n\t b  ', 'x'), 'a b')
    assert.equal(cleanVariable('', 'fallback'), 'fallback')
    assert.equal(firstName(''), 'there')
})

test('only the assigned facilitator can answer, once', () => {
    assert.equal(tap({ staffOwnerIds: ['staff-1'] }).ok, true)
    assert.deepEqual(tap({ staffOwnerIds: ['staff-1'] }).patch, { answer: 'achieved', answeredVia: 'whatsapp', answeredBy: 'staff-1' })
    assert.match(tap({ staffOwnerIds: ['someone-else'] }).reply, /not assigned/i)
    assert.match(tap({ staffOwnerIds: [] }).reply, /not assigned/i)
    assert.match(tap({ staffOwnerIds: ['staff-1'], followUp: { ...base, answer: 'partial' } }).reply, /already/i)
})

test('an SME can answer only their own check-back, only if asked, only once', () => {
    assert.equal(tap({ code: 'YES', participantIds: ['p-1'] }).ok, true)
    assert.deepEqual(tap({ code: 'PARTLY', participantIds: ['p-1'] }).patch, { smeAnswer: 'partly' })
    assert.equal(tap({ code: 'NO', smeConsentNumberMatches: true }).ok, true)
    assert.match(tap({ code: 'YES', participantIds: ['other'] }).reply, /not linked/i)
    assert.match(tap({ code: 'YES', participantIds: ['p-1'], followUp: { ...base, smeCheckIn: false } }).reply, /does not need/i)
    assert.match(tap({ code: 'YES', participantIds: ['p-1'], followUp: { ...base, smeAnswer: 'no' } }).reply, /already/i)
})

test('an SME cannot use a facilitator button and vice versa', () => {
    assert.equal(tap({ code: 'ACHIEVED', participantIds: ['p-1'] }).ok, false)
    assert.equal(tap({ code: 'YES', staffOwnerIds: ['staff-1'] }).ok, false)
    assert.equal(tap({ code: 'SYSTEM_OBSERVED', staffOwnerIds: ['staff-1'] }).ok, false)
})

test('a missing check-back is reported, not crashed on', () => {
    assert.match(decideFollowUpTap({ followUp: {}, staffOwnerIds: [], participantIds: [], smeConsentNumberMatches: false, code: 'YES' }).reply, /could not find/i)
})
