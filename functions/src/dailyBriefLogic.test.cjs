const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const Module = require('node:module')
const test = require('node:test')
const ts = require('typescript')

const sourcePath = join(__dirname, 'dailyBriefLogic.ts')
const mod = new Module(sourcePath, module)
mod._compile(ts.transpileModule(readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText, sourcePath)
const L = mod.exports

const item = (category, title, createdAt, extra = {}) => ({ category, title, detail: '', link: '/operations/movs', dedupeKey: title, createdAt, ...extra })

test('repeated reminders collapse to the newest, grouped in a fixed order', () => {
    const brief = L.buildBrief([
        item('notification', 'Resource request approved', 5),
        item('mov', 'MOVs waiting for HOD', 1, { detail: '3 waiting', dedupeKey: 'hod' }),
        item('mov', 'MOVs waiting for HOD', 9, { detail: '5 waiting', dedupeKey: 'hod' }),
        item('devplan', 'Development plans to confirm', 4)
    ], '2026-11-02')
    assert.deepEqual(brief.sections.map(s => s.key), ['mov', 'devplan', 'notification'])
    assert.equal(brief.sections[0].items.length, 1)
    assert.equal(brief.sections[0].items[0].detail, '5 waiting')
    assert.equal(brief.total, 3)
})

test('an empty day has no sections', () => {
    assert.deepEqual(L.buildBrief([], '2026-11-02'), { date: '2026-11-02', sections: [], total: 0 })
})

test('sections are capped so a brief stays short', () => {
    const many = Array.from({ length: 12 }, (_, i) => item('notification', `Note ${i}`, i))
    assert.equal(L.buildBrief(many, '2026-11-02').sections[0].items.length, 8)
})

test('the email links every item, escapes content and says how to turn it off', () => {
    const brief = L.buildBrief([item('mov', 'MOVs <waiting>', 1, { detail: 'A & B', link: '/operations/movs' })], '2026-11-02')
    const email = L.renderBriefEmail('Thandi Mokoena', brief, 'https://app.example/')
    assert.equal(email.subject, 'Your daily brief: 1 thing for Monday, 2 November')
    assert.ok(email.html.includes('Good morning Thandi'))
    assert.ok(email.html.includes('href="https://app.example/operations/movs"'))
    assert.ok(email.html.includes('MOVs &lt;waiting&gt;'))
    assert.ok(email.html.includes('A &amp; B'))
    assert.ok(email.text.includes('- MOVs <waiting> (A & B): https://app.example/operations/movs'))
    assert.ok(email.text.includes('Turn it off'))
})

test('the brief day is counted in South African time', () => {
    assert.equal(L.sastDate(Date.UTC(2026, 10, 1, 23, 0)), '2026-11-02')
    assert.equal(L.sastDate(Date.UTC(2026, 10, 2, 8, 0)), '2026-11-02')
})
