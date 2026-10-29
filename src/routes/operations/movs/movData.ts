import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import { collection, doc, getDoc, getDocs, limit as qlimit, query, where } from 'firebase/firestore'
import { db } from '@/firebase'
import type { ConsolidatedPack, MovDoc } from '@/types/mov'
import { USE_SENSITIVE_DEPARTMENT_SUMMARY_INSTEAD_OF_POE } from '@/config/evidencePolicy'
import {
    getPreIncAgreementUrl,
    hasPreIncAgreementEvidence,
    isOnboardingMov,
    isSmeConfirmedMov,
    resolveMovAppointmentInterventions,
    resolveMovKpiNames
} from '@/services/movService'

dayjs.extend(customParseFormat)

/**
 * The MOV workspace's data rules: dates, status words, evidence, which
 * monthly pack an MOV belongs to, and the full "enrichment" an MOV needs
 * before it's shown as a document, downloaded or packed.
 */

/** MOV documents carry many optional legacy fields; read them loosely. */
export type Mov = MovDoc & Record<string, any>
export type Pack = ConsolidatedPack & Record<string, any>
export type PoeResource = { type?: string; label?: string; link: string }

export const safeToDate = (v: any): Date | null => {
    if (!v) return null
    if (typeof v?.toDate === 'function') return v.toDate()
    if (typeof v?.seconds === 'number') return new Date(v.seconds * 1000)
    const d = new Date(v)
    return isNaN(+d) ? null : d
}

export const fmtDate = (v: any, format = 'D MMM YYYY') => {
    const d = safeToDate(v)
    return d ? dayjs(d).format(format) : '—'
}

export const monthLabel = (key?: string | null, format = 'MMMM YYYY') =>
    key && dayjs(key, 'YYYY-MM', true).isValid() ? dayjs(key, 'YYYY-MM').format(format) : key || '—'

export const clip = (s?: string) => (s ? `${s.slice(0, 10)}…${s.slice(-6)}` : '—')

// ---- dates ----------------------------------------------------------------------

export const resolveMovAssignmentDate = (mov: any): Date | null =>
    safeToDate(mov?.assignmentCreatedAt || mov?.periodStart || mov?.interventionDate || mov?.assignedAt || mov?.createdAt)

/** "Ended": the day the SME confirmed the MOV, not the appointment or facilitator completion. */
export const resolveMovCompletionDate = (mov: any): Date | null =>
    safeToDate(mov?.smmeAcceptedAt || mov?.smmeSignedAt || mov?.periodEnd)

/** The month an MOV's work belongs to: its due date's month (assignment date for older MOVs). */
export const resolveMovDueMonth = (mov: any): string | null => {
    const d = safeToDate(mov?.dueDate) || resolveMovAssignmentDate(mov)
    return d ? dayjs(d).format('YYYY-MM') : null
}

// ---- status --------------------------------------------------------------------

export type MovStatus = 'review' | 'queried' | 'approved' | 'disputed'

export const movStatus = (mov: any): MovStatus =>
    mov?._dispute ? 'disputed' : String(mov?.status || '').toLowerCase() === 'queried' ? 'queried' : mov?.approvedByHod === true ? 'approved' : 'review'

export const MOV_STATUS_META: Record<MovStatus, { label: string; tone: 'info' | 'warning' | 'success' | 'danger' }> = {
    review: { label: 'To review', tone: 'info' },
    queried: { label: 'Queried', tone: 'warning' },
    approved: { label: 'Approved', tone: 'success' },
    disputed: { label: 'Dispute', tone: 'danger' }
}

export type PackStage = 'cc' | 'me' | 'verified'

export const packStage = (pack: any): PackStage => {
    const steps = ((pack?.approvals || []) as any[]).map(a => a?.step)
    if (steps.includes('validation')) return 'verified'
    if (steps.includes('final_confirmation')) return 'me'
    return 'cc'
}

