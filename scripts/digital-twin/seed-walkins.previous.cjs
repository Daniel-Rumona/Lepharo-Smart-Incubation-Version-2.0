// Additive extension: never changes the original seed or appointment attendance.
require('../node26-shim.cjs');
const admin = require('firebase-admin');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {RUN, REF, generate, hash, encode, BRANCHES, DEPARTMENTS} = require('./dataset.cjs');
const EXT = 'dtseed_20261009_walkins_v1';
const out = path.resolve(__dirname, '../../artifacts/digital-twin');
const save = (name, value) => {fs.mkdirSync(out, {recursive:true}); fs.writeFileSync(path.join(out,name), JSON.stringify(encode(value),null,2)+'\n')};
const metadata = {dataOrigin:'synthetic', suppressNotifications:true, seedRunId:EXT, parentSeedRunId:RUN, generatorVersion:'1.0.0'};
function build(records) {
  const byPath = new Map(records.map(r=>[r.path,r.data]));
  const result = [], excluded = {}, countsByBranch = {};
  const actors = new Map(BRANCHES.map((b,i)=>[b.id, `${EXT}_reception_${i}`]));
  for(const [branchId,id] of actors) result.push({path:`syntheticActors/${id}`,data:{...metadata,id,uid:id,name:'[DEMO] Reception seeder',role:'receptionist',branchId,email:'',phone:'',scenarioKey:'reception_history',createdAt:admin.firestore.Timestamp.fromDate(new Date(REF))}});
  for(const r of records.filter(r=>r.path.startsWith('appointments/'))) {
    const a=r.data, s=byPath.get(`appointmentSessions/${a.appointmentSessionId}`), p=byPath.get(`participants/${a.smeId}`);
    assert.ok(s && p, `Missing link: ${r.path}`);
    assert.equal(a.seedRunId,RUN); assert.equal(s.seedRunId,RUN); assert.equal(p.seedRunId,RUN);
    let reason = null;
    if(s.deliveryMethod!=='in_person') reason='not_in_person';
    else if(s.startAt.toMillis()>Date.parse(REF)) reason='future';
    else if(a.status==='cancelled'||s.status==='cancelled') reason='cancelled_or_declined';
    else if(a.attendance?.status!=='attended') reason='not_attended';
    if(reason) {excluded[reason]=(excluded[reason]||0)+1; continue;}
    const arrival=a.attendance.checkedInAt, departure=a.attendance.checkedOutAt;
    assert.ok(arrival && departure && arrival.toMillis()<=departure.toMillis() && departure.toMillis()<=Date.parse(REF));
    assert.equal(a.branchId,s.branchId); assert.equal(a.programId,p.programId);
    const actor=actors.get(a.branchId); assert.ok(actor);
    const id=`${EXT}_${a.id.replace(`${RUN}_appointment_`,'')}`;
    const department=DEPARTMENTS.find(d=>d.id===a.departmentId); assert.ok(department);
    const description=`[DEMO] Historical walk-in for ${a.interventionTitle}. Attended the in-person session at ${s.location}. Reception visit completed; intervention verification and business outcomes remain recorded separately.`;
    result.push({path:`inquiries/${id}`,data:{...metadata,id,scenarioKey:a.scenarioKey,
      branchId:a.branchId,programId:a.programId,programName:p.programName,participantId:a.smeId,
      source:'Walk-in',sourceType:'Incubatee',isRepresentative:false,classification:'General',priority:'Medium',status:'Resolved',isActive:true,
      submittedBy:actor,submittedByName:'[DEMO] Reception seeder',submittedByActorCollection:'syntheticActors',submittedAt:arrival,createdAt:arrival,updatedAt:departure,
      contactInfo:{firstName:'[DEMO]',lastName:p.businessName.replace(/^\[DEMO\]\s*/,''),company:p.businessName,email:p.email,phone:''},
      inquiryDetails:{inquiryType:'Other',department:department.name,description,servicesOfInterest:[]},
      followUp:null,tags:['digital-twin','synthetic','appointment-walk-in'],
      appointmentId:a.id,appointmentSessionId:a.appointmentSessionId,assignedInterventionId:a.assignedInterventionId,departmentId:a.departmentId,
      visit:{checkedInAt:arrival,checkedOutAt:departure,status:'attended',location:s.location},
      statusHistory:[{status:'New',changedAt:arrival,changedBy:actor,notes:'Synthetic historical reception arrival.'},{status:'Resolved',changedAt:departure,changedBy:actor,notes:'Visit attended and completed. This does not assert a successful business outcome.'}],
    }});
    countsByBranch[a.branchId]=(countsByBranch[a.branchId]||0)+1;
  }
  assert.equal(new Set(result.map(r=>r.path)).size,result.length);
  return {records:result,summary:{seedRunId:EXT,parentSeedRunId:RUN,inquiries:result.length-actors.size,syntheticActors:actors.size,excluded,countsByBranch}};
}
async function readAll(db, refs) {
  const result=[];
  for(let i=0;i<refs.length;i+=150) result.push(...await db.getAll(...refs.slice(i,i+150)));
  return result;
}
async function main() {
  const local=generate(), planned=build(local.records);
  if(process.argv.includes('--local-only')) {save('walkins-local.json',planned.summary); console.log(JSON.stringify(planned.summary)); return;}
  const key=require('../serviceAccountKey.json'); assert.equal(key.project_id,'lepharo-smart-inc');
  const app=admin.initializeApp({credential:admin.credential.cert(key)}), db=app.firestore();
  try {
    const source=local.records.filter(r=>/^(appointments|appointmentSessions|participants)\//.test(r.path));
    const live=await readAll(db,source.map(r=>db.doc(r.path)));
    const sourceRecords=live.map((s,i)=>{assert.ok(s.exists); assert.equal(hash(s.data()),hash(source[i].data),`Source drift: ${s.ref.path}`); return {path:s.ref.path,data:s.data()}});
    const data=build(sourceRecords), digest=hash(data.records), manifestRef=db.doc(`syntheticSeedRuns/${EXT}`);
    const [manifest, inquiries, actors]=await Promise.all([manifestRef.get(),db.collection('inquiries').get(),db.collection('syntheticActors').where('seedRunId','==',EXT).get()]);
    const existing=new Map([...inquiries.docs,...actors.docs].map(d=>[d.ref.path,d]));
    const expected=new Map(data.records.map(r=>[r.path,r]));
    for(const d of inquiries.docs) if(!expected.has(d.ref.path) && d.data().appointmentId?.startsWith(RUN)) throw new Error(`Existing linked inquiry requires reconciliation: ${d.id}`);
    const absent=[];
    for(const r of data.records) {
      const old=existing.get(r.path);
      if(old) assert.equal(hash(old.data()),hash(r.data),`Existing document differs: ${r.path}`);
      else absent.push(r);
    }
    const baseline=manifest.exists?manifest.data().baseline:Object.fromEntries(inquiries.docs.filter(d=>!expected.has(d.ref.path)).map(d=>[d.ref.path,hash(d.data())]));
    if(manifest.exists) assert.equal(manifest.data().datasetHash,digest);
    for(const [p,h] of Object.entries(baseline)) assert.equal(hash(existing.get(p)?.data()),h,`Original inquiry changed: ${p}`);
    save('walkins-dry-run.json',{...data.summary,toCreate:absent.length,datasetHash:digest,originalInquiries:Object.keys(baseline).length});
    if(process.argv.includes('--apply')) {
      assert.ok(process.argv.includes(`--confirm=${EXT}`),'Explicit dataset confirmation required');
      const inventory=JSON.parse(fs.readFileSync(path.join(out,'deployed-functions.json'),'utf8'));
      for(const [id,file] of [['onInquiryCreatedNotifyStaff','emailInquiries.ts'],['notifyInquirySpecialist','inquiryReferral.ts']]) {
        const f=inventory.find(f=>f.id===id&&f.region==='us-central1');
        assert.ok(f?.state==='ACTIVE' && Date.parse(f.updatedAt)>Math.max(...[file,'syntheticData.ts'].map(x=>fs.statSync(path.resolve(__dirname,'../../functions/src',x)).mtimeMs)),`Safeguard deployment not verified: ${id}`);
      }
      if(!manifest.exists) await manifestRef.create({...metadata,status:'applying',startedAt:admin.firestore.Timestamp.now(),datasetHash:digest,baseline,summary:data.summary});
      for(let i=0;i<absent.length;i+=100) {const b=db.batch(); for(const r of absent.slice(i,i+100)) b.create(db.doc(r.path),r.data); await b.commit();}
      await manifestRef.update({status:'complete',completedAt:admin.firestore.Timestamp.now()});
    }
    if(process.argv.includes('--verify')||process.argv.includes('--apply')) {
      const verified=await readAll(db,data.records.map(r=>db.doc(r.path)));
      verified.forEach((d,i)=>assert.equal(hash(d.data()),hash(data.records[i].data),`Readback drift: ${d.ref.path}`));
      const originals=await readAll(db,Object.keys(baseline).map(p=>db.doc(p)));
      originals.forEach(d=>assert.equal(hash(d.data()),baseline[d.ref.path],`Original modified: ${d.ref.path}`));
      const sourceAfter=await readAll(db,source.map(r=>db.doc(r.path)));
      sourceAfter.forEach((d,i)=>assert.equal(hash(d.data()),hash(source[i].data),`Source changed: ${d.ref.path}`));
      save('walkins-verification.json',{...data.summary,verifiedAt:new Date().toISOString(),verifiedDocuments:verified.length,originalInquiriesUnchanged:originals.length,sourceDocumentsUnchanged:sourceAfter.length});
    }
    console.log(JSON.stringify({...data.summary,toCreate:absent.length,applied:process.argv.includes('--apply'),verified:process.argv.includes('--verify')||process.argv.includes('--apply')}));
  } finally {await app.delete();}
}
module.exports={build,EXT};
if(require.main===module) main().catch(e=>{console.error(e.message);process.exitCode=1});
