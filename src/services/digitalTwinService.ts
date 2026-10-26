import { collection, doc, getDoc, getDocs, limit, orderBy, query, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/firebase'
import {
    buildTwinRecord,
    getParticipantId,
    normalizeText,
    twinDayKey,
    twinIdFor,
    type AnyDoc,
    type DigitalTwinRecord,
    type RiskLevel,
    type TwinSource
} from '@twin/rules'

export type { DigitalTwinRecord } from '@twin/rules'

/** Route id that opens the twin with sample numbers instead of real records. */
export const SAMPLE_TWIN_ID = 'sample'

export type TwinHistoryPoint = {
    day: string
    needsAttention: number
    level: RiskLevel
    growth: number
    source: TwinSource
}

export type DigitalTwinView = {
    record: DigitalTwinRecord
    /** live: calculated in this browser now; saved: the last server record; sample: made up. */
    origin: 'live' | 'saved' | 'sample'
    /** When the server last saved this SME's record, if it ever has. */
    lastSavedAt: string | null
    /** One point per saved day, oldest first, ending with today. */
    history: TwinHistoryPoint[]
}

// Same reminder types the Risk Register counts as contact with the SME.
const REMINDER_EMAIL_TYPES = new Set([
    'DEV_PLAN_SME_REMINDER',
    'INTERVENTION_REMINDER',
    'COMPLIANCE_REMINDER',
    'COMPLIANCE_EXPIRY_REMINDER'
])

const HISTORY_DAYS = 120

const docsOf = (snapshot: { docs: Array<{ id: string; data: () => any }> }): AnyDoc[] =>
    snapshot.docs.map(item => ({ id: item.id, ...item.data() }))

/** Optional sources: a missing permission or index leaves them empty instead of failing the twin. */
const optional = async <T,>(load: () => Promise<T>, fallback: T): Promise<T> => {
    try {
        return await load()
    } catch {
        return fallback
    }
}

const historyPoint = (record: DigitalTwinRecord): TwinHistoryPoint => ({
    day: record.day,
    needsAttention: record.needsAttention.score,
    level: record.needsAttention.level,
    growth: record.growth.total,
    source: record.source
})

/** Calculates the twin in the browser with the same rules the nightly job uses. */
async function calculateLive(application: AnyDoc, participantId: string, programId: string | null): Promise<DigitalTwinRecord> {
    const byParticipant = (name: string) =>
        getDocs(query(collection(db, name), where('participantId', '==', participantId))).then(docsOf)

    const [participantSnap, assignments, plans, departments, movs, uploads] = await Promise.all([
        getDoc(doc(db, 'participants', participantId)),
        byParticipant('assignedInterventions'),
        byParticipant('diagnosticPlans'),
        getDocs(collection(db, 'departments')).then(docsOf),
        byParticipant('movDocuments'),
        getDocs(collection(db, 'applications', application.id, 'complianceDocuments')).then(docsOf)
    ])

    const [program, challenges, reminderEmails, monthlyMetrics, jobContracts] = await Promise.all([
        optional(async () => {
            if (!programId) return null
            const snap = await getDoc(doc(db, 'programs', programId))
            return snap.exists() ? (snap.data() as AnyDoc) : null
        }, null),
        optional(() => getDocs(query(collection(db, 'operationalChallenges'), where('smeIds', 'array-contains', participantId))).then(docsOf), []),
        optional(() => byParticipant('emailLogs').then(rows => rows.filter(row => REMINDER_EMAIL_TYPES.has(normalizeText(row.type)))), []),
        optional(() => byParticipant('participantMonthlyMetrics'), []),
        optional(() => byParticipant('hseJobContracts'), [])
    ])

    return buildTwinRecord(
        {
            application,
            participant: participantSnap.exists() ? { id: participantSnap.id, ...participantSnap.data() } : {},
            program,
            diagnosticPlans: plans,
            assignments,
            departments,
            movs,
            complianceUploads: uploads,
            challenges,
            reminderEmails,
            monthlyMetrics,
            jobContracts
        },
        { source: 'live' }
    )
}

/**
 * One SME's twin for one programme application. Shows a live calculation when
 * this user can read every source, otherwise the last record the server saved.
 * Peers and history always come from saved records, because they need other
 * SMEs and earlier days.
 */
export async function loadDigitalTwin(applicationId: string): Promise<DigitalTwinView> {
    const applicationSnap = await getDoc(doc(db, 'applications', applicationId))
    if (!applicationSnap.exists()) throw new Error('This application could not be found.')
    const application: AnyDoc = { id: applicationSnap.id, ...applicationSnap.data() }
    const participantId = getParticipantId(application)
    if (!participantId) throw new Error('This application is not linked to an SME yet.')
    const programId = normalizeText(application.programId) || null
    const twinId = twinIdFor(participantId, programId)

    const [saved, savedDays, live] = await Promise.all([
        optional(async () => {
            const snap = await getDoc(doc(db, 'digitalTwins', twinId))
            return snap.exists() ? (snap.data() as DigitalTwinRecord) : null
        }, null),
        optional(async () => {
            const snap = await getDocs(query(collection(db, 'digitalTwins', twinId, 'days'), orderBy('day', 'desc'), limit(HISTORY_DAYS)))
            return snap.docs.map(item => item.data() as DigitalTwinRecord)
        }, [] as DigitalTwinRecord[]),
        optional(() => calculateLive(application, participantId, programId), null)
    ])

    if (!live && !saved) {
        throw new Error('The twin could not be calculated, and no saved record exists yet for this SME.')
    }

    const record: DigitalTwinRecord = live ? { ...live, peers: saved?.peers ?? [] } : saved!
    const today = twinDayKey(new Date())
    const history = savedDays
        .filter(day => day.day !== today)
        .map(historyPoint)
        .reverse()
    history.push(historyPoint(record))

    return {
        record,
        origin: live ? 'live' : 'saved',
        lastSavedAt: saved?.calculatedAt ?? null,
        history
    }
}

/**
 * "Recalculate now": asks the server to recompute and save today's record.
 * Before the Cloud Functions are deployed this falls back to a fresh live
 * calculation, and reports that nothing was saved.
 */
export async function recalculateDigitalTwin(applicationId: string): Promise<{ view: DigitalTwinView; saved: boolean }> {
    let saved = false
    try {
        await httpsCallable(functions, 'recalculateDigitalTwin')({ applicationId })
        saved = true
    } catch (error) {
        console.warn('recalculateDigitalTwin callable unavailable; recalculating in the browser only.', error)
    }
    return { view: await loadDigitalTwin(applicationId), saved }
}
