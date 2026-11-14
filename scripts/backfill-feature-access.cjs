// One-off backfill for featureGovernance access fields (src/config/featureGovernanceAccess.ts).
//
// Feature records are now visible to the governance owner and, for everyone
// else, only to the people listed in accessIds (who logged it, who it is
// assigned to, who it is shared with). Records logged before that have no
// accessIds, so only the owner would see them. This gives each one
// accessIds = [createdBy] plus any assignees / viewers already present, and
// empty assigneeIds / viewerIds where missing.
//
// Records already carrying accessIds are left alone. Dry run by default.
//
//   node -r ./scripts/node26-shim.cjs scripts/backfill-feature-access.cjs [--apply]
const path = require('path')
const admin = require('firebase-admin')

const APPLY = process.argv.includes('--apply')

const key = require(path.join(__dirname, 'serviceAccountKey.json'))
const db = admin.initializeApp({ credential: admin.credential.cert(key) }).firestore()

const ids = value => (Array.isArray(value) ? value.map(String).filter(Boolean) : [])

async function main() {
    console.log(`${key.project_id} (${APPLY ? 'APPLY' : 'dry run'})`)

    const snap = await db.collection('featureGovernance').get()
    const rows = []
    const writes = []
    for (const doc of snap.docs) {
        const data = doc.data()
        if (Array.isArray(data.accessIds)) continue
        const assigneeIds = ids(data.assigneeIds)
        const viewerIds = ids(data.viewerIds).filter(id => !assigneeIds.includes(id))
        const accessIds = [...new Set([String(data.createdBy || ''), ...assigneeIds, ...viewerIds].filter(Boolean))]
        rows.push({ id: doc.id, title: String(data.title || '').slice(0, 50), loggedBy: data.createdByName || data.createdBy || '(none)', accessIds: accessIds.length })
        writes.push({ ref: doc.ref, value: { assigneeIds, viewerIds, accessIds } })
    }

    console.table(rows)
    console.log(`${writes.length} of ${snap.size} records need access fields`)

    if (!APPLY) {
        console.log('\nDry run -- re-run with --apply to write')
        return
    }
    for (let i = 0; i < writes.length; i += 400) {
        const batch = db.batch()
        writes.slice(i, i + 400).forEach(w => batch.update(w.ref, w.value))
        await batch.commit()
    }
    console.log('\nDone')
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1) })
