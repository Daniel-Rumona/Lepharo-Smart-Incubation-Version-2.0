const test = require('node:test')
const assert = require('node:assert/strict')
const { loadTs } = require('../../../scripts/digital-twin/validate.cjs')
const { buildStageFacts, starterQuestions } = loadTs('src/services/digitalTwin/twinAsk.ts')

const DAY = 86400000
const clock = Date.UTC(2026, 9, 29)
const item = (owner, daysAgo) => ({ owner, enteredAt: daysAgo === null ? null : clock - daysAgo * DAY })
const groups = [
    { id: 'delivery', label: 'Deliver support', lane: 'delivery', hint: 'Facilitator', items: [item('Thabo', 3), item('Thabo', 9), item('Lerato', 1)] },
    { id: 'hod', label: 'HOD approval', lane: 'evidence', hint: 'Head of department', items: [item('Head of department', 23), item('Head of department', 16), item('None', null)] },
    { id: 'cc', label: 'Centre coordination', lane: 'evidence', hint: 'Pack preparation / CC', items: [] },
    { id: 'completed', label: 'Delivery completed', lane: 'delivery', hint: 'Confirmed assignments', items: [item('None', 30)] },
    { id: 'queried', label: 'Queried', lane: 'evidence', hint: 'Evidence exception', items: [item('Thabo', 5)] },
    { id: 'rejected', label: 'Rejected', lane: 'evidence', hint: 'Evidence exception', items: [] }
]

test('stage facts: the flow in order, plus exceptions only when something is in them', () => {
    const facts = buildStageFacts(groups, clock)
    assert.deepEqual(facts.map(f => f.key), ['delivery', 'hod', 'cc', 'queried'])
    const hod = facts.find(f => f.key === 'hod')
    assert.equal(hod.count, 3)
    assert.equal(hod.oldestWaitDays, 23)
    assert.equal(hod.overTwoWeeks, 2)
    assert.deepEqual(hod.whoActs, ['Head of department'])
    const delivery = facts.find(f => f.key === 'delivery')
    assert.deepEqual(delivery.whoActs, ['Thabo', 'Lerato'])
    assert.equal(facts.find(f => f.key === 'cc').oldestWaitDays, null)
})

test('starter questions point at the slowest stage, long waits and a what-if for the busiest team', () => {
    const questions = starterQuestions(buildStageFacts(groups, clock))
    assert.deepEqual(questions, [
        'Why are things waiting at HOD approval?',
        'What has waited more than two weeks?',
        'What if facilitators had 8 more hours a week?'
    ])
})

test('with nothing waiting long there is still something to ask', () => {
    const questions = starterQuestions([])
    assert.equal(questions.length, 2)
    assert.equal(questions[0], 'Where is the most work waiting?')
})
