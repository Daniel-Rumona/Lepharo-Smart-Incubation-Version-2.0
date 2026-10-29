import { collection, doc, getDoc, getDocs, query, where, type DocumentSnapshot } from 'firebase/firestore'
import dayjs, { type Dayjs } from 'dayjs'
import { db } from '@/firebase'

/**
 * Pure helpers for the Applications page: turning an `applications` document
 * into the shape the page renders, reading AI evaluations, profile answers and
 * the linked participant. No React here — the hook and components import
 * these, and the same normaliser is used for the initial list and for the
 * single-document refresh after a decision.
 */

export type ApplicationStatus = 'pending' | 'accepted' | 'rejected'

export type ApplicationContact = {
    phone: string
    email: string
    website: string
    facebook?: string
    instagram?: string
    linkedin?: string
}

export type ApplicationLocation = {
    streetAddress: string
    suburb?: string
    city: string
    province: string
    postalCode: string
    hub: string
}

export type ApplicationDecision = {
    status?: ApplicationStatus
    decidedAt?: unknown
    decidedBy?: { uid?: string | null; email?: string | null }
    reason?: string
}

export type Application = {
    id: string
    beneficiaryName: string
    email: string
    gender: string
    ageGroup: string
    stage: string
    hub: string
    motivation: string
    challenges: string
    documents: { type?: string; fileName?: string; url: string }[]
    growthPlanDocUrl: string | null
    applicationStatus: ApplicationStatus
    programId: string | null
    participantId?: string
    decision: ApplicationDecision | null
    rejectionReason?: string
    submittedAt: Dayjs | null
    aiScore: number | null
    aiRecommendation: string
    aiJustification: string
    _contact: ApplicationContact
    _location: ApplicationLocation
    _fullAddress: string
    /** Everything else on the document, for the export and profile answers. */
    [key: string]: any
}

export type ProgramQuestionMap = Record<string, string>

export const STATUS_META: Record<ApplicationStatus, { label: string; color: 'warning' | 'success' | 'error' }> = {
    pending: { label: 'Pending', color: 'warning' },
    accepted: { label: 'Accepted', color: 'success' },
    rejected: { label: 'Rejected', color: 'error' }
}

const HIDDEN_DOMAINS = ['quantilytix.co.za']

/** The team's own test applications, hidden from everyone but control accounts. */
export const isInternalEmail = (email?: string) =>
    !!email && HIDDEN_DOMAINS.some(d => email.toLowerCase().trim().endsWith(`@${d}`))

export const isControlAccountEmail = (email?: string | null) =>
    (email || '').toLowerCase().trim().endsWith('@quantilytix.co.za')

export const emailKey = (e?: string) => (e || '').toLowerCase().trim()

/**
 * One address line. The street field often already holds the city and
 * province ("Pretoria, KwaZulu-Natal"), so every comma-separated part is
 * de-duplicated, case-insensitively, keeping its first occurrence.
 */
const joinAddr = (a: Partial<ApplicationLocation>) => {
    const seen = new Set<string>()
    return [a.streetAddress, a.suburb, a.city, a.province, a.postalCode]
        .flatMap(v => String(v || '').split(','))
        .map(p => p.trim())
        .filter(p => {
            const key = p.toLowerCase()
            if (!p || seen.has(key)) return false
            seen.add(key)
            return true
        })
        .join(', ')
}

/** Firestore Timestamp, Date, ISO string or millis → Dayjs. */
export const toDayjs = (v: unknown): Dayjs | null => {
    if (!v) return null
    if (typeof (v as { toDate?: () => Date }).toDate === 'function') return dayjs((v as { toDate: () => Date }).toDate())
    const d = dayjs(v as string | number | Date)
    return d.isValid() ? d : null
}

/** "female" / "FEMALE " → "Female"; empty stays empty. */
const titleCase = (v: unknown) => {
    const t = String(v ?? '').trim()
    return t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : ''
}

const normaliseStatus = (v: unknown): ApplicationStatus => {
    const s = String(v || '').toLowerCase()
    return s === 'accepted' || s === 'rejected' ? s : 'pending'
}

