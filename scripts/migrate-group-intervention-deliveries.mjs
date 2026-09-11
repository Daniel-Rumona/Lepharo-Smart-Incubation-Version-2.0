/**
 * Creates one shared delivery document per grouped assigned intervention.
 *
 * The assignment documents remain the source of SME membership, attendance
 * and MOV eligibility. This migration does not alter them.
 *
 * Default: writes a report and backup only. Add --write to create the shared
 * groupInterventionDeliveries records.
 */
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const bufferModule = require('node:buffer')
if (!bufferModule.SlowBuffer) bufferModule.SlowBuffer = bufferModule.Buffer
const { default: admin } = await import('firebase-admin')

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const keyPath = process.env.SERVICE_ACCOUNT_KEY || path.join(here, 'serviceAccountKey.json')
const writeMode = process.argv.includes('--write')
const generatedAt = new Date().toISOString()
const stamp = generatedAt.replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
const backupDir = path.join(root, 'backups', `group-delivery-pre-migration-${stamp}`)
const reportPath = path.join(here, 'group-intervention-delivery-migration-report.json')

if (!fs.existsSync(keyPath)) throw new Error(`Service account key not found: ${keyPath}`)
admin.initializeApp({ credential: admin.credential.cert(JSON.parse(fs.readFileSync(keyPath, 'utf8'))) })
const db = admin.firestore()
const FieldValue = admin.firestore.FieldValue

const clean = value => String(value ?? '').trim()
const number = value => Math.max(0, Math.min(100, Number(value) || 0))
const dateMs = value => value?.toDate?.()?.getTime?.() || new Date(value || 0).getTime() || 0
const groupDeliveryId = key => encodeURIComponent(key)
const hasProof = update => Array.isArray(update?.resources) && update.resources.some(resource => clean(resource?.link))
const updateIdentity = update => JSON.stringify({
    type: clean(update?.type),
    source: clean(update?.source),
    note: clean(update?.note),
    progress: number(update?.computedProgress),
    createdAt: dateMs(update?.createdAt),
    resources: (update?.resources || []).map(resource => clean(resource?.link)).filter(Boolean).sort()
})

const snapshot = await db.collection('assignedInterventions').get()
const groups = new Map()
snapshot.docs.forEach(document => {
    const data = document.data()
    const groupKey = clean(data.groupKey || data.groupId || data.groupAssignmentId)
    if (!groupKey) return
    const members = groups.get(groupKey) || []
    members.push({ id: document.id, ...data })
    groups.set(groupKey, members)
})

const backup = []
const deliveries = []
for (const [groupKey, members] of groups) {
    const orderedUpdates = members.flatMap(member => member.progressUpdates || [])
        .sort((a, b) => dateMs(a.createdAt) - dateMs(b.createdAt))
    const uniqueUpdates = Array.from(new Map(
        orderedUpdates.map(update => [updateIdentity(update), update])
    ).values())
    let progress = Math.max(0, ...members.map(member => number(member.computedProgress)), ...uniqueUpdates.map(update => number(update.computedProgress)))
    const proofUpdates = uniqueUpdates.filter(hasProof)
    const evidence = Array.from(new Map(proofUpdates.flatMap(update => update.resources || []).filter(resource => clean(resource?.link)).map(resource => [resource.link, resource])).values())
    const completedMember = members.find(member =>
        clean(member.assignmentStatus).toLowerCase() === 'completed' ||
        clean(member.assigneeCompletionStatus).toLowerCase() === 'completed' ||
        clean(member.participantCompletionStatus).toLowerCase() === 'confirmed'
    )
    // Delivery completion is shared by the whole group. Attendance is kept on
    // individual assignments and is evaluated only when issuing MOVs.
    if (completedMember) progress = 100
    const base = members[0]
    const deliveryStatus = progress >= 100 || completedMember
        ? 'completed'
        : progress > 0 ? 'in_progress' : 'not_started'
    const completedAt = completedMember?.completedAt || completedMember?.assigneeCompletedAt || null

    backup.push({ groupKey, members })
    deliveries.push({
        id: groupDeliveryId(groupKey),
        groupKey,
        programId: base.programId || null,
        departmentId: base.departmentId || null,
        interventionId: base.interventionId || null,
        interventionTitle: base.interventionTitle || null,
        subInterventionId: base.subInterventionId || null,
        subInterventionTitle: base.subInterventionTitle || null,
        assigneeId: base.assigneeId || null,
        assigneeEmail: base.assigneeEmail || null,
        assigneeName: base.assigneeName || null,
        progress,
        deliveryStatus,
        evidence,
        progressUpdates: uniqueUpdates,
        sourceAssignmentIds: members.map(member => member.id),
        completedAt,
        memberCount: members.length
    })
}

fs.mkdirSync(backupDir, { recursive: true })
fs.writeFileSync(path.join(backupDir, 'grouped-assigned-interventions.json'), JSON.stringify(backup, null, 2))

if (writeMode) {
    for (let index = 0; index < deliveries.length; index += 400) {
        const batch = db.batch()
        deliveries.slice(index, index + 400).forEach(delivery => {
            const { id, ...data } = delivery
            batch.set(db.collection('groupInterventionDeliveries').doc(id), {
                ...data,
                schemaVersion: 1,
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp()
            }, { merge: true })
        })
        await batch.commit()
    }
}

const report = {
    generatedAt,
    mode: writeMode ? 'write' : 'dry-run',
    sourceAssignmentCount: snapshot.size,
    groupedAssignmentCount: backup.reduce((sum, item) => sum + item.members.length, 0),
    groupDeliveryCount: deliveries.length,
    completedDeliveries: deliveries.filter(item => item.deliveryStatus === 'completed').length,
    deliveriesWithEvidence: deliveries.filter(item => item.evidence.length > 0).length,
    backupDir,
    samples: deliveries.slice(0, 10).map(({ id, groupKey, memberCount, progress, deliveryStatus }) => ({ id, groupKey, memberCount, progress, deliveryStatus }))
}
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
await admin.app().delete()
