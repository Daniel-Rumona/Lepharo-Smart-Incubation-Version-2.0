import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react'
import {
    Card,
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
    Tooltip,
    Empty,
    InputNumber,
    Alert,
    Result,
    theme,
    Radio,
    Drawer,
    Dropdown
} from 'antd'
import {
    UploadOutlined,
    TeamOutlined,
    FileSearchOutlined,
    FieldTimeOutlined,
    EyeOutlined,
    CheckCircleOutlined,
    CloseCircleOutlined,
    WarningOutlined,
    SafetyCertificateOutlined,
    FileTextOutlined,
    PlusOutlined,
    FileProtectOutlined,
    SettingOutlined,
    InboxOutlined,
    MailOutlined,
    InfoCircleOutlined,
    RobotOutlined,
    DownloadOutlined,
    EditOutlined,
    DeleteOutlined,
    MoreOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import type { UploadProps } from 'antd'
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
    arrayUnion,
    runTransaction
} from 'firebase/firestore'
import { getStorage, ref, uploadBytesResumable, getDownloadURL } from 'firebase/storage'
import { withOwner } from '@/lib/storageOwner'
import { httpsCallable } from 'firebase/functions'
import EmailTemplateModal from '@/components/modals/EmailTemplate'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useDepartmentRoles } from '@/services/departmentRoles'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { MetricTile, IconChip, type MetricTone } from '@/components/dashboards/metrics/MetricTile'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import TrainingComplianceView, { useTrainingIds } from '@/components/trainings/TrainingComplianceView'
import {
    guideTarget,
    usePageGuides,
    type PageGuideRegistration
} from '@/components/guide-me'
import {
    PreIncubationContractModal,
    downloadPreIncubationDocxFromArgs
} from '@/components/modals/Contracts/PreIncubationContract'
import { type MoaVars, saveMoaDocx } from '@/components/modals/Contracts/moa.pages'
import { exportGapDocx } from '@/utils/gapDocx'
import {
    complianceStatusCountsAsCovered,
    complianceStatusLabel,
    complianceTitleKey,
    loadDefaultProgramRequirements,
    resolveComplianceDocumentStatus,
    resolveComplianceRequirements
} from '@/services/complianceResolver'
import {
    verifyComplianceDocument,
    verifyComplianceDocumentsBatch,
    type BatchVerifyTarget,
    type ComplianceAiReview
} from '@/services/complianceVerificationService'
import { functionsBaseUrl } from '@/firebaseConfig'
import { SignatureStage, useSignaturePlayback } from '@/components/shared/SignatureAnimation'
import { ComplianceFilters } from './ComplianceFilters'
import { ComplianceList } from './ComplianceList'
import { ComplianceDetail } from './ComplianceDetail'
import {
    DEFAULT_COMPLIANCE_FILTERS,
    bucketOfState,
    currentAiReview,
    complianceSorters,
    distinctValues,
    matchesSegment,
    type ComplianceFilterState,
    type ComplianceView,
    type RequirementEntry
} from './complianceWorkspace'

const { Text } = Typography
const { TextArea } = Input

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
    /** Needed when the SME applies, before they can be considered for onboarding. */
    requiredAtApplication?: boolean
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
    // Set when the document was matched to its requirement by title: the key
    // it is stored under (see docsForPart).
    storedKey?: string
    aiReview?: ComplianceAiReview
}

type ComplianceEntry = RequirementEntry<RequiredDoc, ComplianceDocument>

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
    // Applicant details used to fill agreement downloads.
    registrationNumber?: string
    beneficiaryName?: string
    participantName?: string
    applicantName?: string
    idNumber?: string
    businessAddress?: string
    phone?: string
    directorPosition?: string
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

const keyForDoc = (d: Pick<ComplianceDocument, 'kind' | 'agreementId' | 'slug' | 'presetId' | 'documentName'>) => {
    const base = d.kind === 'agreement' ? d.agreementId || d.documentName : d.slug || d.presetId || d.documentName
    return `${d.kind ?? 'upload'}:${slugify(base)}`
}

// keyForDoc of an entry as stored in an embedded complianceDocuments array,
// derived the same way the page's load maps those entries (flatDocs, plus the
// agreement-to-upload conversion for manually created applications).
const embeddedComplianceDocKey = (item: any, idx: number, manuallyCreated = false) => {
    const storedKind = String(item?.kind || item?.requirementType || '').toLowerCase()
    const isAgreement = storedKind === 'agreement' || Boolean(item?.agreementId)
    const documentName = (item?.type || item?.documentName || '').toString() || 'Document'
    const slugVal = normalize(
        isAgreement
            ? item?.agreementId || `agreement-${idx}`
            : item?.presetId || item?.type || item?.documentName || `doc-${idx}`
    )
    if (isAgreement && !manuallyCreated) {
        return keyForDoc({ kind: 'agreement', agreementId: slugVal, documentName })
    }
    return keyForDoc({ kind: 'upload', slug: slugVal, presetId: item?.presetId || undefined, documentName })
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
            return confirmed ? 'Confirmed' : 'Awaiting ROM confirmation'
        }
        if (!documentRecord || status === 'missing') return 'Awaiting SME signature'
        if (status === 'pending') return 'Awaiting ROM signature'
    }
    return complianceStatusLabel(status)
}

