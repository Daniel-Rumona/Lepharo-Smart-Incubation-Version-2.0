const test = require('node:test')
const assert = require('node:assert/strict')
const { loadTs } = require('../../scripts/digital-twin/validate.cjs')
const { takeSseEvents } = loadTs('src/services/sseEvents.ts')

test('complete events come out, a half-arrived one waits', () => {
    const first = takeSseEvents('data: {"type":"step","label":"Reading MOVs"}\n\ndata: {"type":"res')
    assert.deepEqual(first.events, [{ type: 'step', label: 'Reading MOVs' }])
    assert.equal(first.rest, 'data: {"type":"res')
    const second = takeSseEvents(first.rest + 'ult","data":{"answer":"Done"}}\n\n')
    assert.deepEqual(second.events, [{ type: 'result', data: { answer: 'Done' } }])
    assert.equal(second.rest, '')
})

test('Windows line endings and malformed events are handled', () => {
    const { events } = takeSseEvents('data: {"a":1}\r\n\r\ndata: not json\n\n: comment\n\ndata: {"b":2}\n\n')
    assert.deepEqual(events, [{ a: 1 }, { b: 2 }])
})
