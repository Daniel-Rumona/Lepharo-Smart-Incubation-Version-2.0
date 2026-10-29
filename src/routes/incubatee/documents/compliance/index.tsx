import React, { useEffect, useState, useMemo, useRef } from 'react'
import {
    Card,
    Typography,
    Tag,
    Upload,
    Button,
    Input,
    message,
    Space,
    Drawer,
    Modal,
    List,
    Grid,
    Segmented,
    DatePicker,
    Skeleton,
    Alert
} from 'antd'
import {
    UploadOutlined,
    ExclamationCircleOutlined,
    ClockCircleOutlined,
    CheckCircleOutlined,
    EyeOutlined,
    DownloadOutlined,
    EditOutlined,
    FileProtectOutlined,
    SafetyCertificateOutlined,
    SearchOutlined
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
    getDoc,
    arrayUnion,
    deleteField
} from 'firebase/firestore'
import { Helmet } from 'react-helmet'
import { db } from '@/firebase'
import moment from 'moment'
import { motion } from 'framer-motion'
import { PreIncubationContractModal } from '@/components/modals/Contracts/PreIncubationContract'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { useLocation, useNavigate } from 'react-router-dom'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { requestOpenAccountSettings } from '@/lib/accountSettings'
import GapAnalysisViewModal from '@/routes/gap/view/GapModal'
import { hasSmeGapSubmission, isAgreementAvailable, isIncubateeAgreementSigned, mergeAgreementSources } from '@/utils/agreementStatus'
import MetricsGrid from '@/components/dashboards/metrics/MetricsGrid'
import '@/styles/incubatee-compliance.css'
import {
    type AgreementTemplate,
    canonicalAgreementId,
    complianceDocumentKey as sharedComplianceDocumentKey,
    complianceEffectiveExpiry,
    resolveComplianceDocumentStatus,
    resolveComplianceRequirements
} from '@/services/complianceResolver'
import { verifyComplianceDocument } from '@/services/complianceVerificationService'
import { DashboardFilterBar } from '@/components/dashboards/metrics/Header'


const { Text } = Typography
const { useBreakpoint } = Grid

const normalize = (s?: string) => (s || '').toString().trim().toLowerCase()

const ESIGN_AGREEMENT_SLUGS = new Set([
    'pre-incubation-contract'
])

type RequiredUpload = {
    id: string
    title: string
    type?: 'upload' | 'agreement'
    hasExpiry?: boolean
    expiryMonths?: number | null
}

// Loose title comparison, for older uploads saved with only a title.
const titleMatchKey = (value?: unknown) => String(value ?? '').toLowerCase()
    .replace(/\(signed\)/g, '')
    .replace(/\b(docs|documents)\b/g, 'document')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

// The application compliance documents belong to: an accepted/active one
// (for the selected programme when there is one), then any application that
// is still open, and only then whatever exists.
const pickComplianceApplication = <T extends { data: () => any }>(
    applications: T[],
    activeProgramId?: string | null
): T | undefined => {
    const status = (item: T) => String(item.data()?.applicationStatus || '').toLowerCase()
    const eligible = applications.filter(item => ['accepted', 'active'].includes(status(item)))
    const open = applications.filter(item =>
        !['rejected', 'declined', 'withdrawn', 'cancelled'].includes(status(item))
    )
    return (
        (activeProgramId
            ? eligible.find(item => String(item.data()?.programId || '') === String(activeProgramId))
            : undefined) ||
        eligible[0] ||
        open[0] ||
        applications[0]
    )
}

const documentTime = (item: any) =>
    asDate(item?.updatedAt)?.getTime() ??
    asDate(item?.createdAt)?.getTime() ??
    asDate(item?.uploadedAt)?.getTime() ??
    0

