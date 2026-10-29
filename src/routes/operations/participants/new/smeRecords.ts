import dayjs from 'dayjs'
import customParseFormat from 'dayjs/plugin/customParseFormat'
import {
    addDoc,
    collection,
    doc,
    FieldValue,
    getDocs,
    limit,
    query,
    serverTimestamp,
    setDoc,
    Timestamp,
    where,
    type DocumentReference
} from 'firebase/firestore'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { auth, db, storage } from '@/firebase'
import { CREATE_USER_URL } from '@/routes/shared/incubatees/participantsData'
import { normaliseRegistration } from './registration'

dayjs.extend(customParseFormat)

/**
 * Creating an SME: the records the Add SME page writes (a participant, its
 * accepted application, compliance sub-documents and, optionally, a platform
 * invite). Kept apart from the page so a bulk import can create SMEs the same way.
 */

export type Stage = 'A' | 'B' | 'C' | 'Graduated'
export const STAGES: Stage[] = ['A', 'B', 'C', 'Graduated']

export type Gender = 'Male' | 'Female'

export type Director = {
    name: string
    email?: string | null
    phone?: string | null
    /** The phone number is on WhatsApp (a contact detail, not consent to message). */
    onWhatsApp?: boolean
    gender?: Gender | null
    idNumber?: string | null
    /** The SME's main contact: their email gets the platform invite. */
    isPrimary: boolean
}

export type ComplianceDocInput = {
    key: string
    title: string
    file: File | null
    issueDate: string | null
    expiryDate: string | null
    group: 'application' | 'gap' | 'preinc'
}

export type UploadedDoc = {
    key: string
    type: string
    url: string | null
    fileName: string | null
    issueDate: string | null
    expiryDate: string | null
    status: 'valid' | 'missing'
    group: 'application' | 'gap' | 'preinc'
}

export type SmeInput = {
    companyName: string
    registrationNumber: string
    dateOfRegistration?: string | null // YYYY-MM-DD
    sector?: string | null
    natureOfBusiness?: string | null
    beeLevel?: string | null
    directors: Director[]
    blackOwnedPercent?: number | null
    femaleOwnedPercent?: number | null
    youthOwnedPercent?: number | null
    businessAddress?: string | null
    city?: string | null
    postalCode?: string | null
    province?: string | null
    hub?: string | null
    location?: string | null
    stage: Stage
    branchId?: string | null
    branchName?: string | null
    /** Optional history, keyed YYYY-MM (monthly) or YYYY (annual). */
    revenue?: { monthly: Record<string, number>; annual: Record<string, number> }
    headcount?: {
        monthly: Record<string, { permanent: number; temporary: number }>
        annual: Record<string, { permanent: number; temporary: number }>
    }
    documents?: ComplianceDocInput[]
    /**
     * Set by the Excel import: where the SME came from (file, sheets), the labels the
     * importer gave it, and spreadsheet columns that have no field of their own.
     */
    importInfo?: Record<string, any>
    /** Where the SME is in incubation (Active, Soft incubation, Dormant, Potential exit, Exited). */
    incubationStatus?: string | null
}

export type ProgramContext = {
    programId: string
    programName: string | null
    /** Keys of the documents that count towards the compliance score. */
    requiredDocKeys: string[]
}

// ---- validation ---------------------------------------------------------------

/** SA ID: 13 digits, a real date of birth and a valid Luhn check digit. */
export const isValidSouthAfricanID = (raw: string): boolean => {
    const id = (raw || '').replace(/\D/g, '')
    if (!/^\d{13}$/.test(id)) return false
    const yymmdd = id.slice(0, 6)
    const today = dayjs().startOf('day')
    const d2000 = dayjs(`20${yymmdd}`, 'YYYYMMDD', true)
    const d1900 = dayjs(`19${yymmdd}`, 'YYYYMMDD', true)
    const dob = d2000.isValid() && !d2000.isAfter(today) ? d2000 : d1900.isValid() && !d1900.isAfter(today) ? d1900 : null
    if (!dob || today.diff(dob, 'year') > 120) return false
    const digits = id.split('').map(Number)
    const oddSum = digits[0] + digits[2] + digits[4] + digits[6] + digits[8] + digits[10]
    const even = String(Number(`${digits[1]}${digits[3]}${digits[5]}${digits[7]}${digits[9]}${digits[11]}`) * 2)
    const evenSum = even.split('').reduce((s, d) => s + Number(d), 0)
    return (10 - ((oddSum + evenSum) % 10)) % 10 === digits[12]
}

/** Gender as encoded in an SA ID (digits 7–10: 0000–4999 female, 5000–9999 male). */
export const genderFromSouthAfricanID = (raw: string): Gender | null => {
    const id = (raw || '').replace(/\D/g, '')
    if (!isValidSouthAfricanID(id)) return null
    return Number(id.slice(6, 10)) >= 5000 ? 'Male' : 'Female'
}

