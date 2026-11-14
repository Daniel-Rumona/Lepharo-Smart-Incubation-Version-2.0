// Seeds HSE job contracts (hseJobContracts) for one programme so the Jobs
// Tracker can be tried with realistic data. Each SME's jobs follow its own
// headcount history on the participant record: the staff it had when it
// joined, hires and leavers as its permanent headcount moves, short temporary
// contracts in the months its temporary headcount is non-zero, plus a few
// renewals, contracts expiring soon and SMEs that stopped uploading.
// Dry run by default: it prints what it would write and writes nothing.
//
//   node -r ./scripts/node26-shim.cjs scripts/seed-hse-jobs.cjs [--program <id>] [--apply]
//   node -r ./scripts/node26-shim.cjs scripts/seed-hse-jobs.cjs --remove [--apply]
//
// Every document uses a fixed `seed-hse-jobs-…` id and carries `seedTag`, so
// re-running overwrites the same documents and --remove deletes exactly what
// this script created. Seeded documents point at one shared sample PDF and
// have no storagePath, so removing one in the app never deletes the sample.
// Counting rules: src/lib/jobs.ts.
const path = require('path')
const admin = require('firebase-admin')

const APPLY = process.argv.includes('--apply')
const REMOVE = process.argv.includes('--remove')
const argValue = flag => {
    const i = process.argv.indexOf(flag)
    return i >= 0 ? process.argv[i + 1] : null
}
const PROGRAM_ID = argValue('--program') || 'dtseed_20261009_v1_program_0'
const SEED_TAG = 'seed-hse-jobs'
const BUCKET = 'lepharo-smart-inc.firebasestorage.app'
const SAMPLE_PATH = 'jobContracts/_seed/sample-employment-contract.pdf'
const TODAY = new Date()

const key = require(path.join(__dirname, 'serviceAccountKey.json'))
if (key.project_id !== 'lepharo-smart-inc') {
    console.error(`Refusing to seed ${key.project_id}: this script is for the test project only.`)
    process.exit(1)
}
const app = admin.initializeApp({ credential: admin.credential.cert(key), storageBucket: BUCKET })
const db = app.firestore()
const { Timestamp } = admin.firestore

/* ---------- deterministic randomness ---------- */
const hash = text => {
    let h = 2166136261
    for (const ch of String(text)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619)
    return h >>> 0
}
const rng = seed => {
    let s = hash(seed) || 1
    return () => {
        s ^= s << 13; s ^= s >>> 17; s ^= s << 5
        return ((s >>> 0) % 100000) / 100000
    }
}
const pick = (r, list) => list[Math.floor(r() * list.length)]

/* ---------- dates ---------- */
const utc = (y, m, d = 1) => new Date(Date.UTC(y, m, d))
const monthDate = key => utc(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, 1)
const monthKey = date => date.toISOString().slice(0, 7)
const addMonths = (date, n) => utc(date.getUTCFullYear(), date.getUTCMonth() + n, Math.min(date.getUTCDate(), 28))
const endOfMonth = date => utc(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)
const dayIn = (r, monthStart) => utc(monthStart.getUTCFullYear(), monthStart.getUTCMonth(), 1 + Math.floor(r() * 27))
const ts = date => (date ? Timestamp.fromDate(date) : null)

