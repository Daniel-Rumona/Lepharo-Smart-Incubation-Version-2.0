const test=require('node:test');
const assert=require('node:assert/strict');
const {loadTs}=require('../../../scripts/digital-twin/validate.cjs');
const {buildProcessTwin,emptySources,twinAccess}=loadTs('src/services/digitalTwin/processTwin.ts');
const {generate,REF,RUN,BRANCHES,PROGRAM_BRANCHES}=require('../../../scripts/digital-twin/dataset.cjs');
const {build}=require('../../../scripts/digital-twin/seed-walkins.cjs');
const now=Date.parse(REF);
test('hand-specified records separate delivered work, approval and negative outcomes',()=>{
    const s=emptySources();
    s.assignedInterventions=[{id:'a',programId:'p',branchId:'b',assignmentStatus:'completed',participantName:'Example',completedAt:new Date(now-86400000)}];
    s.movDocuments=[{id:'m',programId:'p',branchId:'b',assignedInterventionId:'a',status:'awaiting_hod',updatedAt:new Date(now)}];
    s.outcomeFollowUps=[{id:'f',programId:'p',assignedInterventionId:'a',answer:'not_yet',smeAnswer:'not_yet'}];
    const m=buildProcessTwin(s,{programId:'p',branchId:'b'},now);
    assert.equal(m.lanes[0].stages.find(x=>x.key==='completed').items.length,1);
    assert.equal(m.lanes[1].stages.find(x=>x.key==='awaiting_hod').items.length,1);
    assert.equal(m.lanes[2].stages.find(x=>x.key==='not_yet').items.length,1);
    assert.equal(m.items.find(i=>i.id==='m').enteredAt,null,'updatedAt must not manufacture stage history');
});
test('disagreement and unknown remain distinct from failure',()=>{
    const s=emptySources();s.assignedInterventions=[{id:'a',programId:'p',branchId:'b'}];
    s.outcomeFollowUps=[{id:'dispute',assignedInterventionId:'a',programId:'p',answer:'achieved',smeAnswer:'not_yet'}, {id:'unknown',assignedInterventionId:'a',programId:'p'}, {id:'due',assignedInterventionId:'a',programId:'p',dueAt:new Date(now-1)}];
    const m=buildProcessTwin(s,{programId:'p'},now);
    assert.equal(m.items.find(i=>i.id==='dispute').stage,'disputed');
    assert.equal(m.items.find(i=>i.id==='unknown').stage,'unknown');
    assert.equal(m.items.find(i=>i.id==='due').stage,'due');
});
test('scope and broken links fail closed',()=>{
    const s=emptySources();s.assignedInterventions=[{id:'a',programId:'p',branchId:'b'}, {id:'foreign',programId:'p',branchId:'other'}];
    s.movDocuments=[{id:'wrong-branch',programId:'p',branchId:'other',assignedInterventionId:'a'}, {id:'orphan',programId:'p',assignedInterventionId:'missing'}];
    const m=buildProcessTwin(s,{programId:'p',branchId:'b'},now);
    assert.deepEqual(m.assignments.map(a=>a.id),['a']); assert.equal(m.movs.length,0); assert.equal(m.issues.length,2);
    assert.equal(twinAccess({role:'projectadmin'}).allowed,false);
    assert.equal(twinAccess({role:'incubatee'}).allowed,false);
    assert.deepEqual(twinAccess({role:'projectadmin',assignedBranch:{id:'b'}}),{allowed:true,branchId:'b',centreOnly:true});
});
test('full seeded fixture conserves assignments and shared sessions; reception is not extra attendance',()=>{
    const d=generate(), records=[...d.records,...build(d.records).records], s=emptySources();
    for(const r of records){const [collection]=r.path.split('/');if(collection in s)s[collection].push(r.data)}
    let assignments=0,sessions=0,attended=0,visits=0;
    for(let i=0;i<2;i++){
        const m=buildProcessTwin(s,{programId:`${RUN}_program_${i}`,branchId:PROGRAM_BRANCHES[i].id},now);
        assignments+=m.assignments.length;sessions+=m.sessions.length;attended+=m.attended;visits+=m.inquiries.length;
        assert.equal(m.issues.length,0);
        assert.equal(m.lanes[0].stages.reduce((n,x)=>n+x.items.length,0),m.assignments.length);
        assert.ok(m.items.every(x=>x.synthetic));
    }
    assert.equal(assignments,300);assert.equal(sessions,275);assert.equal(attended,235);assert.equal(visits,235);
});

