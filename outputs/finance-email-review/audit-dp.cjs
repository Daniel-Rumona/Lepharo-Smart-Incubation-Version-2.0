const fs=require('fs');const {createRequire}=require('module');
const requireRepo=createRequire(process.cwd()+'/package.json');
const buffer=require('buffer');if(!buffer.SlowBuffer)buffer.SlowBuffer=buffer.Buffer;
const admin=requireRepo('firebase-admin');
async function main(){
admin.initializeApp({credential:admin.credential.cert(JSON.parse(fs.readFileSync('scripts/serviceAccountKey.json')))});
const out={};for(const name of ['diagnosticPlans','departments','applications']){const snap=await admin.firestore().collection(name).get();out[name]=snap.docs.map(d=>({...d.data(),id:d.id}));}
fs.writeFileSync('outputs/finance-email-review/dp-source.json',JSON.stringify(out,null,2));
console.log(JSON.stringify(Object.fromEntries(Object.entries(out).map(([k,v])=>[k,v.length]))));await admin.app().delete();
}main().catch(e=>{console.error(e.message);process.exit(1)});
