// One-off bootstrap for systemSettings/departmentRoles ({ roleKey: departmentId }).
//
// The app used to recognise ROM, M&E, HR, Legal, ... by matching department
// names. It now reads this role map instead, so a rename changes nothing but
// the label. This script fills the map once by matching today's names the way
// the old code did. Afterwards, manage it from System Admin -> Department Roles.
//
//   - Top-level departments are preferred; a sub-department is used only when
//     no top-level department matches (e.g. NVC and QMS under Training).
//     Sub-departments without a role of their own inherit their parent's.
//   - A role with several matching departments is reported and left empty.
//   - Roles already set are kept unless --force is passed.
//
// Dry run by default; prints the proposed map.
//
//   node -r ./scripts/node26-shim.cjs scripts/seed-department-roles.cjs [--apply] [--force]
const path = require('path')
const admin = require('firebase-admin')

const APPLY = process.argv.includes('--apply')
const FORCE = process.argv.includes('--force')

const key = require(path.join(__dirname, 'serviceAccountKey.json'))
const db = admin.initializeApp({ credential: admin.credential.cert(key) }).firestore()

const ROLE_PATTERNS = {
    rom: /^rom\b|recruitment,? onboarding/i,
    monitoring: /^m&e\b|monitoring (and|&) evaluation/i,
    hr: /^hrm\b|human resources/i,
    inhouseFinance: /^ihf\b|in-?house finance/i,
    financialCompliance: /^financial compliance/i,
    hse: /^hse\b|health, safety/i,
    legal: /^legal advisory/i,
    training: /^training academy/i,
    nvc: /^nvc\b|new venture creation/i,
    qms: /^qms\b|quality management system/i,
    pds: /^pds\b|personal development services/i,
    wellness: /^wellness/i,
    marketing: /^marketing (and|&) communication/i,
    marketLinkages: /^market linkages/i,
    stakeholder: /^stakeholder engagement/i
}

async function main() {
    console.log(`${key.project_id} (${APPLY ? 'APPLY' : 'dry run'}${FORCE ? ', force' : ''})`)

    const snap = await db.collection('departments').get()
    const active = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(d => d.isActive !== false)
    const isTopLevel = d => !d.parentDepartmentId && !d.parentDeptId
    const departments = active

    const ref = db.collection('systemSettings').doc('departmentRoles')
    const existing = (await ref.get()).data() || {}

    const roles = {}
    const rows = []
    for (const [role, pattern] of Object.entries(ROLE_PATTERNS)) {
        const named = departments.filter(d => pattern.test(String(d.name || '').trim()))
        const topLevel = named.filter(isTopLevel)
        const matches = topLevel.length ? topLevel : named
        const current = existing[role]
        let chosen = null
        let note = ''
        if (current && !FORCE) {
            chosen = current
            note = 'kept existing'
        } else if (matches.length === 1) {
            chosen = matches[0].id
        } else if (matches.length > 1) {
            note = `ambiguous: ${matches.map(m => m.name).join(' | ')}`
        } else {
            note = 'no matching department'
        }
        if (chosen) roles[role] = chosen
        const name = departments.find(d => d.id === chosen)?.name || ''
        rows.push({ role, departmentId: chosen || '', department: name, note })
    }
    console.table(rows)

    if (!APPLY) {
        console.log('\nDry run -- re-run with --apply to write')
        return
    }
    await ref.set({
        ...roles,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedByName: 'seed-department-roles script'
    })
    console.log('\nDone')
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1) })