/* ---------- people ---------- */
const FIRST = ['Thandi', 'Sipho', 'Lerato', 'Bongani', 'Nomsa', 'Kagiso', 'Zanele', 'Thabo', 'Ayanda', 'Mpho', 'Lindiwe', 'Sibusiso', 'Palesa', 'Tshepo', 'Naledi', 'Musa', 'Refilwe', 'Andile', 'Busisiwe', 'Lwazi', 'Karabo', 'Nandi', 'Themba', 'Dineo', 'Sizwe', 'Precious', 'Johan', 'Anele', 'Kholofelo', 'Vusi']
const LAST = ['Mokoena', 'Dlamini', 'Nkosi', 'Khumalo', 'Ndlovu', 'Mahlangu', 'Molefe', 'Zulu', 'Mabena', 'Sithole', 'Mthembu', 'Radebe', 'Maseko', 'Baloyi', 'Shabalala', 'Ngcobo', 'Venter', 'Mokwena', 'Chauke', 'Tau']
const POSITIONS = {
    default: ['General Worker', 'Admin Clerk', 'Sales Assistant', 'Supervisor', 'Driver', 'Cleaner', 'Bookkeeper', 'Store Assistant'],
    manufacturing: ['Machine Operator', 'Welder', 'Production Assistant', 'Quality Checker', 'Supervisor', 'General Worker'],
    agriculture: ['Farm Worker', 'Packhouse Assistant', 'Tractor Driver', 'Supervisor', 'Irrigation Assistant'],
    logistics: ['Driver', 'Dispatch Clerk', 'Warehouse Assistant', 'Fleet Supervisor', 'Loader'],
    construction: ['Bricklayer', 'Site Assistant', 'Plant Operator', 'Foreman', 'General Worker'],
    retail: ['Cashier', 'Shelf Packer', 'Sales Assistant', 'Store Supervisor'],
    hospitality: ['Chef', 'Kitchen Assistant', 'Waiter', 'Cleaner', 'Supervisor']
}
const positionsFor = sector => {
    const s = String(sector || '').toLowerCase()
    const hit = Object.keys(POSITIONS).find(k => s.includes(k.slice(0, 5)))
    return POSITIONS[hit || 'default']
}
const ENDINGS = ['resigned', 'resigned', 'contract-ended', 'dismissed', 'retrenched']

/* ---------- sample document ---------- */
const samplePdf = () => {
    const body = 'BT /F1 18 Tf 72 720 Td (Sample employment contract - seed data) Tj ET'
    const objects = [
        '<< /Type /Catalog /Pages 2 0 R >>',
        '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
        `<< /Length ${body.length} >>\nstream\n${body}\nendstream`,
        '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
    ]
    let pdf = '%PDF-1.4\n'
    const offsets = []
    objects.forEach((o, i) => {
        offsets.push(pdf.length)
        pdf += `${i + 1} 0 obj\n${o}\nendobj\n`
    })
    const xref = pdf.length
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
    return Buffer.from(pdf, 'latin1')
}

const ensureSample = async () => {
    const file = app.storage().bucket().file(SAMPLE_PATH)
    const token = 'seed-hse-jobs-sample'
    const [exists] = await file.exists()
    if (!exists) {
        await file.save(samplePdf(), {
            contentType: 'application/pdf',
            metadata: { metadata: { firebaseStorageDownloadTokens: token, seedTag: SEED_TAG } }
        })
    }
    return `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(SAMPLE_PATH)}?alt=media&token=${token}`
}

/* ---------- plan ---------- */

/**
 * One SME's jobs. Returns contract documents (several per job for renewals
 * and re-uploads). `style` varies the SMEs: some uploaded the old way (no
 * jobId/startDate), some stopped uploading, one has nothing at all.
 */
