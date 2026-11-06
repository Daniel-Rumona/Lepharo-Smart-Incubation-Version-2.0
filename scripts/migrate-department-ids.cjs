// Moves stored data onto departmentId so a department rename changes nothing
// but its label.
//
//   1. Intervention records lose `areaOfSupport` / `area` (the owning department
//      IS the area). Any record without a departmentId gets one, from its
//      intervention definition first, else by matching the old name.
//        interventions, assignedInterventions, interventionRequests,
//        applications.interventions.{required,assigned,completed}[],
//        diagnosticPlans.interventions[], diagnosticPlanReports.interventions[],
//        movDocuments, kpiProgress/*/participants history[]
//   2. Name-keyed diagnostic-plan confirmation maps are merged into their
//      *ByDeptId maps (id-keyed values win) and removed.
//   3. KPI definition filters on `areaOfSupport` become `departmentId` filters.
//   4. Records that keep a display copy of the name but have no departmentId
//      get one: users, operationsStaff, coordinators, libraryMaterials,
//      consolidatedMOVs, kpiTargets, kpiDefinitions.leadDepartmentId,
//      inquiries.inquiryDetails. Training access grants switch from a
//      department name to a departmentId.
//   5. departments lose `code`.
//
// Anything whose department can't be resolved unambiguously is left untouched
// and listed as needs-manual-review. Run order: seed-department-roles.cjs,
// this script as a dry run, deploy the code, then this script with --apply.
//
// Dry run by default; writes scripts/migrate-department-ids-report.json.
//
//   node -r ./scripts/node26-shim.cjs scripts/migrate-department-ids.cjs [--apply --confirm=migrate-department-ids]
const fs = require('fs')
const path = require('path')
const admin = require('firebase-admin')

const APPLY = process.argv.includes('--apply')
if (APPLY && !process.argv.includes('--confirm=migrate-department-ids')) {
    throw new Error('--apply requires --confirm=migrate-department-ids')
}
const PAGE = 500
const BATCH = 400
const REPORT = path.join(__dirname, 'migrate-department-ids-report.json')

const key = require(path.join(__dirname, 'serviceAccountKey.json'))
const db = admin.initializeApp({ credential: admin.credential.cert(key) }).firestore()
const { FieldValue, FieldPath } = admin.firestore

const clean = (v) => String(v ?? '').trim()
const norm = (v) => clean(v).toLowerCase().replace(/\s+/g, ' ')

const report = { generatedAt: new Date().toISOString(), mode: APPLY ? 'apply' : 'dry-run', counts: {}, needsManualReview: [] }
const bump = (name) => { report.counts[name] = (report.counts[name] || 0) + 1 }
const review = (where, why, extra = {}) => report.needsManualReview.push({ where, why, ...extra })

// ---------- lookups ----------
let departmentIdByName = new Map()
let departmentIds = new Set()
let interventionDepartment = new Map()

async function loadLookups() {
    const departments = await db.collection('departments').get()
    departmentIds = new Set(departments.docs.map(d => d.id))
    const byName = new Map()
    for (const d of departments.docs) {
        const name = norm(d.data().name)
        if (!name) continue
        byName.set(name, byName.has(name) ? null : d.id) // null = ambiguous
    }
    departmentIdByName = byName

    const interventions = await db.collection('interventions').get()
    for (const d of interventions.docs) {
        const data = d.data()
        const id = resolveByName(data.departmentId) || resolveByName(data.areaOfSupport || data.area || data.department)
        if (id) interventionDepartment.set(d.id, id)
    }
}

/** A department id from an id or a name; null if unknown or ambiguous. */
function resolveByName(value) {
    const v = clean(value)
    if (!v) return null
    if (departmentIds.has(v)) return v
    return departmentIdByName.get(norm(v)) || null
}

function resolveRecord(data, interventionIdField = 'interventionId') {
    const existing = clean(data.departmentId)
    if (existing && departmentIds.has(existing)) return existing
    return interventionDepartment.get(clean(data[interventionIdField])) ||
        resolveByName(data.areaOfSupport || data.area || data.departmentName || data.department)
}

