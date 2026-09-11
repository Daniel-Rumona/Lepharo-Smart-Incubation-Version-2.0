import React, { useEffect, useMemo, useState } from 'react'
import {
    Alert,
    Button,
    Col,
    DatePicker,
    Empty,
    Form,
    Input,
    Modal,
    Popconfirm,
    Row,
    Select,
    Space,
    Table,
    Tag,
    Typography,
    Upload,
    message
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { UploadFile } from 'antd/es/upload/interface'
import {
    DeleteOutlined,
    EyeOutlined,
    FileAddOutlined,
    FolderOpenOutlined,
    ReloadOutlined,
    SearchOutlined,
    TeamOutlined,
    UserOutlined,
    SafetyCertificateOutlined,
    ClockCircleOutlined,
    FilePdfOutlined,
    UploadOutlined,
    CalendarOutlined
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
    where
} from 'firebase/firestore'
import {
    deleteObject,
    getDownloadURL,
    ref,
    uploadBytes
} from 'firebase/storage'
import dayjs, { Dayjs } from 'dayjs'

import { db, storage } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { DashboardHeaderCard, MotionCard } from '@/components/dashboards/metrics/Header'
import {
    guideTarget,
    usePageGuides,
    type PageGuideRegistration
} from '@/components/guide-me'

const { Title, Text } = Typography
const { Search } = Input

type ContractType = 'permanent' | 'temporal'

type ApplicationRow = {
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
}

type ParticipantRow = {
    id: string
    participantId?: string
    applicationId?: string
    email?: string
    contactEmail?: string
    registrationNumber?: string
    smmeNo?: string
    sector?: string
    industry?: string
    businessSector?: string
    sectorName?: string
}

type JobContract = {
    id: string
    applicationId: string
    participantId?: string

    programId?: string
    smmeName?: string
    group?: string
    gender?: string
    sector?: string

    employeeName: string
    position: string
    contractType: ContractType
    contractEndDate?: any

    uploadMonth?: string
    uploadMonthDate?: any

    fileName?: string
    fileUrl?: string
    storagePath?: string

    uploadedByName?: string
    uploadedByEmail?: string
    createdAt?: any
    updatedAt?: any
}

type FormValues = {
    employeeName: string
    position: string
    contractType: ContractType
    expiryDate?: Dayjs
    uploadMonth: Dayjs
}

const END_DATE_PERMANENT = dayjs('2030-12-31').endOf('day')

const safeLower = (value: any) => String(value || '').trim().toLowerCase()

const pickFirst = (...values: any[]) => {
    for (const value of values) {
        if (value !== undefined && value !== null && String(value).trim() !== '') return value
    }
    return ''
}

const toDayjs = (value: any): Dayjs | null => {
    if (!value) return null
    if (dayjs.isDayjs(value)) return value
    if (value?.toDate) {
        const d = dayjs(value.toDate())
        return d.isValid() ? d : null
    }
    const d = dayjs(value)
    return d.isValid() ? d : null
}

const toTimestamp = (value: any) => {
    const d = toDayjs(value)
    if (!d) return null
    return Timestamp.fromDate(d.toDate())
}

const formatDate = (value: any) => {
    const d = toDayjs(value)
    return d ? d.format('DD MMM YYYY') : '—'
}

const formatMonth = (value: any) => {
    const d = toDayjs(value)
    return d ? d.format('MMM YYYY') : '—'
}

const sanitizeFileName = (name: string) =>
    name.replace(/[^\w.\-]+/g, '_')

const buildEmployeeKey = (contract: Partial<JobContract>) =>
    [
        contract.applicationId || '',
        safeLower(contract.employeeName),
        safeLower(contract.position)
    ].join('::')

const normalizeKey = (value: any) => String(value || '').trim().toLowerCase()

const getParticipantSector = (participant: ParticipantRow | undefined) =>
    pickFirst(
        participant?.sector,
        participant?.industry,
        participant?.businessSector,
        participant?.sectorName
    ) || 'Unspecified'

const buildParticipantIndex = (rows: ParticipantRow[]) => {
    const map = new Map<string, ParticipantRow>()

    const add = (key: any, row: ParticipantRow) => {
        const k = normalizeKey(key)
        if (!k) return
        if (!map.has(k)) map.set(k, row)
    }

    rows.forEach((row) => {
        add(row.id, row)
        add((row as any).participantId, row)
        add((row as any).applicationId, row)
        add((row as any).email, row)
        add((row as any).contactEmail, row)
        add((row as any).registrationNumber, row)
        add((row as any).smmeNo, row)
    })

    return map
}

const buildApplicationsFromSnapshot = (
    docs: any[],
    participantMap: Map<string, ParticipantRow>
): ApplicationRow[] =>
    docs.map((snap) => {
        const data = snap.data() || {}

        const participantId =
            pickFirst(data.participantId, data.participantDocId, data.incubateeId) || undefined

        const appEmail = pickFirst(data.email, data.contactEmail, data.companyEmail)
        const appSmmeNo = pickFirst(data.smmeNo, data.registrationNumber)

        const participant =
            participantMap.get(normalizeKey(participantId)) ||
            participantMap.get(normalizeKey(snap.id)) ||
            participantMap.get(normalizeKey(appEmail)) ||
            participantMap.get(normalizeKey(appSmmeNo))

        return {
            id: snap.id,
            participantId,
            programId: data.programId || undefined,

            smmeNo: appSmmeNo || undefined,
            smmeName: pickFirst(
                data.beneficiaryName,
                data.companyName,
                data.businessName,
                data.enterpriseName,
                data.name
            ) || 'Unnamed SME',
            group: pickFirst(
                data.gapGroup,
                data.group,
                data.currentGroup,
                data.groupStage
            ) || 'Unspecified',
            gender: pickFirst(
                data.gender,
                data.ownerGender,
                data.directorGender,
                data.applicantGender
            ) || 'Unspecified',
            sector: getParticipantSector(participant),
            email: appEmail || undefined,
            phone: pickFirst(
                data.phone,
                data.contactPhone,
                data.mobile
            ) || undefined
        }
    })

const getContractMonthStart = (contract: Partial<JobContract>) => {
    return (
        toDayjs(contract.uploadMonthDate)?.startOf('month') ||
        (contract.uploadMonth ? dayjs(`${contract.uploadMonth}-01`).startOf('month') : null) ||
        toDayjs(contract.createdAt)?.startOf('month') ||
        toDayjs(contract.updatedAt)?.startOf('month') ||
        null
    )
}

const getContractEffectiveTime = (contract: Partial<JobContract>) => {
    return (
        getContractMonthStart(contract)?.valueOf() ||
        toDayjs(contract.updatedAt)?.valueOf() ||
        toDayjs(contract.createdAt)?.valueOf() ||
        0
    )
}

const isContractActiveInMonth = (contract: JobContract, month: Dayjs) => {
    const monthStart = month.startOf('month')
    const monthEnd = month.endOf('month')
    const uploadedMonth = getContractMonthStart(contract)

    if (!uploadedMonth) return false
    if (uploadedMonth.isAfter(monthEnd)) return false

    if (contract.contractType === 'permanent') {
        return true
    }

    const end = toDayjs(contract.contractEndDate)
    if (!end) return true

    return !end.endOf('day').isBefore(monthStart)
}

const getEffectiveContractsForMonth = (contracts: JobContract[], month: Dayjs) => {
    const map = new Map<string, JobContract>()
    const monthEnd = month.endOf('month')

    contracts.forEach((contract) => {
        const employeeKey = buildEmployeeKey(contract)
        const uploadedMonth = getContractMonthStart(contract)

        if (!uploadedMonth || uploadedMonth.isAfter(monthEnd)) return
        if (!isContractActiveInMonth(contract, month)) return

        const current = map.get(employeeKey)

        if (!current) {
            map.set(employeeKey, contract)
            return
        }

        const currentTime = getContractEffectiveTime(current)
        const incomingTime = getContractEffectiveTime(contract)

        if (incomingTime >= currentTime) {
            map.set(employeeKey, contract)
        }
    })

    return Array.from(map.values())
}

const JobManagementPage: React.FC = () => {
    const { user } = useFullIdentity() as { user?: any }
    const { activeProgramId, isAllPrograms } = useActiveProgramId()

    const [loading, setLoading] = useState(true)
    const [apps, setApps] = useState<ApplicationRow[]>([])
    const [contracts, setContracts] = useState<JobContract[]>([])
    const [participantMap, setParticipantMap] = useState<Map<string, ParticipantRow>>(new Map())

    const [searchText, setSearchText] = useState('')
    const [groupFilter, setGroupFilter] = useState<string | undefined>()
    const [genderFilter, setGenderFilter] = useState<string | undefined>()
    const [sectorFilter, setSectorFilter] = useState<string | undefined>()
    const [historyMonth, setHistoryMonth] = useState<Dayjs>(dayjs().startOf('month'))

    const [selectedSME, setSelectedSME] = useState<ApplicationRow | null>(null)
    const [documentsModalOpen, setDocumentsModalOpen] = useState(false)
    const [addModalOpen, setAddModalOpen] = useState(false)

    const [saving, setSaving] = useState(false)
    const [fileList, setFileList] = useState<UploadFile[]>([])

    const [form] = Form.useForm<FormValues>()

    useEffect(() => {

        setLoading(true)

        const appConstraints: any[] = [

            where('applicationStatus', 'in', ['Accepted', 'accepted'])
        ]

        if (!isAllPrograms && activeProgramId) {
            appConstraints.push(where('programId', '==', activeProgramId))
        }

        const contractsConstraints: any[] = []

        if (!isAllPrograms && activeProgramId) {
            contractsConstraints.push(where('programId', '==', activeProgramId))
        }

        const qParticipants = query(collection(db, 'participants'))
        const qApps = query(collection(db, 'applications'), ...appConstraints)
        const qContracts = query(collection(db, 'hseJobContracts'), ...contractsConstraints)

        let participantsLoaded = false
        let appsLoaded = false
        let contractsLoaded = false

        let latestAppsDocs: any[] = []
        let latestParticipantMap = new Map<string, ParticipantRow>()

        const finishLoading = () => {
            if (participantsLoaded && appsLoaded && contractsLoaded) {
                setLoading(false)
            }
        }

        const rebuildApplications = () => {
            setApps(buildApplicationsFromSnapshot(latestAppsDocs, latestParticipantMap))
        }

        const unsubParticipants = onSnapshot(
            qParticipants,
            (snap) => {
                const participantRows: ParticipantRow[] = snap.docs.map((d) => ({
                    id: d.id,
                    ...(d.data() as any)
                }))

                latestParticipantMap = buildParticipantIndex(participantRows)
                setParticipantMap(latestParticipantMap)
                participantsLoaded = true
                rebuildApplications()
            },
            (error) => {
                console.error('Failed to load participants:', error)
                message.error('Failed to load participant sector data.')
                participantsLoaded = true
                finishLoading()
            }
        )

        const unsubApps = onSnapshot(
            qApps,
            (snap) => {
                latestAppsDocs = snap.docs
                appsLoaded = true
                rebuildApplications()
                finishLoading()
            },
            (error) => {
                console.error('Failed to load applications:', error)
                message.error('Failed to load SMEs.')
                appsLoaded = true
                finishLoading()
            }
        )

        const unsubContracts = onSnapshot(
            qContracts,
            (snap) => {
                const rows: JobContract[] = snap.docs.map((d) => ({
                    id: d.id,
                    ...(d.data() as any)
                }))
                setContracts(rows)
                contractsLoaded = true
                finishLoading()
            },
            (error) => {
                console.error('Failed to load contracts:', error)
                message.error('Failed to load HSE job contracts.')
                contractsLoaded = true
                finishLoading()
            }
        )

        return () => {
            unsubParticipants()
            unsubApps()
            unsubContracts()
        }
    }, [activeProgramId, isAllPrograms])

    const groupOptions = useMemo(() => {
        return Array.from(new Set(apps.map((x) => x.group).filter(Boolean))).map((value) => ({
            label: value,
            value
        }))
    }, [apps])

    const genderOptions = useMemo(() => {
        return Array.from(new Set(apps.map((x) => x.gender).filter(Boolean))).map((value) => ({
            label: value,
            value
        }))
    }, [apps])

    const sectorOptions = useMemo(() => {
        return Array.from(new Set(apps.map((x) => x.sector).filter(Boolean))).map((value) => ({
            label: value,
            value
        }))
    }, [apps])

    const effectiveContractsForMonth = useMemo(() => {
        return getEffectiveContractsForMonth(contracts, historyMonth)
    }, [contracts, historyMonth])

    const employeeCountByApplication = useMemo(() => {
        const map = new Map<string, number>()
        effectiveContractsForMonth.forEach((contract) => {
            map.set(contract.applicationId, (map.get(contract.applicationId) || 0) + 1)
        })
        return map
    }, [effectiveContractsForMonth])

    const filteredRows = useMemo(() => {
        return apps.filter((row) => {
            const haystack = [
                row.smmeName,
                row.smmeNo,
                row.group,
                row.gender,
                row.sector,
                row.email,
                row.phone
            ]
                .join(' ')
                .toLowerCase()

            const matchesSearch =
                !searchText.trim() || haystack.includes(searchText.trim().toLowerCase())

            const matchesGroup = !groupFilter || row.group === groupFilter
            const matchesGender = !genderFilter || row.gender === genderFilter
            const matchesSector = !sectorFilter || row.sector === sectorFilter

            return matchesSearch && matchesGroup && matchesGender && matchesSector
        })
    }, [apps, genderFilter, groupFilter, searchText, sectorFilter])

    const visibleApplicationIds = useMemo(
        () => new Set(filteredRows.map((row) => row.id)),
        [filteredRows]
    )

    const visibleEffectiveContracts = useMemo(() => {
        return effectiveContractsForMonth.filter((contract) =>
            visibleApplicationIds.has(contract.applicationId)
        )
    }, [effectiveContractsForMonth, visibleApplicationIds])

    const metrics = useMemo(() => {
        const totalSMEs = filteredRows.length
        const totalEmployees = visibleEffectiveContracts.length

        const permanentEmployees = visibleEffectiveContracts.filter(
            (x) => x.contractType === 'permanent'
        ).length

        const temporalEmployees = visibleEffectiveContracts.filter(
            (x) => x.contractType === 'temporal'
        ).length

        const expiringSoon = visibleEffectiveContracts.filter((x) => {
            if (x.contractType !== 'temporal') return false
            const end = toDayjs(x.contractEndDate)
            if (!end) return false

            const monthEnd = historyMonth.endOf('month')
            const diff = end.endOf('day').diff(monthEnd.startOf('day'), 'day')

            return diff >= 0 && diff <= 30
        }).length

        return {
            totalSMEs,
            totalEmployees,
            permanentEmployees,
            temporalEmployees,
            expiringSoon
        }
    }, [filteredRows, visibleEffectiveContracts, historyMonth])

    const selectedContracts = useMemo(() => {
        if (!selectedSME) return []

        return contracts
            .filter((contract) => contract.applicationId === selectedSME.id)
            .sort((a, b) => {
                const am =
                    toDayjs(a.uploadMonthDate)?.valueOf() ||
                    toDayjs(a.updatedAt)?.valueOf() ||
                    toDayjs(a.createdAt)?.valueOf() ||
                    0

                const bm =
                    toDayjs(b.uploadMonthDate)?.valueOf() ||
                    toDayjs(b.updatedAt)?.valueOf() ||
                    toDayjs(b.createdAt)?.valueOf() ||
                    0

                return bm - am
            })
    }, [contracts, selectedSME])

    const hasVisibleSmes = filteredRows.length > 0

    const guideRegistration = useMemo<PageGuideRegistration>(
        () => ({
            pageId: 'job-management',
            pageTitle: 'Job Management',
            guides: [
                {
                    id: 'job-management-overview',
                    title: 'Quick tour',
                    description:
                        'Understand the job metrics, reporting month, filters and SME contract table.',
                    kind: 'page',
                    order: 1,
                    steps: [
                        {
                            element: guideTarget('job-management-metrics'),
                            popover: {
                                title: 'Job metrics',
                                description:
                                    'These metrics summarise SMEs and active employee contracts for the selected reporting month and current filters.',
                                side: 'bottom',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('job-management-filters'),
                            popover: {
                                title: 'Filters and reporting month',
                                description:
                                    'Search SMEs and filter by group, gender and sector. The month determines which employee contracts count as active for the metrics and table.',
                                side: 'bottom',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('job-management-table'),
                            waitForElement: 1500,
                            popover: {
                                title: 'SME job records',
                                description:
                                    'Each row shows the SME and its effective employee count for the selected reporting month. Use Manage to review contract documents.',
                                side: 'top',
                                align: 'start'
                            }
                        }
                    ]
                },
                ...(hasVisibleSmes
                    ? [
                        {
                            id: 'job-management-contracts',
                            title: 'Manage SME contracts',
                            description:
                                'Open an SME and review its uploaded employee contract history.',
                            kind: 'task' as const,
                            order: 2,
                            steps: [
                                {
                                    element: '[data-guide="job-management-manage-action"]',
                                    waitForElement: 1500,
                                    advanceOnClick: true,
                                    popover: {
                                        title: 'Manage contracts',
                                        description:
                                            'Select Manage on an SME to open its employee contract workspace.',
                                        side: 'left' as const,
                                        align: 'center' as const,
                                        showButtons: ['close']
                                    }
                                },
                                {
                                    element: '.guide-job-documents-modal',
                                    waitForElement: 5000,
                                    popover: {
                                        title: 'SME contract workspace',
                                        description:
                                            'Review all uploaded employee contracts for the selected SME. Contract history is preserved by reporting month.',
                                        side: 'left' as const,
                                        align: 'start' as const
                                    }
                                },
                                {
                                    element: guideTarget('job-contracts-table'),
                                    waitForElement: 1500,
                                    popover: {
                                        title: 'Existing contracts',
                                        description:
                                            'Review employee, position, contract type, expiry, upload month and file details. Historical uploads remain available here.',
                                        side: 'top' as const,
                                        align: 'start' as const
                                    }
                                },
                                {
                                    element: '[data-guide="job-contract-view-action"]',
                                    waitForElement: 1200,
                                    skipMissingElement: true,
                                    popover: {
                                        title: 'View contract',
                                        description:
                                            'Open an uploaded contract document in a new browser tab.',
                                        side: 'left' as const,
                                        align: 'center' as const
                                    }
                                },
                                {
                                    element: guideTarget('job-add-document-action'),
                                    waitForElement: 1200,
                                    popover: {
                                        title: 'Add Document',
                                        description:
                                            'Use Add Document when you need to capture a new employee contract or backdate a contract to a reporting month.',
                                        side: 'bottom' as const,
                                        align: 'end' as const
                                    }
                                }
                            ]
                        },
                        {
                            id: 'job-management-add-contract',
                            title: 'Add a contract',
                            description:
                                'Open an SME and capture a new employee contract document.',
                            kind: 'task' as const,
                            order: 3,
                            steps: [
                                {
                                    element: '[data-guide="job-management-manage-action"]',
                                    waitForElement: 1500,
                                    advanceOnClick: true,
                                    popover: {
                                        title: 'Choose an SME',
                                        description:
                                            'Open Manage for the SME whose employee contract you want to capture.',
                                        side: 'left' as const,
                                        align: 'center' as const,
                                        showButtons: ['close']
                                    }
                                },
                                {
                                    element: guideTarget('job-add-document-action'),
                                    waitForElement: 5000,
                                    advanceOnClick: true,
                                    popover: {
                                        title: 'Add Document',
                                        description:
                                            'Open the Add Contract form.',
                                        side: 'bottom' as const,
                                        align: 'end' as const,
                                        showButtons: ['close']
                                    }
                                },
                                {
                                    element: '.guide-job-add-contract-modal',
                                    waitForElement: 5000,
                                    popover: {
                                        title: 'Add Contract',
                                        description:
                                            'Capture the employee contract details and upload the supporting document.',
                                        side: 'left' as const,
                                        align: 'start' as const
                                    }
                                },
                                {
                                    element: guideTarget('job-contract-employee-details'),
                                    waitForElement: 1500,
                                    popover: {
                                        title: 'Employee details',
                                        description:
                                            'Enter the employee name and position exactly as they should appear in the job record.',
                                        side: 'top' as const,
                                        align: 'start' as const
                                    }
                                },
                                {
                                    element: guideTarget('job-contract-type-month'),
                                    waitForElement: 1500,
                                    popover: {
                                        title: 'Contract type and reporting month',
                                        description:
                                            'Choose Permanent or Temporal, then select the reporting month this document belongs to. This allows historical contracts to be backdated correctly.',
                                        side: 'top' as const,
                                        align: 'start' as const
                                    }
                                },
                                {
                                    element: guideTarget('job-contract-expiry'),
                                    waitForElement: 1500,
                                    popover: {
                                        title: 'Expiry date',
                                        description:
                                            'Temporal contracts require an expiry date. Permanent contracts use the configured permanent end date automatically.',
                                        side: 'top' as const,
                                        align: 'start' as const
                                    }
                                },
                                {
                                    element: guideTarget('job-contract-upload'),
                                    waitForElement: 1500,
                                    popover: {
                                        title: 'Contract document',
                                        description:
                                            'Choose the supporting PDF, Word document or image file for this employee contract.',
                                        side: 'top' as const,
                                        align: 'start' as const
                                    }
                                },
                                {
                                    element: '.guide-job-save-contract',
                                    waitForElement: 1500,
                                    popover: {
                                        title: 'Save Contract',
                                        description:
                                            'Save the contract after all required employee details and the supporting document have been captured.',
                                        side: 'top' as const,
                                        align: 'center' as const
                                    }
                                }
                            ]
                        }
                    ]
                    : [])
            ]
        }),
        [hasVisibleSmes]
    )

    usePageGuides(guideRegistration)

    const openDocumentsModal = (row: ApplicationRow) => {
        setSelectedSME(row)
        setDocumentsModalOpen(true)
        setAddModalOpen(false)
        setFileList([])
        form.resetFields()
    }

    const closeDocumentsModal = () => {
        setDocumentsModalOpen(false)
        setAddModalOpen(false)
        setSelectedSME(null)
        setFileList([])
        form.resetFields()
    }

    const openAddModal = () => {
        setAddModalOpen(true)
        setFileList([])
        form.resetFields()
        form.setFieldsValue({
            contractType: 'permanent',
            uploadMonth: dayjs()
        })
    }

    const closeAddModal = () => {
        setAddModalOpen(false)
        setFileList([])
        form.resetFields()
    }

    const handleUploadContract = async () => {
        if (!selectedSME) return

        try {
            const values = await form.validateFields()

            if (!fileList.length || !fileList[0]?.originFileObj) {
                message.error('Please choose a contract document first.')
                return
            }

            setSaving(true)

            const contractType = values.contractType
            const expiryDate =
                contractType === 'permanent'
                    ? END_DATE_PERMANENT
                    : values.expiryDate

            if (contractType === 'temporal' && !expiryDate) {
                message.error('Temporal contracts require an expiry date.')
                setSaving(false)
                return
            }

            const uploadMonth = values.uploadMonth?.startOf('month')
            if (!uploadMonth) {
                message.error('Please select the month for this upload.')
                setSaving(false)
                return
            }

            const file = fileList[0].originFileObj as File
            const storagePath = [
                'jobContracts',
                selectedSME.id,
                uploadMonth.format('YYYY-MM'),
                `${Date.now()}_${sanitizeFileName(file.name)}`
            ].join('/')

            const storageRef = ref(storage, storagePath)
            await uploadBytes(storageRef, file)
            const fileUrl = await getDownloadURL(storageRef)

            await addDoc(collection(db, 'hseJobContracts'), {
                applicationId: selectedSME.id,
                participantId: selectedSME.participantId || null,
                programId: selectedSME.programId || activeProgramId || null,

                smmeName: selectedSME.smmeName,
                group: selectedSME.group,
                gender: selectedSME.gender,
                sector: selectedSME.sector,

                employeeName: values.employeeName.trim(),
                position: values.position.trim(),
                contractType,
                contractEndDate: toTimestamp(expiryDate),

                uploadMonth: uploadMonth.format('YYYY-MM'),
                uploadMonthDate: toTimestamp(uploadMonth),

                fileName: file.name,
                fileUrl,
                storagePath,

                uploadedByName: user?.name || user?.displayName || user?.email || 'Unknown User',
                uploadedByEmail: user?.email || null,
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            })

            message.success('Contract uploaded successfully.')
            closeAddModal()
        } catch (error: any) {
            console.error('Failed to upload contract:', error)
            message.error(error?.message || 'Failed to upload contract.')
        } finally {
            setSaving(false)
        }
    }

    const handleDeleteContract = async (contract: JobContract) => {
        try {
            await deleteDoc(doc(db, 'hseJobContracts', contract.id))

            if (contract.storagePath) {
                try {
                    await deleteObject(ref(storage, contract.storagePath))
                } catch (storageError) {
                    console.warn('Storage file could not be deleted:', storageError)
                }
            }

            message.success('Contract removed.')
        } catch (error: any) {
            console.error('Failed to delete contract:', error)
            message.error(error?.message || 'Failed to delete contract.')
        }
    }

    const tableColumns: ColumnsType<ApplicationRow> = [
        {
            title: 'SME Name',
            dataIndex: 'smmeName',
            key: 'smmeName',
            render: (_value, row) => (
                <Space direction='vertical' size={0}>
                    <Text strong>{row.smmeName}</Text>
                    {/* {row.smmeNo ? <Text type='secondary'>{row.smmeNo}</Text> : null} */}
                </Space>
            )
        },
        {
            title: 'Group',
            dataIndex: 'group',
            key: 'group',
            width: 120,
            render: (value) => <Tag color='blue'>{value || 'Unspecified'}</Tag>
        },
        {
            title: 'Gender',
            dataIndex: 'gender',
            key: 'gender',
            width: 140,
            render: (value) => value || 'Unspecified'
        },
        {
            title: 'Sector',
            dataIndex: 'sector',
            key: 'sector',
            width: 180,
            render: (value) => value || 'Unspecified'
        },
        {
            title: 'Employees',
            key: 'employees',
            width: 120,
            render: (_value, row) => employeeCountByApplication.get(row.id) || 0
        },
        {
            title: 'Action',
            key: 'action',
            width: 150,
            fixed: 'right',
            render: (_value, row) => (
                <Button
                    data-guide='job-management-manage-action'
                    variant='filled'
                    color='blue'
                    shape='round'
                    icon={<FolderOpenOutlined />}
                    style={{ border: '1px solid dodgerblue' }}
                    onClick={() => openDocumentsModal(row)}
                >
                    Manage
                </Button>
            )
        }
    ]

    const contractColumns: ColumnsType<JobContract> = [
        {
            title: 'Month',
            key: 'uploadMonth',
            width: 120,
            render: (_value, row) => (
                <Tag color='purple'>
                    {row.uploadMonth || formatMonth(row.uploadMonthDate)}
                </Tag>
            )
        },
        {
            title: 'Employee',
            dataIndex: 'employeeName',
            key: 'employeeName',
            render: (value, row) => (
                <Space direction='vertical' size={0}>
                    <Text strong>{value}</Text>
                    <Text type='secondary'>{row.position || '—'}</Text>
                </Space>
            )
        },
        {
            title: 'Type',
            dataIndex: 'contractType',
            key: 'contractType',
            width: 120,
            render: (value: ContractType) =>
                value === 'permanent' ? (
                    <Tag color='green'>Permanent</Tag>
                ) : (
                    <Tag color='orange'>Temporal</Tag>
                )
        },
        {
            title: 'Expiry',
            dataIndex: 'contractEndDate',
            key: 'contractEndDate',
            width: 150,
            render: (value, row) => {
                const end = toDayjs(value)
                const diff = end ? end.endOf('day').diff(dayjs().startOf('day'), 'day') : null

                return (
                    <Space direction='vertical' size={0}>
                        <Text>{formatDate(value)}</Text>
                        {row.contractType === 'temporal' && diff !== null && diff <= 30 && diff >= 0 ? (
                            <Text type='warning'>Expiring in {diff} days</Text>
                        ) : null}
                    </Space>
                )
            }
        },
        {
            title: 'File',
            key: 'file',
            width: 120,
            render: (_value, row) => (
                <Button
                    data-guide='job-contract-view-action'
                    size='small'
                    icon={<EyeOutlined />}
                    onClick={() => row.fileUrl && window.open(row.fileUrl, '_blank', 'noopener,noreferrer')}
                >
                    View
                </Button>
            )
        },
        {
            title: 'Uploaded',
            key: 'uploaded',
            width: 180,
            render: (_value, row) => (
                <Space direction='vertical' size={0}>
                    <Text>{formatDate(row.createdAt)}</Text>
                    <Text type='secondary'>{row.uploadedByName || '—'}</Text>
                </Space>
            )
        },
        {
            title: 'Action',
            key: 'delete',
            width: 110,
            render: (_value, row) => (
                <Popconfirm
                    title='Remove this contract?'
                    onConfirm={() => handleDeleteContract(row)}
                    okText='Remove'
                    cancelText='Cancel'
                >
                    <Button danger icon={<DeleteOutlined />} size='small'>
                        Remove
                    </Button>
                </Popconfirm>
            )
        }
    ]

    const filterBar = (
        <Row data-guide='job-management-filters' gutter={[12, 12]}>
            <Col xs={24} md={12} lg={7}>
                <Search
                    allowClear
                    placeholder='Search SME name, number, sector or group'
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                    prefix={<SearchOutlined />}
                />
            </Col>

            <Col xs={24} sm={12} md={4} lg={3}>
                <Select
                    allowClear
                    placeholder='Group'
                    style={{ width: '100%' }}
                    value={groupFilter}
                    onChange={setGroupFilter}
                    options={groupOptions}
                />
            </Col>

            <Col xs={24} sm={12} md={4} lg={3}>
                <Select
                    allowClear
                    placeholder='Gender'
                    style={{ width: '100%' }}
                    value={genderFilter}
                    onChange={setGenderFilter}
                    options={genderOptions}
                />
            </Col>

            <Col xs={24} sm={12} md={4} lg={3}>
                <Select
                    allowClear
                    placeholder='Sector'
                    style={{ width: '100%' }}
                    value={sectorFilter}
                    onChange={setSectorFilter}
                    options={sectorOptions}
                />
            </Col>

            <Col xs={24} sm={12} md={6} lg={4}>
                <DatePicker
                    picker='month'
                    style={{ width: '100%' }}
                    format='MMM YYYY'
                    value={historyMonth}
                    onChange={(value) => setHistoryMonth((value || dayjs()).startOf('month'))}
                />
            </Col>

            <Col xs={24} sm={12} md={6} lg={4}>
                <Button
                    block
                    icon={<ReloadOutlined />}
                    onClick={() => {
                        setSearchText('')
                        setGroupFilter(undefined)
                        setGenderFilter(undefined)
                        setSectorFilter(undefined)
                        setHistoryMonth(dayjs().startOf('month'))
                    }}
                >
                    Reset filters
                </Button>
            </Col>
        </Row>
    )

    return (
        <div style={{ padding: 24, minHeight: '100vh' }}>
            <Row
                data-guide='job-management-metrics'
                gutter={[16, 16]}
                style={{ marginBottom: 16 }}
            >
                <Col xs={24} sm={12} xl={6}>
                    <MotionCard.Metric
                        icon={<TeamOutlined style={{ fontSize: 18, color: '#1677ff' }} />}
                        iconBg='rgba(22,119,255,0.12)'
                        title='Total SMEs'
                        value={metrics.totalSMEs}
                        subtitle='Based on current filters'
                    />
                </Col>

                <Col xs={24} sm={12} xl={6}>
                    <MotionCard.Metric
                        icon={<UserOutlined style={{ fontSize: 18, color: '#13c2c2' }} />}
                        iconBg='rgba(19,194,194,0.12)'
                        title='Total Employees'
                        value={metrics.totalEmployees}
                        subtitle={`As at ${historyMonth.format('MMM YYYY')}`}
                    />
                </Col>

                <Col xs={24} sm={12} xl={6}>
                    <MotionCard.Metric
                        icon={<FilePdfOutlined style={{ fontSize: 18, color: '#52c41a' }} />}
                        iconBg='rgba(82,196,26,0.12)'
                        title='Permanent Employees'
                        value={metrics.permanentEmployees}
                        subtitle={`In ${historyMonth.format('MMM YYYY')}`}
                    />
                </Col>

                <Col xs={24} sm={12} xl={6}>
                    <MotionCard.Metric
                        icon={<ClockCircleOutlined style={{ fontSize: 18, color: '#fa8c16' }} />}
                        iconBg='rgba(250,140,22,0.12)'
                        title='Temporal Expiring Soon'
                        value={metrics.expiringSoon}
                        subtitle={`From ${historyMonth.format('MMM YYYY')} month-end`}
                    />
                </Col>
            </Row>

            <MotionCard
                filterBar={filterBar}
                filterBarProps={{
                    background: '#f8fbff',
                    borderColor: '#d9e8ff',
                    borderRadius: 14,
                    padding: 16,
                    marginBottom: 16
                }}
            >
                <div data-guide='job-management-table'>
                    <Table<ApplicationRow>
                        rowKey='id'
                        loading={loading}
                        columns={tableColumns}
                        dataSource={filteredRows}
                        scroll={{ x: 900 }}
                        pagination={{
                            pageSize: 10,
                            showSizeChanger: false,
                            position: ['bottomCenter']
                        }}
                        locale={{
                            emptyText: (
                                <Empty
                                    description='No SMEs found for the current filters'
                                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                                />
                            )
                        }}
                    />
                </div>
            </MotionCard>

            <Modal
                className='guide-job-documents-modal'
                open={documentsModalOpen}
                onCancel={closeDocumentsModal}
                centered
                footer={null}
                width={1100}
                destroyOnClose={false}
                title={
                    <Space direction='vertical' size={0}>
                        <Title level={5} style={{ margin: 0 }}>
                            {selectedSME?.smmeName || 'SME Documents'}
                        </Title>
                        <Text type='secondary'>
                            {selectedSME?.group || 'Unspecified'} • {selectedSME?.sector || 'Unspecified'}
                        </Text>
                    </Space>
                }
            >
                {selectedSME ? (
                    <>
                        <Alert
                            type='info'
                            showIcon
                            style={{ marginBottom: 16 }}
                            message='This modal shows the existing employee contracts for the selected SME. Use Add Document to upload a new one and specify the reporting month.'
                        />

                        <Row justify='space-between' align='middle' style={{ marginBottom: 12 }}>
                            <Col>
                                <Space direction='vertical' size={0}>
                                    <Text strong>Existing Documents</Text>
                                    <Text type='secondary'>
                                        {selectedContracts.length} contract{selectedContracts.length === 1 ? '' : 's'} found
                                    </Text>
                                </Space>
                            </Col>
                            <Col>
                                <Button
                                    data-guide='job-add-document-action'
                                    type='primary'
                                    icon={<FileAddOutlined />}
                                    onClick={openAddModal}
                                >
                                    Add Document
                                </Button>
                            </Col>
                        </Row>

                        <div data-guide='job-contracts-table'>
                            <Table<JobContract>
                                rowKey='id'
                                columns={contractColumns}
                                dataSource={selectedContracts}
                                size='middle'
                                pagination={{ pageSize: 6, showSizeChanger: true }}
                                scroll={{ x: 980 }}
                                locale={{
                                    emptyText: (
                                        <Empty
                                            description='No contracts uploaded for this SME yet'
                                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                                        />
                                    )
                                }}
                            />
                        </div>
                    </>
                ) : null}
            </Modal>

            <Modal
                className='guide-job-add-contract-modal'
                open={addModalOpen}
                onCancel={closeAddModal}
                onOk={handleUploadContract}
                okText='Save Contract'
                centered
                confirmLoading={saving}
                okButtonProps={{ className: 'guide-job-save-contract' }}
                width={700}
                destroyOnClose={false}
                title={
                    <Space>
                        <FileAddOutlined />
                        <span>Add Contract</span>
                    </Space>
                }
            >
                <Alert
                    type='info'
                    showIcon
                    style={{ marginBottom: 16 }}
                    message='Capture the employee contract details and select the month this upload belongs to. This lets HSE backdate documents properly.'
                />

                <Form<FormValues>
                    form={form}
                    layout='vertical'
                    initialValues={{
                        contractType: 'permanent',
                        uploadMonth: dayjs()
                    }}
                >
                    <Row
                        data-guide='job-contract-employee-details'
                        gutter={[12, 0]}
                    >
                        <Col xs={24} md={12}>
                            <Form.Item
                                label='Employee Name'
                                name='employeeName'
                                rules={[{ required: true, message: 'Please enter the employee name.' }]}
                            >
                                <Input placeholder='Enter employee name' />
                            </Form.Item>
                        </Col>

                        <Col xs={24} md={12}>
                            <Form.Item
                                label='Position'
                                name='position'
                                rules={[{ required: true, message: 'Please enter the position.' }]}
                            >
                                <Input placeholder='Enter employee position' />
                            </Form.Item>
                        </Col>

                        <Col xs={24} md={12}>
                            <div data-guide='job-contract-type-month'>
                                <Form.Item
                                    label='Contract Type'
                                    name='contractType'
                                    rules={[{ required: true, message: 'Please select a contract type.' }]}
                                >
                                    <Select
                                        options={[
                                            { label: 'Permanent', value: 'permanent' },
                                            { label: 'Temporal', value: 'temporal' }
                                        ]}
                                    />
                                </Form.Item>
                            </div>
                        </Col>

                        <Col xs={24} md={12}>
                            <div data-guide='job-contract-type-month'>
                                <Form.Item
                                    label='Upload Month'
                                    name='uploadMonth'
                                    rules={[{ required: true, message: 'Please select the reporting month.' }]}
                                >
                                    <DatePicker
                                        picker='month'
                                        style={{ width: '100%' }}
                                        format='MMM YYYY'
                                        suffixIcon={<CalendarOutlined />}
                                    />
                                </Form.Item>
                            </div>
                        </Col>
                    </Row>

                    <div data-guide='job-contract-expiry'>
                        <Form.Item
                            shouldUpdate={(prev, next) => prev.contractType !== next.contractType}
                            noStyle
                        >
                            {({ getFieldValue }) =>
                                getFieldValue('contractType') === 'temporal' ? (
                                    <Form.Item
                                        label='Expiry Date'
                                        name='expiryDate'
                                        rules={[{ required: true, message: 'Please select the expiry date.' }]}
                                    >
                                        <DatePicker
                                            style={{ width: '100%' }}
                                            format='DD MMM YYYY'
                                        />
                                    </Form.Item>
                                ) : (
                                    <Form.Item label='Expiry Date'>
                                        <Input value='31 Dec 2030' disabled />
                                    </Form.Item>
                                )
                            }
                        </Form.Item>
                    </div>

                    <div data-guide='job-contract-upload'>
                        <Form.Item
                            label='Contract Document'
                            required
                            extra='PDF, DOC, DOCX or image files are supported.'
                        >
                            <Upload
                                beforeUpload={() => false}
                                maxCount={1}
                                fileList={fileList}
                                onChange={({ fileList: nextList }) => setFileList(nextList)}
                            >
                                <Button icon={<UploadOutlined />}>Choose file</Button>
                            </Upload>
                        </Form.Item>
                    </div>
                </Form>
            </Modal>
        </div>
    )
}

export default JobManagementPage
