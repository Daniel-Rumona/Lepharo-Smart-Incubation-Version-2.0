// Brings old `notifications` docs in line with the tightened read rule
// (firestore.rules, match /notifications): a doc goes either to named people or
// to a whole role, never both.
//
//   - recipientIds non-empty  -> delete recipientRoles (and any audience), so a
//     private notice (compliance status, KPI reminder, query reminder...) stops
//     being readable by everyone holding the role through a raw query.
//   - recipientIds empty/absent but recipientRoles non-empty -> set
//     audience: 'role', the marker the role branch of the rule and the
//     NotificationBell's role query now require. Without it these broadcasts
//     disappear from the bell.
//
// Dry run by default; prints what would change, grouped by type.
//
//   node -r ./scripts/node26-shim.cjs scripts/scope-notification-audience.cjs [--apply]
const path = require('path')
const admin = require('firebase-admin')

const APPLY = process.argv.includes('--apply')
const PAGE = 500
const BATCH = 400

const key = require(path.join(__dirname, 'serviceAccountKey.json'))
const db = admin.initializeApp({ credential: admin.credential.cert(key) }).firestore()
const { FieldValue, FieldPath } = admin.firestore

const nonEmpty = (v) => Array.isArray(v) && v.filter(Boolean).length > 0

function patchFor(data) {
    if (nonEmpty(data.recipientIds)) {
        const patch = {}
        if ('recipientRoles' in data) patch.recipientRoles = FieldValue.delete()
        if ('audience' in data) patch.audience = FieldValue.delete()
        return Object.keys(patch).length ? { kind: 'strip-roles', patch } : null
    }
    if (nonEmpty(data.recipientRoles) && data.audience !== 'role') {
        return { kind: 'mark-role', patch: { audience: 'role' } }
    }
    return null
}

async function main() {
    console.log(`${key.project_id} (${APPLY ? 'APPLY' : 'dry run'})`)
    const counts = { scanned: 0, 'strip-roles': {}, 'mark-role': {} }
    let batch = db.batch()
    let pending = 0
    let last = null

    for (;;) {
        let q = db.collection('notifications').orderBy(FieldPath.documentId()).limit(PAGE)
        if (last) q = q.startAfter(last)
        const snap = await q.get()
        if (snap.empty) break
        for (const d of snap.docs) {
            counts.scanned++
            const change = patchFor(d.data())
            if (!change) continue
            const type = String(d.data().type || '(none)')
            counts[change.kind][type] = (counts[change.kind][type] || 0) + 1
            if (!APPLY) continue
            batch.update(d.ref, change.patch)
            if (++pending >= BATCH) {
                await batch.commit()
                batch = db.batch()
                pending = 0
            }
        }
        last = snap.docs[snap.docs.length - 1]
    }
    if (APPLY && pending) await batch.commit()

    const total = (o) => Object.values(o).reduce((a, b) => a + b, 0)
    console.log(`\nScanned ${counts.scanned}`)
    console.log(`\nremove recipientRoles from uid-targeted docs: ${total(counts['strip-roles'])}`)
    console.table(counts['strip-roles'])
    console.log(`\nmark role-only docs audience 'role': ${total(counts['mark-role'])}`)
    console.table(counts['mark-role'])
    console.log(APPLY ? '\nDone' : '\nDry run -- re-run with --apply to write')
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1) })