export const PACK_STAGE_META: Record<PackStage, { label: string; tone: 'info' | 'warning' | 'success' }> = {
    cc: { label: 'Awaiting CC', tone: 'info' },
    me: { label: 'Awaiting M&E', tone: 'warning' },
    verified: { label: 'Verified', tone: 'success' }
}

/** Locked once the Center Coordinator confirms it: its contents can no longer change. */
export const isPackLocked = (pack: any) => packStage(pack) !== 'cc'

export const packItems = (pack: any): Mov[] => pack?.interventions || pack?.interventionsSnapshot || []

export const packInvoice = (pack: any): { url: string; name: string } | null => {
    const inv = pack?.invoiceAttachment
    const url = typeof inv === 'string' ? inv : inv?.url
    return url ? { url, name: typeof inv === 'string' ? 'Invoice' : inv?.name || 'Invoice' } : null
}

// ---- evidence ------------------------------------------------------------------

const linksOf = (record: any): string[] =>
    Array.isArray(record?.resources)
        ? Array.from(new Set(record.resources.map((r: any) => r?.link || r?.url || r?.href).filter((x: any) => typeof x === 'string' && x.startsWith('http'))))
        : []

export const hasMovEvidence = (mov: any): boolean => {
    if (hasPreIncAgreementEvidence(mov)) return true
    const urls = [...(Array.isArray(mov?.poeUrls) ? mov.poeUrls : []), ...linksOf(mov)].filter(Boolean)
    const notes = typeof mov?.evidenceNotes === 'string' ? mov.evidenceNotes.trim() : ''
    return urls.length > 0 || notes.length > 0
}

/** Every distinct evidence link for an MOV, labelled. */
export const buildPoeList = (mov?: any, ...extra: PoeResource[][]): PoeResource[] => {
    const byLink = new Map<string, PoeResource>()
    const add = (r: any, fallbackLabel = '') => {
        const link = String(r?.link || r?.url || r?.href || '').trim()
        if (!link || !link.startsWith('http') || byLink.has(link)) return
        byLink.set(link, { type: r?.type, label: r?.label || fallbackLabel, link })
    }
    extra.flat().forEach(r => add(r))
    ;(Array.isArray(mov?.resources) ? mov.resources : []).forEach((r: any) => add(r))
    const preIncUrl = getPreIncAgreementUrl(mov)
    if (hasPreIncAgreementEvidence(mov) && preIncUrl) add({ type: 'signed_agreement', link: preIncUrl }, 'Signed Pre-Incubation Agreement')
    ;(Array.isArray(mov?.poeUrls) ? mov.poeUrls : []).forEach((url: string, i: number) => add({ link: url }, `POE ${i + 1}`))
    return Array.from(byLink.values()).map((r, i) => ({ ...r, label: r.label || r.type || `POE ${i + 1}` }))
}

// ---- loading -----------------------------------------------------------------

export async function getFirst<T = any>(qy: any): Promise<(T & { id: string }) | null> {
    const snap = await getDocs(qy)
    if (snap.empty) return null
    const d = snap.docs[0]
    return { id: d.id, ...(d.data() as any) }
}

/** The MOVs a HOD reviews: confirmed by the SME, or already decided. */
export const isReviewableMov = (mov: any) => isSmeConfirmedMov(mov) || mov.status === 'approved' || mov.status === 'queried'

/**
 * The list's light view of an MOV: one read of its assignment for the due
 * date and any evidence stored there. The full enrichment (participant,
 * application, appointments, KPIs…) waits until the MOV is opened or packed.
 */
export const withAssignmentBasics = async (movs: Mov[]): Promise<Mov[]> =>
    Promise.all(movs.map(async mov => {
        const assignmentId = String(mov.assignedInterventionId || '').trim()
        if (!assignmentId) return mov
        try {
            const snap = await getDoc(doc(db, 'assignedInterventions', assignmentId))
            const ai = snap.data() as any
            if (!ai) return mov
            const merged = [...(Array.isArray(mov.resources) ? mov.resources : []), ...(Array.isArray(ai.resources) ? ai.resources : [])]
            return { ...mov, dueDate: mov.dueDate || ai.dueDate || null, resources: merged }
        } catch {
            return mov
        }
    }))

