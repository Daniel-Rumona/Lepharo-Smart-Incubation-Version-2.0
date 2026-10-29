// Brings the demo records already in Firestore in line with the current generator, after the
// generator (dataset.cjs) or the walk-in seeder (seed-walkins.cjs) has been edited.
//
//   node scripts/digital-twin/apply-generator-update.cjs [--apply]
//
// It runs the previous versions (dataset.previous.cjs, seed-walkins.previous.cjs: copies taken
// before the edit) and the current ones, and compares them field by field. A live field is changed
// only while it still equals what the previous generator wrote, so anything edited in the app since
// is left alone and reported. Records are only updated, never created or deleted.
//
// Updates applied so far: pack statuses awaiting_cc / awaiting_me and the hod_submission step;
// both demo programmes in the Rustenburg centre; no [DEMO] prefixes and varied SME names.
// It also makes the Rustenburg Center Coordinator (ccrusternberg@quantilytix.co.za) the project
// admin of both demo programmes.
require('../node26-shim.cjs')
const path = require('node:path')
const admin = require('firebase-admin')
const previous = require('./dataset.previous.cjs')
const current = require('./dataset.cjs')
const { build } = require('./seed-walkins.cjs')
const { build: buildPrevious } = require('./seed-walkins.previous.cjs')

const APPLY = process.argv.includes('--apply')
const key = require(path.join(__dirname, '../serviceAccountKey.json'))
if (key.project_id !== 'lepharo-smart-inc') throw new Error('Unexpected project')
const db = admin.initializeApp({ credential: admin.credential.cert(key) }).firestore()
const { FieldValue } = admin.firestore

const ADMIN_EMAIL = 'ccrusternberg@quantilytix.co.za'
const programIds = [0, 1].map((p) => `${current.RUN}_program_${p}`)

const same = (a, b) => (a === undefined || b === undefined ? a === b : current.hash(a) === current.hash(b))

const recordsOf = (generator, buildWalkIns) => {
    const records = generator.generate().records
    return [...records, ...buildWalkIns(records).records]
}

async function main() {
    console.log(`${key.project_id} (${APPLY ? 'APPLY' : 'dry run'})`)
    const oldByPath = new Map(recordsOf(previous, buildPrevious).map((r) => [r.path, r.data]))
    const newByPath = new Map(recordsOf(current, build).map((r) => [r.path, r.data]))

    // 1. what the generator change touches
    const changes = []
    for (const [p, next] of newByPath) {
        const old = oldByPath.get(p)
        if (!old) continue
        const keys = [...new Set([...Object.keys(old), ...Object.keys(next)])].filter((k) => !same(old[k], next[k]))
        if (keys.length) changes.push({ path: p, keys, old, next })
    }
    const missingFromNew = [...oldByPath.keys()].filter((p) => !newByPath.has(p))
    console.log(`\n${changes.length} records change in the generator; ${missingFromNew.length} records dropped (left in place)`)

    // 2. apply to live records that still match the previous generator
    const patches = []
    const summary = {}
    const drifted = []
    const absent = []
    const refs = changes.map((c) => db.doc(c.path))
    for (let i = 0; i < refs.length; i += 300) {
        const snaps = await db.getAll(...refs.slice(i, i + 300))
        snaps.forEach((snap, j) => {
            const c = changes[i + j]
            const col = c.path.split('/')[0]
            if (!snap.exists) { absent.push(c.path); return }
            const live = snap.data()
            const patch = {}
            for (const k of c.keys) {
                if (same(live[k], c.old[k])) patch[k] = c.next[k] === undefined ? FieldValue.delete() : c.next[k]
                else if (!same(live[k], c.next[k])) drifted.push(`${c.path}.${k}`)
            }
            if (Object.keys(patch).length) {
                patches.push({ ref: snap.ref, patch })
                summary[col] = summary[col] || { records: 0, fields: {} }
                summary[col].records++
                Object.keys(patch).forEach((k) => (summary[col].fields[k] = (summary[col].fields[k] || 0) + 1))
            }
        })
    }
    for (const [col, s] of Object.entries(summary)) console.log(`  ${col}: ${s.records} records  [${Object.keys(s.fields).join(', ')}]`)
    console.log(`  not in Firestore (skipped): ${absent.length}`)
    console.log(`  edited since seeding (left alone): ${drifted.length}${drifted.length ? ' e.g. ' + drifted.slice(0, 4).join(', ') : ''}`)

    if (APPLY) {
        for (let i = 0; i < patches.length; i += 400) {
            const batch = db.batch()
            patches.slice(i, i + 400).forEach(({ ref, patch }) => batch.update(ref, patch))
            await batch.commit()
        }
        console.log(`  updated ${patches.length} records`)
    }

    // 3. the Rustenburg Center Coordinator administers both demo programmes
    const users = await db.collection('users').where('email', '==', ADMIN_EMAIL).get()
    if (users.empty) throw new Error(`${ADMIN_EMAIL} not found`)
    const adminDoc = users.docs[0]
    const have = new Set(adminDoc.data().assignedPrograms || [])
    const toAdd = programIds.filter((p) => !have.has(p))
    console.log(`\n${ADMIN_EMAIL} (${adminDoc.data().role}, branch ${adminDoc.data().assignedBranch}): ${toAdd.length ? 'add ' + toAdd.join(', ') : 'already assigned to both demo programmes'}`)
    if (APPLY && toAdd.length) await adminDoc.ref.update({ assignedPrograms: FieldValue.arrayUnion(...toAdd), updatedAt: FieldValue.serverTimestamp() })
    console.log(APPLY ? '\nDone' : '\nDry run')
}

main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1) })