// The CIPC helpers live in a Firebase-free module so the Excel importer can share them.
export { isValidZARegistration, normaliseRegistration } from './registration'

export const yearsSince = (date?: string | null) => (date ? Math.max(0, dayjs().diff(dayjs(date), 'year')) : null)

/** An SME already on the platform with this registration number, if any. */
export const findExistingSme = async (registrationNumber: string) => {
    const reg = normaliseRegistration(registrationNumber)
    if (!reg) return null
    const snap = await getDocs(query(collection(db, 'participants'), where('registrationNumber', '==', reg), limit(1)))
    if (snap.empty) return null
    const d = snap.docs[0].data() as any
    return { id: snap.docs[0].id, name: String(d.beneficiaryName || d.companyName || d.participantName || 'An SME'), programName: d.programName || null }
}

// ---- compliance ---------------------------------------------------------------

/** Share of required documents that are attached and not expiring within a week. */
export const complianceScoreOf = (docs: Pick<UploadedDoc, 'key' | 'status' | 'expiryDate'>[], requiredKeys: string[]) => {
    if (!requiredKeys.length) return 0
    const soon = dayjs().add(7, 'day')
    const valid = docs.filter(d => requiredKeys.includes(d.key) && d.status === 'valid' && !(d.expiryDate && !dayjs(d.expiryDate).isAfter(soon)))
    return Math.round((valid.length / requiredKeys.length) * 100)
}

/** Uploads the attached files; a file that fails is recorded as missing and named in `failed`. */
const uploadDocuments = async (docs: ComplianceDocInput[]) => {
    const out: UploadedDoc[] = []
    const failed: string[] = []
    for (const d of docs) {
        const missing: UploadedDoc = { key: d.key, type: d.title, url: null, fileName: null, issueDate: null, expiryDate: null, status: 'missing', group: d.group }
        if (!d.file) {
            out.push(missing)
            continue
        }
        const fileName = `${Date.now()}_${d.file.name}`
        const fileRef = ref(storage, `participant_documents/${fileName}`)
        try {
            await uploadBytes(fileRef, d.file)
        } catch (err) {
            console.error(`Upload failed: ${d.title}`, err)
            failed.push(d.title)
            out.push(missing)
            continue
        }
        out.push({
            key: d.key,
            type: d.title,
            url: await getDownloadURL(fileRef),
            fileName,
            issueDate: d.issueDate,
            expiryDate: d.expiryDate,
            status: 'valid',
            group: d.group
        })
    }
    return { uploaded: out, failed }
}

const subdocId = (d: UploadedDoc) => (d.key || d.type || `doc_${Date.now()}`).toString().trim().toLowerCase()

const writeComplianceSubdocs = (appRef: DocumentReference, docs: UploadedDoc[], ctx: ProgramContext, by: string | null) =>
    Promise.all(docs.map(d => setDoc(doc(appRef, 'complianceDocuments', subdocId(d)), {
        type: d.type,
        documentName: d.type,
        presetId: subdocId(d),
        status: d.url ? 'pending' : 'missing',
        url: d.url,
        issueDate: d.issueDate,
        expiryDate: d.expiryDate,
        uploadedAt: serverTimestamp(),
        uploadedBy: by,
        programId: ctx.programId,
        programName: ctx.programName,
        kind: 'upload',
        slug: subdocId(d),
        createdBy: by,
        updatedAt: serverTimestamp()
    }, { merge: true })))

// ---- writing ------------------------------------------------------------------

/** Drops undefined and blank strings (Firestore rejects undefined), leaving sentinels and dates intact. */
const clean = (value: any): any => {
    if (value === null || value instanceof FieldValue || value instanceof Timestamp || value instanceof Date) return value
    if (Array.isArray(value)) return value.map(clean).filter(v => v !== undefined)
    if (typeof value === 'object' && value) {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, clean(v)]).filter(([, v]) => v !== undefined))
    }
    if (typeof value === 'string') return value.trim() || undefined
    return value
}

const primaryOf = (directors: Director[]) => directors.find(d => d.isPrimary) || directors[0]

/**
 * Creates the SME: participant + accepted application + compliance
 * sub-documents. Older screens read a single owner from participantName /
 * gender / idNumber / email / phone, so the primary director fills those too.
 */
