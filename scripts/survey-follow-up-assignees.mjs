/**
 * Read-only: shows who each follow-up is assigned to, so a wrong "Assigned To" can be traced.
 *   node scripts/survey-follow-up-assignees.mjs
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

const here = path.dirname(fileURLToPath(import.meta.url))
const keyPath = process.env.SERVICE_ACCOUNT_KEY || path.join(here, 'serviceAccountKey.json')
const serviceAccount = JSON.parse(fs.readFileSync(keyPath, 'utf8'))
if (serviceAccount.project_id !== 'lph-smart-inc') throw new Error('Unexpected project')
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) })
const db = admin.firestore()

const clean = value => String(value ?? '').trim()
const followUps = (await db.collection('followUps').get()).docs.map(doc => ({ id: doc.id, ...doc.data() }))
const users = new Map((await db.collection('users').get()).docs.map(doc => [doc.id, doc.data()]))
const inquiries = new Map((await db.collection('inquiries').get()).docs.map(doc => [doc.id, doc.data()]))

console.log(`Follow-ups: ${followUps.length}`)
const groups = new Map()
for (const followUp of followUps) {
  const user = users.get(clean(followUp.assignedTo))
  const inquiry = inquiries.get(clean(followUp.inquiryId))
  const key = [
    `assignedTo=${clean(followUp.assignedTo) ? (user ? 'user' : 'not-a-user-id') : 'empty'}`,
    `role=${clean(user?.role) || '-'}`,
    `nameIsId=${clean(followUp.assignedToName) === clean(followUp.assignedTo)}`,
    `assignedTo==inquiry.submittedBy=${clean(followUp.assignedTo) === clean(inquiry?.submittedBy)}`,
    `assignedToName==customer=${clean(followUp.assignedToName).toLowerCase() === clean(followUp.customerName).toLowerCase()}`
  ].join(' | ')
  const list = groups.get(key) || []
  list.push(followUp)
  groups.set(key, list)
}
for (const [key, list] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
  console.log(`\n${list.length} x ${key}`)
  for (const followUp of list.slice(0, 3)) {
    const user = users.get(clean(followUp.assignedTo))
    console.log(`   ${followUp.id} customer="${clean(followUp.customerName)}" assignedTo=${clean(followUp.assignedTo)} assignedToName="${clean(followUp.assignedToName)}" user="${clean(user?.name || user?.fullName)}" (${clean(user?.role)})`)
  }
}
