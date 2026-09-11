const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const Module = require('node:module')
const path = require('node:path')
const ts = require('typescript')

const filename = path.join(__dirname, 'appointmentMemberStatus.ts')
const loaded = new Module(filename, module)
loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText, filename)
const { appointmentMemberStatus } = loaded.exports

test('attended without an RSVP preserves RSVP truth and shows attendance', () => {
    const status = appointmentMemberStatus('pending', 'attended', true)
    assert.deepEqual(status.rsvp, { label: 'No RSVP', color: 'warning' })
    assert.deepEqual(status.attendance, { label: 'Attended', color: 'success' })
})

test('held meeting with a recorded no-show is not left as Pending', () => {
    const status = appointmentMemberStatus('pending', 'no_show', true)
    assert.equal(status.rsvp.label, 'No RSVP')
    assert.deepEqual(status.attendance, { label: 'Did not attend', color: 'error' })
})

test('held alone does not fabricate attendance', () => {
    const status = appointmentMemberStatus('pending', 'unverified', true)
    assert.equal(status.rsvp.label, 'No RSVP')
    assert.equal(status.attendance.label, 'Attendance not recorded')
})

test('future pending RSVP remains awaiting and confirmed or declined are retained', () => {
    assert.equal(appointmentMemberStatus('pending', 'unverified', null).rsvp.label, 'Awaiting RSVP')
    assert.equal(appointmentMemberStatus('confirmed', 'no_show', true).rsvp.label, 'Confirmed')
    assert.equal(appointmentMemberStatus('declined', 'unverified', null).rsvp.label, 'Declined')
})

test('a not-held meeting is distinct from SME non-attendance', () => {
    assert.equal(appointmentMemberStatus('pending', 'unverified', false).attendance.label, 'Meeting not held')
})