// ---- full enrichment (moved unchanged in behaviour from the page) ----------------

type FrequencyUI = MovDoc['frequency'] | 'once'

const normalizeMovText = (value: any) => String(value ?? '').trim().toLowerCase()

const extractEvidenceNotes = (record?: any): string =>
    String(record?.consultantNotes || record?.interventionSummary || record?.summary || record?.notes || record?.evidenceNotes || '').trim()

const hasDeliveryPayload = (obj: any): boolean => {
    if (!obj) return false
    const dm = obj.deliveryMethod ?? obj.method
    return (typeof dm === 'string' && !!dm.trim()) || (Array.isArray(dm) && dm.length > 0) || (Array.isArray(obj.deliveryMethods) && obj.deliveryMethods.length > 0)
}

const parseDeliveryFlags = (ai: any, existing: any) => {
    const srcObj = hasDeliveryPayload(ai) ? ai : existing
    const src = (srcObj?.deliveryMethod ?? srcObj?.method ?? '').toString().toLowerCase().replace(/_/g, ' ')
    const arr = Array.isArray(srcObj?.deliveryMethods) ? srcObj.deliveryMethods.map((x: any) => String(x).toLowerCase()) : []
    const mArr = Array.isArray(srcObj?.method) ? srcObj.method.map((x: any) => String(x).toLowerCase()) : []
    const has = (s: string) => src.includes(s) || arr.includes(s) || mArr.includes(s)

    let methodInPerson = existing?.methodInPerson ?? (src === 'in-person' || src === 'in person')
    let methodOnline = existing?.methodOnline ?? src === 'online'
    let methodTelephonic = existing?.methodTelephonic ?? src === 'telephonic'
    if (!methodInPerson) methodInPerson = has('in_person') || has('in person') || has('physical') || has('onsite')
    if (!methodOnline) methodOnline = has('online') || has('virtual') || has('remote')
    if (!methodTelephonic) methodTelephonic = has('telephonic') || has('telephone') || has('phone') || has('call')
    let methodOther = existing?.methodOther ?? ''
    if (!methodInPerson && !methodOnline && !methodTelephonic) methodOther = src || (arr[0] ?? mArr[0] ?? '')
    return { methodInPerson, methodOnline, methodTelephonic, methodOther }
}

const parseFrequency = (raw: any): FrequencyUI | undefined => {
    const s = String(raw ?? '').toLowerCase().trim()
    if (!s) return undefined
    if (s.includes('needed') || s.includes('ad-hoc') || s.includes('ad hoc')) return 'as-needed'
    if (s.includes('week')) return 'weekly'
    if (s.includes('two') || s.includes('bi')) return 'biweekly'
    if (s.includes('month')) return 'monthly'
    if (s.includes('once') || s.includes('one-off') || s.includes('one off')) return 'once'
    return undefined
}

const isExplicitlyNonRecurring = (obj: any): boolean => {
    if (!obj) return false
    const v = obj.isRecurring ?? obj.recurring ?? obj.isRecurrent ?? obj.recurrenceEnabled ?? obj.enableRecurrence ?? obj.isRepeatable
    return typeof v === 'boolean' ? v === false : false
}

const resolveFrequencyByInterventionId = async (interventionId?: string): Promise<FrequencyUI | undefined> => {
    if (!interventionId) return undefined
    try {
        const snap = await getDoc(doc(db, 'interventions', String(interventionId)))
        if (!snap.exists()) return undefined
        const data = snap.data() as any
        if (isExplicitlyNonRecurring(data)) return 'once'
        return parseFrequency(data.frequency ?? data.recurrence ?? data.recurrenceFrequency ?? data.interval ?? data.scheduleFrequency ?? data.repeat ?? '')
    } catch {
        return undefined
    }
}

