const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('typescript')

function load(file) {
    const filename = path.resolve(__dirname, file)
    const loaded = new Module(filename, module)
    loaded.paths = module.paths
    loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        fileName: filename,
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
    }).outputText, filename)
    return loaded.exports
}

const {
    buildCycle, cycleForDate, defaultCompactContent, weightProblems, weightedScore,
    headlineScore, compactFromLegacy, ratingLabel, compactStatus, compactStatusMeta, balanceWeights, agreementKey
} = load('./ipm.ts')

test('the compact status follows the signatures', () => {
    const sig = { uid: 'u', name: 'N', at: '2026-04-01T00:00:00Z' }
    assert.equal(compactStatus({}), 'draft')
    assert.equal(compactStatus({ manager: sig }), 'awaiting-employee')
    assert.equal(compactStatus({ employee: sig }), 'awaiting-manager')
    assert.equal(compactStatus({ manager: sig, employee: sig }), 'agreed')
    assert.equal(compactStatus({ manager: sig, employee: sig, hr: sig }), 'hr-checked')
    // An HR check without both parties does not count.
    assert.equal(compactStatus({ manager: sig, hr: sig }), 'awaiting-employee')
})

test('older free-text statuses still get a label', () => {
    assert.equal(compactStatusMeta('ceo-assured').label, 'CEO assured')
    assert.equal(compactStatusMeta('agreed').label, 'Agreed')
    assert.equal(compactStatusMeta(undefined).label, 'Draft')
})

test('balancing spreads 100% in whole numbers', () => {
    assert.deepEqual(balanceWeights([{ weight: 0 }, { weight: 0 }, { weight: 0 }]).map(i => i.weight), [34, 33, 33])
    assert.deepEqual(balanceWeights([{ weight: 70 }, { weight: 10 }]).map(i => i.weight), [50, 50])
    assert.deepEqual(balanceWeights([]), [])
})

test('only targets and weights are part of the agreement', () => {
    const content = defaultCompactContent()
    const rated = { ...content, reviews: { midYear: { ratings: { scorecard: { final: 4 } } } }, pdp: [{ id: 'g' }] }
    assert.equal(agreementKey(content), agreementKey(rated))
    const changed = { ...content, items: content.items.map((item, i) => (i === 0 ? { ...item, target: '95%' } : item)) }
    assert.notEqual(agreementKey(content), agreementKey(changed))
})

test('the default cycle runs April to March with toolkit windows', () => {
    const cycle = buildCycle(2026)
    assert.equal(cycle.id, 'FY2026-27')
    assert.equal(cycle.label, 'FY2026/27')
    assert.equal(cycle.startDate, '2026-04-01')
    assert.equal(cycle.endDate, '2027-03-31')
    assert.deepEqual(cycle.windows.compacting, { from: '2026-03-15', to: '2026-04-15' })
    assert.deepEqual(cycle.windows.midYear, { from: '2026-09-01', to: '2026-09-30' })
    assert.deepEqual(cycle.windows.yearEnd, { from: '2027-03-01', to: '2027-04-30' })
})

test('a different start month shifts the whole cycle', () => {
    const cycle = buildCycle(2026, 1)
    assert.equal(cycle.label, 'FY2026')
    assert.equal(cycle.endDate, '2026-12-31')
    assert.deepEqual(cycle.windows.compacting, { from: '2025-12-15', to: '2026-01-15' })
    assert.deepEqual(cycle.windows.yearEnd, { from: '2026-12-01', to: '2027-01-31' })
})

test('dates map to the cycle that contains them', () => {
    assert.equal(cycleForDate('2026-10-30').id, 'FY2026-27')
    assert.equal(cycleForDate('2027-03-31').id, 'FY2026-27')
    assert.equal(cycleForDate('2027-04-01').id, 'FY2027-28')
    assert.equal(cycleForDate('2026-02-01').id, 'FY2025-26')
})

test('the default template has valid weights', () => {
    const { sectionWeights, items } = defaultCompactContent()
    assert.deepEqual(weightProblems(sectionWeights, items), [])
})

test('weight problems are reported per section', () => {
    const { items } = defaultCompactContent()
    const weights = { strategic: 30, management: 60, milestones: 0, competencies: 0 }
    const problems = weightProblems(weights, items)
    assert.ok(problems.some(p => p.includes('add up to 90%')))
    assert.ok(problems.some(p => p.includes('Strategic KPAs is weighted 30% but has no items')))

    const uneven = items.map((item, i) => (i === 0 ? { ...item, weight: 30 } : item))
    assert.ok(weightProblems({ strategic: 0, management: 100, milestones: 0, competencies: 0 }, uneven)
        .some(p => p.includes('item weights add up to 110%')))
})

