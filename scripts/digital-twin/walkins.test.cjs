const test=require('node:test');
const assert=require('node:assert/strict');
const {build}=require('./seed-walkins.cjs');
const {generate,hash}=require('./dataset.cjs');
test('reception history covers every attended in-person invitation without fabricating nonattendance',()=>{
  const source=generate().records, before=hash(source), {records,summary}=build(source);
  const inquiries=records.filter(r=>r.path.startsWith('inquiries/'));
  const appointments=source.filter(r=>r.path.startsWith('appointments/'));
  assert.equal(summary.inquiries,235);
  assert.deepEqual(summary.excluded,{future:15,cancelled_or_declined:30,not_attended:5});
  for(const {data:a} of appointments) {
    const matches=inquiries.filter(r=>r.data.appointmentId===a.id);
    assert.equal(matches.length,a.attendance.status==='attended'?1:0);
    if(matches.length) {
      const d=matches[0].data;
      assert.equal(d.submittedAt.toMillis(),a.attendance.checkedInAt.toMillis());
      assert.equal(d.participantId,a.smeId);
      assert.equal(d.appointmentSessionId,a.appointmentSessionId);
      assert.equal(d.source,'Walk-in'); assert.equal(d.sourceType,'Incubatee');
      assert.equal(d.status,'Resolved'); assert.equal(d.suppressNotifications,true);
    }
  }
  const groupInquiries=inquiries.filter(r=>appointments.find(a=>a.data.id===r.data.appointmentId).data.groupKey);
  assert.equal(groupInquiries.length,10);
  assert.equal(new Set(groupInquiries.map(r=>r.data.appointmentSessionId)).size,5);
  assert.equal(hash(source),before,'Original dataset must not mutate');
  assert.equal(hash(build(source)),hash(build(source)),'Deterministic retry');
});
test('broken source links fail before a partial dataset can be written',()=>{
  const source=generate().records;
  const first=source.find(r=>r.path.startsWith('appointments/'));
  assert.throws(()=>build(source.filter(r=>r.path!==`participants/${first.data.smeId}`)),/Missing link/);
});
