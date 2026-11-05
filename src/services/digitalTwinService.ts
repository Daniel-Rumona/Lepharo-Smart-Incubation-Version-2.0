import { collection, doc, getDoc, getDocs, limit, orderBy, query, where } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/firebase'
import {
    buildTwinRecord,
    departmentScopeFor,
    getParticipantId,
    normalizeText,
    twinDayKey,
    twinIdFor,
    type AnyDoc,
    type DigitalTwinRecord,
    type RiskLevel,
    type TwinScope,
    type TwinSource,
    type TwinSources
} from '@twin/rules'

export type { DigitalTwinRecord } from '@twin/rules'

/** Route id that opens the twin with sample numbers instead of real records. */
export const SAMPLE_TWIN_ID = 'sample'
/** Route id an SME uses for their own twin; it resolves to their application. */
export const MY_TWIN_ID = 'mine'

/** Optional sources a viewer may be refused; SMEs cannot read staff-only records. */
export type TwinOptionalSource = 'program' | 'challenges' | 'reminderEmails' | 'monthlyMetrics' | 'jobContracts'

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
    /**
     * The same SME through the viewer's own department's services, as their Risk
     * Register shows it. Null when they see the whole SME (main and monitoring
     * departments, centre coordinators, admins) or the SME has no services from
     * their department.
     */
    department: { record: DigitalTwinRecord; history: TwinHistoryPoint[] } | null
    /** Sources this viewer is not allowed to read, so the numbers built from them are unknown here. */
    refused: TwinOptionalSource[]
}

/** Who is looking: their department decides whether a department view is offered. */
export type TwinViewer = AnyDoc | null | undefined

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

