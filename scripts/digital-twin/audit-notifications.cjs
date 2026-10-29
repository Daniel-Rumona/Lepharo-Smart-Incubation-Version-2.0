require('../node26-shim.cjs')
const admin=require('firebase-admin')
const fs=require('node:fs')
const path=require('node:path')
const {RUN,BUCKET,evidenceAssets}=require('./dataset.cjs')
const out=path.resolve(__dirname,'../../artifacts/digital-twin')
const key=require('../serviceAccountKey.json')
if(key.project_id!=='lepharo-smart-inc')throw new Error('Unexpected project')
const app=admin.initializeApp({credential:admin.credential.cert(key),storageBucket:BUCKET})
const db=app.firestore()
const timer=setTimeout(()=>process.exit(1),120000)
;(async()=>{
  const run=(await db.collection('syntheticSeedRuns').doc(RUN).get()).data()
  if(!run?.startedAt)throw new Error('No seed run found')
  const since=admin.firestore.Timestamp.fromMillis(run.startedAt.toMillis()-60000)
  const findings={checkedAt:new Date().toISOString(),seedRunId:RUN,windowStart:since.toDate().toISOString(),notifications:[],emailLogs:[],evidence:[]}
  for(const collection of ['notifications','emailLogs']) {
    const snap=await db.collection(collection).where('createdAt','>=',since).get()
    for(const doc of snap.docs) {
      const text=JSON.stringify(doc.data())
      if(text.includes('dtseed_')||text.includes('@example.invalid')||text.includes('[DEMO'))findings[collection].push({id:doc.id,type:doc.data().type||null,status:doc.data().status||null})
    }
  }
  for(const asset of evidenceAssets()) {
    const response=await fetch(asset.url,{signal:AbortSignal.timeout(20000)})
    const body=await response.text()
    findings.evidence.push({path:asset.path,status:response.status,contentMatches:response.ok&&body===asset.content})
  }
  fs.writeFileSync(path.join(out,'notification-audit.json'),JSON.stringify(findings,null,2)+'\n')
  console.log(JSON.stringify(findings))
  if(findings.notifications.length||findings.emailLogs.length||findings.evidence.some(x=>!x.contentMatches))throw new Error('Seed audit needs attention')
})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(async()=>{clearTimeout(timer);await app.delete()})
