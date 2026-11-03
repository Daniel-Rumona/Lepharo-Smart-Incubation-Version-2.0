const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const Module = require('node:module')
const test = require('node:test')
const ts = require('typescript')

const sourcePath = join(__dirname, 'supplierReadinessLogic.ts')
const mod = new Module(sourcePath, module)
mod._compile(ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText, sourcePath)
const L = mod.exports

const doc = (key, title, status, expires = null) => ({ key, title, status, expires })

const base = (over = {}) => ({
    participantId: 'p1',
    name: 'Karoo Agri',
    sector: 'Agriculture',
    province: 'North West',
    town: 'Rustenburg',
    beeLevel: 1,
    ownership: { black: 100, women: 60, youth: 0 },
    registrations: { incomeTaxNumber: '9123456789', vatNumber: '', csdNumber: 'MAAA0123456', taxCompliancePin: 'AB12CD34EF' },
    compliance: [
        doc('cipc_reg', 'CIPC Registration Docs', 'valid'),
        doc('bbbee', 'B-BBEE Affidavit', 'valid', new Date('2027-06-01')),
        doc('tax_clearance', 'Tax Clearance', 'valid', new Date('2026-12-01'))
    ],
    risk: { score: 20, level: 'Low' },
    interventions: { completed: 3, total: 5 },
    certificates: 1,
    performance: { annualRevenue: 1200000, employees: 12, monthsReported: 12 },
    capability: { csdRegistered: true, capacity: true, tradeReferences: true, clientList: true },
    ...over
})

const req = (over = {}) => ({ sectors: [], provinces: [], documents: [], maxBeeLevel: null, ownership: {}, requireCsd: false, minStage: null, ...over })

test('document kinds are recognised from keys and titles', () => {
    assert.equal(L.kindOf('Tax Clearance Certificate'), 'tax')
    assert.equal(L.kindOf('B-BBEE Affidavit'), 'bbbee')
    assert.equal(L.kindOf('BANK_LETTER Bank Confirmation Letter'), 'bank')
    assert.equal(L.kindOf('CIDB grading 3CE'), 'cidb')
    assert.equal(L.kindOf('Something else'), null)
})

test('a fully compliant, low-risk SME with capacity is a preferred supplier', () => {
    const p = L.buildPassport(base())
    assert.equal(p.stage, 'preferred')
    assert.deepEqual(p.nextSteps, [])
    assert.deepEqual(p.checks, { tax: true, csd: true, bbbee: true, cipc: true })
})

test('market ready without trade references, with the step to get further', () => {
    const p = L.buildPassport(base({ capability: { csdRegistered: true, capacity: true, tradeReferences: false, clientList: null } }))
    assert.equal(p.stage, 'market_ready')
    assert.deepEqual(p.nextSteps, ['Provide trade references'])
})

test('missing documents and CSD number keep an SME developing, with reasons', () => {
    const p = L.buildPassport(base({
        registrations: { incomeTaxNumber: '', vatNumber: '', csdNumber: '', taxCompliancePin: 'X' },
        compliance: [doc('cipc', 'CIPC Registration Docs', 'valid'), doc('bbbee', 'B-BBEE Affidavit', 'expired')]
    }))
    assert.equal(p.stage, 'developing')
    assert.deepEqual(p.nextSteps, [
        'B-BBEE Affidavit: expired',
        'Capture the CSD supplier number (the SME says it is registered)'
    ])
})

test('high risk blocks market ready', () => {
    const p = L.buildPassport(base({ risk: { score: 80, level: 'High' } }))
    assert.equal(p.stage, 'developing')
    assert.ok(p.nextSteps.includes('Bring the risk level down from High'))
})

test('no documents and no registrations is entry', () => {
    const p = L.buildPassport(base({
        registrations: { incomeTaxNumber: '', vatNumber: '', csdNumber: '', taxCompliancePin: '' },
        compliance: [doc('cipc', 'CIPC', 'missing'), doc('tax', 'Tax Clearance', 'missing')],
        capability: { csdRegistered: null, capacity: null, tradeReferences: null, clientList: null }
    }))
    assert.equal(p.stage, 'entry')
    assert.ok(p.nextSteps.includes('Capture the CSD supplier number, or register on the CSD'))
})

test('an eligible match lists its strengths', () => {
    const m = L.matchOpportunity(L.buildPassport(base()), req({ sectors: ['agriculture'], provinces: ['North West'], maxBeeLevel: 2, ownership: { black: 51 }, requireCsd: true }), null)
    assert.equal(m.eligible, true)
    assert.deepEqual(m.gaps, [])
    assert.equal(m.score, 100) // 75 + 10 + 10 + 3 + 5, capped at 100
    assert.ok(m.strengths.includes('100% black-owned'))
})

test('a document that expires before the closing date is a gap', () => {
    const m = L.matchOpportunity(L.buildPassport(base({ registrations: { incomeTaxNumber: '', vatNumber: '', csdNumber: 'MAAA0123456', taxCompliancePin: '' } })),
        req({ documents: ['Tax clearance certificate'] }), new Date('2027-01-15'))
    assert.equal(m.eligible, false)
    assert.deepEqual(m.gaps, ['Tax compliance (SARS) expires before the closing date'])
})