// Items a reminder can ask the SME to act on. Pending means waiting on staff
// (verification, or the ROM signature on an agreement), so it is left out.
const smeCanAct = (status: string) => !complianceStatusCountsAsCovered(status) && status !== 'pending'

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
    // Same field order as normalizeComplianceRequirement in the shared resolver,
    // so both produce the same requirement key.
    const s = norm(pr.presetId || pr.key || pr.preset || pr.id || pr.title)
    const isAgreement = rawType === 'agreement' || (
        rawType !== 'upload' && (!!pr.agreementId || looksLikeAgreement(pr.title))
    )
    const hasExpiry = Boolean(pr.hasExpiry || pr.expiryRule)

    const base: RequiredDoc = {
        id: isAgreement ? pr.agreementId || s : s,
        title: isAgreement
            ? standardAgreementTitle(pr.agreementId || s, pr.title || pr.key || pr.preset)
            : pr.title || pr.key || pr.preset || 'Untitled',
        type: isAgreement ? 'agreement' : 'upload',
        isOnboarding: isAgreement || pr.isOnboarding === true,
        requiredAtApplication: pr.requiredAtApplication === true,
        hasExpiry,
        expiryMonths: hasExpiry ? pr.expiryMonths ?? pr.expiryRule?.months ?? null : null
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
                requiredAtApplication: t.mandatory === true,
                hasExpiry: !!t.expiryRule,
                expiryMonths: t.expiryRule?.months ?? null,
                presetId: isAgreement ? undefined : d.id,
                agreementId: isAgreement ? t.agreementId || d.id : undefined
            } as RequiredDoc
        })
    }

    // No list of its own: the shared default, as the resolver does.
    const defaults: ProgramRequirement[] = await loadDefaultProgramRequirements()
    return defaults.map(mapProgramReqToRequiredDoc)
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
    // The user and department docs have been read, so department scoping is settled.
    const [identityLoaded, setIdentityLoaded] = useState(false)
    const { activeProgramId, isAllPrograms } = useActiveProgramId()
    // A training picked in the programme selector shows its SMEs' uploaded
    // documents instead of programme compliance.
    const trainingIds = useTrainingIds()
    const activeTrainingId = activeProgramId && trainingIds.has(activeProgramId) ? activeProgramId : null
    const [programName, setProgramName] = useState<string>('—')
    const [departmentInfo, setDepartmentInfo] = useState<any>(null)
    const { hasRole: hasDepartmentRole, loading: departmentRolesLoading } = useDepartmentRoles()
    const { token } = theme.useToken()

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
                                description: 'SMEs grouped by who acts next: the SME, your staff, or nobody yet because a document expires soon. Counts reflect only the documents relevant to your department. Click a tile to filter the list.',
                                side: 'bottom',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('compliance-filters'),
                            popover: {
                                title: 'Search and actions',
                                description: 'Search SMEs, switch between who acts next, filter by branch, group or outstanding document, and use the reminder, AI verification and document-setup actions.',
                                side: 'bottom',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('compliance-table'),
                            popover: {
                                title: 'SME compliance',
                                description: 'Each SME shows its most urgent item and how many documents are in order. Select one to review its documents alongside the list.',
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
                                title: 'Select an SME',
                                description: 'Select the SME whose documents you want to review.',
                                side: 'right',
                                align: 'center',
                                showButtons: ['close']
                            }
                        },
                        {
                            element: guideTarget('manage-compliance-content'),
                            waitForElement: 5000,
                            popover: {
                                title: 'Review document status',
                                description: 'Documents are grouped by who acts next. Only requirements visible to your department are shown; agreements and onboarding-only items are limited to onboarding or monitoring departments. View files, upload missing or invalid documents, verify them, run AI checks, or raise and resolve document issues.',
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
                                description: 'With the SME selected, use Upload in their panel to add or replace one of their documents.',
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
                                title: 'Remind SMEs',
                                description: 'Quick reminders email each SME the exact documents they need to upload, sign or correct, after a confirmation. Or pick an email template for the same recipients. To remind one SME, use Remind in their panel.',
                                side: 'bottom',
                                align: 'end'
                            }
                        },
                        {
                            element: guideTarget('bulk-ai-compliance'),
                            popover: {
                                title: 'Verify visible documents with AI',
                                description: 'Runs AI checks on uploaded documents awaiting verification for the SMEs shown. A confirmation is shown before it starts.',
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
                            advanceOnClick: true,
                            popover: {
                                title: 'Add a requirement',
                                description: 'Open the document editor to choose a document and configure its expiry rule.',
                                side: 'bottom',
                                align: 'start',
                                showButtons: ['close']
                            }
                        },
                        {
                            element: '.guide-document-editor-modal',
                            waitForElement: 5000,
                            popover: {
                                title: 'Document details',
                                description: 'Select the document title and configure whether it expires. Saving returns you to the document cards.',
                                side: 'left',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('save-compliance-document-draft'),
                            waitForElement: 5000,
                            advanceOnClick: true,
                            popover: {
                                title: 'Add the document',
                                description: 'Add this document to the setup draft. The department setup is only written to Firestore when you save the main setup.',
                                side: 'top',
                                align: 'center',
                                showButtons: ['close']
                            }
                        },
                        {
                            element: '.guide-save-compliance-documents',
                            waitForElement: 5000,
                            popover: {
                                title: 'Save document requirements',
                                description: 'Save the card list to make it the department compliance setup for this programme.',
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

    // M&E oversees every department, so it tracks the programme's full
    // document list rather than a department selection of it.
    const tracksWholeProgramme = hasDepartmentRole(currentUser?.departmentId, 'monitoring')

    // Agreements (pre-incubation, MOA, GAP) belong to ROM, and M&E sees
    // everything. Both come from the department roles, never department flags.
    const canSeeOnboardingDocuments =
        tracksWholeProgramme || hasDepartmentRole(currentUser?.departmentId, 'rom')

    // Every department may track any programme upload. The programme rows'
    // isOnboarding flag is not used: /programs sets it on every row.
    const isRequirementVisibleToDepartment = useCallback(
        (requirement: RequiredDoc) =>
            (requirement.type ?? 'upload') !== 'agreement' || canSeeOnboardingDocuments,
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

    const [romSignOpen, setRomSignOpen] = useState(false)
    const [romSignForm] = Form.useForm()
    const [romSignTarget, setRomSignTarget] = useState<{ participantId: string; agreementId: string } | null>(null)
    const [romSigning, setRomSigning] = useState(false)
    const [romSignPreview, setRomSignPreview] = useState('')
    const romSignPlayback = useSignaturePlayback()
    const [preIncViewer, setPreIncViewer] = useState<{ participantId: string; meta?: any } | null>(null)

    const [deptRequired, setDeptRequired] = useState<RequiredDoc[] | null>(null)
    const [reqModalOpen, setReqModalOpen] = useState(false)
    const [draftRequirements, setDraftRequirements] = useState<RequiredDoc[]>([])
    const [documentEditorOpen, setDocumentEditorOpen] = useState(false)
    const [editingRequirementIndex, setEditingRequirementIndex] = useState<number | null>(null)
    const [requirementsLoading, setRequirementsLoading] = useState(false)

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
    const [documentEditorForm] = Form.useForm()
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
            const userSnap = await getDoc(doc(db, 'users', u.uid))
            const ud = userSnap.exists() ? userSnap.data() : undefined
            if (ud?.departmentId) {
                const deptSnap = await getDoc(doc(db, 'departments', ud.departmentId))
                setDepartmentInfo(deptSnap.exists() ? deptSnap.data() : null)
            }
            setCurrentUser(ud || null)
            setIdentityLoaded(true)
        })
        return () => unsub()
    }, [])

    useEffect(() => {
        let cancelled = false
        ; (async () => {
            if (!activeProgramId) {
                setProgramTemplates([])
                setDeptRequired(null)
                setProgramName(isAllPrograms ? 'All Programs' : '—')
                return
            }
            const raw = await fetchProgramRequiredFromProgramDoc(activeProgramId)
            if (cancelled) return
            setProgramTemplates(sanitizeTemplates(raw))

            try {
                const snap = await getDoc(doc(db, 'programs', activeProgramId))
                if (!cancelled && snap.exists()) {
                    const data = snap.data() as any
                    setProgramName(data.name || '—')
                }
            } catch (e) {
                console.error('Failed to load program name', e)
            }
        })()
        return () => {
            cancelled = true
        }
    }, [activeProgramId, isAllPrograms])

    const fetchDeptRequirements = useCallback(async () => {
        // null = no department selection, so the programme list applies.
        if (!activeProgramId || !currentUser?.departmentId || tracksWholeProgramme) {
            setDeptRequired(null)
            return
        }

        setRequirementsLoading(true)
        try {
            const requirementsRef = doc(
                db,
                'programs',
                activeProgramId,
                'deptRequirements',
                currentUser.departmentId
            )
            const requirementsSnap = await getDoc(requirementsRef)

            if (!requirementsSnap.exists()) {
                setDeptRequired([])
                return
            }

            const data = requirementsSnap.data() as any
            const savedRequirements = Array.isArray(data.requiredDocuments)
                ? data.requiredDocuments
                : []

            setDeptRequired(
                sanitizeTemplates(savedRequirements as RequiredDoc[]).filter(
                    isRequirementVisibleToDepartment
                )
            )
        } catch (error) {
            console.error('Failed to load department compliance requirements', error)
            setDeptRequired([])
            message.error("Failed to load this department's compliance setup.")
        } finally {
            setRequirementsLoading(false)
        }
    }, [activeProgramId, currentUser?.departmentId, isRequirementVisibleToDepartment, tracksWholeProgramme])

    useEffect(() => {
        if (activeProgramId && currentUser?.departmentId) fetchDeptRequirements()
    }, [activeProgramId, currentUser?.departmentId, fetchDeptRequirements])

    const visibleProgramTemplates = useMemo(
        () => programTemplates.filter(isRequirementVisibleToDepartment),
        [programTemplates, isRequirementVisibleToDepartment]
    )

    // A department's setup selects which programme requirements it tracks and may
    // set its own expiry; everything else comes from the programme, and rows
    // whose programme requirement was deleted drop out. Mirrors
    // selectDepartmentRequirements in the shared resolver.
    const effectiveRequired: RequiredDoc[] = useMemo(() => {
        if (deptRequired === null) return visibleProgramTemplates
        const programByKey = new Map(visibleProgramTemplates.map(template => [keyForReq(template), template]))
        const selected = new Map<string, RequiredDoc>()
        deptRequired.forEach(requirement => {
            const key = keyForReq(requirement)
            const template = programByKey.get(key)
            if (!template) return
            selected.set(key, {
                ...template,
                hasExpiry: requirement.hasExpiry === true,
                expiryMonths: requirement.hasExpiry ? requirement.expiryMonths ?? null : null
            })
        })
        return Array.from(selected.values())
    }, [deptRequired, visibleProgramTemplates])

    const isROMDept = hasDepartmentRole(currentUser?.departmentId, 'rom')

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
            ? (requirementsByProgram[application?.programId || ''] || []).filter(isRequirementVisibleToDepartment)
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
    }, [appByParticipant, effectiveRequired, isAllPrograms, isRequirementVisibleToDepartment, requirementsByProgram])

    const docsForPart = useCallback(
        (participantId: string) => {
            const a = appByParticipant[participantId]
            if (!a) return []
            const docs = ((a.complianceDocuments || []) as ComplianceDocument[]).filter(document =>
                (document.kind ?? 'upload') !== 'agreement' || canSeeOnboardingDocuments
            )
            const inProgram = activeProgramId
                ? docs.filter(d => {
                    if ((d.kind ?? 'upload') === 'agreement') return true
                    return d.programId === activeProgramId
                })
                : docs

            // An upload whose key matches no requirement but whose title does
            // (older uploads saved with only a title) is filed under that
            // requirement, as the SME dashboard and the expiry reminders do.
            // storedKey keeps the key it is stored under, for writes.
            const requirements = requirementsForPart(participantId)
            const requirementKeys = new Set(requirements.map(keyForReq))
            const requirementByTitle = new Map(
                requirements
                    .filter(requirement => (requirement.type ?? 'upload') === 'upload')
                    .map(requirement => [complianceTitleKey(requirement.title), requirement])
            )
            const keyed: ComplianceDocument[] = []
            const titled: ComplianceDocument[] = []
            inProgram.forEach(document => {
                const storedKey = keyForDoc(document)
                const requirement = (document.kind ?? 'upload') === 'upload' && !requirementKeys.has(storedKey)
                    ? requirementByTitle.get(complianceTitleKey(document.documentName))
                    : undefined
                if (!requirement) {
                    keyed.push(document)
                    return
                }
                titled.push({ ...document, slug: requirement.presetId || requirement.id, storedKey })
            })

            // A key match wins over a title match for the same requirement.
            const canonical = new Map<string, ComplianceDocument>()
            ;[...titled, ...keyed].forEach(document => canonical.set(keyForDoc(document), document))
            return Array.from(canonical.values())
        },
        [appByParticipant, activeProgramId, canSeeOnboardingDocuments, requirementsForPart]
    )

    // Each requirement this SME is held to in this scope, with its document and state.
    const entriesForPart = useCallback(
        (participantId: string): ComplianceEntry[] => {
            const docs = docsForPart(participantId)
            const seen = new Set<string>()
            return requirementsForPart(participantId).flatMap(requirement => {
                const key = keyForReq(requirement)
                if (seen.has(key)) return []
                seen.add(key)
                const document = docs.find(item => keyForDoc(item) === key)
                const computedExpiry = document ? computeExpiryDate(document, requirement) : null
                const state = document ? deriveStatus(document, requirement) : 'missing'
                const expiresAt = computedExpiry?.toDate() || asDayjs(document?.expiryDate)?.toDate() || null
                return [{
                    key,
                    title: requirement.title,
                    kind: (requirement.type ?? 'upload') === 'agreement' ? 'agreement' as const : 'upload' as const,
                    state,
                    bucket: bucketOfState(state),
                    label: requirementStatusLabel(requirement, state, document),
                    color: statusColor(state),
                    expiryText: !requirement.hasExpiry
                        ? '—'
                        : computedExpiry
                            ? computedExpiry.format('DD MMM YYYY')
                            : expiryDisplay(document, requirement, null),
                    expiresAt: requirement.hasExpiry ? expiresAt : null,
                    requirement,
                    document
                }]
            })
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
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
                if (smeCanAct(status)) {
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
        // A newer run (programme switch) supersedes this one.
        let cancelled = false
        const run = async () => {
            // Wait for the department scope, so the load runs once.
            if (!identityLoaded || departmentRolesLoading) return
            if (!activeProgramId && !isAllPrograms) {
                setLoading(false)
                return
            }
            setLoading(true)
            try {
                const [appsSnap, partSnap, branchesSnap, gapAnalysisSnap, loadedProgramTemplates] = await Promise.all([
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
                    }),
                    // Read here rather than from state, so the load doesn't wait
                    // for (and re-run after) the requirements effect.
                    isAllPrograms || !activeProgramId
                        ? Promise.resolve([] as RequiredDoc[])
                        : fetchProgramRequiredFromProgramDoc(activeProgramId).then(sanitizeTemplates)
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
                                currentUser?.departmentId && !tracksWholeProgramme
                                    ? { departmentId: currentUser.departmentId }
                                    : {}
                            ),
                            getDoc(doc(db, 'programs', programId))
                        ])

                        // Department visibility is applied in requirementsForPart.
                        resolvedRequirementsByProgram[programId] = sanitizeTemplates(
                            resolved.requirements as RequiredDoc[]
                        )
                        if (programSnapshot.exists()) {
                            const program = programSnapshot.data() as any
                            programNamesById[programId] = program.name || program.title || programId
                        }
                    }))
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
                            : loadedProgramTemplates

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
                                // The document lives under this application, so it belongs to
                                // the application's programme even if it was tagged otherwise.
                                programId: ad.programId || v.programId || '',
                                programName: ad.programName || '',
                                departmentId: v.departmentId || ad.departmentId || '',
                                departmentName: v.departmentName || '',
                                presetId: v.presetId || v.preset || v.slug || undefined,
                                createdBy: v.createdBy || '',
                                aiReview: v.aiReview && typeof v.aiReview === 'object' ? v.aiReview : undefined
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
                            complianceDocuments: combinedDocs,
                            registrationNumber: ad.registrationNumber,
                            beneficiaryName: ad.beneficiaryName,
                            participantName: ad.participantName,
                            applicantName: ad.applicantName,
                            idNumber: ad.idNumber,
                            businessAddress: ad.businessAddress,
                            phone: ad.phone,
                            directorPosition: ad.directorPosition
                        }
                    })
                )

                if (cancelled) return
                setRequirementsByProgram(resolvedRequirementsByProgram)
                setParticipants(Object.values(partMap) as any[])
                setApps(rowsData)
            } finally {
                if (!cancelled) setLoading(false)
            }
        }
        run()
        return () => {
            cancelled = true
        }
    }, [activeProgramId, isAllPrograms, currentUser?.departmentId, tracksWholeProgramme, identityLoaded, departmentRolesLoading])

    // One view per SME with an application in scope: the list rows, the tiles and the detail.
    const views: ComplianceView[] = useMemo(
        () =>
            participants
                .filter(p => appByParticipant[p.id])
                .map(p => {
                    const app = appByParticipant[p.id]
                    const entries = entriesForPart(p.id)
                    const counts = { action: 0, review: 0, expiring: 0, valid: 0, expired: 0 }
                    let nextExpiry: Date | null = null
                    let lastUpload: Date | null = null
                    for (const entry of entries) {
                        counts[entry.bucket] += 1
                        if (entry.state === 'expired') counts.expired += 1
                        if (
                            entry.expiresAt &&
                            (entry.bucket === 'valid' || entry.bucket === 'expiring') &&
                            (!nextExpiry || entry.expiresAt < nextExpiry)
                        ) {
                            nextExpiry = entry.expiresAt
                        }
                        const uploaded = asDayjs(entry.document?.uploadedAt)?.toDate() || null
                        if (uploaded && (!lastUpload || uploaded > lastUpload)) lastUpload = uploaded
                    }

                    const moaDocument = docsForPart(p.id).find(document =>
                        (document.kind ?? 'upload') === 'agreement' &&
                        normalize(document.agreementId || document.id) === 'moa'
                    )
                    const moaMeta = app?.signedAgreements?.moa || {}
                    const moaSigned = Boolean(
                        moaDocument?.participantSignatureURL ||
                        moaDocument?.participantSignedAt ||
                        moaDocument?.uploadedAt ||
                        moaMeta.participantSignatureURL ||
                        moaMeta.participantSignatureUrl ||
                        moaMeta.participantSigned === true ||
                        moaMeta.acceptedAt ||
                        moaMeta.signedAt
                    )

                    return {
                        participantId: p.id,
                        name: p.beneficiaryName || p.name || p.email || 'Unknown',
                        email: p.email || app?.email || '',
                        programId: app?.programId || '',
                        programName: app?.programName || '—',
                        branchName: app?.branchName || '—',
                        gapGroup: app?.gapGroup || '—',
                        covered: counts.valid + counts.expiring,
                        required: entries.length,
                        counts,
                        nextExpiry,
                        lastUpload,
                        moaSigned,
                        outstanding: entries
                            .filter(entry => entry.bucket === 'action' || entry.bucket === 'review')
                            .map(entry => entry.title)
                    }
                }),
        [participants, appByParticipant, entriesForPart, docsForPart]
    )

    const [filters, setFilters] = useState<ComplianceFilterState>(DEFAULT_COMPLIANCE_FILTERS)
    const patchFilters = (patch: Partial<ComplianceFilterState>) => setFilters(previous => ({ ...previous, ...patch }))
    const [selectedId, setSelectedId] = useState<string>()
    const [drawerOpen, setDrawerOpen] = useState(false)
    const isMobile = useIsMobile()

    const programmeOptions = useMemo(() => distinctValues(views.map(view => view.programName)), [views])
    const branchOptions = useMemo(() => distinctValues(views.map(view => view.branchName)), [views])
    const groupOptions = useMemo(() => distinctValues(views.map(view => view.gapGroup)), [views])
    const documentOptions = useMemo(() => distinctValues(views.flatMap(view => view.outstanding)), [views])

    // Everything except the segment: drives the tile counts, so they don't all
    // collapse to the active segment.
    const beforeSegment = useMemo(() => {
        const term = filters.search.trim().toLowerCase()
        return views.filter(view =>
            (!term || view.name.toLowerCase().includes(term) || view.email.toLowerCase().includes(term)) &&
            (filters.programme === 'all' || view.programName === filters.programme) &&
            (filters.branch === 'all' || view.branchName === filters.branch) &&
            (filters.group === 'all' || view.gapGroup === filters.group) &&
            (filters.document === 'all' || view.outstanding.includes(filters.document))
        )
    }, [views, filters.search, filters.programme, filters.branch, filters.group, filters.document])

    const visibleViews = useMemo(
        () => beforeSegment
            .filter(view => matchesSegment(view, filters.segment))
            .sort(complianceSorters[filters.sort]),
        [beforeSegment, filters.segment, filters.sort]
    )

    const tileCounts = useMemo(() => {
        const smes = (segment: ComplianceFilterState['segment']) =>
            beforeSegment.filter(view => matchesSegment(view, segment)).length
        const documents = (bucket: 'action' | 'review' | 'expiring' | 'expired') =>
            beforeSegment.reduce((total, view) => total + view.counts[bucket], 0)
        return {
            all: beforeSegment.length,
            action: smes('action'),
            review: smes('review'),
            expiring: smes('expiring'),
            compliant: smes('compliant'),
            actionDocuments: documents('action'),
            expiredDocuments: documents('expired'),
            reviewDocuments: documents('review'),
            expiringDocuments: documents('expiring')
        }
    }, [beforeSegment])

    // Desktop always shows a detail: keep the selection while it's visible, otherwise take the first row.
    useEffect(() => {
        if (isMobile) return
        if (!visibleViews.some(view => view.participantId === selectedId)) {
            setSelectedId(visibleViews[0]?.participantId)
        }
    }, [visibleViews, selectedId, isMobile])

    const selectedView = views.find(view => view.participantId === selectedId)

    // Persists one review decision. app.complianceDocuments is the merged view
    // built at load (subcollection uploads, agreements, synthetic GAP rows), so
    // it must never be written back as a whole. Instead the subcollection doc is
    // patched directly, and any matching entry in the embedded array is patched
    // inside a transaction against the stored array, so uploads made since the
    // page loaded survive.
    const recordReview = async (
        participantId: string,
        docKey: string,
        fields: Record<string, any>,
        historyEntry: StatusHistoryItem,
        options: { subDocId?: string; verifiedBy?: string } = {}
    ) => {
        const app = appByParticipant[participantId]
        if (!app) return
        // A document matched by title is stored under its own key.
        const storedKey = docsForPart(participantId).find(document => keyForDoc(document) === docKey)?.storedKey || docKey
        const entry = stripUndefinedDeep(historyEntry) as StatusHistoryItem
        const verified = options.verifiedBy
            ? { lastVerifiedBy: options.verifiedBy, lastVerifiedAt: entry.atISO }
            : {}

        // Ids prefixed flat_ are positions in the embedded array, not subcollection docs.
        if (options.subDocId && !options.subDocId.startsWith('flat_')) {
            await updateDoc(doc(db, 'applications', app.id, 'complianceDocuments', options.subDocId), {
                ...fields,
                ...(options.verifiedBy
                    ? { lastVerifiedBy: options.verifiedBy, lastVerifiedAt: serverTimestamp() }
                    : {}),
                statusHistory: arrayUnion(entry)
            })
        }

        if (!activeProgramId || app.programId === activeProgramId) {
            // Same source the page reads from: the participant's array when it
            // has entries, otherwise the application's.
            const participantRef = doc(db, 'participants', participantId)
            const applicationRef = doc(db, 'applications', app.id)
            await runTransaction(db, async transaction => {
                const [participantSnap, applicationSnap] = await Promise.all([
                    transaction.get(participantRef),
                    transaction.get(applicationRef)
                ])
                const fromParticipant = participantSnap.data()?.complianceDocuments
                const useParticipant = Array.isArray(fromParticipant) && fromParticipant.length > 0
                const stored: any[] = useParticipant
                    ? fromParticipant
                    : Array.isArray(applicationSnap.data()?.complianceDocuments)
                        ? applicationSnap.data()!.complianceDocuments
                        : []

                let changed = false
                const next = stored.map((item, idx) => {
                    if (embeddedComplianceDocKey(item, idx, app.manuallyCreated) !== storedKey) return item
                    changed = true
                    return {
                        ...item,
                        ...fields,
                        ...verified,
                        statusHistory: [...(Array.isArray(item?.statusHistory) ? item.statusHistory : []), entry]
                    }
                })
                if (changed) {
                    transaction.update(useParticipant ? participantRef : applicationRef, { complianceDocuments: next })
                }
            })
        }

        setApps(prev => prev.map(a => a.id !== app.id ? a : {
            ...a,
            complianceDocuments: (a.complianceDocuments || []).map(x =>
                keyForDoc(x) === storedKey && (!activeProgramId || x.programId === activeProgramId)
                    ? { ...x, ...fields, ...verified, statusHistory: pushHistory(x, entry) }
                    : x
            )
        }))
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

        await recordReview(
            participantId,
            docKey,
            { status: 'valid', queryOpen: false },
            { status: 'valid', by, atISO },
            { subDocId, verifiedBy: by }
        )

        message.success('Document verified.')
    }

    // Shows an AI result on the page. The AI backend has already written it to
    // the subcollection doc, which every compliance view reads ahead of the
    // embedded copy, so nothing else is stored.
    const applyAiVerificationResult = (
        applicationId: string,
        documentId: string,
        result: { status: string; note: string; aiReview?: ComplianceAiReview }
    ) => {
        const entry: StatusHistoryItem = {
            status: result.status as StatusHistoryItem['status'],
            by: 'AI Compliance Check',
            atISO: new Date().toISOString(),
            note: result.note
        }
        setApps(prev => prev.map(application => application.id !== applicationId ? application : {
            ...application,
            complianceDocuments: (application.complianceDocuments || []).map(document =>
                document.id === documentId
                    ? {
                        ...document,
                        status: result.status,
                        statusHistory: pushHistory(document, entry),
                        ...(result.aiReview ? { aiReview: result.aiReview } : {})
                    }
                    : document
            )
        }))
    }

    // Documents uploaded with the application live in an embedded array, which
    // the AI backend can't address. Verifying one first copies it into the
    // application's complianceDocuments subcollection, where SME and WhatsApp
    // uploads already go and which every compliance view reads ahead of the
    // embedded copy. Returns the subcollection doc id.
    const promoteEmbeddedDocument = async (participantId: string, docKey: string): Promise<string> => {
        const app = appByParticipant[participantId]
        const requirement = requirementsForPart(participantId).find(item => keyForReq(item) === docKey)
        const document = docsForPart(participantId).find(item => keyForDoc(item) === docKey)
        if (!app || !requirement || !document) throw new Error('This document could not be found.')
        if (!document.id.startsWith('flat_')) return document.id

        const url = await resolveDocUrl(document)
        if (!url) throw new Error('This document has no file to verify.')

        const presetId = requirement.presetId || requirement.id
        const record: Omit<ComplianceDocument, 'id' | 'participantId'> & Record<string, any> = {
            programId: app.programId || activeProgramId || '',
            isOnboarding: requirement.isOnboarding === true,
            slug: presetId,
            presetId,
            documentName: requirement.title,
            status: document.status || 'pending',
            issueDate: document.issueDate || '',
            expiryDate: document.expiryDate || '',
            url,
            uploadedBy: document.uploadedBy || '',
            uploadedAt: document.uploadedAt || '',
            queryOpen: document.queryOpen === true,
            queryReason: document.queryReason || '',
            statusHistory: pushHistory(document, {
                status: (document.status || 'pending') as StatusHistoryItem['status'],
                by: currentUser?.name || currentUser?.email || 'Staff',
                atISO: new Date().toISOString(),
                note: 'Copied from the documents uploaded with the application, for verification.'
            }),
            // Where the copy came from: the key it is stored under in the embedded array.
            copiedFromEmbeddedKey: document.storedKey || docKey
        }
        const created = await addDoc(
            collection(db, 'applications', app.id, 'complianceDocuments'),
            stripUndefinedDeep(record)
        )

        setApps(prev => prev.map(application => application.id !== app.id ? application : {
            ...application,
            complianceDocuments: [
                ...(application.complianceDocuments || []),
                { ...document, ...record, id: created.id, kind: 'upload' as const, storedKey: undefined }
            ]
        }))
        return created.id
    }

    const runAiVerification = async (participantId: string, docKey: string, subDocId: string) => {
        const app = appByParticipant[participantId]
        if (!app) return

        setAiVerifyingDocIds(prev => ({ ...prev, [subDocId]: true }))
        try {
            // Only an embedded id needs copying; a subcollection id (including a
            // doc just uploaded on behalf of the SME) is verified as it is.
            const documentId = subDocId.startsWith('flat_')
                ? await promoteEmbeddedDocument(participantId, docKey)
                : subDocId
            const result = await verifyComplianceDocument(app.id, documentId)
            applyAiVerificationResult(app.id, documentId, result)
            message.info(result.note || `AI verification: ${complianceStatusLabel(result.status)}`)
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
                    if (!d || !hasOpenableFile(d)) return
                    // Only documents awaiting verification: the AI result is
                    // written as the status, so it must not overwrite a staff
                    // decision (valid, invalid) or close an open query.
                    if (deriveStatus(d, req) !== 'pending') return
                    // This file already has an AI suggestion waiting for staff.
                    if (currentAiReview(d)) return
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
        const collected = collectVerifiableDocs(participantIds)
        if (!collected.length) {
            message.info('No uploaded documents are awaiting verification.')
            return
        }

        setAiBatchRunning(true)
        setAiBatchProgress({ done: 0, total: collected.length })

        try {
            // Embedded documents are copied into the subcollection first (see
            // promoteEmbeddedDocument); one that can't be is counted as failed.
            const jobs: LocalVerifyJob[] = []
            let notPrepared = 0
            for (const job of collected) {
                try {
                    jobs.push(job.documentId.startsWith('flat_')
                        ? { ...job, documentId: await promoteEmbeddedDocument(job.participantId, job.docKey) }
                        : job)
                } catch (error) {
                    console.error('Could not prepare a document for AI verification', job, error)
                    notPrepared += 1
                }
            }

            const outcomes = await verifyComplianceDocumentsBatch(jobs, {
                concurrency: 2,
                onProgress: done => setAiBatchProgress({ done: done + notPrepared, total: collected.length })
            })

            outcomes.forEach(outcome => {
                if (outcome.ok && outcome.status) {
                    applyAiVerificationResult(outcome.applicationId, outcome.documentId, {
                        status: outcome.status,
                        note: outcome.note || '',
                        aiReview: outcome.aiReview
                    })
                }
            })

            const succeeded = outcomes.filter(o => o.ok).length
            const failed = collected.length - succeeded
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

    // The dates to record from the AI's reading of the file: its issue date (the
    // expiry then follows the requirement's validity period), or, when the
    // requirement has no period, the expiry date printed on it. Null when the
    // reading adds nothing to what is recorded.
    const aiDateFields = (entry: ComplianceEntry): Record<string, string> | null => {
        const review = currentAiReview(entry.document)
        if (!review || !entry.document) return null
        const months = entry.requirement.hasExpiry ? entry.requirement.expiryMonths || 0 : 0
        const recordedIssue = String(entry.document.issueDate || '').slice(0, 10)
        const recordedExpiry = String(entry.document.expiryDate || '').slice(0, 10)
        const fields: Record<string, string> = {}
        if (review.extracted.issueDate && review.extracted.issueDate !== recordedIssue) {
            fields.issueDate = review.extracted.issueDate
            if (months) {
                fields.expiryDate = dayjs(review.extracted.issueDate).add(months, 'month').format('YYYY-MM-DD')
            }
        }
        if (!months && review.extracted.expiryDate && review.extracted.expiryDate !== recordedExpiry) {
            fields.expiryDate = review.extracted.expiryDate
        }
        return Object.keys(fields).length ? fields : null
    }

    const applyAiDates = async (participantId: string, entry: ComplianceEntry) => {
        const fields = aiDateFields(entry)
        const document = entry.document
        if (!fields || !document) return
        try {
            await recordReview(
                participantId,
                entry.key,
                fields,
                {
                    status: (document.status || 'pending') as StatusHistoryItem['status'],
                    by: currentUser?.name || currentUser?.email || 'Verifier',
                    atISO: new Date().toISOString(),
                    note: `Dates taken from the AI reading of the file: ${Object.entries(fields)
                        .map(([field, value]) => `${field === 'issueDate' ? 'issued' : 'expires'} ${value}`)
                        .join(', ')}.`
                },
                { subDocId: document.id }
            )
            message.success('Dates recorded from the document.')
        } catch (error: any) {
            message.error(error?.message || 'The dates could not be saved.')
        }
    }

    const updateDocStatus = async (
        participantId: string,
        docKey: string,
        newStatus: 'invalid' | 'queried' | 'valid',
        reason?: string,
        subDocId?: string
    ) => {
        const by = currentUser?.name || currentUser?.email || 'Verifier'
        const atISO = new Date().toISOString()
        const historyEntry: StatusHistoryItem =
            newStatus === 'valid'
                ? { status: 'valid', by, atISO }
                : { status: newStatus, reason: reason || '', by, atISO }

        await recordReview(
            participantId,
            docKey,
            {
                status: newStatus,
                queryOpen: newStatus === 'queried',
                ...(reason ? { queryReason: reason } : {})
            },
            historyEntry,
            { subDocId, verifiedBy: by }
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

        await recordReview(
            participantId,
            docKey,
            { status: 'pending', queryOpen: false },
            historyEntry,
            { subDocId, verifiedBy: by }
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

    const downloadAgreement = async (
        participantId: string,
        requirement: RequiredDoc,
        documentRecord: ComplianceDocument
    ) => {
        if (hasOpenableFile(documentRecord)) {
            await downloadDocument(documentRecord, requirement.title)
            return
        }

        const agreementId = normalize(
            requirement.agreementId || documentRecord.agreementId || requirement.id
        )
        const application = appByParticipant[participantId]
        const participant = participants.find(item => item.id === participantId) || {}
        const meta = {
            ...(application?.signedAgreements?.[agreementId] || {}),
            ...documentRecord
        }
        const cleanName = String(
            application?.programName || participant.beneficiaryName || documentRecord.documentName || agreementId
        ).replace(/[^a-z0-9]+/gi, '_')

        try {
            if (agreementId === 'gap-analysis') {
                let gapSnapshot = documentRecord.gapAnalysisId
                    ? await getDoc(doc(db, 'gapAnalysis', documentRecord.gapAnalysisId))
                    : null
                if (!gapSnapshot?.exists()) {
                    const gapQuery = await getDocs(query(
                        collection(db, 'gapAnalysis'),
                        where('participantId', '==', participantId)
                    ))
                    gapSnapshot = gapQuery.docs
                        .sort((left, right) => {
                            const leftAt = asDayjs(left.data()?.submittedAt || left.data()?.updatedAt)?.valueOf() || 0
                            const rightAt = asDayjs(right.data()?.submittedAt || right.data()?.updatedAt)?.valueOf() || 0
                            return rightAt - leftAt
                        })[0] || null
                }
                if (!gapSnapshot?.exists()) throw new Error('The GAP record could not be found.')

                const standardSnapshot = await getDoc(doc(db, 'qmsStandards', 'gap-analysis'))
                const standard = standardSnapshot.exists() ? standardSnapshot.data() as any : null
                await exportGapDocx(
                    { id: gapSnapshot.id, ...gapSnapshot.data() },
                    {
                        ...(standard?.formNo && standard?.revisionNo && standard?.effectiveDate
                            ? {
                                headerMeta: {
                                    formNo: standard.formNo,
                                    revisionNo: standard.revisionNo,
                                    effectiveDate: dayjs(standard.effectiveDate).format('D MMMM YYYY'),
                                    centerTitle: standard.centerTitle || 'SMME GAP ANALYSIS',
                                    onboardingComments: standard.onboardingComments || ''
                                }
                            }
                            : {}),
                        filenameBase: `${cleanName || 'SMME'}-GAP-Analysis`
                    }
                )
                message.success('GAP Analysis downloaded.')
                return
            }

            const programSnapshot = application?.programId
                ? await getDoc(doc(db, 'programs', application.programId))
                : null
            const program = programSnapshot?.exists() ? programSnapshot.data() as any : {}
            const programStart = asDayjs(program?.startDate)
            const programEnd = asDayjs(program?.endDate)
            const resolvedCompliance = application?.programId
                ? await resolveComplianceRequirements(application.programId, { includeAllDepartments: true })
                : null
            const agreementTemplate = resolvedCompliance?.agreements.find(template =>
                normalize(template.agreementId) === agreementId
            )
            const documentEffectiveDate = agreementTemplate?.effectiveDate
                ? dayjs(agreementTemplate.effectiveDate).format('DD MMMM YYYY')
                : programStart?.format('DD MMMM YYYY') || '________'

            if (agreementId === 'pre-incubation-contract') {
                await downloadPreIncubationDocxFromArgs({
                    effectiveDate: documentEffectiveDate,
                    registrationNumber: application?.registrationNumber || participant.registrationNumber,
                    companyName: application?.beneficiaryName || participant.beneficiaryName,
                    directorName:
                        participant.participantName || application?.participantName || application?.applicantName,
                    directorId: participant.idNumber || application?.idNumber,
                    start: programStart || undefined,
                    end: programEnd || undefined,
                    products: participant.natureOfBusiness,
                    signPlace: program?.branchName || application?.branchName,
                    companyAddress: participant.businessAddress || application?.businessAddress,
                    companyEmail: participant.email || application?.email,
                    companyPhone: participant.phone || application?.phone,
                    directorPosition: application?.directorPosition || 'MANAGING DIRECTOR',
                    incubateeSignatureImg:
                        meta.participantSignatureURL || meta.signatureURL || meta.userSignatureURL,
                    romSignatureImg: meta.romSignatureURL || meta.romSignatureUrl,
                    romNameToRender: meta.romName || meta.romSignedBy,
                    romPositionToRender: meta.romPosition || 'Operations',
                    incubateeSignedAt: meta.participantSignedAt || meta.acceptedAt,
                    romSignedAt: meta.romSignedAt
                }, `Pre-Incubation_Agreement_${cleanName || 'SMME'}.docx`)
                message.success('Pre-Incubation Agreement downloaded.')
                return
            }

            if (agreementId === 'moa') {
                const vars: MoaVars = {
                    beneficiaryName: application?.beneficiaryName || participant.beneficiaryName || '________',
                    registrationNumber: participant.registrationNumber || application?.registrationNumber || '________',
                    participantName:
                        participant.participantName || application?.participantName || application?.applicantName || '________',
                    idNumber: participant.idNumber || application?.idNumber || '________',
                    businessAddress: participant.businessAddress || application?.businessAddress || '________',
                    contactNumber: participant.phone || application?.phone || '________',
                    email: participant.email || application?.email || '________',
                    effectiveDate: programStart?.format('DD MMMM YYYY') || '________',
                    graduationDate: programEnd?.format('DD MMMM YYYY') || '________'
                }
                const acceptedAt = asDayjs(meta.acceptedAt || meta.signedAt)
                const romSignedAt = asDayjs(meta.romSignedAt || meta.operationsSignedAt)
                await saveMoaDocx(
                    vars,
                    `MOA_${cleanName || 'SMME'}.docx`,
                    {
                        centerTitle: 'INCUBATION MEMORANDUM OF AGREEMENT',
                        formNo: agreementTemplate?.formNo || '',
                        revisionNo: agreementTemplate?.revisionNo || '',
                        effectiveDate: documentEffectiveDate
                    },
                    {
                        incubatee: {
                            name: meta.signerName || vars.participantName,
                            positionOrTitle: meta.signerTitle || 'Director',
                            place: meta.place || application?.branchName || '',
                            day: acceptedAt?.format('DD') || '',
                            month: acceptedAt?.format('MMMM') || '',
                            year: acceptedAt?.format('YYYY') || '',
                            signatureUrl:
                                meta.participantSignatureURL || meta.signatureURL || meta.userSignatureURL
                        },
                        incubator: {
                            name: meta.romSignerName || meta.romName || '',
                            positionOrTitle: meta.romSignerTitle || meta.romPosition || 'Centre Coordinator',
                            place: meta.romPlace || application?.branchName || '',
                            day: romSignedAt?.format('DD') || '',
                            month: romSignedAt?.format('MMMM') || '',
                            year: romSignedAt?.format('YYYY') || '',
                            signatureUrl: meta.romSignatureURL || meta.romSignatureUrl
                        }
                    }
                )
                message.success('MOA downloaded.')
                return
            }

            throw new Error('This agreement does not have a downloadable file yet.')
        } catch (error: any) {
            console.error('Could not download compliance agreement', error)
            message.error(error?.message || 'The agreement could not be downloaded.')
        }
    }


    const requirementOptionValue = (requirement: RequiredDoc) => keyForReq(requirement)

    const availableRequirementTemplates = useMemo(
        () => visibleProgramTemplates.map(template => ({
            ...template,
            optionValue: requirementOptionValue(template)
        })),
        [visibleProgramTemplates]
    )

    const openRequirementsManager = () => {
        setDraftRequirements(effectiveRequired.map(requirement => ({ ...requirement })))
        setReqModalOpen(true)
    }

    const openDocumentEditor = (index: number | null = null) => {
        const current = index === null ? null : draftRequirements[index]
        setEditingRequirementIndex(index)
        documentEditorForm.resetFields()
        documentEditorForm.setFieldsValue({
            templateKey: current ? requirementOptionValue(current) : undefined,
            hasExpiry: current?.hasExpiry === true,
            expiryMonths: current?.hasExpiry ? current.expiryMonths ?? null : null
        })
        setReqModalOpen(false)
        setDocumentEditorOpen(true)
    }

    const closeDocumentEditor = () => {
        setDocumentEditorOpen(false)
        setEditingRequirementIndex(null)
        documentEditorForm.resetFields()
        setReqModalOpen(true)
    }

    const saveDocumentDraft = async () => {
        try {
            const values = await documentEditorForm.validateFields()
            const template = availableRequirementTemplates.find(
                item => item.optionValue === values.templateKey
            )

            if (!template) {
                message.error('Select a valid document.')
                return
            }

            const isAgreement = (template.type ?? 'upload') === 'agreement'
            const nextRequirement: RequiredDoc = {
                id: template.id,
                title: template.title,
                type: isAgreement ? 'agreement' : 'upload',
                isOnboarding: isAgreement || template.isOnboarding === true,
                hasExpiry: values.hasExpiry === true,
                expiryMonths: values.hasExpiry ? values.expiryMonths ?? null : null,
                ...(isAgreement
                    ? { agreementId: template.agreementId || template.id }
                    : { presetId: template.presetId || template.id })
            }

            setDraftRequirements(previous => {
                const next = previous.map(item => ({ ...item }))
                if (editingRequirementIndex === null) next.push(nextRequirement)
                else next[editingRequirementIndex] = nextRequirement
                return next
            })

            setDocumentEditorOpen(false)
            setEditingRequirementIndex(null)
            documentEditorForm.resetFields()
            setReqModalOpen(true)
        } catch {
            // Validation errors are shown by Ant Design Form.
        }
    }

    const removeDraftRequirement = (index: number) => {
        const requirement = draftRequirements[index]
        Modal.confirm({
            centered: true,
            title: 'Remove document?',
            content: `Remove ${requirement?.title || 'this document'} from this department's compliance setup?`,
            okText: 'Remove',
            okButtonProps: { danger: true },
            onOk: () => {
                setDraftRequirements(previous => previous.filter((_, itemIndex) => itemIndex !== index))
            }
        })
    }

    const openUploadFor = (participant: any, requiredId?: string) => {
        setManageTarget(participant)
        setUploadOpen(true)
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
        const task = uploadBytesResumable(storageRef2, f, withOwner({}, { participantId: pId, applicationId: app.id }))

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

        // The subcollection doc written above is the stored record, and on load it
        // takes precedence over any embedded entry with the same key, so only the
        // in-memory view changes here.
        setApps(prev => prev.map(a => a.id !== app.id ? a : {
            ...a,
            complianceDocuments: [
                ...(a.complianceDocuments || []).filter(
                    document => !(keyForDoc(document) === documentKey && document.programId === targetProgramId)
                ),
                newDoc
            ]
        }))

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
            romSignPlayback.start()
            setRomSignPreview(romSignatureFromProfile)

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

            // Let the signature finish drawing before the modal closes.
            await romSignPlayback.finished()
            message.success('Agreement signed with your saved signature.')
            setRomSignOpen(false)
            setRomSignTarget(null)
            setRomSignPreview('')
            romSignForm.resetFields()
        } catch (e) {
            console.error(e)
            setRomSignPreview('')
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
                if (smeCanAct(status)) {
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
            message.info('No SME has anything to upload, sign or correct.')
            return
        }

        const sendReminder = httpsCallable(functions, 'sendComplianceReminderEmail')
        const itemCount = entries.reduce((total, [, entry]) => total + entry.issues.length, 0)

        Modal.confirm({
            centered: true,
            title: `Send compliance reminders to ${entries.length} SME(s)?`,
            content: `Each SME is emailed the ${itemCount} item(s) they need to upload, sign or correct. Documents awaiting staff verification or a ROM signature are not included.`,
            okText: 'Send reminders',
            onOk: () => Promise.all(
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
        })
    }

    // The review buttons for one requirement in the detail panel. The status
    // itself is the card's tag, so only actions are rendered here.
    const renderRequirementActions = (participantId: string, entry: ComplianceEntry) => {
        const requirement = entry.requirement
        const d = entry.document
        const isAgreement = entry.kind === 'agreement'
        const isGapAgreement = normalize(requirement.agreementId || requirement.id) === 'gap-analysis'
        const isQueried = (d?.status || '').toLowerCase() === 'queried'
        const application = appByParticipant[participantId]
        const isManualApp = application?.manuallyCreated === true || application?.manualApplication === true
        const uploadTarget = { participantId, participantName: selectedView?.name || '' }
        const aiReview = currentAiReview(d)
        const aiDates = aiDateFields(entry)

        type DocAction = {
            key: string
            label: string
            icon?: React.ReactNode
            onClick: () => void
            danger?: boolean
            disabled?: boolean
            /** Why the action is disabled, or what it does. */
            hint?: string
            guide?: string
        }

        const openFile = async () => {
            const url = await resolveDocUrl(d)
            if (url) {
                window.open(url, '_blank', 'noopener,noreferrer')
                return
            }
            if (d && isPreIncubation(requirement, d)) {
                setPreIncViewer({ participantId, meta: d })
                return
            }
            message.warning('No document available.')
        }

        const canView = hasOpenableFile(d) || (d && isAgreement && isPreIncubation(requirement, d))
        const actions: Record<string, DocAction | null> = {
            upload: !isAgreement ? {
                key: 'upload',
                label: d ? 'Replace file' : 'Upload',
                icon: <UploadOutlined />,
                guide: 'upload-document-action',
                onClick: () => chooseRowFile(uploadTarget, requirement.id)
            } : null,
            download: d && (hasOpenableFile(d) || isAgreement) ? {
                key: 'download',
                label: 'Download',
                icon: <DownloadOutlined />,
                guide: 'download-document-action',
                onClick: () => isAgreement
                    ? downloadAgreement(participantId, requirement, d)
                    : downloadDocument(d, requirement.title)
            } : null,
            accept: d && !isAgreement && aiReview?.recommendation === 'valid' && entry.state === 'pending' ? {
                key: 'accept',
                label: 'Accept: valid',
                icon: <CheckCircleOutlined />,
                onClick: () => verifyDoc(participantId, entry.key, d.id)
            } : null,
            dates: d && !isAgreement && aiDates ? {
                key: 'dates',
                label: 'Use dates from file',
                icon: <FieldTimeOutlined />,
                hint: `Records ${Object.entries(aiDates)
                    .map(([field, value]) => `${field === 'issueDate' ? 'issue date' : 'expiry date'} ${dayjs(value).format('D MMM YYYY')}`)
                    .join(' and ')}, as read from the file.`,
                onClick: () => applyAiDates(participantId, entry)
            } : null,
            // Only a document awaiting verification can be verified; a valid one
            // already is, and a queried or invalid one needs the SME first.
            verify: d && !isAgreement && entry.state === 'pending' ? {
                key: 'verify',
                label: 'Verify',
                icon: <CheckCircleOutlined />,
                guide: 'verify-document-action',
                onClick: () => verifyDoc(participantId, entry.key, d.id)
            } : null,
            ai: d && !isAgreement ? {
                key: 'ai',
                label: aiVerifyingDocIds[d.id] ? 'AI checking…' : aiReview ? 'AI check again' : 'AI check',
                icon: <RobotOutlined />,
                disabled: !hasOpenableFile(d) || isQueried || !!aiVerifyingDocIds[d.id],
                hint: isQueried
                    ? 'Resolve the query before running an AI check.'
                    : 'AI reads the file and suggests whether it is valid, with its dates.',
                onClick: () => { void runAiVerification(participantId, entry.key, d.id) }
            } : null,
            reason: d && !isAgreement && isQueried ? {
                key: 'reason',
                label: 'Query reason',
                icon: <InfoCircleOutlined />,
                onClick: () => {
                    setViewReason({
                        title: d.documentName,
                        queryReason: d.queryReason || 'No reason recorded.'
                    })
                    setViewReasonOpen(true)
                }
            } : null,
            resolve: d && !isAgreement && isQueried ? {
                key: 'resolve',
                label: 'Resolve query',
                icon: <CheckCircleOutlined />,
                onClick: () => resolveQuery(participantId, entry.key, d.id)
            } : null,
            invalidate: d && !isAgreement && !isQueried ? {
                key: 'invalidate',
                label: 'Invalidate',
                icon: <CloseCircleOutlined />,
                danger: true,
                guide: 'invalidate-document-action',
                onClick: () => {
                    setReasonContext({ participantId, docKey: entry.key, subDocId: d.id })
                    setReasonStatus('invalid')
                    reasonForm.resetFields()
                    // Start from the AI's reason when it found a problem; staff can edit it.
                    if (aiReview && (aiReview.recommendation === 'invalid' || aiReview.recommendation === 'expired')) {
                        reasonForm.setFieldsValue({ reason: aiReview.reason })
                    }
                    setReasonOpen(true)
                }
            } : null,
            gap: isAgreement && d && !isManualApp && !isRomSigned(d) && isGapAgreement &&
                canSeeOnboardingDocuments && d.gapAnalysisId ? {
                key: 'gap',
                label: 'Review GAP',
                onClick: () => navigate(`/gap/${d.gapAnalysisId}`)
            } : null,
            romSign: isAgreement && d && !isManualApp && !isRomSigned(d) && !isGapAgreement && isROMDept ? {
                key: 'romSign',
                label: 'ROM Sign',
                icon: <FileProtectOutlined />,
                guide: 'rom-sign-agreement-action',
                onClick: () => {
                    setRomSignTarget({
                        participantId,
                        agreementId: requirement.agreementId || requirement.id
                    })
                    romSignForm.resetFields()
                    romSignForm.setFieldsValue({ romSignedBy: currentUser?.name || '' })
                    setRomSignOpen(true)
                }
            } : null
        }

        // One main button for the next step on this document; everything else
        // goes in the menu so the card stays readable.
        const primaryKey = !d
            ? 'upload'
            : isQueried
                ? 'resolve'
                : actions.accept
                    ? 'accept'
                    : actions.gap
                        ? 'gap'
                        : actions.romSign
                            ? 'romSign'
                            : ['invalid', 'expired', 'rejected'].includes(entry.state)
                                ? 'upload'
                                : entry.state === 'pending'
                                    ? 'verify'
                                    : null
        const primary = primaryKey ? actions[primaryKey] : null
        const menuOrder = [
            'accept', 'verify', 'dates', 'ai', 'reason', 'resolve', 'download', 'upload', 'invalidate'
        ]
        const menuActions = menuOrder
            .map(key => actions[key])
            .filter((action): action is DocAction => !!action && action.key !== primaryKey)

        return (
            <>
                {/* Only the next step is filled; View and More stay quiet. */}
                {canView && (
                    <Button size='small' type='text' icon={<EyeOutlined />} onClick={() => { void openFile() }}>
                        View
                    </Button>
                )}

                {primary && (
                    <Tooltip title={primary.hint}>
                        <Button
                            size='small'
                            type='primary'
                            data-guide={primary.guide}
                            icon={primary.icon}
                            disabled={primary.disabled}
                            onClick={primary.onClick}
                        >
                            {primary.label}
                        </Button>
                    </Tooltip>
                )}

                {menuActions.length > 0 && (
                    <Dropdown
                        trigger={['click']}
                        placement='bottomRight'
                        menu={{
                            items: menuActions.flatMap(action => [
                                ...(action.key === 'invalidate' ? [{ type: 'divider' as const }] : []),
                                {
                                    key: action.key,
                                    icon: action.icon,
                                    danger: action.danger,
                                    disabled: action.disabled,
                                    label: action.hint
                                        ? <Tooltip title={action.hint} placement='left'><span>{action.label}</span></Tooltip>
                                        : action.label,
                                    onClick: action.onClick
                                }
                            ])
                        }}
                    >
                        <Tooltip title='More actions'>
                            <Button
                                size='small'
                                type='text'
                                icon={<MoreOutlined />}
                                aria-label={`More actions for ${entry.title}`}
                            />
                        </Tooltip>
                    </Dropdown>
                )}
            </>
        )
    }

    const saveRequirements = async () => {
        setSavingReqs(true)
        try {
            const pid = activeProgramId
            if (!pid || isAllPrograms) throw new Error('Select one active program before configuring documents.')
            if (!currentUser?.departmentId) throw new Error('Missing department context.')

            const list = sanitizeTemplates(draftRequirements).filter(isRequirementVisibleToDepartment)
            const clean = stripUndefinedDeep({
                departmentId: currentUser.departmentId,
                departmentName: departmentInfo?.name || currentUser?.department || '',
                requiredDocuments: list,
                updatedAt: serverTimestamp()
            })

            await setDoc(
                doc(db, 'programs', pid, 'deptRequirements', currentUser.departmentId),
                clean,
                { merge: true }
            )

            if (pid === activeProgramId) setDeptRequired(list)
            setDraftRequirements(list.map(requirement => ({ ...requirement })))
            setReqModalOpen(false)
            message.success(
                list.length
                    ? 'Department-required documents saved.'
                    : 'Department document setup cleared.'
            )
        } catch (e: any) {
            console.error(e)
            message.error(e?.message || 'Failed to save requirements.')
        } finally {
            setSavingReqs(false)
        }
    }

    const manageTargetRequirements = manageTarget
        ? requirementsForPart(manageTarget.participantId)
        : []
    const hasManageTargetUploadRequirements = manageTargetRequirements.some(
        requirement => (requirement.type ?? 'upload') === 'upload'
    )

    const hasDepartmentRequirements = (deptRequired?.length || 0) > 0
    const showDepartmentSetupEmptyState = Boolean(
        activeProgramId &&
        !isAllPrograms &&
        deptRequired !== null &&
        !hasDepartmentRequirements
    )

    const selectedEditorTemplateKey = Form.useWatch('templateKey', documentEditorForm)
    const selectedEditorHasExpiry = Form.useWatch('hasExpiry', documentEditorForm)
    const editingRequirement = editingRequirementIndex === null
        ? null
        : draftRequirements[editingRequirementIndex]
    const usedRequirementKeys = new Set(
        draftRequirements
            .filter((_, index) => index !== editingRequirementIndex)
            .map(requirementOptionValue)
    )
    const editorTemplateOptions = availableRequirementTemplates.map(template => ({
        label: template.title,
        value: template.optionValue,
        disabled: usedRequirementKeys.has(template.optionValue)
    }))
    const selectedEditorTemplate = availableRequirementTemplates.find(
        template => template.optionValue === selectedEditorTemplateKey
    )

    const visibleEditorTemplateOptions = useMemo(() => {
        const currentTemplateKey = editingRequirement
            ? requirementOptionValue(editingRequirement)
            : null

        return editorTemplateOptions.filter(
            option =>
                !option.disabled ||
                option.value === currentTemplateKey
        )
    }, [editorTemplateOptions, editingRequirement])

    const pageLoading = loading || (!!activeProgramId && requirementsLoading)

    const selectView = (view: ComplianceView) => {
        setSelectedId(view.participantId)
        if (isMobile) setDrawerOpen(true)
    }

    const openEmailTemplate = () => {
        const targets = buildEmailTargets()
        if (!targets.length) {
            message.info('No SME has anything to upload, sign or correct.')
            return
        }
        setEmailTargets(targets)
        setEmailTemplatesOpen(true)
    }

    const confirmBatchVerification = () => {
        const smes = visibleViews.map(view => view.participantId)
        Modal.confirm({
            centered: true,
            title: 'Run AI verification for the SMEs shown?',
            content: `This checks the uploaded documents awaiting verification across ${smes.length} SME(s) shown here. Each check may use an AI request, so this can take a while and consume shared AI quota.`,
            okText: 'Run AI verification',
            onOk: () => runBatchVerification(smes, 'the SMEs shown')
        })
    }

    // A reminder to one SME, listing only what they can act on.
    const remindParticipant = (view: ComplianceView) => {
        const issues = entriesForPart(view.participantId)
            .filter(entry => smeCanAct(entry.state))
            .map(entry => `${entry.title} (${complianceStatusLabel(entry.state)})`)
        if (!issues.length) {
            message.info(`${view.name} has nothing to upload, sign or correct.`)
            return
        }
        if (!view.email) {
            message.warning(`${view.name} has no email address on record.`)
            return
        }
        Modal.confirm({
            centered: true,
            title: `Send ${view.name} a compliance reminder?`,
            content: (
                <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                    {issues.map(issue => <li key={issue}>{issue}</li>)}
                </ul>
            ),
            okText: 'Send reminder',
            onOk: async () => {
                try {
                    await httpsCallable(functions, 'sendComplianceReminderEmail')({
                        email: view.email,
                        name: view.name,
                        issues,
                        programName: view.programName !== '—' ? view.programName : programName,
                        participantId: view.participantId,
                        programId: view.programId || activeProgramId || ''
                    })
                    message.success(`Reminder sent to ${view.name}`)
                } catch (error) {
                    console.error(error)
                    message.error(`Failed to send to ${view.name}`)
                }
            }
        })
    }

    // Files of the selected SME awaiting verification that have no AI suggestion yet.
    const selectedAiPending = selectedView ? collectVerifiableDocs([selectedView.participantId]).length : 0
    const confirmSmeVerification = (view: ComplianceView) => {
        Modal.confirm({
            centered: true,
            title: `Run an AI check on ${view.name}'s documents?`,
            content: `AI reads the ${selectedAiPending} file(s) awaiting verification and suggests whether each is valid. Nothing changes until you accept a suggestion.`,
            okText: 'Run AI check',
            onOk: () => runBatchVerification([view.participantId], view.name)
        })
    }

    const complianceTiles: {
        segment: ComplianceFilterState['segment']
        title: string
        mobileTitle: string
        tone: MetricTone
        icon: React.ReactNode
        value: number
    }[] = [
        {
            segment: 'all',
            title: 'SMEs in scope',
            mobileTitle: 'SMEs',
            tone: 'accent',
            icon: <TeamOutlined />,
            value: tileCounts.all,
        },
        {
            segment: 'action',
            title: 'Need SME action',
            mobileTitle: 'SME action',
            tone: 'danger',
            icon: <WarningOutlined />,
            value: tileCounts.action,
        },
        {
            segment: 'review',
            title: 'Awaiting staff review',
            mobileTitle: 'To review',
            tone: 'info',
            icon: <FileSearchOutlined />,
            value: tileCounts.review,
        },
        {
            segment: 'expiring',
            title: 'Expiring within 30 days',
            mobileTitle: 'Expiring',
            tone: 'warning',
            icon: <FieldTimeOutlined />,
            value: tileCounts.expiring,
        },
        {
            segment: 'compliant',
            title: 'Fully compliant',
            mobileTitle: 'Compliant',
            tone: 'success',
            icon: <SafetyCertificateOutlined />,
            value: tileCounts.compliant,
        }
    ]

    const toolbarActions = (
        <>
            <Dropdown
                trigger={['click']}
                menu={{
                    items: [
                        {
                            key: 'quick',
                            icon: <MailOutlined />,
                            label: 'Quick reminders',
                            onClick: () => { void handleSendReminders() }
                        },
                        {
                            key: 'template',
                            icon: <FileTextOutlined />,
                            label: 'Email from a template…',
                            onClick: openEmailTemplate
                        }
                    ]
                }}
            >
                <Button className='ws-toolbar-button' data-guide='email-compliance-reminders' icon={<MailOutlined />}>
                    Remind SMEs
                </Button>
            </Dropdown>

            <Button
                className='ws-toolbar-button'
                data-guide='bulk-ai-compliance'
                icon={<RobotOutlined />}
                loading={aiBatchRunning}
                disabled={aiBatchRunning || visibleViews.length === 0}
                onClick={confirmBatchVerification}
            >
                {aiBatchRunning && aiBatchProgress
                    ? `Verifying ${aiBatchProgress.done}/${aiBatchProgress.total}…`
                    : 'AI verify'}
            </Button>

            {/* M&E tracks the programme list, so it has no department setup. */}
            {!tracksWholeProgramme && (
                <Button
                    className='ws-toolbar-button'
                    data-guide='setup-compliance-documents'
                    icon={<SettingOutlined />}
                    disabled={!activeProgramId || isAllPrograms}
                    title={
                        !activeProgramId || isAllPrograms
                            ? 'Select one active program to configure its documents.'
                            : undefined
                    }
                    onClick={openRequirementsManager}
                >
                    Setup
                </Button>
            )}
        </>
    )

    const detailPanel = selectedView ? (
        <ComplianceDetail
            view={selectedView}
            entries={entriesForPart(selectedView.participantId)}
            renderActions={entry => renderRequirementActions(selectedView.participantId, entry as ComplianceEntry)}
            extraTags={isROMDept ? (
                <Tag color={selectedView.moaSigned ? 'green' : 'orange'}>
                    {selectedView.moaSigned ? 'MOA signed' : 'MOA unsigned'}
                </Tag>
            ) : null}
            headerActions={
                <>
                    <Button
                        data-guide='upload-compliance-action'
                        icon={<UploadOutlined />}
                        onClick={() => openUploadFor({
                            participantId: selectedView.participantId,
                            participantName: selectedView.name
                        })}
                    >
                        Upload
                    </Button>
                    <Button icon={<MailOutlined />} onClick={() => remindParticipant(selectedView)}>
                        Remind
                    </Button>
                    <Tooltip
                        title={selectedAiPending
                            ? undefined
                            : 'Every uploaded file awaiting verification already has an AI suggestion.'}
                    >
                        <Button
                            icon={<RobotOutlined />}
                            loading={aiBatchRunning}
                            disabled={aiBatchRunning || !selectedAiPending}
                            onClick={() => confirmSmeVerification(selectedView)}
                        >
                            {selectedAiPending ? `AI check (${selectedAiPending})` : 'AI check'}
                        </Button>
                    </Tooltip>
                </>
            }
        />
    ) : null

    if (activeTrainingId) {
        return (
            <div style={{ minHeight: '100vh', background: token.colorBgLayout, color: token.colorText, padding: 24 }}>
                <TrainingComplianceView key={activeTrainingId} trainingId={activeTrainingId} />
            </div>
        )
    }

    return (
        <div
            className='ws-page'
            style={{ minHeight: '100vh', background: token.colorBgLayout, color: token.colorText }}
        >
            <Helmet>
                <title>Compliance Management | Smart Incubation</title>
            </Helmet>

            {(
                <>
                    {!pageLoading && showDepartmentSetupEmptyState ? (
                        <MotionCard>
                            <Result
                                status='info'
                                icon={<FileProtectOutlined style={{ color: token.colorPrimary }} />}
                                title='No compliance documents configured'
                                subTitle={`${departmentInfo?.name || currentUser?.department || 'This department'} has no document requirements configured for ${programName}.`}
                                extra={
                                    <Button
                                        data-guide='setup-compliance-documents'
                                        type='primary'
                                        shape='round'
                                        icon={<SettingOutlined />}
                                        onClick={openRequirementsManager}
                                    >
                                        Setup Documents
                                    </Button>
                                }
                            />
                        </MotionCard>
                    ) : (
                        <>
                            <Row data-guide='compliance-metrics' gutter={[12, 12]} style={{ marginBottom: 12 }}>
                                {complianceTiles.map(tile => (
                                    <Col key={tile.segment} xs={12} md={8} lg={{ flex: '1 1 0' }} style={{ minWidth: 0 }}>
                                        <MetricTile
                                            icon={tile.icon}
                                            tone={tile.tone}
                                            title={tile.title}
                                            mobileTitle={tile.mobileTitle}
                                            value={tile.value}
                                            loading={pageLoading}
                                            compact={isMobile}
                                        />
                                    </Col>
                                ))}
                            </Row>

                            <ComplianceFilters
                                filters={filters}
                                onChange={patchFilters}
                                programmeOptions={isAllPrograms ? programmeOptions : []}
                                branchOptions={branchOptions}
                                groupOptions={groupOptions}
                                documentOptions={documentOptions}
                                actions={toolbarActions}
                            />

                            <div className='ws-layout'>
                                <ComplianceList
                                    views={visibleViews}
                                    loading={pageLoading}
                                    selectedId={selectedId}
                                    onSelect={selectView}
                                    sort={filters.sort}
                                    onSortChange={sort => patchFilters({ sort })}
                                    showProgramme={isAllPrograms}
                                    resetKey={`${filters.search}|${filters.segment}|${filters.programme}|${filters.branch}|${filters.group}|${filters.document}`}
                                    emptyText={views.length
                                        ? 'No SMEs match these filters'
                                        : isAllPrograms
                                            ? 'No onboarded SMEs across the available programmes'
                                            : 'No onboarded SMEs in this programme'}
                                />

                                {!isMobile && (
                                    <div className='ws-detail-sticky'>
                                        {detailPanel || (
                                            <MotionCard loading={pageLoading} skeleton='text' skeletonRows={8}>
                                                <Empty
                                                    className='ws-detail-empty'
                                                    description={views.length
                                                        ? 'Select an SME to review their documents'
                                                        : 'No SMEs to review yet'}
                                                />
                                            </MotionCard>
                                        )}
                                    </div>
                                )}
                            </div>

                            {isMobile && (
                                <Drawer
                                    className='ws-drawer'
                                    open={drawerOpen && !!selectedView}
                                    onClose={() => setDrawerOpen(false)}
                                    placement='right'
                                    width='100%'
                                    title={selectedView?.name || 'SME'}
                                >
                                    {detailPanel}
                                </Drawer>
                            )}
                        </>
                    )}

                    <Modal
                        className='guide-setup-compliance-modal'
                        centered
                        title='Setup Documents'
                        open={reqModalOpen}
                        onCancel={() => {
                            setReqModalOpen(false)
                            setDraftRequirements(
                                effectiveRequired.map(requirement => ({ ...requirement }))
                            )
                        }}
                        width={820}
                        styles={{
                            body: {
                                maxHeight: '68vh',
                                overflowY: 'auto',
                                overflowX: 'hidden',
                                paddingRight: 4
                            }
                        }}
                        footer={
                            <div
                                style={{
                                    display: 'flex',
                                    gap: 12,
                                    width: '100%'
                                }}
                            >
                                <Button
                                    block
                                    shape='round'
                                    style={{ flex: 1 }}
                                    onClick={() => {
                                        setReqModalOpen(false)
                                        setDraftRequirements(
                                            effectiveRequired.map(requirement => ({ ...requirement }))
                                        )
                                    }}
                                    disabled={savingReqs}
                                >
                                    Cancel
                                </Button>

                                <Button
                                    className='guide-save-compliance-documents'
                                    type='primary'
                                    block
                                    shape='round'
                                    style={{ flex: 1 }}
                                    onClick={saveRequirements}
                                    loading={savingReqs}
                                >
                                    {savingReqs ? 'Saving…' : 'Save Documents'}
                                </Button>
                            </div>
                        }
                    >
                        <Space
                            direction='vertical'
                            size={18}
                            style={{ width: '100%' }}
                        >
                            <div>
                                <Text
                                    strong
                                    style={{
                                        display: 'block',
                                        fontSize: 16
                                    }}
                                >
                                    {departmentInfo?.name ||
                                        currentUser?.department ||
                                        'Department'} requirements
                                </Text>

                                <Text type='secondary'>
                                    Manage the documents this department monitors for {programName}.
                                </Text>
                            </div>

                            <Row gutter={[12, 12]}>
                                {draftRequirements.map((requirement, index) => (
                                    <Col
                                        xs={24}
                                        md={12}
                                        key={`${requirementOptionValue(requirement)}-${index}`}
                                    >
                                        <Card
                                            size='small'
                                            styles={{
                                                body: {
                                                    padding: 14,
                                                    height: '100%'
                                                }
                                            }}
                                            style={{
                                                height: '100%',
                                                borderRadius: 12,
                                                borderColor: token.colorBorderSecondary,
                                                background: token.colorBgContainer
                                            }}
                                        >
                                            <div
                                                style={{
                                                    display: 'flex',
                                                    flexDirection: 'column',
                                                    gap: 12,
                                                    minWidth: 0
                                                }}
                                            >
                                                {/* Document */}
                                                <div
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: 10,
                                                        minWidth: 0
                                                    }}
                                                >
                                                    <IconChip
                                                        size={38}
                                                        radius={11}
                                                        bg={token.colorFillSecondary}
                                                        icon={
                                                            <FileTextOutlined
                                                                style={{
                                                                    color: token.colorPrimary
                                                                }}
                                                            />
                                                        }
                                                    />

                                                    <div
                                                        style={{
                                                            minWidth: 0,
                                                            flex: 1
                                                        }}
                                                    >
                                                        <Text
                                                            strong
                                                            ellipsis={{
                                                                tooltip: requirement.title
                                                            }}
                                                            style={{
                                                                display: 'block',
                                                                fontSize: 13
                                                            }}
                                                        >
                                                            {requirement.title}
                                                        </Text>
                                                    </div>
                                                </div>

                                                {/* Metadata + Actions */}
                                                <div
                                                    style={{
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        justifyContent: 'space-between',
                                                        flexWrap: 'wrap',
                                                        gap: 8,
                                                        width: '100%'
                                                    }}
                                                >
                                                    <div
                                                        style={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            flexWrap: 'wrap',
                                                            gap: 6,
                                                            minWidth: 0
                                                        }}
                                                    >
                                                        <Tag
                                                            color={
                                                                (requirement.type ?? 'upload') === 'agreement'
                                                                    ? 'purple'
                                                                    : 'blue'
                                                            }
                                                            style={{
                                                                marginInlineEnd: 0,
                                                                borderRadius: 999
                                                            }}
                                                        >
                                                            {(requirement.type ?? 'upload') === 'agreement'
                                                                ? 'Agreement'
                                                                : 'Upload'}
                                                        </Tag>

                                                        <Tag
                                                            style={{
                                                                marginInlineEnd: 0,
                                                                borderRadius: 999
                                                            }}
                                                        >
                                                            {requirement.hasExpiry
                                                                ? `${requirement.expiryMonths || '—'} month expiry`
                                                                : 'No expiry'}
                                                        </Tag>
                                                    </div>

                                                    <div
                                                        style={{
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: 6,
                                                            marginLeft: 'auto'
                                                        }}
                                                    >
                                                        <Tooltip title='Edit document'>
                                                            <Button
                                                                size='small'
                                                                shape='circle'
                                                                icon={<EditOutlined />}
                                                                onClick={() => openDocumentEditor(index)}
                                                                style={{
                                                                    borderColor: token.colorBorder,
                                                                    color: token.colorPrimary
                                                                }}
                                                            />
                                                        </Tooltip>

                                                        <Tooltip title='Delete document'>
                                                            <Button
                                                                size='small'
                                                                shape='circle'
                                                                danger
                                                                icon={<DeleteOutlined />}
                                                                onClick={() =>
                                                                    removeDraftRequirement(index)
                                                                }
                                                            />
                                                        </Tooltip>
                                                    </div>
                                                </div>
                                            </div>
                                        </Card>
                                    </Col>
                                ))}

                                <Col xs={24} md={12}>
                                    <Button
                                        data-guide='add-compliance-document'
                                        type='dashed'
                                        block
                                        onClick={() => openDocumentEditor(null)}
                                        style={{
                                            minHeight: 92,
                                            height: '100%',
                                            borderRadius: 12,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            flexDirection: 'column',
                                            gap: 8
                                        }}
                                    >
                                        <PlusOutlined style={{ fontSize: 20 }} />
                                        <span>Add Document</span>
                                    </Button>
                                </Col>
                            </Row>

                            {!draftRequirements.length && (
                                <Text
                                    type='secondary'
                                    style={{
                                        display: 'block',
                                        textAlign: 'center'
                                    }}
                                >
                                    No documents have been added yet. Add the first document to
                                    begin monitoring compliance.
                                </Text>
                            )}
                        </Space>
                    </Modal>

                    <Modal
                        className='guide-document-editor-modal'
                        centered
                        title={
                            editingRequirement
                                ? 'Edit Required Document'
                                : 'Add Required Document'
                        }
                        open={documentEditorOpen}
                        onCancel={closeDocumentEditor}
                        width={540}
                        footer={
                            <div
                                style={{
                                    display: 'flex',
                                    gap: 12,
                                    width: '100%'
                                }}
                            >
                                <Button
                                    block
                                    shape='round'
                                    style={{ flex: 1 }}
                                    onClick={closeDocumentEditor}
                                >
                                    Cancel
                                </Button>

                                <Button
                                    data-guide='save-compliance-document-draft'
                                    type='primary'
                                    block
                                    shape='round'
                                    style={{ flex: 1 }}
                                    onClick={saveDocumentDraft}
                                >
                                    {editingRequirement
                                        ? 'Update Document'
                                        : 'Add Document'}
                                </Button>
                            </div>
                        }
                    >
                        <Form
                            form={documentEditorForm}
                            layout='vertical'
                            requiredMark={false}
                        >
                            <Form.Item
                                name='templateKey'
                                label='Document Title'
                                rules={[
                                    {
                                        required: true,
                                        message: 'Select a document.'
                                    }
                                ]}
                            >
                                <Select
                                    showSearch
                                    optionFilterProp='label'
                                    placeholder={
                                        visibleEditorTemplateOptions.length
                                            ? 'Select document'
                                            : 'No documents available'
                                    }
                                    options={visibleEditorTemplateOptions}
                                    disabled={!visibleEditorTemplateOptions.length}
                                />
                            </Form.Item>

                            {selectedEditorTemplate && (
                                <Alert
                                    type='info'
                                    showIcon
                                    style={{
                                        marginBottom: 18,
                                        borderRadius: 10
                                    }}
                                    message={
                                        (selectedEditorTemplate.type ?? 'upload') === 'agreement'
                                            ? 'Agreement document'
                                            : 'Upload document'
                                    }
                                    description={
                                        (selectedEditorTemplate.type ?? 'upload') === 'agreement'
                                            ? 'The SME completes this document through the agreement workflow.'
                                            : 'The SME or authorised staff can upload this document for compliance review.'
                                    }
                                />
                            )}

                            <div
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    gap: 16,
                                    marginBottom: selectedEditorHasExpiry ? 18 : 0,
                                    padding: '4px 0'
                                }}
                            >
                                <Text strong>
                                    Does this document expire?
                                </Text>

                                <Form.Item
                                    name='hasExpiry'
                                    noStyle
                                >
                                    <Radio.Group>
                                        <Radio value={true}>
                                            Yes
                                        </Radio>

                                        <Radio value={false}>
                                            No
                                        </Radio>
                                    </Radio.Group>
                                </Form.Item>
                            </div>

                            {selectedEditorHasExpiry && (
                                <Form.Item
                                    name='expiryMonths'
                                    label='Expiry Period'
                                    rules={[
                                        {
                                            required: true,
                                            message: 'Enter the expiry period in months.'
                                        }
                                    ]}
                                >
                                    <InputNumber
                                        min={1}
                                        precision={0}
                                        addonAfter='months'
                                        style={{ width: '100%' }}
                                        placeholder='e.g. 12'
                                    />
                                </Form.Item>
                            )}
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
                        // Mounted up front, so the AI's reason can be filled in before it opens.
                        forceRender
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
                            setRomSignPreview('')
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
                        <SignatureStage
                            src={romSignPreview}
                            animate={Boolean(romSignPreview)}
                            onComplete={romSignPlayback.complete}
                        />
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
                                ? `${functionsBaseUrl}/sendEmail`
                                : 'https://oauth.lepharosmartinc.co.za/sendEmail'
                        }
                    />
                </>
            )}
        </div>
    )
}

export default ComplianceTrackingPage
