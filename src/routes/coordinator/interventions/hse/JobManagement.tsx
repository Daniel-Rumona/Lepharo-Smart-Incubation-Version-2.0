import React, { useEffect, useMemo, useState } from 'react'
import {
    Alert,
    Badge,
    Button,
    Col,
    DatePicker,
    Drawer,
    Dropdown,
    Empty,
    Form,
    Input,
    Modal,
    Popconfirm,
    Popover,
    Row,
    Segmented,
    Select,
    Space,
    Table,
    Tag,
    Tooltip,
    Typography,
    Upload,
    message,
    theme
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { UploadFile } from 'antd/es/upload/interface'
import {
    CalendarOutlined,
    ClockCircleOutlined,
    DeleteOutlined,
    DownloadOutlined,
    EditOutlined,
    EyeOutlined,
    FallOutlined,
    FilterOutlined,
    FolderOpenOutlined,
    MoreOutlined,
    PlusOutlined,
    ReloadOutlined,
    RiseOutlined,
    SafetyCertificateOutlined,
    SearchOutlined,
    StopOutlined,
    SyncOutlined,
    TeamOutlined,
    UploadOutlined,
    UserOutlined,
    WarningOutlined
} from '@ant-design/icons'
import {
    addDoc,
    collection,
    deleteDoc,
    doc,
    onSnapshot,
    query,
    serverTimestamp,
    Timestamp,
    where,
    writeBatch
} from 'firebase/firestore'
import { deleteObject, getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import * as XLSX from 'xlsx'
import dayjs, { Dayjs } from 'dayjs'

import { db, storage } from '@/firebase'
import { withOwner } from '@/lib/storageOwner'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { DashboardFilterBar, MotionCard } from '@/components/dashboards/metrics/Header'
import { MetricTile } from '@/components/dashboards/metrics/MetricTile'
import { guideTarget, usePageGuides, type PageGuideRegistration } from '@/components/guide-me'
import {
    END_REASONS,
    STORED_TEMPORARY,
    compareContractsNewestFirst,
    contractMonth,
    countJobsInPeriod,
    countJobsOn,
    expiringWithin,
    groupJobs,
    isJobActiveOn,
    jobsBaselineFor,
    jobsByApplication,
    programmeStartOf,
    toDayjs,
    type ContractType,
    type Job,
    type JobContractRecord,
    type JobsBaseline,
    type JobsPeriodCount
} from '@/lib/jobs'

const { Text, Title } = Typography

/* ===================== types ===================== */

type SmeRow = {
    id: string
    participantId?: string
    programId?: string
    smmeNo?: string
    smmeName: string
    group: string
    gender: string
    sector: string
    email?: string
    phone?: string
    baseline: JobsBaseline
    programmeStart: Dayjs | null
}

type ParticipantRow = { id: string; [key: string]: any }

type PeriodMode = 'month' | 'quarter' | 'year'

type Period = {
    start: Dayjs
    /** The period's last day, or today while the period is still running. */
    end: Dayjs
    label: string
}

type SmeTableRow = {
    sme: SmeRow
    jobs: Job[]
    count: JobsPeriodCount
    /** Active jobs the day before the period started, for the net change. */
    activeBefore: number
    lastUpload: Dayjs | null
}

type JobFormMode = 'add' | 'renew' | 'edit'

type JobFormValues = {
    employeeName: string
    position: string
    contractType: ContractType
    startDate?: Dayjs
    expiryDate?: Dayjs
}

type EndFormValues = { endDate: Dayjs; endReason: string }

/* ===================== helpers ===================== */

const pickFirst = (...values: any[]) => {
    for (const value of values) {
        if (value !== undefined && value !== null && String(value).trim() !== '') return value
    }
    return ''
}

const normalizeKey = (value: any) => String(value || '').trim().toLowerCase()

const sanitizeFileName = (name: string) => name.replace(/[^\w.\-]+/g, '_')

const toTimestamp = (value: Dayjs | null | undefined) => (value ? Timestamp.fromDate(value.toDate()) : null)

const fmtDate = (value: Dayjs | null | undefined) => (value ? value.format('DD MMM YYYY') : '—')

const buildParticipantIndex = (rows: ParticipantRow[]) => {
    const map = new Map<string, ParticipantRow>()
    const add = (key: any, row: ParticipantRow) => {
        const k = normalizeKey(key)
        if (k && !map.has(k)) map.set(k, row)
    }
    rows.forEach(row => {
        add(row.id, row)
        add(row.participantId, row)
        add(row.applicationId, row)
        add(row.email, row)
        add(row.contactEmail, row)
        add(row.registrationNumber, row)
        add(row.smmeNo, row)
    })
    return map
}

const buildSmes = (docs: any[], participants: Map<string, ParticipantRow>): SmeRow[] =>
    docs.map(snap => {
        const data = snap.data() || {}
        const participantId = pickFirst(data.participantId, data.participantDocId, data.incubateeId) || undefined
        const appEmail = pickFirst(data.email, data.contactEmail, data.companyEmail)
        const appSmmeNo = pickFirst(data.smmeNo, data.registrationNumber)
        const participant =
            participants.get(normalizeKey(participantId)) ||
            participants.get(normalizeKey(snap.id)) ||
            participants.get(normalizeKey(appEmail)) ||
            participants.get(normalizeKey(appSmmeNo))

        return {
            id: snap.id,
            participantId,
            programId: data.programId || undefined,
            smmeNo: appSmmeNo || undefined,
            smmeName: pickFirst(data.beneficiaryName, data.companyName, data.businessName, data.enterpriseName, data.name) || 'Unnamed SME',
            group: pickFirst(data.gapGroup, data.group, data.currentGroup, data.groupStage) || 'Unspecified',
            gender: pickFirst(data.gender, data.ownerGender, data.directorGender, data.applicantGender) || 'Unspecified',
            sector: pickFirst(participant?.sector, participant?.industry, participant?.businessSector, participant?.sectorName) || 'Unspecified',
            email: appEmail || undefined,
            phone: pickFirst(data.phone, data.contactPhone, data.mobile) || undefined,
            baseline: jobsBaselineFor(data, participant),
            programmeStart: programmeStartOf(data)
        }
    })

/** Financial year runs April to March; FY2026/27 starts 1 Apr 2026. */
const fyStartOf = (date: Dayjs) => (date.month() >= 3 ? date.month(3) : date.subtract(1, 'year').month(3)).startOf('month')

const periodFor = (mode: PeriodMode, anchor: Dayjs): Period => {
    const today = dayjs().endOf('day')
    let start: Dayjs
    let last: Dayjs
    let label: string
    if (mode === 'month') {
        start = anchor.startOf('month')
        last = anchor.endOf('month')
        label = start.format('MMM YYYY')
    } else if (mode === 'quarter') {
        const fy = fyStartOf(anchor)
        const q = Math.floor(anchor.startOf('month').diff(fy, 'month') / 3)
        start = fy.add(q * 3, 'month')
        last = start.add(2, 'month').endOf('month')
        label = `Q${q + 1} FY${fy.format('YYYY')}/${fy.add(1, 'year').format('YY')}`
    } else {
        start = fyStartOf(anchor)
        last = start.add(11, 'month').endOf('month')
        label = `FY${start.format('YYYY')}/${start.add(1, 'year').format('YY')}`
    }
    return { start, end: last.isAfter(today) ? today : last, label }
}

const periodOptions = (mode: PeriodMode) => {
    const step = mode === 'quarter' ? 3 : 12
    const first = periodFor(mode, dayjs())
    return Array.from({ length: 8 }, (_, i) => {
        const p = periodFor(mode, first.start.subtract(i * step, 'month'))
        return { value: p.start.format('YYYY-MM'), label: p.label }
    })
}

const EMPTY_COUNT: JobsPeriodCount = { active: 0, permanent: 0, temporary: 0, sustained: 0, created: 0, createdInPeriod: 0, started: 0, lost: 0 }

const addCounts = (a: JobsPeriodCount, b: JobsPeriodCount): JobsPeriodCount => ({
    active: a.active + b.active,
    permanent: a.permanent + b.permanent,
    temporary: a.temporary + b.temporary,
    sustained: a.sustained + b.sustained,
    created: a.created + b.created,
    createdInPeriod: a.createdInPeriod + b.createdInPeriod,
    started: a.started + b.started,
    lost: a.lost + b.lost
})

/** When HSE last uploaded anything for the SME (the save date, not the month a document is filed under). */
const lastUploadOf = (jobs: Job[]) =>
    jobs.flatMap(job => job.contracts).reduce<Dayjs | null>((max, c) => {
        const m = toDayjs(c.createdAt) || contractMonth(c)
        return m && (!max || m.isAfter(max)) ? m : max
    }, null)

const STALE_MONTHS = 3

type JobStatus = { label: string; color: string; order: number }

const jobStatus = (job: Job, today: Dayjs): JobStatus => {
    if (job.start && job.start.isAfter(today)) return { label: 'Starts later', color: 'default', order: 2 }
    if (job.endedAt && job.endedAt.isBefore(today)) {
        const reason = END_REASONS.find(r => r.value === job.endReason)?.label
        return { label: reason ? `Ended · ${reason}` : 'Ended', color: 'default', order: 4 }
    }
    if (job.contractExpiry && job.contractExpiry.isBefore(today.startOf('day'))) return { label: 'Contract expired', color: 'red', order: 3 }
    if (job.contractExpiry) {
        const days = job.contractExpiry.diff(today.startOf('day'), 'day')
        if (days <= 30) return { label: `Expires in ${days}d`, color: 'orange', order: 1 }
    }
    return { label: 'Active', color: 'green', order: 0 }
}

const baselineText = (b: JobsBaseline) =>
    b.source === 'none'
        ? 'Not captured'
        : `${b.total} (${b.permanent} permanent, ${b.temporary} temporary)`

const baselineSourceText = (b: JobsBaseline) =>
    b.source === 'frozen'
        ? `Fixed when the SME joined${b.period ? `, from ${b.period}` : ''}`
        : b.source === 'headcountHistory'
            ? `From the SME's profile headcount for ${b.period}`
            : "The SME profile has no headcount history, so every job counts as created. ROM captures it on the SME's profile."

/* ===================== page ===================== */

const JobManagementPage: React.FC = () => {
    const { user } = useFullIdentity() as { user?: any }
    const { activeProgramId, isAllPrograms } = useActiveProgramId()
    const { token } = theme.useToken()

    const [loading, setLoading] = useState(true)
    const [smes, setSmes] = useState<SmeRow[]>([])
    const [contracts, setContracts] = useState<JobContractRecord[]>([])

    const [searchText, setSearchText] = useState('')
    const [groupFilter, setGroupFilter] = useState<string | undefined>()
    const [genderFilter, setGenderFilter] = useState<string | undefined>()
    const [sectorFilter, setSectorFilter] = useState<string | undefined>()
    const [periodMode, setPeriodMode] = useState<PeriodMode>('month')
    const [anchor, setAnchor] = useState<Dayjs>(dayjs().startOf('month'))

    const [selectedId, setSelectedId] = useState<string | null>(null)
    const [jobView, setJobView] = useState<'current' | 'ended' | 'all'>('current')

    const [jobModal, setJobModal] = useState<{ mode: JobFormMode; job?: Job } | null>(null)
    const [endModalJob, setEndModalJob] = useState<Job | null>(null)
    const [saving, setSaving] = useState(false)
    const [fileList, setFileList] = useState<UploadFile[]>([])

    const [jobForm] = Form.useForm<JobFormValues>()
    const [endForm] = Form.useForm<EndFormValues>()

    /* ---------- data ---------- */

    useEffect(() => {
        setLoading(true)
        const appConstraints: any[] = [where('applicationStatus', 'in', ['Accepted', 'accepted'])]
        const contractConstraints: any[] = []
        if (!isAllPrograms && activeProgramId) {
            appConstraints.push(where('programId', '==', activeProgramId))
            contractConstraints.push(where('programId', '==', activeProgramId))
        }

        let participantsLoaded = false
        let appsLoaded = false
        let contractsLoaded = false
        let appDocs: any[] = []
        let participantIndex = new Map<string, ParticipantRow>()

        const finish = () => {
            if (participantsLoaded && appsLoaded && contractsLoaded) setLoading(false)
        }
        const rebuild = () => setSmes(buildSmes(appDocs, participantIndex))

        const unsubParticipants = onSnapshot(
            query(collection(db, 'participants')),
            snap => {
                participantIndex = buildParticipantIndex(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })))
                participantsLoaded = true
                rebuild()
                finish()
            },
            error => {
                console.error('Failed to load participants:', error)
                message.error('Failed to load SME profiles.')
                participantsLoaded = true
                finish()
            }
        )
        const unsubApps = onSnapshot(
            query(collection(db, 'applications'), ...appConstraints),
            snap => {
                appDocs = snap.docs
                appsLoaded = true
                rebuild()
                finish()
            },
            error => {
                console.error('Failed to load applications:', error)
                message.error('Failed to load SMEs.')
                appsLoaded = true
                finish()
            }
        )
        const unsubContracts = onSnapshot(
            query(collection(db, 'hseJobContracts'), ...contractConstraints),
            snap => {
                setContracts(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })))
                contractsLoaded = true
                finish()
            },
            error => {
                console.error('Failed to load contracts:', error)
                message.error('Failed to load job contracts.')
                contractsLoaded = true
                finish()
            }
        )
        return () => {
            unsubParticipants()
            unsubApps()
            unsubContracts()
        }
    }, [activeProgramId, isAllPrograms])

    /* ---------- derived ---------- */

    const today = dayjs()
    const period = useMemo(() => periodFor(periodMode, anchor), [periodMode, anchor])
    const jobs = useMemo(() => groupJobs(contracts), [contracts])
    const jobsByApp = useMemo(() => jobsByApplication(jobs), [jobs])

    const optionsOf = (field: 'group' | 'gender' | 'sector') =>
        Array.from(new Set(smes.map(s => s[field]).filter(Boolean)))
            .sort()
            .map(value => ({ label: value, value }))
    const groupOptions = useMemo(() => optionsOf('group'), [smes])
    const genderOptions = useMemo(() => optionsOf('gender'), [smes])
    const sectorOptions = useMemo(() => optionsOf('sector'), [smes])

    const filteredSmes = useMemo(() => {
        const q = searchText.trim().toLowerCase()
        return smes.filter(s => {
            const haystack = [s.smmeName, s.smmeNo, s.group, s.gender, s.sector, s.email, s.phone].join(' ').toLowerCase()
            return (
                (!q || haystack.includes(q)) &&
                (!groupFilter || s.group === groupFilter) &&
                (!genderFilter || s.gender === genderFilter) &&
                (!sectorFilter || s.sector === sectorFilter)
            )
        })
    }, [smes, searchText, groupFilter, genderFilter, sectorFilter])

    const tableRows = useMemo<SmeTableRow[]>(() => {
        return filteredSmes.map(sme => {
            const smeJobs = jobsByApp.get(sme.id) || []
            return {
                sme,
                jobs: smeJobs,
                count: countJobsInPeriod(smeJobs, sme.baseline.total, period.start, period.end),
                activeBefore: countJobsOn(smeJobs, sme.baseline.total, period.start.subtract(1, 'day')).active,
                lastUpload: lastUploadOf(smeJobs)
            }
        })
    }, [filteredSmes, jobsByApp, period])

    const totals = useMemo(() => {
        const count = tableRows.reduce((sum, row) => addCounts(sum, row.count), EMPTY_COUNT)
        const activeBefore = tableRows.reduce((sum, row) => sum + row.activeBefore, 0)
        const baseline = tableRows.reduce((sum, row) => sum + row.sme.baseline.total, 0)
        const visibleJobs = tableRows.flatMap(row => row.jobs)
        return {
            count,
            activeBefore,
            baseline,
            expiring: expiringWithin(visibleJobs, period.end, 30).length,
            withJobs: tableRows.filter(row => row.count.active > 0).length,
            noBaseline: tableRows.filter(row => row.sme.baseline.source === 'none').length,
            stale: tableRows.filter(row => !row.lastUpload || today.diff(row.lastUpload, 'month') >= STALE_MONTHS).length
        }
    }, [tableRows, period])

    const trend = useMemo(() => {
        const months = Array.from({ length: 12 }, (_, i) => period.end.startOf('month').subtract(11 - i, 'month'))
        return months.map(m => {
            const end = m.endOf('month').isAfter(today) ? today.endOf('day') : m.endOf('month')
            const c = tableRows.reduce(
                (sum, row) => addCounts(sum, countJobsInPeriod(row.jobs, row.sme.baseline.total, m, end)),
                EMPTY_COUNT
            )
            return { label: m.format('MMM YY'), created: c.createdInPeriod, lost: c.lost, active: c.active, sustained: c.sustained }
        })
    }, [tableRows, period])

    const selected = useMemo(() => tableRows.find(row => row.sme.id === selectedId) || null, [tableRows, selectedId])

    const selectedJobs = useMemo(() => {
        if (!selected) return []
        return [...selected.jobs]
            .filter(job => {
                const active = isJobActiveOn(job, today) || (job.start ? job.start.isAfter(today) : false)
                return jobView === 'all' || (jobView === 'current' ? active : !active)
            })
            .sort((a, b) => jobStatus(a, today).order - jobStatus(b, today).order || a.employeeName.localeCompare(b.employeeName))
    }, [selected, jobView])

    /* ---------- guides ---------- */

    const hasSmes = tableRows.length > 0
    const guideRegistration = useMemo<PageGuideRegistration>(
        () => ({
            pageId: 'job-management',
            pageTitle: 'Jobs Tracker',
            guides: [
                {
                    id: 'job-management-overview',
                    title: 'Quick tour',
                    description: 'How jobs created and sustained are counted, and where to find each SME.',
                    kind: 'page',
                    order: 1,
                    steps: [
                        {
                            element: guideTarget('job-management-filters'),
                            popover: {
                                title: 'Reporting period',
                                description: 'Pick a month, a quarter or a financial year (April to March). Every number on the page is for this period.',
                                side: 'bottom',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('job-management-metrics'),
                            popover: {
                                title: 'Created and sustained',
                                description: "Each SME's starting headcount is the staff it had when it joined. Jobs up to that number are sustained; jobs above it are created. Created in the period is how much that number grew.",
                                side: 'bottom',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('job-management-trend'),
                            popover: {
                                title: 'Twelve-month trend',
                                description: 'Jobs created and lost each month, with active jobs at month end.',
                                side: 'top',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('job-management-table'),
                            waitForElement: 1500,
                            popover: {
                                title: 'SMEs',
                                description: 'One row per SME for the period. Open an SME to see its people, add a job, renew a contract or end a job.',
                                side: 'top',
                                align: 'start'
                            }
                        }
                    ]
                },
                ...(hasSmes
                    ? [
                        {
                            id: 'job-management-add-job',
                            title: 'Add a job',
                            description: 'Open an SME and capture a new employee and their contract.',
                            kind: 'task' as const,
                            order: 2,
                            steps: [
                                {
                                    element: '[data-guide="job-management-manage-action"]',
                                    waitForElement: 1500,
                                    advanceOnClick: true,
                                    popover: {
                                        title: 'Open an SME',
                                        description: 'Select Open on the SME the person works for.',
                                        side: 'left' as const,
                                        align: 'center' as const,
                                        showButtons: ['close' as const]
                                    }
                                },
                                {
                                    element: guideTarget('job-add-document-action'),
                                    waitForElement: 5000,
                                    advanceOnClick: true,
                                    popover: {
                                        title: 'Add job',
                                        description: 'Capture the person, their start date and their contract document.',
                                        side: 'bottom' as const,
                                        align: 'end' as const,
                                        showButtons: ['close' as const]
                                    }
                                },
                                {
                                    element: '.guide-job-add-contract-modal',
                                    waitForElement: 5000,
                                    popover: {
                                        title: 'Start date matters',
                                        description: 'The start date decides which period the job counts from. Use renew, not a new job, when the same person signs a new contract.',
                                        side: 'left' as const,
                                        align: 'start' as const
                                    }
                                }
                            ]
                        }
                    ]
                    : [])
            ]
        }),
        [hasSmes]
    )
    usePageGuides(guideRegistration)

    /* ---------- actions ---------- */

    const openJobModal = (mode: JobFormMode, job?: Job) => {
        setFileList([])
        jobForm.resetFields()
        if (mode === 'add') {
            jobForm.setFieldsValue({ contractType: 'permanent' })
        } else if (job) {
            jobForm.setFieldsValue({
                employeeName: job.employeeName,
                position: job.position,
                contractType: job.contractType,
                startDate: job.startIsEstimated ? undefined : job.start || undefined,
                expiryDate: mode === 'edit' ? job.contractExpiry || undefined : undefined
            })
        }
        setJobModal({ mode, job })
    }

    const uploadDocument = async (sme: SmeRow, month: Dayjs) => {
        const file = fileList[0]?.originFileObj as File | undefined
        if (!file) return null
        const storagePath = ['jobContracts', sme.id, month.format('YYYY-MM'), `${Date.now()}_${sanitizeFileName(file.name)}`].join('/')
        const storageRef = ref(storage, storagePath)
        await uploadBytes(storageRef, file, withOwner({}, { participantId: sme.participantId, applicationId: sme.id }))
        return { fileName: file.name, fileUrl: await getDownloadURL(storageRef), storagePath }
    }

    const saveJob = async () => {
        if (!selected || !jobModal) return
        const { mode, job } = jobModal
        const sme = selected.sme
        let values: JobFormValues
        try {
            values = await jobForm.validateFields()
        } catch {
            return
        }
        if (mode !== 'edit' && !fileList[0]?.originFileObj) {
            message.error('Choose the contract document first.')
            return
        }

        setSaving(true)
        try {
            if (mode === 'edit' && job) {
                // Rename/re-date every document of the job and pin its jobId, so
                // a corrected name doesn't split it into two jobs.
                const batch = writeBatch(db)
                job.contracts.forEach(c =>
                    batch.update(doc(db, 'hseJobContracts', c.id), {
                        jobId: job.key,
                        employeeName: values.employeeName.trim(),
                        position: values.position.trim(),
                        ...(values.startDate ? { startDate: toTimestamp(values.startDate.startOf('day')) } : {}),
                        updatedAt: serverTimestamp()
                    })
                )
                const latestRef = doc(db, 'hseJobContracts', job.latest.id)
                batch.update(latestRef, {
                    contractType: values.contractType === 'permanent' ? 'permanent' : STORED_TEMPORARY,
                    contractEndDate: values.contractType === 'temporary' ? toTimestamp(values.expiryDate?.endOf('day')) : null
                })
                await batch.commit()
                message.success('Job updated.')
            } else {
                // Documents are filed under the month their contract takes effect:
                // a new job's start, a renewal's signing (today). Nothing counts by it.
                const month = (mode === 'add' && values.startDate ? values.startDate : dayjs()).startOf('month')
                const uploaded = await uploadDocument(sme, month)
                const contractType = values.contractType
                await addDoc(collection(db, 'hseJobContracts'), {
                    applicationId: sme.id,
                    participantId: sme.participantId || null,
                    programId: sme.programId || activeProgramId || null,
                    smmeName: sme.smmeName,
                    group: sme.group,
                    gender: sme.gender,
                    sector: sme.sector,

                    jobId: mode === 'renew' && job ? job.key : `${sme.id}::${crypto.randomUUID()}`,
                    employeeName: values.employeeName.trim(),
                    position: values.position.trim(),
                    contractType: contractType === 'permanent' ? 'permanent' : STORED_TEMPORARY,
                    startDate: toTimestamp((values.startDate || (job && !job.startIsEstimated ? job.start : null))?.startOf('day') || null),
                    contractEndDate: contractType === 'temporary' ? toTimestamp(values.expiryDate?.endOf('day')) : null,
                    endedAt: null,
                    endReason: null,

                    uploadMonth: month.format('YYYY-MM'),
                    uploadMonthDate: toTimestamp(month),
                    ...uploaded,

                    uploadedByName: user?.name || user?.displayName || user?.email || 'Unknown User',
                    uploadedByEmail: user?.email || null,
                    createdAt: serverTimestamp(),
                    updatedAt: serverTimestamp()
                })
                if (mode === 'renew' && job) {
                    // A renewal reopens a job that had been ended.
                    if (job.endedAt) {
                        const batch = writeBatch(db)
                        job.contracts.forEach(c => batch.update(doc(db, 'hseJobContracts', c.id), { endedAt: null, endReason: null, jobId: job.key }))
                        await batch.commit()
                    } else if (!job.latest.jobId) {
                        const batch = writeBatch(db)
                        job.contracts.forEach(c => batch.update(doc(db, 'hseJobContracts', c.id), { jobId: job.key }))
                        await batch.commit()
                    }
                }
                message.success(mode === 'renew' ? 'Contract renewed.' : 'Job added.')
            }
            setJobModal(null)
            setFileList([])
        } catch (error: any) {
            console.error('Failed to save job:', error)
            message.error(error?.message || 'Failed to save the job.')
        } finally {
            setSaving(false)
        }
    }

    const endJob = async () => {
        if (!endModalJob) return
        let values: EndFormValues
        try {
            values = await endForm.validateFields()
        } catch {
            return
        }
        setSaving(true)
        try {
            const batch = writeBatch(db)
            endModalJob.contracts.forEach(c =>
                batch.update(doc(db, 'hseJobContracts', c.id), {
                    jobId: endModalJob.key,
                    endedAt: toTimestamp(values.endDate.endOf('day')),
                    endReason: values.endReason,
                    updatedAt: serverTimestamp()
                })
            )
            await batch.commit()
            message.success('Job ended.')
            setEndModalJob(null)
        } catch (error: any) {
            console.error('Failed to end job:', error)
            message.error(error?.message || 'Failed to end the job.')
        } finally {
            setSaving(false)
        }
    }

    const reopenJob = async (job: Job) => {
        try {
            const batch = writeBatch(db)
            job.contracts.forEach(c => batch.update(doc(db, 'hseJobContracts', c.id), { endedAt: null, endReason: null, updatedAt: serverTimestamp() }))
            await batch.commit()
            message.success('Job reopened.')
        } catch (error: any) {
            message.error(error?.message || 'Failed to reopen the job.')
        }
    }

    const deleteDocument = async (contract: JobContractRecord) => {
        try {
            await deleteDoc(doc(db, 'hseJobContracts', contract.id))
            if (contract.storagePath) {
                await deleteObject(ref(storage, contract.storagePath)).catch(e => console.warn('Storage file could not be deleted:', e))
            }
            message.success('Document removed.')
        } catch (error: any) {
            message.error(error?.message || 'Failed to remove the document.')
        }
    }

    const exportExcel = () => {
        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(
            wb,
            XLSX.utils.json_to_sheet(
                tableRows.map(row => ({
                    SME: row.sme.smmeName,
                    Group: row.sme.group,
                    Gender: row.sme.gender,
                    Sector: row.sme.sector,
                    'Starting headcount': row.sme.baseline.source === 'none' ? '' : row.sme.baseline.total,
                    'Starting headcount from': row.sme.baseline.period || '',
                    'Active jobs': row.count.active,
                    Permanent: row.count.permanent,
                    Temporary: row.count.temporary,
                    'Jobs sustained': row.count.sustained,
                    'Jobs created (since joining)': row.count.created,
                    [`Jobs created (${period.label})`]: row.count.createdInPeriod,
                    [`Jobs lost (${period.label})`]: row.count.lost,
                    'Net change': row.count.active - row.activeBefore,
                    'Last upload': row.lastUpload ? row.lastUpload.format('MMM YYYY') : ''
                }))
            ),
            'SMEs'
        )
        const smeById = new Map(tableRows.map(row => [row.sme.id, row.sme]))
        XLSX.utils.book_append_sheet(
            wb,
            XLSX.utils.json_to_sheet(
                tableRows.flatMap(row => row.jobs).map(job => ({
                    SME: smeById.get(job.applicationId)?.smmeName || '',
                    Employee: job.employeeName,
                    Position: job.position,
                    Type: job.contractType === 'permanent' ? 'Permanent' : 'Temporary',
                    Start: job.start ? job.start.format('YYYY-MM-DD') : '',
                    'Start estimated': job.startIsEstimated ? 'Yes' : 'No',
                    'Contract expiry': job.contractExpiry ? job.contractExpiry.format('YYYY-MM-DD') : '',
                    Ended: job.endedAt ? job.endedAt.format('YYYY-MM-DD') : '',
                    'End reason': END_REASONS.find(r => r.value === job.endReason)?.label || '',
                    [`Active at ${period.end.format('DD MMM YYYY')}`]: isJobActiveOn(job, period.end) ? 'Yes' : 'No',
                    Documents: job.contracts.length
                }))
            ),
            'Jobs'
        )
        XLSX.writeFile(wb, `jobs-tracker-${period.label.replace(/[^\w]+/g, '-')}.xlsx`)
    }

    const resetFilters = () => {
        setSearchText('')
        setGroupFilter(undefined)
        setGenderFilter(undefined)
        setSectorFilter(undefined)
        setPeriodMode('month')
        setAnchor(dayjs().startOf('month'))
    }

    /* ---------- table ---------- */

    const numberCell = (value: number, color?: string) => <Text strong={value > 0} style={value > 0 && color ? { color } : undefined}>{value}</Text>

    const columns: ColumnsType<SmeTableRow> = [
        {
            title: 'SME',
            key: 'sme',
            fixed: 'left',
            width: 240,
            sorter: (a, b) => a.sme.smmeName.localeCompare(b.sme.smmeName),
            render: (_v, row) => (
                <Space direction='vertical' size={0}>
                    <Text strong>{row.sme.smmeName}</Text>
                    <Text type='secondary' style={{ fontSize: 12 }}>
                        {row.sme.group} · {row.sme.sector}
                    </Text>
                </Space>
            )
        },
        {
            title: <Tooltip title='Staff the SME had when it joined the programme'>Starting headcount</Tooltip>,
            key: 'baseline',
            width: 130,
            align: 'right',
            sorter: (a, b) => a.sme.baseline.total - b.sme.baseline.total,
            render: (_v, row) =>
                row.sme.baseline.source === 'none' ? (
                    <Tooltip title={baselineSourceText(row.sme.baseline)}>
                        <Tag color='warning' icon={<WarningOutlined />} style={{ marginInlineEnd: 0 }}>Not captured</Tag>
                    </Tooltip>
                ) : (
                    <Tooltip title={baselineSourceText(row.sme.baseline)}>
                        <Text>{row.sme.baseline.total}</Text>
                    </Tooltip>
                )
        },
        {
            title: 'Active',
            key: 'active',
            width: 90,
            align: 'right',
            defaultSortOrder: undefined,
            sorter: (a, b) => a.count.active - b.count.active,
            render: (_v, row) => (
                <Tooltip title={`${row.count.permanent} permanent, ${row.count.temporary} temporary`}>
                    {numberCell(row.count.active)}
                </Tooltip>
            )
        },
        {
            title: <Tooltip title='Original staff still employed, up to the starting headcount'>Sustained</Tooltip>,
            key: 'sustained',
            width: 100,
            align: 'right',
            sorter: (a, b) => a.count.sustained - b.count.sustained,
            render: (_v, row) => numberCell(row.count.sustained)
        },
        {
            title: <Tooltip title='Active jobs above the starting headcount'>Created</Tooltip>,
            key: 'created',
            width: 90,
            align: 'right',
            sorter: (a, b) => a.count.created - b.count.created,
            render: (_v, row) => numberCell(row.count.created, token.colorSuccess)
        },
        {
            title: <Tooltip title={`Growth in created jobs during ${period.label}`}>Created in period</Tooltip>,
            key: 'createdInPeriod',
            width: 110,
            align: 'right',
            sorter: (a, b) => a.count.createdInPeriod - b.count.createdInPeriod,
            render: (_v, row) => numberCell(row.count.createdInPeriod, token.colorSuccess)
        },
        {
            title: <Tooltip title={`Jobs that ended during ${period.label}`}>Lost</Tooltip>,
            key: 'lost',
            width: 80,
            align: 'right',
            sorter: (a, b) => a.count.lost - b.count.lost,
            render: (_v, row) => numberCell(row.count.lost, token.colorError)
        },
        {
            title: <Tooltip title={`Active jobs at the end of ${period.label} minus the day before it started`}>Net</Tooltip>,
            key: 'net',
            width: 80,
            align: 'right',
            sorter: (a, b) => a.count.active - a.activeBefore - (b.count.active - b.activeBefore),
            render: (_v, row) => {
                const net = row.count.active - row.activeBefore
                return (
                    <Text style={{ color: net > 0 ? token.colorSuccess : net < 0 ? token.colorError : undefined }}>
                        {net > 0 ? `+${net}` : net}
                    </Text>
                )
            }
        },
        {
            title: 'Last upload',
            key: 'lastUpload',
            width: 120,
            sorter: (a, b) => (a.lastUpload?.valueOf() || 0) - (b.lastUpload?.valueOf() || 0),
            render: (_v, row) => {
                if (!row.lastUpload) return <Text type='secondary'>None</Text>
                const stale = today.diff(row.lastUpload, 'month') >= STALE_MONTHS
                return stale ? (
                    <Tooltip title={`No contracts uploaded for ${STALE_MONTHS}+ months`}>
                        <Text type='warning'>{row.lastUpload.format('MMM YYYY')}</Text>
                    </Tooltip>
                ) : (
                    <Text>{row.lastUpload.format('MMM YYYY')}</Text>
                )
            }
        },
        {
            title: '',
            key: 'action',
            width: 100,
            fixed: 'right',
            render: (_v, row) => (
                <Button
                    data-guide='job-management-manage-action'
                    variant='filled'
                    color='primary'
                    shape='round'
                    icon={<FolderOpenOutlined />}
                    onClick={() => {
                        setSelectedId(row.sme.id)
                        setJobView('current')
                    }}
                >
                    Open
                </Button>
            )
        }
    ]

    const jobColumns: ColumnsType<Job> = [
        {
            title: 'Employee',
            key: 'employee',
            render: (_v, job) => (
                <Space direction='vertical' size={0}>
                    <Text strong>{job.employeeName}</Text>
                    <Text type='secondary' style={{ fontSize: 12 }}>{job.position || '—'}</Text>
                </Space>
            )
        },
        {
            title: 'Type',
            key: 'type',
            width: 110,
            render: (_v, job) =>
                job.contractType === 'permanent' ? <Tag color='green'>Permanent</Tag> : <Tag color='orange'>Temporary</Tag>
        },
        {
            title: 'Started',
            key: 'start',
            width: 130,
            render: (_v, job) =>
                job.startIsEstimated ? (
                    <Tooltip title='No start date captured; this is the first upload month. Edit the job to set it.'>
                        <Text type='secondary'>~{job.start ? job.start.format('MMM YYYY') : '—'}</Text>
                    </Tooltip>
                ) : (
                    fmtDate(job.start)
                )
        },
        {
            title: 'Ends',
            key: 'end',
            width: 130,
            render: (_v, job) => (job.endedAt ? fmtDate(job.endedAt) : job.contractExpiry ? fmtDate(job.contractExpiry) : <Text type='secondary'>Open-ended</Text>)
        },
        {
            title: 'Status',
            key: 'status',
            width: 150,
            render: (_v, job) => {
                const s = jobStatus(job, today)
                return <Tag color={s.color}>{s.label}</Tag>
            }
        },
        {
            title: 'Docs',
            key: 'docs',
            width: 70,
            align: 'right',
            render: (_v, job) => job.contracts.length
        },
        {
            title: '',
            key: 'actions',
            width: 56,
            render: (_v, job) => {
                const ended = !!job.endedAt
                return (
                    <Dropdown
                        trigger={['click']}
                        menu={{
                            items: [
                                { key: 'renew', icon: <SyncOutlined />, label: 'Renew contract' },
                                { key: 'edit', icon: <EditOutlined />, label: 'Edit job' },
                                ended
                                    ? { key: 'reopen', icon: <ReloadOutlined />, label: 'Reopen job' }
                                    : { key: 'end', icon: <StopOutlined />, label: 'End job', danger: true }
                            ],
                            onClick: ({ key }) => {
                                if (key === 'renew') openJobModal('renew', job)
                                if (key === 'edit') openJobModal('edit', job)
                                if (key === 'reopen') reopenJob(job)
                                if (key === 'end') {
                                    endForm.resetFields()
                                    endForm.setFieldsValue({ endDate: dayjs(), endReason: undefined as any })
                                    setEndModalJob(job)
                                }
                            }
                        }}
                    >
                        <Button type='text' icon={<MoreOutlined />} aria-label={`Actions for ${job.employeeName}`} />
                    </Dropdown>
                )
            }
        }
    ]

    const documentColumns: ColumnsType<JobContractRecord> = [
        { title: 'Month', key: 'month', width: 110, render: (_v, c) => contractMonth(c)?.format('MMM YYYY') || '—' },
        { title: 'Type', key: 'type', width: 110, render: (_v, c) => (c.contractType === 'permanent' ? 'Permanent' : 'Temporary') },
        { title: 'File', key: 'file', ellipsis: true, render: (_v, c) => c.fileName || '—' },
        {
            title: 'Uploaded by',
            key: 'by',
            width: 160,
            ellipsis: true,
            render: (_v, c) => c.uploadedByName || '—'
        },
        {
            title: '',
            key: 'actions',
            width: 150,
            render: (_v, c) => (
                <Space size={4}>
                    <Button size='small' icon={<EyeOutlined />} disabled={!c.fileUrl} onClick={() => c.fileUrl && window.open(c.fileUrl, '_blank', 'noopener,noreferrer')}>
                        View
                    </Button>
                    <Popconfirm title='Remove this document?' description='Use this only for a wrong upload. To stop counting a job, end it instead.' okText='Remove' onConfirm={() => deleteDocument(c)}>
                        <Button size='small' danger type='text' icon={<DeleteOutlined />} aria-label='Remove document' />
                    </Popconfirm>
                </Space>
            )
        }
    ]

    /* ---------- chart ---------- */

    const chartOptions = useMemo<Highcharts.Options>(
        () => ({
            chart: { backgroundColor: 'transparent', height: 260, style: { fontFamily: 'inherit' } },
            title: { text: undefined },
            credits: { enabled: false },
            legend: { itemStyle: { color: token.colorTextSecondary, fontWeight: '500' }, itemHoverStyle: { color: token.colorText } },
            xAxis: {
                categories: trend.map(t => t.label),
                lineColor: token.colorBorderSecondary,
                tickColor: token.colorBorderSecondary,
                labels: { style: { color: token.colorTextSecondary } }
            },
            yAxis: [
                {
                    title: { text: undefined },
                    allowDecimals: false,
                    gridLineColor: token.colorBorderSecondary,
                    labels: { style: { color: token.colorTextSecondary } }
                },
                {
                    title: { text: undefined },
                    allowDecimals: false,
                    opposite: true,
                    gridLineWidth: 0,
                    labels: { style: { color: token.colorTextSecondary } }
                }
            ],
            tooltip: { shared: true, backgroundColor: token.colorBgElevated, style: { color: token.colorText }, borderColor: token.colorBorder },
            plotOptions: { column: { borderWidth: 0, borderRadius: 3, groupPadding: 0.18 } },
            series: [
                { type: 'column', name: 'Created', data: trend.map(t => t.created), color: token.colorSuccess },
                { type: 'column', name: 'Lost', data: trend.map(t => t.lost), color: token.colorError },
                { type: 'line', name: 'Active at month end', data: trend.map(t => t.active), color: token.colorPrimary, yAxis: 1, marker: { radius: 3 } }
            ]
        }),
        [trend, token]
    )

    /* ---------- render ---------- */

    const net = totals.count.active - totals.activeBefore
    const periodPicker =
        periodMode === 'month' ? (
            <DatePicker
                picker='month'
                allowClear={false}
                style={{ width: '100%' }}
                format='MMM YYYY'
                value={anchor}
                disabledDate={d => d.isAfter(dayjs().endOf('month'))}
                onChange={value => value && setAnchor(value.startOf('month'))}
            />
        ) : (
            <Select
                style={{ width: '100%' }}
                value={period.start.format('YYYY-MM')}
                options={periodOptions(periodMode)}
                onChange={value => setAnchor(dayjs(`${value}-01`))}
            />
        )

    const activeFilterCount = [groupFilter, genderFilter, sectorFilter].filter(Boolean).length

    const filterBar = (
        <Row data-guide='job-management-filters' gutter={[12, 12]} align='middle'>
            <Col xs={24} md={8} lg={6}>
                <Segmented<PeriodMode>
                    block
                    value={periodMode}
                    onChange={mode => setPeriodMode(mode)}
                    options={[
                        { label: 'Month', value: 'month' },
                        { label: 'Quarter', value: 'quarter' },
                        { label: 'Fin. year', value: 'year' }
                    ]}
                />
            </Col>
            <Col xs={24} sm={12} md={6} lg={4}>{periodPicker}</Col>
            <Col xs={24} sm={12} md={10} lg={10}>
                <Input allowClear placeholder='Search SMEs' value={searchText} onChange={e => setSearchText(e.target.value)} prefix={<SearchOutlined />} />
            </Col>
            <Col xs={24} lg={4}>
                <Space size={8} style={{ width: '100%', justifyContent: 'flex-end' }}>
                    <Popover
                        trigger='click'
                        placement='bottomRight'
                        title='Filter SMEs'
                        content={
                            <Space direction='vertical' size={12} style={{ width: 260 }}>
                                <Select allowClear placeholder='Any group' style={{ width: '100%' }} value={groupFilter} onChange={setGroupFilter} options={groupOptions} />
                                <Select allowClear placeholder='Any gender' style={{ width: '100%' }} value={genderFilter} onChange={setGenderFilter} options={genderOptions} />
                                <Select allowClear placeholder='Any sector' style={{ width: '100%' }} value={sectorFilter} onChange={setSectorFilter} options={sectorOptions} />
                                <Button block disabled={!activeFilterCount} onClick={() => { setGroupFilter(undefined); setGenderFilter(undefined); setSectorFilter(undefined) }}>
                                    Clear filters
                                </Button>
                            </Space>
                        }
                    >
                        <Badge count={activeFilterCount} size='small'>
                            <Button icon={<FilterOutlined />}>Filters</Button>
                        </Badge>
                    </Popover>
                    <Tooltip title='Reset filters'>
                        <Button icon={<ReloadOutlined />} onClick={resetFilters} aria-label='Reset filters' />
                    </Tooltip>
                    <Tooltip title='Export to Excel'>
                        <Button icon={<DownloadOutlined />} onClick={exportExcel} disabled={!tableRows.length} aria-label='Export to Excel' />
                    </Tooltip>
                </Space>
            </Col>
        </Row>
    )

    const tiles = [
        {
            key: 'active',
            icon: <UserOutlined />,
            tone: 'accent' as const,
            title: 'Active jobs',
            value: totals.count.active,
            subtitle: `${totals.count.permanent} permanent · ${totals.count.temporary} temporary`,
            trend: net ? { value: net > 0 ? `+${net}` : `${net}`, direction: net > 0 ? 'up' as const : 'down' as const, label: 'in period' } : undefined
        },
        {
            key: 'created',
            icon: <RiseOutlined />,
            tone: 'success' as const,
            title: 'Jobs created',
            value: totals.count.createdInPeriod,
            subtitle: `In ${period.label} · ${totals.count.created} since joining`
        },
        {
            key: 'sustained',
            icon: <SafetyCertificateOutlined />,
            tone: 'info' as const,
            title: 'Jobs sustained',
            value: totals.count.sustained,
            subtitle: `Of ${totals.baseline} at joining`
        },
        {
            key: 'lost',
            icon: <FallOutlined />,
            tone: 'danger' as const,
            title: 'Jobs lost',
            value: totals.count.lost,
            subtitle: `Ended in ${period.label}`
        },
        {
            key: 'expiring',
            icon: <ClockCircleOutlined />,
            tone: 'warning' as const,
            title: 'Expiring soon',
            value: totals.expiring,
            subtitle: 'Temporary, within 30 days'
        },
        {
            key: 'smes',
            icon: <TeamOutlined />,
            tone: 'neutral' as const,
            title: 'SMEs with jobs',
            value: `${totals.withJobs} / ${tableRows.length}`,
            subtitle: totals.stale ? `${totals.stale} with no upload in ${STALE_MONTHS} months` : 'All reporting'
        }
    ]

    const modalTitle = jobModal?.mode === 'renew' ? 'Renew contract' : jobModal?.mode === 'edit' ? 'Edit job' : 'Add job'

    return (
        <div style={{ padding: 24, minHeight: '100vh' }}>
            <Row data-guide='job-management-metrics' gutter={[16, 16]} style={{ marginBottom: 16 }}>
                {tiles.map(tile => (
                    <Col key={tile.key} xs={12} md={8} xl={4}>
                        <MetricTile
                            icon={tile.icon}
                            tone={tile.tone}
                            title={tile.title}
                            value={tile.value}
                            subtitle={tile.subtitle}
                            trend={tile.trend}
                            loading={loading}
                            wrapperStyle={{ height: '100%' }}
                        />
                    </Col>
                ))}
            </Row>

            <DashboardFilterBar padding={16} borderRadius={14}>{filterBar}</DashboardFilterBar>

            {totals.noBaseline > 0 && !loading ? (
                <Alert
                    type='warning'
                    showIcon
                    style={{ marginBottom: 16 }}
                    message={`${totals.noBaseline} SME${totals.noBaseline === 1 ? ' has' : 's have'} no starting headcount`}
                    description="Their profile has no headcount history, so every job they report counts as created until ROM captures it on the SME's profile."
                />
            ) : null}

            <div data-guide='job-management-trend'>
            <MotionCard
                title={
                    <Space direction='vertical' size={0}>
                        <Text strong>Created vs lost</Text>
                        <Text type='secondary' style={{ fontSize: 12, fontWeight: 400 }}>
                            Last 12 months to {period.end.format('MMM YYYY')}
                        </Text>
                    </Space>
                }
                loading={loading}
                skeleton='chart'
                style={{ marginBottom: 16 }}
            >
                <HighchartsReact highcharts={Highcharts} options={chartOptions} />
            </MotionCard>
            </div>

            <MotionCard
                title={
                    <Space direction='vertical' size={0}>
                        <Text strong>SMEs</Text>
                        <Text type='secondary' style={{ fontSize: 12, fontWeight: 400 }}>
                            {period.label} · counts at {period.end.format('DD MMM YYYY')}
                        </Text>
                    </Space>
                }
            >
                <div data-guide='job-management-table'>
                    <Table<SmeTableRow>
                        rowKey={row => row.sme.id}
                        loading={loading}
                        columns={columns}
                        dataSource={tableRows}
                        scroll={{ x: 1150 }}
                        size='middle'
                        pagination={{ pageSize: 15, showSizeChanger: false, position: ['bottomCenter'], hideOnSinglePage: true }}
                        summary={() =>
                            tableRows.length > 1 ? (
                                <Table.Summary fixed='bottom'>
                                    <Table.Summary.Row>
                                        <Table.Summary.Cell index={0}><Text strong>Total ({tableRows.length} SMEs)</Text></Table.Summary.Cell>
                                        <Table.Summary.Cell index={1} align='right'>{totals.baseline}</Table.Summary.Cell>
                                        <Table.Summary.Cell index={2} align='right'><Text strong>{totals.count.active}</Text></Table.Summary.Cell>
                                        <Table.Summary.Cell index={3} align='right'><Text strong>{totals.count.sustained}</Text></Table.Summary.Cell>
                                        <Table.Summary.Cell index={4} align='right'><Text strong>{totals.count.created}</Text></Table.Summary.Cell>
                                        <Table.Summary.Cell index={5} align='right'><Text strong>{totals.count.createdInPeriod}</Text></Table.Summary.Cell>
                                        <Table.Summary.Cell index={6} align='right'><Text strong>{totals.count.lost}</Text></Table.Summary.Cell>
                                        <Table.Summary.Cell index={7} align='right'><Text strong>{net > 0 ? `+${net}` : net}</Text></Table.Summary.Cell>
                                        <Table.Summary.Cell index={8} colSpan={2} />
                                    </Table.Summary.Row>
                                </Table.Summary>
                            ) : null
                        }
                        locale={{ emptyText: <Empty description='No SMEs match these filters' image={Empty.PRESENTED_IMAGE_SIMPLE} /> }}
                    />
                </div>
            </MotionCard>

            {/* ---------- SME drawer ---------- */}
            <Drawer
                className='guide-job-documents-modal'
                open={!!selected}
                onClose={() => setSelectedId(null)}
                width={980}
                styles={{ body: { paddingTop: 12 } }}
                title={
                    selected ? (
                        <Space direction='vertical' size={0}>
                            <Title level={5} style={{ margin: 0 }}>{selected.sme.smmeName}</Title>
                            <Text type='secondary' style={{ fontSize: 12, fontWeight: 400 }}>
                                {selected.sme.group} · {selected.sme.sector}
                                {selected.sme.programmeStart ? ` · joined ${selected.sme.programmeStart.format('MMM YYYY')}` : ''}
                            </Text>
                        </Space>
                    ) : null
                }
                extra={
                    <Button data-guide='job-add-document-action' type='primary' icon={<PlusOutlined />} onClick={() => openJobModal('add')}>
                        Add job
                    </Button>
                }
            >
                {selected ? (
                    <>
                        <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
                            <Col xs={12} md={6}>
                                <MetricTile
                                    compact
                                    tone={selected.sme.baseline.source === 'none' ? 'warning' : 'neutral'}
                                    icon={<TeamOutlined />}
                                    title='Starting headcount'
                                    value={selected.sme.baseline.source === 'none' ? '—' : selected.sme.baseline.total}
                                    subtitle={
                                        <Tooltip title={baselineSourceText(selected.sme.baseline)}>
                                            <span>{selected.sme.baseline.source === 'none' ? 'Not on the SME profile' : selected.sme.baseline.period || 'At joining'}</span>
                                        </Tooltip>
                                    }
                                    wrapperStyle={{ height: '100%' }}
                                />
                            </Col>
                            <Col xs={12} md={6}>
                                <MetricTile compact icon={<UserOutlined />} title='Active' value={selected.count.active} subtitle={`${selected.count.permanent} perm · ${selected.count.temporary} temp`} wrapperStyle={{ height: '100%' }} />
                            </Col>
                            <Col xs={12} md={6}>
                                <MetricTile compact tone='info' icon={<SafetyCertificateOutlined />} title='Sustained' value={selected.count.sustained} subtitle={`Of ${selected.sme.baseline.total} at joining`} wrapperStyle={{ height: '100%' }} />
                            </Col>
                            <Col xs={12} md={6}>
                                <MetricTile compact tone='success' icon={<RiseOutlined />} title='Created' value={selected.count.created} subtitle={`${selected.count.createdInPeriod} in ${period.label}`} wrapperStyle={{ height: '100%' }} />
                            </Col>
                        </Row>

                        <Row justify='space-between' align='middle' style={{ marginBottom: 12 }}>
                            <Col>
                                <Segmented
                                    value={jobView}
                                    onChange={v => setJobView(v as typeof jobView)}
                                    options={[
                                        { label: 'Current', value: 'current' },
                                        { label: 'Ended', value: 'ended' },
                                        { label: `All (${selected.jobs.length})`, value: 'all' }
                                    ]}
                                />
                            </Col>
                            <Col>
                                <Text type='secondary' style={{ fontSize: 12 }}>Status as of today</Text>
                            </Col>
                        </Row>

                        <div data-guide='job-contracts-table'>
                            <Table<Job>
                                rowKey='key'
                                size='middle'
                                columns={jobColumns}
                                dataSource={selectedJobs}
                                pagination={{ pageSize: 10, hideOnSinglePage: true }}
                                scroll={{ x: 820 }}
                                expandable={{
                                    expandedRowRender: job => (
                                        <Table<JobContractRecord>
                                            rowKey='id'
                                            size='small'
                                            columns={documentColumns}
                                            dataSource={[...job.contracts].sort(compareContractsNewestFirst)}
                                            pagination={false}
                                        />
                                    )
                                }}
                                locale={{
                                    emptyText: (
                                        <Empty
                                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                                            description={jobView === 'ended' ? 'No ended jobs' : 'No jobs captured for this SME yet'}
                                        />
                                    )
                                }}
                            />
                        </div>
                    </>
                ) : null}
            </Drawer>

            {/* ---------- add / renew / edit ---------- */}
            <Modal
                className='guide-job-add-contract-modal'
                open={!!jobModal}
                onCancel={() => setJobModal(null)}
                onOk={saveJob}
                okText={jobModal?.mode === 'edit' ? 'Save' : jobModal?.mode === 'renew' ? 'Save renewal' : 'Add job'}
                okButtonProps={{ className: 'guide-job-save-contract' }}
                confirmLoading={saving}
                centered
                width={640}
                destroyOnClose
                title={modalTitle}
            >
                {jobModal?.mode === 'renew' ? (
                    <Alert
                        type='info'
                        showIcon
                        style={{ marginBottom: 16 }}
                        message={`A new contract for ${jobModal.job?.employeeName}. It stays the same job, so it isn't counted as created again.`}
                    />
                ) : null}
                <Form<JobFormValues> form={jobForm} layout='vertical' requiredMark='optional'>
                    <Row gutter={12} data-guide='job-contract-employee-details'>
                        <Col xs={24} md={12}>
                            <Form.Item label='Employee name' name='employeeName' rules={[{ required: true, whitespace: true, message: 'Enter the employee name.' }]}>
                                <Input disabled={jobModal?.mode === 'renew'} />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={12}>
                            <Form.Item label='Position' name='position' rules={[{ required: true, whitespace: true, message: 'Enter the position.' }]}>
                                <Input disabled={jobModal?.mode === 'renew'} />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={12}>
                            <Form.Item label='Contract type' name='contractType' rules={[{ required: true }]}>
                                <Segmented
                                    block
                                    options={[
                                        { label: 'Permanent', value: 'permanent' },
                                        { label: 'Temporary', value: 'temporary' }
                                    ]}
                                />
                            </Form.Item>
                        </Col>
                        {jobModal?.mode !== 'renew' ? (
                            <Col xs={24} md={12}>
                                <Form.Item
                                    label='Start date'
                                    name='startDate'
                                    tooltip='When the person started in this job. It decides which period the job counts from.'
                                    rules={jobModal?.mode === 'add' ? [{ required: true, message: 'Enter the start date.' }] : []}
                                >
                                    <DatePicker style={{ width: '100%' }} format='DD MMM YYYY' disabledDate={d => d.isAfter(dayjs().add(1, 'year'))} />
                                </Form.Item>
                            </Col>
                        ) : null}
                        <Form.Item noStyle shouldUpdate={(a, b) => a.contractType !== b.contractType}>
                            {({ getFieldValue }) =>
                                getFieldValue('contractType') === 'temporary' ? (
                                    <Col xs={24} md={12} data-guide='job-contract-expiry'>
                                        <Form.Item label='Contract end date' name='expiryDate' rules={[{ required: true, message: 'Temporary contracts need an end date.' }]}>
                                            <DatePicker style={{ width: '100%' }} format='DD MMM YYYY' />
                                        </Form.Item>
                                    </Col>
                                ) : null
                            }
                        </Form.Item>
                    </Row>
                    {jobModal?.mode !== 'edit' ? (
                        <div data-guide='job-contract-upload'>
                            <Form.Item label='Contract document' required extra='PDF, Word or an image.'>
                                <Upload beforeUpload={() => false} maxCount={1} fileList={fileList} onChange={({ fileList: next }) => setFileList(next)} accept='.pdf,.doc,.docx,image/*'>
                                    <Button icon={<UploadOutlined />}>Choose file</Button>
                                </Upload>
                            </Form.Item>
                        </div>
                    ) : (
                        <Text type='secondary' style={{ fontSize: 12 }}>
                            Name, position and start date change on every document of this job. Type and end date change on the latest contract.
                        </Text>
                    )}
                </Form>
            </Modal>

            {/* ---------- end job ---------- */}
            <Modal
                open={!!endModalJob}
                onCancel={() => setEndModalJob(null)}
                onOk={endJob}
                okText='End job'
                okButtonProps={{ danger: true }}
                confirmLoading={saving}
                centered
                width={440}
                destroyOnClose
                title={`End ${endModalJob?.employeeName || 'job'}`}
            >
                <Text type='secondary'>The job stops counting after this date. Its history and documents are kept.</Text>
                <Form<EndFormValues> form={endForm} layout='vertical' style={{ marginTop: 16 }}>
                    <Form.Item label='Last day' name='endDate' rules={[{ required: true, message: 'Enter the last day.' }]}>
                        <DatePicker style={{ width: '100%' }} format='DD MMM YYYY' />
                    </Form.Item>
                    <Form.Item label='Reason' name='endReason' rules={[{ required: true, message: 'Choose a reason.' }]}>
                        <Select options={END_REASONS.map(r => ({ value: r.value, label: r.label }))} />
                    </Form.Item>
                </Form>
            </Modal>
        </div>
    )
}

export default JobManagementPage
