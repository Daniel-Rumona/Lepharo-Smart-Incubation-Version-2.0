const fs = require('fs');
const buffer = require('buffer');
if (!buffer.SlowBuffer) buffer.SlowBuffer = buffer.Buffer;
const admin = require('firebase-admin');
const env = require('dotenv').parse(fs.readFileSync('.env'));
async function main() {
  admin.initializeApp({credential: admin.credential.cert(JSON.parse(fs.readFileSync('scripts/serviceAccountKey.json')))});
  const db = admin.firestore();
  const email = env.VITE_QX_FINANCE_EMAIL || env.VITE_FINANCE_EMAIL;
  const password = env.VITE_QX_FINANCE_PASSWORD || env.VITE_FINANCE_PASSWORD;
  if (!email || !password) throw new Error('Missing finance credentials');
  const login = await fetch('https://quantnow-sa1e.onrender.com/login', {method:'POST', headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password})});
  if (!login.ok) throw new Error(`Finance login HTTP ${login.status}`);
  const {token} = await login.json();
  if (!token) throw new Error('No finance token');
  const [response,participants,applications] = await Promise.all([
    fetch('https://quantnow-sa1e.onrender.com/admin/all-memberships',{headers:{Authorization:`Bearer ${token}`}}),
    db.collection('participants').select('beneficiaryName','email').get(),
    db.collection('applications').select('participantId','email','applicantEmail','beneficiaryName','applicationStatus','decision','programId','programName').get(),
  ]);
  if (!response.ok) throw new Error(`Finance memberships HTTP ${response.status}`);
  const data={retrievedAt:new Date().toISOString(),finance:await response.json(),participants:participants.docs.map(d=>({...d.data(),id:d.id})),applications:applications.docs.map(d=>({...d.data(),id:d.id}))};
  fs.writeFileSync('outputs/finance-email-review/source.json',JSON.stringify(data,null,2));
  console.log(JSON.stringify({participants:data.participants.length,applications:data.applications.length,companies:data.finance.companies?.length,members:data.finance.members?.length}));
  await admin.app().delete();
}
main().catch(e=>{console.error(e.message);process.exit(1)});