/** Reads one SME's raw documents, for the same rules the nightly job uses. */
async function loadSources(
    application: AnyDoc,
    participantId: string,
    programId: string | null
): Promise<{ sources: TwinSources; refused: TwinOptionalSource[] }> {
    const byParticipant = (name: string) =>
        getDocs(query(collection(db, name), where('participantId', '==', participantId))).then(docsOf)
    // A refused read is told apart from an empty one, so the twin never shows a staff-only zero as real.
    const refused: TwinOptionalSource[] = []
    const guarded = async <T,>(name: TwinOptionalSource, load: () => Promise<T>, fallback: T): Promise<T> => {
        try {
            return await load()
        } catch (error: any) {
            if (error?.code === 'permission-denied') refused.push(name)
            return fallback
        }
    }

    const [participantSnap, assignments, plans, departments, movs, uploads] = await Promise.all([
        getDoc(doc(db, 'participants', participantId)),
        byParticipant('assignedInterventions'),
        byParticipant('diagnosticPlans'),
        getDocs(collection(db, 'departments')).then(docsOf),
        byParticipant('movDocuments'),
        getDocs(collection(db, 'applications', application.id, 'complianceDocuments')).then(docsOf)
    ])

    const [program, challenges, reminderEmails, monthlyMetrics, jobContracts] = await Promise.all([
        guarded('program', async () => {
            if (!programId) return null
            const snap = await getDoc(doc(db, 'programs', programId))
            return snap.exists() ? (snap.data() as AnyDoc) : null
        }, null),
        guarded('challenges', () => getDocs(query(collection(db, 'operationalChallenges'), where('smeIds', 'array-contains', participantId))).then(docsOf), []),
        guarded('reminderEmails', () => byParticipant('emailLogs').then(rows => rows.filter(row => REMINDER_EMAIL_TYPES.has(normalizeText(row.type)))), []),
        guarded('monthlyMetrics', () => byParticipant('participantMonthlyMetrics'), []),
        guarded('jobContracts', () => byParticipant('hseJobContracts'), [])
    ])

    return {
        sources: {
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
        refused
    }
}

/**
 * The applications an SME may open twins for, the one their own twin opens
 * first: an accepted programme, then the newest. Empty when this login has none.
 */
export async function findMyApplicationIds(viewer: TwinViewer): Promise<string[]> {
    const applicationsWhere = async (field: string, value: unknown): Promise<AnyDoc[]> => {
        const text = normalizeText(value)
        if (!text) return []
        return optional(() => getDocs(query(collection(db, 'applications'), where(field, '==', text))).then(docsOf), [])
    }
    const lists = await Promise.all([applicationsWhere('email', viewer?.email), applicationsWhere('participantId', viewer?.participantId)])
    const found = new Map(lists.flat().map(item => [item.id, item]))
    const stamp = (item: AnyDoc) => {
        const value = item.submittedAt ?? item.createdAt
        const millis = typeof value?.toMillis === 'function' ? value.toMillis() : new Date(value ?? 0).getTime()
        return Number.isFinite(millis) ? millis : 0
    }
    const isAccepted = (item: AnyDoc) => normalizeText(item.applicationStatus).toLowerCase() === 'accepted'
    return [...found.values()]
        .sort((a, b) => Number(isAccepted(b)) - Number(isAccepted(a)) || stamp(b) - stamp(a))
        .map(item => item.id)
}

/** A saved day as one department saw it, from the scores every record keeps per department. */
const departmentPoint = (record: DigitalTwinRecord, scope: TwinScope): TwinHistoryPoint | null => {
    const slice = record.byDepartment?.find(item => item.departmentId === scope.departmentId)
    return slice ? { day: record.day, needsAttention: slice.score, level: slice.level, growth: record.growth.total, source: record.source } : null
}

/**
 * One SME's twin for one programme application. Shows a live calculation when
 * this user can read every source, otherwise the last record the server saved.
 * Peers and history always come from saved records, because they need other
 * SMEs and earlier days.
 */
export async function loadDigitalTwin(applicationId: string, viewer?: TwinViewer): Promise<DigitalTwinView> {
    const applicationSnap = await getDoc(doc(db, 'applications', applicationId))
    if (!applicationSnap.exists()) throw new Error('This application could not be found.')
    const application: AnyDoc = { id: applicationSnap.id, ...applicationSnap.data() }
    const participantId = getParticipantId(application)
    if (!participantId) throw new Error('This application is not linked to an SME yet.')
    const programId = normalizeText(application.programId) || null
    const twinId = twinIdFor(participantId, programId)

    const [saved, savedDays, loaded] = await Promise.all([
        optional(async () => {
            const snap = await getDoc(doc(db, 'digitalTwins', twinId))
            return snap.exists() ? (snap.data() as DigitalTwinRecord) : null
        }, null),
        optional(async () => {
            const snap = await getDocs(query(collection(db, 'digitalTwins', twinId, 'days'), orderBy('day', 'desc'), limit(HISTORY_DAYS)))
            return snap.docs.map(item => item.data() as DigitalTwinRecord)
        }, [] as DigitalTwinRecord[]),
        optional(() => loadSources(application, participantId, programId), null)
    ])
    const sources = loaded?.sources ?? null
    const now = new Date()
    // A record that cannot be built from unexpected data falls back to the last saved one.
    const build = (scope: TwinScope | null) => {
        if (!sources) return null
        try {
            return buildTwinRecord(sources, { now, source: 'live', scope })
        } catch {
            return null
        }
    }
    const live = build(null)

    if (!live && !saved) {
        throw new Error('The twin could not be calculated, and no saved record exists yet for this SME.')
    }

    const record: DigitalTwinRecord = live ? { ...live, peers: saved?.peers ?? [] } : saved!
    const today = twinDayKey(now)
    const pastDays = savedDays.filter(day => day.day !== today).reverse()
    const history = pastDays.map(historyPoint)
    history.push(historyPoint(record))

    // A department view only where this SME has planned services from the viewer's department.
    const scope = sources ? departmentScopeFor(viewer, sources.departments) : null
    const offered = !!scope && !!live && live.byDepartment.some(item => item.departmentId === scope.departmentId)
    const built = offered ? build(scope) : null
    const departmentRecord = built ? { ...built, peers: record.peers } : null
    const department = departmentRecord
        ? {
            record: departmentRecord,
            history: [
                ...pastDays.map(day => departmentPoint(day, scope!)).filter((point): point is TwinHistoryPoint => !!point),
                historyPoint(departmentRecord)
            ]
        }
        : null

    return {
        record,
        origin: live ? 'live' : 'saved',
        lastSavedAt: saved?.calculatedAt ?? null,
        history,
        department,
        // A saved record was built by the server from every source.
        refused: live ? loaded?.refused ?? [] : []
    }
}

/**
 * "Recalculate now": asks the server to recompute and save today's record.
 * Before the Cloud Functions are deployed this falls back to a fresh live
 * calculation, and reports that nothing was saved.
 */
export async function recalculateDigitalTwin(applicationId: string, viewer?: TwinViewer): Promise<{ view: DigitalTwinView; saved: boolean }> {
    let saved = false
    try {
        await httpsCallable(functions, 'recalculateDigitalTwin')({ applicationId })
        saved = true
    } catch (error) {
        console.warn('recalculateDigitalTwin callable unavailable; recalculating in the browser only.', error)
    }
    return { view: await loadDigitalTwin(applicationId, viewer), saved }
}