const sensitiveDepartmentCache = new Map<string, Promise<boolean>>()
const isSensitiveDepartment = (departmentId?: string | null) => {
    if (!departmentId) return Promise.resolve(false)
    if (!sensitiveDepartmentCache.has(departmentId)) {
        sensitiveDepartmentCache.set(departmentId, getDoc(doc(db, 'departments', departmentId))
            .then(s => s.exists() && s.data()?.isSensitive === true)
            .catch(() => false))
    }
    return sensitiveDepartmentCache.get(departmentId)!
}

/** Evidence written against the MOV's assignment(s), plus the pre-incubation agreement for onboarding MOVs. */
export async function resolveMovPoeData(mov: any, ai?: any) {
    let resources: PoeResource[] = []
    const preIncUrl = getPreIncAgreementUrl(mov)
    if (hasPreIncAgreementEvidence(mov) && preIncUrl) resources.push({ type: 'signed_agreement', label: 'Signed Pre-Incubation Agreement', link: preIncUrl })

    const merge = (record: any) => {
        const list = Array.isArray(record?.resources) ? record.resources : []
        resources = resources.concat(list
            .filter((r: any) => r && typeof (r.link || r.url || r.href) === 'string')
            .map((r: any) => ({ type: r.type, label: r.label, link: r.link || r.url || r.href })))
    }

    // Older flows don't always carry the same relationship field: try every known assignment key.
    const keys = Array.from(new Set([
        mov?.assignedInterventionId, mov?.assignedId, mov?.interventionKey, mov?.interventionAssignmentId,
        mov?.groupAssignmentId, mov?.groupKey, mov?.groupId, ai?.id
    ].map(v => String(v || '').trim()).filter(Boolean)))
    for (const key of keys) {
        if (ai?.id === key) {
            merge(ai)
            continue
        }
        try {
            const snap = await getDoc(doc(db, 'assignedInterventions', key))
            if (snap.exists()) merge(snap.data())
        } catch (error) {
            console.warn('[MOVs] Could not read assigned intervention POE', { key, error })
        }
    }

    const normalized = Array.from(new Map(resources.filter(r => r?.link?.startsWith('http')).map(r => [r.link, r])).values())
    let evidenceNotes = ''
    if (USE_SENSITIVE_DEPARTMENT_SUMMARY_INSTEAD_OF_POE && !normalized.length && await isSensitiveDepartment(ai?.departmentId || null)) {
        evidenceNotes = extractEvidenceNotes(mov) || extractEvidenceNotes(ai)
    }
    return { poeUrls: normalized.map(r => r.link), resources: normalized, evidenceNotes }
}

/**
 * Everything the MOV document, its download and the monthly pack need:
 * the SME's application for this programme, branch, assignment, delivery
 * method, frequency, appointment sessions, KPIs and evidence.
 */