test('scores are weighted by section and item', () => {
    const weights = { strategic: 60, management: 40, milestones: 0, competencies: 0 }
    const items = [
        { id: 'a', section: 'strategic', kpa: 'A', weight: 50 },
        { id: 'b', section: 'strategic', kpa: 'B', weight: 50 },
        { id: 'c', section: 'management', kpa: 'C', weight: 100 }
    ]
    const ratings = { a: { final: 5 }, b: { final: 3 }, c: { final: 2 } }
    // 0.6 * (0.5*5 + 0.5*3) + 0.4 * 2 = 2.4 + 0.8
    assert.deepEqual(weightedScore(weights, items, ratings), { score: 3.2, partial: 3.2, rated: 3, total: 3 })
})

test('an incomplete review has a partial score only', () => {
    const { sectionWeights, items } = defaultCompactContent()
    const result = weightedScore(sectionWeights, items, { scorecard: { final: 4 }, grc: { final: 2 } })
    assert.equal(result.score, null)
    assert.equal(result.partial, 3)
    assert.equal(result.rated, 2)
    assert.equal(result.total, 5)
})

test('invalid weights cannot be scored', () => {
    const { items } = defaultCompactContent()
    const ratings = Object.fromEntries(items.map(item => [item.id, { final: 4 }]))
    assert.equal(weightedScore({ strategic: 0, management: 90, milestones: 0, competencies: 0 }, items, ratings).score, null)
})

test('the headline score prefers year-end', () => {
    assert.deepEqual(headlineScore({ midYear: { ratings: {}, score: 3 }, yearEnd: { ratings: {}, score: 4.2 } }), { score: 4.2, phase: 'yearEnd' })
    assert.deepEqual(headlineScore({ midYear: { ratings: {}, score: 3 } }), { score: 3, phase: 'midYear' })
    assert.deepEqual(headlineScore({}), { score: null, phase: null })
})

test('legacy compacts seed the newest rating per phase', () => {
    const full = rating => Object.fromEntries(['scorecard', 'grc', 'procurement', 'people', 'deliverables'].map(k => [k, { final: rating }]))
    const content = compactFromLegacy([
        { phase: 'midYear', ratings: full(2), createdAtText: '2026-09-01' },
        { phase: 'midYear', ratings: full(4), createdAtText: '2026-09-20' },
        { phase: 'yearEnd', ratings: { scorecard: { final: 5 } }, createdAtText: '2027-03-10' }
    ])
    assert.equal(content.reviews.midYear.score, 4)
    assert.equal(content.reviews.yearEnd.score, null)
    assert.equal(content.reviews.yearEnd.ratings.scorecard.final, 5)
})

test('rating labels follow the compact scale', () => {
    assert.equal(ratingLabel(1.2), 'Very Unsatisfactory')
    assert.equal(ratingLabel(3.2), 'Satisfactory')
    assert.equal(ratingLabel(4.6), 'Exceptional')
    assert.equal(ratingLabel(null), 'Not Rated')
})

const { checkInCadence, openActionItems, performanceBand, pepProblems } = load('./ipm.ts')

test('a check-in is due after 14 days or when there has never been one', () => {
    assert.deepEqual(checkInCadence([], '2026-10-30'), { lastDate: null, daysSince: null, due: true })
    assert.deepEqual(checkInCadence(['2026-10-20', '2026-10-01'], '2026-10-30'), { lastDate: '2026-10-20', daysSince: 10, due: false })
    assert.equal(checkInCadence(['2026-10-16'], '2026-10-30').due, true)
    // A check-in booked for later does not count yet.
    assert.equal(checkInCadence(['2026-11-05', '2026-10-01'], '2026-10-30').lastDate, '2026-10-01')
})

test('open action items carry over, oldest first', () => {
    const items = openActionItems([
        { id: 'b', date: '2026-10-20', actionItems: [{ id: '2', text: 'Draft report', owner: 'employee' }, { id: '3', text: 'Done', owner: 'manager', done: true }] },
        { id: 'a', date: '2026-10-05', actionItems: [{ id: '1', text: 'Book course', owner: 'employee' }] }
    ])
    assert.deepEqual(items.map(i => i.text), ['Book course', 'Draft report'])
    assert.equal(items[0].checkInId, 'a')
})

