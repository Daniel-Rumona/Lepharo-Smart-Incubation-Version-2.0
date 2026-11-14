const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const Module = require('node:module')
const test = require('node:test')
const ts = require('typescript')

const sourcePath = join(__dirname, 'inquiryContactTypes.ts')
const mod = new Module(sourcePath, module)
mod._compile(ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText, sourcePath)
const { inquiryContactType, sourceTypeFor, INQUIRY_TYPES_FOR, INQUIRY_CONTACT_TYPES, asksBusinessDetails, needsOrganisation, needsDepartment } = mod.exports

test('a recorded contact type wins', () => {
    assert.equal(inquiryContactType({ contactType: 'Funder' }, false), 'Funder')
    // Even on an SME-looking inquiry: what reception chose is what it is.
    assert.equal(inquiryContactType({ contactType: 'Stakeholder', classification: 'Potential' }, true), 'Stakeholder')
})

test('older inquiries fall back to SME, then Potential, then unknown', () => {
    assert.equal(inquiryContactType({}, true), 'Incubatee')
    assert.equal(inquiryContactType({ classification: 'Potential' }, false), 'Potential Incubatee')
    assert.equal(inquiryContactType({ classification: 'General' }, false), null)
    assert.equal(inquiryContactType({ contactType: 'Nonsense' }, false), null)
})

test('only an incubated SME is an incubatee inquiry', () => {
    assert.equal(sourceTypeFor('Incubatee'), 'Incubatee')
    for (const type of ['Potential Incubatee', 'Funder', 'Stakeholder', 'Visitor']) {
        assert.equal(sourceTypeFor(type), 'Non-Incubatee')
    }
})

test('every contact type offers inquiry types, ending with Other', () => {
    for (const type of INQUIRY_CONTACT_TYPES) {
        assert.ok(INQUIRY_TYPES_FOR[type].length >= 4, type)
        assert.equal(INQUIRY_TYPES_FOR[type].at(-1), 'Other')
    }
})

test('fields follow the contact type', () => {
    assert.equal(asksBusinessDetails('Potential Incubatee'), true)
    assert.equal(asksBusinessDetails('Funder'), false)
    assert.equal(needsOrganisation('Stakeholder'), true)
    assert.equal(needsOrganisation('Visitor'), false)
    assert.equal(needsDepartment('Incubatee'), true)
    assert.equal(needsDepartment('Visitor'), false)
})

test('screening questions and classification follow the type', () => {
    const { asksScreening, classificationFor } = mod.exports
    assert.equal(asksScreening('Potential Incubatee'), true)
    assert.equal(asksScreening('Incubatee'), false)
    assert.equal(classificationFor('Potential Incubatee'), 'Potential')
    for (const type of ['Incubatee', 'Funder', 'Stakeholder', 'Visitor']) assert.equal(classificationFor(type), 'General')
})

test('only an incubated SME can be attending a session', () => {
    const { visitPurposesFor } = mod.exports
    assert.ok(visitPurposesFor('Incubatee').includes('session'))
    for (const type of ['Potential Incubatee', 'Funder', 'Stakeholder', 'Visitor']) {
        assert.ok(!visitPurposesFor(type).includes('session'), type)
        assert.equal(visitPurposesFor(type)[0], 'inquiry')
    }
})
