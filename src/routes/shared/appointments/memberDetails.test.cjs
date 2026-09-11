const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')

const source = fs.readFileSync(path.join(__dirname, 'index.tsx'), 'utf8')

test('single Member segment renders independently of QR attendance', () => {
    const start = source.indexOf("detailModalTab === 'members' && (selectedAppt as any)?._displayType !== 'group'")
    const end = source.indexOf("detailModalTab === 'members' && (selectedAppt as any)?._displayType === 'group'", start)
    assert.ok(start > -1 && end > start)
    const block = source.slice(start, end)
    assert.match(block, /title=\{selectedAppt.participantName \|\| 'SME member'\}/)
    assert.match(block, /label='Appointment RSVP'/)
    assert.match(block, /label='Attendance'/)
    assert.doesNotMatch(source.slice(start, start + 180), /hasQrAttendance/)
    assert.match(block, /hasQrAttendance\(selectedAppt\).*Check-in/s)
})

test('manual and QR group member tables always show RSVP and attendance outcomes', () => {
    const start = source.indexOf("title: 'Appointment RSVP'", source.indexOf("detailModalTab === 'members'"))
    const end = source.indexOf("detailModalTab === 'food'", start)
    const block = source.slice(start, end)
    assert.match(block, /title: 'Attendance'/)
    assert.match(block, /memberRsvpTag\(selectedAppt, m\)/)
    assert.match(block, /memberAttendanceTag\(selectedAppt, m\)/)
    assert.doesNotMatch(block, /<Tag>Pending<\/Tag>/)
})

test('attendance changes display labels without writing an SME RSVP', () => {
    const coverageHandler = source.slice(source.indexOf('const saveCoverage ='), source.indexOf('const openAppointmentCompletionEvidence ='))
    assert.match(source, /RSVP Confirmed/)
    assert.match(source, /title: 'Appointment RSVP'/)
    assert.doesNotMatch(source, /SME Confirmed|SME Confirmation/)
    assert.doesNotMatch(source, />Pending<|: 'Pending'/)
    assert.doesNotMatch(coverageHandler, /smeConfirmation\s*:/)
})