export async function enrichMov(mov: Mov, activeProgramId?: string | null): Promise<Mov> {
    const beneficiaryId = mov.participantId || mov.beneficiaryId || mov.smmeId || ''
    const programId = mov.programId || activeProgramId

    const [participant, app] = await Promise.all([
        beneficiaryId
            ? getDoc(doc(db, 'participants', beneficiaryId)).then(s => (s.exists() ? { id: s.id, ...(s.data() as any) } : null)).catch(() => null)
            : Promise.resolve(null),
        beneficiaryId
            ? (async () => {
                // An SME can apply to several programmes: read this MOV's programme's application.
                const own = programId
                    ? await getFirst(query(collection(db, 'applications'), where('participantId', '==', beneficiaryId), where('programId', '==', programId), qlimit(1)))
                    : null
                return own || getFirst(query(collection(db, 'applications'), where('participantId', '==', beneficiaryId), qlimit(1)))
            })()
            : Promise.resolve(null)
    ])

    let officeAreaName = mov.officeAreaName || ''
    if (app?.branchId) {
        try {
            const b = await getDoc(doc(db, 'branches', String(app.branchId)))
            if (b.exists()) officeAreaName = (b.data() as any).name || (b.data() as any).branchName || officeAreaName
        } catch {
            // keep what the MOV had
        }
    }

    let ai: any = null
    if (mov.assignedInterventionId) {
        const s = await getDoc(doc(db, 'assignedInterventions', mov.assignedInterventionId))
        if (s.exists()) ai = { id: s.id, ...s.data() }
    }
    if (!ai && mov.interventionId && beneficiaryId) {
        const parts: any[] = [collection(db, 'assignedInterventions'), where('interventionId', '==', mov.interventionId), where('participantId', '==', beneficiaryId)]
        if (activeProgramId) parts.push(where('programId', '==', activeProgramId))
        parts.push(qlimit(1))
        ai = await getFirst((query as any)(...parts))
    }

    const { methodInPerson, methodOnline, methodTelephonic, methodOther } = parseDeliveryFlags(ai, mov)
    let frequency: FrequencyUI | undefined
    if (isExplicitlyNonRecurring(ai)) frequency = 'as-needed'
    if (!frequency) frequency = parseFrequency(ai?.frequency)
    if (!frequency) frequency = parseFrequency(mov.frequency)
    if (!frequency) frequency = await resolveFrequencyByInterventionId(mov.interventionId)
    if (!frequency) frequency = 'once'

    const periodStart = mov.periodStart || mov.interventionDate || ai?.createdAt || null
    const periodEnd = mov.periodEnd || mov.smmeAcceptedAt || mov.smmeSignedAt || ai?.participantConfirmedAt || null
    const stored = Array.isArray(mov.appointmentInterventions) ? mov.appointmentInterventions : []

    // The SMME number is captured on the application; field naming varies on older records.
    const smmeNo = app?.smmeNo || app?.smmENo || app?.SMMENo || mov.smmeNo || ''

    const onboarding = isOnboardingMov({
        ...mov,
        isOnboarding: mov.isOnboarding === true || ai?.isOnboarding === true || ai?.onboarding === true,
        interventionTitle: mov.interventionTitle || ai?.snapshot?.interventionTitle || ai?.interventionTitle || ai?.title || ''
    })
    const rawPreIncMeta = mov.preIncubationAgreementMeta || app?.signedAgreements?.['pre-incubation-contract'] || participant?.signedAgreements?.['pre-incubation-contract'] || null
    // Only an onboarding intervention uses the Pre-Incubation Agreement as its evidence.
    const preIncubationAgreementMeta = onboarding ? rawPreIncMeta : null
    const preIncubationAgreement = onboarding && (
        mov.preIncubationAgreement === true ||
        normalizeMovText(mov.verificationMethod) === 'signed_preinc_agreement' ||
        rawPreIncMeta === true ||
        rawPreIncMeta?.signed === true ||
        rawPreIncMeta?.participantSigned === true ||
        !!rawPreIncMeta?.participantSignatureURL ||
        !!rawPreIncMeta?.userSignatureURL ||
        !!rawPreIncMeta?.signer ||
        !!rawPreIncMeta?.acceptedAt
    )

    const [appointmentInterventions, kpiServiced, poe] = await Promise.all([
        !stored.length && (mov.interventionId || ai?.interventionId)
            ? resolveMovAppointmentInterventions(db, ai?.id ? { ...ai, id: ai.id } : {
                id: mov.assignedInterventionId || '',
                participantId: beneficiaryId,
                interventionId: mov.interventionId,
                interventionTitle: mov.interventionTitle,
                programId: mov.programId,
                periodStart,
                periodEnd,
                smmeEmail: mov.participantEmail || mov.smmeEmail,
                completedAt: mov.completedAt,
                participantConfirmedAt: mov.smmeAcceptedAt || mov.smmeSignedAt,
                assigneeCompletedAt: mov.facilitatorSignedAt
            })
            : Promise.resolve(stored),
        resolveMovKpiNames(db, ai?.databaseInterventionId || mov.databaseInterventionId || mov.interventionId),
        resolveMovPoeData({ ...mov, preIncubationAgreement, preIncubationAgreementMeta }, ai)
    ])

    return {
        ...mov,
        dueDate: mov.dueDate || ai?.dueDate || null,
        preIncubationAgreement,
        preIncubationAgreementMeta,
        assignmentCreatedAt: ai?.createdAt || mov.assignmentCreatedAt || mov.periodStart || mov.interventionDate || null,
        subInterventionId: mov.subInterventionId || ai?.subInterventionId || null,
        subInterventionTitle: mov.subInterventionTitle || ai?.subInterventionTitle || ai?.subInterventionName || null,
        officeAreaName,
        gapGroup: app?.group || app?.gapGroup || mov.gapGroup || '',
        smmeSector: mov.smmeSector || participant?.sector || app?.sector || '',
        frequency,
        periodStart,
        periodEnd,
        appointmentInterventions,
        methodInPerson,
        methodOnline,
        methodTelephonic,
        methodOther,
        kpiServiced,
        facilitatorSignatureUrl: mov.facilitatorSignatureUrl || '',
        facilitatorDigitalSignature: '',
        smmeSignatureUrl: mov.smmeSignatureUrl || '',
        smmeDigitalSignature: '',
        smmeNo,
        resources: poe.resources.length ? poe.resources : Array.isArray(mov.resources) ? mov.resources : [],
        poeUrls: poe.poeUrls,
        evidenceNotes: poe.evidenceNotes || ''
    } as Mov
}