test('response wait uses the current pending invitation creation, never the session or update date',()=>{
 const s=emptySources();s.assignedInterventions=[{id:'a',programId:'p',participantAcceptanceStatus:'pending',lastAppointmentId:'invite'}];
 s.appointmentSessions=[{id:'session',programId:'p',startAt:new Date(now+86400000),status:'scheduled'}];
 s.appointments=[{id:'invite',programId:'p',assignedInterventionId:'a',appointmentSessionId:'session',smeConfirmation:'pending',createdAt:new Date(now-86400000),updatedAt:new Date(now)}];
 const item=()=>buildProcessTwin(s,{programId:'p'},now).items.find(i=>i.id==='a');
 assert.equal(item().enteredAt,now-86400000);
 s.appointments[0].createdAt=null;assert.equal(item().enteredAt,null);
 s.appointments[0].createdAt=new Date(now-86400000);s.appointments[0].status='cancelled';assert.equal(item().enteredAt,null);
 delete s.appointments[0].status;delete s.assignedInterventions[0].lastAppointmentId;
 assert.equal(item().enteredAt,now-86400000);
 s.appointments.push({...s.appointments[0],id:'other'});assert.equal(item().enteredAt,null);
 s.assignedInterventions[0].lastAppointmentId='missing';assert.equal(item().enteredAt,null);
});

test('evidence dates use creation and explicit pack approvals, not later edits',()=>{
 const s=emptySources();s.assignedInterventions=[{id:'a',programId:'p'}];
 s.movDocuments=[{id:'m',programId:'p',assignedInterventionId:'a',status:'awaiting_smme',createdAt:new Date(now-1000)}];
 const item=()=>buildProcessTwin(s,{programId:'p'},now).items.find(i=>i.id==='m');
 assert.equal(item().enteredAt,now-1000);
 s.movDocuments[0].status='approved';s.movDocuments[0].consolidatedMovId='pack';
 s.consolidatedMOVs=[{id:'pack',programId:'p',status:'submitted_to_me',interventions:[{id:'m'}],createdAt:new Date(now-500),updatedAt:new Date(now)}];
 assert.equal(item().stage,'in_pack');assert.equal(item().enteredAt,now-500);
 s.consolidatedMOVs[0].status='confirmed';s.consolidatedMOVs[0].approvals=[{step:'final_confirmation',date:new Date(now-200)}];
 assert.equal(item().enteredAt,now-200);
});


test('a MOV with a missing or unrecognised status is flagged, never counted as an evidence stage',()=>{
    const s=emptySources();
    s.assignedInterventions=[{id:'a',programId:'p',branchId:'b',assignmentStatus:'completed',participantName:'Example'}];
    s.movDocuments=[{id:'ok',programId:'p',branchId:'b',assignedInterventionId:'a',status:'awaiting_smme',createdAt:new Date(now)},{id:'draft',programId:'p',branchId:'b',assignedInterventionId:'a',status:'draft'},{id:'blank',programId:'p',branchId:'b',assignedInterventionId:'a'}];
    const m=buildProcessTwin(s,{programId:'p',branchId:'b'},now);
    assert.deepEqual(m.items.filter(i=>i.collection==='movDocuments').map(i=>i.id),['ok']);
    assert.equal(m.lanes[1].stages.some(x=>x.key==='unrecognised'||x.key==='draft'),false);
    assert.deepEqual(m.issues.filter(i=>i.collection==='movDocuments').map(i=>i.id).sort(),['blank','draft']);
});

test('the Control Tower reports a MOV with an unrecognised status as a data problem instead of chasing it',()=>{
    const {buildTowerModel}=loadTs('src/services/interventionTower.ts');
    const old=new Date(now-90*86400000);
    const t=buildTowerModel({assignments:[],packs:[],now,movs:[{id:'ok',status:'awaiting_smme',createdAt:old},{id:'draft',status:'draft',createdAt:old},{id:'blank',createdAt:old}]});
    assert.equal(t.totals.unrecognisedMovs,2);
    assert.deepEqual(t.stuck.map(s=>s.movId),['ok'],'only the real awaiting-SME MOV is chased');
});
test('an excluded MOV is listed with who and what it is about',()=>{
    const s=emptySources();
    s.assignedInterventions=[{id:'a',programId:'p',branchId:'b',participantName:'Example SME',interventionTitle:'Cash Flow'}];
    s.movDocuments=[{id:'m',programId:'p',branchId:'b',assignedInterventionId:'a',status:'draft'}];
    const m=buildProcessTwin(s,{programId:'p',branchId:'b'},now);
    assert.equal(m.issues[0].label,'Example SME · Cash Flow');
});