// The upload that satisfies a requirement: matched on the shared requirement
// key (presetId) as the staff pages do, or on the title for older uploads.
// The newest wins; on a tie the subcollection copy beats the embedded one.
const latestDocumentFor = (requirement: RequiredUpload, candidates: any[]) => {
    const requirementKey = `upload:${requirement.id}`
    const titleKey = titleMatchKey(requirement.title)
    const matches = candidates.filter(item =>
        (item?.kind ?? 'upload') !== 'agreement' && !item?.agreementId && (
            sharedComplianceDocumentKey(item) === requirementKey ||
            titleMatchKey(item?.type || item?.title || item?.documentName || item?.name) === titleKey
        )
    )
    return matches.sort((a, b) =>
        documentTime(b) - documentTime(a) ||
        (b._source === 'subcollection' ? 1 : 0) - (a._source === 'subcollection' ? 1 : 0)
    )[0] || null
}

// Shared with the dashboard's "waiting for you" list, so both agree on when the MOA opens.
const canShowMOA = (app: any, delayMonths: number | null) =>
    isAgreementAvailable('moa', asDate(app?.acceptedAt), delayMonths)

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

export const ComplianceDocuments: React.FC = () => {
    const screens = useBreakpoint()
    const { activeProgramId } = useActiveProgramId()
    const [requiredDocs, setRequiredDocs] = useState<RequiredUpload[]>([])
    // Bumped after an upload so the loader re-reads the page from Firestore.
    const [reloadToken, setReloadToken] = useState(0)
    const [savingUpload, setSavingUpload] = useState(false)
    const savingUploadRef = useRef(false)

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
    // The dashboard links here with { view: 'agreements' } and, for one agreement,
    // { openAgreement: id } to open it straight away.
    const location = useLocation()
    const linkState = (location.state || {}) as { view?: string; openAgreement?: string }

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
    const [workspaceView, setWorkspaceView] = useState<'agreements' | 'compliance'>(
        linkState.view === 'agreements' || linkState.openAgreement ? 'agreements' : 'compliance'
    )
    const openedFromLink = useRef(false)
    useEffect(() => {
        if (!linkState.openAgreement || openedFromLink.current || loading) return
        openedFromLink.current = true
        openAgreement(linkState.openAgreement)
        // Cleared so going back or refreshing does not open it again.
        navigate(location.pathname, { replace: true, state: { view: 'agreements' } })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [linkState.openAgreement, loading])
    const [searchTerm, setSearchTerm] = useState('')

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
    const toRow = (d: any, index: number, requirement?: RequiredUpload) => {
        const issued = asDate(d.issueDate) || asDate(d.createdAt)
        const effectiveExpiry =
            d?.status === 'missing' ? null : complianceEffectiveExpiry(d, requirement)
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
                const selectedApp = pickComplianceApplication(applicationDocs, activeProgramId)!
                const appId = selectedApp.id
                const appData = selectedApp.data() as any
                setCryptographicSignature(appData?.digitalSignature ?? '')
                setApplicationData(appData)
                setApplicationId(appId)


                // 2.5) Resolve the same program + department requirements used by staff.
                let reqUploadsLocal: RequiredUpload[] = []
                let reqAgreementsLocal: { agreementId: string; title: string }[] = []
                // The MOA's opening rule, for leaving a not-yet-open MOA out of the counts.
                let moaDelayLocal: number | null = null

                if (appData?.programId) {
                    const resolved = await resolveComplianceRequirements(
                        appData.programId,
                        { includeAllDepartments: true }
                    )
                    const moaTemplate = resolved.agreements.find(
                        agreement => agreement.agreementId === 'moa'
                    )
                    setAgreementTemplates(resolved.agreements)
                    moaDelayLocal = moaTemplate?.availabilityDelayMonths ?? null
                    setMoaDelayMonths(moaDelayLocal)
                    reqUploadsLocal = resolved.requirements
                        .filter(requirement => requirement.kind === 'upload')
                        .map(requirement => ({
                            id: requirement.id,
                            title: requirement.title,
                            type: 'upload' as const,
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

                // Embedded documents come from the same place the staff page reads
                // them: the participant's array when it has entries, else the
                // application's.
                const fromParticipant = participantDoc?.data()?.complianceDocuments
                const flatCompliance: any[] = Array.isArray(fromParticipant) && fromParticipant.length
                    ? fromParticipant
                    : Array.isArray(appData?.complianceDocuments)
                        ? appData.complianceDocuments
                        : []
                const candidates = [
                    ...flatCompliance.map((obj: any) => ({ ...obj, _source: 'embedded' })),
                    ...compSnap.docs.map(docSnap => ({ id: docSnap.id, ...docSnap.data(), _source: 'subcollection' }))
                ]

                // rows = ALL required uploads, filled with the newest matching
                // upload if present, otherwise "missing"
                const fullRows = reqUploadsLocal.map((requirement, idx) => {
                    const hit = latestDocumentFor(requirement, candidates)
                    const model = hit
                        ? { ...hit, type: requirement.title }
                        : { id: `missing-${idx}`, type: requirement.title, status: 'missing' }
                    return toRow(model, idx, requirement)
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
                // Same test as the agreement lists (isAgreementSigned): a record
                // existing is not enough, the SME must have signed it.
                const unsignedContractsCount = filteredAgreements.filter(c => {
                    if (isGapSlug(c.agreementId)) {
                        return !(isGapDone || isIncubateeAgreementSigned(agreements['gap-analysis'], 'gap-analysis'))
                    }
                    const slug = canonicalAgreementId(c.agreementId)
                    // An MOA that has not opened yet is not something to do now.
                    if (slug === 'moa' && !canShowMOA(appData, moaDelayLocal)) return false
                    return !isIncubateeAgreementSigned(agreements[slug], slug)
                }).length


                logGapDebug('Unsigned count computed', {
                    appId,
                    unsignedContractsCount,
                    filteredAgreements: filteredAgreements.map(x => x.agreementId),
                    isGapDone,
                    hasAgreementsDocAfter: !!agreements['gap-analysis']
                })




                // 5) KPI/stat preparation – counted from the same resolved
                // statuses the table shows, so the two always agree.
                const missingTypes = fullRows.filter(row => row.status === 'missing').map(row => row.type)

                setMissingCount(missingTypes.length + unsignedContractsCount)
                setExpiredCount(fullRows.filter(row => row.status === 'expired').length)
                setInvalidCount(
                    fullRows.filter(row => ['invalid', 'rejected', 'queried'].includes(String(row.status))).length
                )

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
    }, [activeProgramId, user?.email, user?.participantId, user?.uid, reloadToken])

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
        return pickComplianceApplication(snap.docs, activeProgramId)!.ref
    }

    const getExpiryMonthsFor = (type: string) => {
        const row = requiredDocs.find(
            d =>
                (d.type ?? 'upload') !== 'agreement' &&
                normalize(d.title) === normalize(type)
        )
        return row?.hasExpiry ? row.expiryMonths ?? null : null
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

    // Unsigned and open for signing now; a scheduled MOA is not counted as pending.
    const contractsToSign = unsignedContracts.filter(c =>
        canonicalAgreementId(c.agreementId) !== 'moa' || canShowMOA(applicationData, moaDelayMonths)
    )

    const signedContracts = useMemo(
        () => requiredAgreements.filter(c => isAgreementSigned(c.agreementId)),
        [requiredAgreements, signedAgreements, isGapDoneUI]
    )

    const normalizedSearchTerm = searchTerm.trim().toLowerCase()
    const filteredComplianceDocs = useMemo(
        () => complianceDocs.filter(item => !normalizedSearchTerm || String(item.type || '').toLowerCase().includes(normalizedSearchTerm)),
        [complianceDocs, normalizedSearchTerm]
    )
    const filteredUnsignedContracts = useMemo(
        () => unsignedContracts.filter(item => !normalizedSearchTerm || item.title.toLowerCase().includes(normalizedSearchTerm)),
        [unsignedContracts, normalizedSearchTerm]
    )
    const filteredSignedContracts = useMemo(
        () => signedContracts.filter(item => !normalizedSearchTerm || item.title.toLowerCase().includes(normalizedSearchTerm)),
        [signedContracts, normalizedSearchTerm]
    )


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
                const requirement = requiredDocs.find(item => normalize(item.title) === normalize(editingDocument.type))
                const created = await addDoc(collection(appRef, 'complianceDocuments'), {
                    type: editingDocument.type,
                    documentName: editingDocument.type,
                    ...(requirement ? { presetId: requirement.id } : {}),
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
            // Re-read so status and the policy-based expiry reflect the new dates.
            setReloadToken(token => token + 1)
        } catch (error) {
            console.error(error)
            message.error('Could not update the document details.')
        } finally {
            setSavingDocumentDetails(false)
        }
    }

    const handleSaveUpload = async () => {
        if (savingUploadRef.current) return
        savingUploadRef.current = true
        setSavingUpload(true)
        try {
            if (!selectedType) return message.error('Please select a document type.')
            if (!uploadFile) return message.error('Please select a file to upload.')

            const requirement = requiredDocs.find(item => normalize(item.title) === normalize(selectedType))
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

            // Validated above, so a rejected form never leaves an orphaned file.
            const appRef = await getAppRefForParticipant(participantId)
            const safeName = uploadFile.name?.replace(/\s+/g, '_') || 'file'
            const path = `compliance/${appRef.id}/${Date.now()}_${safeName}`
            const url = await uploadToStorage(uploadFile, path)

            // Replace the document this row shows; otherwise look it up by the
            // shared requirement id, then by title for older uploads.
            const row = complianceDocs.find(item => normalize(item.type) === normalize(selectedType))
            let existingId: string | null = row?._source === 'subcollection' && row?._id ? row._id : null
            if (!existingId && requirement) {
                const byPreset = await getDocs(query(
                    collection(appRef, 'complianceDocuments'),
                    where('presetId', '==', requirement.id),
                    limit(1)
                ))
                existingId = byPreset.docs[0]?.id ?? null
            }
            if (!existingId) {
                const byType = await getDocs(query(
                    collection(appRef, 'complianceDocuments'),
                    where('type', '==', selectedType),
                    limit(1)
                ))
                existingId = byType.docs[0]?.id ?? null
            }

            const uploadedBy = user?.name || user?.email || 'SME'
            const atISO = new Date().toISOString()
            const payload: any = {
                type: selectedType,
                documentName: selectedType,
                ...(requirement ? { presetId: requirement.id } : {}),
                status: 'pending',
                url,
                fileName: uploadFile.name ?? safeName,
                uploadedBy,
                // Dates and review state always reflect the new file, never the one it replaces.
                issueDate: issueDate ?? null,
                expiryDate: expiryDate ?? null,
                queryOpen: false,
                queryReason: '',
                updatedAt: serverTimestamp()
            }

            let savedDocId: string
            if (existingId) {
                const previousUrl = row?._id === existingId ? row?._url || '' : ''
                await updateDoc(doc(appRef, 'complianceDocuments', existingId), {
                    ...payload,
                    aiVerificationNote: deleteField(),
                    replacedAt: atISO,
                    previousFileUrl: previousUrl,
                    statusHistory: arrayUnion({
                        status: 'pending',
                        by: uploadedBy,
                        atISO,
                        reason: 'Document replaced by the SME.'
                    })
                })
                savedDocId = existingId
            } else {
                const created = await addDoc(collection(appRef, 'complianceDocuments'), {
                    ...payload,
                    statusHistory: [{ status: 'pending', by: uploadedBy, atISO, reason: 'Document uploaded by the SME.' }],
                    createdAt: serverTimestamp()
                })
                savedDocId = created.id
            }

            message.success(`Saved ${selectedType}`)
            setIsModalVisible(false)
            setSelectedType('')
            setUploadFile(null)
            setIssueDateInput(null)
            setExpiryDateInput(null)
            setReloadToken(token => token + 1)

            // AI verification runs automatically here — there's no separate
            // button on the incubatee side. When it lands, reload so the table
            // shows its result; if it fails, staff still review the document.
            void verifyComplianceDocument(appRef.id, savedDocId)
                .then(() => setReloadToken(token => token + 1))
                .catch(error => {
                    console.error('AI compliance verification failed:', error)
                    message.info('Automatic checking is unavailable right now. Your document will be reviewed by staff.')
                })
        } catch (err) {
            console.error(err)
            message.error('Save failed.')
        } finally {
            savingUploadRef.current = false
            setSavingUpload(false)
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
        if (filteredUnsignedContracts.length === 0) {
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
                dataSource={filteredUnsignedContracts}
                loading={loading}
                renderItem={contract => {
                    const slug = canonicalAgreementId(contract.agreementId)
                    const isGap = slug === 'gap-analysis'
                    const isMoaWaiting = slug === 'moa' && !canShowMOA(applicationData, moaDelayMonths)
                    // No date to give until the MOA's opening rule is configured.
                    const availableAt = asDate(applicationData?.acceptedAt) && moaDelayMonths != null
                        ? moment(asDate(applicationData.acceptedAt))
                            .add(moaDelayMonths ?? 0, 'months')
                            .format('DD MMM YYYY')
                        : null
                    const hasProfileSignature = !!user?.signatureURL

                    return (
                        <Card className='compliance-document-card compliance-agreement-card' size='small'>
                            <div className='compliance-document-card-head'>
                                <Text strong>{contract.title}</Text>
                            </div>
                            <div className='compliance-document-card-details'>
                                <Text type='secondary'>
                                    Available: {isMoaWaiting ? (availableAt || 'Not scheduled') : formatDateAny(applicationData?.acceptedAt)}
                                </Text>
                            </div>
                            <Tag color={isMoaWaiting ? 'default' : isGap || hasProfileSignature ? 'orange' : 'red'}>
                                {isGap ? 'Pending completion' : isMoaWaiting ? 'Scheduled' : hasProfileSignature ? 'Ready to sign' : 'Signature required'}
                            </Tag>
                            <div className='compliance-document-icon-actions compliance-agreement-actions'>
                                <Button
                                    type='primary'
                                    shape='round'
                                    disabled={isMoaWaiting}
                                    loading={isGap && gapViewerLoading}
                                    onClick={() => openAgreement(slug)}
                                >
                                    {isGap ? 'Open GAP Analysis' : isMoaWaiting ? 'Not available yet' : 'Review and Sign'}
                                </Button>
                            </div>
                        </Card>
                    )
                }}
            />
        )
    }

    const renderSignedAgreements = () => {
        if (filteredSignedContracts.length === 0) {
            return <Text type='secondary'>No completed agreements yet.</Text>
        }

        return (
            <List
                className='compliance-agreement-list'
                itemLayout='horizontal'
                dataSource={filteredSignedContracts}
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
                            shape='round'
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
                                <Button size='small' shape='round'>Open PDF</Button>
                            </a>,
                            <a key='download' href={pdfUrl} download>
                                <Button size='small' shape='round' icon={<DownloadOutlined />}>
                                    Download
                                </Button>
                            </a>
                        )
                    }

                    return (
                        <Card className='compliance-document-card compliance-agreement-card' size='small'>
                            <div className='compliance-document-card-head'>
                                <Text strong>{contract.title}</Text>
                            </div>
                            <div className='compliance-document-card-details'>
                                <Text type='secondary'>Available: {formatDateAny(applicationData?.acceptedAt)}</Text>
                                <Text type='secondary'>{acceptedAt ? `Signed: ${formatDateAny(acceptedAt)}` : 'Not signed'}</Text>
                            </div>
                            <Tag color='green'>Signed</Tag>
                            <div className='compliance-document-icon-actions compliance-agreement-actions'>
                                {actions}
                            </div>
                        </Card>
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

    const UploadSurface: any = screens.md ? Modal : Drawer

    return (
        <div
            style={{
                padding: screens.md ? '10px 24px' : '10px 12px'
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
                                />
                            ),
                            tone: 'danger' as const,
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
                                />
                            ),
                            tone: 'warning' as const,
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
                                />
                            ),
                            tone: 'danger' as const,
                            important: false
                        }
                    ]}
                    gutter={[12, 12]}
                    desktopSpan={8}
                />
            </div>
            <DashboardFilterBar>
                <div className='compliance-dashboard-filter-content'>
                    <Input
                        allowClear
                        prefix={<SearchOutlined />}
                        value={searchTerm}
                        onChange={event => setSearchTerm(event.target.value)}
                        placeholder='Search agreements and compliance documents'
                    />
                    <Segmented
                        className='dashboard-filter-segmented'
                        value={workspaceView}
                        onChange={value => setWorkspaceView(value as 'agreements' | 'compliance')}
                        options={[
                            { value: 'agreements', label: 'Agreements', icon: <FileProtectOutlined /> },
                            { value: 'compliance', label: 'Compliance', icon: <SafetyCertificateOutlined /> }
                        ]}
                    />
                </div>
            </DashboardFilterBar>
            {/* Required Signatures & Policies */}
            {workspaceView === 'agreements' && <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35 }}
            >
                <Card
                    style={{ ...cardStyle, marginBottom: 12 }}
                    extra={
                        loading ? <Tag>Loading…</Tag> : <Tag color={contractsToSign.length ? 'red' : unsignedContracts.length ? 'default' : 'green'}>
                            {contractsToSign.length
                                ? `${contractsToSign.length} to sign`
                                : unsignedContracts.length
                                    ? 'Nothing to sign yet'
                                    : 'All signed'}
                        </Tag>
                    }
                >
                    {loading ? (
                        <Skeleton active paragraph={{ rows: 3 }} />
                    ) : (
                        <div className='compliance-agreement-content'>
                            {renderPendingAgreements()}
                            {renderSignedAgreements()}
                        </div>
                    )}
                </Card>
            </motion.div>}
            {/* Compliance documents list: table on md+, stacked cards on mobile */}
            {workspaceView === 'compliance' && <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35 }}
            >
                <Card
                    style={cardStyle}
                >
                    {loading ? (
                        <Skeleton active paragraph={{ rows: screens.md ? 6 : 10 }} />
                    ) : screens.md ? (
                        <List
                            className='compliance-document-list'
                            dataSource={filteredComplianceDocs}
                            locale={{ emptyText: 'No matching compliance documents.' }}
                            renderItem={(item: any) => (
                                <Card className='compliance-document-card' size='small'>
                                    <div className='compliance-document-card-head'>
                                        <Text strong>{item.type}</Text>
                                        {getStatusTag(item.status)}
                                    </div>
                                    <div className='compliance-document-card-details'>
                                        <Text type='secondary'>Issued: {item.issued}</Text>
                                        <Text type='secondary'>Expiry: {item.expiry}</Text>
                                    </div>
                                    <div className='compliance-document-icon-actions'>
                                        {item._url && <Button aria-label='View document' shape='circle' icon={<EyeOutlined />} onClick={() => viewComplianceDocument(item)} />}
                                        {item._url && <Button aria-label='Download document' shape='circle' icon={<DownloadOutlined />} onClick={() => downloadComplianceDocument(item)} />}
                                        {item._url && <Button aria-label='Edit document details' shape='circle' icon={<EditOutlined />} onClick={() => openDocumentDetailsEditor(item)} />}
                                        <Button className='compliance-upload-action' aria-label={item._url ? 'Replace document' : 'Upload document'} shape='circle' icon={<UploadOutlined />} onClick={() => openUploadModal(item.type)}>
                                            <span className='compliance-upload-label'>Upload</span>
                                        </Button>
                                    </div>
                                </Card>
                            )}
                        />
                    ) : (
                        <List
                            dataSource={filteredComplianceDocs}
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
                                            className='compliance-mobile-card-header'
                                            align='baseline'
                                            style={{ justifyContent: 'space-between' }}
                                        >
                                            <Text strong>{item.type}</Text>
                                            {getStatusTag(item.status)}
                                        </Space>
                                        <Space
                                            style={{ justifyContent: 'space-between', width: '100%' }}
                                        >
                                            <Space className='compliance-mobile-date-details' size={12}>
                                                <Text type='secondary'>Issued: {item.issued}</Text>
                                                <Text type='secondary'>Expiry: {item.expiry}</Text>
                                            </Space>
                                        </Space>
                                        <Space
                                            className={`compliance-document-icon-actions ${item._url ? '' : 'is-upload-only'}`}
                                            wrap
                                        >
                                            {item._url && <Button aria-label='View document' shape='circle' icon={<EyeOutlined />} onClick={() => viewComplianceDocument(item)} />}
                                            {item._url && <Button aria-label='Download document' shape='circle' icon={<DownloadOutlined />} onClick={() => downloadComplianceDocument(item)} />}
                                            {item._url && <Button aria-label='Edit document details' shape='circle' icon={<EditOutlined />} onClick={() => openDocumentDetailsEditor(item)} />}
                                            <Button className='compliance-upload-action' aria-label={item._url ? 'Replace document' : 'Upload document'} shape='round' icon={<UploadOutlined />} onClick={() => openUploadModal(item.type)}>
                                                <span className='compliance-upload-label'>Upload</span>
                                            </Button>
                                        </Space>
                                    </Space>
                                </Card>
                            )}
                        />
                    )}
                </Card>
            </motion.div>}
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
            {/* Upload surface: bottom drawer on mobile, centered modal on desktop/tablet. */}
            <UploadSurface
                title={
                    selectedType
                        ? `Upload/Replace: ${selectedType}`
                        : 'Upload New Document'
                }
                open={isModalVisible}
                {...(screens.md
                    ? {
                        width: 520,
                        onOk: handleSaveUpload,
                        confirmLoading: savingUpload,
                        onCancel: () => setIsModalVisible(false),
                        okText: 'Save'
                    }
                    : {
                        placement: 'bottom',
                        height: 'auto',
                        onClose: () => setIsModalVisible(false),
                        footer: <Button type='primary' block loading={savingUpload} onClick={handleSaveUpload}>Save</Button>
                    })}
            >
                <Space direction='vertical' style={{ width: '100%' }}>
                    <div className='compliance-upload-date-row'>
                        <div>
                            <Text strong>Issue Date</Text>
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
                            {selectedType && getExpiryMonthsFor(selectedType) ? (
                                <Text type='secondary'>
                                    Policy: {getExpiryMonthsFor(selectedType)}-month validity
                                </Text>
                            ) : <Text type='secondary'>No policy expiry (optional)</Text>}
                        </div>
                        <div>
                            <Text strong>Expiry</Text>
                            <DatePicker
                                style={{ width: '100%' }}
                                value={expiryDateInput as any}
                                onChange={val => setExpiryDateInput(val)}
                                disabled={!!issueDateInput && !!getExpiryMonthsFor(selectedType)}
                                disabledDate={manualExpiryDisabledDate as any}
                                format='YYYY-MM-DD'
                                placeholder={issueDateInput && getExpiryMonthsFor(selectedType) ? 'Auto-calculated' : 'Optional'}
                                allowClear
                            />
                            {issueDateInput && getExpiryMonthsFor(selectedType) && expiryDateInput && (
                                <Text type='secondary'>Auto: {expiryDateInput.format('YYYY-MM-DD')}</Text>
                            )}
                        </div>
                    </div>

                    <div>
                        <Upload.Dragger
                            name='file'
                            accept='image/*,.pdf,.doc,.docx,.xls,.xlsx'
                            beforeUpload={file => {
                                // Matches the size limit on compliance/ in storage.rules.
                                if (file.size > 10 * 1024 * 1024) {
                                    message.error('File is too large. The maximum size is 10 MB.')
                                    return Upload.LIST_IGNORE
                                }
                                setUploadFile(file)
                                return false
                            }}
                            maxCount={1}
                            multiple={false}
                        >
                            <p className='ant-upload-drag-icon'><UploadOutlined /></p>
                            <p className='ant-upload-text'>Click or drag a file to upload</p>
                            <p className='ant-upload-hint'>Upload the selected document as PDF or image.</p>
                        </Upload.Dragger>
                    </div>
                </Space>
            </UploadSurface>

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
        </div>
    )
}