// ---- pack snapshot -------------------------------------------------------------

const stripUndefinedDeep = (value: any): any => {
    if (value === undefined) return undefined
    if (value === null || value instanceof Date || (value && typeof value.toDate === 'function')) return value
    if (Array.isArray(value)) return value.map(stripUndefinedDeep).filter(v => v !== undefined)
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripUndefinedDeep(v)]).filter(([, v]) => v !== undefined))
    }
    return value
}

/**
 * The copy of an MOV stored in a pack. The Center Coordinator and M&E pages
 * render MOV documents from it, so it stays complete - only the progress log,
 * which nothing reads from a pack, is left out to keep large months under
 * Firestore's 1 MB document limit.
 */
export const packSnapshotOf = (mov: Mov) => {
    const { progressUpdates: _omit, ...rest } = mov as any
    return stripUndefinedDeep({
        ...rest,
        interventionDate: safeToDate(rest.interventionDate) || rest.interventionDate || null,
        resources: Array.isArray(rest.resources)
            ? rest.resources.map((r: any) => ({
                ...(r?.type !== undefined ? { type: r.type } : {}),
                ...(r?.label !== undefined ? { label: r.label } : {}),
                ...(r?.link !== undefined ? { link: r.link } : {})
            }))
            : []
    })
}

export { stripUndefinedDeep }

// ---- funder branding -------------------------------------------------------------

/** A programme's funder logo and name for MOV documents, read once per programme. */
const brandingCache = new Map<string, Promise<{ funderLogoUrl: string | null; funderName: string | null }>>()
export const programBranding = (programId?: string | null) => {
    const id = String(programId || '').trim()
    if (!id) return Promise.resolve({ funderLogoUrl: null, funderName: null })
    if (!brandingCache.has(id)) {
        brandingCache.set(id, getDoc(doc(db, 'programs', id))
            .then(snap => {
                const data = (snap.data() || {}) as any
                const logo = [data.funderLogoUrl, data.funder?.logoUrl, data.logoUrl, data.funderLogo].find(v => typeof v === 'string' && v)
                const name = [data.assignedFunder, data.funder?.name, data.funderName].find(v => typeof v === 'string' && v)
                return { funderLogoUrl: logo || null, funderName: name || null }
            })
            .catch(() => ({ funderLogoUrl: null, funderName: null })))
    }
    return brandingCache.get(id)!
}
