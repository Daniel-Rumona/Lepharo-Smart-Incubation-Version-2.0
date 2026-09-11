import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
    App,
    Form,
    Input,
    Table,
    Button,
    Tag,
    Modal,
    Typography,
    Divider,
    Select,
    Space,
    DatePicker,
    Row,
    Col,
    Alert,
    Card,
    Upload,
    Segmented,
    Tooltip,
    Dropdown,
    Skeleton,
    Grid,
    Avatar
} from 'antd'
import {
    EyeOutlined,
    QuestionCircleOutlined,
    CheckOutlined,
    CloseOutlined,
    UploadOutlined,
    FileDoneOutlined,
    CheckCircleOutlined,
    ExclamationCircleOutlined,
    FileSearchOutlined,
    SendOutlined,
    DownloadOutlined,
    ReloadOutlined,
    InboxOutlined,
    DownOutlined
} from '@ant-design/icons'
import {
    collection,
    getDocs,
    addDoc,
    where,
    query,
    doc,
    updateDoc,
    getDoc,
    limit as qlimit
} from 'firebase/firestore'
import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import dayjs, { Dayjs } from 'dayjs'
import { saveAs } from 'file-saver'
import { motion } from 'framer-motion'
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage'
import { Packer } from 'docx'
import { buildMovDoc, buildConsolidatedDoc } from '@/docx/movBuilder'
import { MovDocumentView } from '@/components/movs/MovDocumentView'
import { PreIncPoeButton } from '@/components/movs/PreIncPoeButton'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { MetricsGrid } from '@/components/dashboards/metrics/MetricsGrid'
import { MovDoc, ConsolidatedPack, chunk } from '@/types/mov'

import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { LoadingOverlay } from '@/components/shared/LoadingOverlay'
import { USE_SENSITIVE_DEPARTMENT_SUMMARY_INSTEAD_OF_POE } from '@/config/evidencePolicy'
import { Helmet } from 'react-helmet'
import { workflowQueryService } from '@/services/workflowQueryService'
import {
    getPreIncAgreementUrl,
    hasPreIncAgreementEvidence,
    isOnboardingMov,
    isSmeConfirmedMov,
    resolveMovAppointmentInterventions,
    resolveMovKpiNames
} from '@/services/movService'
import { filterMovRecords } from '@/utils/reportVisibility'
import {
    guideTarget,
    usePageGuides,
    type PageGuideRegistration
} from '@/components/guide-me'

const { Title, Text } = Typography
const { Option } = Select
const { RangePicker } = DatePicker
const { useBreakpoint } = Grid

type PoeResource = { type?: string; label?: string; link: string }

const safeToDate = (v: any): Date | null => {
    if (!v) return null
    if (typeof v?.toDate === 'function') return v.toDate()
    const d = new Date(v)
    return isNaN(+d) ? null : d
}

async function getFirst<T = any>(qy: any): Promise<(T & { id: string }) | null> {
    const snap = await getDocs(qy)
    if (snap.empty) return null
    const d = snap.docs[0]
    return { id: d.id, ...(d.data() as any) }
}

function collectPoeUrlsFromRecord(record?: any, qiEntry?: any): string[] {
    return Array.isArray(record?.resources)
        ? Array.from(new Set(record.resources.map((resource: any) => resource?.link || resource?.url || resource?.href).filter(Boolean)))
        : []
}

const normalizeMovText = (value: any) =>
    String(value ?? '').trim().toLowerCase()

const extractEvidenceNotes = (record?: any): string => {
    if (!record) return ''

    return (
        record.consultantNotes ||
        record.interventionSummary ||
        record.summary ||
        record.notes ||
        record.evidenceNotes ||
        ''
    ).toString().trim()
}

async function resolveKpiNamesByInterventionId(interventionId?: string): Promise<string> {
    return resolveMovKpiNames(db, interventionId)
}

function hasDeliveryPayload(obj: any): boolean {
    if (!obj) return false
    const dm = obj.deliveryMethod ?? obj.method
    const dms = obj.deliveryMethods
    if (typeof dm === 'string' && dm.trim()) return true
    if (Array.isArray(dm) && dm.length) return true
    if (Array.isArray(dms) && dms.length) return true
    return false
}

function parseDeliveryFlags(ai: any, existing: any) {
    const srcObj = hasDeliveryPayload(ai) ? ai : existing
    const raw = (srcObj?.deliveryMethod ?? srcObj?.method ?? '').toString().toLowerCase()
    const src = raw.replace(/_/g, ' ')
    const arr = Array.isArray(srcObj?.deliveryMethods)
        ? srcObj.deliveryMethods.map((x: any) => String(x).toLowerCase())
        : []
    const mArr = Array.isArray(srcObj?.method)
        ? srcObj.method.map((x: any) => String(x).toLowerCase())
        : []

    const has = (s: string) => src.includes(s) || arr.includes(s) || mArr.includes(s)

    let methodInPerson =
        existing?.methodInPerson ?? (src === 'in-person' || src === 'in person')
    let methodOnline = existing?.methodOnline ?? src === 'online'
    let methodTelephonic = existing?.methodTelephonic ?? src === 'telephonic'

    if (!methodInPerson) {
        methodInPerson =
            has('in_person') || has('in person') || has('physical') || has('onsite')
    }

    if (!methodOnline) {
        methodOnline = has('online') || has('virtual') || has('remote')
    }

    if (!methodTelephonic) {
        methodTelephonic =
            has('telephonic') || has('telephone') || has('phone') || has('call')
    }

    let methodOther = existing?.methodOther ?? ''
    if (!methodInPerson && !methodOnline && !methodTelephonic) {
        methodOther = src || (arr[0] ?? mArr[0] ?? '')
    }

    return { methodInPerson, methodOnline, methodTelephonic, methodOther }
}

type FrequencyUI = MovDoc['frequency'] | 'once'

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
    const v =
        obj.isRecurring ??
        obj.recurring ??
        obj.isRecurrent ??
        obj.recurrenceEnabled ??
        obj.enableRecurrence ??
        obj.isRepeatable

    return typeof v === 'boolean' ? v === false : false
}

async function resolveFrequencyByInterventionId(
    interventionId?: string
): Promise<FrequencyUI | undefined> {
    if (!interventionId) return undefined

    let interDoc: any = null

    try {
        const alt = await getDoc(doc(db, 'interventions', String(interventionId)))
        if (alt.exists()) interDoc = { id: alt.id, ...(alt.data() as any) }
    } catch { /* no definition available */ }

    if (!interDoc) return undefined
    if (isExplicitlyNonRecurring(interDoc)) return 'once'

    const raw =
        interDoc.frequency ??
        interDoc.recurrence ??
        interDoc.recurrenceFrequency ??
        interDoc.interval ??
        interDoc.scheduleFrequency ??
        interDoc.repeat ??
        ''

    return parseFrequency(raw)
}

const stripUndefinedDeep = (value: any): any => {
    if (value === undefined) return undefined
    if (value === null) return null

    if (value instanceof Date) return value

    if (value && typeof value === 'object' && typeof value.toDate === 'function') {
        return value
    }

    if (Array.isArray(value)) {
        return value.map(stripUndefinedDeep).filter(v => v !== undefined)
    }

    if (value && typeof value === 'object') {
        const out: any = {}
        Object.entries(value).forEach(([key, val]) => {
            const cleaned = stripUndefinedDeep(val)
            if (cleaned !== undefined) out[key] = cleaned
        })
        return out
    }

    return value
}

const clip = (s?: string) => (s ? `${s.slice(0, 10)}…${s.slice(-6)}` : '—')