test('performance bands follow the rating scale', () => {
    assert.equal(performanceBand(null), null)
    assert.equal(performanceBand(2.1), 'under')
    assert.equal(performanceBand(3.4), 'consistent')
    assert.equal(performanceBand(4.6), 'excelling')
})

test('a plan needs deficiencies, actions, a period and an outcome to finish', () => {
    const base = {
        startDate: '2026-11-01',
        endDate: '2027-01-31',
        deficiencies: [{ id: 'd', area: 'Deadlines', expected: '', actual: '' }],
        actions: [{ id: 'a', action: 'Weekly plan', owner: 'employee' }],
        status: 'active',
        outcome: null
    }
    assert.deepEqual(pepProblems(base), [])
    assert.ok(pepProblems({ ...base, deficiencies: [] }).some(p => p.includes('deficiency')))
    assert.ok(pepProblems({ ...base, endDate: '2026-10-01' }).some(p => p.includes('ends before')))
    assert.ok(pepProblems({ ...base, status: 'completed' }).some(p => p.includes('outcome')))
})

const { reviewStage, ratingGaps, phaseScore, annualScore } = load('./ipm.ts')

test('the review stage follows what has been recorded', () => {
    const sig = { uid: 'u', name: 'N', at: '2026-09-20T00:00:00Z' }
    assert.equal(reviewStage(null), 'self')
    assert.equal(reviewStage({ selfSubmittedAt: '2026-09-02' }), 'manager')
    assert.equal(reviewStage({ selfSubmittedAt: '2026-09-02', managerSubmittedAt: '2026-09-10' }), 'discussion')
    assert.equal(reviewStage({ managerSubmittedAt: 'x', dispute: { raisedBy: 'e', raisedAt: 'x', reason: 'Too low' } }), 'disputed')
    assert.equal(reviewStage({ managerSubmittedAt: 'x', dispute: { raisedBy: 'e', raisedAt: 'x', reason: 'r', resolution: 'Agreed 3' } }), 'discussion')
    assert.equal(reviewStage({ managerSubmittedAt: 'x', signoff: { manager: sig, employee: sig } }), 'calibration')
    assert.equal(reviewStage({ managerSubmittedAt: 'x', signoff: { manager: sig, employee: sig }, calibration: { score: 3 } }), 'validation')
    assert.equal(reviewStage({ validation: { by: 'ceo', at: 'x' } }), 'validated')
})

test('gaps list where self and manager ratings differ, biggest first', () => {
    const items = [{ id: 'a', kpa: 'A' }, { id: 'b', kpa: 'B' }, { id: 'c', kpa: 'C' }, { id: 'd', kpa: 'D' }]
    const gaps = ratingGaps(items, { a: { rating: 5 }, b: { rating: 3 }, c: { rating: 2 }, d: { rating: 4 } }, { a: { final: 3 }, b: { final: 3 }, c: { final: 3 } })
    assert.deepEqual(gaps.map(g => [g.itemId, g.gap]), [['a', 2], ['c', -1]])
})

test('calibration overrides the compact score', () => {
    assert.equal(phaseScore(3.4, null), 3.4)
    assert.equal(phaseScore(3.4, { calibration: { score: 3 } }), 3)
    assert.equal(phaseScore(null, {}), null)
})

test('the annual rating includes the mid-year score', () => {
    assert.equal(annualScore(3, null), 3)
    assert.equal(annualScore(null, 4), 4)
    assert.equal(annualScore(3, 4), 3.5)
    assert.equal(annualScore(null, null), null)
})

const { outstandingActions, rollUpScores } = load('./ipm.ts')

const cycle2026 = { ...buildCycle(2026), status: 'active' }
const signed = (at = '2026-04-10T08:00:00Z') => ({ uid: 'x', name: 'X', at })
const kinds = actions => actions.map(a => `${a.owner}:${a.kind}${a.phase ? `@${a.phase}` : ''}${a.overdue ? '!' : ''}`)
const agreed = { manager: signed(), employee: signed('2026-04-12T08:00:00Z') }

test('nothing is outstanding before compacting opens or once the cycle closes', () => {
    assert.deepEqual(outstandingActions(cycle2026, '2026-03-01', { uid: 'e', lineManagerId: 'm', checkInDates: [], reviews: {} }), [])
    assert.deepEqual(outstandingActions({ ...cycle2026, status: 'closed' }, '2026-05-01', { uid: 'e', lineManagerId: 'm', checkInDates: [], reviews: {} }), [])
})

test('an employee without a line manager is HR\'s to fix first', () => {
    assert.deepEqual(kinds(outstandingActions(cycle2026, '2026-04-01', { uid: 'e', checkInDates: [], reviews: {} })), ['hr:assign-manager'])
})