/** Reads the AI evaluation, which arrives either as an object or as a fenced JSON string. */
const readAI = (aiEvaluation: any) => {
    let rec: unknown
    let score: unknown
    let just: unknown
    try {
        if (typeof aiEvaluation?.raw_response === 'string') {
            const parsed = JSON.parse(aiEvaluation.raw_response.replace(/```json/i, '').replace(/```/g, '').trim())
            rec = parsed['AI Recommendation'] ?? aiEvaluation['AI Recommendation']
            score = parsed['AI Score'] ?? aiEvaluation['AI Score']
            just = parsed['Justification'] ?? aiEvaluation['Justification']
        } else if (aiEvaluation && typeof aiEvaluation === 'object') {
            rec = aiEvaluation['AI Recommendation']
            score = aiEvaluation['AI Score']
            just = aiEvaluation['Justification']
        }
    } catch {
        if (typeof aiEvaluation?.raw_response === 'string') just = aiEvaluation.raw_response
    }
    const n = Number(score)
    return {
        aiRecommendation: String(rec ?? '').trim() || 'Pending',
        aiScore: score === undefined || score === null || score === '' || Number.isNaN(n) ? null : n,
        aiJustification: String(just ?? '').trim()
    }
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
    Object.prototype.toString.call(v) === '[object Object]'

export const extractNearestHub = (profile: unknown): string => {
    if (isPlainObject(profile) && Object.prototype.hasOwnProperty.call(profile, 'nearest-hub')) {
        return String(profile['nearest-hub'] ?? '').trim()
    }
    if (Array.isArray(profile)) {
        const hit = profile.find(
            (x: any) => String(x?.id || x?.key || x?.questionId || '').toLowerCase().trim() === 'nearest-hub'
        )
        if (hit) return String(hit.answer ?? hit.value ?? '').trim()
    }
    return ''
}

/** One `applications` document → the shape the page renders. */
export const normalizeApplication = (snap: DocumentSnapshot): Application => {
    const data: any = snap.data() || {}

    const contact: ApplicationContact = {
        phone: data.phone || '',
        email: data.email || '',
        website: data.website || '',
        facebook: data.facebook || '',
        instagram: data.instagram || '',
        linkedin: data.linkedin || ''
    }
    const location: ApplicationLocation = {
        streetAddress: data.streetAddress || data.address || data.physicalAddress || '',
        suburb: data.suburb || '',
        city: data.city || data.town || '',
        province: data.province || data.state || '',
        postalCode: data.postalCode || data.zip || '',
        hub: data.hub || ''
    }
    const hub = (extractNearestHub(data.profile) || location.hub || '').trim()

    return {
        ...data,
        id: snap.id,
        // Left blank rather than defaulted, so the export can still fall back
        // to companyName; the UI shows "Unnamed applicant" via displayName().
        beneficiaryName: data.beneficiaryName || data.businessName || '',
        email: contact.email,
        gender: titleCase(data.gender),
        ageGroup: titleCase(data.ageGroup),
        stage: data.stage || '',
        hub,
        motivation: data.motivation || '',
        challenges: data.challenges || '',
        documents: (data.complianceDocuments || []).filter(
            (d: any) => typeof d?.url === 'string' && d.url.trim() !== ''
        ),
        growthPlanDocUrl: data.growthPlanDocUrl || null,
        applicationStatus: normaliseStatus(data.applicationStatus),
        programId: data.programId || data.programID || data.program?.id || data.program || null,
        decision: data.decision || null,
        submittedAt: toDayjs(data.submittedAt) || toDayjs(data.createdAt) || toDayjs(data.appliedAt),
        ...readAI(data.aiEvaluation),
        _contact: contact,
        _location: { ...location, hub },
        _fullAddress: joinAddr(location)
    }
}

export const displayName = (app: { beneficiaryName?: string; companyName?: string }) =>
    app.beneficiaryName || app.companyName || 'Unnamed applicant'

/**
 * AI scores arrive on a 0–10 or 0–100 scale depending on the evaluator
 * version. Returns a 0–1 fraction so bands mean the same thing for both.
 */
export const scoreFraction = (score: number | null) =>
    score === null ? null : Math.max(0, Math.min(1, score > 10 ? score / 100 : score / 10))

export const scoreTone = (score: number | null): 'success' | 'warning' | 'danger' | 'neutral' => {
    const f = scoreFraction(score)
    if (f === null) return 'neutral'
    return f >= 0.7 ? 'success' : f >= 0.5 ? 'warning' : 'danger'
}

export const recommendationColor = (rec: string) => {
    const r = rec.toLowerCase()
    if (r.startsWith('accept')) return 'success'
    if (r.startsWith('reject')) return 'error'
    return 'default'
}

/* --- Program onboarding questions ------------------------------------- */

export const fetchProgramQuestionMap = async (programId: string): Promise<ProgramQuestionMap> => {
    const snap = await getDoc(doc(db, 'programs', programId))
    const map: ProgramQuestionMap = {}
    const qs = snap.exists() && Array.isArray((snap.data() as any).onboardingQuestions)
        ? (snap.data() as any).onboardingQuestions
        : []
    qs.forEach((q: any) => {
        if (q?.id && q?.label) map[String(q.id)] = String(q.label)
    })
    if (!map['nearest-hub']) map['nearest-hub'] = 'Which hub is closest to you?'
    return map
}

export type ProfileAnswer = { question: string; answer: string }

/** Profile answers in any of the shapes they have been stored in over time. */
export const extractProfileQA = (app: Application, labels: ProgramQuestionMap = {}): ProfileAnswer[] => {
    const label = (raw: string) => labels[raw] || (raw === 'nearest-hub' ? 'Which hub is closest to you?' : raw) || 'Question'
    const text = (v: unknown) => (Array.isArray(v) ? v.join(', ') : String(v ?? '').trim())

    if (Array.isArray(app.profile) && app.profile.some((x: unknown) => x && typeof x === 'object')) {
        const pairs = app.profile
            .map((x: any) => {
                const id = String(x.id || x.key || x.questionId || x.question || x.q || '').trim()
                return { question: label(id), answer: text(x.answer ?? x.a ?? x.value ?? x.response) }
            })
            .filter((x: ProfileAnswer) => x.question || x.answer)
        if (pairs.length) return pairs
    }
    if (isPlainObject(app.profile) && Object.keys(app.profile).length) {
        return Object.entries(app.profile).map(([k, v]) => ({ question: label(k), answer: text(v) }))
    }
    if (Array.isArray(app.profileQuestions) && Array.isArray(app.profileAnswers)) {
        return app.profileQuestions.map((q: unknown, i: number) => ({
            question: label(String(q || '').trim()),
            answer: text(app.profileAnswers[i])
        }))
    }
    if (Array.isArray(app.profile)) {
        return app.profile.map((a: unknown, i: number) => ({ question: `Question ${i + 1}`, answer: text(a) }))
    }
    return []
}

/* --- Linked participant ------------------------------------------------- */

export type ParticipantDetails = {
    contact: ApplicationContact
    location: ApplicationLocation
    fullAddress: string
    ownership: { black: number; female: number; youth: number }
    raw: Record<string, any>
}

/**
 * The participant record for an application. The canonical link
 * (participantId) wins; an email match is only used when it is unique, so
 * the detail view and the Excel export always agree on who the person is.
 */
export const loadParticipant = async (app: Pick<Application, 'participantId' | 'email'>) => {
    const id = String(app.participantId || '').trim()
    if (id) {
        const snap = await getDoc(doc(db, 'participants', id))
        if (snap.exists()) return snap.data() as Record<string, any>
    }
    const email = String(app.email || '').trim()
    if (!email) return null
    const emails = Array.from(new Set([email, email.toLowerCase()]))
    const snap = await getDocs(query(collection(db, 'participants'), where('email', 'in', emails)))
    return snap.size === 1 ? (snap.docs[0].data() as Record<string, any>) : null
}

const pct = (v: unknown) => {
    const n = Number(v)
    return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0
}

/** Participant fields win over the application's own, which may be older. */
export const mergeParticipant = (app: Application, p: Record<string, any> | null): ParticipantDetails => {
    const src = p || {}
    const contact: ApplicationContact = {
        ...app._contact,
        phone: src.phone || src.mobile || src.whatsapp || app._contact.phone,
        email: src.email || src.participantEmail || app._contact.email
    }
    const location: ApplicationLocation = {
        ...app._location,
        streetAddress: src.businessAddress || src.streetAddress || src.physicalAddress || app._location.streetAddress,
        city: src.city || src.town || app._location.city,
        province: src.province || src.state || app._location.province,
        postalCode: src.postalCode || src.zip || app._location.postalCode
    }
    return {
        contact,
        location,
        fullAddress: joinAddr(location),
        ownership: {
            black: pct(src.blackOwnedPercent),
            female: pct(src.femaleOwnedPercent),
            youth: pct(src.youthOwnedPercent)
        },
        raw: src
    }
}