const MOVApprovalsForm: React.FC = () => {
    const screens = useBreakpoint()
    const { user } = useFullIdentity()
    const userRole = (user?.role || '').toLowerCase()
    const isHOD = userRole === 'operations'
    const { activeProgramId } = useActiveProgramId()
    const { message } = App.useApp()

    const guideRegistration = useMemo<PageGuideRegistration>(
        () => ({
            pageId: 'mov-approvals',
            pageTitle: 'MOV Submission',
            guides: [
                {
                    id: 'mov-approvals-overview',
                    title: 'Quick tour',
                    description:
                        'Understand the MOV review workspace, filters, approval status and consolidated submission area.',
                    kind: 'page',
                    order: 1,
                    steps: [
                        {
                            element: guideTarget('mov-metrics'),
                            popover: {
                                title: 'MOV overview',
                                description:
                                    'These metrics summarise the current MOV or consolidated-pack view for the selected programme.',
                                side: 'bottom',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('mov-view-switch'),
                            popover: {
                                title: 'MOVs and consolidated packs',
                                description:
                                    'Switch between individual MOV documents that need review and monthly consolidated MOV packs.',
                                side: 'bottom',
                                align: 'center'
                            }
                        },
                        {
                            element: guideTarget('mov-filter-bar'),
                            popover: {
                                title: 'Filter the workspace',
                                description:
                                    'For MOVs you can filter by facilitator, beneficiary, assignment date and completion date. Consolidated packs use a month filter.',
                                side: 'bottom',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('mov-main-table'),
                            popover: {
                                title: 'Review records',
                                description:
                                    'Use the table to open MOVs, check query status, or manage monthly consolidated packs.',
                                side: 'top',
                                align: 'start'
                            }
                        }
                    ]
                },
                {
                    id: 'review-mov',
                    title: 'Review an MOV',
                    description:
                        'Open an MOV, inspect the confirmation sheet and evidence, then approve it or raise a query.',
                    kind: 'task',
                    order: 2,
                    steps: [
                        {
                            element: '[data-guide="mov-view-action"]',
                            advanceOnClick: true,
                            popover: {
                                title: 'Open an MOV',
                                description:
                                    'Select View on the MOV you want to review.',
                                side: 'left',
                                align: 'center',
                                showButtons: ['close']
                            }
                        },
                        {
                            element: '.guide-mov-preview-modal',
                            waitForElement: 12000,
                            popover: {
                                title: 'MOV document preview',
                                description:
                                    'Review the completed confirmation sheet before deciding whether to approve it or send it back for correction.',
                                side: 'left',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('mov-document-ready'),
                            waitForElement: 15000,
                            popover: {
                                title: 'Confirmation sheet',
                                description:
                                    'The MOV is now fully loaded. Check the beneficiary, intervention, session details, signatures and other MOV information shown in the document.',
                                side: 'right',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('mov-preview-actions'),
                            waitForElement: 5000,
                            popover: {
                                title: 'Review actions',
                                description:
                                    'From here you can inspect POE, approve the MOV, raise a query, or download the confirmation sheet.',
                                side: 'top',
                                align: 'center'
                            }
                        },
                        {
                            element: '[data-guide="mov-approve-action"]',
                            waitForElement: 1200,
                            skipMissingElement: true,
                            popover: {
                                title: 'Approve',
                                description:
                                    'Approve when the MOV and supporting evidence are correct. Only the appropriate HOD/Operations role can approve.',
                                side: 'top',
                                align: 'center'
                            }
                        },
                        {
                            element: '[data-guide="mov-query-action"]',
                            waitForElement: 1200,
                            skipMissingElement: true,
                            popover: {
                                title: 'Raise a query',
                                description:
                                    'Use Query when the MOV or evidence needs correction. The facilitator will receive the issue and can respond through the workflow.',
                                side: 'top',
                                align: 'center'
                            }
                        }
                    ]
                },
                {
                    id: 'raise-mov-query',
                    title: 'Raise an MOV query',
                    description:
                        'Send an MOV back to the facilitator with a clear issue that needs correction.',
                    kind: 'task',
                    order: 3,
                    steps: [
                        {
                            element: '[data-guide="mov-query-action"]',
                            advanceOnClick: true,
                            popover: {
                                title: 'Query the MOV',
                                description:
                                    'Select Query from an open MOV preview.',
                                side: 'top',
                                align: 'center',
                                showButtons: ['close']
                            }
                        },
                        {
                            element: '.guide-raise-query-modal',
                            waitForElement: 5000,
                            popover: {
                                title: 'Raise Query',
                                description:
                                    'Choose the type of issue and explain specifically what the facilitator needs to correct.',
                                side: 'left',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('mov-query-form'),
                            waitForElement: 5000,
                            popover: {
                                title: 'Describe the issue',
                                description:
                                    'Select the closest issue type and provide enough detail for the facilitator to understand the required correction.',
                                side: 'right',
                                align: 'start'
                            }
                        },
                        {
                            element: '.guide-raise-query-submit',
                            waitForElement: 5000,
                            popover: {
                                title: 'Send the query',
                                description:
                                    'Send the query when the issue is clear. The MOV returns to the facilitator workflow for correction.',
                                side: 'top',
                                align: 'center'
                            }
                        }
                    ]
                },
                {
                    id: 'submit-consolidated-movs',
                    title: 'Submit monthly MOVs',
                    description:
                        'Generate a monthly consolidated pack from approved MOVs that have supporting evidence.',
                    kind: 'task',
                    order: 4,
                    steps: [
                        {
                            element: guideTarget('submit-movs-action'),
                            advanceOnClick: true,
                            popover: {
                                title: 'Submit MOVs',
                                description:
                                    'Open the monthly submission flow once MOVs have been reviewed and approved.',
                                side: 'bottom',
                                align: 'end',
                                showButtons: ['close']
                            }
                        },
                        {
                            element: '.guide-submit-movs-modal',
                            waitForElement: 5000,
                            popover: {
                                title: 'Choose the month',
                                description:
                                    'Only months containing approved MOVs with POE can be selected. Months already packed are blocked.',
                                side: 'left',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('submit-movs-month'),
                            waitForElement: 5000,
                            popover: {
                                title: 'Submission month',
                                description:
                                    'Select the month whose eligible MOVs should be included in the consolidated pack.',
                                side: 'right',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('submit-movs-invoice'),
                            waitForElement: 5000,
                            popover: {
                                title: 'Invoice',
                                description:
                                    'Attach an invoice when one should accompany this monthly pack.',
                                side: 'right',
                                align: 'start'
                            }
                        },
                        {
                            element: '.guide-generate-pack-submit',
                            waitForElement: 5000,
                            popover: {
                                title: 'Generate the preview',
                                description:
                                    'Generate the pack to review exactly which approved MOVs will be submitted.',
                                side: 'top',
                                align: 'center'
                            }
                        }
                    ]
                },
                {
                    id: 'review-consolidated-pack',
                    title: 'Review consolidated MOVs',
                    description:
                        'Inspect submitted monthly packs, approvals, invoices, POEs and pack queries.',
                    kind: 'task',
                    order: 5,
                    steps: [
                        {
                            element: guideTarget('consolidated-movs-option'),
                            advanceOnClick: true,
                            popover: {
                                title: 'Open consolidated MOVs',
                                description:
                                    'Switch to Consolidated MOVs to see submitted monthly packs.',
                                side: 'bottom',
                                align: 'center',
                                showButtons: ['close']
                            }
                        },
                        {
                            element: guideTarget('mov-main-table'),
                            waitForElement: 5000,
                            popover: {
                                title: 'Submitted packs',
                                description:
                                    'Review each pack by month, approval state, included MOV count, invoice and query status.',
                                side: 'top',
                                align: 'start'
                            }
                        },
                        {
                            element: '[data-guide="view-pack-action"]',
                            waitForElement: 1500,
                            advanceOnClick: true,
                            skipMissingElement: true,
                            popover: {
                                title: 'View Pack',
                                description:
                                    'Open a pack to inspect its approvals, included MOVs, signatures, POEs and invoice.',
                                side: 'left',
                                align: 'center',
                                showButtons: ['close']
                            }
                        },
                        {
                            element: '.guide-pack-modal',
                            waitForElement: 5000,
                            skipMissingElement: true,
                            popover: {
                                title: 'Consolidated pack',
                                description:
                                    'This is the monthly pack snapshot submitted through the MOV approval workflow.',
                                side: 'left',
                                align: 'start'
                            }
                        }
                    ]
                }
            ]
        }),
        []
    )

    usePageGuides(guideRegistration)

    const [form] = Form.useForm()

    const [invoiceDecisionOpen, setInvoiceDecisionOpen] = useState(false)
    const [packEditOpen, setPackEditOpen] = useState(false)
    const [editingPack, setEditingPack] = useState<ConsolidatedPack | null>(null)
    const [replacementInvoiceFile, setReplacementInvoiceFile] = useState<any>(null)
    const [packActionLoading, setPackActionLoading] = useState(false)

    const [availableMonthKeys, setAvailableMonthKeys] = useState<string[]>([])
    const [packedMonthKeys, setPackedMonthKeys] = useState<string[]>([])
    const [lockedMovIds, setLockedMovIds] = useState<Record<string, boolean>>({})

    const [resolvingQuery, setResolvingQuery] = useState<any>(null)
    const [resolveOpen, setResolveOpen] = useState(false)
    const [poePreviewUrl, setPoePreviewUrl] = useState<string>('')
    const [resolveUploading, setResolveUploading] = useState(false)
    const [resolveFile, setResolveFile] = useState<any>(null)

    const [queryForm] = Form.useForm()
    const [queryRaiseOpen, setQueryRaiseOpen] = useState(false)
    const [raisingQuery, setRaisingQuery] = useState(false)

    const [packQueriesModalOpen, setPackQueriesModalOpen] = useState(false)
    const [packQueriesForPack, setPackQueriesForPack] = useState<any[]>([])
    const [packQueriesLoading, setPackQueriesLoading] = useState(false)

    const [queriesContextTitle, setQueriesContextTitle] = useState<string>('MOV Queries')
    const [packQueriesContextTitle, setPackQueriesContextTitle] = useState<string>('Pack Queries')

    type ViewKey = 'movs' | 'consolidated'
    const [viewKey, setViewKey] = useState<ViewKey>('movs')

    const [movs, setMovs] = useState<MovDoc[]>([])
    const [filtered, setFiltered] = useState<MovDoc[]>([])
    const [selectedMOV, setSelectedMOV] = useState<MovDoc | null>(null)
    const [selectedMovResources, setSelectedMovResources] = useState<PoeResource[]>([])
    const [openingMovId, setOpeningMovId] = useState<string | null>(null)
    const [downloadingMovId, setDownloadingMovId] = useState<string | null>(null)

    const [modalVisible, setModalVisible] = useState(false)
    const [consolidatedModalVisible, setConsolidatedModalVisible] = useState(false)
    const [packPoeIndex, setPackPoeIndex] = useState<Record<string, PoeResource[]>>({})

    const [previewVisible, setPreviewVisible] = useState(false)
    const [savingPack, setSavingPack] = useState(false)
    const savingPackRef = useRef(false)

    const [loading, setLoading] = useState(false)
    const [programDataLoading, setProgramDataLoading] = useState(false)
    const [hasLoadedOnce, setHasLoadedOnce] = useState(false)
    const [filters, setFilters] = useState({
        facilitator: 'all',
        beneficiary: 'all',
        status: 'all' as 'all' | 'approved' | 'queried' | 'awaiting',
        dateRange: [] as Dayjs[],
        endDateRange: [] as Dayjs[]
    })
    const [selectedMonth, setSelectedMonth] = useState<Dayjs | null>(null)
    const [consolidatedMonthFilter, setConsolidatedMonthFilter] = useState('all')
    const [interventions, setInterventions] = useState<MovDoc[]>([])
    const [invoiceFile, setInvoiceFile] = useState<any>(null)

    const [hodDigitalSignature, setHodDigitalSignature] = useState<string>('')
    const hodSignatureUrl = user?.signatureURL || ''

    const [queriesModalOpen, setQueriesModalOpen] = useState(false)
    const [queriesForMov, setQueriesForMov] = useState<any[]>([])
    const [queriesLoading, setQueriesLoading] = useState(false)

    const [queriesIndex, setQueriesIndex] = useState<
        Record<
            string,
            {
                open: number
                total: number
                evidence: boolean
                lastEvidenceUrl?: string
                lastUpdated?: Date
            }
        >
    >({})

    const [consolidated, setConsolidated] = useState<ConsolidatedPack[]>([])
    const [consolidatedLoading, setConsolidatedLoading] = useState(false)
    const [packQueriesIndex, setPackQueriesIndex] = useState<
        Record<string, { open: number; total: number }>
    >({})
    const [packModalOpen, setPackModalOpen] = useState(false)
    const [activePack, setActivePack] = useState<ConsolidatedPack | null>(null)

    useEffect(() => {
        const run = async () => {
            if (!user?.email) return
            const qy = query(collection(db, 'operationsStaff'), where('email', '==', user.email))
            const snap = await getDocs(qy)
            if (!snap.empty) {
                setHodDigitalSignature(snap.docs[0].data()?.digitalSignature || '')
            }
        }
        run()
    }, [user?.email])

    const monthKeyFromAssignmentDate = (mov: any) => {
        const d = resolveMovAssignmentDate(mov)
        return d ? dayjs(d).format('YYYY-MM') : null
    }

    const resolveMovAssignmentDate = (mov: any): Date | null => {
        return safeToDate(
            mov?.assignmentCreatedAt ||
            mov?.periodStart ||
            mov?.interventionDate ||
            mov?.assignedAt ||
            mov?.createdAt
        )
    }

    // "End Date" is the day the SME confirmed the MOV - not the appointment date
    // and not when the facilitator was marked complete in the system.
    const resolveMovCompletionDate = (mov: any): Date | null =>
        safeToDate(
            mov?.smmeAcceptedAt ||
            mov?.smmeSignedAt ||
            mov?.periodEnd
        )

    const hasMEApproval = (pack?: ConsolidatedPack | null) =>
        !!(pack?.approvals || []).find(a => a.step === 'validation')

    const buildQueriesIndex = async (movList: MovDoc[]) => {
        const allIds = movList.map(m => m.id).filter(Boolean)
        if (!allIds.length) {
            setQueriesIndex({})
            return
        }

        const index: Record<
            string,
            {
                open: number
                total: number
                evidence: boolean
                lastEvidenceUrl?: string
                lastUpdated?: Date
            }
        > = {}

        for (const ids of chunk(allIds, 10)) {
            const queryRows = await workflowQueryService.list({ movIds: ids })
            queryRows.forEach(qd => {
                const mv = qd.movId as string
                if (!mv) return

                const entry = index[mv] || {
                    open: 0,
                    total: 0,
                    evidence: false
                }

                entry.total += 1
                if ((qd.status || 'open') !== 'resolved') entry.open += 1

                if (qd.uploadedFileUrl) {
                    entry.evidence = true
                    entry.lastEvidenceUrl = qd.uploadedFileUrl
                }

                const when = (qd.updatedAt?.toDate?.() ||
                    qd.resolvedAt?.toDate?.() ||
                    qd.createdAt?.toDate?.() ||
                    null) as Date | null

                if (when && (!entry.lastUpdated || entry.lastUpdated < when)) {
                    entry.lastUpdated = when
                }

                index[mv] = entry
            })
        }

        setQueriesIndex(index)
    }

    const buildPackQueriesIndex = async (packs: ConsolidatedPack[]) => {
        const packIds = packs.map(p => String((p as any).id || '')).filter(Boolean)
        if (!packIds.length) {
            setPackQueriesIndex({})
            return
        }

        const index: Record<string, { open: number; total: number }> = {}

        for (const batch of chunk(packIds, 10)) {
            const queryRows = await workflowQueryService.list({ consolidatedMovIds: batch })

            queryRows.forEach(qd => {
                const pid = String(qd.consolidatedMovId || '')
                if (!pid) return

                const entry = index[pid] || { open: 0, total: 0 }
                entry.total += 1
                if (String(qd.status || 'open').toLowerCase() !== 'resolved') entry.open += 1
                index[pid] = entry
            })
        }

        setPackQueriesIndex(index)
    }

    const resolveDepartmentSensitivity = async (departmentId?: string | null): Promise<boolean> => {
        if (!departmentId) return false

        const depSnap = await getDoc(doc(db, 'departments', departmentId))
        if (!depSnap.exists()) return false

        return depSnap.data()?.isSensitive === true
    }

    async function resolveMovPoeData(mov: any, ai?: any, qiEntry?: any) {
        let poeUrls: string[] = []
        let resources: PoeResource[] = []
        let evidenceNotes = ''

        const preIncUrl = getPreIncAgreementUrl(mov)
        if (hasPreIncAgreementEvidence(mov) && preIncUrl) {
            resources.push({
                type: 'signed_agreement',
                label: 'Signed Pre-Incubation Agreement',
                link: preIncUrl
            })
            poeUrls.push(preIncUrl)
        }

        // Evidence is written against the allocated-intervention record. MOVs
        // created by older flows do not always carry the same relationship
        // field, so resolve every known assignment key before falling back to
        // the participant/intervention pair.
        const mergePoeRecord = (record: any) => {
            if (!record) return
            const recordResources = Array.isArray(record.resources) ? record.resources : []
            resources = resources.concat(recordResources
                .filter((r: any) => r && typeof (r.link || r.url || r.href) === 'string')
                .map((r: any) => ({
                    type: r.type,
                    label: r.label,
                    link: r.link || r.url || r.href
                })))
            poeUrls = poeUrls.concat(recordResources.map((r: any) => r?.link || r?.url || r?.href).filter(Boolean))
        }

        const participantId = mov?.participantId || mov?.beneficiaryId || mov?.smmeId || ai?.participantId || ''
        const assignedKeys = Array.from(new Set([
            mov?.assignedInterventionId,
            mov?.assignedId,
            mov?.interventionKey,
            mov?.interventionAssignmentId,
            mov?.groupAssignmentId,
            mov?.groupKey,
            mov?.groupId,
            ai?.id
        ].map(value => String(value || '').trim()).filter(Boolean)))

        // Some completion records contain the POE only on assignedInterventions.
        for (const assignedKey of assignedKeys) {
            try {
                const assignedSnap = await getDoc(doc(db, 'assignedInterventions', assignedKey))
                if (assignedSnap.exists()) mergePoeRecord(assignedSnap.data())
            } catch (error) {
                console.warn('[Operations MOV] Could not read assigned intervention POE', {
                    assignedKey,
                    error
                })
            }
        }

        const normalizedResources = Array.from(
            new Map(
                resources
                    .filter(r => r?.link && typeof r.link === 'string' && r.link.startsWith('http'))
                    .map(r => [r.link, r])
            ).values()
        )

        const resourceUrls = normalizedResources.map(r => r.link)

        const allPoeUrls = Array.from(
            new Set([...poeUrls, ...resourceUrls].filter(Boolean))
        )

        const departmentId = ai?.departmentId || null

        const isSensitiveDepartment = await resolveDepartmentSensitivity(departmentId)

        if (
            USE_SENSITIVE_DEPARTMENT_SUMMARY_INSTEAD_OF_POE &&
            isSensitiveDepartment &&
            poeUrls.length === 0 &&
            normalizedResources.length === 0
        ) {
            evidenceNotes =
                extractEvidenceNotes(mov) ||
                extractEvidenceNotes(ai)
        }

        return {
            poeUrls: allPoeUrls,
            resources: normalizedResources,
            evidenceNotes
        }
    }

    const enrichMovFromRefs = async (mov: MovDoc) => {
        const beneficiaryId = (mov as any).participantId || (mov as any).beneficiaryId || (mov as any).smmeId || ''

        // Independent lookups - fetch in parallel rather than one after another.
        const [participant, app] = await Promise.all([
            beneficiaryId
                ? getDoc(doc(db, 'participants', beneficiaryId))
                    .then(pSnap => (pSnap.exists() ? { id: pSnap.id, ...(pSnap.data() as any) } : null))
                    .catch(() => null)
                : Promise.resolve(null),
            beneficiaryId
                ? getFirst(query(
                    collection(db, 'applications'),
                    where('participantId', '==', beneficiaryId),
                    qlimit(1)
                ))
                : Promise.resolve(null)
        ])

        let officeAreaName = (mov as any).officeAreaName || ''
        if (app?.branchId) {
            try {
                const b = await getDoc(doc(db, 'branches', String(app.branchId)))
                if (b.exists()) {
                    const bd: any = b.data()
                    officeAreaName = bd.name || bd.branchName || officeAreaName
                }
            } catch {
                //
            }
        }

        const gapGroup = app?.group || app?.gapGroup || (mov as any).gapGroup || ''

        let ai: any = null
        if ((mov as any).assignedInterventionId) {
            const aiSnap = await getDoc(
                doc(db, 'assignedInterventions', (mov as any).assignedInterventionId)
            )
            if (aiSnap.exists()) ai = { id: aiSnap.id, ...aiSnap.data() }
        }

        if (!ai && (mov as any).interventionId && beneficiaryId) {
            const parts: any[] = [
                collection(db, 'assignedInterventions'),
                where('interventionId', '==', (mov as any).interventionId),
                where('participantId', '==', beneficiaryId)
            ]

            if (activeProgramId) {
                parts.push(where('programId', '==', activeProgramId))
            }

            parts.push(qlimit(1))
            ai = await getFirst(query(...parts))
        }

        const assignmentCreatedAt =
            ai?.createdAt ||
            (mov as any).assignmentCreatedAt ||
            (mov as any).periodStart ||
            (mov as any).interventionDate ||
            null
        const subInterventionId =
            (mov as any).subInterventionId || ai?.subInterventionId || null
        const subInterventionTitle =
            (mov as any).subInterventionTitle ||
            ai?.subInterventionTitle ||
            ai?.subInterventionName ||
            null

        const { methodInPerson, methodOnline, methodTelephonic, methodOther } =
            parseDeliveryFlags(ai, mov)

        let frequency: FrequencyUI | undefined
        if (isExplicitlyNonRecurring(ai)) frequency = 'as-needed'
        if (!frequency) frequency = parseFrequency(ai?.frequency)
        if (!frequency) frequency = parseFrequency((mov as any).frequency)
        if (!frequency) frequency = await resolveFrequencyByInterventionId((mov as any).interventionId)
        if (!frequency) frequency = 'once'

        const periodStart =
            (mov as any).periodStart ||
            (mov as any).interventionDate ||
            ai?.createdAt ||
            null

        const periodEnd =
            (mov as any).periodEnd ||
            (mov as any).smmeAcceptedAt ||
            (mov as any).smmeSignedAt ||
            ai?.participantConfirmedAt ||
            null

        const storedAppointmentInterventions = Array.isArray(
            (mov as any).appointmentInterventions
        )
            ? (mov as any).appointmentInterventions
            : []

        const needsLiveAppointmentLookup =
            !storedAppointmentInterventions.length &&
            !!((mov as any).interventionId || ai?.interventionId)

        const smmeSector = (mov as any).smmeSector || participant?.sector || app?.sector || ''

        const facSigUrl = (mov as any).facilitatorSignatureUrl || ''

        // SMME signatures are written to the MOV when the intervention is
        // confirmed. Keep this view on that canonical field only.
        const smmeSigUrl = (mov as any).smmeSignatureUrl || ''

        // The SMME/registration number is authoritatively captured on the
        // application, not the participant profile - the incubatees list reads
        // it from here too, so the MOV should match. Field naming varies
        // ("smmeNo"/"smmENo"/"SMMENo") across older records. participants is
        // no longer consulted since it isn't reliably kept in sync.
        let smmeNo =
            (app as any)?.smmeNo || (app as any)?.smmENo || (app as any)?.SMMENo || ''
        if (!smmeNo) {
            smmeNo = (mov as any).smmeNo || ''
        }

        const onboardingIntervention = isOnboardingMov({
            ...mov,
            isOnboarding:
                (mov as any).isOnboarding === true ||
                ai?.isOnboarding === true ||
                ai?.onboarding === true,
            interventionTitle:
                (mov as any).interventionTitle ||
                ai?.snapshot?.interventionTitle ||
                ai?.interventionTitle ||
                ai?.title ||
                ''
        })

        const rawPreIncubationAgreementMeta =
            (mov as any).preIncubationAgreementMeta ||
            app?.signedAgreements?.['pre-incubation-contract'] ||
            participant?.signedAgreements?.['pre-incubation-contract'] ||
            null

        // Only attach/use the participant's Pre-Incubation Agreement for an
        // actual onboarding intervention. Other departmental MOVs must use
        // their own intervention POE even if this SME has signed Pre-Inc.
        const preIncubationAgreementMeta = onboardingIntervention
            ? rawPreIncubationAgreementMeta
            : null

        const preIncubationAgreement =
            onboardingIntervention && (
                (mov as any).preIncubationAgreement === true ||
                normalizeMovText((mov as any).verificationMethod) === 'signed_preinc_agreement' ||
                rawPreIncubationAgreementMeta === true ||
                rawPreIncubationAgreementMeta?.signed === true ||
                rawPreIncubationAgreementMeta?.participantSigned === true ||
                !!rawPreIncubationAgreementMeta?.participantSignatureURL ||
                !!rawPreIncubationAgreementMeta?.userSignatureURL ||
                !!rawPreIncubationAgreementMeta?.signer ||
                !!rawPreIncubationAgreementMeta?.acceptedAt
            )

        const movWithPreInc = {
            ...mov,
            preIncubationAgreement,
            preIncubationAgreementMeta
        }

        const qiEntry = mov?.id ? queriesIndex?.[mov.id] : undefined

        // These three are independent of each other - resolve concurrently
        // instead of one after another.
        const [liveAppointmentInterventions, kpiServiced, resolvedPoe] = await Promise.all([
            needsLiveAppointmentLookup
                ? resolveMovAppointmentInterventions(db, ai?.id ? {
                    ...ai,
                    id: ai.id
                } : {
                    id: (mov as any).assignedInterventionId || '',
                    participantId: beneficiaryId,
                    interventionId: (mov as any).interventionId,
                    interventionTitle: (mov as any).interventionTitle,
                    programId: (mov as any).programId,
                    periodStart,
                    periodEnd,
                    smmeEmail: (mov as any).participantEmail || (mov as any).smmeEmail,
                    completedAt: (mov as any).completedAt,
                    participantConfirmedAt: (mov as any).smmeAcceptedAt || (mov as any).smmeSignedAt,
                    assigneeCompletedAt: (mov as any).facilitatorSignedAt
                })
                : Promise.resolve(storedAppointmentInterventions),
            resolveKpiNamesByInterventionId(
                ai?.databaseInterventionId ||
                (mov as any).databaseInterventionId ||
                (mov as any).interventionId
            ),
            resolveMovPoeData(movWithPreInc, ai, qiEntry)
        ])
        const appointmentInterventions = liveAppointmentInterventions

        const poeUrls = resolvedPoe.poeUrls
        const evidenceNotes = resolvedPoe.evidenceNotes || ''
        const resources =
            resolvedPoe.resources.length > 0
                ? resolvedPoe.resources
                : Array.isArray((mov as any).resources)
                    ? (mov as any).resources
                    : []

        return {
            ...mov,
            preIncubationAgreement,
            preIncubationAgreementMeta,
            assignmentCreatedAt,
            subInterventionId,
            subInterventionTitle,
            officeAreaName,
            gapGroup,
            smmeSector,
            frequency,
            periodStart,
            periodEnd,
            appointmentInterventions,
            methodInPerson,
            methodOnline,
            methodTelephonic,
            methodOther,
            kpiServiced,
            facilitatorSignatureUrl: facSigUrl,
            facilitatorDigitalSignature: '',
            smmeSignatureUrl: smmeSigUrl,
            smmeDigitalSignature: '',
            smmeNo,
            resources,
            poeUrls,
            evidenceNotes
        } as MovDoc
    }

    const hasMovEvidence = (mov: any) => {
        if (hasPreIncAgreementEvidence(mov)) return true

        const qi = queriesIndex[mov?.id]
        const urlsFromPoeUrls = Array.isArray(mov?.poeUrls) ? mov.poeUrls : []
        const urlsFromRecord = collectPoeUrlsFromRecord(mov, qi)
        const urlsFromResources = Array.isArray(mov?.resources)
            ? mov.resources
                .map((r: any) => r?.link || r?.url || r?.href)
                .filter((x: any) => typeof x === 'string' && x.startsWith('http'))
            : []

        const all = Array.from(
            new Set([...urlsFromPoeUrls, ...urlsFromRecord, ...urlsFromResources].filter(Boolean))
        )

        const notes =
            typeof mov?.evidenceNotes === 'string'
                ? mov.evidenceNotes.trim()
                : ''

        return all.length > 0 || notes.length > 0
    }

    const fetchMovResources = async (mov: MovDoc): Promise<PoeResource[]> => {
        try {
            const resolved = await resolveMovPoeData(mov)
            return resolved.resources
        } catch (e) {
            console.error('fetchMovResources error', e)
            return []
        }
    }

    const fetchMOVs = async () => {
        if (!user) return
        setLoading(true)

        let stage = 'starting MOV fetch'
        try {
            stage = 'building MOV query'
            const constraints: any[] = [collection(db, 'movDocuments')]
            if (user.departmentName) constraints.push(where('departmentName', '==', user.departmentName))

            if (activeProgramId) {
                constraints.push(where('programId', '==', activeProgramId))
            }

            const qy = query(...constraints)
            stage = 'reading movDocuments'
            let snapshot
            try {
                snapshot = await getDocs(qy)
            } catch (queryError: any) {
                // A missing Firestore composite index should not prevent the page
                // from loading. Fall back to the company scope and filter locally.
                console.error('[Operations MOV] Scoped MOV query failed; retrying company scope', {
                    error: queryError,
                    code: queryError?.code,
                    message: queryError?.message,
                    departmentName: user.departmentName || null,
                    activeProgramId: activeProgramId || null
                })
                const fallback = await getDocs(query(
                    collection(db, 'movDocuments'),
                    ...(user.departmentName ? [where('departmentName', '==', user.departmentName)] : [])
                ))
                snapshot = {
                    docs: fallback.docs.filter(d => {
                        const data = d.data() as any
                        return (!user.departmentName || data.departmentName === user.departmentName) &&
                            (!activeProgramId || data.programId === activeProgramId)
                    })
                } as typeof fallback
            }

            stage = 'filtering MOV documents'
            const rawData: MovDoc[] = filterMovRecords(snapshot.docs
                .map(d => ({
                    id: d.id,
                    ...(d.data() as any)
                }))
                .filter((mov: any) => {
                    return isSmeConfirmedMov(mov) || mov.status === 'approved' || mov.status === 'queried'
                }), user?.email) as MovDoc[]

            stage = 'enriching MOV references'
            const enrichedData = await Promise.all(rawData.map(m => enrichMovFromRefs(m)))
            setMovs(enrichedData)
            setFiltered(sortMovRows(enrichedData))
            stage = 'building MOV query index'
            await buildQueriesIndex(enrichedData)

        } catch (err) {
            const error = err as any
            console.error('[Operations MOV] Failed to fetch MOVs', {
                stage,
                error,
                name: error?.name,
                code: error?.code,
                message: error?.message,
                stack: error?.stack
            })
            message.error(`Failed to fetch MOVs${error?.message ? `: ${error.message}` : ''}`)
        } finally {
            setLoading(false)
        }
    }

    const fetchAvailableMonths = async () => {
        if (!user) return
        try {
            const constraints: any[] = [collection(db, 'movDocuments')]
            if (user.departmentName) constraints.push(where('departmentName', '==', user.departmentName))
            constraints.push(where('status', '==', 'approved'))

            if (activeProgramId) {
                constraints.push(where('programId', '==', activeProgramId))
            }

            const snap = await getDocs(query(...constraints))

            const data: MovDoc[] = snap.docs
                .map(d => ({
                    id: d.id,
                    ...(d.data() as any)
                }))
                .filter(mov => (mov as any).approvedByHod === true)

            const enriched = await Promise.all(data.map(m => enrichMovFromRefs(m)))
            const eligibleMonths = new Set<string>()

            enriched.forEach(mov => {
                const hasPoe = hasMovEvidence(mov)
                const key = monthKeyFromAssignmentDate(mov)
                if (!hasPoe || !key) return
                eligibleMonths.add(key)
            })

            setAvailableMonthKeys(Array.from(eligibleMonths).sort())
        } catch (err) {
            console.error('Failed to fetch available months', err)
        }
    }

    const fetchConsolidated = async () => {
        if (!user) return
        setConsolidatedLoading(true)

        try {
            const constraints: any[] = [collection(db, 'consolidatedMOVs')]
            if (user.departmentName) constraints.push(where('department', '==', user.departmentName))

            if (activeProgramId) {
                constraints.push(where('programId', '==', activeProgramId))
            }

            const snap = await getDocs(query(...constraints))

            const list = filterMovRecords(
                snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })),
                user?.email
            )
                .sort((a, b) => {
                    const aT = (a as any).createdAt?.toDate?.() || (a as any).createdAt || 0
                    const bT = (b as any).createdAt?.toDate?.() || (b as any).createdAt || 0
                    return new Date(bT).getTime() - new Date(aT).getTime()
                }) as ConsolidatedPack[]

            const lock: Record<string, boolean> = {}
            const usedMonths = new Set<string>()

            list.forEach(pack => {
                const month = String((pack as any).month || '').trim()
                if (month) usedMonths.add(month)

                const items = (pack as any).interventions || (pack as any).interventionsSnapshot || []
                items.forEach((m: any) => {
                    if (m?.id) lock[m.id] = true
                })
            })

            setPackedMonthKeys(Array.from(usedMonths))
            setLockedMovIds(lock)
            setConsolidated(list)
            await buildPackQueriesIndex(list)
        } catch (e) {
            console.error(e)
            message.error('Failed to load consolidated MOVs')
        } finally {
            setConsolidatedLoading(false)
        }
    }

    useEffect(() => {
        let cancelled = false

        const loadProgramData = async () => {
            setProgramDataLoading(true)

            try {
                await Promise.all([
                    fetchMOVs(),
                    fetchConsolidated(),
                    fetchAvailableMonths()
                ])
            } finally {
                if (!cancelled) {
                    setProgramDataLoading(false)
                    setHasLoadedOnce(true)
                }
            }
        }

        loadProgramData()

        return () => {
            cancelled = true
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.departmentName, activeProgramId])

    const handleFilterChange = (key: string, value: any) => {
        const next = { ...filters, [key]: value }
        setFilters(next)

        const hasRange =
            Array.isArray(next.dateRange) &&
            next.dateRange.length === 2 &&
            next.dateRange[0] &&
            next.dateRange[1]

        const rangeStart = hasRange ? dayjs(next.dateRange[0]).startOf('day') : null
        const rangeEnd = hasRange ? dayjs(next.dateRange[1]).endOf('day') : null
        const hasEndRange =
            Array.isArray(next.endDateRange) &&
            next.endDateRange.length === 2 &&
            next.endDateRange[0] &&
            next.endDateRange[1]
        const completionRangeStart = hasEndRange
            ? dayjs(next.endDateRange[0]).startOf('day')
            : null
        const completionRangeEnd = hasEndRange
            ? dayjs(next.endDateRange[1]).endOf('day')
            : null

        const result = movs.filter(mov => {
            const facilitatorMatch =
                next.facilitator === 'all' || (mov as any).facilitatorName === next.facilitator

            const beneficiaryMatch =
                next.beneficiary === 'all' || (mov as any).smmeCompanyName === next.beneficiary

            const tableDate = resolveMovAssignmentDate(mov)

            const dateMatch =
                !hasRange ||
                (!!tableDate &&
                    (dayjs(tableDate).isSame(rangeStart, 'day') ||
                        dayjs(tableDate).isSame(rangeEnd, 'day') ||
                        (dayjs(tableDate).isAfter(rangeStart, 'day') &&
                            dayjs(tableDate).isBefore(rangeEnd, 'day'))))
            const completionDate = resolveMovCompletionDate(mov)
            const completionDateMatch =
                !hasEndRange ||
                (!!completionDate &&
                    (dayjs(completionDate).isSame(completionRangeStart, 'day') ||
                        dayjs(completionDate).isSame(completionRangeEnd, 'day') ||
                        (dayjs(completionDate).isAfter(completionRangeStart, 'day') &&
                            dayjs(completionDate).isBefore(completionRangeEnd, 'day'))))

            const queried = String((mov as any).status || '').toLowerCase() === 'queried'
            const approved = (mov as any).approvedByHod === true
            const statusMatch =
                next.status === 'all' ||
                (next.status === 'approved' && approved) ||
                (next.status === 'queried' && queried) ||
                (next.status === 'awaiting' && !approved && !queried)

            return facilitatorMatch &&
                beneficiaryMatch &&
                dateMatch &&
                completionDateMatch &&
                statusMatch
        })

        setFiltered(sortMovRows(result))
    }

    const toggleStatusFilter = (status: 'approved' | 'queried' | 'awaiting') => {
        const next = filters.status === status ? 'all' : status
        handleFilterChange('status', next)
    }

    const sortMovRows = (rows: MovDoc[]) => [...rows].sort((a, b) => {
        const dateDiff = (resolveMovCompletionDate(b)?.getTime() || 0) - (resolveMovCompletionDate(a)?.getTime() || 0)
        if (dateDiff) return dateDiff
        return String((a as any).smmeCompanyName || '').localeCompare(String((b as any).smmeCompanyName || ''), undefined, { sensitivity: 'base' })
    })

    const disableMonthSelection = (current: Dayjs) => {
        if (!current) return false
        const monthKey = current.format('YYYY-MM')
        const isPacked = packedMonthKeys.includes(monthKey)
        const isAvailable = availableMonthKeys.includes(monthKey)
        return isPacked || !isAvailable
    }

    const packExistsForMonth = async (monthKey: string): Promise<boolean> => {
        if (!user?.departmentName) return false

        const constraints: any[] = [
            collection(db, 'consolidatedMOVs'),
            where('department', '==', user.departmentName || ''),
            where('month', '==', monthKey)
        ]

        if (activeProgramId) {
            constraints.push(where('programId', '==', activeProgramId))
        }

        const snap = await getDocs(query(...constraints))
        return !snap.empty
    }

    const uploadInvoiceIfAny = async () => {
        if (!invoiceFile) return null
        try {
            const storage = getStorage()
            const safeName = String(invoiceFile.name || '').replace(/\s+/g, '_')
            const path = `consolidatedMOVs/${user?.departmentName}/${selectedMonth?.format(
                'YYYY-MM'
            )}/${Date.now()}_${safeName}`
            const rf = ref(storage, path)
            await uploadBytes(rf, invoiceFile)
            const url = await getDownloadURL(rf)
            return { url, name: invoiceFile.name, path }
        } catch (e) {
            console.error(e)
            message.error('Invoice upload failed.')
            return null
        }
    }

    const uploadReplacementInvoice = async () => {
        if (!replacementInvoiceFile || !editingPack) return null

        try {
            const storage = getStorage()
            const safeName = String(replacementInvoiceFile.name || '').replace(/\s+/g, '_')
            const path = `consolidatedMOVs/${user?.departmentName}/${(editingPack as any).month}/${Date.now()}_${safeName}`
            const rf = ref(storage, path)
            await uploadBytes(rf, replacementInvoiceFile)
            const url = await getDownloadURL(rf)
            return { url, name: replacementInvoiceFile.name, path }
        } catch (e) {
            console.error(e)
            message.error('Failed to upload replacement invoice')
            return null
        }
    }

    const handleGenerate = async () => {
        if (!selectedMonth) {
            message.warning('Please select a valid month.')
            return
        }

        setLoading(true)

        try {
            const monthKey = selectedMonth.format('YYYY-MM')

            if (await packExistsForMonth(monthKey)) {
                message.warning(
                    'A consolidated MOV pack has already been submitted for this month. You can view it under Consolidated MOVs.'
                )
                setPreviewVisible(false)
                setConsolidatedModalVisible(false)
                return
            }

            if (!availableMonthKeys.includes(monthKey)) {
                message.warning('That month has no approved MOVs with POE available for packing.')
                setInterventions([])
                setPreviewVisible(false)
                return
            }

            const start = dayjs(selectedMonth).startOf('month').toDate()
            const end = dayjs(selectedMonth).endOf('month').toDate()

            const constraints: any[] = [
                collection(db, 'movDocuments'),
                where('departmentName', '==', user.departmentName || ''),
                where('status', '==', 'approved')
            ]

            if (activeProgramId) {
                constraints.push(where('programId', '==', activeProgramId))
            }

            const snap = await getDocs(query(...constraints))

            const rawApproved: MovDoc[] = snap.docs
                .map(d => ({
                    id: d.id,
                    ...(d.data() as any)
                }))
                .filter(mov => (mov as any).approvedByHod === true)

            const enrichedInMonth = await Promise.all(
                rawApproved.map(m => enrichMovFromRefs(m))
            )

            const inMonth = enrichedInMonth.filter(m => {
                const when = resolveMovAssignmentDate(m)
                return !!when && when >= start && when <= end
            })

            const eligible = inMonth.filter(m => hasMovEvidence(m))
            const excludedCount = inMonth.length - eligible.length

            if (!eligible.length) {
                message.warning('No approved MOVs with POE were found for this month.')
                setInterventions([])
                setPreviewVisible(false)
                return
            }

            if (excludedCount > 0) {
                message.warning(`${excludedCount} MOV(s) were excluded because they have no POE.`)
            }

            setInterventions(eligible)
            setPreviewVisible(true)
        } catch (err) {
            console.error(err)
            message.error('Failed to generate MOV list')
        } finally {
            setLoading(false)
        }
    }

    const buildPackPayload = async (saveWithoutInvoice = false) => {
        if (!selectedMonth) {
            message.warning('Please select a month.')
            return null
        }

        const monthKey = selectedMonth.format('YYYY-MM')

        if (await packExistsForMonth(monthKey)) {
            message.error('A consolidated MOV pack for this month already exists.')
            setPreviewVisible(false)
            setConsolidatedModalVisible(false)
            return null
        }

        const approvedInterventions = interventions.filter(
            m => (m as any).approvedByHod === true
        )

        if (!approvedInterventions.length) {
            message.warning('No approved MOVs found for this month.')
            return null
        }

        const noPoeItems = approvedInterventions.filter(
            m => !hasMovEvidence(m)
        )

        if (noPoeItems.length) {
            message.error(
                `${noPoeItems.length} MOV(s) in this pack do not have POE. Remove them before submitting to M&E.`
            )
            return null
        }

        const approvalEntry = {
            step: 'hod_submission',
            role: userRole || 'operations',
            name: user?.name || 'Unknown User',
            date: new Date()
        }

        const safeInterventions = approvedInterventions.map(mov =>
            stripUndefinedDeep({
                ...mov,
                interventionDate:
                    typeof (mov as any).interventionDate?.toDate === 'function'
                        ? (mov as any).interventionDate
                        : safeToDate((mov as any).interventionDate) || (mov as any).interventionDate,
                resources: Array.isArray((mov as any).resources)
                    ? (mov as any).resources.map((r: any) => ({
                        ...(r?.type !== undefined ? { type: r.type } : {}),
                        ...(r?.label !== undefined ? { label: r.label } : {}),
                        ...(r?.link !== undefined ? { link: r.link } : {})
                    }))
                    : []
            })
        )

        let invoiceAttachment = null

        if (!saveWithoutInvoice && invoiceFile) {
            const invoiceMeta = await uploadInvoiceIfAny()
            if (!invoiceMeta) return { invoiceUploadFailed: true }

            invoiceAttachment = {
                name: invoiceMeta.name || '',
                url: invoiceMeta.url || '',
                path: invoiceMeta.path || ''
            }
        }

        return stripUndefinedDeep({
            department: user?.departmentName || '',
            month: monthKey,
            range: {
                from: dayjs(selectedMonth).startOf('month').toDate(),
                to: dayjs(selectedMonth).endOf('month').toDate()
            },
            totalItems: safeInterventions.length,
            interventions: safeInterventions,
            approvals: [approvalEntry],
            createdAt: new Date(),
            status: 'submitted_to_me',
            programId: activeProgramId || null,
            hodName: user?.name || '',
            hodUid: user?.uid || '',
            hodSignatureUrl: hodSignatureUrl || '',
            hodDigitalSignature: hodDigitalSignature || '',
            invoiceAttachment,
            invoiceRequiredButMissing: saveWithoutInvoice && !!invoiceFile,
            invoiceSkipped: saveWithoutInvoice
        })
    }

    const savePackPayload = async (payload: any) => {
        // A duplicate submission (double-click, or re-submitting a month that
        // already has a pack) would otherwise create a second consolidatedMOVs
        // document with identical department/month/program - guard against
        // that here, not just at the click-handler level.
        const existingSnap = await getDocs(
            query(
                collection(db, 'consolidatedMOVs'),
                where('department', '==', payload.department),
                where('month', '==', payload.month),
                ...(payload.programId ? [where('programId', '==', payload.programId)] : [])
            )
        )
        if (!existingSnap.empty) {
            message.error(`A consolidated MOV for ${payload.department} in ${payload.month} already exists.`)
            setPreviewVisible(false)
            setConsolidatedModalVisible(false)
            await fetchConsolidated()
            await fetchAvailableMonths()
            return
        }

        await addDoc(collection(db, 'consolidatedMOVs'), payload)

        message.success('Consolidated MOV saved and submitted to M&E.')
        setPreviewVisible(false)
        setConsolidatedModalVisible(false)
        setInvoiceDecisionOpen(false)
        setInvoiceFile(null)
        setSelectedMonth(null)

        await fetchConsolidated()
        await fetchAvailableMonths()
    }

    const handleSave = async () => {
        if (savingPackRef.current) return
        savingPackRef.current = true
        setSavingPack(true)
        try {
            const payload = await buildPackPayload(false)
            if (!payload) return

            if ((payload as any).invoiceUploadFailed) {
                setInvoiceDecisionOpen(true)
                return
            }

            await savePackPayload(payload)
        } catch (err) {
            console.error('Failed to save consolidated MOV:', err)
            message.error('Failed to save consolidated MOV')
        } finally {
            savingPackRef.current = false
            setSavingPack(false)
        }
    }

    const continueWithoutInvoice = async () => {
        if (savingPackRef.current) return
        savingPackRef.current = true
        setSavingPack(true)
        try {
            const payload = await buildPackPayload(true)
            if (!payload) return
            await savePackPayload(payload)
        } catch (err) {
            console.error('Failed to save pack without invoice:', err)
            message.error('Failed to save pack without invoice')
        } finally {
            savingPackRef.current = false
            setSavingPack(false)
        }
    }

    const buildUpdatedPackInterventions = async (monthKey: string) => {
        const start = dayjs(monthKey, 'YYYY-MM').startOf('month').toDate()
        const end = dayjs(monthKey, 'YYYY-MM').endOf('month').toDate()

        const constraints: any[] = [
            collection(db, 'movDocuments'),
            where('departmentName', '==', user?.departmentName || ''),
            where('status', '==', 'approved')
        ]

        if (activeProgramId) {
            constraints.push(where('programId', '==', activeProgramId))
        }

        const snap = await getDocs(query(...constraints))

        const inMonth: MovDoc[] = snap.docs
            .map(d => ({ id: d.id, ...(d.data() as any) }))
            .filter(d => {
                const when = resolveMovAssignmentDate(d)
                return !!when && when >= start && when <= end
            })

        const enriched = await Promise.all(inMonth.map(m => enrichMovFromRefs(m)))
        const eligible = enriched.filter(m => hasMovEvidence(m))

        return eligible.map(mov =>
            stripUndefinedDeep({
                ...mov,
                interventionDate:
                    typeof (mov as any).interventionDate?.toDate === 'function'
                        ? (mov as any).interventionDate
                        : safeToDate((mov as any).interventionDate) || (mov as any).interventionDate,
                resources: Array.isArray((mov as any).resources)
                    ? (mov as any).resources.map((r: any) => ({
                        ...(r?.type !== undefined ? { type: r.type } : {}),
                        ...(r?.label !== undefined ? { label: r.label } : {}),
                        ...(r?.link !== undefined ? { link: r.link } : {})
                    }))
                    : []
            })
        )
    }

    const handleUpdateExistingPack = async (replaceInvoice = false) => {
        if (!editingPack?.id) return

        if (hasMEApproval(editingPack)) {
            message.warning('This pack has already been validated by M&E and cannot be refreshed.')
            return
        }

        try {
            setPackActionLoading(true)

            const monthKey = String((editingPack as any).month || '')
            const refreshedInterventions = await buildUpdatedPackInterventions(monthKey)

            if (!refreshedInterventions.length) {
                message.warning('No approved MOVs with POE were found for this month.')
                return
            }

            const currentItems = Array.isArray((editingPack as any).interventions)
                ? (editingPack as any).interventions
                : Array.isArray((editingPack as any).interventionsSnapshot)
                    ? (editingPack as any).interventionsSnapshot
                    : []

            const currentCount = currentItems.length
            const newCount = refreshedInterventions.length
            const difference = newCount - currentCount

            await new Promise<void>((resolve, reject) => {
                Modal.confirm({
                    centered: true,
                    title: replaceInvoice ? 'Refresh pack and save invoice?' : 'Refresh pack?',
                    content:
                        difference > 0
                            ? `${difference} new MOV(s) will be added to this pack.`
                            : difference < 0
                                ? `${Math.abs(difference)} MOV(s) will be removed from this pack.`
                                : 'The number of MOVs will stay the same, but the pack snapshot will still be refreshed.',
                    okText: replaceInvoice ? 'Refresh & Save Invoice' : 'Refresh Pack',
                    cancelText: 'Cancel',
                    onOk: () => resolve(),
                    onCancel: () => reject(new Error('cancelled'))
                })
            })

            let invoiceAttachment = (editingPack as any).invoiceAttachment || null

            if (replaceInvoice && replacementInvoiceFile) {
                const uploaded = await uploadReplacementInvoice()
                if (!uploaded) return
                invoiceAttachment = {
                    name: uploaded.name,
                    url: uploaded.url,
                    path: uploaded.path
                }
            }

            await updateDoc(doc(db, 'consolidatedMOVs', editingPack.id), {
                interventions: refreshedInterventions,
                totalItems: refreshedInterventions.length,
                invoiceAttachment: invoiceAttachment || null,
                updatedAt: new Date(),
                updatedByName: user?.name || '',
                updatedByUid: user?.uid || ''
            })

            message.success('Pack updated successfully.')
            setPackEditOpen(false)
            setEditingPack(null)
            setReplacementInvoiceFile(null)
            await fetchConsolidated()
            await fetchAvailableMonths()
        } catch (err) {
            if (err instanceof Error && err.message === 'cancelled') return
            console.error(err)
            message.error('Failed to update pack')
        } finally {
            setPackActionLoading(false)
        }
    }

    const buildPackPoeIndex = async (pack: ConsolidatedPack) => {
        const items: any[] = (pack as any).interventions || (pack as any).interventionsSnapshot || []
        if (!items.length) {
            setPackPoeIndex({})
            return
        }

        const result: Record<string, PoeResource[]> = {}

        await Promise.all(
            items.map(async mov => {
                const movId = mov.id as string | undefined
                const compositeKey = `${mov.smmeCompanyName || ''}|${mov.interventionTitle || ''}|${mov.interventionDate
                    ? (
                        mov.interventionDate.seconds
                            ? mov.interventionDate.seconds * 1000
                            : mov.interventionDate
                    ).toString()
                    : ''
                    }`
                const key = movId || compositeKey
                if (!key) return

                const linkToResource = new Map<string, PoeResource>()

                const addResource = (resource: any, fallbackLabel = '') => {
                    const link = String(resource?.link || resource?.url || resource?.href || '').trim()
                    if (!link || !link.startsWith('http') || linkToResource.has(link)) return

                    linkToResource.set(link, {
                        type: resource?.type,
                        label: resource?.label || fallbackLabel,
                        link
                    })
                }

                collectPoeUrlsFromRecord(
                    mov,
                    movId ? queriesIndex[movId] : undefined
                ).forEach((url, index) =>
                    addResource({ link: url }, `POE ${index + 1}`)
                )

                const assignedKey =
                    mov.assignedInterventionId ||
                    mov.interventionKey ||
                    mov.interventionAssignmentId ||
                    null

                if (assignedKey) {
                    try {
                        const assignmentSnap = await getDoc(doc(db, 'assignedInterventions', String(assignedKey)))
                        if (assignmentSnap.exists()) {
                            const data = assignmentSnap.data() as any
                                ; (Array.isArray(data.resources) ? data.resources : []).forEach(
                                    (resource: any) => addResource(resource)
                                )
                            collectPoeUrlsFromRecord(data).forEach((url, index) =>
                                addResource({ link: url }, `POE ${index + 1}`)
                            )
                        }
                    } catch (e) {
                        console.error('buildPackPoeIndex assignedInterventions error', e)
                    }
                }

                result[key] = Array.from(linkToResource.values())
            })
        )

        setPackPoeIndex(result)
    }

    const openPack = async (pack: ConsolidatedPack) => {
        setActivePack(pack)
        setPackModalOpen(true)
        try {
            await buildPackPoeIndex(pack)
        } catch (e) {
            console.error('Failed to build POE index for pack', e)
        }
    }

    const openQueriesForMov = async (record: MovDoc) => {
        setQueriesLoading(true)
        try {
            const rows = (await workflowQueryService.list({ movId: record.id }))
                .filter((q: any) => !q.consolidatedMovId)

            setQueriesForMov(rows)
            setQueriesContextTitle(`MOV Queries — ${(record as any).interventionTitle || 'MOV'}`)
            setQueriesModalOpen(true)
        } catch {
            message.error('Failed to load MOV queries')
        } finally {
            setQueriesLoading(false)
        }
    }

    const openQueriesForPack = async (pack: ConsolidatedPack) => {
        const packId = String((pack as any).id || '')
        if (!packId) return

        setPackQueriesLoading(true)
        try {
            const rows = await workflowQueryService.list({ consolidatedMovId: packId })
            setPackQueriesForPack(rows)
            setPackQueriesContextTitle(
                `Pack Queries — ${(pack as any).department || 'Dept'} · ${(pack as any).month || ''}`
            )
            setPackQueriesModalOpen(true)
        } catch {
            message.error('Failed to load pack queries')
        } finally {
            setPackQueriesLoading(false)
        }
    }

    const startResolve = (qd: any) => {
        if (qd?.consolidatedMovId) {
            message.warning('These queries were raised by M&E against the pack. You can only track them here.')
            return
        }

        const isMine = String(qd?.raisedByUser || '') === String(user?.uid || '')
        if (!isMine) {
            message.warning('You can only resolve queries you raised.')
            return
        }

        setResolvingQuery(qd)
        setResolveOpen(true)
        setResolveFile(null)
        setPoePreviewUrl(qd.uploadedFileUrl || '')
        form.setFieldsValue({ resolutionNotes: qd.resolutionNotes || '' })
    }

    const uploadResolveEvidenceIfAny = async () => {
        if (!resolveFile) return null
        try {
            setResolveUploading(true)
            const storage = getStorage()
            const safeName = String(resolveFile.name || '').replace(/\s+/g, '_')
            const path = `movQueries/${user?.departmentName}/${Date.now()}_${safeName}`
            const rf = ref(storage, path)
            await uploadBytes(rf, resolveFile)
            const url = await getDownloadURL(rf)
            return { url, path, name: resolveFile.name }
        } catch (e) {
            console.error(e)
            message.error('Failed to upload evidence')
            return null
        } finally {
            setResolveUploading(false)
        }
    }

    const submitResolve = async () => {
        if (!resolvingQuery?.id) return

        if (resolvingQuery?.consolidatedMovId) {
            message.warning('Pack queries are read-only for HOD.')
            return
        }

        const isMine = String(resolvingQuery?.raisedByUser || '') === String(user?.uid || '')
        if (!isMine) {
            message.warning('You can only resolve queries you raised.')
            return
        }

        try {
            const vals = await form.validateFields()
            const ev = await uploadResolveEvidenceIfAny()

            await workflowQueryService.resolve(resolvingQuery.id, {
                notes: vals.resolutionNotes || '',
                attachmentUrl: ev?.url || null,
                actorId: user?.uid || '',
                actor: {
                    name: user?.name || user?.displayName || null,
                    email: user?.email || null,
                    role: user?.role || null,
                    departmentName: user?.departmentName || null
                }
            })

            message.success('Query resolved.')
            setResolveOpen(false)
            setResolvingQuery(null)

            if (selectedMOV?.id) await openQueriesForMov(selectedMOV)
            await fetchMOVs()
            await fetchConsolidated()
        } catch (e) {
            if (String(e).includes('Error')) return
            console.error(e)
            message.error('Failed to resolve query')
        }
    }

    const handleOpen = async (record: MovDoc) => {
        const movId = String((record as any).id || '')
        if (openingMovId) return

        // Open the modal immediately so the user and Guide Me get instant
        // feedback while the richer MOV/evidence data loads.
        setOpeningMovId(movId)
        setSelectedMOV(record)
        setSelectedMovResources([])
        setModalVisible(true)

        try {
            const enriched = await enrichMovFromRefs(record)
            setSelectedMOV(enriched)

            const res = await fetchMovResources(enriched)
            setSelectedMovResources(res)
        } catch (e) {
            console.error(e)
            // The base MOV is already visible. Keep it available if enrichment
            // fails rather than closing or delaying the preview.
            setSelectedMOV(record)
            setSelectedMovResources([])
        } finally {
            setOpeningMovId(null)
        }
    }

    const handleApprove = async () => {
        if (!selectedMOV) return
        if (!isHOD) {
            message.warning('Only HOD/Head/Operations can approve.')
            return
        }

        try {
            await updateDoc(doc(db, 'movDocuments', selectedMOV.id), {
                approvedByHod: true,
                hodApprovedAt: new Date(),
                hodApprovedByUid: user?.uid || null,
                hodApprovedByName: user?.name || user?.displayName || null,
                hodApprovedByEmail: user?.email || null,
                updatedAt: new Date(),
                status: 'approved'
            })
            message.success('MOV approved.')
            setModalVisible(false)
            await fetchMOVs()
            await fetchAvailableMonths()
        } catch (err) {
            console.error(err)
            message.error('Failed to update MOV.')
        }
    }

    const openRaiseQuery = () => {
        if (!selectedMOV) return
        queryForm.resetFields()
        queryForm.setFieldsValue({ queryType: 'poe-request' })
        setQueryRaiseOpen(true)
    }

    const submitRaiseQuery = async () => {
        if (!selectedMOV) return
        const locked = !!lockedMovIds[(selectedMOV as any).id as string]

        let values: { queryType: string; message: string }
        try {
            values = await queryForm.validateFields()
        } catch {
            return
        }

        setRaisingQuery(true)
        try {
            await updateDoc(doc(db, 'movDocuments', selectedMOV.id), {
                status: 'queried',
                approvedByHod: false,
                updatedAt: new Date()
            })

            if ((selectedMOV as any).facilitatorId) {
                await workflowQueryService.create({
                    programId: String(activeProgramId || (selectedMOV as any).programId || ''),
                    type: values.queryType || 'general-query',
                    message: String(values.message || '').trim(),
                    raisedById: user?.uid || 'system',
                    raisedBy: {
                        name: user?.name || user?.displayName || null,
                        email: user?.email || null,
                        role: (user?.role || '').toLowerCase(),
                        departmentName: user?.departmentName || null
                    },
                    resolverId: (selectedMOV as any).facilitatorId,
                    resolver: {
                        name: (selectedMOV as any).facilitatorName || null,
                        email: (selectedMOV as any).facilitatorEmail || null,
                        role: (selectedMOV as any).facilitatorRole || 'coordinator'
                    },
                    target: { type: 'mov', id: selectedMOV.id },
                    context: {
                        interventionId: (selectedMOV as any).interventionId || null,
                        interventionTitle: (selectedMOV as any).interventionTitle || null,
                        movId: selectedMOV.id,
                        participantId: (selectedMOV as any).beneficiaryId || (selectedMOV as any).smmeId || null,
                        departmentName: (selectedMOV as any).departmentName || user?.departmentName || null,
                        lockedInPackAtCreation: locked
                    }
                })
            }

            message.warning(
                locked
                    ? 'MOV marked as QUERIED (it is already in a pack). Consultant has been notified.'
                    : 'Query raised and consultant notified.'
            )
            setQueryRaiseOpen(false)
            setModalVisible(false)
            await fetchMOVs()
            await fetchAvailableMonths()
        } catch (err) {
            console.error(err)
            message.error('Failed to raise query')
        } finally {
            setRaisingQuery(false)
        }
    }

    const uniqueFacilitators = useMemo(
        () => Array.from(new Set(movs.map(m => (m as any).facilitatorName).filter(Boolean))),
        [movs]
    )

    const uniqueBeneficiaries = useMemo(
        () => Array.from(new Set(movs.map(m => (m as any).smmeCompanyName).filter(Boolean))),
        [movs]
    )

    const movMetrics = useMemo(() => {
        const total = filtered.length
        const approved = filtered.filter(m => (m as any).approvedByHod === true).length
        const queried = filtered.filter(m => (m as any).status === 'queried').length

        return [
            {
                key: 'total-movs',
                label: 'Total MOVs',
                value: total,
                color: '#1890ff',
                bg: '#e6f7ff',
                icon: <FileDoneOutlined style={{ fontSize: 24, color: '#1890ff' }} />
            },
            {
                key: 'approved-movs',
                label: 'Approved MOVs',
                value: approved,
                color: '#52c41a',
                bg: '#f6ffed',
                icon: <CheckCircleOutlined style={{ fontSize: 24, color: '#52c41a' }} />
            },
            {
                key: 'queried-movs',
                label: 'Queried MOVs',
                value: queried,
                color: '#fa8c16',
                bg: '#fff7e6',
                icon: <ExclamationCircleOutlined style={{ fontSize: 24, color: '#fa8c16' }} />
            }
        ]
    }, [filtered])

    const consolidatedMetrics = useMemo(() => {
        const total = consolidated.length
        const hodSubmitted = consolidated.filter(pack =>
            ((pack as any).approvals || []).some((a: any) => a.step === 'hod_submission')
        ).length
        const meApproved = consolidated.filter(pack =>
            ((pack as any).approvals || []).some((a: any) => a.step === 'validation')
        ).length

        return [
            {
                key: 'total-packs',
                label: 'Total Packs',
                value: total,
                color: '#1890ff',
                bg: '#e6f7ff',
                icon: <InboxOutlined style={{ fontSize: 24, color: '#1890ff' }} />
            },
            {
                key: 'hod-submitted',
                label: 'HOD Submitted',
                value: hodSubmitted,
                color: '#722ed1',
                bg: '#f9f0ff',
                icon: <SendOutlined style={{ fontSize: 24, color: '#722ed1' }} />
            },
            {
                key: 'me-approved',
                label: 'M&E Approved',
                value: meApproved,
                color: '#52c41a',
                bg: '#f6ffed',
                icon: <CheckCircleOutlined style={{ fontSize: 24, color: '#52c41a' }} />
            }
        ]
    }, [consolidated])

    const activeMetrics = viewKey === 'movs' ? movMetrics : consolidatedMetrics

    const proportionStats = viewKey === 'movs'
        ? {
            total: filtered.length,
            approved: filtered.filter(m => (m as any).approvedByHod === true).length,
            queried: filtered.filter(m => (m as any).status === 'queried').length
        }
        : {
            total: consolidated.length,
            approved: consolidated.filter(pack => ((pack as any).approvals || []).some((a: any) => a.step === 'validation')).length,
            queried: consolidated.filter(pack => ((pack as any).approvals || []).some((a: any) => a.step === 'hod_submission')).length
        }

    const filteredConsolidated = useMemo(
        () => {
            const rows = consolidatedMonthFilter === 'all'
                ? consolidated
                : consolidated.filter(pack => String((pack as any).month || '') === consolidatedMonthFilter)
            const statusRows = rows.filter(pack => {
                const approved = ((pack as any).approvals || []).some((a: any) => a.step === 'validation')
                const submitted = ((pack as any).approvals || []).some((a: any) => a.step === 'hod_submission')
                return filters.status === 'all' ||
                    (filters.status === 'approved' && approved) ||
                    (filters.status === 'queried' && submitted) ||
                    (filters.status === 'awaiting' && !approved && !submitted)
            })
            return [...statusRows].sort((a, b) => String((b as any).month || '').localeCompare(String((a as any).month || '')))
        },
        [consolidated, consolidatedMonthFilter, filters.status]
    )

    const movColumns = [
        { title: 'Beneficiary', dataIndex: 'smmeCompanyName' },
        { title: 'Intervention', dataIndex: 'interventionTitle' },
        { title: 'Facilitator', dataIndex: 'facilitatorName' },
        {
            title: 'Assignment Date',
            render: (_: any, rec: MovDoc) => {
                const d = resolveMovAssignmentDate(rec)
                return d ? dayjs(d).format('DD MMM YYYY') : '—'
            }
        },
        {
            title: 'End Date',
            render: (_: any, rec: MovDoc) => {
                const d = resolveMovCompletionDate(rec)
                return d ? dayjs(d).format('DD MMM YYYY') : '—'
            }
        },
        {
            title: 'Queries',
            render: (_: any, rec: MovDoc) => {
                const qi = queriesIndex[(rec as any).id]
                if (!qi || qi.total === 0) return <Tag color="default">None</Tag>
                return (
                    <Tag color={qi.open > 0 ? 'orange' : 'green'}>
                        {qi.open > 0 ? `Open (${qi.open})` : 'Resolved'} · {qi.total}
                    </Tag>
                )
            }
        },
        {
            title: 'Status',
            dataIndex: 'status',
            render: (val: string, rec: any) => {
                if (val === 'queried') return <Tag color="orange">Queried</Tag>
                if (rec.approvedByHod === true) return <Tag color="green">Approved</Tag>
                if (isSmeConfirmedMov(rec)) return <Tag color="blue">Pending HOD Approval</Tag>
                return <Tag color="default">{(val?.charAt?.(0)?.toUpperCase?.() || '') + (val?.slice?.(1) || '')}</Tag>
            }
        },
        {
            title: 'Evidence',
            render: (_: any, rec: MovDoc) => {
                if (hasPreIncAgreementEvidence(rec)) {
                    return <Tag color="cyan">Pre-Inc</Tag>
                }

                const hasEvidence = hasMovEvidence(rec)
                return <Tag color={hasEvidence ? 'green' : 'red'}>{hasEvidence ? 'Evidence present' : 'No evidence'}</Tag>
            }
        },
        {
            title: 'Actions',
            render: (_: any, rec: MovDoc) => {
                const qi = queriesIndex[(rec as any).id]
                const hasQueries = !!qi && qi.total > 0

                return (
                    <Space wrap>
                        <Button
                            shape="round"
                            style={{ border: '1px solid dodgerblue' }}
                            icon={<EyeOutlined />}
                            type="default"
                            loading={openingMovId === String((rec as any).id || '')}
                            disabled={openingMovId !== null}
                            onClick={() => handleOpen(rec)}
                        >
                            {openingMovId === String((rec as any).id || '') ? 'Opening' : 'View'}
                        </Button>

                        <Tooltip title={!hasQueries ? 'No queries for this MOV yet' : 'View queries'}>
                            <Button
                                shape="round"
                                icon={<FileSearchOutlined />}
                                type="dashed"
                                disabled={!hasQueries}
                                onClick={() => openQueriesForMov(rec)}
                            >
                                Queries
                            </Button>
                        </Tooltip>
                    </Space>
                )
            }
        }
    ]

    const readingMovColumns = [
        {
            title: 'MOV', key: 'mov', render: (_: any, r: MovDoc) => {
                const preInc = hasPreIncAgreementEvidence(r)

                return (
                    <Space direction="vertical" size={2}>
                        <Text strong>{(r as any).smmeCompanyName || ''}</Text>
                        <Space size={6} wrap>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                                {(r as any).interventionTitle || ''}
                            </Text>
                            {preInc && (
                                <Tag color="cyan" style={{ marginInlineEnd: 0 }}>
                                    Pre-Inc
                                </Tag>
                            )}
                        </Space>
                    </Space>
                )
            }
        },
        {
            title: 'Facilitator', key: 'facilitator', render: (_: any, r: MovDoc) => {
                const name = String((r as any).facilitatorName || '')
                return <Space size={8}><Avatar size={24} style={{ fontSize: 11 }}>{name.split(/\s+/).map(part => part[0]).join('').slice(0, 2).toUpperCase()}</Avatar><Text style={{ fontSize: 13 }}>{name}</Text></Space>
            }
        },
        {
            title: 'Dates', key: 'dates', render: (_: any, r: MovDoc) => (
                <Space direction="vertical" size={0}>
                    <Text style={{ fontSize: 12 }}>Assigned {resolveMovAssignmentDate(r) ? dayjs(resolveMovAssignmentDate(r)).format('DD MMM YYYY') : ''}</Text>
                    <Text type="secondary" style={{ fontSize: 12 }}>{resolveMovCompletionDate(r) ? `Ended ${dayjs(resolveMovCompletionDate(r)).format('DD MMM YYYY')}` : 'Not yet ended'}</Text>
                </Space>
            )
        },
        {
            title: 'Status', key: 'status', render: (_: any, r: any) => {
                const approved = r.approvedByHod === true
                const queried = r.status === 'queried'
                const preInc = hasPreIncAgreementEvidence(r)

                return (
                    <Space direction="vertical" size={4}>
                        <Tag
                            color={approved ? 'green' : queried ? 'orange' : 'blue'}
                            style={{ marginInlineEnd: 0 }}
                        >
                            {approved ? 'Approved' : queried ? 'Queried' : 'Awaiting Review'}
                        </Tag>

                        {preInc ? (
                            <Tag color="cyan" style={{ marginInlineEnd: 0 }}>
                                Pre-Inc evidence
                            </Tag>
                        ) : !hasMovEvidence(r) ? (
                            <Tag color="red" style={{ marginInlineEnd: 0 }}>
                                No evidence
                            </Tag>
                        ) : null}
                    </Space>
                )
            }
        },
        {
            title: 'Queries', key: 'queries', render: (_: any, r: MovDoc) => {
                const q = queriesIndex[String((r as any).id)]
                return <Tag color={q?.open ? 'orange' : 'default'}>{q?.open ? `Open (${q.open})` : 'None'}</Tag>
            }
        },
        {
            title: '', key: 'actions', width: 110, render: (_: any, r: MovDoc) => (
                <Button
                    data-guide="mov-view-action"
                    type="link"
                    icon={<EyeOutlined />}
                    loading={openingMovId === String((r as any).id || '')}
                    onClick={() => void handleOpen(r)}
                >
                    View
                </Button>
            )
        }
    ]

    const consolidatedColumns = [
        {
            title: 'Month',
            dataIndex: 'month',
            render: (m: string) =>
                dayjs(m, ['YYYY-MM', 'YYYY-MM-DD']).isValid() ? dayjs(m).format('MMM YYYY') : m
        },
        {
            title: 'Status',
            render: (rec: ConsolidatedPack) => {
                const a = (rec as any).approvals || []
                if (a.some((x: any) => x.step === 'validation')) return <Tag color="green">Verified</Tag>
                if (a.some((x: any) => x.step === 'final_confirmation')) return <Tag color="blue">Awaiting M&amp;E</Tag>
                if (a.some((x: any) => x.step === 'hod_submission')) return <Tag color="purple">Pending CC</Tag>
                return <Tag>Pending</Tag>
            }
        },
        {
            title: 'Items',
            render: (rec: ConsolidatedPack) =>
                ((rec as any).interventions || (rec as any).interventionsSnapshot || []).length ||
                (rec as any).totalItems ||
                0
        },
        {
            title: 'Invoice',
            render: (_: any, r: ConsolidatedPack) => {
                const inv = (r as any).invoiceAttachment
                const url = typeof inv === 'string' ? inv : inv?.url
                const name = typeof inv === 'string' ? 'Invoice' : inv?.name
                return url ? (
                    <a href={url} target="_blank" rel="noreferrer">
                        {name || 'View'}
                    </a>
                ) : (
                    <em>None</em>
                )
            }
        },
        {
            title: 'Queries',
            render: (_: any, r: ConsolidatedPack) => {
                const qi = packQueriesIndex[String((r as any).id || '')]
                if (!qi || qi.total === 0) return <Tag color="default">No Queries</Tag>
                return (
                    <Tag color={qi.open > 0 ? 'orange' : 'green'}>
                        {qi.open > 0 ? `Open (${qi.open})` : 'Resolved'} · {qi.total}
                    </Tag>
                )
            }
        },
        {
            title: 'Actions',
            render: (_: any, r: ConsolidatedPack) => {
                const qi = packQueriesIndex[String((r as any).id || '')]
                const hasPackQueries = !!qi && qi.total > 0

                return (
                    <Space wrap>
                        <Button
                            data-guide="view-pack-action"
                            shape="round"
                            type="default"
                            icon={<EyeOutlined />}
                            onClick={() => openPack(r)}
                        >
                            View Pack
                        </Button>

                        <Button
                            shape="round"
                            disabled={hasMEApproval(r)}
                            onClick={() => {
                                setEditingPack(r)
                                setReplacementInvoiceFile(null)
                                setPackEditOpen(true)
                            }}
                        >
                            Update Pack
                        </Button>

                        <Tooltip title={!hasPackQueries ? 'No queries for this pack' : 'View pack queries'}>
                            <Button
                                shape="round"
                                type="dashed"
                                icon={<FileSearchOutlined />}
                                disabled={!hasPackQueries}
                                onClick={() => openQueriesForPack(r)}
                            >
                                Pack Queries
                            </Button>
                        </Tooltip>
                    </Space>
                )
            }
        }
    ]

    const groupedByDept = useMemo(() => {
        const approvedOnly = interventions.filter(m => (m as any).approvedByHod === true)
        return approvedOnly.reduce(
            (acc, mov) => {
                const dept = (mov as any).departmentName || 'Department'
                if (!acc[dept]) acc[dept] = []
                acc[dept].push(mov)
                return acc
            },
            {} as Record<string, MovDoc[]>
        )
    }, [interventions])

    const canApprove = isHOD && !(selectedMOV as any)?.approvedByHod
    const isQueried = (selectedMOV as any)?.status === 'queried'
    const isLocked = !!selectedMOV && !!lockedMovIds[(selectedMOV as any).id as string]
    const canDownloadSingle = true

    const selectedMovQueries = selectedMOV ? queriesIndex[(selectedMOV as any).id] : undefined

    const buildPoeList = (
        mov?: any,
        resources: PoeResource[] = [],
        qiEntry?: any,
        extraResources: PoeResource[] = []
    ): PoeResource[] => {
        const linkToResource = new Map<string, PoeResource>()

        const addResource = (resource: any, fallbackLabel = '') => {
            const link = String(resource?.link || resource?.url || resource?.href || '').trim()
            if (!link || !link.startsWith('http') || linkToResource.has(link)) return

            linkToResource.set(link, {
                type: resource?.type,
                label: resource?.label || fallbackLabel,
                link
            })
        }

        resources.forEach(resource => addResource(resource))
        extraResources.forEach(resource => addResource(resource))

        if (Array.isArray(mov?.resources)) {
            mov.resources.forEach((resource: any) => addResource(resource))
        }

        const preIncUrl = getPreIncAgreementUrl(mov)
        if (hasPreIncAgreementEvidence(mov) && preIncUrl) {
            addResource(
                {
                    type: 'signed_agreement',
                    label: 'Signed Pre-Incubation Agreement',
                    link: preIncUrl
                },
                'Signed Pre-Incubation Agreement'
            )
        }

        collectPoeUrlsFromRecord(mov, qiEntry).forEach((url, index) =>
            addResource({ link: url }, `POE ${index + 1}`)
        )

        return Array.from(linkToResource.values()).map((resource, index) => ({
            ...resource,
            label: resource.label || resource.type || `POE ${index + 1}`
        }))
    }

    const renderPoeAction = (
        poeList: PoeResource[],
        options: { linkButton?: boolean } = {}
    ) => {
        if (!poeList.length) {
            return <span style={{ color: '#999' }}>None</span>
        }

        if (poeList.length === 1) {
            return (
                <Button
                    shape="round"
                    type={options.linkButton ? 'link' : 'default'}
                    icon={<EyeOutlined />}
                    onClick={() => window.open(poeList[0].link, '_blank')}
                >
                    View POE
                </Button>
            )
        }

        return (
            <Dropdown
                trigger={['click']}
                menu={{
                    items: poeList.map((poe, index) => ({
                        key: `${poe.link}-${index}`,
                        label: poe.label || `POE ${index + 1}`,
                        onClick: () => window.open(poe.link, '_blank')
                    }))
                }}
            >
                <Button
                    shape="round"
                    type={options.linkButton ? 'link' : 'default'}
                    icon={<EyeOutlined />}
                >
                    View POEs ({poeList.length}) <DownOutlined />
                </Button>
            </Dropdown>
        )
    }

    const selectedMovPoeList = selectedMOV
        ? buildPoeList(selectedMOV, selectedMovResources, selectedMovQueries)
        : []

    const canViewPoe = selectedMovPoeList.length > 0

    const initialLoading = programDataLoading && !hasLoadedOnce
    const programReloading = programDataLoading && hasLoadedOnce

    const handleDownloadAsWord = async (mov: MovDoc) => {
        const movId = String((mov as any)?.id || '')
        setDownloadingMovId(movId)
        try {
            const m = await enrichMovFromRefs(mov)
            const ORIGIN = typeof window !== 'undefined' ? window.location.origin : ''
            const logos = {
                lepharoUrl: `${ORIGIN}/assets/images/lepharo.png`,
                sibanyeUrl: `${ORIGIN}/assets/images/sibanye-logo.png`
            }

            const titleTop = 'CONFIRMATION SHEET FOR RECEIVING'
            const titleSub = String((m as any).interventionTitle || '').trim() || '(MOV)'
            const officeDept = (m as any).officeAreaName || 'Department'

            const docx = await buildMovDoc(m, { ...logos, headerTop: titleTop, headerSub: titleSub, officeDept })
            const blob = await Packer.toBlob(docx)

            const safe = String((m as any).smmeCompanyName ?? 'SMME')
                .replace(/[^\w\-]+/g, '_')
                .slice(0, 40)

            saveAs(
                blob,
                `CONFIRMATION-${safe}-${dayjs(
                    (m as any).interventionDate?.toDate?.() || (m as any).interventionDate
                ).format('YYYYMMDD')}.docx`
            )
            message.success('Confirmation sheet downloaded')
        } finally {
            setDownloadingMovId(null)
        }
    }

    return (
        <div style={{ padding: 24, minHeight: '100vh' }}>
            <Helmet>
                <title>MOV Submission | Smart Incubation</title>
            </Helmet>

            {initialLoading ? <LoadingOverlay tip="Loading MOV submissions..." /> : <>
                <div data-guide="mov-metrics">
                    <MetricsGrid metrics={activeMetrics.map(metric => ({
                        key: metric.key,
                        title: metric.label,
                        value: metric.value,
                        icon: metric.icon,
                        iconBg: metric.bg,
                        subtitle: ''
                    }))}
                    />
                </div>

                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
                    <Row gutter={[16, 16]} align="stretch" style={{ marginTop: 24, marginBottom: 16 }}>
                        {screens.md && <Col xs={24} lg={14}>
                            <Card size="small" style={{ height: '100%' }}>
                                <div aria-label="MOV status proportion" style={{ display: 'flex', width: '100%', height: 8, borderRadius: 999, overflow: 'hidden', background: '#eef2f7' }}>
                                    {[
                                        { key: 'approved', value: proportionStats.approved, color: '#52c41a', label: viewKey === 'movs' ? 'Approved' : 'M&E Approved' },
                                        { key: 'queried', value: proportionStats.queried, color: '#fa8c16', label: viewKey === 'movs' ? 'Queried' : 'HOD Submitted' },
                                        { key: 'awaiting', value: Math.max(0, proportionStats.total - proportionStats.approved - proportionStats.queried), color: '#1677ff', label: viewKey === 'movs' ? 'Awaiting Review' : 'Awaiting Approval' }
                                    ].filter(item => item.value > 0).map(item => (
                                        <div key={item.key} role="button" tabIndex={0} aria-label={`Filter by ${item.label}`} onClick={() => viewKey === 'movs' ? toggleStatusFilter(item.key as any) : setFilters(previous => ({ ...previous, status: previous.status === item.key ? 'all' : item.key as any }))} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') event.currentTarget.click() }} style={{ width: `${proportionStats.total ? (item.value / proportionStats.total) * 100 : 0}%`, background: item.color, cursor: 'pointer', opacity: filters.status !== 'all' && filters.status !== item.key ? 0.35 : 1, transition: 'opacity .2s ease' }} />
                                    ))}
                                </div>
                                <div style={{ display: 'flex', marginTop: 8 }}>
                                    {[
                                        { key: 'approved', value: proportionStats.approved, color: '#52c41a', label: viewKey === 'movs' ? 'Approved' : 'M&E Approved' },
                                        { key: 'queried', value: proportionStats.queried, color: '#fa8c16', label: viewKey === 'movs' ? 'Queried' : 'HOD Submitted' },
                                        { key: 'awaiting', value: Math.max(0, proportionStats.total - proportionStats.approved - proportionStats.queried), color: '#1677ff', label: viewKey === 'movs' ? 'Awaiting Review' : 'Awaiting Approval' }
                                    ].filter(item => item.value > 0).map(item => (
                                        <Text key={item.key} type="secondary" role="button" tabIndex={0} onClick={() => viewKey === 'movs' ? toggleStatusFilter(item.key as any) : setFilters(previous => ({ ...previous, status: previous.status === item.key ? 'all' : item.key as any }))} style={{ width: `${proportionStats.total ? (item.value / proportionStats.total) * 100 : 0}%`, minWidth: 0, textAlign: 'center', fontSize: 12, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer', opacity: filters.status !== 'all' && filters.status !== item.key ? 0.35 : 1 }}><span style={{ color: item.color, marginRight: 5 }}>●</span>{item.label} ({item.value})</Text>
                                    ))}
                                </div>
                            </Card>
                        </Col>}
                        <Col xs={24} lg={10}>
                            <Card size="small" style={{ height: '100%' }}>
                                <div data-guide="mov-view-switch" style={{ width: '100%', minWidth: 0 }}>
                                    <Segmented
                                        block
                                        style={{ display: 'flex', width: '100%', minWidth: 0 }}
                                        value={viewKey}
                                        onChange={v => setViewKey(v as ViewKey)}
                                        options={[
                                            { label: 'MOV Documents', value: 'movs' },
                                            {
                                                label: <span data-guide="consolidated-movs-option">Consolidated MOVs</span>,
                                                value: 'consolidated'
                                            }
                                        ]}
                                    />
                                </div>
                            </Card>
                        </Col>
                    </Row>
                    <MotionCard
                        filterBar={(
                            <Row data-guide="mov-filter-bar" gutter={[16, 16]} align="middle">
                                {viewKey === 'movs' && <>
                                    <Col xs={24} sm={12} lg={5}>
                                        <Select showSearch optionFilterProp="children" placeholder="All Facilitators" style={{ width: '100%' }} allowClear value={filters.facilitator === 'all' ? undefined : filters.facilitator} onChange={val => handleFilterChange('facilitator', val || 'all')}>
                                            <Option value="all">All Facilitators</Option>
                                            {uniqueFacilitators.map(f => <Option key={f} value={f}>{f}</Option>)}
                                        </Select>
                                    </Col>
                                    <Col xs={24} sm={12} lg={5}>
                                        <Select showSearch optionFilterProp="children" placeholder="All Beneficiaries" style={{ width: '100%' }} allowClear value={filters.beneficiary === 'all' ? undefined : filters.beneficiary} onChange={val => handleFilterChange('beneficiary', val || 'all')}>
                                            <Option value="all">All Beneficiaries</Option>
                                            {uniqueBeneficiaries.map(b => <Option key={b} value={b}>{b}</Option>)}
                                        </Select>
                                    </Col>
                                    <Col xs={24} sm={12} lg={5}><RangePicker style={{ width: '100%' }} value={filters.dateRange as [Dayjs, Dayjs] | []} placeholder={['Assigned from', 'Assigned to']} allowClear onChange={val => handleFilterChange('dateRange', val || [])} /></Col>
                                    <Col xs={24} sm={12} lg={5}><RangePicker style={{ width: '100%' }} value={filters.endDateRange as [Dayjs, Dayjs] | []} placeholder={['Ended from', 'Ended to']} allowClear onChange={val => handleFilterChange('endDateRange', val || [])} /></Col>
                                    <Col xs={24} sm={12} lg={4}>
                                        <Button
                                            data-guide="submit-movs-action"
                                            block
                                            shape="round"
                                            type="primary"
                                            icon={<SendOutlined />}
                                            onClick={() => setConsolidatedModalVisible(true)}
                                        >
                                            Submit MOVs
                                        </Button>
                                    </Col>
                                </>}
                                {viewKey === 'consolidated' && <Col xs={24} sm={12} lg={6}>
                                    <Select value={consolidatedMonthFilter} onChange={setConsolidatedMonthFilter} style={{ width: '100%' }}>
                                        <Option value="all">All Months</Option>
                                        {Array.from(new Set(consolidated.map(pack => String((pack as any).month || '').trim()).filter(Boolean))).sort().map(month => <Option key={month} value={month}>{month}</Option>)}
                                    </Select>
                                </Col>}
                            </Row>
                        )}
                    >
                        <div data-guide="mov-main-table">
                            <Skeleton loading={programReloading} active paragraph={{ rows: 10 }}>
                                {viewKey === 'movs' ? (
                                    <Table
                                        dataSource={filtered}
                                        columns={readingMovColumns as any}
                                        rowKey="id"
                                        pagination={{ pageSize: 8, position: ['bottomCenter'], showSizeChanger: false }}
                                        scroll={{ x: 1200 }}
                                    />
                                ) : (
                                    <Table
                                        dataSource={filteredConsolidated}
                                        columns={consolidatedColumns as any}
                                        rowKey="id"
                                        pagination={{ pageSize: 8, position: ['bottomCenter'], showSizeChanger: false }}
                                        scroll={{ x: 1200 }}
                                    />
                                )}
                            </Skeleton>
                        </div>
                    </MotionCard>
                </motion.div>
            </>}

            <Modal
                className="guide-mov-preview-modal"
                centered
                open={modalVisible}
                title={
                    <Space size={10}>
                        <FileDoneOutlined style={{ color: '#1677ff' }} />
                        <span>MOV Document Preview</span>
                    </Space>
                }
                onCancel={() => {
                    setModalVisible(false)
                    setOpeningMovId(null)
                }}
                footer={null}
                width="min(1440px, calc(100vw - 24px))"
                styles={{
                    body: {
                        padding: 0,
                        background: '#f1f3f6'
                    }
                }}
            >
                {selectedMOV && (
                    <div >
                        <div
                            style={{
                                maxHeight: 'none',
                                overflowY: 'visible',
                                padding: screens.xs ? 8 : 28,
                                background: '#dfe3e8',
                                border: '1px solid #cfd5dc',
                                borderRadius: 8,
                                boxShadow: 'inset 0 1px 3px rgba(15,23,42,.08)'
                            }}
                        >
                            <div
                                data-guide="mov-document-preview"
                                style={{
                                    maxWidth: 1120,
                                    minWidth: screens.xs ? 0 : 860,
                                    margin: '0 auto',
                                    background: '#fff',
                                    boxShadow: '0 8px 28px rgba(15,23,42,.16)',
                                    border: '1px solid #e5e7eb'
                                }}
                            >
                                {openingMovId ? (
                                    <div style={{ padding: screens.xs ? 16 : 28 }}>
                                        <Skeleton
                                            active
                                            title={{ width: '42%' }}
                                            paragraph={{ rows: 10 }}
                                        />
                                    </div>
                                ) : (
                                    <div data-guide="mov-document-ready">
                                        <MovDocumentView mov={selectedMOV} />
                                    </div>
                                )}
                            </div>
                        </div>

                        <Divider style={{ margin: '16px 0' }} />

                        {!openingMovId && (
                            <Space
                                data-guide="mov-preview-actions"
                                className="mov-preview-actions"
                                wrap
                                size={8}
                                style={{ width: '100%', paddingBottom: 18, display: 'flex' }}
                            >
                                <PreIncPoeButton mov={selectedMOV} />
                                {canApprove && (
                                    <Button
                                        data-guide="mov-approve-action"
                                        style={{ flex: 1 }}
                                        shape="round"
                                        type="primary"
                                        icon={<CheckOutlined />}
                                        onClick={handleApprove}
                                    >
                                        {isQueried ? 'Re-Approve' : 'Approve'}
                                    </Button>
                                )}

                                <Button
                                    data-guide="mov-query-action"
                                    style={{ flex: 1 }}
                                    shape="round"
                                    danger
                                    icon={<QuestionCircleOutlined />}
                                    onClick={openRaiseQuery}
                                >
                                    {isLocked ? 'Query (Already in Pack)' : 'Query'}
                                </Button>

                                {canViewPoe ? (
                                    renderPoeAction(selectedMovPoeList)
                                ) : selectedMOV?.evidenceNotes ? (
                                    <Button
                                        shape="round"
                                        type="default"
                                        icon={<FileSearchOutlined />}
                                        onClick={() => {
                                            Modal.info({
                                                centered: true,
                                                title: 'Evidence Notes',
                                                width: 700,
                                                content: (
                                                    <div style={{ whiteSpace: 'pre-wrap', marginTop: 12 }}>
                                                        {selectedMOV.evidenceNotes}
                                                    </div>
                                                )
                                            })
                                        }}
                                    >
                                        View Notes
                                    </Button>
                                ) : null}

                                {canDownloadSingle && (
                                    <Button style={{ flex: 1 }} shape="round" type="primary" icon={<DownloadOutlined />} loading={downloadingMovId === String(selectedMOV?.id || '')} onClick={() => void handleDownloadAsWord(selectedMOV!)}>
                                        Download MOV
                                    </Button>
                                )}
                            </Space>
                        )}
                        <style>{`.mov-preview-actions > .ant-space-item { flex: 1 1 0; min-width: 0; } .mov-preview-actions .ant-btn { width: 100%; }`}</style>
                    </div>
                )}
            </Modal>

            <Modal centered open={queriesModalOpen} onCancel={() => setQueriesModalOpen(false)} footer={null} title={queriesContextTitle} width={900}>
                <Table
                    loading={queriesLoading}
                    rowKey="id"
                    dataSource={queriesForMov}
                    pagination={{ pageSize: 8, position: ['bottomCenter'], showSizeChanger: false }}
                    columns={[
                        { title: 'Raised By', dataIndex: 'raisedByName' },
                        { title: 'Message', dataIndex: 'queryMessage' },
                        {
                            title: 'Status',
                            dataIndex: 'status',
                            render: (s: string) => (
                                <Tag color={String(s || 'open').toLowerCase() === 'resolved' ? 'green' : 'orange'}>
                                    {(s || 'open').toUpperCase()}
                                </Tag>
                            )
                        },
                        {
                            title: 'Evidence',
                            dataIndex: 'uploadedFileUrl',
                            render: (url?: string) =>
                                url ? (
                                    <Button shape="round" type="link" icon={<EyeOutlined />} onClick={() => window.open(url, '_blank')}>
                                        Open
                                    </Button>
                                ) : (
                                    <span style={{ color: '#999' }}>—</span>
                                )
                        },
                        {
                            title: 'Actions',
                            render: (_: any, q: any) => {
                                const resolved = String(q.status || 'open').toLowerCase() === 'resolved'
                                const isMine = String(q.raisedByUser || '') === String(user?.uid || '')
                                return (
                                    <Space wrap>
                                        <Tag color={isMine ? 'blue' : 'default'}>{isMine ? 'Mine' : 'Read-only'}</Tag>
                                        <Button
                                            shape="round"
                                            type="primary"
                                            icon={<CheckOutlined />}
                                            disabled={!isMine || resolved}
                                            onClick={() => startResolve(q)}
                                        >
                                            {resolved ? 'Resolved' : 'Resolve'}
                                        </Button>
                                    </Space>
                                )
                            }
                        }
                    ]}
                />
            </Modal>

            <Modal centered open={packQueriesModalOpen} onCancel={() => setPackQueriesModalOpen(false)} footer={null} title={packQueriesContextTitle} width={900}>
                <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message="These queries were raised by M&E against the consolidated pack. You can track them here but cannot resolve them."
                />
                <Table
                    loading={packQueriesLoading}
                    rowKey="id"
                    dataSource={packQueriesForPack}
                    pagination={{ pageSize: 8, position: ['bottomCenter'], showSizeChanger: false }}
                    columns={[
                        { title: 'Raised By', dataIndex: 'raisedByName' },
                        { title: 'Message', dataIndex: 'queryMessage' },
                        {
                            title: 'Status',
                            dataIndex: 'status',
                            render: (s: string) => (
                                <Tag color={String(s || 'open').toLowerCase() === 'resolved' ? 'green' : 'orange'}>
                                    {(s || 'open').toUpperCase()}
                                </Tag>
                            )
                        },
                        {
                            title: 'Evidence',
                            dataIndex: 'uploadedFileUrl',
                            render: (url?: string) =>
                                url ? (
                                    <Button shape="round" type="link" icon={<EyeOutlined />} onClick={() => window.open(url, '_blank')}>
                                        Open
                                    </Button>
                                ) : (
                                    <span style={{ color: '#999' }}>—</span>
                                )
                        },
                        {
                            title: 'Resolved Notes',
                            dataIndex: 'resolutionNotes',
                            render: (t?: string) => t || '—'
                        },
                        {
                            title: 'Updated',
                            dataIndex: 'updatedAt',
                            render: (val: any) =>
                                val ? dayjs(val?.seconds ? val.seconds * 1000 : val).format('YYYY-MM-DD HH:mm') : '—'
                        }
                    ]}
                />
            </Modal>

            <Modal
                centered
                open={resolveOpen}
                onCancel={() => setResolveOpen(false)}
                onOk={submitResolve}
                okText="Resolve"
                confirmLoading={resolveUploading}
                title="Resolve Query"
                width={720}
            >
                <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message="Only queries you raised for your department can be resolved here."
                />

                {!!poePreviewUrl && (
                    <div style={{ marginBottom: 12 }}>
                        <Button shape="round" type="default" icon={<EyeOutlined />} onClick={() => window.open(poePreviewUrl, '_blank')}>
                            Open current evidence
                        </Button>
                    </div>
                )}

                <Form form={form} layout="vertical">
                    <Form.Item
                        label="Resolution notes"
                        name="resolutionNotes"
                        rules={[{ required: true, message: 'Please enter resolution notes' }]}
                    >
                        <Input.TextArea rows={4} placeholder="Explain what was resolved and what evidence was provided." />
                    </Form.Item>

                    <Form.Item label="Attach replacement evidence (optional)">
                        <Upload
                            beforeUpload={file => {
                                setResolveFile(file)
                                return false
                            }}
                            maxCount={1}
                        >
                            <Button shape="round" icon={<UploadOutlined />}>
                                Upload
                            </Button>
                        </Upload>

                        {resolveFile?.name ? (
                            <div style={{ marginTop: 8 }}>
                                <Tag color="blue">{resolveFile.name}</Tag>
                                <Button shape="round" type="text" icon={<CloseOutlined />} onClick={() => setResolveFile(null)}>
                                    Remove
                                </Button>
                            </div>
                        ) : null}
                    </Form.Item>
                </Form>
            </Modal>

            <Modal
                className="guide-raise-query-modal"
                centered
                open={queryRaiseOpen}
                onCancel={() => setQueryRaiseOpen(false)}
                onOk={submitRaiseQuery}
                okText="Send Query"
                okButtonProps={{ danger: true, className: 'guide-raise-query-submit' }}
                confirmLoading={raisingQuery}
                title="Raise Query"
                width={640}
            >
                <Alert
                    type="warning"
                    showIcon
                    style={{ marginBottom: 12 }}
                    message="This sends the MOV back to the facilitator for changes. Be specific about what needs fixing."
                />
                <Form data-guide="mov-query-form" form={queryForm} layout="vertical">
                    <Form.Item
                        label="What's the issue?"
                        name="queryType"
                        rules={[{ required: true, message: 'Please select a query type' }]}
                    >
                        <Select
                            options={[
                                { label: 'Missing or incorrect evidence (POE)', value: 'poe-request' },
                                { label: 'Incorrect session / coverage details', value: 'mov-issue' },
                                { label: 'Other', value: 'general-query' }
                            ]}
                        />
                    </Form.Item>
                    <Form.Item
                        label="Query details"
                        name="message"
                        rules={[
                            { required: true, whitespace: true, message: 'Please describe what needs to be fixed.' },
                            {
                                validator: (_, value) =>
                                    String(value || '').trim().split(/\s+/).filter(Boolean).length >= 5
                                        ? Promise.resolve()
                                        : Promise.reject(new Error('Please add at least 5 words describing the issue.'))
                            }
                        ]}
                    >
                        <Input.TextArea
                            rows={4}
                            placeholder="e.g. The uploaded evidence photo is blank - please re-upload a clear photo of the attendance register."
                        />
                    </Form.Item>
                </Form>
            </Modal>

            <Modal
                className="guide-submit-movs-modal"
                centered
                open={consolidatedModalVisible}
                onCancel={() => setConsolidatedModalVisible(false)}
                title="Submit MOVs for the Month"
                onOk={handleGenerate}
                okText="Generate"
                okButtonProps={{ className: 'guide-generate-pack-submit' }}
                confirmLoading={loading}
            >
                <Alert
                    type="info"
                    showIcon
                    message="Pick a month that has approved MOVs with POE. Months already packed are blocked."
                    style={{ marginBottom: 16 }}
                />
                <div data-guide="submit-movs-month">
                    <DatePicker.MonthPicker
                        style={{ width: '100%' }}
                        value={selectedMonth}
                        onChange={val => setSelectedMonth(val)}
                        disabledDate={disableMonthSelection}
                    />
                </div>
                <div data-guide="submit-movs-invoice">
                    <Upload
                        beforeUpload={file => {
                            setInvoiceFile(file)
                            return false
                        }}
                        maxCount={1}
                    >
                        <Button shape="round" style={{ marginTop: 20 }} icon={<UploadOutlined />}>
                            Attach Invoice
                        </Button>
                    </Upload>
                    {invoiceFile && (
                        <div style={{ marginTop: 8 }}>
                            <Tag color="blue">{invoiceFile.name}</Tag>
                        </div>
                    )}
                </div>
            </Modal>

            <Modal
                centered
                open={previewVisible}
                title="Consolidated MOV Preview"
                onCancel={() => setPreviewVisible(false)}
                width={900}
                onOk={handleSave}
                okText="Save & Submit to M&E"
                confirmLoading={savingPack}
                cancelButtonProps={{ disabled: savingPack }}
            >
                {Object.entries(groupedByDept).map(([deptName, deptMovs], idx) => (
                    <div key={idx} style={{ marginBottom: 32 }}>
                        <Row
                            align="middle"
                            justify="center"
                            style={{
                                marginBottom: 20,
                                border: '1px solid #d9d9d9',
                                borderRadius: 8,
                                padding: '12px 16px',
                                textAlign: 'center',
                                background: '#fafafa'
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
                                <img src="/assets/images/lepharo.png" alt="Company Logo" style={{ height: 60 }} />
                                <div>
                                    <Title level={4} style={{ margin: 0 }}>
                                        {deptName}
                                    </Title>
                                    <Text strong>{selectedMonth ? dayjs(selectedMonth).format('MMMM YYYY') : ''}</Text>
                                </div>
                            </div>
                        </Row>

                        <Table
                            bordered
                            size="small"
                            pagination={false}
                            dataSource={deptMovs}
                            rowKey={(mov: any) => (mov as any).id}
                            columns={[
                                { title: 'Beneficiary', dataIndex: 'smmeCompanyName' },
                                { title: 'Intervention', dataIndex: 'interventionTitle' },
                                { title: 'Facilitator', dataIndex: 'facilitatorName' },
                                {
                                    title: 'End Date',
                                    render: (_: any, mov: any) => {
                                        const d = resolveMovCompletionDate(mov)
                                        return d ? dayjs(d).format('YYYY-MM-DD') : '—'
                                    }
                                },
                                {
                                    title: 'Facilitator Signature',
                                    render: (_: any, mov: any) => {
                                        const url = mov.facilitatorSignatureUrl
                                        if (url) {
                                            return <img src={url} height={40} style={{ maxWidth: 120, objectFit: 'contain' }} />
                                        }
                                        return 'Signature not provided'
                                    }
                                },
                                {
                                    title: 'POE',
                                    render: (_: any, mov: any) => {
                                        const movId = mov.id
                                        const qi = movId ? queriesIndex[movId] : undefined
                                        const poeList = buildPoeList(mov, [], qi)

                                        if (hasPreIncAgreementEvidence(mov) && poeList.length === 0) {
                                            return <PreIncPoeButton mov={mov} />
                                        }

                                        return renderPoeAction(poeList, { linkButton: true })
                                    }
                                }
                            ]}
                        />

                        <Row style={{ marginTop: 24, width: '100%' }} justify="space-between" align="middle">
                            <Col>
                                <Text strong>Prepared by (HOD): {user?.name}</Text>
                                <div style={{ marginTop: 6 }}>
                                    {hodSignatureUrl ? <img src={hodSignatureUrl} alt="HOD signature" height={40} /> : <em>No signature image</em>}
                                </div>
                                <div>
                                    <Text type="secondary">Cryptographic Signature: {clip(hodDigitalSignature)}</Text>
                                </div>
                                <div>
                                    <Text type="secondary">Month: {selectedMonth ? dayjs(selectedMonth).format('MMMM YYYY') : ''}</Text>
                                </div>
                            </Col>
                        </Row>
                    </div>
                ))}
            </Modal>

            <Modal
                className="guide-pack-modal"
                centered
                open={packModalOpen}
                onCancel={() => setPackModalOpen(false)}
                footer={null}
                width={1100}
                title={
                    activePack
                        ? `Pack for ${dayjs((activePack as any).month, ['YYYY-MM', 'YYYY-MM-DD']).isValid()
                            ? dayjs((activePack as any).month).format('MMMM YYYY')
                            : (activePack as any).month
                        } (${((activePack as any).interventions || (activePack as any).interventionsSnapshot || []).length ||
                        (activePack as any).totalItems ||
                        0
                        } items)`
                        : 'Pack'
                }
            >
                {activePack && (
                    <>
                        <Row
                            align="middle"
                            justify="center"
                            style={{
                                marginBottom: 20,
                                border: '1px solid #d9d9d9',
                                borderRadius: 12,
                                padding: '12px 16px',
                                textAlign: 'center',
                                background: '#fafafa'
                            }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
                                <img src="/assets/images/lepharo.png" alt="Company Logo" style={{ height: 60 }} />
                                <div>
                                    <Title level={4} style={{ margin: 0 }}>
                                        {(activePack as any).department}
                                    </Title>
                                    <Text strong>
                                        {dayjs((activePack as any).month, ['YYYY-MM', 'YYYY-MM-DD']).isValid()
                                            ? dayjs((activePack as any).month).format('MMMM YYYY')
                                            : (activePack as any).month}
                                    </Text>
                                </div>
                            </div>
                        </Row>

                        <Card size="small" style={{ marginBottom: 20, border: '1px solid #d6e4ff' }}>
                            <Space size="large" wrap>
                                <div>
                                    <Text type="secondary">HOD Approval:</Text>{' '}
                                    <Text strong>
                                        {((activePack as any).approvals || []).find((a: any) => a.step === 'hod_submission')?.name || 'Pending'}
                                    </Text>
                                </div>
                                <div>
                                    <Text type="secondary">M&E / PM Validation:</Text>{' '}
                                    <Text strong>
                                        {((activePack as any).approvals || []).find((a: any) => a.step === 'validation')?.name || 'Pending'}
                                    </Text>
                                </div>
                                <div>
                                    <Text type="secondary">Center Coordinator Confirmation:</Text>{' '}
                                    <Text strong>
                                        {((activePack as any).approvals || []).find((a: any) => a.step === 'final_confirmation')?.name || 'Pending'}
                                    </Text>
                                </div>
                            </Space>
                        </Card>

                        <Table
                            bordered
                            size="small"
                            pagination={{ pageSize: 10, position: ['bottomCenter'], showSizeChanger: false }}
                            dataSource={((activePack as any).interventions || (activePack as any).interventionsSnapshot || []).map(
                                (x: any, i: number) => ({
                                    key: x.id || `${x.smmeCompanyName}-${x.interventionTitle}-${x.interventionDate}-${i}`,
                                    ...x
                                })
                            )}
                            columns={[
                                { title: 'Beneficiary', dataIndex: 'smmeCompanyName' },
                                { title: 'Intervention', dataIndex: 'interventionTitle' },
                                { title: 'Facilitator', dataIndex: 'facilitatorName' },
                                {
                                    title: 'Date Completed',
                                    dataIndex: 'interventionDate',
                                    render: (val: any) => {
                                        const d =
                                            typeof val?.toDate === 'function'
                                                ? val.toDate()
                                                : typeof val?.seconds === 'number'
                                                    ? new Date(val.seconds * 1000)
                                                    : val

                                        return dayjs(d).isValid() ? dayjs(d).format('YYYY-MM-DD') : '—'
                                    }
                                },
                                {
                                    title: 'Facilitator Signature',
                                    render: (_: any, mov: any) => {
                                        const imgUrl = mov.facilitatorSignatureUrl
                                        const crypto = ''
                                        if (imgUrl) return <img src={imgUrl} alt="Facilitator signature" height={40} />
                                        return crypto ? <code>{clip(crypto)}</code> : <em>None</em>
                                    }
                                },
                                {
                                    title: 'SMME Signature',
                                    render: (_: any, mov: any) => {
                                        const imgUrl = mov.smmeSignatureUrl
                                        if (imgUrl) return <img src={imgUrl} alt="SMME signature" height={40} />
                                        return <em>None</em>
                                    }
                                },
                                {
                                    title: 'POE',
                                    render: (_: any, mov: any) => {
                                        const movId = mov.id as string | undefined
                                        const compositeKey = `${mov.smmeCompanyName || ''}|${mov.interventionTitle || ''}|${mov.interventionDate
                                            ? (
                                                mov.interventionDate.seconds
                                                    ? mov.interventionDate.seconds * 1000
                                                    : mov.interventionDate
                                            ).toString()
                                            : ''
                                            }`
                                        const key = movId || compositeKey
                                        const qi = movId ? queriesIndex[movId] : undefined
                                        const poeList = buildPoeList(
                                            mov,
                                            [],
                                            qi,
                                            packPoeIndex[key] || []
                                        )

                                        if (hasPreIncAgreementEvidence(mov) && poeList.length === 0) {
                                            return <PreIncPoeButton mov={mov} />
                                        }

                                        return renderPoeAction(poeList, { linkButton: true })
                                    }
                                }
                            ]}
                        />

                        <div style={{ marginTop: 16 }}>
                            <Text strong>Invoice: </Text>
                            {(() => {
                                const inv = (activePack as any).invoiceAttachment
                                const url = typeof inv === 'string' ? inv : inv?.url
                                const name = typeof inv === 'string' ? 'Invoice' : inv?.name
                                return url ? (
                                    <a href={url} target="_blank" rel="noreferrer">
                                        {name || 'View'}
                                    </a>
                                ) : (
                                    <em>None</em>
                                )
                            })()}
                        </div>

                        {activePack && hasMEApproval(activePack) && (
                            <Button
                                style={{ marginTop: 16 }}
                                type="primary"
                                shape="round"
                                icon={<DownloadOutlined />}
                                onClick={async () => {
                                    const ORIGIN = typeof window !== 'undefined' ? window.location.origin : ''
                                    const logos = {
                                        lepharoUrl: `${ORIGIN}/assets/images/lepharo.png`,
                                        sibanyeUrl: `${ORIGIN}/assets/images/sibanye-logo.png`
                                    }

                                    const docx = await buildConsolidatedDoc(activePack, {
                                        ...logos,
                                        deptName: (activePack as any).department || 'Department'
                                    })

                                    const blob = await Packer.toBlob(docx)

                                    saveAs(
                                        blob,
                                        `CONSOLIDATED-${((activePack as any).department || 'Dept').replace(/[^\w\-]+/g, '_')}-${(activePack as any).month}.docx`
                                    )

                                    message.success('Consolidated confirmation sheet downloaded')
                                }}
                            >
                                Download
                            </Button>
                        )}
                    </>
                )}
            </Modal>

            <Modal centered open={invoiceDecisionOpen} onCancel={() => setInvoiceDecisionOpen(false)} footer={null} title="Invoice upload failed">
                <Alert
                    type="warning"
                    showIcon
                    style={{ marginBottom: 16 }}
                    message="The invoice could not be uploaded. The pack has not been submitted yet."
                    description="You can retry after attaching the invoice again, continue without an invoice, or cancel."
                />

                <Space wrap>
                    <Button shape="round" type="primary" onClick={() => setInvoiceDecisionOpen(false)}>
                        Retry
                    </Button>

                    <Button shape="round" danger loading={savingPack} disabled={savingPack} onClick={continueWithoutInvoice}>
                        Continue Without Invoice
                    </Button>

                    <Button shape="round" onClick={() => setInvoiceDecisionOpen(false)}>
                        Cancel
                    </Button>
                </Space>
            </Modal>

            <Modal
                centered
                open={packEditOpen}
                onCancel={() => {
                    setPackEditOpen(false)
                    setEditingPack(null)
                    setReplacementInvoiceFile(null)
                }}
                footer={null}
                title="Update Consolidated Pack"
            >
                <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 20 }}
                    message="Refresh will rebuild this pack using the latest approved MOVs with POE for the selected month."
                />

                <Card
                    size="small"
                    style={{
                        marginBottom: 16,
                        border: '1px solid #e6f4ff',
                        background: '#fafcff'
                    }}
                >
                    <Row gutter={[12, 8]}>
                        <Col span={24}>
                            <Text strong>Month:</Text> <Text>{(editingPack as any)?.month || '—'}</Text>
                        </Col>

                        <Col span={24}>
                            <Text strong>Current Invoice:</Text>{' '}
                            {(() => {
                                const inv = (editingPack as any)?.invoiceAttachment
                                const url = typeof inv === 'string' ? inv : inv?.url
                                const name = typeof inv === 'string' ? 'Invoice' : inv?.name

                                return url ? (
                                    <a href={url} target="_blank" rel="noreferrer">
                                        {name || 'View'}
                                    </a>
                                ) : (
                                    <Tag color="default">No Invoice</Tag>
                                )
                            })()}
                        </Col>
                    </Row>
                </Card>

                <Card size="small" style={{ marginBottom: 20, border: '1px dashed #d9d9d9' }}>
                    <Space direction="vertical" style={{ width: '100%' }}>
                        <Text strong>Replace / Add Invoice</Text>

                        <Upload
                            beforeUpload={file => {
                                setReplacementInvoiceFile(file)
                                return false
                            }}
                            maxCount={1}
                        >
                            <Button shape="round" icon={<UploadOutlined />} style={{ border: '1px solid #1677ff', color: '#1677ff' }}>
                                Upload Invoice
                            </Button>
                        </Upload>

                        {replacementInvoiceFile && <Tag color="blue">{replacementInvoiceFile.name}</Tag>}
                    </Space>
                </Card>

                <Row justify="end">
                    <Space size="middle" wrap>
                        <Button
                            shape="round"
                            icon={<CloseOutlined />}
                            onClick={() => {
                                setPackEditOpen(false)
                                setEditingPack(null)
                                setReplacementInvoiceFile(null)
                            }}
                        >
                            Cancel
                        </Button>

                        <Button
                            shape="round"
                            icon={<ReloadOutlined />}
                            loading={packActionLoading}
                            style={{ border: '1px solid #faad14', color: '#faad14' }}
                            onClick={() => handleUpdateExistingPack(false)}
                        >
                            Refresh MOVs
                        </Button>

                        <Button
                            shape="round"
                            type="primary"
                            icon={<CheckOutlined />}
                            loading={packActionLoading}
                            onClick={() => handleUpdateExistingPack(true)}
                        >
                            Refresh + Save Invoice
                        </Button>
                    </Space>
                </Row>
            </Modal>
        </div >
    )
}

export default MOVApprovalsForm