test('the compact is chased from whoever must sign next, overdue after the window', () => {
    const base = { uid: 'e', lineManagerId: 'm', checkInDates: [], reviews: {} }
    assert.deepEqual(kinds(outstandingActions(cycle2026, '2026-04-01', base)), ['manager:compact-manager'])
    assert.deepEqual(kinds(outstandingActions(cycle2026, '2026-04-20', base)), ['manager:compact-manager!'])
    assert.deepEqual(kinds(outstandingActions(cycle2026, '2026-04-01', { ...base, compact: { signoff: { manager: signed() } } })), ['employee:compact-employee'])
    assert.deepEqual(kinds(outstandingActions(cycle2026, '2026-04-01', { ...base, compact: { signoff: { employee: signed() } } })), ['manager:compact-manager'])
})

test('check-ins fall due 14 days after the last one, counting from agreement', () => {
    const base = { uid: 'e', lineManagerId: 'm', compact: { signoff: { ...agreed, hr: signed() } }, reviews: {} }
    assert.deepEqual(kinds(outstandingActions(cycle2026, '2026-04-20', { ...base, checkInDates: [] })), [])
    assert.deepEqual(kinds(outstandingActions(cycle2026, '2026-04-26', { ...base, checkInDates: [] })), ['employee:check-in', 'manager:check-in'])
    assert.deepEqual(kinds(outstandingActions(cycle2026, '2026-05-05', { ...base, checkInDates: ['2026-04-30'] })), [])
    // An agreed compact still waits on HR's check.
    assert.deepEqual(kinds(outstandingActions(cycle2026, '2026-04-20', { ...base, compact: { signoff: agreed }, checkInDates: [] })), ['hr:compact-hr'])
})

test('reviews: book a week ahead, then whoever holds the next step', () => {
    const base = { uid: 'e', lineManagerId: 'm', compact: { signoff: { ...agreed, hr: signed() } }, checkInDates: ['2026-08-28', '2026-09-20'] }
    assert.deepEqual(kinds(outstandingActions(cycle2026, '2026-08-20', { ...base, checkInDates: ['2026-08-15'], reviews: {} })), [])
    assert.deepEqual(kinds(outstandingActions(cycle2026, '2026-08-28', { ...base, reviews: {} })), ['manager:book-review@midYear'])
    assert.deepEqual(kinds(outstandingActions(cycle2026, '2026-09-02', { ...base, reviews: {} })), ['employee:self-assessment@midYear'])
    assert.deepEqual(kinds(outstandingActions(cycle2026, '2026-10-01', { ...base, checkInDates: ['2026-09-30'], reviews: {} })),
        ['employee:self-assessment@midYear!', 'manager:manager-assessment@midYear!'])
    const at = (review, day = '2026-09-25') => kinds(outstandingActions(cycle2026, day, { ...base, reviews: { midYear: review } }))
    assert.deepEqual(at({ selfSubmittedAt: 'x' }), ['manager:manager-assessment@midYear'])
    assert.deepEqual(at({ managerSubmittedAt: 'x', signoff: { manager: signed() } }), ['employee:sign-review@midYear'])
    assert.deepEqual(at({ managerSubmittedAt: 'x', dispute: { raisedBy: 'e', raisedAt: 'x', reason: 'r' } }), ['hr:dispute@midYear'])
    assert.deepEqual(at({ managerSubmittedAt: 'x', signoff: { manager: signed(), employee: signed() } }), ['hr:calibrate@midYear'])
    assert.deepEqual(at({ managerSubmittedAt: 'x', signoff: { manager: signed(), employee: signed() }, calibration: { score: 3 } }), ['ceo:validate@midYear'])
    assert.deepEqual(at({ validation: { by: 'ceo', at: 'x' } }), [])
})

test('scores roll up by group and for the company, unrated people excluded from averages', () => {
    const rows = [
        { score: 4, dept: 'a' }, { score: 3, dept: 'a' }, { score: null, dept: 'a' },
        { score: 2, dept: 'b' }, { score: 5, dept: null }
    ]
    const { company, groups } = rollUpScores(rows, r => (r.dept ? { key: r.dept, label: r.dept.toUpperCase() } : null))
    assert.deepEqual(company, { key: 'company', label: 'Company', count: 5, rated: 4, average: 3.5 })
    assert.deepEqual(groups.map(g => [g.label, g.count, g.rated, g.average]), [['Unassigned', 1, 1, 5], ['A', 3, 2, 3.5], ['B', 1, 1, 2]])
})