test('a tax PIN satisfies a tax requirement without a document', () => {
    const p = L.buildPassport(base({ compliance: [doc('cipc', 'CIPC', 'valid')] }))
    const m = L.matchOpportunity(p, req({ documents: ['SARS tax compliance'] }), new Date('2027-01-15'))
    assert.equal(m.eligible, true)
    assert.ok(m.strengths.includes('Tax compliance PIN on file'))
})

test('wrong sector, province, B-BBEE level and ownership each give a reason', () => {
    const m = L.matchOpportunity(
        L.buildPassport(base({ beeLevel: 4, ownership: { black: 30, women: null, youth: 0 } })),
        req({ sectors: ['Construction'], provinces: ['Gauteng'], maxBeeLevel: 2, ownership: { black: 51, women: 30 }, documents: ['CIDB grading'] }),
        null
    )
    assert.equal(m.eligible, false)
    assert.deepEqual(m.gaps, [
        'Sector is Agriculture, not Construction',
        'Based in North West, not Gauteng',
        'No current CIDB grading',
        'B-BBEE level 4, needs level 2 or better',
        '30% black-owned, needs 51%',
        'women-owned percentage not captured'
    ])
})

test('minimum stage and CSD requirement', () => {
    const entry = L.buildPassport(base({
        registrations: { incomeTaxNumber: '', vatNumber: '', csdNumber: '', taxCompliancePin: '' },
        compliance: [doc('cipc', 'CIPC', 'missing')],
        capability: { csdRegistered: false, capacity: null, tradeReferences: null, clientList: null }
    }))
    const m = L.matchOpportunity(entry, req({ requireCsd: true, minStage: 'market_ready' }), null)
    assert.deepEqual(m.gaps, ['Not registered on the CSD', 'Readiness is Entry, needs Market Ready'])
})

test('ranking puts eligible first, then score, then name', () => {
    const ranked = L.rankMatches([
        { name: 'B', eligible: false, score: 90 },
        { name: 'C', eligible: true, score: 50 },
        { name: 'A', eligible: true, score: 50 },
        { name: 'D', eligible: true, score: 80 }
    ])
    assert.deepEqual(ranked.map(r => r.name), ['D', 'A', 'C', 'B'])
})

test('parsers', () => {
    assert.equal(L.parseBeeLevel('Level 2'), 2)
    assert.equal(L.parseBeeLevel('5+'), 5)
    assert.equal(L.parseBeeLevel(''), null)
    assert.equal(L.parsePercent('51%'), 51)
    assert.equal(L.parsePercent(''), null)
    assert.equal(L.yesNo('Yes'), true)
    assert.equal(L.yesNo('no'), false)
    assert.equal(L.yesNo(''), null)
})

test('an unknown CSD status is not reported as unregistered', () => {
    const p = L.buildPassport(base({
        registrations: { incomeTaxNumber: '', vatNumber: '', csdNumber: '', taxCompliancePin: 'X' },
        capability: { csdRegistered: null, capacity: null, tradeReferences: null, clientList: null }
    }))
    assert.deepEqual(L.matchOpportunity(p, req({ requireCsd: true }), null).gaps, ['No CSD number captured'])
})

test('a captured tax PIN or VAT number meets those document requirements', () => {
    const p = L.buildPassport(base({
        registrations: { incomeTaxNumber: '', vatNumber: '4123456789', csdNumber: 'MAAA0123456', taxCompliancePin: 'AB12CD34EF' },
        compliance: [
            doc('cipc', 'CIPC Registration Docs', 'valid'),
            doc('tcs', 'SARS Tax Compliance Status (TCS) PIN', 'missing'),
            doc('vat', 'VAT Registration (if applicable)', 'missing'),
            doc('bank', 'Bank Confirmation Letter', 'missing')
        ]
    }))
    assert.equal(p.compliance.current, 3)
    assert.deepEqual(p.compliance.items.map(i => i.status), ['valid', 'captured', 'captured', 'missing'])
    assert.deepEqual(p.nextSteps, ['Bank Confirmation Letter: not uploaded'])
})

test('a non-compliant B-BBEE status is reported as such, not as missing', () => {
    const p = L.buildPassport(base({ beeLevel: null, beeNonCompliant: true }))
    assert.deepEqual(L.matchOpportunity(p, req({ maxBeeLevel: 2 }), null).gaps, ['Not B-BBEE compliant'])
    const unknown = L.buildPassport(base({ beeLevel: null }))
    assert.deepEqual(L.matchOpportunity(unknown, req({ maxBeeLevel: 2 }), null).gaps, ['B-BBEE level not captured'])
})

test('the score comes with its breakdown, and the parts add up', () => {
    const m = L.matchOpportunity(L.buildPassport(base({ risk: { score: 80, level: 'High' } })), req({ ownership: { black: 51 } }), null)
    assert.deepEqual(m.scoreParts, [
        { label: 'Readiness: Developing', points: 35 },
        { label: 'Any sector accepted', points: 5 },
        { label: 'Any location accepted', points: 5 },
        { label: '100% black-owned', points: 3 },
        { label: 'High risk', points: -10 }
    ])
    assert.equal(m.score, 38)
})
