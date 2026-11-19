const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const ts = require('typescript')
const Module = require('node:module')
const path = require('node:path')
const filename = path.join(__dirname, 'coverageTopics.ts')
const loaded = new Module(filename, module)
loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText, filename)
const { coverageTopicKey, aggregateCoverageTopics, buildCoverageTopicCatalog, canonicalizeCoverageTopics } = loaded.exports
const row = (id, points, invitation = id) => ({ id: invitation, appointmentSessionId: id, sessionCoverage: { latest: { coveredPoints: points } } })

test('unit standard variants count distinct sessions, not entries or invitations', () => {
    const first = 'Unit standard 244494- specialised fault finding and repairs to plumbing system'
    const second = 'Unit Standard 244494: Special fault finding and repairs to plumbing system.'
    const rows = [row('one', [first, second]), row('one', [second], 'another-invite'), row('two', [second])]
    const original = JSON.stringify(rows)
    assert.deepEqual(aggregateCoverageTopics(rows), [{ topic: 'Unit Standard 244494: Specialised fault finding and repairs to plumbing systems', count: 2 }])
    assert.equal(JSON.stringify(rows), original)
})

test('known safety aliases merge but numbered safety narratives stay separate', () => {
    const items = aggregateCoverageTopics([
        row('one', ['Apply and Maintain safety in a working environment']),
        row('two', ['Apply and Maintain safety in working environments.']),
        row('three', ['1. Introduction to Safety, Health and Environmental Requirements 2. Monitoring Workplace Compliance'])
    ])
    assert.equal(items.length, 2)
    assert.equal(items[0].count, 2)
})

test('minor spelling and punctuation merge without fuzzy merging different topics', () => {
    assert.equal(coverageTopicKey('  SPECIALIZED   plumbing! '), coverageTopicKey('Specialised plumbing'))
    assert.notEqual(coverageTopicKey('Safety assessment'), coverageTopicKey('Safety training'))
    assert.notEqual(coverageTopicKey('US 244494 and US 244500'), coverageTopicKey('US 244494'))
    assert.notEqual(coverageTopicKey('US 14580'), coverageTopicKey('US 244500'))
})

test('catalog and selection reuse canonical labels while preserving genuinely new topics', () => {
    const a = 'Unit Standard 244500: Install specialized hospital sanitaryware system.'
    const b = 'Unit Standard 244500: Install specialised Hospital sanitaryware systems'
    const catalog = buildCoverageTopicCatalog([a, b, '  ', 'New topic, including commas'])
    assert.equal(catalog.length, 2)
    assert.deepEqual(buildCoverageTopicCatalog([b, a]), buildCoverageTopicCatalog([a, b]))
    const selection = canonicalizeCoverageTopics([a, b, 'New topic, including commas'], catalog)
    assert.equal(selection.length, 2)
    assert.ok(selection.includes('New topic, including commas'))
    assert.deepEqual(aggregateCoverageTopics([]), [])
})
