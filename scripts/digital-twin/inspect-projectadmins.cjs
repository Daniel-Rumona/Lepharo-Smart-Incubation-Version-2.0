// Read-only account/scope check. Never prints credentials or authentication tokens.
require('../node26-shim.cjs');
const admin=require('firebase-admin');
const {BRANCHES,RUN}=require('./dataset.cjs');
const key=require('../serviceAccountKey.json');
if(key.project_id!=='lepharo-smart-inc')throw new Error('Unexpected project');
const app=admin.initializeApp({credential:admin.credential.cert(key)});
(async()=>{
  const snap=await app.firestore().collection('users').where('role','==','projectadmin').get();
  const rows=[];
  for(const doc of snap.docs){
    const d=doc.data(), branchId=typeof d.assignedBranch==='string'?d.assignedBranch:d.assignedBranch?.id;
    if(!BRANCHES.some(b=>b.id===branchId))continue;
    let auth;
    try {const a=await app.auth().getUser(doc.id);auth={exists:true,disabled:a.disabled,email:a.email||null};}
    catch(e){if(e.code==='auth/user-not-found')auth={exists:false};else throw e;}
    rows.push({name:d.name||d.displayName||null,email:d.email||null,branch:BRANCHES.find(b=>b.id===branchId).name,assignedPrograms:d.assignedPrograms||[],status:d.status||null,synthetic:d.dataOrigin==='synthetic',auth});
  }
  console.log(JSON.stringify({projectId:key.project_id,seedCreatedAuthAccounts:false,programIds:[`${RUN}_program_0`,`${RUN}_program_1`],projectadmins:rows},null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(()=>app.delete());
