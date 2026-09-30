/**
 * Links walk-in inquiries logged for an incubated SME to the SME they belong to.
 *
 * A walk-in is often a company representative rather than the owner on file, so
 * the person's email matches nobody. The company name is what identifies the SME
 * ("Sukude Holdings" -> "Sukude SM Holdings Pty Ltd"), so records are matched by
 * email first and by company name second, inside the inquiry's own programme.
 *
 *   email          contact email is the SME's email on an accepted application
 *   name-exact     company names are equal once "Pty Ltd" style noise is removed
 *   name-fuzzy     one clearly best company match; needs a human to confirm
 *
 * Survey (read-only):
 *   node scripts/link-walk-in-inquiries-to-smes.mjs
 * Commit the safe matches (email + name-exact) and any fuzzy ids you reviewed:
 *   node scripts/link-walk-in-inquiries-to-smes.mjs --commit --confirm=link-walk-in-inquiries [--fuzzy=id1,id2]
 * Revert from a backup file:
 *   node scripts/link-walk-in-inquiries-to-smes.mjs --revert=<backup.json> --commit --confirm=link-walk-in-inquiries
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
const CONFIRMATION = 'link-walk-in-inquiries'
const here = path.dirname(fileURLToPath(import.meta.url))
const keyPath = process.env.SERVICE_ACCOUNT_KEY || path.join(here, 'serviceAccountKey.json')
const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const commit = process.argv.includes('--commit')
const fuzzyApproved = new Set((arg('fuzzy') || '').split(',').map(value => value.trim()).filter(Boolean))
const revertFile = arg('revert')
const includeFuzzy = process.argv.includes('--include-fuzzy')

if (commit && arg('confirm') !== CONFIRMATION) throw new Error(`Commit requires --confirm=${CONFIRMATION}`)
if (!fs.existsSync(keyPath)) throw new Error(`Service account key not found: ${keyPath}`)
const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'))
if (serviceAccount.project_id !== PROJECT_ID) {
  throw new Error(`Service account project is ${serviceAccount.project_id}; expected ${PROJECT_ID}`)
}
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
const db = admin.firestore()
const FieldValue = admin.firestore.FieldValue

if (revertFile) {
  const backup = JSON.parse(fs.readFileSync(revertFile, 'utf8'))
  console.log(`Reverting ${backup.records.length} inquiries${commit ? '' : ' (dry run)'}`)
  if (commit) {
    for (const record of backup.records) {
      await db.collection('inquiries').doc(record.id).update({
        participantId: record.participantId ?? null,
        isRepresentative: record.isRepresentative ?? false,
        'contactInfo.company': record.company ?? '',
        ...(record.email !== undefined ? { 'contactInfo.email': record.email } : {}),
        contactInfo_companyAsEntered: FieldValue.delete(),
        contactInfo_emailAsEntered: FieldValue.delete(),
        linkedToSmeAt: FieldValue.delete()
      })
    }
  }
  process.exit(0)
}

const clean = value => String(value ?? '').trim()
const email = value => clean(value).toLowerCase()
const NOISE = new Set(['pty', 'ltd', 'limited', 'the', 'and', 'cc', 'npc', 'inc', 'trading', 't', 'a'])
const tokens = value => new Set(
  clean(value).toLowerCase().replace(/\(pty\)|\bpty\b|\bltd\b/g, ' ').replace(/[^a-z0-9]+/g, ' ')
    .split(' ').filter(token => token && !NOISE.has(token))
)
const distance = (a, b) => {
  const row = Array.from({ length: b.length + 1 }, (_, index) => index)
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j += 1) {
      const held = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1))
      previous = held
    }
  }
  return row[b.length]
}
// Typos count as the same word: "Sokude" ~ "Sukude", "Enineering" ~ "Engineering".
const sameToken = (a, b) =>
  a === b || (Math.min(a.length, b.length) >= 5 && distance(a, b) <= (Math.min(a.length, b.length) >= 9 ? 2 : 1))
const score = (a, b) => {
  if (!a.size || !b.size) return 0
  const shared = [...a].filter(token => [...b].some(other => sameToken(token, other))).length
  return shared / (a.size + b.size - shared)
}

// Read-only lookup: --find=text[,text2] lists participants and applications mentioning it.
const findArg = arg('find')
if (findArg) {
  const needles = findArg.split(',').map(value => value.trim().toLowerCase()).filter(Boolean)
  const hit = record => needles.some(needle =>
    [record.beneficiaryName, record.companyName, record.participantName, record.applicantName, record.email]
      .some(field => clean(field).toLowerCase().replace(/\s+/g, '').includes(needle.replace(/\s+/g, ''))))
  for (const collectionName of ['participants', 'applications']) {
    const snapshot = await db.collection(collectionName).get()
    for (const doc of snapshot.docs.filter(item => hit(item.data()))) {
      const d = doc.data()
      console.log(`${collectionName.padEnd(12)} ${doc.id} | ${clean(d.beneficiaryName || d.companyName)} | owner ${clean(d.participantName || d.applicantName)} | ${clean(d.email)} | status ${clean(d.applicationStatus ?? d.status)} | program ${clean(d.programId)} | participant ${clean(d.participantId)}`)
    }
  }
  process.exit(0)
}

// Accepted SMEs, one per participant.
const applications = await db.collection('applications').get()
const participantDocs = new Map()
for (const doc of (await db.collection('participants').get()).docs) participantDocs.set(doc.id, doc.data())
const smes = new Map()
for (const doc of applications.docs) {
  const app = doc.data()
  const status = clean(app.applicationStatus ?? app.status).toLowerCase()
  const participantId = clean(app.participantId)
  if (status !== 'accepted' || !participantId) continue
  const key = `${participantId}|${clean(app.programId)}`
  if (smes.has(key)) continue
  smes.set(key, {
    participantId,
    applicationId: doc.id,
    programId: clean(app.programId),
    company: clean(app.beneficiaryName || app.companyName),
    email: email(app.email),
    owner: tokens(participantDocs.get(participantId)?.participantName || app.participantName || app.applicantName || app.directorName),
    tokens: tokens(app.beneficiaryName || app.companyName)
  })
}
const smeList = [...smes.values()]

const inquiries = await db.collection('inquiries').get()
const candidates = inquiries.docs
  .map(doc => ({ id: doc.id, data: doc.data() }))
  .filter(({ data }) =>
    clean(data.source).toLowerCase() === 'walk-in' &&
    clean(data.sourceType) === 'Incubatee' &&
    !clean(data.participantId))

const results = candidates.map(({ id, data }) => {
  const contactEmail = email(data.contactInfo?.email)
  const company = clean(data.contactInfo?.company)
  const pool = smeList.filter(sme => !clean(data.programId) || sme.programId === clean(data.programId))

  const byEmail = contactEmail ? pool.filter(sme => sme.email === contactEmail) : []
  if (byEmail.length === 1) return { id, data, kind: 'email', sme: byEmail[0], score: 1 }

  const wanted = tokens(company)
  const ranked = pool
    .map(sme => ({ sme, score: score(wanted, sme.tokens) }))
    .filter(row => row.score > 0)
    .sort((a, b) => b.score - a.score)

  if (ranked[0]?.score === 1 && ranked.filter(row => row.score === 1).length === 1) {
    return { id, data, kind: 'name-exact', sme: ranked[0].sme, score: 1 }
  }
  if (ranked[0]?.score >= 0.6 && (!ranked[1] || ranked[0].score - ranked[1].score >= 0.15)) {
    return { id, data, kind: 'name-fuzzy', sme: ranked[0].sme, score: ranked[0].score }
  }
  return { id, data, kind: 'unmatched', sme: null, closest: ranked[0]?.score >= 0.3 ? ranked[0] : null, score: ranked[0]?.score ?? 0 }
})

// Links confirmed by hand: the SME exists but the inquiry's email or company did not match it.
// fixEmail replaces a mistyped contact email with the one on the SME's record.
const MANUAL = {
  tVRhVeFdMAY0PpX70XEA: { participantId: 'ch613kSBiQvb7k7UaZzy', fixEmail: true }, // 4CYT LYT, email typo
  NhFK2sCI5xdI2yWGbqkI: { participantId: 'uP2gJMVfOmhx6iXTvi27', fixEmail: true }, // Moano cleaning & security
  VVZqTkOmRX8QC7kBMkoq: { participantId: 'uP2gJMVfOmhx6iXTvi27', fixEmail: true },
  y5RgbV5CnkmVmIunf3NS: { participantId: 'uP2gJMVfOmhx6iXTvi27', fixEmail: true },
  QwSblGDXNJsUBchmau5c: { participantId: 'EJg3Ldo7OW9M6dmbdbjf', fixEmail: false }, // Tlhalefang Trading (no accepted application)
  uPwsP58x3UIXtMr2BTMo: { participantId: 'EJg3Ldo7OW9M6dmbdbjf', fixEmail: false },
  HEhP51roVddawADKZBng: { participantId: 'FJnA3fXURWoytB4bPyMq', fixEmail: true }, // Cart.IT, email missing "it"
  XzSdvOG2za4Ip1vflo6u: { participantId: 'FJnA3fXURWoytB4bPyMq', fixEmail: true },
  JGCKrLLEuKXu54w6eVmb: { participantId: 'w9wFeXJDBwpAV1Me14jO', fixEmail: false }, // Molubi: owner's own email, not a typo
  RlmIw89owt3YyTG6Rn5j: { participantId: 'w9wFeXJDBwpAV1Me14jO', fixEmail: false },
  hCOTvwkVmIzBlCfMAfMC: { participantId: 'AyrgD6ACHVH1NjRIGXOw', fixEmail: true } // Tlou Ya Makwela Holding, email typo
}
const smeFor = participantId => {
  const accepted = smeList.find(sme => sme.participantId === participantId)
  if (accepted) return accepted
  const participant = participantDocs.get(participantId)
  if (!participant) throw new Error(`Participant ${participantId} not found`)
  return {
    participantId,
    applicationId: '',
    programId: '',
    company: clean(participant.beneficiaryName || participant.companyName),
    email: email(participant.email),
    owner: tokens(participant.participantName),
    tokens: tokens(participant.beneficiaryName || participant.companyName)
  }
}
results.forEach((row, index) => {
  const manual = MANUAL[row.id]
  if (manual) results[index] = { ...row, kind: 'manual', sme: smeFor(manual.participantId), score: 1, fixEmail: manual.fixEmail }
})

const tally = kind => results.filter(row => row.kind === kind).length
console.log(`Walk-in incubated inquiries without a linked SME: ${results.length}`)
console.log(`  email ${tally('email')} | name-exact ${tally('name-exact')} | name-fuzzy ${tally('name-fuzzy')} | manual ${tally('manual')} | unmatched ${tally('unmatched')}\n`)
for (const row of results.sort((a, b) => a.kind.localeCompare(b.kind))) {
  const c = row.data.contactInfo || {}
  console.log(
    `${row.kind.padEnd(10)} ${row.id} | "${clean(c.company)}" ${clean(c.firstName)} ${clean(c.lastName)} <${clean(c.email)}>` +
    ` -> ${row.sme ? `${row.sme.company} (${row.score.toFixed(2)})` : row.closest ? `closest: ${row.closest.sme.company} (${row.closest.score.toFixed(2)})` : '-'}`
  )
}

const contactNameTokens = row => tokens(`${clean(row.data.contactInfo?.firstName)} ${clean(row.data.contactInfo?.lastName)}`)
const wouldBeRepresentative = row =>
  row.sme && row.sme.owner.size > 0 && score(contactNameTokens(row), row.sme.owner) < 0.5

const csvPath = arg('csv')
if (csvPath) {
  const cell = value => `"${String(value ?? '').replace(/"/g, '""')}"`
  const header = ['Result', 'Inquiry ID', 'Company as entered', 'Contact name', 'Contact email', 'Description',
    'Matched SME (official name)', 'Match score', 'Would be marked representative', 'Confirm? (Y/N)']
  const order = { manual: 0, 'name-fuzzy': 1, unmatched: 2, 'name-exact': 3, email: 4 }
  const labels = {
    email: 'Email match (safe)',
    'name-exact': 'Exact company name (safe)',
    'name-fuzzy': 'Likely match (confirmed)',
    manual: 'Linked by hand',
    unmatched: 'No match - left alone'
  }
  const lines = [...results]
    .sort((a, b) => order[a.kind] - order[b.kind] || clean(a.data.contactInfo?.company).localeCompare(clean(b.data.contactInfo?.company)))
    .map(row => {
      const c = row.data.contactInfo || {}
      const match = row.sme ? row.sme.company : row.closest ? `(closest) ${row.closest.sme.company}` : ''
      return [
        labels[row.kind],
        row.id, c.company, `${clean(c.firstName)} ${clean(c.lastName)}`, c.email,
        clean(row.data.inquiryDetails?.description),
        match, row.sme ? row.score.toFixed(2) : row.closest ? row.closest.score.toFixed(2) : '',
        row.sme ? (wouldBeRepresentative(row) ? 'Yes' : 'No') : '', ''
      ].map(cell).join(',')
    })
  fs.writeFileSync(csvPath, '\uFEFF' + [header.map(cell).join(','), ...lines].join('\r\n'))
  console.log(`\nList written: ${csvPath}`)
}

if (!commit) {
  console.log('\nDry run only. Nothing was written.')
  process.exit(0)
}

const contactName = row => tokens(`${clean(row.data.contactInfo?.firstName)} ${clean(row.data.contactInfo?.lastName)}`)
const isRepresentative = row =>
  row.sme.owner.size > 0 && score(contactName(row), row.sme.owner) < 0.5

const targets = results.filter(row =>
  ['email', 'name-exact', 'manual'].includes(row.kind) ||
  (row.kind === 'name-fuzzy' && (includeFuzzy || fuzzyApproved.has(row.id))))
const backupPath = path.join(here, `link-walk-in-inquiries-backup-${Date.now()}.json`)
fs.writeFileSync(backupPath, JSON.stringify({
  createdAt: new Date().toISOString(),
  records: targets.map(row => ({
    id: row.id,
    participantId: row.data.participantId ?? null,
    isRepresentative: row.data.isRepresentative ?? false,
    company: row.data.contactInfo?.company ?? '',
    email: row.data.contactInfo?.email ?? ''
  }))
}, null, 2))
console.log(`\nBackup written: ${backupPath}`)

for (const row of targets) {
  const entered = clean(row.data.contactInfo?.company)
  await db.collection('inquiries').doc(row.id).update({
    participantId: row.sme.participantId,
    ...(row.sme.programId && !clean(row.data.programId) ? { programId: row.sme.programId } : {}),
    // A representative is someone other than the owner on file; without an owner
    // name to compare against, do not claim it either way.
    isRepresentative: isRepresentative(row),
    'contactInfo.company': row.sme.company,
    ...(entered && entered !== row.sme.company ? { contactInfo_companyAsEntered: entered } : {}),
    ...(row.fixEmail && row.sme.email && row.sme.email !== email(row.data.contactInfo?.email)
      ? { 'contactInfo.email': row.sme.email, contactInfo_emailAsEntered: clean(row.data.contactInfo?.email) }
      : {}),
    linkedToSmeAt: FieldValue.serverTimestamp()
  })
}
console.log(`Linked ${targets.length} inquiries.`)