const planSme = ({ application, participant, index, fileUrl }) => {
    const r = rng(`${SEED_TAG}:${application.id}`)
    const history = participant?.headcountHistory?.monthly || {}
    const months = Object.keys(history).filter(k => /^\d{4}-\d{2}$/.test(k)).sort()
    if (!months.length) return []

    const joined = application.acceptedAt?.toDate?.() || monthDate(months[0])
    const positions = positionsFor(participant?.sector || application.sector)
    const legacy = index % 3 === 0 // uploaded before start dates and job ids existed
    const stale = index % 7 === 3 // stopped uploading after June 2026
    const staleAfter = utc(2026, 5, 30)

    const usedNames = new Set()
    const person = () => {
        for (let i = 0; i < 50; i++) {
            const name = `${pick(r, FIRST)} ${pick(r, LAST)}`
            if (!usedNames.has(name)) {
                usedNames.add(name)
                return name
            }
        }
        return `Employee ${usedNames.size + 1}`
    }

    const docs = []
    let jobNo = 0
    const base = ({ jobId, employeeName, position, contractType, startDate, expiry, uploadMonth }) => ({
        applicationId: application.id,
        participantId: application.participantId || null,
        programId: application.programId,
        smmeName: application.beneficiaryName || application.companyName || participant?.beneficiaryName || 'SME',
        group: application.gapGroup || application.group || application.stage || 'Unspecified',
        gender: application.gender || participant?.gender || 'Unspecified',
        sector: participant?.sector || application.sector || 'Unspecified',
        jobId: legacy ? null : jobId,
        employeeName,
        position,
        contractType: contractType === 'permanent' ? 'permanent' : 'temporal',
        startDate: legacy ? null : ts(startDate),
        contractEndDate: contractType === 'permanent' ? ts(utc(2030, 11, 31)) : ts(expiry),
        endedAt: null,
        endReason: null,
        uploadMonth: monthKey(uploadMonth),
        uploadMonthDate: ts(uploadMonth),
        fileName: `${employeeName.replace(/\s+/g, '_')}_contract.pdf`,
        fileUrl,
        storagePath: null,
        uploadedByName: 'HSE (seed data)',
        uploadedByEmail: null,
        seedTag: SEED_TAG,
        dataOrigin: 'synthetic'
    })
    const add = (job, uploadMonth, extra = {}) => {
        if (stale && uploadMonth > staleAfter) return
        const n = job.docs++
        docs.push({
            id: `${SEED_TAG}-${application.id}-${String(job.no).padStart(2, '0')}-${n}`,
            data: { ...base({ ...job, uploadMonth }), ...extra, createdAt: ts(addMonths(uploadMonth, 0)), updatedAt: ts(uploadMonth) }
        })
    }
    const newJob = (contractType, startDate, expiry, position) => {
        jobNo += 1
        return {
            no: jobNo,
            docs: 0,
            jobId: `${application.id}::seed-${jobNo}`,
            employeeName: person(),
            position: position || pick(r, positions),
            contractType,
            startDate,
            expiry
        }
    }

    const firstMonth = monthDate(months[0])
    const permanent = []

    // Staff at joining: permanent people hired before the SME joined, and its
    // temporary staff on a short contract.
    const p0 = Number(history[months[0]].permanent || 0)
    for (let i = 0; i < p0; i++) {
        const started = utc(2021 + Math.floor(r() * 4), Math.floor(r() * 12), 1 + Math.floor(r() * 27))
        const job = newJob('permanent', started, null, i === 0 ? 'Supervisor' : undefined)
        permanent.push(job)
        add(job, firstMonth)
        // A few were re-uploaded at the annual review, the old way (same name/position).
        if (r() < 0.3) add(job, utc(2026, 7, 1))
    }

    // Permanent headcount moves month by month.
    let prev = p0
    months.slice(1).forEach(key => {
        const target = Number(history[key].permanent || 0)
        const month = monthDate(key)
        for (let i = prev; i < target; i++) {
            const job = newJob('permanent', dayIn(r, month), null)
            permanent.push(job)
            add(job, month)
        }
        for (let i = target; i < prev; i++) {
            const leaver = permanent.filter(j => !j.ended)[Math.floor(r() * permanent.filter(j => !j.ended).length)]
            if (!leaver) break
            leaver.ended = { endedAt: ts(dayIn(r, month)), endReason: pick(r, ENDINGS.filter(e => e !== 'contract-ended')) }
        }
        prev = target
    })

    // Churn: some SMEs lost a founding employee and replaced them.
    if (permanent.length > 1 && r() < 0.35) {
        const leaveMonth = utc(2026, 2 + Math.floor(r() * 5), 1)
        const leaver = permanent.find(j => !j.ended && j.startDate < joined)
        if (leaver) {
            leaver.ended = { endedAt: ts(dayIn(r, leaveMonth)), endReason: 'resigned' }
            const replacement = newJob('permanent', dayIn(r, addMonths(leaveMonth, 1)), null, leaver.position)
            permanent.push(replacement)
            add(replacement, addMonths(leaveMonth, 1))
        }
    }

    // Temporary contracts in the months the history shows temporary staff.
    months.forEach(key => {
        const count = Number(history[key].temporary || 0)
        const month = monthDate(key)
        for (let i = 0; i < count; i++) {
            const start = key === months[0] ? utc(month.getUTCFullYear(), month.getUTCMonth(), 1) : dayIn(r, month)
            const job = newJob('temporary', start, endOfMonth(addMonths(month, r() < 0.5 ? 0 : 1)))
            add(job, month)
        }
    })

    // Recent temporary work: some renewed mid-year, some expiring within a month.
    if (r() < 0.6) {
        const start = utc(2026, 4, 4)
        const job = newJob('temporary', start, utc(2026, 7, 31))
        add(job, utc(2026, 4, 1))
        if (r() < 0.7) {
            job.expiry = utc(2026, 10, 15 + Math.floor(r() * 14))
            add(job, utc(2026, 8, 1))
        }
    }
    if (r() < 0.45) {
        const job = newJob('temporary', utc(2026, 9, 1 + Math.floor(r() * 20)), utc(2026, 10, 20 + Math.floor(r() * 10)))
        add(job, utc(2026, 9, 1))
    }
    // A hire this month for some.
    if (r() < 0.3) {
        const job = newJob('permanent', utc(TODAY.getUTCFullYear(), TODAY.getUTCMonth(), 2), null)
        add(job, utc(TODAY.getUTCFullYear(), TODAY.getUTCMonth(), 1))
    }

    // Write each ended job's end on all of its documents.
    permanent.filter(j => j.ended).forEach(job => {
        docs.filter(d => d.id.startsWith(`${SEED_TAG}-${application.id}-${String(job.no).padStart(2, '0')}-`))
            .forEach(d => Object.assign(d.data, job.ended, legacy ? {} : { jobId: job.jobId }))
    })
    return docs
}

