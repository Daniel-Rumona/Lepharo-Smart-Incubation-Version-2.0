/**
 * Re-labels portal-sourced inquiries as "Walk-in" when their message says the
 * SME attended in person (e.g. "SMME came to attend ...").
 *
 * Only inquiries whose source is a portal value (SME, Beneficiary, Incubatee, system) are
 * considered. `sourceType` is left alone, so an incubated SME stays an
 * incubated SME; only the channel changes. Every change is written to a backup
 * file first and stamped on the record so it can be reverted.
 *
 * Survey (read-only, prints every portal inquiry and whether it matches):
 *   node scripts/reclassify-attended-inquiries.mjs
 * Commit (only the matches, optionally limited to reviewed ids):
 *   node scripts/reclassify-attended-inquiries.mjs --commit --confirm=reclassify-attended-inquiries [--only=id1,id2]
 * Restore the incubated marker from a backup file (add --commit --confirm=... to write):
 *   node scripts/reclassify-attended-inquiries.mjs --restore-audience=<backup.json>
 * Revert from a backup file:
 *   node scripts/reclassify-attended-inquiries.mjs --revert=<backup.json> --commit --confirm=reclassify-attended-inquiries
 */
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const bufferModule = require('node:buffer')
if (!bufferModule.SlowBuffer) bufferModule.SlowBuffer = bufferModule.Buffer
const { default: admin } = await import('firebase-admin')

const PROJECT_ID = 'lph-smart-inc'
const CONFIRMATION = 'reclassify-attended-inquiries'
const here = path.dirname(fileURLToPath(import.meta.url))
const keyPath = process.env.SERVICE_ACCOUNT_KEY || path.join(here, 'serviceAccountKey.json')
const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const commit = process.argv.includes('--commit')
const confirmation = arg('confirm')
const revertFile = arg('revert')
const only = new Set((arg('only') || '').split(',').map(value => value.trim()).filter(Boolean))

if (commit && confirmation !== CONFIRMATION) throw new Error(`Commit requires --confirm=${CONFIRMATION}`)
if (!fs.existsSync(keyPath)) throw new Error(`Service account key not found: ${keyPath}`)

const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'))
if (serviceAccount.project_id !== PROJECT_ID) {
  throw new Error(`Service account project is ${serviceAccount.project_id}; expected ${PROJECT_ID}`)
}
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
const db = admin.firestore()

const PORTAL_SOURCES = new Set(['sme', 'beneficiary', 'system', 'incubatee'])
// Front-desk entries read "SMME came to attend NVC training." / "The SMME came to submit ...".
// Anything that says it was online or virtual stays as it is.
const ATTENDED = /^\W*(?:the\s+)?smme\s+came\b/i
const NOT_IN_PERSON = /\b(online|virtual|virtually|teams|zoom|remote|remotely)\b/i

const textOf = data => [
  data.inquiryDetails?.message,
  data.inquiryDetails?.description,
  data.description,
  data.message
].filter(Boolean).join(' | ').replace(/\s+/g, ' ').trim()

if (revertFile) {
  const backup = JSON.parse(fs.readFileSync(revertFile, 'utf8'))
  console.log(`Reverting ${backup.records.length} inquiries from ${revertFile}${commit ? '' : ' (dry run)'}`)
  if (commit) {
    for (const record of backup.records) {
      await db.collection('inquiries').doc(record.id).update({
        source: record.source,
        reclassifiedFromSource: admin.firestore.FieldValue.delete(),
        reclassifiedAt: admin.firestore.FieldValue.delete()
      })
    }
  }
  process.exit(0)
}

const restoreFile = arg('restore-audience')
if (restoreFile) {
  // The old `source` ("Incubatee") was the only incubated marker on records whose
  // sourceType was blank, so re-stating it keeps them incubated after the change.
  const backup = JSON.parse(fs.readFileSync(restoreFile, 'utf8'))
  let fixed = 0
  for (const record of backup.records) {
    if (String(record.source || '').trim().toLowerCase() !== 'incubatee') continue
    const ref = db.collection('inquiries').doc(record.id)
    const current = (await ref.get()).data() || {}
    if (current.sourceType === 'Incubatee' || current.sourceType === 'Non-Incubatee') continue
    console.log(`${commit ? 'Setting' : 'Would set'} sourceType=Incubatee on ${record.id}`)
    if (commit) await ref.update({ sourceType: 'Incubatee' })
    fixed += 1
  }
  console.log(`${commit ? 'Updated' : 'Would update'} ${fixed} of ${backup.records.length} records.`)
  process.exit(0)
}

const snap = await db.collection('inquiries').get()
const portal = snap.docs
  .map(doc => ({ id: doc.id, data: doc.data() }))
  .filter(({ data }) => PORTAL_SOURCES.has(String(data.source || '').trim().toLowerCase()))

const rows = portal.map(({ id, data }) => ({
  id,
  source: data.source,
  sourceType: data.sourceType || '',
  branchId: data.branchId || '',
  text: textOf(data),
  match: ATTENDED.test(textOf(data)) && !NOT_IN_PERSON.test(textOf(data))
}))

console.log(`Inquiries total: ${snap.size}; portal-sourced: ${rows.length}; matching an in-person message: ${rows.filter(r => r.match).length}`)
for (const row of rows) {
  console.log(`${row.match ? 'MATCH' : '     '} ${row.id} [${row.source}/${row.sourceType}] ${row.text.slice(0, 140)}`)
}

if (!commit) {
  console.log('\nDry run only. Nothing was written.')
  process.exit(0)
}

const targets = rows.filter(row => row.match && (only.size === 0 || only.has(row.id)))
const backupPath = path.join(here, `reclassify-attended-inquiries-backup-${Date.now()}.json`)
fs.writeFileSync(backupPath, JSON.stringify({
  createdAt: new Date().toISOString(),
  records: targets.map(({ id, source }) => ({ id, source }))
}, null, 2))
console.log(`\nBackup written: ${backupPath}`)

for (const row of targets) {
  await db.collection('inquiries').doc(row.id).update({
    source: 'Walk-in',
    reclassifiedFromSource: row.source,
    reclassifiedAt: admin.firestore.FieldValue.serverTimestamp()
  })
}
console.log(`Updated ${targets.length} inquiries to Walk-in.`)
