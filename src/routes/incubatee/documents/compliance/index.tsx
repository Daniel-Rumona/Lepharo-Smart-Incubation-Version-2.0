import React, { useEffect, useState, useMemo } from 'react'
import {
    Card,
    Typography,
    Tag,
    Table,
    Upload,
    Button,
    message,
    Layout,
    Space,
    Modal,
    Select,
    List,
    Grid,
    Segmented,
    DatePicker,
    Switch,
    Skeleton,
    Alert
} from 'antd'
import {
    UploadOutlined,
    ExclamationCircleOutlined,
    ClockCircleOutlined,
    CheckCircleOutlined,
    FileTextOutlined,
    EyeOutlined,
    DownloadOutlined,
    EditOutlined
} from '@ant-design/icons'
import {
    collection,
    getDocs,
    query,
    where,
    limit,
    addDoc,
    doc,
    serverTimestamp,
    setDoc,
    updateDoc,
    getDoc
} from 'firebase/firestore'
import { Helmet } from 'react-helmet'
import { db } from '@/firebase'
import moment from 'moment'
import { motion } from 'framer-motion'
import { PreIncubationContractModal } from '@/components/modals/Contracts/PreIncubationContract'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { useNavigate } from 'react-router-dom'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { requestOpenAccountSettings } from '@/lib/accountSettings'
import GapAnalysisViewModal from '@/routes/gap/view/GapModal'
import { hasSmeGapSubmission, isIncubateeAgreementSigned, mergeAgreementSources } from '@/utils/agreementStatus'
import MetricsGrid from '@/components/dashboards/metrics/MetricsGrid'
import '@/styles/incubatee-compliance.css'
import {
    type AgreementTemplate,
    canonicalAgreementId,
    resolveComplianceDocumentStatus,
    resolveComplianceRequirements
} from '@/services/complianceResolver'
import { verifyComplianceDocument } from '@/services/complianceVerificationService'

const { Text, Paragraph } = Typography
const { Option } = Select
const { useBreakpoint } = Grid

const normalize = (s?: string) => (s || '').toString().trim().toLowerCase()

const ESIGN_AGREEMENT_SLUGS = new Set([
    'pre-incubation-contract'
])

const complianceDocumentKey = (value?: unknown) => String(value ?? '').toLowerCase()
    .replace(/\(signed\)/g, '')
    .replace(/\b(docs|documents)\b/g, 'document')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

const canShowMOA = (app: any, delayMonths: number | null) => {
    if (delayMonths == null) return false
    const accepted = asDate(app?.acceptedAt)
    if (!accepted) return false
    return moment().diff(moment(accepted), 'months') >= delayMonths
}

// Firestore Timestamp | Date | ISO string -> Date | null
const asDate = (v: any): Date | null => {
    if (!v) return null
    if (v?.toDate && typeof v.toDate === 'function') return v.toDate()
    if (v?.seconds) return new Date(v.seconds * 1000)
    if (v instanceof Date) return v
    if (typeof v === 'string') {
        const m = moment(v)
        return m.isValid() ? m.toDate() : null
    }
    return null
}

const formatYMD = (v: any) => {
    const d = asDate(v)
    return d ? moment(d).format('YYYY-MM-DD') : '—'
}

const slugify = (s?: string) =>
    (s || '')
        .trim()
        .toLowerCase()
        .replace(/[\s_]+/g, '-') // spaces/underscores → hyphens
        .replace(/[^a-z0-9-]/g, '') // strip punctuation
        .replace(/-+/g, '-')