/* ---------- run ---------- */
const commitInChunks = async (ops) => {
    for (let i = 0; i < ops.length; i += 400) {
        const batch = db.batch()
        ops.slice(i, i + 400).forEach(op => op(batch))
        await batch.commit()
    }
}

;(async () => {
    const existing = await db.collection('hseJobContracts').where('seedTag', '==', SEED_TAG).get()

    if (REMOVE) {
        console.log(`${existing.size} seeded job documents to remove.`)
        if (APPLY) {
            await commitInChunks(existing.docs.map(d => b => b.delete(d.ref)))
            console.log('Removed.')
        } else console.log('Dry run: pass --apply to delete.')
        return
    }

    const appsSnap = await db.collection('applications').where('programId', '==', PROGRAM_ID).get()
    const apps = appsSnap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(a => String(a.applicationStatus || '').toLowerCase() === 'accepted')
        .sort((a, b) => a.id.localeCompare(b.id))
    if (!apps.length) {
        console.error(`No accepted applications in ${PROGRAM_ID}.`)
        process.exit(1)
    }

    const fileUrl = APPLY ? await ensureSample() : '(sample PDF)'
    const plan = []
    for (const [index, application] of apps.entries()) {
        // The last SME has no contracts at all, to show the empty state.
        if (index === apps.length - 1) continue
        const participant = application.participantId
            ? (await db.collection('participants').doc(application.participantId).get()).data()
            : null
        const docs = planSme({ application, participant, index, fileUrl })
        plan.push(...docs)
        const jobs = new Set(docs.map(d => d.data.jobId || `${d.data.employeeName}|${d.data.position}`))
        const ended = new Set(docs.filter(d => d.data.endedAt).map(d => d.data.jobId || `${d.data.employeeName}|${d.data.position}`))
        console.log(`${application.beneficiaryName || application.id}: ${jobs.size} jobs, ${docs.length} documents, ${ended.size} ended${index % 3 === 0 ? ', old-style uploads' : ''}${index % 7 === 3 ? ', stopped uploading after Jun 2026' : ''}`)
    }

    const keep = new Set(plan.map(p => p.id))
    const stale = existing.docs.filter(d => !keep.has(d.id))
    console.log(`\n${plan.length} documents across ${apps.length - 1} SMEs (${apps[apps.length - 1].beneficiaryName || apps[apps.length - 1].id} left empty); ${stale.length} old seeded documents to delete.`)
    if (!APPLY) {
        console.log('Dry run: pass --apply to write.')
        return
    }
    await commitInChunks([
        ...plan.map(p => b => b.set(db.collection('hseJobContracts').doc(p.id), p.data)),
        ...stale.map(d => b => b.delete(d.ref))
    ])
    console.log('Written.')
})().catch(error => {
    console.error(error)
    process.exit(1)
})
