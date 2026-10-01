// Copies data from the old Firebase project (oldServiceAccountKey.json) into the
// new one (serviceAccountKey.json). Dry run by default: pass --apply to write.
//
//   node -r ./scripts/node26-shim.cjs scripts/migrate-from-old-project.cjs [--apply]
//
// Add roles by extending ROLES below.
const path = require('path')
const admin = require('firebase-admin')

const APPLY = process.argv.includes('--apply')

// Roles whose user accounts (Auth + users doc) are copied.
const ROLES = ['operations']
// Only accounts with this email domain are copied (set to '' for all).
const EMAIL_DOMAIN = '@quantilytix.co.za'
// Initial password for every created Auth account.
const DEFAULT_PASSWORD = 'Password@1'
// Collections copied in full.
const COLLECTIONS = ['departments', 'branches']

const oldKey = require(path.join(__dirname, 'oldServiceAccountKey.json'))
const newKey = require(path.join(__dirname, 'serviceAccountKey.json'))
const oldApp = admin.initializeApp({ credential: admin.credential.cert(oldKey) }, 'old')
const newApp = admin.initializeApp({ credential: admin.credential.cert(newKey) }, 'new')
const oldDb = oldApp.firestore()
const newDb = newApp.firestore()

const roleOf = (d) => String(d.role ?? '').toLowerCase()

async function main() {
  console.log(`${oldKey.project_id} -> ${newKey.project_id} (${APPLY ? 'APPLY' : 'dry run'})`)

  for (const name of COLLECTIONS) {
    const snap = await oldDb.collection(name).get()
    console.log(`\n[${name}] ${snap.size} docs`)
    for (const d of snap.docs) {
      console.log('  ', d.id, d.data().name ?? '')
      if (APPLY) await newDb.collection(name).doc(d.id).set(d.data())
    }
  }

  const usersSnap = await oldDb.collection('users').get()
  const picked = usersSnap.docs.filter((d) => ROLES.includes(roleOf(d.data())) &&
    String(d.data().email ?? '').toLowerCase().endsWith(EMAIL_DOMAIN))
  console.log(`\n[users] ${usersSnap.size} total, ${picked.length} matching roles ${ROLES.join(', ')} and domain ${EMAIL_DOMAIN}`)

  for (const d of picked) {
    const data = d.data()
    console.log('  ', d.id, data.email ?? '', roleOf(data), data.departmentId ?? data.department ?? '')
    if (!APPLY) continue
    const authUser = await oldApp.auth().getUser(d.id).catch(() => null)
    if (authUser) {
      // Same UID so the users doc still matches.
      await newApp.auth().createUser({
        uid: authUser.uid,
        email: authUser.email,
        password: DEFAULT_PASSWORD,
        emailVerified: authUser.emailVerified,
        displayName: authUser.displayName,
        phoneNumber: authUser.phoneNumber,
        disabled: authUser.disabled,
      }).catch((e) => { if (e.code !== 'auth/uid-already-exists' && e.code !== 'auth/email-already-exists') throw e })
    } else {
      console.log('     (no Auth user with this UID in old project)')
    }
    await newDb.collection('users').doc(d.id).set(data)
  }
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1) })