export const ComplianceDocuments: React.FC = () => {
    const screens = useBreakpoint()
    const { activeProgramId } = useActiveProgramId()
    const [requiredDocs, setRequiredDocs] = useState<
        {
            title: string
            type?: 'upload' | 'agreement'
            hasExpiry?: boolean
            expiryMonths?: number | null
        }[]
    >([])

    // ids + app meta
    const [participantId, setParticipantId] = useState<string>('')
    const [requiredAgreements, setRequiredAgreements] = useState<
        { agreementId: string; title: string }[]
    >([])
    const [applicationId, setApplicationId] = useState<string>('')
    const [moaDelayMonths, setMoaDelayMonths] = useState<number | null>(null)
    const [agreementTemplates, setAgreementTemplates] = useState<AgreementTemplate[]>([])


    const [signedAgreements, setSignedAgreements] = useState<Record<string, any>>(
        {}
    )

    const [issueDateInput, setIssueDateInput] = useState<moment.Moment | null>(
        null
    )
    const [expiryDateInput, setExpiryDateInput] = useState<moment.Moment | null>(
        null
    )
    const [applicationData, setApplicationData] = useState<any>(null)
    const [loadIssue, setLoadIssue] = useState<string>('')

    const openUploadModal = (type?: string) => {
        if (isViewingAs) {
            message.info('Uploads are disabled while using read-only View As mode.')
            return
        }
        setSelectedType(type || '')
        setIssueDateInput(null)
        setExpiryDateInput(null)
        setUploadFile(null)
        setIsModalVisible(true)
    }

    const navigate = useNavigate()

    const ensureSignatureBefore = (fn: () => void) => {
        if (isViewingAs) return fn()
        if (user?.signatureURL) return fn()
        Modal.confirm({
            title: 'Add your signature to continue',
            content: 'Please add your signature in Account Settings before signing this document.',
            okText: 'Open Account Settings',
            cancelText: 'Not now',
            onOk: () => requestOpenAccountSettings(),
        })
    }

    const openAgreement = (agreementIdRaw: string) => {
        const agreementId = canonicalAgreementId(agreementIdRaw)

        if (agreementId === 'moa') {
            const isSigned = isIncubateeAgreementSigned(signedAgreements['moa'], 'moa')

            if (!isSigned && !canShowMOA(applicationData, moaDelayMonths)) {
                return message.warning(
                    moaDelayMonths == null
                        ? 'The MOA availability rule has not been configured. Please contact support.'
                        : `The MOA will become available ${moaDelayMonths} months after your acceptance date.`
                )
            }

            const openMoa = () => navigate('/incubatee/moa', {
                state: {
                    appId: applicationId,
                    participantId,
                    programId: applicationData?.programId,
                    beneficiaryName: applicationData?.beneficiaryName,
                    registrationNumber: applicationData?.registrationNumber,
                    participantName: applicationData?.participantName || applicationData?.applicantName,
                    idNumber: applicationData?.idNumber,
                    businessAddress: applicationData?.businessAddress || applicationData?.registeredAddress,
                    contactNumber: applicationData?.contactNumber || applicationData?.phone,
                    email: applicationData?.email
                }
            })

            if (isSigned) {
                openMoa()
                return
            }

            ensureSignatureBefore(openMoa)
            return
        }

        ensureSignatureBefore(() => {
            if (ESIGN_AGREEMENT_SLUGS.has(agreementId)) {
                setViewer({
                    slug: agreementId,
                    meta: signedAgreements[agreementId]
                })
                return
            }

            if (agreementId === 'gap-analysis') {
                void openGapViewer()
                return
            }

            const managedTemplate = agreementTemplates.find(
                template => template.agreementId === agreementId
            )
            if (managedTemplate?.signingRoute) {
                navigate(managedTemplate.signingRoute)
                return
            }

            message.error(`The signing form for “${agreementIdRaw}” has not been configured. Please contact support.`)
        })
    }

    // compliance docs (uploads)
    const [complianceDocs, setComplianceDocs] = useState<any[]>([])
    const [loading, setLoading] = useState(true)

    // counters
    const [missingCount, setMissingCount] = useState(0)
    const [expiredCount, setExpiredCount] = useState(0)
    const [invalidCount, setInvalidCount] = useState(0)
    const [missingDocsList, setMissingDocsList] = useState<string[]>([])
    const [agreementView, setAgreementView] = useState<'todo' | 'signed'>('todo')

    // add/replace uploads
    const [isModalVisible, setIsModalVisible] = useState(false)
    const [selectedType, setSelectedType] = useState('')
    const [uploadFile, setUploadFile] = useState<any>(null)
    const [editingDocument, setEditingDocument] = useState<any>(null)
    const [editIssueDate, setEditIssueDate] = useState<moment.Moment | null>(null)
    const [editExpiryDate, setEditExpiryDate] = useState<moment.Moment | null>(null)
    const [savingDocumentDetails, setSavingDocumentDetails] = useState(false)

    // sign modals (kept for “Review & Sign” actions)
    const [viewer, setViewer] = useState<{ slug: string; meta?: any } | null>(
        null
    )

    const [gapViewerOpen, setGapViewerOpen] = useState(false)
    const [gapViewerId, setGapViewerId] = useState<string | null>(null)
    const [gapViewerLoading, setGapViewerLoading] = useState(false)

    const openGapViewer = async () => {
        if (!participantId) return message.error('Participant not found.')
        setGapViewerLoading(true)

        try {
            // Try normal GAP: /gapAnalysis where participantId == pid
            const snap = await getDocs(
                query(collection(db, 'gapAnalysis'), where('participantId', '==', participantId), limit(1))
            )

            if (!snap.empty) {
                setGapViewerId(snap.docs[0].id)
                setGapViewerOpen(true)
                return
            }

            // If no normal GAP doc, still open the modal (it should show "not found" / manual viewer if supported)
            setGapViewerId(null)
            setGapViewerOpen(true)
            message.warning('No GAP record found yet for this participant.')
        } catch (e) {
            console.error('Failed to resolve GAP doc', e)
            message.error('Failed to open GAP viewer.')
        } finally {
            setGapViewerLoading(false)
        }
    }


    const { user, isViewingAs } = useFullIdentity()
    const [cryptographicSignature, setCryptographicSignature] = useState('')

    // helper
    const toRow = (d: any, index: number) => {
        const issued = asDate(d.issueDate) || asDate(d.createdAt)
        const effectiveExpiry =
            d?.status === 'missing' ? null : d.expiryDate ?? computePolicyExpiry(d)
        return {
            key: `${d.type}-${index}`,
            type: d.type,
            status: resolveComplianceDocumentStatus(d, effectiveExpiry),
            issued: formatYMD(issued),
            expiry: formatYMD(effectiveExpiry),
            _id: d.id,
            _url: d.url ?? null,
            _issueDate: d.issueDate ?? d.createdAt ?? null,
            _expiryDate: effectiveExpiry,
            _source: d._source ?? 'subcollection',
            _raw: d
        }
    }

    useEffect(() => {
        let cancelled = false

        const loadCompliance = async () => {
            setLoading(true)
            setLoadIssue('')
            if (!user?.email && !user?.participantId) {
                setLoadIssue('This user profile has no email address or participant link.')
                setLoading(false)
                return
            }

            try {
                // Resolve the effective identity, including the selected read-only "view as" user.
                let participantDoc = user?.participantId
                    ? await getDoc(doc(db, 'participants', String(user.participantId)))
                    : null
                if (!participantDoc?.exists() && user?.uid) {
                    const byUserId = await getDoc(doc(db, 'participants', String(user.uid)))
                    if (byUserId.exists()) participantDoc = byUserId
                }
                if (!participantDoc?.exists() && user?.email) {
                    const participantSnap = await getDocs(query(
                        collection(db, 'participants'),
                        where('email', '==', String(user.email).trim()),
                        limit(1)
                    ))
                    participantDoc = participantSnap.empty ? null : participantSnap.docs[0]
                }
                if (!participantDoc?.exists()) {
                    if (!cancelled) {
                        setParticipantId('')
                        setApplicationId('')
                        setApplicationData(null)
                        setComplianceDocs([])
                        setRequiredDocs([])
                        setRequiredAgreements([])
                        setSignedAgreements({})
                        setMissingCount(0)
                        setExpiredCount(0)
                        setInvalidCount(0)
                        setLoadIssue(`No participant record could be matched to ${user?.email || user?.uid}.`)
                    }
                    setLoading(false)
                    return
                }
                const pid = participantDoc.id
                setParticipantId(pid)

                // 2) Find their application
                const [directApp, appSnap] = await Promise.all([
                    getDoc(doc(db, 'applications', pid)),
                    getDocs(
                    query(
                        collection(db, 'applications'),
                        where('participantId', '==', pid),
                        limit(10)
                    )
                    )
                ])
                const applicationDocs = [
                    ...(directApp.exists() ? [directApp] : []),
                    ...appSnap.docs.filter(snapshot => snapshot.id !== directApp.id)
                ]
                if (!applicationDocs.length) {
                    setLoadIssue('A participant was found, but no application is linked to it.')
                    setLoading(false)
                    return
                }
                const eligibleApplications = applicationDocs.filter(snapshot =>
                    ['accepted', 'active'].includes(String(snapshot.data()?.applicationStatus || '').toLowerCase())
                )
                const selectedApp = (
                    activeProgramId
                        ? eligibleApplications.find(snapshot =>
                            String(snapshot.data()?.programId || '') === String(activeProgramId)
                        )
                        : null
                ) || eligibleApplications[0] || applicationDocs[0]
                const appRef = selectedApp.ref
                const appId = selectedApp.id
                const appData = selectedApp.data() as any
                setCryptographicSignature(appData?.digitalSignature ?? '')
                setApplicationData(appData)
                setApplicationId(appId)


                // 2.5) Resolve the same program + department requirements used by staff.
                let reqUploadsLocal: {
                    title: string
                    type?: 'upload' | 'agreement'
                    hasExpiry?: boolean
                    expiryMonths?: number | null
                }[] = []
                let reqAgreementsLocal: { agreementId: string; title: string }[] = []

                if (appData?.programId) {
                    const resolved = await resolveComplianceRequirements(
                        appData.programId,
                        { includeAllDepartments: true }
                    )
                    const moaTemplate = resolved.agreements.find(
                        agreement => agreement.agreementId === 'moa'
                    )
                    setAgreementTemplates(resolved.agreements)
                    setMoaDelayMonths(moaTemplate?.availabilityDelayMonths ?? null)
                    reqUploadsLocal = resolved.requirements
                        .filter(requirement => requirement.kind === 'upload')
                        .map(requirement => ({
                            title: requirement.title,
                            type: 'upload',
                            hasExpiry: requirement.hasExpiry,
                            expiryMonths: requirement.expiryMonths
                        }))
                    reqAgreementsLocal = resolved.requirements
                        .filter(requirement => requirement.kind === 'agreement' && requirement.agreementId)
                        .map(requirement => ({
                            agreementId: requirement.agreementId!,
                            title: requirement.title
                        }))
                }

                // 3) READ: compliance subcollection
                const compSnap = await getDocs(
                    collection(db, 'applications', appId, 'complianceDocuments')
                )

                // build an array of plain objects (NOT snapshots)

                const rawCompliance: any[] = []
                compSnap.forEach(docSnap =>
                    rawCompliance.push({ id: docSnap.id, ...docSnap.data() })
                )

                // KEEP LATEST BY NORMALIZED TYPE
                const latestByType: Record<string, any> = {}
                const flatCompliance = Array.isArray(appData?.complianceDocuments)
                    ? appData.complianceDocuments
                    : []
                ;[
                    ...flatCompliance.map((obj: any) => ({ ...obj, _source: 'embedded' })),
                    ...rawCompliance.map((obj: any) => ({ ...obj, _source: 'subcollection' }))
                ].forEach(obj => {
                    const key = complianceDocumentKey(obj?.type || obj?.title || obj?.documentName || obj?.name)
                    if (!key) return
                    latestByType[key] = {
                        ...obj,
                        type: obj?.type || obj?.title || obj?.documentName || obj?.name
                    }
                })

                const latestCompliance = Object.values(latestByType)

                const requiredTitlesLocal = reqUploadsLocal
                    .filter(d => (d.type ?? 'upload') !== 'agreement')
                    .map(d => d.title)

                // rows = ALL required uploads, filled with upload if present, otherwise "missing"
                const fullRows = requiredTitlesLocal.map((title, idx) => {
                    const hit = latestByType[complianceDocumentKey(title)]
                    const model = hit || {
                        id: `missing-${idx}`,
                        type: title,
                        status: 'missing'
                    }
                    return toRow(model, idx)
                })

                // 4) Agreements
                const agreementsSnap = await getDocs(
                    collection(db, 'applications', appId, 'agreements')
                )
                let agreements: Record<string, any> = {}
                agreementsSnap.forEach(docSnap => {
                    agreements[docSnap.id] = docSnap.data()
                })
                agreements = mergeAgreementSources(agreements, appData?.signedAgreements)

                const gapSnap = await getDocs(
                    query(collection(db, 'gapAnalysis'), where('participantId', '==', pid))
                )
                const gapRecords = gapSnap.docs.map(snapshot => ({
                    id: snapshot.id,
                    ...snapshot.data()
                }))

                const filteredAgreements = reqAgreementsLocal

                const logGapDebug = (label: string, data: Record<string, any>) => {
                    console.log(`[GAP DEBUG] ${label}`, {
                        at: new Date().toISOString(),
                        ...data
                    })
                }


                // ✅ GAP status + debug
                const isGapDone = hasSmeGapSubmission({
                    application: appData,
                    participant: participantDoc.data(),
                    agreement: agreements['gap-analysis'],
                    gapRecords
                })

                const embeddedGap = appData?.signedAgreements?.['gap-analysis']
                const embeddedGapCompleted = isGapDone

                logGapDebug('Before backfill check', {
                    appId,
                    participantId: pid,
                    isGapDone,
                    hasAgreementsDoc: !!agreements['gap-analysis'],
                    hasEmbeddedGap: !!embeddedGap,
                    gapAnalysisStatus: appData?.gapAnalysisStatus ?? null,
                    gapSubmittedAt: !!appData?.gapSubmittedAt,
                    agreementsKeys: Object.keys(agreements || {})
                })

                // Normalize legacy GAP completion in memory. Loading this read-only page must not write to Firestore.
                if (!agreements['gap-analysis'] && (embeddedGap || embeddedGapCompleted)) {
                    const normalized = {
                        agreementId: 'gap-analysis',
                        title: 'GAP Analysis',
                        signed: true,
                        acceptedAt: embeddedGap?.acceptedAt || appData?.gapSubmittedAt ||
                            gapRecords[0]?.submittedAt || new Date(),
                        signatureURL: embeddedGap?.signer?.signatureURL ?? user?.signatureURL ?? null,
                        digitalSignature:
                            embeddedGap?.digitalSignature ??
                            appData?.digitalSignature ??
                            cryptographicSignature ??
                            null,
                        signerName: embeddedGap?.signer?.name ?? user?.name ?? null,
                        signerEmail: embeddedGap?.signer?.email ?? user?.email ?? null,
                        updatedAt: appData?.gapSubmittedAt || gapRecords[0]?.submittedAt || new Date(),
                        _source: 'auto-backfill'
                    }

                    agreements['gap-analysis'] = normalized
                } else {
                    logGapDebug('Backfill skipped', {
                        appId,
                        reason: agreements['gap-analysis']
                            ? 'agreements doc already exists'
                            : 'no embedded gap and not marked completed'
                    })
                }

                // ✅ NOW compute unsignedContractsCount AFTER backfill,
                // and use the actual list shown in UI (filteredAgreements), not reqAgreementsLocal
                const unsignedContractsCount = filteredAgreements.filter(c => {
                    if (isGapSlug(c.agreementId) && isGapDone) return false
                    // if it's a gap slug variant, check canonical key
                    if (isGapSlug(c.agreementId)) return !agreements['gap-analysis']
                    return !agreements[canonicalAgreementId(c.agreementId)]
                }).length


                logGapDebug('Unsigned count computed', {
                    appId,
                    unsignedContractsCount,
                    filteredAgreements: filteredAgreements.map(x => x.agreementId),
                    isGapDone,
                    hasAgreementsDocAfter: !!agreements['gap-analysis']
                })




                // 5) KPI/stat preparation – compute from local arrays, not state
                // present types we already have
                let _missing = 0,
                    _expired = 0,
                    _invalid = 0
                const now = moment()
                requiredTitlesLocal.forEach(title => {
                    const d = latestByType[complianceDocumentKey(title)]
                    if (!d) {
                        _missing++
                        return
                    }
                    const effectiveExpiry = d.expiryDate ?? computePolicyExpiry(d)
                    const isExpired =
                        !!effectiveExpiry && moment(effectiveExpiry).isBefore(now)
                    const status = String(d.status || 'pending').toLowerCase()

                    if (status === 'missing') _missing++
                    else if (isExpired || status === 'expired') _expired++
                    else if (!['valid', 'approved', 'pending'].includes(status))
                        _invalid++
                })

                const presentTypes = Object.keys(latestByType) // already normalized
                const missingTypes = requiredTitlesLocal.filter(
                    t => !presentTypes.includes(complianceDocumentKey(t))
                )
                setMissingDocsList(missingTypes)



                setMissingCount(_missing + unsignedContractsCount)
                setExpiredCount(_expired)
                setInvalidCount(_invalid)

                // finally set BOTH pieces of state from the local data
                setComplianceDocs(fullRows)
                setSignedAgreements(agreements)
                setRequiredDocs(reqUploadsLocal)
                setRequiredAgreements(filteredAgreements)
            } catch (e) {
                console.error(e)
                setLoadIssue('Compliance data could not be loaded. Check the participant and application links.')
                message.error('Failed to load compliance data.')
            } finally {
                if (!cancelled) setLoading(false)
            }
        }

        void loadCompliance()
        return () => { cancelled = true }
    }, [activeProgramId, user?.email, user?.participantId, user?.uid])

    const uploadToStorage = async (file: File, path: string) => {
        const storage = getStorage()
        const fileRef = ref(storage, path)
        await uploadBytes(fileRef, file)
        return await getDownloadURL(fileRef)
    }

    const getAppRefForParticipant = async (pid: string) => {
        if (applicationId) return doc(db, 'applications', applicationId)

        const snap = await getDocs(
            query(
                collection(db, 'applications'),
                where('participantId', '==', pid),
                limit(10)
            )
        )

        if (snap.empty) throw new Error('Application not found for participant.')
        const eligibleApplications = snap.docs.filter(snapshot =>
            ['accepted', 'active'].includes(String(snapshot.data()?.applicationStatus || '').toLowerCase())
        )
        return ((activeProgramId
            ? eligibleApplications.find(snapshot =>
                String(snapshot.data()?.programId || '') === String(activeProgramId)
            )
            : null) || eligibleApplications[0] || snap.docs[0]).ref
    }

    // Only uploads matter here
    const requiredUploadTitles = useMemo(
        () =>
            requiredDocs
                .filter(d => (d.type ?? 'upload') !== 'agreement')
                .map(d => d.title),
        [requiredDocs]
    )

    const getExpiryMonthsFor = (type: string) => {
        const row = requiredDocs.find(
            d =>
                (d.type ?? 'upload') !== 'agreement' &&
                normalize(d.title) === normalize(type)
        )
        return row?.hasExpiry ? row.expiryMonths ?? null : null
    }

    const computePolicyExpiry = (docAny: any): Date | null => {
        const months = getExpiryMonthsFor(docAny?.type)
        if (!months) return null
        const issue = asDate(docAny.issueDate) || asDate(docAny.createdAt)
        if (!issue) return null // ← don’t invent an issue date for missing rows
        return moment(issue).add(months, 'months').toDate()
    }

    const isGapDoneUI = useMemo(() => {
        return hasSmeGapSubmission({
            application: applicationData,
            agreement: signedAgreements['gap-analysis']
        })
    }, [applicationData, signedAgreements])


    const isGapSlug = (slug: string) => {
        const s = normalize(slug)
        return s === 'gap-analysis' || s.startsWith('gap-analysis')
    }

    const isAgreementSigned = (slugRaw: string) => {
        const slug = canonicalAgreementId(slugRaw)

        if (slug === 'gap-analysis') {
            return isIncubateeAgreementSigned(signedAgreements['gap-analysis'], slug) || isGapDoneUI
        }

        return isIncubateeAgreementSigned(signedAgreements[slug], slug)
    }

    const unsignedContracts = useMemo(
        () => requiredAgreements.filter(c => !isAgreementSigned(c.agreementId)),
        [requiredAgreements, signedAgreements, isGapDoneUI]
    )

    const signedContracts = useMemo(
        () => requiredAgreements.filter(c => isAgreementSigned(c.agreementId)),
        [requiredAgreements, signedAgreements, isGapDoneUI]
    )


    const formatExpiryDate = (expiry: any) => {
        if (!expiry) return '—'
        const d = asDate(expiry)
        return d ? moment(d).format('YYYY-MM-DD') : '—'
    }

    const formatDateAny = (val: any) => {
        if (!val) return '—'
        if (typeof val === 'string') {
            const d = moment(val)
            return d.isValid() ? d.format('YYYY-MM-DD HH:mm') : val
        }
        if (val?.seconds)
            return moment(val.seconds * 1000).format('YYYY-MM-DD HH:mm')
        if (val instanceof Date) return moment(val).format('YYYY-MM-DD HH:mm')
        return String(val)
    }

    const normalizeAcceptedAt = (v: any) => {
        if (!v) return null
        if (v?.seconds) return new Date(v.seconds * 1000).toISOString()
        if (typeof v === 'string') return v
        if (v instanceof Date) return v.toISOString()
        return null
    }

    const extractSignatureMeta = (
        meta: any,
        fallbackImg?: string,
        fallbackHash?: string
    ) => {
        if (!meta)
            return {
                sigImg: null,
                digital: null,
                signedAt: null,
                signerName: null,
                signerEmail: null,
                pdfUrl: null
            }

        const sigImg = meta?.signatureURL ?? fallbackImg ?? null

        const digital = meta?.digitalSignature ?? fallbackHash ?? null

        const signedAt =
            normalizeAcceptedAt(meta?.acceptedAt) ??
            normalizeAcceptedAt(meta?._original?.acceptedAt) ??
            normalizeAcceptedAt(meta?.signedAt) ??
            normalizeAcceptedAt(meta?.date)

        const signerName = meta?.signerName ?? null
        const signerEmail = meta?.signerEmail ?? null
        const pdfUrl = meta?.pdfUrl ?? meta?._original?.pdfUrl ?? null

        return { sigImg, digital, signedAt, signerName, signerEmail, pdfUrl }
    }

    const getStatusTag = (status: string) => {
        const normalizedStatus = String(status || 'pending').toLowerCase()
        const colorMap: any = {
            valid: 'green',
            approved: 'blue',
            expired: 'orange',
            missing: 'red',
            pending: 'gold',
            rejected: 'volcano'
        }
        const labelMap: Record<string, string> = {
            pending: 'Awaiting verification',
            missing: 'Not uploaded',
            invalid: 'Needs correction',
            rejected: 'Needs correction'
        }
        return (
            <Tag color={colorMap[normalizedStatus] || 'default'}>
                {labelMap[normalizedStatus] ||
                    normalizedStatus.charAt(0).toUpperCase() + normalizedStatus.slice(1)}
            </Tag>
        )
    }

    const upsertAgreement = async (agreementIdRaw: string, meta: any) => {
        const agreementId = canonicalAgreementId(agreementIdRaw)
        const appRef = await getAppRefForParticipant(participantId)

        // normalize whatever the modal gives us
        const { sigImg, digital, signedAt, signerName, signerEmail, pdfUrl } =
            extractSignatureMeta(
                meta,
        /*fallbackImg*/ undefined,
        /*fallbackHash*/ cryptographicSignature
            )

        const normalized: any = {
            agreementId,
            title:
                requiredAgreements.find(c => c.agreementId === agreementId)
                    ?.title ?? agreementId,
            signed: true,

            // what the admin reader uses:
            pdfUrl: pdfUrl ?? null,
            acceptedAt: signedAt ? new Date(signedAt) : serverTimestamp(),
            signatureURL: user?.signatureURL ?? null,
            digitalSignature: digital ?? null,

            // optional, but handy:
            signerName: user?.name ?? null,
            signerEmail: user?.email ?? null,

            updatedAt: serverTimestamp()
        }

        // Firestore hates `undefined`, so remove those keys
        Object.keys(normalized).forEach(
            k => normalized[k] === undefined && delete normalized[k]
        )

        await setDoc(doc(appRef, 'agreements', agreementId), normalized, {
            merge: true
        })
        setSignedAgreements(prev => ({ ...prev, [agreementId]: normalized }))
    }

    const viewComplianceDocument = (row: any) => {
        if (!row?._url) return message.info('No uploaded file is available for this document yet.')
        const opened = window.open(row._url, '_blank', 'noopener,noreferrer')
        if (opened) opened.opener = null
    }

    const downloadComplianceDocument = (row: any) => {
        if (!row?._url) return message.info('No uploaded file is available for this document yet.')
        const cleanTitle = String(row.type || row._raw?.fileName || 'compliance-document')
            .trim()
            .replace(/[^a-z0-9._-]+/gi, '_')
        const urlWithoutQuery = String(row._url).split('?')[0]
        const extension = urlWithoutQuery.match(/\.[a-z0-9]{2,5}$/i)?.[0] || ''
        const anchor = document.createElement('a')
        anchor.href = row._url
        anchor.download = extension && !cleanTitle.toLowerCase().endsWith(extension.toLowerCase())
            ? `${cleanTitle}${extension}`
            : cleanTitle
        anchor.target = '_blank'
        anchor.rel = 'noopener noreferrer'
        document.body.appendChild(anchor)
        anchor.click()
        document.body.removeChild(anchor)
    }

    const openDocumentDetailsEditor = (row: any) => {
        if (isViewingAs) {
            message.info('Editing is disabled while using read-only View As mode.')
            return
        }
        if (!row?._url) return message.info('Upload the document before editing its details.')
        setEditingDocument(row)
        const issue = asDate(row._issueDate)
        const expiry = asDate(row._expiryDate)
        setEditIssueDate(issue ? moment(issue) : null)
        setEditExpiryDate(expiry ? moment(expiry) : null)
    }

    const saveDocumentDetails = async () => {
        if (!editingDocument) return
        if (editIssueDate && editExpiryDate && editExpiryDate.isBefore(editIssueDate, 'day')) {
            return message.error('Expiry date cannot be before the issue date.')
        }
        setSavingDocumentDetails(true)
        try {
            const appRef = await getAppRefForParticipant(participantId)
            const payload = {
                issueDate: editIssueDate ? editIssueDate.startOf('day').toDate() : null,
                expiryDate: editExpiryDate ? editExpiryDate.endOf('day').toDate() : null,
                updatedAt: serverTimestamp()
            }
            let savedDocumentId = editingDocument._id
            if (editingDocument._source === 'subcollection' && editingDocument._id) {
                await updateDoc(doc(appRef, 'complianceDocuments', editingDocument._id), payload)
            } else {
                const created = await addDoc(collection(appRef, 'complianceDocuments'), {
                    type: editingDocument.type,
                    url: editingDocument._url,
                    ...(editingDocument._raw?.fileName ? { fileName: editingDocument._raw.fileName } : {}),
                    status: editingDocument.status || 'pending',
                    ...payload,
                    createdAt: serverTimestamp(),
                    migratedFromEmbedded: true
                })
                savedDocumentId = created.id
            }
            setComplianceDocs(current => current.map(row => row.key === editingDocument.key
                ? {
                    ...row,
                    issued: formatYMD(payload.issueDate),
                    expiry: formatYMD(payload.expiryDate),
                    _issueDate: payload.issueDate,
                    _expiryDate: payload.expiryDate,
                    _source: 'subcollection',
                    _id: savedDocumentId
                }
                : row))
            message.success('Document details updated.')
            setEditingDocument(null)
        } catch (error) {
            console.error(error)
            message.error('Could not update the document details.')
        } finally {
            setSavingDocumentDetails(false)
        }
    }

    // Table (desktop) columns
    const columns = [
        { title: 'Document', dataIndex: 'type', key: 'type', ellipsis: true },
        { title: 'Issued', dataIndex: 'issued', key: 'issued', width: 130 },
        { title: 'Expiry', dataIndex: 'expiry', key: 'expiry', width: 130 },
        {
            title: 'Status',
            dataIndex: 'status',
            key: 'status',
            render: getStatusTag,
            width: 120
        },
        {
            title: 'Actions',
            key: 'actions',
            width: 260,
            render: (row: any) => (
                <Space size='small' wrap>
                    {row._url && <Button size='small' icon={<EyeOutlined />} onClick={() => viewComplianceDocument(row)}>View</Button>}
                    {row._url && <Button size='small' icon={<DownloadOutlined />} onClick={() => downloadComplianceDocument(row)}>Download</Button>}
                    {row._url && <Button size='small' icon={<EditOutlined />} onClick={() => openDocumentDetailsEditor(row)}>Edit details</Button>}
                    <Button size='small' icon={<UploadOutlined />} onClick={() => openUploadModal(row.type)}>
                        {row._url ? 'Replace' : 'Upload'}
                    </Button>
                </Space>
            )
        }
    ]

    const handleSaveUpload = async () => {
        try {
            if (!selectedType) return message.error('Please select a document type.')
            if (!uploadFile) return message.error('Please select a file to upload.')

            const appRef = await getAppRefForParticipant(participantId)

            const safeName = uploadFile.name?.replace(/\s+/g, '_') || 'file'
            const path = `compliance/${appRef.id}/${Date.now()}_${safeName}`
            const url = await uploadToStorage(uploadFile, path)

            const issueDate = issueDateInput ? issueDateInput.toDate() : null
            const policyMonths = getExpiryMonthsFor(selectedType)

            let expiryDate: Date | null = null
            if (issueDate && policyMonths) {
                // AUTO: issue date present + policy -> auto-calc
                expiryDate = moment(issueDate).add(policyMonths, 'months').toDate()
            } else if (!issueDate && policyMonths) {
                // MANUAL (capped): require a manual expiry within today..today+policyMonths
                if (!expiryDateInput) {
                    return message.error(
                        `Please pick an expiry date (≤ today + ${policyMonths} months).`
                    )
                }
                expiryDate = expiryDateInput.toDate()
            } else {
                // no policy -> expiry optional, manual if provided
                expiryDate = expiryDateInput ? expiryDateInput.toDate() : null
            }

            // upsert by type
            const cur = await getDocs(
                query(
                    collection(appRef, 'complianceDocuments'),
                    where('type', '==', selectedType),
                    limit(1)
                )
            )

            const payload: any = {
                type: selectedType,
                status: 'pending',
                url,
                fileName: uploadFile.name ?? safeName,
                ...(issueDate ? { issueDate } : {}),
                ...(expiryDate ? { expiryDate } : {}),
                updatedAt: serverTimestamp()
            }

            let savedDocId: string
            if (cur.empty) {
                const created = await addDoc(collection(appRef, 'complianceDocuments'), {
                    ...payload,
                    createdAt: serverTimestamp()
                })
                savedDocId = created.id
            } else {
                await updateDoc(cur.docs[0].ref, payload)
                savedDocId = cur.docs[0].ref.id
            }

            message.success(`Saved ${selectedType}`)

            // AI verification runs automatically here — there's no separate
            // button on the incubatee side. Fire-and-forget: it usually takes
            // longer than the table refresh below, so the status shown here
            // may still say "pending" until the next reload/refresh picks it up.
            void verifyComplianceDocument(appRef.id, savedDocId).catch(error => {
                console.error('AI compliance verification failed:', error)
            })
            setIsModalVisible(false)
            setSelectedType('')
            setUploadFile(null)
            setIssueDateInput(null)
            setExpiryDateInput(null)

            // refresh table
            setLoading(true)
            const compSnap = await getDocs(collection(appRef, 'complianceDocuments'))
            const rows = compSnap.docs.map(d => ({ id: d.id, ...d.data() }))
            setComplianceDocs(
                rows.map((docAny: any, i: number) => {
                    const issued = asDate(docAny.issueDate) || asDate(docAny.createdAt)
                    const effectiveExpiry =
                        docAny.expiryDate ?? computePolicyExpiry(docAny)
                    return {
                        key: `${docAny.type}-${i}`,
                        type: docAny.type,
                        status: docAny.status || 'pending',
                        issued: formatYMD(issued),
                        expiry: formatYMD(effectiveExpiry),
                        _id: docAny.id,
                        _url: docAny.url ?? null,
                        _issueDate: docAny.issueDate ?? docAny.createdAt ?? null,
                        _expiryDate: effectiveExpiry,
                        _source: 'subcollection',
                        _raw: docAny
                    }
                })
            )
            setLoading(false)
        } catch (err) {
            console.error(err)
            message.error('Save failed.')
        }
    }

    // when type or issue date changes, auto-calc expiry if policy exists AND issue date is set
    useEffect(() => {
        if (!selectedType) return
        const months = getExpiryMonthsFor(selectedType)
        if (issueDateInput && months) {
            setExpiryDateInput(moment(issueDateInput).add(months, 'months'))
        } else if (!issueDateInput) {
            // manual mode
            setExpiryDateInput(null)
        }
    }, [selectedType, issueDateInput])

    const manualExpiryDisabledDate = (current: moment.Moment) => {
        const months = getExpiryMonthsFor(selectedType)
        if (!months) return false // no cap
        // manual mode only applies when Issue Date is empty
        if (issueDateInput) return true // should be disabled by the DatePicker prop anyway
        const start = moment().startOf('day')
        const end = moment().add(months, 'months').endOf('day')
        return current.isBefore(start) || current.isAfter(end)
    }

    const renderPendingAgreements = () => {
        if (unsignedContracts.length === 0) {
            return (
                <Space direction='vertical' style={{ width: '100%' }}>
                    <Space>
                        <CheckCircleOutlined style={{ color: 'green' }} />
                        <Text>All required agreements have been completed.</Text>
                    </Space>
                </Space>
            )
        }

        return (
            <List
                className='compliance-agreement-list'
                itemLayout='horizontal'
                dataSource={unsignedContracts}
                loading={loading}
                renderItem={contract => {
                    const slug = canonicalAgreementId(contract.agreementId)
                    const isGap = slug === 'gap-analysis'
                    const isMoaWaiting = slug === 'moa' && !canShowMOA(applicationData, moaDelayMonths)
                    const availableAt = asDate(applicationData?.acceptedAt)
                        ? moment(asDate(applicationData.acceptedAt))
                            .add(moaDelayMonths ?? 0, 'months')
                            .format('DD MMM YYYY')
                        : null
                    const hasProfileSignature = !!user?.signatureURL

                    return (
                        <List.Item
                            actions={[
                                <Button
                                    key='sign'
                                    type='primary'
                                    disabled={isMoaWaiting}
                                    loading={isGap && gapViewerLoading}
                                    onClick={() => openAgreement(slug)}
                                >
                                    {isGap
                                        ? 'Open GAP Analysis'
                                        : isMoaWaiting
                                            ? 'Not available yet'
                                            : 'Review and Sign'}
                                </Button>
                            ]}
                        >
                            <List.Item.Meta
                                title={
                                    <Space wrap>
                                        <Text strong>{contract.title}</Text>
                                        <Tag
                                            color={
                                                isMoaWaiting
                                                    ? 'default'
                                                    : isGap || hasProfileSignature
                                                        ? 'orange'
                                                        : 'red'
                                            }
                                        >
                                            {isGap
                                                ? 'Pending completion'
                                                : isMoaWaiting
                                                    ? 'Scheduled'
                                                    : hasProfileSignature
                                                        ? 'Ready to sign'
                                                        : 'Signature required'}
                                        </Tag>
                                    </Space>
                                }
                                description={
                                    isGap
                                        ? 'Complete the GAP analysis to satisfy this requirement.'
                                        : isMoaWaiting
                                            ? moaDelayMonths == null
                                                ? 'Availability rule not configured. Please contact support.'
                                                : `Available ${moaDelayMonths} months after acceptance${availableAt ? `, on ${availableAt}` : ''}.`
                                            : hasProfileSignature
                                                ? 'Pending your review and e-signature.'
                                                : 'Add your signature in Account Settings, then return here to sign.'
                                }
                            />
                        </List.Item>
                    )
                }}
            />
        )
    }

    const renderSignedAgreements = () => {
        if (signedContracts.length === 0) {
            return <Text type='secondary'>No completed agreements yet.</Text>
        }

        return (
            <List
                className='compliance-agreement-list'
                itemLayout='horizontal'
                dataSource={signedContracts}
                renderItem={contract => {
                    const meta =
                        signedAgreements[
                        canonicalAgreementId(contract.agreementId)
                        ] || {}
                    const acceptedAt =
                        meta.acceptedAt || meta.signedAt || meta.date || null
                    const pdfUrl: string | undefined = meta.pdfUrl
                    const actions: React.ReactNode[] = [
                        <Button
                            key='view'
                            size='small'
                            icon={<EyeOutlined />}
                            onClick={() => openAgreement(contract.agreementId)}
                        >
                            View
                        </Button>
                    ]

                    if (pdfUrl) {
                        actions.push(
                            <a
                                key='open'
                                href={pdfUrl}
                                target='_blank'
                                rel='noopener noreferrer'
                            >
                                <Button size='small'>Open PDF</Button>
                            </a>,
                            <a key='download' href={pdfUrl} download>
                                <Button size='small' icon={<DownloadOutlined />}>
                                    Download
                                </Button>
                            </a>
                        )
                    }

                    return (
                        <List.Item actions={actions}>
                            <List.Item.Meta
                                title={
                                    <Space wrap>
                                        <Text strong>{contract.title}</Text>
                                        <Tag color='green'>Signed</Tag>
                                    </Space>
                                }
                                description={
                                    <Space direction='vertical' size={2}>
                                        <Text type='secondary'>
                                            {acceptedAt
                                                ? `Signed: ${formatDateAny(acceptedAt)}`
                                                : 'Signed'}
                                        </Text>
                                        {(meta.signatureUrl ||
                                            meta.userSignatureUrl ||
                                            meta.smmeSignatureUrl) && (
                                                <Text type='secondary'>
                                                    Signature image attached
                                                </Text>
                                            )}
                                        {(meta.digitalSignature ||
                                            meta.smmeDigitalSignature) && (
                                                <Text type='secondary'>
                                                    Digital signature present
                                                </Text>
                                            )}
                                    </Space>
                                }
                            />
                        </List.Item>
                    )
                }}
            />
        )
    }

    const cardStyle: React.CSSProperties = {
        boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
        transition: 'all 0.3s ease',
        borderRadius: 12,
        border: '1px solid #d6e4ff',
        width: '100%'
    }

    return (
        <Layout
            style={{
                background: '#fff',
                minHeight: '100vh',
                padding: screens.md ? 24 : 12
            }}
        >
            <Helmet>
                <title>Compliance Tracking</title>
            </Helmet>
            {loadIssue && (
                <Alert
                    type='warning'
                    showIcon
                    message='Compliance record needs attention'
                    description={loadIssue}
                    style={{ marginBottom: 12 }}
                />
            )}
            <div style={{ marginBottom: 12 }}>
                <MetricsGrid
                    metrics={[
                        {
                            key: 'pending',
                            title: 'Pending / Required',
                            mobileTitle: 'Pending',
                            value: missingCount,
                            subtitle: 'Documents still required',
                            mobileSubtitle: 'Still required',
                            icon: (
                                <ExclamationCircleOutlined
                                    style={{ color: '#cf1322' }}
                                />
                            ),
                            iconBg: '#fff1f0',
                            important: true
                        },
                        {
                            key: 'expired',
                            title: 'Expired',
                            value: expiredCount,
                            subtitle: 'Documents past expiry',
                            mobileSubtitle: 'Past expiry',
                            icon: (
                                <ClockCircleOutlined
                                    style={{ color: '#d46b08' }}
                                />
                            ),
                            iconBg: '#fff7e6',
                            important: true
                        },
                        {
                            key: 'invalid',
                            title: 'Invalid',
                            value: invalidCount,
                            subtitle: 'Documents needing correction',
                            mobileSubtitle: 'Needs correction',
                            icon: (
                                <CheckCircleOutlined
                                    style={{ color: '#cf1322' }}
                                />
                            ),
                            iconBg: '#fff1f0',
                            important: false
                        }
                    ]}
                    gutter={[12, 12]}
                    desktopSpan={8}
                />
            </div>
            {/* Required Signatures & Policies */}
            <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35 }}
            >
                <Card
                    style={{ ...cardStyle, marginBottom: 12 }}
                    title='Required Agreements'
                    extra={
                        loading ? <Tag>Loading…</Tag> : <Tag color={unsignedContracts.length ? 'red' : 'green'}>
                            {unsignedContracts.length
                                ? `${unsignedContracts.length} pending`
                                : 'All signed'}
                        </Tag>
                    }
                >
                    {loading ? (
                        <Skeleton active paragraph={{ rows: 3 }} />
                    ) : (
                        <>
                            <Segmented
                                className='compliance-agreement-segmented'
                                block
                                value={agreementView}
                                onChange={value =>
                                    setAgreementView(value as 'todo' | 'signed')
                                }
                                options={[
                                    {
                                        value: 'todo',
                                        label: `To Do (${unsignedContracts.length})`
                                    },
                                    {
                                        value: 'signed',
                                        label: `Signed (${signedContracts.length})`
                                    }
                                ]}
                            />
                            <div className='compliance-agreement-content'>
                                {agreementView === 'todo'
                                    ? renderPendingAgreements()
                                    : renderSignedAgreements()}
                            </div>
                        </>
                    )}
                    {/* Previous tab implementation retained temporarily for reference.
                    <Tabs
                        centered
                        defaultActiveKey={unsignedContracts.length ? 'todo' : 'signed'}
                        items={[
                            {
                                key: 'todo',
                                label: `To Do (${unsignedContracts.length})`,
                                children:
                                    unsignedContracts.length === 0 ? (
                                        <Space direction='vertical' style={{ width: '100%' }}>
                                            <Space>
                                                <CheckCircleOutlined style={{ color: 'green' }} />
                                            <Text>All required agreements have been completed.</Text>
                                            </Space>
                                        </Space>
                                    ) : (
                                        <List
                                            itemLayout='horizontal'
                                            dataSource={unsignedContracts}
                                            loading={loading}
                                            renderItem={c => {
                                                const slug = canonicalAgreementId(c.agreementId)
                                                const isGap = slug === 'gap-analysis'
                                                const isMoaWaiting = slug === 'moa' && !canShowMOA(applicationData, moaDelayMonths)
                                                const availableAt = asDate(applicationData?.acceptedAt)
                                                    ? moment(asDate(applicationData.acceptedAt)).add(moaDelayMonths ?? 0, 'months').format('DD MMM YYYY')
                                                    : null
                                                const hasProfileSignature = !!user?.signatureURL
                                                return <List.Item
                                                    actions={[<Button
                                                        key='sign'
                                                        type='primary'
                                                        disabled={isMoaWaiting}
                                                        loading={isGap && gapViewerLoading}
                                                        onClick={() => openAgreement(slug)}
                                                    >
                                                        {isGap ? 'Open GAP Analysis' : isMoaWaiting ? 'Not available yet' : 'Review & Sign'}
                                                    </Button>]}
                                                >
                                                    <List.Item.Meta
                                                        title={
                                                            <Space wrap>
                                                                <Text strong>{c.title}</Text>
                                                                <Tag color={isMoaWaiting ? 'default' : isGap || hasProfileSignature ? 'orange' : 'red'}>
                                                                    {isGap
                                                                        ? 'Pending completion'
                                                                        : isMoaWaiting
                                                                            ? 'Scheduled'
                                                                            : hasProfileSignature ? 'Ready to sign' : 'Signature required'}
                                                                </Tag>
                                                            </Space>
                                                        }
                                                        description={
                                                            isGap
                                                                ? 'Complete the GAP analysis to satisfy this requirement.'
                                                                : isMoaWaiting
                                                                    ? moaDelayMonths == null
                                                                        ? 'Availability rule not configured. Please contact support.'
                                                                        : `Available ${moaDelayMonths} months after acceptance${availableAt ? `, on ${availableAt}` : ''}.`
                                                                    : hasProfileSignature
                                                                        ? 'Pending your review and e-signature.'
                                                                        : 'Add your signature in Account Settings, then return here to sign.'
                                                        }
                                                    />
                                                </List.Item>
                                            }}
                                        />
                                    )
                            },
                            {
                                key: 'signed',
                                label: `Signed (${signedContracts.length})`,
                                children:
                                    signedContracts.length === 0 ? (
                                        <Text type='secondary'>No completed agreements yet.</Text>
                                    ) : (
                                        <List
                                            itemLayout='horizontal'
                                            dataSource={signedContracts}
                                            renderItem={c => {
                                                const meta = signedAgreements[canonicalAgreementId(c.agreementId)] || {}
                                                const acceptedAt =
                                                    meta.acceptedAt || meta.signedAt || meta.date || null
                                                const pdfUrl: string | undefined = meta.pdfUrl

                                                return (
                                                    <List.Item
                                                        actions={[
                                                            <Button
                                                                key='view'
                                                                size='small'
                                                                icon={<EyeOutlined />}
                                                                onClick={() => openAgreement(c.agreementId)}
                                                            >
                                                                View
                                                            </Button>,
                                                            pdfUrl ? (
                                                                <a
                                                                    key='open'
                                                                    href={pdfUrl}
                                                                    target='_blank'
                                                                    rel='noopener noreferrer'
                                                                >
                                                                    <Button size='small' type='link'>
                                                                        Open PDF
                                                                    </Button>
                                                                </a>
                                                            ) : null,
                                                            pdfUrl ? (
                                                                <a key='dl' href={pdfUrl} download>
                                                                    <Button
                                                                        size='small'
                                                                        type='link'
                                                                        icon={<DownloadOutlined />}
                                                                    >
                                                                        Download
                                                                    </Button>
                                                                </a>
                                                            ) : null
                                                        ].filter(Boolean as any)}
                                                    >
                                                        <List.Item.Meta
                                                            title={
                                                                <>
                                                                    {c.title} <Tag color='green'>Signed</Tag>
                                                                </>
                                                            }
                                                            description={
                                                                <>
                                                                    {acceptedAt
                                                                        ? `Signed: ${formatDateAny(acceptedAt)}`
                                                                        : 'Signed'}
                                                                    {meta.signatureUrl ||
                                                                        meta.userSignatureUrl ||
                                                                        meta.smmeSignatureUrl
                                                                        ? ' • Signature image attached'
                                                                        : ''}
                                                                    {meta.digitalSignature ||
                                                                        meta.smmeDigitalSignature
                                                                        ? ' • Digital signature present'
                                                                        : ''}
                                                                </>
                                                            }
                                                        />
                                                    </List.Item>
                                                )
                                            }}
                                        />
                                    )
                            }
                        ]}
                    /> */}
                </Card>
            </motion.div>
            {/* Compliance documents list: table on md+, stacked cards on mobile */}
            <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35 }}
            >
                <Card
                    style={cardStyle}
                    title='Compliance Documents'
                    extra={
                        <Button
                            type='primary'
                            icon={<UploadOutlined />}
                            disabled={isViewingAs}
                            onClick={() => openUploadModal()}
                        >
                            {screens.md ? 'Upload Document' : 'Upload'}
                        </Button>
                    }
                >
                    {loading ? (
                        <Skeleton active paragraph={{ rows: screens.md ? 6 : 10 }} />
                    ) : screens.md ? (
                        <Table
                            columns={columns as any}
                            dataSource={complianceDocs}
                            size='small'
                            pagination={false}
                            scroll={{ x: 720 }}
                            rowKey='key'
                        />
                    ) : (
                        <List
                            dataSource={complianceDocs}
                            renderItem={(item: any) => (
                                <Card
                                    className='compliance-document-card'
                                    size='small'
                                    style={{
                                        marginBottom: 8,
                                        borderRadius: 10,
                                        border: '1px solid #e6f0ff'
                                    }}
                                >
                                    <Space direction='vertical' style={{ width: '100%' }}>
                                        <Space
                                            align='baseline'
                                            style={{ justifyContent: 'space-between' }}
                                        >
                                            <Text strong>{item.type}</Text>
                                            {getStatusTag(item.status)}
                                        </Space>
                                        <Space
                                            style={{ justifyContent: 'space-between', width: '100%' }}
                                        >
                                            <Text type='secondary'>Expiry: {item.expiry}</Text>
                                        </Space>
                                        <Space
                                            className={`compliance-document-actions ${item._url ? '' : 'is-upload-only'}`}
                                            wrap
                                        >
                                            {item._url && <Button size='small' icon={<EyeOutlined />} onClick={() => viewComplianceDocument(item)}>View</Button>}
                                            {item._url && <Button size='small' icon={<DownloadOutlined />} onClick={() => downloadComplianceDocument(item)}>Download</Button>}
                                            {item._url && <Button size='small' icon={<EditOutlined />} onClick={() => openDocumentDetailsEditor(item)}>Edit</Button>}
                                            <Button size='small' icon={<UploadOutlined />} onClick={() => openUploadModal(item.type)}>
                                                {item._url ? 'Replace' : 'Upload'}
                                            </Button>
                                        </Space>
                                    </Space>
                                </Card>
                            )}
                        />
                    )}
                </Card>
            </motion.div>
            <Modal
                title={`Edit document details${editingDocument?.type ? `: ${editingDocument.type}` : ''}`}
                open={!!editingDocument}
                onOk={saveDocumentDetails}
                onCancel={() => setEditingDocument(null)}
                okText='Save details'
                confirmLoading={savingDocumentDetails}
                destroyOnClose
            >
                <Space direction='vertical' size='middle' style={{ width: '100%' }}>
                    <div>
                        <Text strong>Issue Date</Text>
                        <DatePicker
                            value={editIssueDate as any}
                            onChange={setEditIssueDate}
                            format='YYYY-MM-DD'
                            allowClear
                            style={{ width: '100%', marginTop: 6 }}
                            disabledDate={current => current && current > moment().endOf('day')}
                        />
                    </div>
                    <div>
                        <Text strong>Expiry Date</Text>
                        <DatePicker
                            value={editExpiryDate as any}
                            onChange={setEditExpiryDate}
                            format='YYYY-MM-DD'
                            allowClear
                            style={{ width: '100%', marginTop: 6 }}
                        />
                    </div>
                    <Text type='secondary'>Changing these dates does not replace the uploaded file.</Text>
                </Space>
            </Modal>
            {/* Upload new doc modal */}
            <Modal
                title={
                    selectedType
                        ? `Upload/Replace: ${selectedType}`
                        : 'Upload New Document'
                }
                open={isModalVisible}
                onOk={handleSaveUpload}
                onCancel={() => setIsModalVisible(false)}
                okText='Save'
            >
                <Space direction='vertical' style={{ width: '100%' }}>
                    <div>
                        <Text strong>Document Type</Text>
                        <Select
                            placeholder='Select document type'
                            style={{ width: '100%', marginTop: 6 }}
                            value={selectedType}
                            onChange={val => {
                                setSelectedType(val)
                                setIssueDateInput(null)
                                setExpiryDateInput(null)
                            }}
                            showSearch
                            optionFilterProp='children'
                        >
                            {requiredUploadTitles.map(title => (
                                <Option key={title} value={title}>
                                    {title}
                                </Option>
                            ))}
                        </Select>
                    </div>

                    <div>
                        <Text strong>Issue Date</Text>
                        <div style={{ marginTop: 6 }}>
                            <DatePicker
                                style={{ width: '100%' }}
                                value={issueDateInput as any}
                                onChange={val => setIssueDateInput(val)}
                                disabled={!selectedType}
                                format='YYYY-MM-DD'
                                allowClear
                                placeholder='Select issue date (optional)'
                                disabledDate={current =>
                                    current && current > moment().endOf('day')
                                }
                            />
                        </div>
                        {selectedType && getExpiryMonthsFor(selectedType) ? (
                            <Text type='secondary'>
                                Policy: {getExpiryMonthsFor(selectedType)}-month validity
                            </Text>
                        ) : (
                            <Text type='secondary'>No policy expiry (optional)</Text>
                        )}
                    </div>

                    <div>
                        <Text strong>Expiry</Text>
                        <DatePicker
                            style={{ width: '100%', marginTop: 6 }}
                            value={expiryDateInput as any}
                            onChange={val => setExpiryDateInput(val)}
                            // disable when AUTO (issueDate+policy exists)
                            disabled={
                                !selectedType ||
                                (!!issueDateInput && !!getExpiryMonthsFor(selectedType))
                            }
                            disabledDate={manualExpiryDisabledDate as any}
                            format='YYYY-MM-DD'
                            placeholder={
                                !selectedType
                                    ? 'Select document type first'
                                    : issueDateInput && getExpiryMonthsFor(selectedType)
                                        ? 'Auto-calculated'
                                        : getExpiryMonthsFor(selectedType)
                                            ? `Pick expiry (≤ today + ${getExpiryMonthsFor(
                                                selectedType
                                            )} months)`
                                            : 'Optional'
                            }
                            allowClear
                        />
                        {issueDateInput &&
                            getExpiryMonthsFor(selectedType) &&
                            expiryDateInput && (
                                <Text type='secondary'>
                                    Auto: {expiryDateInput.format('YYYY-MM-DD')}
                                </Text>
                            )}
                    </div>

                    <div>
                        <Text style={{ marginRight: 10 }} strong>
                            Upload File:
                        </Text>
                        <Upload
                            beforeUpload={file => {
                                setUploadFile(file)
                                return false
                            }}
                            maxCount={1}
                            style={{ marginTop: 6 }}
                        >
                            <Button icon={<UploadOutlined />}>Select File</Button>
                        </Upload>
                        {uploadFile ? (
                            <Text type='secondary'>Selected: {uploadFile.name}</Text>
                        ) : null}
                    </div>
                </Space>
            </Modal>

            <GapAnalysisViewModal
                open={gapViewerOpen}
                onClose={() => {
                    setGapViewerOpen(false)
                    setGapViewerId(null)
                }}
                gapId={gapViewerId}
                // incubatee is NOT ROM, but they should see content read-only
                isROM={false}
                // incubatee should see everything (read-only). If your modal enforces sections, keep ALL.
                allowedSections={'ALL' as any}
                romName={''}
                romEmail={''}
            />


            {/* Contract/Policy sign modals – only mark as signed on onSigned */}
            {/* NOTE: These are only for "Review & Sign" in the To Do tab */}

            <PreIncubationContractModal
                open={viewer?.slug === 'pre-incubation-contract'}
                participantId={participantId}
                applicationId={applicationId}
                onClose={() => setViewer(null)}
                onSigned={async meta => {
                    await upsertAgreement('pre-incubation-contract', meta)
                    message.success('Pre-Incubation Contract signed.')
                    setViewer(null)
                }}
                /* Read-only once *this SME* has signed -- not merely because an
                   agreement record exists. Staff counter-signing
                   (routes/shared/compliance handleRomSign) creates
                   signedAgreements['pre-incubation-contract'] with ROM fields
                   only, and the bare truthiness of that object used to put the
                   modal into read-only and hide the Sign button, while the
                   To Do list above still listed the agreement as outstanding
                   because it asks isIncubateeAgreementSigned. The SME was left
                   with a task they could open but not complete. Both now ask
                   the same question. */
                readOnly={
                    isViewingAs ||
                    Boolean(
                        viewer &&
                        isIncubateeAgreementSigned(
                            signedAgreements[viewer.slug],
                            viewer.slug
                        )
                    )
                }
                signedMeta={viewer?.meta}
            />
        </Layout>
    )
}