// ---------- write plumbing ----------
let batch = db.batch()
let pending = 0
async function write(ref, patch) {
    if (!APPLY) return
    batch.update(ref, patch)
    if (++pending >= BATCH) {
        await batch.commit()
        batch = db.batch()
        pending = 0
    }
}
async function flush() {
    if (APPLY && pending) await batch.commit()
}

async function eachDoc(collectionRef, fn) {
    let last = null
    for (;;) {
        let q = collectionRef.orderBy(FieldPath.documentId()).limit(PAGE)
        if (last) q = q.startAfter(last)
        const snap = await q.get()
        if (snap.empty) break
        for (const d of snap.docs) await fn(d)
        last = snap.docs[snap.docs.length - 1]
    }
}

/** Strip area fields from an intervention-like item and give it a departmentId. */
function migrateItem(item, where) {
    if (!item || typeof item !== 'object') return { item, changed: false }
    const next = { ...item }
    let changed = false
    if (!clean(next.departmentId) || !departmentIds.has(clean(next.departmentId))) {
        const id = interventionDepartment.get(clean(next.interventionId || next.id)) ||
            resolveByName(next.areaOfSupport || next.area || next.departmentName || next.department)
        if (id) { next.departmentId = id; changed = true }
        else if ('areaOfSupport' in next || 'area' in next) {
            review(where, 'item department unresolved', { title: next.title || next.interventionTitle, area: next.areaOfSupport || next.area })
            return { item, changed: false }
        }
    }
    if ('areaOfSupport' in next) { delete next.areaOfSupport; changed = true }
    if ('area' in next) { delete next.area; changed = true }
    return { item: next, changed }
}

// ---------- 1. intervention records ----------
async function migrateTopLevel(collection, interventionIdField = 'interventionId', extraDeletes = []) {
    await eachDoc(db.collection(collection), async (d) => {
        const data = d.data()
        const hasArea = 'areaOfSupport' in data || 'area' in data || extraDeletes.some(f => typeof data[f] === 'string')
        const id = resolveRecord(data, interventionIdField)
        const patch = {}
        if (id && clean(data.departmentId) !== id) patch.departmentId = id
        if (!id) {
            if (hasArea || !clean(data.departmentId)) review(`${collection}/${d.id}`, 'department unresolved', { area: data.areaOfSupport || data.area || data.department || null })
            return
        }
        if ('areaOfSupport' in data) patch.areaOfSupport = FieldValue.delete()
        if ('area' in data) patch.area = FieldValue.delete()
        for (const field of extraDeletes) if (typeof data[field] === 'string') patch[field] = FieldValue.delete()
        if (!Object.keys(patch).length) return
        const declared = clean(data.areaOfSupport)
        if (declared && resolveByName(declared) && resolveByName(declared) !== id) bump(`${collection}: area differed from department`)
        bump(collection)
        await write(d.ref, patch)
    })
}

async function migrateApplications() {
    await eachDoc(db.collection('applications'), async (d) => {
        const ivs = d.data().interventions
        if (!ivs || typeof ivs !== 'object') return
        const patch = {}
        for (const list of ['required', 'assigned', 'completed']) {
            if (!Array.isArray(ivs[list])) continue
            let changed = false
            const next = ivs[list].map((item, i) => {
                const r = migrateItem(item, `applications/${d.id}.interventions.${list}[${i}]`)
                changed = changed || r.changed
                return r.item
            })
            if (changed) patch[`interventions.${list}`] = next
        }
        if (!Object.keys(patch).length) return
        bump('applications')
        await write(d.ref, patch)
    })
}

const NAME_MAPS = [
    ['confirmed', 'confirmedByDeptId'],
    ['smmeConfirmedByDept', 'smmeConfirmedByDeptId'],
    ['smmeConfirmedMap', 'smmeConfirmedByDeptId'],
    ['incubateeConfirmedByDept', 'incubateeDepartmentConfirmationsByDeptId'],
    ['incubateeDepartmentConfirmations', 'incubateeDepartmentConfirmationsByDeptId']
]