export const createSme = async (input: SmeInput, ctx: ProgramContext, actor: { email: string | null; name: string | null }) => {
    const primary = primaryOf(input.directors)
    const { uploaded, failed } = await uploadDocuments(input.documents || [])
    const complianceScore = complianceScoreOf(uploaded, ctx.requiredDocKeys)
    const complianceSummary = {
        required: (input.documents || []).map(d => d.key),
        completed: uploaded.filter(d => d.url).map(d => d.key)
    }
    const interventions = { required: [], assigned: [], completed: [], participationRate: 0 }
    const now = dayjs()
    const created = {
        createdAt: serverTimestamp(),
        createdAtISO: now.toISOString(),
        createdMonth: now.format('YYYY-MM'),
        createdYear: now.format('YYYY'),
        updatedAt: serverTimestamp()
    }
    const registrationNumber = normaliseRegistration(input.registrationNumber)
    const directors = input.directors.map(d => ({
        name: d.name,
        email: d.email?.trim().toLowerCase() || null,
        phone: d.phone || null,
        onWhatsApp: !!d.onWhatsApp,
        gender: d.gender || null,
        idNumber: d.idNumber?.replace(/\D/g, '') || null,
        isPrimary: d === primary
    }))

    const toTotals = (rows: Record<string, { permanent: number; temporary: number }> = {}) =>
        Object.fromEntries(Object.entries(rows).map(([k, v]) => [k, { permanent: v.permanent || 0, temporary: v.temporary || 0, total: (v.permanent || 0) + (v.temporary || 0) }]))

    const participantRef = await addDoc(collection(db, 'participants'), clean({
        // The primary director, in the fields older screens read.
        participantName: primary?.name,
        email: primary?.email?.trim().toLowerCase(),
        phone: primary?.phone,
        phoneOnWhatsApp: !!primary?.onWhatsApp,
        gender: primary?.gender,
        idNumber: primary?.idNumber?.replace(/\D/g, ''),
        directors,
        beneficiaryName: input.companyName,
        registrationNumber,
        dateOfRegistration: input.dateOfRegistration ? Timestamp.fromDate(dayjs(input.dateOfRegistration).toDate()) : undefined,
        yearsOfTrading: yearsSince(input.dateOfRegistration) ?? undefined,
        sector: input.sector,
        natureOfBusiness: input.natureOfBusiness,
        beeLevel: input.beeLevel,
        blackOwnedPercent: input.blackOwnedPercent ?? undefined,
        femaleOwnedPercent: input.femaleOwnedPercent ?? undefined,
        youthOwnedPercent: input.youthOwnedPercent ?? undefined,
        businessAddress: input.businessAddress,
        city: input.city,
        postalCode: input.postalCode,
        province: input.province,
        hub: input.hub,
        location: input.location,
        programId: ctx.programId,
        programName: ctx.programName,
        branchId: input.branchId || null,
        branchName: input.branchName || null,
        headcountHistory: { monthly: toTotals(input.headcount?.monthly), annual: toTotals(input.headcount?.annual) },
        revenueHistory: { monthly: input.revenue?.monthly || {}, annual: input.revenue?.annual || {} },
        interventions,
        complianceScore,
        complianceDocuments: uploaded,
        complianceSummary,
        setup: true,
        ...(input.importInfo ? { importInfo: input.importInfo, source: 'excel-import' } : {}),
        incubationStatus: input.incubationStatus || undefined,
        ...created
    }))

    const appRef = await addDoc(collection(db, 'applications'), clean({
        ...created,
        participantId: participantRef.id,
        programId: ctx.programId,
        programName: ctx.programName,
        branchId: input.branchId || null,
        branchName: input.branchName || null,
        applicationStatus: 'accepted',
        submittedAt: now.toISOString(),
        beneficiaryName: input.companyName,
        gender: primary?.gender,
        ageGroup: null,
        stage: null,
        province: input.province,
        hub: input.hub,
        email: primary?.email?.trim().toLowerCase(),
        motivation: null,
        challenges: null,
        complianceScore,
        complianceDocuments: uploaded,
        complianceSummary,
        interventions,
        profile: null,
        gapGroup: input.stage,
        incubationStatus: input.incubationStatus || undefined,
        groupHistory: [{
            from: null,
            to: input.stage,
            date: now.toISOString(),
            by: actor.name || actor.email || 'Consultant',
            reason: 'Initial onboarding placement',
            docs: [],
            requirementsMet: []
        }],
        manuallyCreated: true
    }))

    await writeComplianceSubdocs(appRef, uploaded, ctx, actor.email)
    return { participantId: participantRef.id, applicationId: appRef.id, complianceScore, failedUploads: failed }
}

/**
 * Invites the primary contact to the platform. Never throws: an SME is saved
 * whether or not the invite goes out, and the caller reports which happened.
 */
export const inviteSme = async (input: Pick<SmeInput, 'directors'>): Promise<boolean> => {
    const primary = primaryOf(input.directors)
    if (!primary?.email) return false
    try {
        const idToken = await auth.currentUser?.getIdToken()
        if (!idToken) return false
        const resp = await fetch(CREATE_USER_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
            body: JSON.stringify({
                email: primary.email.trim().toLowerCase(),
                role: 'incubatee',
                name: primary.name,
                phone: primary.phone || null,
                mustRegister: true,
                allowExisting: true,
                sendEmail: true
            })
        })
        return resp.ok
    } catch (err) {
        console.warn('createPlatformUser failed (SME saved without an invite):', err)
        return false
    }
}
