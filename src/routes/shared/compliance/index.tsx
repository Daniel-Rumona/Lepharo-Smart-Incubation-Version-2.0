import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import {
    Card,
    Table,
    Button,
    Space,
    Tag,
    Input,
    Modal,
    Form,
    Select,
    DatePicker,
    Upload,
    message,
    Typography,
    Row,
    Col,
    Progress,
    Tooltip,
    Empty,
    Switch,
    InputNumber,
    Divider,
    Grid,
    Alert
} from 'antd'
import {
    SearchOutlined,
    UploadOutlined,
    EyeOutlined,
    CheckCircleOutlined,
    CloseCircleOutlined,
    WarningOutlined,
    SafetyCertificateOutlined,
    FileTextOutlined,
    PlusOutlined,
    FileProtectOutlined,
    SettingOutlined,
    UserOutlined,
    InboxOutlined,
    MailOutlined,
    InfoCircleOutlined,
    RobotOutlined,
    DownloadOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import type { UploadProps } from 'antd'
import type { ColumnType } from 'antd/es/table'
import { Helmet } from 'react-helmet'
import { useNavigate } from 'react-router-dom'
import { onAuthStateChanged, getAuth } from 'firebase/auth'
import { db, functions } from '@/firebase'
import {
    collection,
    getDocs,
    updateDoc,
    setDoc,
    doc,
    query,
    where,
    getDoc,
    serverTimestamp,
    addDoc,
    limit
} from 'firebase/firestore'
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage'
import { httpsCallable } from 'firebase/functions'
import EmailTemplateModal from '@/components/modals/EmailTemplate'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import {
    guideTarget,
    usePageGuides,
    type PageGuideRegistration
} from '@/components/guide-me'
import { LoadingOverlay } from '@/components/shared/LoadingOverlay'
import { PreIncubationContractModal } from '@/components/modals/Contracts/PreIncubationContract'
import {
    complianceStatusCountsAsCovered,
    complianceStatusLabel,
    resolveComplianceDocumentStatus,
    resolveComplianceRequirements
} from '@/services/complianceResolver'
import {
    verifyComplianceDocument,
    verifyComplianceDocumentsBatch,
    type BatchVerifyTarget
} from '@/services/complianceVerificationService'

const { Text } = Typography
const { TextArea } = Input
const { useBreakpoint } = Grid

type ProgramRequirement = {
    id?: string
    isOnboarding?: boolean
    key?: string
    preset?: string
    title: string
    hasExpiry?: boolean
    expiryMonths?: number | null
    requiredAtApplication?: boolean
    type?: 'upload' | 'agreement'
    agreementId?: string
}

type RequiredDoc = {
    id: string
    isOnboarding?: boolean
    title: string
    type?: 'upload' | 'agreement'
    hasExpiry?: boolean
    expiryMonths?: number | null
    presetId?: string
    agreementId?: string
}

type ComplianceStatus = 'valid' | 'expiring-soon' | 'expired' | 'missing' | 'pending' | 'invalid' | 'queried' | string

type StatusHistoryItem = {
    status: 'valid' | 'pending' | 'invalid' | 'queried' | 'resolved' | 'expired'
    reason?: string
    by?: string
    atISO?: string
    note?: string
}

type ComplianceDocument = {
    id: string
    isOnboarding?: boolean
    kind?: 'upload' | 'agreement'
    agreementId?: string
    slug?: string
    participantId: string
    documentName: string
    status: ComplianceStatus
    issueDate?: string
    expiryDate?: string
    url?: string
    pdfPath?: string
    storagePath?: string
    uploadedBy?: string
    uploadedAt?: string
    lastVerifiedBy?: string
    lastVerifiedAt?: string
    queryReason?: string
    queryOpen?: boolean
    statusHistory?: StatusHistoryItem[]

    programId: string
    programName?: string
    presetId?: string
    departmentId?: string
    departmentName?: string
    createdBy?: string

    // ROM signing (support both casings used in the system)
    romSignedBy?: string
    romSignerEmail?: string
    romSignedAt?: string
    romSignatureUrl?: string
    romSignatureURL?: string
    fullyConfirmedAt?: any
    participantSignedAt?: any
    participantSignatureURL?: string
    gapAnalysisId?: string
}

type BranchDoc = { id: string; name?: string; branchName?: string }

type ApplicationDoc = {
    id: string
    participantId: string
    email?: string
    branchId?: string
    branchName?: string
    gapGroup?: string
    programId?: string
    programName?: string
    complianceDocuments?: ComplianceDocument[]
    manuallyCreated?: boolean
    manualApplication?: boolean
    signedAgreements?: Record<string, any>
}

const normalize = (s?: string) => (s || '').toString().trim().toLowerCase()

const slugify = (s?: string) =>
    (s || '')
        .toString()
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')

const keyForReq = (r: RequiredDoc) => {
    const base = r.type === 'agreement' ? r.agreementId || r.id || r.title : r.presetId || r.id || r.title
    return `${r.type ?? 'upload'}:${slugify(base)}`
}

const keyForDoc = (d: ComplianceDocument) => {
    const base = d.kind === 'agreement' ? d.agreementId || d.documentName : d.slug || d.presetId || d.documentName
    return `${d.kind ?? 'upload'}:${slugify(base)}`
}

const requirementStatusLabel = (
    requirement: RequiredDoc,
    status: string,
    documentRecord?: ComplianceDocument
) => {
    if ((requirement.type ?? 'upload') === 'agreement') {
        const agreementId = slugify(requirement.agreementId || requirement.id || requirement.title)
        if (agreementId === 'gap-analysis') {
            if (!documentRecord || status === 'missing') return 'Awaiting SME completion'
            const confirmed = Boolean(
                documentRecord.romSignedAt ||
                documentRecord.romSignatureURL ||
                documentRecord.romSignatureUrl ||
                documentRecord.fullyConfirmedAt
            )
            return confirmed ? 'Confirmed' : 'Awaiting Operations confirmation'
        }
        if (!documentRecord || status === 'missing') return 'Awaiting SME signature'
        if (status === 'pending') return 'Awaiting Operations signature'
    }
    return complianceStatusLabel(status)
}

const statusColor = (s: string) =>
    s === 'valid'
        ? 'green'
        : s === 'expiring-soon'
            ? 'orange'
            : s === 'pending'
                ? 'blue'
                : s === 'expired'
                    ? 'red'
                    : s === 'invalid' || s === 'queried'
                        ? 'volcano'
                        : 'default'

const toSlug = (s: string) =>
    (s || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')

const standardAgreementTitle = (id?: string, title?: string) => {
    return String(title || id || 'Agreement')
        .replace(/[-_]+/g, ' ')
        .replace(/\b\w/g, character => character.toUpperCase())
        .trim()
}

const looksLikeAgreement = (title?: string) => {
    const t = (title || '').toLowerCase()
    return (
        t.includes('contract') ||
        t.includes('agreement') ||
        t.includes('memorandum of agreement') ||
        t === 'moa' ||
        t.includes('gap analysis')
    )
}

const sanitizeTemplates = (raw: RequiredDoc[] | any[]): RequiredDoc[] => {
    const fixed = raw.map(t => {
        const rawType = (t.type ?? t.kind ?? '').toString().toLowerCase()
        const isAgreement = rawType === 'agreement' || (
            rawType !== 'upload' && (!!t.agreementId || looksLikeAgreement(t.title))
        )

        if (isAgreement) {
            const slugVal = t.agreementId || toSlug(t.title || t.id || 'agreement')
            return {
                ...t,
                id: slugVal,
                title: standardAgreementTitle(slugVal, t.title),
                type: 'agreement',
                agreementId: slugVal,
                presetId: undefined,
                isOnboarding: true
            }
        } else {
            const pid = t.presetId || t.id || toSlug(t.title)
            return {
                ...t,
                id: pid,
                type: 'upload',
                presetId: pid,
                agreementId: undefined,
                isOnboarding: t.isOnboarding === true
            }
        }
    })

    const seen = new Set<string>()
    const out: RequiredDoc[] = []
    for (const r of fixed) {
        const key = `${r.type ?? 'upload'}:${toSlug(r.type === 'agreement' ? r.agreementId || r.id : r.presetId || r.id)}`
        if (!seen.has(key)) {
            seen.add(key)
            out.push(r)
        }
    }
    return out
}

const stripUndefinedDeep = (val: any): any => {
    if (Array.isArray(val)) return val.map(stripUndefinedDeep)
    if (val && typeof val === 'object') {
        const out: any = {}
        Object.entries(val).forEach(([k, v]) => {
            const sv = stripUndefinedDeep(v)
            if (sv !== undefined) out[k] = sv
        })
        return out
    }
    return val === undefined ? undefined : val
}

const norm = (s?: string) => (s || '').trim().toLowerCase()

const mapProgramReqToRequiredDoc = (pr: ProgramRequirement | any): RequiredDoc => {
    const rawType = (pr.type ?? pr.kind ?? '').toString().toLowerCase()
    const s = norm(pr.key || pr.preset || pr.title)
    const isAgreement = rawType === 'agreement' || (
        rawType !== 'upload' && (!!pr.agreementId || looksLikeAgreement(pr.title))
    )

    const base: RequiredDoc = {
        id: isAgreement ? pr.agreementId || s : s,
        title: isAgreement
            ? standardAgreementTitle(pr.agreementId || s, pr.title || pr.key || pr.preset)
            : pr.title || pr.key || pr.preset || 'Untitled',
        type: isAgreement ? 'agreement' : 'upload',
        isOnboarding: isAgreement || pr.isOnboarding === true,
        hasExpiry: !!pr.hasExpiry,
        expiryMonths: pr.hasExpiry ? pr.expiryMonths ?? null : null
    }

    if (isAgreement) base.agreementId = pr.agreementId || s
    else base.presetId = s

    return base
}

async function fetchProgramRequiredFromProgramDoc(programId: string): Promise<RequiredDoc[]> {
    const programRef = doc(db, 'programs', programId)
    const snap = await getDoc(programRef)

    if (snap.exists()) {
        const data = snap.data() as any
        const arr: ProgramRequirement[] = Array.isArray(data.programRequirements) ? data.programRequirements : []
        if (arr.length) return arr.map(mapProgramReqToRequiredDoc)
    }

    const legacy = await getDocs(collection(db, 'programs', programId, 'requiredDocs'))
    if (!legacy.empty) {
        return legacy.docs.map(d => {
            const t = d.data() as any
            const isAgreement = t.type === 'agreement'
            return {
                id: d.id,
                title: t.title || d.id,
                type: isAgreement ? 'agreement' : 'upload',
                isOnboarding: isAgreement || t.isOnboarding === true,
                hasExpiry: !!t.expiryRule,
                expiryMonths: t.expiryRule?.months ?? null,
                presetId: isAgreement ? undefined : d.id,
                agreementId: isAgreement ? t.agreementId || d.id : undefined
            } as RequiredDoc
        })
    }

    return []
}

// FIX: unified ROM signed detection (matches participants logic better)
const isRomSigned = (d?: ComplianceDocument | null) => {
    if (!d) return false
    const sig = (d.romSignatureUrl || d.romSignatureURL || '').toString().trim()
    const at = (d.romSignedAt || '').toString().trim()
    return !!sig || !!at || Boolean(d.fullyConfirmedAt)
}

const asDayjs = (value: any) => {
    if (!value) return null
    const raw = typeof value?.toDate === 'function'
        ? value.toDate()
        : typeof value?.seconds === 'number'
            ? new Date(value.seconds * 1000)
            : value
    const parsed = dayjs(raw)
    return parsed.isValid() ? parsed : null
}

const toISO = (value: any) => asDayjs(value)?.toISOString() || ''

const ComplianceTrackingPage: React.FC = () => {
    const navigate = useNavigate()
    const [currentUser, setCurrentUser] = useState<any>(null)
    const { activeProgramId, isAllPrograms } = useActiveProgramId()
    const [programName, setProgramName] = useState<string>('—')
    const [departmentInfo, setDepartmentInfo] = useState<any>(null)
    const screens = useBreakpoint()

    const guideRegistration = useMemo<PageGuideRegistration>(
        () => ({
            pageId: 'compliance-management',
            pageTitle: 'Compliance Management',
            guides: [
                {
                    id: 'compliance-overview',
                    title: 'Quick tour',
                    description: 'Understand document requirements, participant coverage and the compliance actions available to your department.',
                    kind: 'page',
                    order: 1,
                    steps: [
                        {
                            element: guideTarget('compliance-metrics'),
                            popover: {
                                title: 'Compliance overview',
                                description: 'These metrics reflect only the documents that are relevant to your department. Departments with no applicable requirements correctly show zero.',
                                side: 'bottom',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('compliance-filters'),
                            popover: {
                                title: 'Search and actions',
                                description: 'Search participants and use the available reminder, AI verification and document-setup actions.',
                                side: 'bottom',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('compliance-table'),
                            popover: {
                                title: 'Participant compliance',
                                description: 'Review document coverage and status for each participant, then use Manage to inspect or action individual requirements.',
                                side: 'top',
                                align: 'start'
                            }
                        }
                    ]
                },
                {
                    id: 'manage-compliance',
                    title: 'Manage participant documents',
                    description: 'Review, upload, verify or query compliance documents for one participant.',
                    kind: 'task',
                    order: 2,
                    steps: [
                        {
                            element: '[data-guide="manage-compliance-action"]',
                            advanceOnClick: true,
                            popover: {
                                title: 'Manage participant',
                                description: 'Open Manage for the participant whose documents you want to review.',
                                side: 'left',
                                align: 'center',
                                showButtons: ['close']
                            }
                        },
                        {
                            element: '.guide-manage-compliance-modal',
                            waitForElement: 5000,
                            popover: {
                                title: 'Document workspace',
                                description: 'Only requirements visible to your department are shown here. Onboarding-only items and agreements are restricted to onboarding or monitoring departments.',
                                side: 'left',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('manage-compliance-content'),
                            waitForElement: 5000,
                            popover: {
                                title: 'Review document status',
                                description: 'View existing files, upload missing or invalid documents, verify them, run AI checks, or raise and resolve document issues.',
                                side: 'top',
                                align: 'start'
                            }
                        },
                        {
                            element: '[data-guide="download-document-action"]',
                            waitForElement: 5000,
                            popover: {
                                title: 'View or download the file',
                                description: 'View opens the document in a separate tab. Download saves the document using its compliance title.',
                                side: 'top',
                                align: 'start'
                            }
                        },
                        {
                            element: '[data-guide="upload-document-action"]',
                            waitForElement: 5000,
                            popover: {
                                title: 'Upload or replace',
                                description: 'Upload is shown for a missing document. Replace is shown when a file already exists; replacement returns it to Awaiting verification.',
                                side: 'top',
                                align: 'start'
                            }
                        },
                        {
                            element: '[data-guide="verify-document-action"]',
                            waitForElement: 5000,
                            popover: {
                                title: 'Verify a document',
                                description: 'Use Verify after reviewing the file, or AI Verify for a legibility, document-type and expiry check.',
                                side: 'top',
                                align: 'start'
                            }
                        },
                        {
                            element: '[data-guide="invalidate-document-action"]',
                            waitForElement: 5000,
                            popover: {
                                title: 'Record a document problem',
                                description: 'Invalidate records the exact problem for staff and the SME. Queried documents show their reason and can be returned to Awaiting verification after resolution.',
                                side: 'top',
                                align: 'start'
                            }
                        },
                        {
                            element: '[data-guide="rom-sign-agreement-action"]',
                            waitForElement: 5000,
                            popover: {
                                title: 'Complete the ROM signature',
                                description: 'For agreements awaiting the organisation signature, authorised ROM staff can apply their saved signature here.',
                                side: 'top',
                                align: 'start'
                            }
                        }
                    ]
                },
                {
                    id: 'upload-compliance-document',
                    title: 'Upload on behalf of an SME',
                    description: 'Upload a missing document or replace an existing document for an SME.',
                    kind: 'task',
                    order: 3,
                    steps: [
                        {
                            element: '[data-guide="upload-compliance-action"]',
                            advanceOnClick: true,
                            popover: {
                                title: 'Choose the SME',
                                description: 'Open Upload / Replace for the SME whose document you need to manage.',
                                side: 'left',
                                align: 'center',
                                showButtons: ['close']
                            }
                        },
                        {
                            element: '.guide-upload-compliance-modal',
                            waitForElement: 5000,
                            popover: {
                                title: 'Select the requirement and file',
                                description: 'Choose the document requirement, attach the file, and record issue or expiry details. Existing documents are clearly labelled as Replace.',
                                side: 'left',
                                align: 'start'
                            }
                        }
                    ]
                },
                {
                    id: 'compliance-reminders-and-ai',
                    title: 'Reminders and bulk AI checks',
                    description: 'Contact SMEs with outstanding items or run AI verification across visible records.',
                    kind: 'task',
                    order: 4,
                    steps: [
                        {
                            element: guideTarget('email-compliance-reminders'),
                            popover: {
                                title: 'Use an email template',
                                description: 'Build a recipient list from SMEs with outstanding requirements, then review and send a compliance reminder template.',
                                side: 'bottom',
                                align: 'end'
                            }
                        },
                        {
                            element: guideTarget('quick-compliance-reminders'),
                            popover: {
                                title: 'Send quick reminders',
                                description: 'Send each affected SME a direct reminder listing the exact documents that need attention.',
                                side: 'bottom',
                                align: 'end'
                            }
                        },
                        {
                            element: guideTarget('bulk-ai-compliance'),
                            popover: {
                                title: 'Verify visible documents with AI',
                                description: 'Runs AI checks on uploaded documents for the SMEs in the current programme scope. A confirmation is shown before it starts.',
                                side: 'bottom',
                                align: 'end'
                            }
                        }
                    ]
                },
                {
                    id: 'configure-compliance-documents',
                    title: 'Configure required documents',
                    description: 'Configure which document requirements your department monitors for the selected programme.',
                    kind: 'task',
                    order: 5,
                    steps: [
                        {
                            element: guideTarget('setup-compliance-documents'),
                            advanceOnClick: true,
                            popover: {
                                title: 'Setup Documents',
                                description: 'Open document setup for the currently selected programme.',
                                side: 'bottom',
                                align: 'end',
                                showButtons: ['close']
                            }
                        },
                        {
                            element: '.guide-setup-compliance-modal',
                            waitForElement: 5000,
                            popover: {
                                title: 'Department requirements',
                                description: 'Choose the documents this department is responsible for monitoring. Onboarding-only requirements are only available to onboarding and monitoring departments.',
                                side: 'left',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('add-compliance-document'),
                            waitForElement: 5000,
                            popover: {
                                title: 'Add a requirement',
                                description: 'Add a document requirement, then choose an available programme preset. Eligible onboarding and monitoring departments can also select agreements.',
                                side: 'bottom',
                                align: 'start'
                            }
                        },
                        {
                            element: '.guide-save-compliance-documents',
                            waitForElement: 5000,
                            popover: {
                                title: 'Save document requirements',
                                description: 'Save once at least one requirement has been added. A department that does not monitor compliance can simply remain with zero applicable requirements.',
                                side: 'top',
                                align: 'center'
                            }
                        }
                    ]
                }
            ]
        }),
        []
    )

    usePageGuides(guideRegistration)

    const canSeeOnboardingDocuments = useMemo(
        () => departmentInfo?.isOnboarding === true || departmentInfo?.isMonitoring === true,
        [departmentInfo?.isOnboarding, departmentInfo?.isMonitoring]
    )

    const isRequirementVisibleToDepartment = useCallback(
        (requirement: RequiredDoc) => {
            const onboardingOnly =
                requirement.isOnboarding === true ||
                (requirement.type ?? 'upload') === 'agreement'
            return !onboardingOnly || canSeeOnboardingDocuments
        },
        [canSeeOnboardingDocuments]
    )

    const [reasonOpen, setReasonOpen] = useState(false)
    const [reasonContext, setReasonContext] = useState<{ participantId: string; docKey: string; subDocId?: string } | null>(null)
    const [reasonStatus, setReasonStatus] = useState<'invalid' | 'queried'>('invalid')
    const [reasonForm] = Form.useForm()

    const [viewReason, setViewReason] = useState<{ title: string; queryReason: string } | null>(null)
    const [viewReasonOpen, setViewReasonOpen] = useState(false)

    const [participants, setParticipants] = useState<any[]>([])
    const [apps, setApps] = useState<ApplicationDoc[]>([])
    const [searchText, setSearchText] = useState('')

    const [romSignOpen, setRomSignOpen] = useState(false)
    const [romSignForm] = Form.useForm()
    const [romSignTarget, setRomSignTarget] = useState<{ participantId: string; agreementId: string } | null>(null)
    const [romSigning, setRomSigning] = useState(false)
    const [preIncViewer, setPreIncViewer] = useState<{ participantId: string; meta?: any } | null>(null)

    const [deptRequired, setDeptRequired] = useState<RequiredDoc[] | null>(null)
    const [reqModalOpen, setReqModalOpen] = useState(false)

    const [manageOpen, setManageOpen] = useState(false)
    const [manageTarget, setManageTarget] = useState<any | null>(null)
    const [uploadOpen, setUploadOpen] = useState(false)
    const [lockedUploadRequirementId, setLockedUploadRequirementId] = useState<string | null>(null)
    const pendingRowUpload = useRef<{ participant: any; requiredId: string } | null>(null)
    const rowFileInputRef = useRef<HTMLInputElement | null>(null)
    const [emailTempaltesOpen, setEmailTemplatesOpen] = useState(false)

    const [aiVerifyingDocIds, setAiVerifyingDocIds] = useState<Record<string, boolean>>({})
    const [aiBatchRunning, setAiBatchRunning] = useState(false)
    const [aiBatchProgress, setAiBatchProgress] = useState<{ done: number; total: number } | null>(null)

    const [loading, setLoading] = useState(true)
    const [savingReqs, setSavingReqs] = useState(false)
    const { user } = useFullIdentity()

    const [formUpload] = Form.useForm()
    const [formReq] = Form.useForm()
    const storage = getStorage()

    const [emailTargets, setEmailTargets] = useState<
        { email: string; vars?: { firstName?: string; requested?: string[]; documents?: string[] } }[]
    >([])

    const [programTemplates, setProgramTemplates] = useState<RequiredDoc[]>([])
    const [requirementsByProgram, setRequirementsByProgram] = useState<Record<string, RequiredDoc[]>>({})

    const isPreIncubation = (req?: RequiredDoc, docItem?: ComplianceDocument) =>
        toSlug(`${req?.agreementId || req?.id || ''} ${req?.title || ''} ${docItem?.agreementId || docItem?.slug || ''} ${docItem?.documentName || ''}`)
            .includes('pre-incubation')

    const computeExpiryDate = (docItem: ComplianceDocument, req?: RequiredDoc) => {
        if (!req?.hasExpiry) return null
        const months = req.expiryMonths ?? 0
        if (!months) return null

        if (isPreIncubation(req, docItem)) {
            if (!isRomSigned(docItem)) return null
            const explicit = asDayjs(docItem.fullyConfirmedAt)
            if (explicit) return explicit.add(months, 'month')

            const participantSigned = asDayjs(docItem.issueDate || docItem.uploadedAt)
            const romSigned = asDayjs(docItem.romSignedAt)
            if (!participantSigned || !romSigned) return null
            const fullyConfirmed = participantSigned.isAfter(romSigned) ? participantSigned : romSigned
            return fullyConfirmed.add(months, 'month')
        }

        const issued = asDayjs(docItem.issueDate)
        return issued ? issued.add(months, 'month') : null
    }

    const expiryDisplay = (docItem: ComplianceDocument | undefined, req: RequiredDoc, computedExpiry: any) => {
        if (!req.hasExpiry) return '—'
        if (computedExpiry) return computedExpiry.format('DD MMM YYYY')
        if (docItem && isPreIncubation(req, docItem)) return 'Awaiting full confirmation'
        return `${req.expiryMonths ?? '—'} mo`
    }

    const deriveStatus = (docItem: ComplianceDocument, req?: RequiredDoc) => {
        if (req && isPreIncubation(req, docItem) && !isRomSigned(docItem)) return 'pending'
        const exp = computeExpiryDate(docItem, req)
        return resolveComplianceDocumentStatus(
            docItem,
            exp?.toDate() || docItem.expiryDate
        )
    }

    const pushHistory = (docItem: ComplianceDocument | undefined, entry: StatusHistoryItem): StatusHistoryItem[] => {
        const prev = Array.isArray(docItem?.statusHistory) ? docItem!.statusHistory! : []
        return [...prev, entry]
    }

    useEffect(() => {
        const unsub = onAuthStateChanged(getAuth(), async u => {
            if (!u) return
            const usersSnap = await getDocs(collection(db, 'users'))
            const userDoc = usersSnap.docs.find(d => d.id === u.uid)
            const ud = userDoc?.data()
            setCurrentUser(ud || null)
            if (ud?.departmentId) {
                const deptsSnap = await getDocs(collection(db, 'departments'))
                const deptDoc = deptsSnap.docs.find(d => d.id === ud.departmentId)
                setDepartmentInfo(deptDoc?.data() || null)
            }
        })
        return () => unsub()
    }, [])

    useEffect(() => {
        ; (async () => {
            if (!activeProgramId) {
                setProgramTemplates([])
                setDeptRequired(null)
                setProgramName(isAllPrograms ? 'All Programs' : '—')
                return
            }
            const raw = await fetchProgramRequiredFromProgramDoc(activeProgramId)
            const templates = sanitizeTemplates(raw)
            setProgramTemplates(templates)

            try {
                const snap = await getDoc(doc(db, 'programs', activeProgramId))
                if (snap.exists()) {
                    const data = snap.data() as any
                    setProgramName(data.name || '—')
                }
            } catch (e) {
                console.error('Failed to load program name', e)
            }
        })()
    }, [activeProgramId, isAllPrograms])

    const fetchDeptRequirements = useCallback(async () => {
        if (!activeProgramId || !currentUser?.departmentId) return
        const resolved = await resolveComplianceRequirements(activeProgramId, {
            departmentId: currentUser.departmentId
        })
        const list = sanitizeTemplates(resolved.requirements as RequiredDoc[])
        setDeptRequired(list)
        formReq.setFieldsValue({ requiredDocuments: list.map(r => ({ ...r })) })
    }, [activeProgramId, currentUser?.departmentId, formReq, programTemplates])

    useEffect(() => {
        if (activeProgramId && currentUser?.departmentId) fetchDeptRequirements()
    }, [activeProgramId, currentUser?.departmentId, fetchDeptRequirements])

    const visibleProgramTemplates = useMemo(
        () => programTemplates.filter(isRequirementVisibleToDepartment),
        [programTemplates, isRequirementVisibleToDepartment]
    )

    const effectiveRequired: RequiredDoc[] = useMemo(() => {
        const source = deptRequired !== null ? deptRequired : visibleProgramTemplates
        return source.filter(isRequirementVisibleToDepartment)
    }, [deptRequired, visibleProgramTemplates, isRequirementVisibleToDepartment])

    const isROMDept = useMemo(() => {
        const name = (departmentInfo?.name || (currentUser?.department as string) || '').toLowerCase()
        return name.includes('rom')
    }, [departmentInfo?.name, currentUser?.department])

    const appByParticipant: Record<string, ApplicationDoc> = useMemo(() => {
        const m: Record<string, ApplicationDoc> = {}
        apps.forEach(a => {
            if (a.participantId) m[a.participantId] = a
        })
        return m
    }, [apps])

    const requirementsForPart = useCallback((participantId: string): RequiredDoc[] => {
        const application = appByParticipant[participantId]
        const scopedRequirements = isAllPrograms
            ? requirementsByProgram[application?.programId || ''] || []
            : effectiveRequired
        const isManualApplication = application?.manuallyCreated === true || application?.manualApplication === true
        if (!isManualApplication) return scopedRequirements

        return scopedRequirements.map(requirement => {
            if ((requirement.type ?? 'upload') !== 'agreement') return requirement
            const uploadId = requirement.agreementId || requirement.presetId || requirement.id
            return {
                ...requirement,
                id: uploadId,
                type: 'upload',
                presetId: uploadId,
                agreementId: undefined,
                isOnboarding: false
            }
        })
    }, [appByParticipant, effectiveRequired, isAllPrograms, requirementsByProgram])

    const docsForPart = useCallback(
        (participantId: string) => {
            const a = appByParticipant[participantId]
            if (!a) return []
            const docs = ((a.complianceDocuments || []) as ComplianceDocument[]).filter(document => {
                const onboardingOnly =
                    document.isOnboarding === true ||
                    (document.kind ?? 'upload') === 'agreement'
                return !onboardingOnly || canSeeOnboardingDocuments
            })
            const inProgram = activeProgramId
                ? docs.filter(d => {
                    if ((d.kind ?? 'upload') === 'agreement') return true
                    return d.programId === activeProgramId
                })
                : docs
            const canonical = new Map<string, ComplianceDocument>()
            inProgram.forEach(document => canonical.set(keyForDoc(document), document))
            return Array.from(canonical.values())
        },
        [appByParticipant, activeProgramId, canSeeOnboardingDocuments]
    )

    const coverageForPart = useCallback(
        (participantId: string) => {
            const participantRequirements = requirementsForPart(participantId)
            const reqKeys = new Set(participantRequirements.map(keyForReq))
            const docs = docsForPart(participantId)
            let have = 0
            const states: string[] = []
            reqKeys.forEach(k => {
                const req = participantRequirements.find(item => keyForReq(item) === k)
                const item = docs.find(document => keyForDoc(document) === k)
                const state = item ? deriveStatus(item, req) : 'missing'
                states.push(state)
                if (complianceStatusCountsAsCovered(state)) have += 1
            })
            const priority = ['expired', 'queried', 'invalid', 'missing', 'pending']
            const blocking = priority.find(state => states.includes(state))
            const status = blocking ||
                (states.includes('expiring-soon') ? 'expiring-soon' : states.length ? 'valid' : 'not-configured')
            return { have, need: reqKeys.size, status }
        },
        [docsForPart, requirementsForPart]
    )

    const buildEmailTargets = useCallback(() => {
        const targets: { email: string; vars?: { firstName?: string; requested?: string[]; documents?: string[] } }[] = []
        const participantsWithApp = participants.filter(p => appByParticipant[p.id])

        participantsWithApp.forEach(p => {
            const app = appByParticipant[p.id]
            const email = p.email || app?.email
            if (!email) return

            const firstName = (p.beneficiaryName || p.name || '').split(' ')[0] || 'Participant'
            const docs = docsForPart(p.id)
            const issues: string[] = []

            requirementsForPart(p.id).forEach(r => {
                const k = keyForReq(r)
                const item = docs.find(document => keyForDoc(document) === k)
                const status = item ? deriveStatus(item, r) : 'missing'
                if (!complianceStatusCountsAsCovered(status)) {
                    issues.push(`${r.title} (${complianceStatusLabel(status)})`)
                }
            })

            if (issues.length) {
                targets.push({
                    email,
                    vars: { firstName, documents: issues }
                })
            }
        })

        return targets
    }, [participants, appByParticipant, docsForPart, requirementsForPart])

    useEffect(() => {
        const run = async () => {
            if (!activeProgramId && !isAllPrograms) return
            setLoading(true)
            try {
                const [appsSnap, partSnap, branchesSnap, gapAnalysisSnap] = await Promise.all([
                    getDocs(
                        query(
                            collection(db, 'applications'),
                            where('applicationStatus', 'in', ['Accepted', 'accepted']),
                            ...(activeProgramId ? [where('programId', '==', activeProgramId)] : [])
                        )
                    ),
                    getDocs(collection(db, 'participants')),
                    getDocs(collection(db, 'branches')),
                    getDocs(collection(db, 'gapAnalysis')).catch(error => {
                        console.warn('GAP lifecycle records could not be loaded.', error)
                        return null
                    })
                ])

                const partMap: Record<string, any> = Object.fromEntries(
                    partSnap.docs.map(d => [d.id, { id: d.id, ...d.data() }])
                )
                const branchMap: Record<string, string> = {}
                branchesSnap.docs.forEach(d => {
                    const b = d.data() as BranchDoc
                    branchMap[d.id] = b.name || b.branchName || 'Unknown Branch'
                })
                const gapsByParticipant: Record<string, any[]> = {}
                gapAnalysisSnap?.docs.forEach(gapSnapshot => {
                    const gap = { id: gapSnapshot.id, ...(gapSnapshot.data() as any) }
                    const participantId = String(gap.participantId || '').trim()
                    if (!participantId) return
                    if (!gapsByParticipant[participantId]) gapsByParticipant[participantId] = []
                    gapsByParticipant[participantId].push(gap)
                })

                const programIds = Array.from(new Set(
                    appsSnap.docs
                        .map(application => String((application.data() as any).programId || '').trim())
                        .filter(Boolean)
                ))
                const resolvedRequirementsByProgram: Record<string, RequiredDoc[]> = {}
                const programNamesById: Record<string, string> = {}

                if (isAllPrograms) {
                    await Promise.all(programIds.map(async programId => {
                        const [resolved, programSnapshot] = await Promise.all([
                            resolveComplianceRequirements(
                                programId,
                                currentUser?.departmentId
                                    ? { departmentId: currentUser.departmentId }
                                    : {}
                            ),
                            getDoc(doc(db, 'programs', programId))
                        ])

                        resolvedRequirementsByProgram[programId] = sanitizeTemplates(
                            resolved.requirements as RequiredDoc[]
                        ).filter(isRequirementVisibleToDepartment)
                        if (programSnapshot.exists()) {
                            const program = programSnapshot.data() as any
                            programNamesById[programId] = program.name || program.title || programId
                        }
                    }))
                    setRequirementsByProgram(resolvedRequirementsByProgram)
                } else {
                    setRequirementsByProgram({})
                }

                const rowsData: ApplicationDoc[] = await Promise.all(
                    appsSnap.docs.map(async d => {
                        const ad = d.data() as any
                        const appId = d.id
                        const branchId = ad.branchId
                        const participantData = partMap[ad.participantId] || {}
                        const manuallyCreated = ad.manuallyCreated === true || ad.manualApplication === true
                        const gapRecord = (gapsByParticipant[ad.participantId] || [])
                            .slice()
                            .sort((left, right) => {
                                const rightAt = asDayjs(
                                    right.submittedAt || right.completedAt || right.updatedAt || right.createdAt
                                )?.valueOf() || 0
                                const leftAt = asDayjs(
                                    left.submittedAt || left.completedAt || left.updatedAt || left.createdAt
                                )?.valueOf() || 0
                                return rightAt - leftAt
                            })[0]
                        const gapCompleted = Boolean(
                            ad.gapAnalysisStatus === 'Completed' ||
                            ad.gapSubmittedAt ||
                            gapRecord?.submittedAt ||
                            gapRecord?.completedAt
                        )
                        const gapOperationsConfirmed = Boolean(
                            gapRecord?.confirmationStatus === 'Confirmed' ||
                            gapRecord?.romReview?.status === 'Confirmed' ||
                            gapRecord?.romReview?.confirmedAt ||
                            gapRecord?.confirmedAt
                        )
                        const gapConfirmedAt =
                            gapRecord?.romReview?.confirmedAt ||
                            gapRecord?.confirmedAt ||
                            (gapRecord?.confirmationStatus === 'Confirmed' ? gapRecord?.updatedAt : null)
                        const gapRomSignature =
                            gapRecord?.romReview?.romSignatureUrl ||
                            gapRecord?.romReview?.romSignatureURL ||
                            ''
                        const templatesForApplication = isAllPrograms
                            ? resolvedRequirementsByProgram[ad.programId] || []
                            : programTemplates

                        const uploadsSnap = await getDocs(collection(db, 'applications', appId, 'complianceDocuments'))
                        const uploads: ComplianceDocument[] = uploadsSnap.docs.map(s => {
                            const v = s.data() as any
                            const upSlug = normalize(v.slug || v.presetId || v.preset || v.type || v.documentName)
                            return {
                                id: s.id,
                                kind: 'upload',
                                isOnboarding: v.isOnboarding === true,
                                slug: upSlug,
                                participantId: ad.participantId,
                                documentName: v.documentName || v.type || 'Document',
                                status: (v.status || 'pending').toLowerCase(),
                                issueDate: v.issueDate || '',
                                expiryDate: v.expiryDate || '',
                                url: v.signedFileURL || v.signedFileUrl || v.downloadURL || v.fileURL || v.fileUrl || v.pdfUrl || v.pdfURL || v.url || '',
                                pdfPath: v.pdfPath || v.storagePath || v.filePath || '',
                                uploadedBy: v.uploadedBy || '',
                                uploadedAt: v.createdAt || v.uploadedAt || '',
                                lastVerifiedBy: v.lastVerifiedBy || '',
                                lastVerifiedAt: v.lastVerifiedAt?.seconds
                                    ? new Date(v.lastVerifiedAt.seconds * 1000).toISOString()
                                    : v.lastVerifiedAt || '',
                                queryReason: v.queryReason || '',
                                queryOpen: v.queryOpen === true || (v.status || '').toLowerCase() === 'queried',
                                statusHistory: Array.isArray(v.statusHistory) ? v.statusHistory : [],
                                programId: v.programId || ad.programId || '',
                                programName: ad.programName || '',
                                departmentId: v.departmentId || ad.departmentId || '',
                                departmentName: v.departmentName || '',
                                presetId: v.presetId || v.preset || v.slug || undefined,
                                createdBy: v.createdBy || ''
                            }
                        })

                        // Canonical agreement documents
                        const agreementsSnap = await getDocs(collection(db, 'applications', appId, 'agreements'))
                        const agreements: ComplianceDocument[] = agreementsSnap.docs.map(s => {
                            const v = s.data() as any
                            const slugVal = normalize(s.id)
                            const isGapAgreement = slugVal === 'gap-analysis'
                            const tpl = templatesForApplication.find(t => (t.type ?? 'upload') === 'agreement' && normalize(t.agreementId || t.id) === slugVal)
                            const title = tpl?.title || v.title || slugVal

                            const romSig = isGapAgreement
                                ? gapRomSignature || v.romSignatureURL || v.romSignatureUrl || ''
                                : v.romSignatureURL || v.romSignatureUrl || ''
                            const romAt = isGapAgreement
                                ? toISO(gapConfirmedAt || v.romSignedAt)
                                : toISO(v.romSignedAt)
                            const acceptedAt = toISO(v.acceptedAt || v.signedAt)
                            const operationsComplete = isGapAgreement
                                ? gapOperationsConfirmed
                                : Boolean(romSig || romAt)

                            return {
                                id: s.id,
                                kind: 'agreement',
                                isOnboarding: true,
                                agreementId: slugVal,
                                participantId: ad.participantId,
                                documentName: title,
                                status: operationsComplete ? 'valid' : 'pending',
                                url: v.signedFileURL || v.signedFileUrl || v.downloadURL || v.fileURL || v.fileUrl || v.pdfUrl || v.pdfURL || v._original?.pdfUrl || v.url || '',
                                pdfPath: v.pdfPath || v.storagePath || v.filePath || v._original?.pdfPath || '',
                                uploadedAt: acceptedAt,
                                issueDate: acceptedAt,
                                programId: ad.programId || '',
                                programName: ad.programName || '',
                                departmentId: ad.departmentId || '',
                                departmentName: '',
                                romSignedBy: v.romSignedBy || v.romName || '',
                                romSignerEmail: v.romSignerEmail || v.romEmail || '',
                                romSignedAt: romAt,
                                fullyConfirmedAt: isGapAgreement
                                    ? gapOperationsConfirmed || gapConfirmedAt || v.fullyConfirmedAt || v.confirmedAt || v.finalConfirmationAt
                                    : v.fullyConfirmedAt || v.confirmedAt || v.finalConfirmationAt,
                                romSignatureUrl: romSig,
                                romSignatureURL: romSig,
                                participantSignedAt: v.participantSignedAt || v.acceptedAt || v.signedAt,
                                participantSignatureURL: v.participantSignatureURL || v.signatureURL || v.userSignatureURL,
                                gapAnalysisId: isGapAgreement ? gapRecord?.id : undefined
                            }
                        })

                        // Embedded compliance documents
                        const flatFromParticipant = Array.isArray(participantData.complianceDocuments) ? participantData.complianceDocuments : []
                        const flatFromApp = Array.isArray(ad.complianceDocuments) ? ad.complianceDocuments : []
                        const rawFlat = flatFromParticipant.length ? flatFromParticipant : flatFromApp

                        const flatDocs: ComplianceDocument[] = rawFlat.map((c: any, idx: number) => {
                            const typeStr = (c.type || c.documentName || '').toString()
                            // Records stored in complianceDocuments are uploads unless they
                            // explicitly declare agreement metadata. A title such as MOA, GAP
                            // Analysis or Pre-Incubation must not override the programme's type.
                            const storedKind = String(c.kind || c.requirementType || '').toLowerCase()
                            const isAgreement = storedKind === 'agreement' || Boolean(c.agreementId)
                            const slugVal = normalize(
                                isAgreement
                                    ? c.agreementId || `agreement-${idx}`
                                    : c.presetId || c.type || c.documentName || `doc-${idx}`
                            )

                            const romSig = c.romSignatureURL || c.romSignatureUrl || ''
                            const romAt = toISO(c.romSignedAt)

                            return {
                                id: `flat_${idx}`,
                                kind: isAgreement ? 'agreement' : 'upload',
                                isOnboarding: isAgreement || c.isOnboarding === true,
                                ...(isAgreement ? { agreementId: slugVal } : { slug: slugVal }),
                                participantId: ad.participantId,
                                documentName: typeStr || 'Document',
                                status: (c.status || (isAgreement ? 'valid' : 'pending')).toLowerCase(),
                                issueDate: c.issueDate || '',
                                expiryDate: c.expiryDate || '',
                                url: c.signedFileURL || c.signedFileUrl || c.downloadURL || c.fileURL || c.fileUrl || c.pdfUrl || c.pdfURL || c.url || '',
                                ...((c.pdfPath || c.storagePath || c.filePath) ? { pdfPath: c.pdfPath || c.storagePath || c.filePath } : {}),
                                uploadedBy: c.uploadedBy || '',
                                uploadedAt: c.uploadedAt || '',
                                lastVerifiedBy: c.lastVerifiedBy || '',
                                lastVerifiedAt: c.lastVerifiedAt || '',
                                queryReason: c.queryReason || c.reason || '',
                                queryOpen: c.queryOpen === true || (c.status || '').toLowerCase() === 'queried',
                                statusHistory: Array.isArray(c.statusHistory) ? c.statusHistory : [],
                                programId: ad.programId || '',
                                programName: ad.programName || '',
                                departmentId: c.departmentId || ad.departmentId || '',
                                departmentName: c.departmentName || '',
                                presetId: c.presetId || undefined,
                                createdBy: c.createdBy || '',
                                romSignedBy: c.romSignedBy || c.romName || '',
                                romSignerEmail: c.romSignerEmail || c.romEmail || '',
                                romSignedAt: romAt,
                                fullyConfirmedAt: c.fullyConfirmedAt || c.confirmedAt || c.finalConfirmationAt,
                                romSignatureUrl: romSig,
                                romSignatureURL: romSig
                            }
                        })

                        const resolveAgreementUrl = async (a: any): Promise<string> => {
                            const direct = a?.signedFileURL || a?.signedFileUrl || a?.downloadURL || a?.fileURL || a?.fileUrl || a?.pdfUrl || a?.pdfURL || a?._original?.pdfUrl || a?.url
                            if (direct) return direct

                            const pdfPath = a?.pdfPath || a?.storagePath || a?.filePath || a?._original?.pdfPath
                            if (typeof pdfPath === 'string' && pdfPath.trim()) {
                                const storage = getStorage()
                                return await getDownloadURL(ref(storage, pdfPath))
                            }
                            return ''
                        }

                        // FIX: pull ROM signature fields exactly like participants page does (romSignatureURL etc.)
                        const buildAgreementDocsFromSignedMap = async (
                            signedObj: Record<string, any>,
                            ad2: any
                        ): Promise<ComplianceDocument[]> => {
                            const entries = Object.entries(signedObj || {})
                            const docs: ComplianceDocument[] = []

                            for (const [key, val] of entries) {
                                const slugVal = normalize(key)
                                const isGapAgreement = slugVal === 'gap-analysis'
                                const tpl = templatesForApplication.find(
                                    t => (t.type ?? 'upload') === 'agreement' && normalize(t.agreementId || t.id) === slugVal
                                )

                                const romSig = isGapAgreement
                                    ? gapRomSignature || val?.romSignatureURL || val?.romSignatureUrl || ''
                                    : val?.romSignatureURL || val?.romSignatureUrl || ''
                                const romAt = isGapAgreement
                                    ? toISO(gapConfirmedAt || val?.romSignedAt)
                                    : toISO(val?.romSignedAt)
                                const acceptedAt = toISO(val?.acceptedAt || val?.signedAt)
                                const operationsComplete = isGapAgreement
                                    ? gapOperationsConfirmed
                                    : Boolean(romSig || romAt)

                                docs.push({
                                    id: slugVal,
                                    kind: 'agreement',
                                    isOnboarding: true,
                                    agreementId: slugVal,
                                    participantId: ad2.participantId,
                                    documentName: tpl?.title || val?.title || slugVal,
                                    status: operationsComplete ? 'valid' : 'pending',
                                    url: await resolveAgreementUrl(val),
                                    uploadedAt: acceptedAt,
                                    issueDate: acceptedAt,
                                    programId: ad2.programId || activeProgramId || '',
                                    programName: ad2.programName || '',
                                    romSignedBy: val?.romName || val?.romSignedBy || '',
                                    romSignerEmail: val?.romEmail || val?.romSignerEmail || '',
                                    romSignedAt: romAt,
                                    fullyConfirmedAt: isGapAgreement
                                        ? gapOperationsConfirmed || gapConfirmedAt || val?.fullyConfirmedAt || val?.confirmedAt || val?.finalConfirmationAt
                                        : val?.fullyConfirmedAt || val?.confirmedAt || val?.finalConfirmationAt,
                                    romSignatureUrl: romSig,
                                    romSignatureURL: romSig,
                                    participantSignedAt: val?.participantSignedAt || val?.acceptedAt || val?.signedAt,
                                    participantSignatureURL:
                                        val?.participantSignatureURL ||
                                        val?.signatureURL ||
                                        val?.userSignatureURL ||
                                        val?.signer?.signatureURL,
                                    gapAnalysisId: isGapAgreement ? gapRecord?.id : undefined
                                })
                            }

                            return docs
                        }

                        const signedMap = ad?.signedAgreements || participantData?.signedAgreements || {}
                        const signedAgreementDocs = await buildAgreementDocsFromSignedMap(signedMap, ad)

                        const agreementSources: ComplianceDocument[] = [
                            ...flatDocs,
                            ...uploads,
                            ...agreements,
                            ...signedAgreementDocs
                        ]
                        const hasGapAgreement = agreementSources.some(document =>
                            document.kind === 'agreement' &&
                            normalize(document.agreementId || document.documentName) === 'gap-analysis'
                        )

                        // Older GAP submissions predate the agreement subcollection.
                        // The application and gapAnalysis record still prove that the SME
                        // completed its step, so expose that lifecycle state to Operations.
                        if (!manuallyCreated && gapCompleted && !hasGapAgreement) {
                            const submittedAt = toISO(
                                ad.gapSubmittedAt || gapRecord?.submittedAt || gapRecord?.completedAt
                            )
                            const confirmedAt = toISO(gapConfirmedAt)
                            agreementSources.push({
                                id: gapRecord?.id || 'gap-analysis',
                                kind: 'agreement',
                                isOnboarding: true,
                                agreementId: 'gap-analysis',
                                participantId: ad.participantId,
                                documentName: 'Gap Analysis',
                                status: gapOperationsConfirmed ? 'valid' : 'pending',
                                uploadedAt: submittedAt,
                                issueDate: submittedAt,
                                programId: ad.programId || '',
                                programName: ad.programName || '',
                                romSignedAt: confirmedAt,
                                romSignatureUrl: gapRomSignature,
                                romSignatureURL: gapRomSignature,
                                fullyConfirmedAt: gapOperationsConfirmed || gapConfirmedAt || undefined,
                                participantSignedAt: submittedAt,
                                participantSignatureURL: gapRecord?.signatures?.smmeSignatureUrl || '',
                                gapAnalysisId: gapRecord?.id
                            })
                        }

                        const combinedDocs = agreementSources
                            .map(document => manuallyCreated && document.kind === 'agreement'
                                ? {
                                    ...document,
                                    kind: 'upload' as const,
                                    slug: document.agreementId || document.slug || document.id,
                                    presetId: document.agreementId || document.presetId || document.id,
                                    agreementId: undefined,
                                    isOnboarding: false
                                }
                                : document)

                        return {
                            id: appId,
                            participantId: ad.participantId,
                            email: ad.email,
                            branchId,
                            branchName: branchId ? branchMap[branchId] || 'Unknown Branch' : '—',
                            gapGroup: ad.gapGroup || '—',
                            programId: ad.programId,
                            programName: ad.programName || programNamesById[ad.programId] || ad.programId || '—',
                            manuallyCreated,
                            manualApplication: manuallyCreated,
                            signedAgreements: signedMap,
                            complianceDocuments: combinedDocs
                        }
                    })
                )

                setParticipants(Object.values(partMap) as any[])
                setApps(rowsData)
            } finally {
                setLoading(false)
            }
        }
        run()
    }, [activeProgramId, isAllPrograms, programTemplates, currentUser?.departmentId, isRequirementVisibleToDepartment])

    const metrics = useMemo(() => {
        const participantsInScope = participants.filter(p => {
            const a = appByParticipant[p.id]
            return a && (!activeProgramId || a.programId === activeProgramId)
        })

        let totalNeed = 0
        let uploaded = 0
        let valid = 0
        let pending = 0
        let expired = 0
        let queried = 0

        participantsInScope.forEach(p => {
            const participantRequirements = requirementsForPart(p.id)
            const reqKeys = new Set(participantRequirements.map(keyForReq))
            totalNeed += reqKeys.size
            const docs = docsForPart(p.id)
            const relevant = docs.filter(d => reqKeys.has(keyForDoc(d)))

            uploaded += new Set(relevant.map(keyForDoc)).size

            relevant.forEach(d => {
                const req = participantRequirements.find(r => keyForReq(r) === keyForDoc(d))
                const s = deriveStatus(d, req)
                if (complianceStatusCountsAsCovered(s)) valid += 1
                else if (s === 'pending') pending += 1
                else if (s === 'expired') expired += 1
                else if (s === 'invalid' || s === 'queried') queried += 1
            })
        })

        return {
            totalNeed,
            needPer: participantsInScope.length
                ? Math.round((totalNeed / participantsInScope.length) * 10) / 10
                : 0,
            uploaded,
            missing: Math.max(totalNeed - uploaded, 0),
            valid,
            pending,
            expired,
            queried,
            participants: participantsInScope.length
        }
    }, [participants, appByParticipant, activeProgramId, docsForPart, requirementsForPart])

    const rows = useMemo(() => {
        const base = participants
            .filter(p => appByParticipant[p.id])
            .map(p => {
                const app = appByParticipant[p.id]
                const cov = coverageForPart(p.id)

                return {
                    key: p.id,
                    participantId: p.id,
                    participantName: p.beneficiaryName || p.name || p.email || 'Unknown',
                    branchName: app?.branchName ?? '—',
                    programName: app?.programName ?? '—',
                    gapGroup: app?.gapGroup ?? '—',
                    coverage: cov.have,
                    required: cov.need,
                    status: cov.status
                }
            })
            .filter(r => !searchText || (r.participantName || '').toLowerCase().includes(searchText.toLowerCase()))

        return base.sort((a, b) => a.coverage / (a.required || 1) - b.coverage / (b.required || 1))
    }, [participants, appByParticipant, coverageForPart, searchText])

    const updateAppDocs = async (participantId: string, updater: (docs: ComplianceDocument[]) => ComplianceDocument[]) => {
        const app = appByParticipant[participantId]
        if (!app) return
        const updated = updater(app.complianceDocuments || [])
        await updateDoc(doc(db, 'applications', app.id), { complianceDocuments: updated })
        setApps(prev => prev.map(a => (a.id === app.id ? { ...a, complianceDocuments: updated } : a)))
    }

    const updateSubDoc = async (appId: string, subDocId: string, payload: any) => {
        await updateDoc(doc(db, 'applications', appId, 'complianceDocuments', subDocId), payload)
    }

    const verifyDoc = async (participantId: string, docKey: string, subDocId?: string) => {
        const app = appByParticipant[participantId]
        if (!app) return

        const docs = docsForPart(participantId)
        const d = docs.find(x => keyForDoc(x) === docKey)

        if ((d?.status || '').toLowerCase() === 'queried') {
            message.error('You cannot validate while there is an open query. Resolve it first.')
            return
        }

        const by = currentUser?.name || currentUser?.email || 'Verifier'
        const atISO = new Date().toISOString()

        if (subDocId) {
            await updateSubDoc(app.id, subDocId, {
                status: 'valid',
                queryOpen: false,
                lastVerifiedBy: by,
                lastVerifiedAt: serverTimestamp(),
                statusHistory: pushHistory(d, { status: 'valid', by, atISO })
            })
        }

        await updateAppDocs(participantId, prev =>
            (prev || []).map(x =>
                keyForDoc(x) === docKey && (!activeProgramId || x.programId === activeProgramId)
                    ? {
                        ...x,
                        status: 'valid',
                        queryOpen: false,
                        lastVerifiedBy: by,
                        lastVerifiedAt: atISO,
                        statusHistory: pushHistory(x, { status: 'valid', by, atISO })
                    }
                    : x
            )
        )

        message.success('Document verified.')
    }

    // Only patches local + the embedded `complianceDocuments` array (same
    // dual-storage sync verifyDoc/updateDocStatus already do) — the AI
    // backend has already written the canonical subcollection doc itself.
    const applyAiVerificationResult = (
        participantId: string,
        docKey: string,
        result: { status: string; note: string }
    ) => {
        const atISO = new Date().toISOString()

        return updateAppDocs(participantId, prev =>
            (prev || []).map(x =>
                keyForDoc(x) === docKey && (!activeProgramId || x.programId === activeProgramId)
                    ? {
                        ...x,
                        status: result.status,
                        statusHistory: pushHistory(x, {
                            status: result.status as StatusHistoryItem['status'],
                            by: 'AI Compliance Check',
                            atISO,
                            note: result.note
                        })
                    }
                    : x
            )
        )
    }

    const runAiVerification = async (participantId: string, docKey: string, subDocId: string) => {
        const app = appByParticipant[participantId]
        if (!app) return

        setAiVerifyingDocIds(prev => ({ ...prev, [subDocId]: true }))
        try {
            const result = await verifyComplianceDocument(app.id, subDocId)
            await applyAiVerificationResult(participantId, docKey, result)
            message.success(
                `AI verification: ${complianceStatusLabel(result.status)}${result.note ? ` — ${result.note}` : ''}`
            )
        } catch (error: any) {
            message.error(error?.message || 'AI verification failed.')
        } finally {
            setAiVerifyingDocIds(prev => {
                const next = { ...prev }
                delete next[subDocId]
                return next
            })
        }
    }

    type LocalVerifyJob = BatchVerifyTarget & { participantId: string; docKey: string }

    const collectVerifiableDocs = (participantIds: string[]): LocalVerifyJob[] => {
        const jobs: LocalVerifyJob[] = []
        participantIds.forEach(participantId => {
            const app = appByParticipant[participantId]
            if (!app) return
            const docs = docsForPart(participantId)
            requirementsForPart(participantId)
                .filter(req => (req.type ?? 'upload') === 'upload')
                .forEach(req => {
                    const k = keyForReq(req)
                    const d = docs.find(document => keyForDoc(document) === k)
                    // "flat_"-prefixed ids only exist in the embedded array, not
                    // as a real subcollection doc — the AI backend can't look
                    // those up, so skip them.
                    if (!d || !d.url || d.id.startsWith('flat_')) return
                    jobs.push({
                        applicationId: app.id,
                        documentId: d.id,
                        participantId,
                        docKey: k,
                        label: req.title
                    })
                })
        })
        return jobs
    }

    const runBatchVerification = async (participantIds: string[], scopeLabel: string) => {
        const jobs = collectVerifiableDocs(participantIds)
        if (!jobs.length) {
            message.info('No uploaded documents to verify.')
            return
        }

        setAiBatchRunning(true)
        setAiBatchProgress({ done: 0, total: jobs.length })

        try {
            const outcomes = await verifyComplianceDocumentsBatch(jobs, {
                concurrency: 2,
                onProgress: (done, total) => setAiBatchProgress({ done, total })
            })

            for (let i = 0; i < outcomes.length; i++) {
                const outcome = outcomes[i]
                const job = jobs[i]
                if (outcome.ok && outcome.status) {
                    await applyAiVerificationResult(job.participantId, job.docKey, {
                        status: outcome.status,
                        note: outcome.note || ''
                    })
                }
            }

            const succeeded = outcomes.filter(o => o.ok).length
            const failed = outcomes.length - succeeded
            message.success(
                `AI verification complete for ${scopeLabel}: ${succeeded} checked${failed ? `, ${failed} failed` : ''}.`
            )
        } catch (error: any) {
            message.error(error?.message || 'Batch AI verification failed.')
        } finally {
            setAiBatchRunning(false)
            setAiBatchProgress(null)
        }
    }

    const updateDocStatus = async (
        participantId: string,
        docKey: string,
        newStatus: 'invalid' | 'queried' | 'valid',
        reason?: string,
        subDocId?: string
    ) => {
        const app = appByParticipant[participantId]
        if (!app) return

        const docs = docsForPart(participantId)
        const d = docs.find(x => keyForDoc(x) === docKey)

        const by = currentUser?.name || currentUser?.email || 'Verifier'
        const atISO = new Date().toISOString()
        const historyEntry: StatusHistoryItem =
            newStatus === 'valid'
                ? { status: 'valid', by, atISO }
                : { status: newStatus, reason: reason || '', by, atISO }

        if (subDocId) {
            const payload: any = {
                status: newStatus,
                queryOpen: newStatus === 'queried',
                lastVerifiedBy: by,
                lastVerifiedAt: serverTimestamp(),
                statusHistory: pushHistory(d, historyEntry)
            }
            if (reason) payload.queryReason = reason
            await updateSubDoc(app.id, subDocId, payload)
        }

        await updateAppDocs(participantId, prev =>
            (prev || []).map(x =>
                keyForDoc(x) === docKey && (!activeProgramId || x.programId === activeProgramId)
                    ? {
                        ...x,
                        status: newStatus,
                        queryOpen: newStatus === 'queried',
                        queryReason: reason ?? x.queryReason,
                        lastVerifiedBy: by,
                        lastVerifiedAt: atISO,
                        statusHistory: pushHistory(x, historyEntry)
                    }
                    : x
            )
        )
    }

    const resolveQuery = async (participantId: string, docKey: string, subDocId?: string) => {
        const app = appByParticipant[participantId]
        if (!app) return

        const docs = docsForPart(participantId)
        const d = docs.find(x => keyForDoc(x) === docKey)
        if (!d || (d.status || '').toLowerCase() !== 'queried') return

        const by = currentUser?.name || currentUser?.email || 'Verifier'
        const atISO = new Date().toISOString()
        const historyEntry: StatusHistoryItem = { status: 'resolved', by, atISO }

        if (subDocId) {
            await updateSubDoc(app.id, subDocId, {
                status: 'pending',
                queryOpen: false,
                lastVerifiedBy: by,
                lastVerifiedAt: serverTimestamp(),
                statusHistory: pushHistory(d, historyEntry)
            })
        }

        await updateAppDocs(participantId, prev =>
            (prev || []).map(x =>
                keyForDoc(x) === docKey && (!activeProgramId || x.programId === activeProgramId)
                    ? {
                        ...x,
                        status: 'pending',
                        queryOpen: false,
                        lastVerifiedBy: by,
                        lastVerifiedAt: atISO,
                        statusHistory: pushHistory(x, historyEntry)
                    }
                    : x
            )
        )

        message.success('Query resolved. Document is back to pending.')
    }

    const uploadProps: UploadProps = {
        beforeUpload: () => false,
        showUploadList: true,
        maxCount: 1
    }

    const resolveDocUrl = async (d: any) => {
        const direct = d?.signedFileURL || d?.signedFileUrl || d?.downloadURL || d?.fileURL ||
            d?.fileUrl || d?.pdfUrl || d?.pdfURL || d?._original?.pdfUrl || d?.url
        const path = d?.pdfPath || d?.storagePath || d?.filePath || d?._original?.pdfPath
        if (direct && !String(direct).startsWith('gs://')) return direct
        const storageValue = String(direct || path || '').trim()
        if (!storageValue) return ''
        try {
            return await getDownloadURL(ref(getStorage(), storageValue))
        } catch (error) {
            console.error('Could not resolve compliance document URL', error)
            return ''
        }
    }

    const hasOpenableFile = (d?: any) => Boolean(
        d?.signedFileURL || d?.signedFileUrl || d?.downloadURL || d?.fileURL || d?.fileUrl ||
        d?.pdfUrl || d?.pdfURL || d?._original?.pdfUrl || d?.url || d?.pdfPath ||
        d?.storagePath || d?.filePath || d?._original?.pdfPath
    )

    const downloadDocument = async (documentRecord: ComplianceDocument, fallbackTitle?: string) => {
        const url = await resolveDocUrl(documentRecord)
        if (!url) {
            message.warning('No downloadable file is available for this document.')
            return
        }

        const title = fallbackTitle || documentRecord.documentName || 'compliance-document'
        const cleanTitle = title.trim().replace(/[^a-z0-9._-]+/gi, '_') || 'compliance-document'
        const urlWithoutQuery = url.split('?')[0]
        const extensionMatch = urlWithoutQuery.match(/\.[a-z0-9]{2,5}$/i)
        const filename = extensionMatch && !cleanTitle.toLowerCase().endsWith(extensionMatch[0].toLowerCase())
            ? `${cleanTitle}${extensionMatch[0]}`
            : cleanTitle
        const anchor = document.createElement('a')
        anchor.href = url
        anchor.download = filename
        anchor.target = '_blank'
        anchor.rel = 'noopener noreferrer'
        document.body.appendChild(anchor)
        anchor.click()
        document.body.removeChild(anchor)
    }

    const uploadPresets = useMemo(() => {
        return (visibleProgramTemplates || [])
            .filter(p => (p.type ?? 'upload') === 'upload')
            .map(p => ({
                id: p.id,
                title: p.title,
                isOnboarding: p.isOnboarding === true,
                hasExpiry: !!p.hasExpiry,
                expiryMonths: p.expiryMonths ?? null
            }))
    }, [visibleProgramTemplates])

    const getPresetById = (id?: string) => uploadPresets.find(p => p.id === id)

    const openUploadFor = (participant: any, requiredId?: string) => {
        setManageTarget(participant)
        setUploadOpen(true)
        setManageOpen(false)
        setLockedUploadRequirementId(requiredId || null)
        formUpload.resetFields()
        if (requiredId) formUpload.setFieldsValue({ requiredId })
    }

    const chooseRowFile = (participant: any, requiredId: string) => {
        pendingRowUpload.current = { participant, requiredId }
        rowFileInputRef.current?.click()
    }

    const handleRowFileChosen = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0]
        const pending = pendingRowUpload.current
        event.target.value = ''
        pendingRowUpload.current = null
        if (!file || !pending) return

        setManageTarget(pending.participant)
        setLockedUploadRequirementId(pending.requiredId)
        formUpload.resetFields()
        formUpload.setFieldsValue({
            requiredId: pending.requiredId,
            file: {
                fileList: [{
                    uid: `staff-upload-${Date.now()}`,
                    name: file.name,
                    status: 'done',
                    originFileObj: file
                }]
            }
        })
        setUploadOpen(true)
    }

    const handleUploadOnBehalf = async (vals: any) => {
        const pId = manageTarget?.participantId
        const app = appByParticipant[pId]
        if (!app) return message.error('Application not found.')
        const targetProgramId = app.programId || activeProgramId
        if (!targetProgramId) return message.error('The SME application has no program assigned.')

        const fileList = vals.file?.fileList || []
        if (!vals.requiredId) return message.error('Select a required document.')
        if (fileList.length === 0) return message.error('Attach a file.')

        const req = requirementsForPart(pId).find(r => r.id === vals.requiredId)
        if (!req || (req.type ?? 'upload') === 'agreement') {
            return message.error('Invalid document selection.')
        }

        const documentKey = keyForReq(req)
        const existingDoc = docsForPart(pId).find(document => keyForDoc(document) === documentKey)
        const existingState = existingDoc ? deriveStatus(existingDoc, req) : 'missing'
        const isReplacement = Boolean(existingDoc)

        const f = fileList[0].originFileObj as File
        const storageRef2 = ref(storage, `compliance-documents/${Date.now()}-${f.name}`)
        const task = uploadBytesResumable(storageRef2, f)

        const url: string = await new Promise((resolve, reject) => {
            task.on('state_changed', () => { }, reject, async () => resolve(await getDownloadURL(task.snapshot.ref)))
        })

        const issueISO = vals.issueDate ? dayjs(vals.issueDate) : null
        let expiryISO = ''
        if (req.hasExpiry) {
            if (issueISO && req.expiryMonths) expiryISO = issueISO.add(req.expiryMonths, 'month').format('YYYY-MM-DD')
            else if (vals.expiryDate) expiryISO = dayjs(vals.expiryDate).format('YYYY-MM-DD')
        }

        const slug = req.id
        const uploadedAtISO = new Date().toISOString()
        const uploadedBy = currentUser?.name || currentUser?.email || 'User'
        const nextHistory = pushHistory(existingDoc, {
            status: 'pending',
            reason: isReplacement
                ? `Document replaced on behalf of the SME. Previous status: ${complianceStatusLabel(existingState)}.`
                : 'Document uploaded on behalf of the SME.',
            by: uploadedBy,
            atISO: uploadedAtISO
        })

        const baseSubDoc: any = {
            programId: targetProgramId,
            isOnboarding: req.isOnboarding === true,
            slug,
            presetId: slug,
            documentName: req.title,
            status: 'pending',
            issueDate: issueISO ? issueISO.format('YYYY-MM-DD') : '',
            expiryDate: expiryISO,
            url,
            uploadedBy,
            uploadedAt: uploadedAtISO,
            departmentId: currentUser?.departmentId || '',
            departmentName: departmentInfo?.name || currentUser?.department || '',
            createdBy: currentUser?.email || '',
            queryOpen: false,
            queryReason: '',
            statusHistory: nextHistory,
            ...(isReplacement
                ? {
                    replacedAt: uploadedAtISO,
                    replacedBy: uploadedBy,
                    replacedFromStatus: existingState,
                    previousFileUrl: existingDoc?.url || ''
                }
                : {})
        }

        let documentId = existingDoc?.id || ''
        const existingIsSubcollectionDoc = Boolean(existingDoc && !existingDoc.id.startsWith('flat_'))

        if (isReplacement && existingIsSubcollectionDoc) {
            await setDoc(
                doc(db, 'applications', app.id, 'complianceDocuments', existingDoc!.id),
                baseSubDoc,
                { merge: true }
            )
            documentId = existingDoc!.id
        } else {
            const created = await addDoc(collection(db, 'applications', app.id, 'complianceDocuments'), baseSubDoc)
            documentId = created.id
        }

        const newDoc: ComplianceDocument = {
            id: documentId,
            programId: targetProgramId,
            kind: 'upload',
            isOnboarding: req.isOnboarding === true,
            slug,
            participantId: pId,
            documentName: req.title,
            status: 'pending',
            issueDate: issueISO ? issueISO.format('YYYY-MM-DD') : '',
            expiryDate: expiryISO,
            url,
            uploadedBy,
            uploadedAt: uploadedAtISO,
            presetId: slug,
            createdBy: currentUser?.email || '',
            queryOpen: false,
            queryReason: '',
            statusHistory: nextHistory
        }

        await updateAppDocs(pId, prev => {
            const base = Array.isArray(prev) ? prev.slice() : []
            const filtered = base.filter(
                document => !(keyForDoc(document) === documentKey && document.programId === targetProgramId)
            )
            return [...filtered, newDoc]
        })

        setUploadOpen(false)
        setLockedUploadRequirementId(null)
        formUpload.resetFields()
        message.success(isReplacement
            ? 'Document replaced and returned to awaiting verification.'
            : 'Document uploaded and sent for verification.')

        // Auto-run AI verification in the background — don't block the upload
        // success message on it, it just updates status when it lands.
        void runAiVerification(pId, documentKey, documentId)
    }

    // Keep the embedded status and canonical agreement document in sync.
    const handleRomSign = async (vals: any) => {
        if (!romSignTarget) return
        const { participantId, agreementId } = romSignTarget
        const app = appByParticipant[participantId]
        if (!app) return message.error('Application not found.')

        try {
            setRomSigning(true)

            const romSignatureFromProfile = currentUser?.signatureURL || user?.signatureURL
            if (!romSignatureFromProfile) {
                message.error('No saved signature found for your account.')
                return
            }

            const romName = vals.romSignedBy || currentUser?.name || 'ROM'
            const romEmail = currentUser?.email || ''
            const nowISO = new Date().toISOString()

            // 1) Update the *participants-style* signedAgreements map
            // (this is what makes the Participants page show "ROM Signed") :contentReference[oaicite:2]{index=2}
            const signedKey = agreementId
            const signedPath = `signedAgreements.${signedKey}`

            const signedAgreementPatch: any = {
                agreementId,
                romName,
                romSignedBy: romName,
                romEmail,
                romSignerEmail: romEmail,
                romSignedAt: serverTimestamp(),
                romSignatureURL: romSignatureFromProfile,
                romSignatureUrl: romSignatureFromProfile
            }

            await updateDoc(doc(db, 'applications', app.id), {
                [signedPath]: {
                    ...(app.signedAgreements?.[signedKey] || {}),
                    ...signedAgreementPatch
                }
            })

            // 2) Update the canonical agreement document.
            await setDoc(doc(db, 'applications', app.id, 'agreements', agreementId), {
                agreementId,
                romSignedBy: romName,
                romSignerEmail: romEmail,
                romSignedAt: serverTimestamp(),
                romSignatureURL: romSignatureFromProfile,
                romSignatureUrl: romSignatureFromProfile
            }, { merge: true })

            // 3) Local state update
            setApps(prev =>
                prev.map(a => {
                    if (a.id !== app.id) return a
                    const nextSigned = {
                        ...(a.signedAgreements || {}),
                        [signedKey]: {
                            ...(a.signedAgreements?.[signedKey] || {}),
                            ...signedAgreementPatch,
                            romSignedAt: nowISO
                        }
                    }
                    const nextDocs = (a.complianceDocuments || []).map(d =>
                        d.kind === 'agreement' && normalize(d.agreementId) === normalize(agreementId)
                            ? {
                                ...d,
                                romSignedBy: romName,
                                romSignerEmail: romEmail,
                                romSignedAt: nowISO,
                                romSignatureURL: romSignatureFromProfile,
                                romSignatureUrl: romSignatureFromProfile
                            }
                            : d
                    )

                    return { ...a, signedAgreements: nextSigned, complianceDocuments: nextDocs }
                })
            )

            message.success('Agreement signed with your saved signature.')
            setRomSignOpen(false)
            setRomSignTarget(null)
            romSignForm.resetFields()
        } catch (e) {
            console.error(e)
            message.error('Failed to sign agreement.')
        } finally {
            setRomSigning(false)
        }
    }

    const handleSendReminders = async () => {
        const remindersByEmail: Record<string, {
            email: string
            name: string
            issues: string[]
            participantId: string
            programId: string
            programName: string
        }> = {}
        const participantsWithApp = participants.filter(p => appByParticipant[p.id])

        participantsWithApp.forEach(p => {
            const pid = p.id
            const app = appByParticipant[pid]
            const docs = docsForPart(pid)

            requirementsForPart(pid).forEach(r => {
                const k = keyForReq(r)
                const document = docs.find(item => keyForDoc(item) === k)
                const status = document ? deriveStatus(document, r) : 'missing'
                if (!complianceStatusCountsAsCovered(status)) {
                    const email = p.email || app?.email
                    if (!email) return
                    const reminderProgramId = app?.programId || activeProgramId || ''
                    if (!reminderProgramId) return
                    const name = p.beneficiaryName || p.name || app?.email || 'Participant'
                    const reminderKey = `${email}:${reminderProgramId}`
                    if (!remindersByEmail[reminderKey]) {
                        remindersByEmail[reminderKey] = {
                            email,
                            name,
                            issues: [],
                            participantId: pid,
                            programId: reminderProgramId,
                            programName: app?.programName || programName
                        }
                    }
                    remindersByEmail[reminderKey].issues.push(`${r.title} (${complianceStatusLabel(status)})`)
                }
            })
        })

        const entries = Object.entries(remindersByEmail)
        if (entries.length === 0) {
            message.info('All good — no reminders needed for this program.')
            return
        }

        const sendReminder = httpsCallable(functions, 'sendComplianceReminderEmail')

        await Promise.all(
            entries.map(async ([, { email, name, issues, participantId, programId, programName: reminderProgramName }]) => {
                try {
                    await sendReminder({
                        email,
                        name,
                        issues,
                        programName: reminderProgramName,
                        participantId,
                        programId
                    })
                    message.success(`Reminder sent to ${name}`)
                } catch (e) {
                    console.error(e)
                    message.error(`Failed to send to ${name}`)
                }
            })
        )
    }

    const renderManageList = () => {
        if (!manageTarget) return null
        const pId = manageTarget.participantId
        const docs = docsForPart(pId)
        const docMap = new Map<string, ComplianceDocument>()
        docs.forEach(d => {
            const key = keyForDoc(d)
            const existing = docMap.get(key)
            docMap.set(key, existing ? {
                ...existing,
                ...d,
                url: d.url || existing.url,
                pdfPath: d.pdfPath || existing.pdfPath,
                storagePath: d.storagePath || existing.storagePath,
                issueDate: d.issueDate || existing.issueDate,
                uploadedAt: d.uploadedAt || existing.uploadedAt,
                romSignedAt: d.romSignedAt || existing.romSignedAt,
                fullyConfirmedAt: d.fullyConfirmedAt || existing.fullyConfirmedAt
            } : d)
        })

        const app = appByParticipant[pId]
        const isManualApp = app?.manuallyCreated === true || app?.manualApplication === true

        const data = requirementsForPart(pId).map(req => {
            const k = keyForReq(req)
            const d = docMap.get(k)
            const computedExpiry = d ? computeExpiryDate(d, req) : null
            const state = d ? deriveStatus(d, req) : 'missing'
            return { req, d, k, computedExpiry, state }
        })

        if (screens.md) {
            const columnsLocal: ColumnType<any>[] = [
                { title: 'Document', key: 'doc', render: (_, r) => r.req.title },
                {
                    title: 'Expiry',
                    key: 'exp',
                    render: (_, r) => expiryDisplay(r.d, r.req, r.computedExpiry)
                },
                {
                    title: 'Actions',
                    key: 'actions',
                    width: 520,
                    render: (_, r) => {
                        const d = r.d as ComplianceDocument | undefined
                        const isAgreement = (r.req.type ?? 'upload') === 'agreement'
                        const isGapAgreement = normalize(r.req.agreementId || r.req.id) === 'gap-analysis'
                        const isQueried = (d?.status || '').toLowerCase() === 'queried'
                        const isInvalid = r.state === 'invalid'
                        const romSigned = isRomSigned(d || null)

                        return (
                            <Space style={{ whiteSpace: 'nowrap' }}>
                                {(hasOpenableFile(d) || (d && isAgreement && isPreIncubation(r.req, d))) && (
                                    <Button
                                        onClick={async () => {
                                            const u = await resolveDocUrl(d)
                                            if (u) {
                                                window.open(u, '_blank', 'noopener,noreferrer')
                                                return
                                            }
                                            if (isPreIncubation(r.req, d)) {
                                                setPreIncViewer({ participantId: pId, meta: d })
                                                return
                                            }
                                            message.warning('No document available.')
                                        }}
                                        icon={<EyeOutlined />}
                                    >
                                        View
                                    </Button>
                                )}

                                {d && hasOpenableFile(d) && (
                                    <Button
                                        data-guide='download-document-action'
                                        icon={<DownloadOutlined />}
                                        onClick={() => downloadDocument(d, r.req.title)}
                                    >
                                        Download
                                    </Button>
                                )}

                                {(r.req.type ?? 'upload') === 'upload' && (
                                    <Button
                                        data-guide='upload-document-action'
                                        type={d ? 'default' : 'primary'}
                                        icon={<UploadOutlined />}
                                        onClick={() => chooseRowFile(manageTarget, r.req.id)}
                                    >
                                        {d ? 'Replace' : 'Upload'}
                                    </Button>
                                )}

                                {isAgreement && !d && (
                                    <Tag color='orange'>
                                        {isGapAgreement ? 'Awaiting SME completion' : 'Awaiting SME signature'}
                                    </Tag>
                                )}

                                {d && (r.req.type ?? 'upload') === 'upload' && (
                                    <>
                                        <Tooltip
                                            title={
                                                isQueried
                                                    ? 'Resolve the query before you can validate.'
                                                    : isInvalid
                                                        ? 'Replace the invalid document before you can validate it.'
                                                        : undefined
                                            }
                                        >
                                            <Button
                                                data-guide='verify-document-action'
                                                icon={<CheckCircleOutlined />}
                                                disabled={isQueried || isInvalid}
                                                onClick={() => verifyDoc(pId, r.k, d.id)}
                                            >
                                                Verify
                                            </Button>
                                        </Tooltip>

                                        <Tooltip
                                            title={
                                                d.id.startsWith('flat_')
                                                    ? 'Re-save this document before AI verification is available.'
                                                    : 'Have AI check legibility, document type, and expiry.'
                                            }
                                        >
                                            <Button
                                                data-guide='verify-document-action'
                                                icon={<RobotOutlined />}
                                                disabled={d.id.startsWith('flat_') || !!aiVerifyingDocIds[d.id]}
                                                loading={!!aiVerifyingDocIds[d.id]}
                                                onClick={() => runAiVerification(pId, r.k, d.id)}
                                            >
                                                AI Verify
                                            </Button>
                                        </Tooltip>

                                        {isQueried ? (
                                            <>
                                                <Button
                                                    icon={<InfoCircleOutlined />}
                                                    onClick={() => {
                                                        setViewReason({
                                                            title: d.documentName,
                                                            queryReason: d.queryReason || 'No reason recorded.'
                                                        })
                                                        setViewReasonOpen(true)
                                                    }}
                                                >
                                                    Reason
                                                </Button>
                                                <Button onClick={() => resolveQuery(pId, r.k, d.id)}>Resolve</Button>
                                            </>
                                        ) : (
                                            <Button
                                                data-guide='invalidate-document-action'
                                                danger
                                                icon={<CloseCircleOutlined />}
                                                onClick={() => {
                                                    setReasonContext({ participantId: pId, docKey: r.k, subDocId: d?.id })
                                                    setReasonStatus('invalid')
                                                    reasonForm.resetFields()
                                                    setReasonOpen(true)
                                                }}
                                            >
                                                Invalidate
                                            </Button>
                                        )}
                                    </>
                                )}

                                {isAgreement && r.d && !isManualApp && (
                                    <>
                                        {romSigned ? (
                                            <Tag icon={<SafetyCertificateOutlined />} color='green'>
                                                {isGapAgreement ? 'Operations Confirmed' : 'ROM Signed'}
                                            </Tag>
                                        ) : (
                                            <Tag color='orange'>
                                                {isGapAgreement ? 'Awaiting Operations confirmation' : 'Awaiting Operations signature'}
                                            </Tag>
                                        )}

                                        {!romSigned && (
                                            isGapAgreement ? (
                                                canSeeOnboardingDocuments && d.gapAnalysisId && (
                                                    <Button
                                                        type='primary'
                                                        onClick={() => navigate(`/operations/gap/${d.gapAnalysisId}`)}
                                                    >
                                                        Review GAP
                                                    </Button>
                                                )
                                            ) : isROMDept ? (
                                                <Button
                                                    data-guide='rom-sign-agreement-action'
                                                    type='primary'
                                                    icon={<FileProtectOutlined />}
                                                    onClick={() => {
                                                        setRomSignTarget({
                                                            participantId: pId,
                                                            agreementId: r.req.agreementId || r.req.id
                                                        })
                                                        romSignForm.resetFields()
                                                        romSignForm.setFieldsValue({ romSignedBy: currentUser?.name || '' })
                                                        setRomSignOpen(true)
                                                    }}
                                                >
                                                    ROM Sign
                                                </Button>
                                            ) : null
                                        )}
                                    </>
                                )}
                            </Space>
                        )
                    }
                }
            ]

            return <Table rowKey={(r: any) => r.k} dataSource={data} columns={columnsLocal} pagination={false} scroll={{ x: 1050 }} />
        }

        return (
            <Space direction='vertical' style={{ width: '100%' }}>
                {data.map(r => {
                    const d = r.d as ComplianceDocument | undefined
                    const isQueried = (d?.status || '').toLowerCase() === 'queried'
                    const isInvalid = r.state === 'invalid'
                    const isAgreement = (r.req.type ?? 'upload') === 'agreement'
                    const isGapAgreement = normalize(r.req.agreementId || r.req.id) === 'gap-analysis'
                    const romSigned = isRomSigned(d || null)

                    return (
                        <Card key={r.k} size='small'>
                            <Space direction='vertical' style={{ width: '100%' }}>
                                <Space align='center' style={{ justifyContent: 'space-between', width: '100%' }}>
                                    <Text strong>{r.req.title}</Text>
                                    <Tag color={statusColor(r.state)}>{requirementStatusLabel(r.req, r.state, r.d)}</Tag>
                                </Space>

                                <Text type='secondary'>
                                    {r.req.hasExpiry
                                        ? `Expiry: ${expiryDisplay(r.d, r.req, r.computedExpiry)}`
                                        : 'No expiry'}
                                </Text>

                                <Space wrap>
                                    {(hasOpenableFile(d) || (d && isAgreement && isPreIncubation(r.req, d))) && (
                                        <Button size='small' icon={<EyeOutlined />} onClick={async () => {
                                            const u = await resolveDocUrl(d)
                                            if (u) {
                                                window.open(u, '_blank', 'noopener,noreferrer')
                                                return
                                            }
                                            if (isPreIncubation(r.req, d)) {
                                                setPreIncViewer({ participantId: manageTarget.participantId, meta: d })
                                                return
                                            }
                                            message.warning('No document available.')
                                        }}>
                                            View
                                        </Button>
                                    )}

                                    {d && hasOpenableFile(d) && (
                                        <Button
                                            data-guide='download-document-action'
                                            size='small'
                                            icon={<DownloadOutlined />}
                                            onClick={() => downloadDocument(d, r.req.title)}
                                        >
                                            Download
                                        </Button>
                                    )}

                                    {d && (r.req.type ?? 'upload') === 'upload' && (
                                        <>
                                            <Button
                                                data-guide='verify-document-action'
                                                size='small'
                                                icon={<CheckCircleOutlined />}
                                                disabled={isQueried || isInvalid}
                                                onClick={() => verifyDoc(manageTarget.participantId, r.k, d!.id)}
                                            >
                                                Verify
                                            </Button>

                                            <Button
                                                data-guide='verify-document-action'
                                                size='small'
                                                icon={<RobotOutlined />}
                                                disabled={d!.id.startsWith('flat_') || !!aiVerifyingDocIds[d!.id]}
                                                loading={!!aiVerifyingDocIds[d!.id]}
                                                onClick={() => runAiVerification(manageTarget.participantId, r.k, d!.id)}
                                            >
                                                AI Verify
                                            </Button>

                                            {isQueried ? (
                                                <>
                                                    <Button
                                                        size='small'
                                                        icon={<InfoCircleOutlined />}
                                                        onClick={() => {
                                                            setViewReason({
                                                                title: d!.documentName,
                                                                queryReason: d!.queryReason || 'No reason recorded.'
                                                            })
                                                            setViewReasonOpen(true)
                                                        }}
                                                    >
                                                        Reason
                                                    </Button>
                                                    <Button size='small' onClick={() => resolveQuery(manageTarget.participantId, r.k, d!.id)}>
                                                        Resolve
                                                    </Button>
                                                </>
                                            ) : (
                                                <Button
                                                    data-guide='invalidate-document-action'
                                                    size='small'
                                                    danger
                                                    icon={<CloseCircleOutlined />}
                                                    onClick={() => {
                                                        setReasonContext({
                                                            participantId: manageTarget.participantId,
                                                            docKey: r.k,
                                                            subDocId: d!.id
                                                        })
                                                        setReasonStatus('invalid')
                                                        reasonForm.resetFields()
                                                        setReasonOpen(true)
                                                    }}
                                                >
                                                    Invalidate
                                                </Button>
                                            )}
                                        </>
                                    )}

                                    {(r.req.type ?? 'upload') === 'upload' && (
                                        <Button
                                            data-guide='upload-document-action'
                                            size='small'
                                            type={d ? 'default' : 'primary'}
                                            icon={<UploadOutlined />}
                                            onClick={() => chooseRowFile(manageTarget, r.req.id)}
                                        >
                                            {d ? 'Replace' : 'Upload'}
                                        </Button>
                                    )}

                                    {isAgreement && !d && (
                                        <Tag color='orange'>
                                            {isGapAgreement ? 'Awaiting SME completion' : 'Awaiting SME signature'}
                                        </Tag>
                                    )}

                                    {isAgreement && !isManualApp && d && (
                                        <>
                                            {romSigned ? (
                                                <Tag icon={<SafetyCertificateOutlined />} color='green'>
                                                    {isGapAgreement ? 'Operations Confirmed' : 'ROM Signed'}
                                                </Tag>
                                            ) : (
                                                <>
                                                    <Tag color='orange'>
                                                        {isGapAgreement ? 'Awaiting Operations confirmation' : 'Awaiting Operations signature'}
                                                    </Tag>
                                                    {(isGapAgreement ? canSeeOnboardingDocuments : isROMDept) && (
                                                        isGapAgreement ? (
                                                            d.gapAnalysisId && (
                                                                <Button
                                                                    size='small'
                                                                    type='primary'
                                                                    onClick={() => navigate(`/operations/gap/${d.gapAnalysisId}`)}
                                                                >
                                                                    Review GAP
                                                                </Button>
                                                            )
                                                        ) : (
                                                            <Button
                                                                data-guide='rom-sign-agreement-action'
                                                                size='small'
                                                                type='primary'
                                                                icon={<FileProtectOutlined />}
                                                                onClick={() => {
                                                                    setRomSignTarget({ participantId: manageTarget.participantId, agreementId: r.req.agreementId || r.req.id })
                                                                    romSignForm.resetFields()
                                                                    romSignForm.setFieldsValue({ romSignedBy: currentUser?.name || '' })
                                                                    setRomSignOpen(true)
                                                                }}
                                                            >
                                                                ROM Sign
                                                            </Button>
                                                        )
                                                    )}
                                                </>
                                            )}
                                        </>
                                    )}
                                </Space>
                            </Space>
                        </Card>
                    )
                })}
            </Space>
        )
    }

    const saveRequirements = async () => {
        setSavingReqs(true)
        try {
            const draftDocuments = formReq.getFieldValue('requiredDocuments') || []
            if (!Array.isArray(draftDocuments) || draftDocuments.length === 0) {
                message.warning('Add at least one required document before saving.')
                return
            }

            const { requiredDocuments } = await formReq.validateFields()
            const pid = activeProgramId
            if (!pid || isAllPrograms) throw new Error('Select one active program before configuring documents.')
            if (!currentUser?.departmentId) throw new Error('Missing department context.')

            const list: RequiredDoc[] = (requiredDocuments || []).map((r: any) => {
                const base = mapProgramReqToRequiredDoc(r)
                const isAgreement = (r.type ?? base.type) === 'agreement'
                const out: RequiredDoc = {
                    id: base.id,
                    title: isAgreement
                        ? standardAgreementTitle(r.agreementId || base.agreementId || base.id, r.title || base.title)
                        : r.title || base.title,
                    type: isAgreement ? 'agreement' : 'upload',
                    isOnboarding: isAgreement || r.isOnboarding === true || base.isOnboarding === true,
                    hasExpiry: !!r.hasExpiry,
                    expiryMonths: r.hasExpiry ? r.expiryMonths ?? null : null
                }
                if (isAgreement) out.agreementId = r.agreementId || base.agreementId
                else out.presetId = r.presetId || base.presetId
                return out
            })

            const clean = stripUndefinedDeep({
                departmentId: currentUser.departmentId,
                departmentName: departmentInfo?.name || currentUser?.department || '',
                requiredDocuments: list,
                updatedAt: serverTimestamp()
            })

            await setDoc(doc(db, 'programs', pid, 'deptRequirements', currentUser.departmentId), clean, { merge: true })

            if (pid === activeProgramId) setDeptRequired(list)
            setReqModalOpen(false)
            message.success('Department-required documents saved.')
        } catch (e: any) {
            console.error(e)
            message.error(e?.message || 'Failed to save requirements.')
        } finally {
            setSavingReqs(false)
        }
    }

    const columns: ColumnType<any>[] = [
        {
            title: 'Participant',
            dataIndex: 'participantName',
            key: 'participantName',
            sorter: (a, b) => a.participantName.localeCompare(b.participantName)
        },
        ...(isAllPrograms
            ? [{ title: 'Program', dataIndex: 'programName', key: 'programName' } as ColumnType<any>]
            : []),
        { title: 'Group', dataIndex: 'gapGroup', key: 'gapGroup' },
        { title: 'Branch', dataIndex: 'branchName', key: 'branchName' },
        {
            title: 'Coverage',
            key: 'coverage',
            render: (_, r) => {
                const pct = r.required ? Math.round((r.coverage / r.required) * 100) : 0
                return (
                    <div style={{ minWidth: 160 }}>
                        <Text>
                            {r.coverage}/{r.required}
                        </Text>
                        <Progress percent={pct} size='small' />
                    </div>
                )
            }
        },
        {
            title: 'Actions',
            key: 'actions',
            render: (_, r) => {
                return (
                    <Space style={{ whiteSpace: 'nowrap' }}>
                        <Button
                            data-guide='manage-compliance-action'
                            icon={<FileProtectOutlined />}
                            onClick={() => {
                                setManageTarget(r)
                                setManageOpen(true)
                            }}
                        >
                            Manage
                        </Button>

                        <Button
                            data-guide='upload-compliance-action'
                            icon={<UploadOutlined />}
                            onClick={() => openUploadFor(r)}
                        >
                            Upload / Replace
                        </Button>
                    </Space>
                )
            }
        }
    ]

    const manageTargetRequirements = manageTarget
        ? requirementsForPart(manageTarget.participantId)
        : []
    const hasManageTargetUploadRequirements = manageTargetRequirements.some(
        requirement => (requirement.type ?? 'upload') === 'upload'
    )

    return (
        <div style={{ minHeight: '100vh', background: '#fff', padding: 24 }}>
            <Helmet>
                <title>Compliance Management | Smart Incubation</title>
            </Helmet>

            {loading ? (
                <LoadingOverlay tip='Loading compliance data' />
            ) : (
                <>
                    <Row data-guide='compliance-metrics' gutter={[16, 16]} style={{ marginBottom: 12 }}>
                        {[
                            { title: 'Required / Participant', value: metrics.needPer, color: '#722ed1', icon: <FileTextOutlined />, bg: '#f9f0ff' },
                            { title: 'Uploaded', value: metrics.uploaded, color: '#52c41a', icon: <SafetyCertificateOutlined />, bg: '#f6ffed' },
                            { title: 'Missing', value: metrics.missing, color: '#fa541c', icon: <WarningOutlined />, bg: '#fff2e8' },
                            { title: 'Pending', value: metrics.pending, color: '#1677ff', icon: <FileProtectOutlined />, bg: '#e6f7ff' },
                            { title: 'Expired/Invalid', value: metrics.expired + metrics.queried, color: '#f5222d', icon: <CloseCircleOutlined />, bg: '#fff2f0' }
                        ].map((m, i) => (
                            <Col
                                xs={24}
                                sm={12}
                                md={8}
                                lg={{ flex: '1 1 0' }}
                                style={{ minWidth: 0 }}
                                key={m.title}
                            >
                                <MotionCard.Metric
                                    loading={loading}
                                    icon={React.cloneElement(m.icon as any, { style: { color: m.color } })}
                                    iconBg={m.bg}
                                    title={m.title}
                                    value={m.value}
                                />
                            </Col>
                        ))}
                    </Row>

                    <MotionCard
                        filterBar={
                            <Row
                                data-guide='compliance-filters'
                                gutter={[8, 8]}
                                align='middle'
                                wrap={!screens.lg}
                                style={{ width: '100%' }}
                            >
                                <Col
                                    xs={24}
                                    md={8}
                                    flex={screens.lg ? '0 0 220px' : undefined}
                                    style={{
                                        minWidth: 0,
                                        maxWidth: screens.lg ? 220 : undefined
                                    }}
                                >
                                    <Input
                                        placeholder='Search SME…'
                                        value={searchText}
                                        onChange={e => setSearchText(e.target.value)}
                                        prefix={<SearchOutlined />}
                                        allowClear
                                    />
                                </Col>

                                <Col
                                    xs={24}
                                    md={16}
                                    flex={screens.lg ? '1 1 auto' : undefined}
                                    style={{
                                        minWidth: 0,
                                        display: 'flex',
                                        justifyContent: 'flex-end'
                                    }}
                                >
                                    <Space
                                        size={8}
                                        wrap={!screens.lg}
                                        style={{
                                            width: screens.lg ? 'auto' : '100%',
                                            justifyContent: 'flex-end'
                                        }}
                                    >
                                        <Button
                                            data-guide='email-compliance-reminders'
                                            shape='round'
                                            icon={<MailOutlined />}
                                            onClick={() => {
                                                const targets = buildEmailTargets()

                                                if (!targets.length) {
                                                    message.info(
                                                        'All good — no reminders needed for this program.'
                                                    )
                                                    return
                                                }

                                                setEmailTargets(targets)
                                                setEmailTemplatesOpen(true)
                                            }}
                                        >
                                            Email Reminders
                                        </Button>

                                        <Button
                                            data-guide='quick-compliance-reminders'
                                            shape='round'
                                            icon={<MailOutlined />}
                                            onClick={handleSendReminders}
                                        >
                                            Quick Reminders
                                        </Button>

                                        <Button
                                            data-guide='bulk-ai-compliance'
                                            shape='round'
                                            icon={<RobotOutlined />}
                                            loading={aiBatchRunning}
                                            disabled={aiBatchRunning || rows.length === 0}
                                            onClick={() => {
                                                Modal.confirm({
                                                    centered: true,
                                                    title: 'Run AI verification for all SMEs?',
                                                    content: `This checks every uploaded document across ${rows.length} SME(s) shown here. Each check may use an AI request, so this can take a while and consume shared AI quota.`,
                                                    okText: 'Run AI Verify All',
                                                    onOk: () =>
                                                        runBatchVerification(
                                                            rows.map(r => r.participantId),
                                                            'all SMEs'
                                                        )
                                                })
                                            }}
                                        >
                                            {aiBatchRunning && aiBatchProgress
                                                ? `Verifying ${aiBatchProgress.done}/${aiBatchProgress.total}…`
                                                : 'AI Verify All'}
                                        </Button>

                                        <Button
                                            data-guide='setup-compliance-documents'
                                            shape='round'
                                            icon={<SettingOutlined />}
                                            disabled={!activeProgramId || isAllPrograms}
                                            title={
                                                !activeProgramId || isAllPrograms
                                                    ? 'Select one active program to configure its documents.'
                                                    : undefined
                                            }
                                            onClick={() => {
                                                formReq.setFieldsValue({
                                                    requiredDocuments: (
                                                        deptRequired !== null
                                                            ? deptRequired.filter(
                                                                isRequirementVisibleToDepartment
                                                            )
                                                            : visibleProgramTemplates
                                                    ).map(r => ({ ...r }))
                                                })

                                                setReqModalOpen(true)
                                            }}
                                        >
                                            Setup Documents
                                        </Button>
                                    </Space>
                                </Col>
                            </Row>
                        }
                        filterBarProps={{
                            background: '#f8fafc',
                            borderColor: '#d9e8ff',
                            borderRadius: 14,
                            boxShadow: 'inset 0 2px 8px rgba(15,23,42,0.05)',
                            padding: 16
                        }}
                    >
                        <div data-guide='compliance-table'>
                            <Table
                                rowKey='key'
                                dataSource={rows}
                                columns={columns}
                                locale={{
                                    emptyText: (
                                        <Empty
                                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                                            description={isAllPrograms
                                                ? 'No participants found across the available programs.'
                                                : 'No participants found for this program.'}
                                        />
                                    )
                                }}
                                pagination={{ position: ['bottomCenter'], pageSize: 7, showSizeChanger: false }}
                            />
                        </div>
                    </MotionCard>

                    <Modal
                        className='guide-setup-compliance-modal'
                        centered
                        title='Setup Required Documents (Department)'
                        open={reqModalOpen}
                        onCancel={() => setReqModalOpen(false)}
                        width={1200}
                        styles={{ body: { maxHeight: '68vh', overflowY: 'auto', paddingRight: 8 } }}
                        footer={<div style={{ display: 'flex', gap: 12, width: '100%' }}>
                            <Button danger block style={{ flex: 1 }} onClick={() => setReqModalOpen(false)} disabled={savingReqs}>
                                Cancel
                            </Button>
                            <Button
                                className='guide-save-compliance-documents'
                                type='primary'
                                block
                                style={{ flex: 1 }}
                                onClick={saveRequirements}
                                loading={savingReqs}
                            >
                                {savingReqs ? 'Saving…' : 'Save Documents'}
                            </Button>
                        </div>}
                    >
                        <Text type='secondary'>
                            Configure the documents your department requires for this program. These drive coverage, uploads, and validation.
                        </Text>

                        <Divider />

                        <Form form={formReq} layout='vertical'>
                            <Form.List name='requiredDocuments'>
                                {(fields, { add, remove }, { errors }) => (
                                    <>
                                        <div style={{
                                            position: 'sticky',
                                            top: 0,
                                            zIndex: 5,
                                            background: '#fff',
                                            padding: '0 0 12px',
                                            marginBottom: 12,
                                            borderBottom: '1px solid #f0f0f0'
                                        }}>
                                            <Button
                                                data-guide='add-compliance-document'
                                                type='primary'
                                                block
                                                icon={<PlusOutlined />}
                                                onClick={() => add({ type: 'upload', isOnboarding: false, hasExpiry: false, expiryMonths: null })}
                                            >
                                                Add Required Document
                                            </Button>
                                        </div>
                                        {fields.map(field => (
                                            <Card key={field.key} size='small' style={{ marginBottom: 12 }}>
                                                <Row gutter={[12, 8]} align='top'>
                                                    <Col xs={24} md={5}>
                                                        <Form.Item {...field} name={[field.name, 'type']} label='Source' initialValue='upload' style={{ marginBottom: 8 }}>
                                                            <Select
                                                                options={[
                                                                    { label: 'Upload', value: 'upload' },
                                                                    ...(canSeeOnboardingDocuments
                                                                        ? [{ label: 'Agreement', value: 'agreement' }]
                                                                        : [])
                                                                ]}
                                                                onChange={val => {
                                                                    const list = formReq.getFieldValue('requiredDocuments') || []
                                                                    const row = { ...(list[field.name] || {}) }

                                                                    if (val === 'agreement') {
                                                                        delete row.presetId
                                                                        row.isOnboarding = true
                                                                    } else {
                                                                        delete row.agreementId
                                                                    }

                                                                    list[field.name] = row
                                                                    formReq.setFieldsValue({ requiredDocuments: list })
                                                                }}
                                                            />
                                                        </Form.Item>
                                                    </Col>

                                                    <Col xs={24} md={13}>
                                                        <Form.Item noStyle shouldUpdate>
                                                            {({ getFieldValue }) => {
                                                                const type = getFieldValue(['requiredDocuments', field.name, 'type']) ?? 'upload'
                                                                if (type === 'upload') {
                                                                    return (
                                                                        <Form.Item
                                                                            {...field}
                                                                            name={[field.name, 'presetId']}
                                                                            label='Document Preset'
                                                                            rules={[{ required: true, message: 'Choose a preset' }]}
                                                                            style={{ marginBottom: 8 }}
                                                                        >
                                                                            <Select
                                                                                placeholder={uploadPresets.length ? 'Pick a preset' : 'No presets for this program'}
                                                                                options={uploadPresets.map(p => ({ label: p.title, value: p.id }))}
                                                                                disabled={!uploadPresets.length}
                                                                                onChange={presetId => {
                                                                                    const preset = getPresetById(presetId)
                                                                                    const list = formReq.getFieldValue('requiredDocuments') || []
                                                                                    const row = list[field.name] || {}
                                                                                    list[field.name] = {
                                                                                        ...row,
                                                                                        presetId,
                                                                                        title: preset?.title || '',
                                                                                        isOnboarding: preset?.isOnboarding === true,
                                                                                        hasExpiry: !!preset?.hasExpiry,
                                                                                        expiryMonths: preset?.hasExpiry ? preset?.expiryMonths ?? null : null
                                                                                    }
                                                                                    formReq.setFieldsValue({ requiredDocuments: list })
                                                                                }}
                                                                            />
                                                                        </Form.Item>
                                                                    )
                                                                }

                                                                return (
                                                                    <Form.Item
                                                                        {...field}
                                                                        name={[field.name, 'agreementId']}
                                                                        label='Agreement'
                                                                        rules={[{ required: true, message: 'Select an agreement' }]}
                                                                        style={{ marginBottom: 8 }}
                                                                    >
                                                                        <Select
                                                                            placeholder='Choose agreement'
                                                                            options={visibleProgramTemplates
                                                                                .filter(t => (t.type ?? 'upload') === 'agreement')
                                                                                .map(a => ({
                                                                                    label: standardAgreementTitle(a.agreementId || a.id, a.title),
                                                                                    value: a.agreementId || a.id
                                                                                }))}
                                                                            onChange={(slugVal: string) => {
                                                                                const template = programTemplates.find(a => (a.agreementId || a.id) === slugVal)
                                                                                const list = formReq.getFieldValue('requiredDocuments') || []
                                                                                const row = list[field.name] || {}
                                                                                list[field.name] = {
                                                                                    ...row,
                                                                                    type: 'agreement',
                                                                                    agreementId: slugVal,
                                                                                    isOnboarding: true,
                                                                                    title: standardAgreementTitle(slugVal, template?.title),
                                                                                    hasExpiry: !!template?.hasExpiry,
                                                                                    expiryMonths: template?.hasExpiry ? template.expiryMonths ?? null : null
                                                                                }
                                                                                formReq.setFieldsValue({ requiredDocuments: list })
                                                                            }}
                                                                        />
                                                                    </Form.Item>
                                                                )
                                                            }}
                                                        </Form.Item>
                                                    </Col>

                                                    <Col xs={24} md={6}>
                                                        <Form.Item
                                                            {...field}
                                                            name={[field.name, 'hasExpiry']}
                                                            label='Has Expiry'
                                                            valuePropName='checked'
                                                            style={{ marginBottom: 8 }}
                                                        >
                                                            <Switch />
                                                        </Form.Item>
                                                    </Col>
                                                </Row>

                                                <Row gutter={[12, 8]} align='bottom'>
                                                    <Col xs={24} md={12}>
                                                        <Form.Item {...field} name={[field.name, 'title']} hidden>
                                                            <Input />
                                                        </Form.Item>
                                                        <Form.Item label='Title' style={{ marginBottom: 0 }}>
                                                            <Form.Item noStyle shouldUpdate>
                                                                {({ getFieldValue }) => {
                                                                    const presetId = getFieldValue(['requiredDocuments', field.name, 'presetId'])
                                                                    const fromPreset = getPresetById(presetId)?.title
                                                                    const fromState = getFieldValue(['requiredDocuments', field.name, 'title']) || ''
                                                                    return <Input readOnly value={fromPreset || fromState} />
                                                                }}
                                                            </Form.Item>
                                                        </Form.Item>
                                                    </Col>

                                                    <Col xs={24} md={8}>
                                                        <Form.Item noStyle shouldUpdate>
                                                            {({ getFieldValue }) => {
                                                                const hasExpiry = !!getFieldValue(['requiredDocuments', field.name, 'hasExpiry'])
                                                                return (
                                                                    <Form.Item
                                                                        {...field}
                                                                        name={[field.name, 'expiryMonths']}
                                                                        label='Expiry Months'
                                                                        style={{ marginBottom: 0 }}
                                                                        rules={hasExpiry ? [{ required: true, message: 'Enter months' }] : []}
                                                                    >
                                                                        <InputNumber min={1} style={{ width: '100%' }} disabled={!hasExpiry} placeholder={hasExpiry ? undefined : 'No expiry'} />
                                                                    </Form.Item>
                                                                )
                                                            }}
                                                        </Form.Item>
                                                    </Col>

                                                    <Col xs={24} md={4}>
                                                        <Form.Item label=' ' colon={false} style={{ marginBottom: 0, textAlign: 'right' }}>
                                                            <Button danger onClick={() => remove(field.name)}>
                                                                Remove
                                                            </Button>
                                                        </Form.Item>
                                                    </Col>
                                                </Row>
                                            </Card>
                                        ))}

                                        <Form.ErrorList errors={errors} />
                                    </>
                                )}
                            </Form.List>
                        </Form>
                    </Modal>

                    <input
                        ref={rowFileInputRef}
                        type='file'
                        hidden
                        accept='.pdf,.png,.jpg,.jpeg,.doc,.docx'
                        onChange={handleRowFileChosen}
                    />

                    <Modal
                        className='guide-manage-compliance-modal'
                        centered
                        open={manageOpen}
                        title={manageTarget ? `Manage: ${manageTarget.participantName}` : 'Manage compliance'}
                        onCancel={() => setManageOpen(false)}
                        footer={null}
                        width={1100}
                    >
                        <div data-guide='manage-compliance-content'>
                            {renderManageList()}
                        </div>
                    </Modal>

                    <Modal
                        className='guide-upload-compliance-modal'
                        centered
                        open={uploadOpen}
                        title={lockedUploadRequirementId
                            ? `Confirm document details — ${manageTarget?.participantName || 'SME'}`
                            : manageTarget
                                ? `Upload / Replace for ${manageTarget.participantName}`
                                : 'Upload / Replace for SME'}
                        onCancel={() => {
                            setUploadOpen(false)
                            setLockedUploadRequirementId(null)
                            formUpload.resetFields()
                        }}
                        onOk={() => formUpload.submit()}
                        okText='Save document'
                        okButtonProps={{
                            disabled: !manageTarget || !hasManageTargetUploadRequirements
                        }}
                        width={600}
                    >
                        {!manageTarget ? (
                            <Empty description='Select a participant from the table first.' />
                        ) : (
                            <Form form={formUpload} layout='vertical' onFinish={handleUploadOnBehalf}>
                                <Alert
                                    type={hasManageTargetUploadRequirements ? 'info' : 'warning'}
                                    showIcon
                                    style={{ marginBottom: 16 }}
                                    message={hasManageTargetUploadRequirements
                                        ? 'Uploading on behalf of the SME'
                                        : 'The outstanding requirements are agreements'}
                                    description={hasManageTargetUploadRequirements
                                        ? 'Choose an upload document below. If it already exists, the new file will replace it and return its status to Awaiting verification.'
                                        : 'Agreements cannot be uploaded as ordinary documents. They must be completed through the agreement signing workflow.'}
                                />
                                <Form.Item label='Required Document' name='requiredId' rules={[{ required: true, message: 'Select a document' }]}>
                                    <Select
                                        placeholder='Choose a document to upload or replace'
                                        disabled={Boolean(lockedUploadRequirementId)}
                                        options={(() => {
                                            const docs = docsForPart(manageTarget.participantId)

                                            return manageTargetRequirements.map(req => {
                                                const existing = docs.find(document => keyForDoc(document) === keyForReq(req))
                                                const state = existing ? deriveStatus(existing, req) : 'missing'

                                                if ((req.type ?? 'upload') === 'agreement') {
                                                    return {
                                                        label: `${req.title} (${requirementStatusLabel(req, state, existing)} — use signing workflow)`,
                                                        value: `agreement:${req.id}`,
                                                        disabled: true
                                                    }
                                                }

                                                return {
                                                    label: existing
                                                        ? `${req.title} (Replace — ${requirementStatusLabel(req, state, existing)})`
                                                        : `${req.title} (Upload)`,
                                                    value: req.id
                                                }
                                            })
                                        })()}
                                    />
                                </Form.Item>

                                <Form.Item label='Issue Date' name='issueDate'>
                                    <DatePicker
                                        style={{ width: '100%' }}
                                        onChange={d => {
                                            const rid = formUpload.getFieldValue('requiredId')
                                            const req = manageTargetRequirements.find(r => r.id === rid)
                                            if (d && req?.hasExpiry && req?.expiryMonths) {
                                                formUpload.setFieldsValue({ expiryDate: d.add(req.expiryMonths, 'month') })
                                            } else {
                                                formUpload.setFieldsValue({ expiryDate: undefined })
                                            }
                                        }}
                                    />
                                </Form.Item>

                                <Form.Item shouldUpdate noStyle>
                                    {({ getFieldValue }) => {
                                        const rid = getFieldValue('requiredId')
                                        const req = manageTargetRequirements.find(r => r.id === rid)
                                        if (!req?.hasExpiry) return null

                                        const issue = getFieldValue('issueDate')
                                        const months = req.expiryMonths || 0

                                        if (issue && months) {
                                            const computed = issue.add(months, 'month')
                                            return (
                                                <>
                                                    <Form.Item label='Expiry Date'>
                                                        <DatePicker style={{ width: '100%' }} value={computed} disabled />
                                                    </Form.Item>
                                                    <Text type='secondary'>
                                                        Calculated: Issue Date + {months} month{months > 1 ? 's' : ''}
                                                    </Text>
                                                </>
                                            )
                                        }

                                        return (
                                            <Form.Item label='Expiry Date' name='expiryDate' rules={[{ required: true, message: 'Pick expiry date' }]}>
                                                <DatePicker style={{ width: '100%' }} />
                                            </Form.Item>
                                        )
                                    }}
                                </Form.Item>

                                <Form.Item name='file' label='File' valuePropName='file' rules={[{ required: true, message: 'Attach a file' }]}>
                                    {lockedUploadRequirementId ? (
                                        <Upload {...uploadProps}>
                                            <Button icon={<UploadOutlined />}>Choose a different file</Button>
                                        </Upload>
                                    ) : (
                                        <Upload.Dragger {...uploadProps}>
                                            <p className='ant-upload-drag-icon'>
                                                <InboxOutlined />
                                            </p>
                                            <p className='ant-upload-text'>Click or drag file to upload</p>
                                        </Upload.Dragger>
                                    )}
                                </Form.Item>
                            </Form>
                        )}
                    </Modal>

                    <Modal
                        centered
                        open={reasonOpen}
                        title={reasonStatus === 'invalid' ? 'Invalidate document' : 'Query document'}
                        onCancel={() => {
                            setReasonOpen(false)
                            setReasonContext(null)
                            reasonForm.resetFields()
                            setReasonStatus('invalid')
                        }}
                        onOk={() => reasonForm.submit()}
                        okText='Save'
                    >
                        <Form
                            form={reasonForm}
                            layout='vertical'
                            onFinish={async vals => {
                                if (!reasonContext) return
                                await updateDocStatus(reasonContext.participantId, reasonContext.docKey, reasonStatus, vals.reason, reasonContext.subDocId)
                                message.success(reasonStatus === 'invalid' ? 'Document invalidated.' : 'Document queried.')
                                setReasonOpen(false)
                                setReasonContext(null)
                                reasonForm.resetFields()
                                setReasonStatus('invalid')
                            }}
                        >
                            <Form.Item label='Action'>
                                <Select
                                    value={reasonStatus}
                                    onChange={v => setReasonStatus(v)}
                                    options={[
                                        { label: 'Invalidate', value: 'invalid' },
                                        { label: 'Query', value: 'queried' }
                                    ]}
                                />
                            </Form.Item>
                            <Form.Item label='Reason' name='reason' rules={[{ required: true, message: 'Please provide a reason.' }]}>
                                <TextArea rows={4} placeholder='Explain what’s wrong or what’s missing…' />
                            </Form.Item>
                        </Form>
                    </Modal>

                    <Modal
                        centered
                        open={viewReasonOpen}
                        title={viewReason?.title ? `Reason — ${viewReason.title}` : 'Reason'}
                        onCancel={() => {
                            setViewReasonOpen(false)
                            setViewReason(null)
                        }}
                        footer={[
                            <Button key='close' onClick={() => setViewReasonOpen(false)}>
                                Close
                            </Button>
                        ]}
                        width={560}
                    >
                        <Typography.Paragraph style={{ whiteSpace: 'pre-wrap', marginBottom: 0 }}>
                            {viewReason?.queryReason || 'No reason recorded.'}
                        </Typography.Paragraph>
                    </Modal>

                    <Modal
                        centered
                        open={romSignOpen}
                        title='ROM Signature — Agreement'
                        onCancel={() => {
                            setRomSignOpen(false)
                            setRomSignTarget(null)
                            romSignForm.resetFields()
                        }}
                        onOk={() => romSignForm.submit()}
                        okText={romSigning ? 'Signing…' : 'Sign'}
                        confirmLoading={romSigning}
                        width={560}
                    >
                        <Form form={romSignForm} layout='vertical' onFinish={handleRomSign}>
                            <Alert
                                type='info'
                                message='This will attach your saved signature to the agreement and record the signer, email and timestamp.'
                                showIcon
                            />
                            <Form.Item name="romSignedBy" label="Signer Name" initialValue={currentUser?.name || ''}>
                                <Input />
                            </Form.Item>
                        </Form>
                    </Modal>

                    <PreIncubationContractModal
                        open={!!preIncViewer}
                        participantId={preIncViewer?.participantId || ''}
                        onClose={() => setPreIncViewer(null)}
                        onSigned={async () => undefined}
                        readOnly
                        signedMeta={preIncViewer?.meta}
                        viewerRole='operations'
                    />

                    <EmailTemplateModal
                        open={emailTempaltesOpen}
                        onClose={() => setEmailTemplatesOpen(false)}
                        allowedTemplateIds={['doc-sign-reminder', 'general-compliance-reminder']}
                        toEmail={emailTargets.map(t => t.email)}
                        defaultVars={{ programName }}
                        getIdToken={async () => {
                            const u = getAuth().currentUser
                            if (!u) throw new Error('Not signed in')
                            return u.getIdToken()
                        }}
                        sendEndpoint={
                            window.location.hostname.includes('localhost')
                                ? 'https://us-central1-lph-smart-inc.cloudfunctions.net/sendEmail'
                                : 'https://oauth.lepharosmartinc.co.za/sendEmail'
                        }
                    />
                </>
            )}
        </div>
    )
}

export default ComplianceTrackingPage