async function migrateDiagnosticPlans() {
    await eachDoc(db.collection('diagnosticPlans'), async (d) => {
        const data = d.data()
        const patch = {}

        if (Array.isArray(data.interventions)) {
            let changed = false
            const next = data.interventions.map((item, i) => {
                const r = migrateItem(item, `diagnosticPlans/${d.id}.interventions[${i}]`)
                changed = changed || r.changed
                return r.item
            })
            if (changed) patch.interventions = next
        }

        const merged = {}
        for (const [nameField, idField] of NAME_MAPS) {
            const byName = data[nameField]
            if (!byName || typeof byName !== 'object' || Array.isArray(byName)) continue
            merged[idField] = merged[idField] || { ...(data[idField] || {}) }
            for (const [name, value] of Object.entries(byName)) {
                const id = resolveByName(name)
                if (!id) { review(`diagnosticPlans/${d.id}.${nameField}`, 'confirmation key unresolved', { key: name }); continue }
                if (!(id in merged[idField])) merged[idField][id] = value
            }
            patch[nameField] = FieldValue.delete()
        }
        Object.assign(patch, merged)

        if (!Object.keys(patch).length) return
        bump('diagnosticPlans')
        await write(d.ref, patch)
    })
}

async function migrateArrayField(collection, field) {
    await eachDoc(db.collection(collection), async (d) => {
        const list = d.data()[field]
        if (!Array.isArray(list)) return
        let changed = false
        const next = list.map((item, i) => {
            const r = migrateItem(item, `${collection}/${d.id}.${field}[${i}]`)
            changed = changed || r.changed
            return r.item
        })
        if (!changed) return
        bump(collection)
        await write(d.ref, { [field]: next })
    })
}

async function migrateKpiProgress() {
    const participants = await db.collectionGroup('participants').get()
    for (const d of participants.docs) {
        if (!d.ref.path.startsWith('kpiProgress/')) continue
        const history = d.data().history
        if (!Array.isArray(history)) continue
        let changed = false
        const next = history.map((entry, i) => {
            if (!entry || typeof entry !== 'object' || !('department' in entry)) return entry
            const id = clean(entry.departmentId) || resolveByName(entry.department)
            if (!id) { review(`${d.ref.path}.history[${i}]`, 'department unresolved', { department: entry.department }); return entry }
            const { department, ...rest } = entry
            changed = true
            return { ...rest, departmentId: id }
        })
        if (!changed) continue
        bump('kpiProgress participants')
        await write(d.ref, { history: next })
    }
}

// ---------- 3. KPI filters ----------
function convertFilters(node, where) {
    if (Array.isArray(node)) {
        let changed = false
        const next = node.map((n, i) => { const r = convertFilters(n, `${where}[${i}]`); changed = changed || r.changed; return r.node })
        return { node: next, changed }
    }
    if (!node || typeof node !== 'object' || node instanceof admin.firestore.Timestamp) return { node, changed: false }
    let changed = false
    const next = {}
    for (const [k, v] of Object.entries(node)) {
        const r = convertFilters(v, `${where}.${k}`)
        changed = changed || r.changed
        next[k] = r.node
    }
    if (next.field === 'areaOfSupport') {
        const toId = (value) => resolveByName(value)
        const value = Array.isArray(next.value) ? next.value.map(toId) : toId(next.value)
        if ((Array.isArray(value) && value.includes(null)) || value === null) {
            review(where, 'KPI filter department unresolved', { value: next.value })
            return { node, changed: false }
        }
        next.field = 'departmentId'
        next.value = value
        changed = true
    }
    return { node: next, changed }
}

async function migrateKpiDefinitions() {
    await eachDoc(db.collection('kpiDefinitions'), async (d) => {
        const data = d.data()
        const patch = {}
        for (const [field, value] of Object.entries(data)) {
            const r = convertFilters(value, `kpiDefinitions/${d.id}.${field}`)
            if (r.changed) patch[field] = r.node
        }
        if (!Object.keys(patch).length) return
        bump('kpiDefinitions filters')
        await write(d.ref, patch)
    })
}

// ---------- 4. display copies without an id ----------
async function backfillIds(collection, nameField) {
    await eachDoc(db.collection(collection), async (d) => {
        const data = d.data()
        if (clean(data.departmentId)) return
        const name = clean(data[nameField])
        if (!name) return
        const id = resolveByName(name)
        if (!id) { review(`${collection}/${d.id}`, 'departmentId missing and name unresolved', { name }); return }
        bump(`${collection} departmentId backfilled`)
        await write(d.ref, { departmentId: id })
    })
}

async function backfillKpiLeads() {
    await eachDoc(db.collection('kpiDefinitions'), async (d) => {
        const data = d.data()
        if (clean(data.leadDepartmentId)) return
        const name = clean(data.leadDepartmentName || data.department)
        if (!name) return
        const id = resolveByName(name)
        if (!id) { review(`kpiDefinitions/${d.id}`, 'leadDepartmentId missing and name unresolved', { name }); return }
        bump('kpiDefinitions leadDepartmentId backfilled')
        await write(d.ref, { leadDepartmentId: id })
    })
}

async function backfillInquiries() {
    await eachDoc(db.collection('inquiries'), async (d) => {
        const details = d.data().inquiryDetails
        if (!details || clean(details.departmentId) || !clean(details.department)) return
        const id = resolveByName(details.department)
        if (!id) { review(`inquiries/${d.id}`, 'inquiry department unresolved', { name: details.department }); return }
        bump('inquiries departmentId backfilled')
        await write(d.ref, { 'inquiryDetails.departmentId': id })
    })
}

// Query stage labels (M&E vs HOD) now come from the raiser's departmentId.
async function backfillQueryRaisers() {
    await eachDoc(db.collection('workflowQueries'), async (d) => {
        const raisedBy = d.data().raisedBy
        if (!raisedBy || clean(raisedBy.departmentId) || !clean(raisedBy.departmentName)) return
        const id = resolveByName(raisedBy.departmentName)
        if (!id) return
        bump('workflowQueries raiser departmentId backfilled')
        await write(d.ref, { 'raisedBy.departmentId': id })
    })
}

async function migrateTrainingAccess() {
    await eachDoc(db.collection('trainings'), async (d) => {
        const access = d.data().access
        if (!Array.isArray(access) || !access.some(a => a && 'department' in a)) return
        let ok = true
        const next = access.map((grant, i) => {
            if (!grant || !('department' in grant)) return grant
            const { department, ...rest } = grant
            const id = clean(grant.departmentId) || resolveByName(department)
            if (!id) { ok = false; review(`trainings/${d.id}.access[${i}]`, 'grant department unresolved', { name: department }) }
            return { ...rest, departmentId: id }
        })
        if (!ok) return
        bump('trainings access grants')
        await write(d.ref, { access: next })
    })
}

// ---------- 5. department code ----------
async function dropDepartmentCode() {
    await eachDoc(db.collection('departments'), async (d) => {
        if (!('code' in d.data())) return
        bump('departments code removed')
        await write(d.ref, { code: FieldValue.delete() })
    })
}

async function main() {
    console.log(`${key.project_id} (${APPLY ? 'APPLY' : 'dry run'})`)
    await loadLookups()

    await migrateTopLevel('interventions', 'id', ['department'])
    await migrateTopLevel('assignedInterventions')
    await migrateTopLevel('interventionRequests')
    await migrateTopLevel('movDocuments')
    await migrateApplications()
    await migrateDiagnosticPlans()
    await migrateArrayField('diagnosticPlanReports', 'interventions')
    await migrateKpiProgress()
    await migrateKpiDefinitions()

    await backfillIds('users', 'departmentName')
    await backfillIds('operationsStaff', 'departmentName')
    await backfillIds('coordinators', 'departmentName')
    await backfillIds('libraryMaterials', 'departmentName')
    await backfillIds('consolidatedMOVs', 'department')
    await backfillIds('kpiTargets', 'department')
    await backfillKpiLeads()
    await backfillInquiries()
    await migrateTrainingAccess()
    await backfillQueryRaisers()

    await dropDepartmentCode()
    await flush()

    console.table(report.counts)
    console.log(`\nNeeds manual review: ${report.needsManualReview.length} (see ${path.basename(REPORT)})`)
    fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`)
    console.log(APPLY ? '\nDone' : '\nDry run -- re-run with --apply --confirm=migrate-department-ids to write')
}
main().then(() => process.exit(0), (e) => { console.error(e); process.exit(1) })
