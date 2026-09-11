import React, { useEffect, useMemo, useState } from 'react'
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
    InputNumber,
    Typography,
    Progress,
    DatePicker,
    notification,
    Tooltip,
    Row,
    Col,
    Statistic,
    Segmented,
    Divider,
    Grid
} from 'antd'
import type { SegmentedValue } from 'antd/es/segmented'
import {
    PlusOutlined,
    EditOutlined,
    DeleteOutlined,
    SearchOutlined,
    ApartmentOutlined,
    CalendarOutlined,
    TeamOutlined,
    DashboardOutlined,
    AuditOutlined
} from '@ant-design/icons'
import {
    collection,
    getDocs,
    doc,
    updateDoc,
    deleteDoc,
    Timestamp,
    getDoc,
    addDoc,
    runTransaction,
    query,
    where,
    limit
} from 'firebase/firestore'
import { db } from '@/firebase'
import dayjs from 'dayjs'
import FullCalendar from '@fullcalendar/react'
import dayGridPlugin from '@fullcalendar/daygrid'
import timeGridPlugin from '@fullcalendar/timegrid'
import interactionPlugin from '@fullcalendar/interaction'
import { Helmet } from 'react-helmet'
import { DashboardHeaderCard, MotionCard } from '@/components/dashboards/metrics/Header'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { roundBtn } from '@/components/shared/StyledButton'

const { Text } = Typography
const { Option } = Select
const { RangePicker } = DatePicker
const { useBreakpoint } = Grid

type SegmentKey = 'resources' | 'allocations'
type AllocationMode = 'count' | 'capacity' | 'time' | 'amount' | 'booking'

interface ResourceItem {
    id: string
    name: string
    type: string
    capacity: number
    available: number
    status: string
    allocations: Allocation[]
    description: string
    location?: string // only for "space"
    allocationMode?: AllocationMode
    unitLabel?: string // Seats, Hours, Sessions, People, Items, ZAR, etc.
}

interface Allocation {
    id: string
    resourceId: string

    // SME must be selected from accepted applications
    allocatedToApplicationId: string
    allocatedToName: string
    allocatedToEmail?: string
    participantId?: string

    purpose: string
    startTime: any
    endTime: any
    quantity: number // dynamically interpreted via resource.unitLabel / allocationMode
    status: string
}

type SMEOption = {
    applicationId: string
    participantId?: string
    beneficiaryName?: string
    businessName?: string
    ownerName?: string
    email?: string
    label: string
}

const safeString = (v: any) => String(v ?? '').trim()

const inferModeAndUnitFromType = (type: string): { mode: AllocationMode; unit: string } => {
    const t = safeString(type).toLowerCase()
    if (t === 'space') return { mode: 'capacity', unit: 'Seats' }
    if (t === 'equipment') return { mode: 'count', unit: 'Items' }
    if (t === 'mentorship') return { mode: 'time', unit: 'Hours' }
    if (t === 'funding') return { mode: 'amount', unit: 'ZAR' }
    if (t === 'software') return { mode: 'booking', unit: '' }
    if (t === 'service') return { mode: 'booking', unit: '' }
    return { mode: 'count', unit: 'Units' }
}

const OperationsResourceManagement: React.FC = () => {
    const screens = useBreakpoint()

    const [resources, setResources] = useState<ResourceItem[]>([])
    const [allocations, setAllocations] = useState<Allocation[]>([])
    const [loading, setLoading] = useState(true)
    const [searchText, setSearchText] = useState('')
    const [segment, setSegment] = useState<SegmentKey>('resources')

    const [isResourceModalVisible, setIsResourceModalVisible] = useState(false)
    const [isAllocationModalVisible, setIsAllocationModalVisible] = useState(false)
    const [isCalendarModalVisible, setIsCalendarModalVisible] = useState(false)

    const [currentResource, setCurrentResource] = useState<ResourceItem | null>(null)
    const [currentAllocation, setCurrentAllocation] = useState<Allocation | null>(null)

    const [resourceForm] = Form.useForm()
    const [allocationForm] = Form.useForm()

    // ----------------------------- Program + SMEs -----------------------------
    const activeProgramId = useActiveProgramId()
    const [smes, setSmes] = useState<SMEOption[]>([])
    const [smesLoading, setSmesLoading] = useState(false)

    const fetchAcceptedSMEs = async (programId: string) => {
        if (!programId) {
            console.log('No program')
            setSmes([])
            return
        }
        setSmesLoading(true)
        try {
            const qRef = query(
                collection(db, 'applications'),
                where('programId', '==', programId),
                where('applicationStatus', '==', 'accepted')
            )
            const snap = await getDocs(qRef)

            const list: SMEOption[] = snap.docs.map(d => {
                const a: any = d.data()
                const business = safeString(a?.businessName || a?.beneficiaryName || 'SME')
                const owner = safeString(a?.ownerName)
                const email = safeString(a?.email)
                const label = [business, owner ? `(${owner})` : '', email ? `• ${email}` : '']
                    .filter(Boolean)
                    .join(' ')
                    .trim()

                return {
                    applicationId: d.id,
                    participantId: safeString(a?.participantId) || undefined,
                    businessName: safeString(a?.businessName) || undefined,
                    beneficiaryName: safeString(a?.beneficiaryName) || undefined,
                    ownerName: owner || undefined,
                    email: email || undefined,
                    label
                }
            })

            list.sort((x, y) => x.label.localeCompare(y.label))
            setSmes(list)
        } catch (error) {
            console.error('Error fetching accepted SMEs:', error)
            notification.error({
                message: 'Failed to load SMEs',
                description: 'Could not fetch accepted applicants for the active program.'
            })
            setSmes([])
        } finally {
            setSmesLoading(false)
        }
    }

    useEffect(() => {
        if (!activeProgramId) return
        fetchAcceptedSMEs(activeProgramId)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeProgramId])

    // ----------------------------- Resource types -----------------------------
    const baseResourceTypes = useMemo(
        () => [
            { value: 'space', label: 'Space' },
            { value: 'equipment', label: 'Equipment' },
            { value: 'mentorship', label: 'Mentorship' },
            { value: 'funding', label: 'Funding' },
            { value: 'software', label: 'Software' },
            { value: 'service', label: 'Service' },
            { value: 'catering', label: 'Catering' }
        ],
        []
    )

    const [customTypes, setCustomTypes] = useState<string[]>([])
    const allTypeOptions = useMemo(() => {
        const merged = [
            ...baseResourceTypes.map(t => t.value),
            ...customTypes.map(t => t.trim()).filter(Boolean)
        ]
        return Array.from(new Set(merged)).map(v => ({
            value: v,
            label: baseResourceTypes.find(b => b.value === v)?.label || v
        }))
    }, [baseResourceTypes, customTypes])

    const resourceStatuses = useMemo(
        () => [
            { value: 'available', label: 'Available', color: 'green' },
            { value: 'limited', label: 'Limited Availability', color: 'orange' },
            { value: 'unavailable', label: 'Unavailable', color: 'red' },
            { value: 'maintenance', label: 'Under Maintenance', color: 'grey' }
        ],
        []
    )

    const allocationStatuses = useMemo(
        () => [
            { value: 'scheduled', label: 'Scheduled', color: 'blue' },
            { value: 'active', label: 'Active', color: 'green' },
            { value: 'completed', label: 'Completed', color: 'grey' },
            { value: 'cancelled', label: 'Cancelled', color: 'red' }
        ],
        []
    )

    // ----------------------------- Fetching -----------------------------
    useEffect(() => {
        fetchResources()
        fetchAllocations()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const fetchResources = async () => {
        setLoading(true)
        try {
            const snapshot = await getDocs(collection(db, 'resources'))
            const fetchedResources = snapshot.docs.map(docSnap => ({
                id: docSnap.id,
                ...(docSnap.data() as any)
            })) as ResourceItem[]

            setResources(fetchedResources)
            checkLowAvailability(fetchedResources)
        } catch (error) {
            console.error('Error fetching resources:', error)
            notification.error({
                message: 'Error',
                description: 'Failed to fetch resources.'
            })
        } finally {
            setLoading(false)
        }
    }

    const fetchAllocations = async () => {
        try {
            const snapshot = await getDocs(collection(db, 'resourceAllocations'))
            const fetchedAllocations = snapshot.docs.map(docSnap => ({
                id: docSnap.id,
                ...(docSnap.data() as any)
            })) as Allocation[]

            setAllocations(fetchedAllocations)
            sendUpcomingReminders(fetchedAllocations)
        } catch (error) {
            console.error('Error fetching allocations:', error)
        }
    }

    const checkLowAvailability = (list: ResourceItem[]) => {
        list.forEach(resource => {
            if (resource.capacity > 0 && resource.available / resource.capacity < 0.1) {
                notification.warning({
                    message: 'Low Resource Availability',
                    description: `${resource.name} is running low on capacity! Only ${resource.available}/${resource.capacity} left.`
                })
            }
        })
    }

    const sendUpcomingReminders = (list: Allocation[]) => {
        const now = new Date()
        const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)

        list.forEach(allocation => {
            const startDate = new Date(allocation.startTime.seconds * 1000)
            if (startDate > now && startDate <= tomorrow && allocation.status === 'scheduled') {
                notification.info({
                    message: 'Upcoming Allocation',
                    description: `An allocation for ${allocation.allocatedToName} starts tomorrow.`
                })
            }
        })
    }

    // ----------------------------- Search -----------------------------
    const handleSearch = (value: string) => setSearchText(value)

    // ----------------------------- Resource modal -----------------------------
    const showResourceModal = (record?: ResourceItem) => {
        if (record) {
            setCurrentResource(record)
            resourceForm.setFieldsValue({
                name: record.name,
                type: record.type,
                capacity: record.capacity,
                status: record.status,
                description: record.description,
                location: record.type === 'space' ? record.location : undefined,
                allocationMode: record.allocationMode || inferModeAndUnitFromType(record.type).mode,
                unitLabel: record.unitLabel || inferModeAndUnitFromType(record.type).unit
            })
        } else {
            setCurrentResource(null)
            resourceForm.resetFields()
            resourceForm.setFieldsValue({
                status: 'available',
                allocationMode: 'count',
                unitLabel: 'Units'
            })
        }
        setIsResourceModalVisible(true)
    }

    const handleResourceCancel = () => {
        setIsResourceModalVisible(false)
        resourceForm.resetFields()
    }

    const handleResourceSubmit = async () => {
        try {
            const values = await resourceForm.validateFields()
            const typeValue = safeString(values.type)
            if (!typeValue) {
                notification.error({ message: 'Please select or add a resource type.' })
                return
            }

            // add new custom type if needed
            if (!allTypeOptions.some(o => o.value === typeValue)) {
                setCustomTypes(prev => Array.from(new Set([...prev, typeValue])))
            }

            const locationValue = typeValue === 'space' ? safeString(values.location) : undefined
            const allocationMode = (safeString(values.allocationMode) as AllocationMode) || 'count'
            const unitLabel = safeString(values.unitLabel)

            if (allocationMode !== 'booking' && !unitLabel) {
                notification.error({
                    message: 'Unit label required',
                    description: 'Please provide a unit label (e.g. Seats, Hours, Items, People, ZAR).'
                })
                return
            }

            if (currentResource) {
                await runTransaction(db, async tx => {
                    const ref = doc(db, 'resources', currentResource.id)
                    const snap = await tx.get(ref)
                    if (!snap.exists()) throw new Error('Resource not found.')

                    const existing = snap.data() as ResourceItem
                    const newCapacity = Number(values.capacity)
                    const prevCapacity = Number(existing.capacity || 0)
                    const prevAvailable = Number(existing.available || 0)

                    // keep utilization consistent
                    const shiftedAvailable = prevAvailable + (newCapacity - prevCapacity)
                    const nextAvailable = Math.max(0, Math.min(newCapacity, shiftedAvailable))

                    tx.update(ref, {
                        name: values.name,
                        type: typeValue,
                        capacity: newCapacity,
                        available: nextAvailable,
                        status: values.status,
                        description: values.description,
                        location: locationValue,
                        allocationMode,
                        unitLabel: allocationMode === 'booking' ? '' : unitLabel
                    })
                })
                notification.success({ message: 'Resource updated successfully' })
            } else {
                const newCapacity = Number(values.capacity)
                await addDoc(collection(db, 'resources'), {
                    name: values.name,
                    type: typeValue,
                    capacity: newCapacity,
                    available: newCapacity,
                    status: values.status,
                    description: values.description,
                    location: locationValue,
                    allocationMode,
                    unitLabel: allocationMode === 'booking' ? '' : unitLabel
                })
                notification.success({ message: 'Resource created successfully' })
            }

            fetchResources()
            setIsResourceModalVisible(false)
            resourceForm.resetFields()
        } catch (error) {
            console.error('Error saving resource:', error)
            notification.error({ message: 'Failed to save resource' })
        }
    }

    // ----------------------------- Allocation modal -----------------------------
    const showAllocationModal = (resourceId?: string, allocation?: Allocation) => {
        if (resourceId) {
            const resource = resources.find(r => r.id === resourceId)
            if (resource?.status === 'maintenance') {
                notification.warning({
                    message: 'Resource Under Maintenance',
                    description: 'Cannot allocate resources that are under maintenance.'
                })
                return
            }
        }

        if (allocation) {
            setCurrentAllocation(allocation)
            allocationForm.setFieldsValue({
                resourceId: allocation.resourceId,
                allocatedToApplicationId: allocation.allocatedToApplicationId,
                purpose: allocation.purpose,
                dateRange: [
                    dayjs(allocation.startTime.seconds * 1000),
                    dayjs(allocation.endTime.seconds * 1000)
                ],
                quantity: allocation.quantity,
                status: allocation.status
            })
        } else {
            setCurrentAllocation(null)
            allocationForm.resetFields()
            allocationForm.setFieldsValue({
                status: 'scheduled',
                quantity: 1,
                ...(resourceId ? { resourceId } : {})
            })
        }

        setIsAllocationModalVisible(true)
    }

    const handleAllocationCancel = () => {
        setIsAllocationModalVisible(false)
        allocationForm.resetFields()
    }

    // Watch resource selection to auto-adjust quantity / label
    const selectedResourceId = Form.useWatch('resourceId', allocationForm)
    const selectedResource = useMemo(
        () => resources.find(r => r.id === selectedResourceId),
        [resources, selectedResourceId]
    )

    const effectiveAllocationMode: AllocationMode = useMemo(() => {
        const mode = safeString(selectedResource?.allocationMode)
        return (mode as AllocationMode) || inferModeAndUnitFromType(selectedResource?.type || '').mode
    }, [selectedResource])

    const effectiveUnitLabel = useMemo(() => {
        if (effectiveAllocationMode === 'booking') return ''
        const u = safeString(selectedResource?.unitLabel)
        if (u) return u
        return inferModeAndUnitFromType(selectedResource?.type || '').unit
    }, [selectedResource, effectiveAllocationMode])

    useEffect(() => {
        if (!isAllocationModalVisible) return
        // booking = force quantity to 1 and hide field
        if (effectiveAllocationMode === 'booking') {
            allocationForm.setFieldsValue({ quantity: 1 })
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [effectiveAllocationMode, isAllocationModalVisible])

    const handleAllocationSubmit = async () => {
        try {
            const values = await allocationForm.validateFields()
            const [startDate, endDate] = values.dateRange

            const resourceId = safeString(values.resourceId)
            if (!resourceId) {
                notification.error({ message: 'Please select a resource.' })
                return
            }

            const resource = resources.find(r => r.id === resourceId)
            const mode: AllocationMode =
                (safeString(resource?.allocationMode) as AllocationMode) ||
                inferModeAndUnitFromType(resource?.type || '').mode

            const quantity =
                mode === 'booking' ? 1 : Number(values.quantity)

            // SME from accepted applications
            const applicationId = safeString(values.allocatedToApplicationId)
            const selectedSME = smes.find(s => s.applicationId === applicationId)

            if (!selectedSME) {
                notification.error({
                    message: 'SME not found',
                    description: 'Please select a valid accepted SME.'
                })
                return
            }

            await runTransaction(db, async tx => {
                const resourceRef = doc(db, 'resources', resourceId)
                const resourceSnap = await tx.get(resourceRef)
                if (!resourceSnap.exists()) throw new Error('Resource not found.')

                const resourceData = resourceSnap.data() as ResourceItem
                if (resourceData.status === 'maintenance' || resourceData.status === 'unavailable') {
                    throw new Error('This resource cannot be allocated in its current status.')
                }

                // If editing, restore previous quantity (to the right resource) before re-applying
                let availableForCheck = Number(resourceData.available || 0)

                if (currentAllocation) {
                    // restore old allocation quantity to its resource
                    const oldResRef = doc(db, 'resources', currentAllocation.resourceId)
                    const oldResSnap = await tx.get(oldResRef)
                    if (oldResSnap.exists()) {
                        const oldRes = oldResSnap.data() as ResourceItem
                        const restored = Math.min(
                            Number(oldRes.capacity || 0),
                            Number(oldRes.available || 0) + Number(currentAllocation.quantity || 0)
                        )
                        tx.update(oldResRef, { available: restored })
                    }

                    // if same resource, recompute availableForCheck from updated value
                    if (currentAllocation.resourceId === resourceId) {
                        // after restoring, we should check against restored availability
                        const refreshedSnap = await tx.get(resourceRef)
                        const refreshed = refreshedSnap.data() as ResourceItem
                        availableForCheck = Number(refreshed.available || 0)
                    }
                }

                if (availableForCheck < quantity) {
                    throw new Error(
                        `Insufficient availability. Only ${availableForCheck} units available for ${resourceData.name}.`
                    )
                }

                const newAllocationData: Omit<Allocation, 'id'> = {
                    resourceId,
                    allocatedToApplicationId: selectedSME.applicationId,
                    allocatedToName: safeString(
                        selectedSME.businessName || selectedSME.beneficiaryName || selectedSME.label
                    ),
                    allocatedToEmail: selectedSME.email,
                    participantId: selectedSME.participantId,
                    purpose: values.purpose,
                    startTime: Timestamp.fromDate(startDate.toDate()),
                    endTime: Timestamp.fromDate(endDate.toDate()),
                    quantity,
                    status: values.status
                }

                // apply availability reduction
                const nextAvailable = Math.max(0, availableForCheck - quantity)
                tx.update(resourceRef, { available: nextAvailable })

                // upsert allocation
                if (currentAllocation) {
                    const allocRef = doc(db, 'resourceAllocations', currentAllocation.id)
                    tx.update(allocRef, newAllocationData as any)
                } else {
                    const allocRef = doc(collection(db, 'resourceAllocations'))
                    tx.set(allocRef, newAllocationData as any)
                }
            })

            notification.success({
                message: currentAllocation ? 'Allocation updated' : 'Allocation created'
            })

            setIsAllocationModalVisible(false)
            allocationForm.resetFields()
            setCurrentAllocation(null)

            fetchResources()
            fetchAllocations()
        } catch (error: any) {
            console.error('Error saving allocation:', error)
            notification.error({
                message: 'Failed to save allocation',
                description: safeString(error?.message) || 'Please try again.'
            })
        }
    }

    // ----------------------------- Delete handlers -----------------------------
    const handleDeleteResource = (record: ResourceItem) => {
        Modal.confirm({
            title: 'Delete Resource?',
            content: 'All associated allocations will remain. Confirm delete?',
            okText: 'Delete',
            okType: 'danger',
            cancelText: 'Cancel',
            onOk: async () => {
                try {
                    await deleteDoc(doc(db, 'resources', record.id))
                    notification.success({ message: 'Resource deleted successfully' })
                    fetchResources()
                } catch (error) {
                    console.error('Error deleting resource:', error)
                    notification.error({ message: 'Failed to delete resource' })
                }
            }
        })
    }

    const handleDeleteAllocation = (record: Allocation) => {
        Modal.confirm({
            title: 'Delete Allocation?',
            content: 'This action cannot be undone. Confirm delete?',
            okText: 'Delete',
            okType: 'danger',
            cancelText: 'Cancel',
            onOk: async () => {
                try {
                    await runTransaction(db, async tx => {
                        const allocRef = doc(db, 'resourceAllocations', record.id)
                        const allocSnap = await tx.get(allocRef)
                        if (!allocSnap.exists()) return

                        const alloc = allocSnap.data() as Allocation

                        const resourceRef = doc(db, 'resources', alloc.resourceId)
                        const resourceSnap = await tx.get(resourceRef)
                        if (resourceSnap.exists()) {
                            const res = resourceSnap.data() as ResourceItem
                            const restored = Math.min(
                                Number(res.capacity || 0),
                                Number(res.available || 0) + Number(alloc.quantity || 0)
                            )
                            tx.update(resourceRef, { available: restored })
                        }

                        tx.delete(allocRef)
                    })

                    notification.success({ message: 'Allocation deleted successfully' })
                    fetchResources()
                    fetchAllocations()
                } catch (error) {
                    console.error('Error deleting allocation:', error)
                    notification.error({ message: 'Failed to delete allocation' })
                }
            }
        })
    }

    // ----------------------------- Filters -----------------------------
    const getFilteredResources = () => {
        if (!searchText) return resources
        const q = searchText.toLowerCase()
        return resources.filter(r => {
            const name = safeString(r.name).toLowerCase()
            const desc = safeString(r.description).toLowerCase()
            const type = safeString(r.type).toLowerCase()
            const loc = safeString(r.location).toLowerCase()
            return name.includes(q) || desc.includes(q) || type.includes(q) || loc.includes(q)
        })
    }

    const getFilteredAllocations = () => {
        if (!searchText) return allocations
        const q = searchText.toLowerCase()
        return allocations.filter(a => {
            const allocatedTo = safeString(a.allocatedToName).toLowerCase()
            const purpose = safeString(a.purpose).toLowerCase()
            const resName = safeString(resources.find(r => r.id === a.resourceId)?.name).toLowerCase()
            return allocatedTo.includes(q) || purpose.includes(q) || resName.includes(q)
        })
    }

    // ----------------------------- Columns -----------------------------
    const resourceColumns = [
        {
            title: 'Resource Name',
            dataIndex: 'name',
            key: 'name',
            render: (text: string, record: ResourceItem) => (
                <Space direction='vertical' size={0}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Text strong>{text}</Text>
                        {record.status === 'maintenance' && (
                            <Tag color='orange' style={{ fontSize: 10 }}>
                                Maintenance
                            </Tag>
                        )}
                    </div>
                    <Text type='secondary' style={{ fontSize: 12 }}>
                        {allTypeOptions.find(t => t.value === record.type)?.label || record.type}
                        {record.allocationMode && record.allocationMode !== 'booking' && record.unitLabel
                            ? ` • ${record.unitLabel}`
                            : record.allocationMode === 'booking'
                                ? ' • Booking'
                                : ''}
                    </Text>
                </Space>
            )
        },
        {
            title: 'Capacity',
            dataIndex: 'capacity',
            key: 'capacity'
        },
        {
            title: 'Availability',
            key: 'availability',
            render: (_: any, record: ResourceItem) => {
                const cap = Number(record.capacity || 0)
                const avail = Number(record.available || 0)
                const pct = cap > 0 ? Math.round((avail / cap) * 100) : 0
                return (
                    <Space direction='vertical' style={{ width: '100%' }}>
                        <Progress
                            percent={pct}
                            size='small'
                            status={cap > 0 && avail / cap < 0.2 ? 'exception' : 'normal'}
                            format={() => `${avail}/${cap}`}
                        />
                    </Space>
                )
            }
        },
        {
            title: 'Status',
            dataIndex: 'status',
            key: 'status',
            render: (status: string) => {
                const statusInfo = resourceStatuses.find(s => s.value === status)
                return <Tag color={statusInfo?.color || 'default'}>{statusInfo?.label || status}</Tag>
            }
        },
        {
            title: 'Actions',
            key: 'actions',
            render: (_: any, record: ResourceItem) => (
                <Space size='small'>
                    <Tooltip title='Edit Resource'>
                        <Button type='text' icon={<EditOutlined />} onClick={() => showResourceModal(record)} />
                    </Tooltip>
                    <Tooltip title='Allocate'>
                        <Button
                            type='text'
                            icon={<TeamOutlined />}
                            onClick={() => showAllocationModal(record.id)}
                            disabled={record.status === 'unavailable' || record.status === 'maintenance'}
                        />
                    </Tooltip>
                    <Tooltip title='Delete'>
                        <Button type='text' danger icon={<DeleteOutlined />} onClick={() => handleDeleteResource(record)} />
                    </Tooltip>
                </Space>
            )
        }
    ]

    const allocationColumns = [
        {
            title: 'Resource',
            key: 'resource',
            render: (_: any, record: Allocation) => resources.find(r => r.id === record.resourceId)?.name || 'Unknown'
        },
        {
            title: 'SME',
            key: 'sme',
            render: (_: any, record: Allocation) => (
                <Space direction='vertical' size={0}>
                    <Text strong>{record.allocatedToName || '—'}</Text>
                    {record.allocatedToEmail ? (
                        <Text type='secondary' style={{ fontSize: 12 }}>
                            {record.allocatedToEmail}
                        </Text>
                    ) : null}
                </Space>
            )
        },
        {
            title: 'Purpose',
            dataIndex: 'purpose',
            key: 'purpose',
            ellipsis: true
        },
        {
            title: 'Date/Time',
            key: 'datetime',
            render: (_: any, record: Allocation) => {
                const startDate = new Date(record.startTime.seconds * 1000)
                const endDate = new Date(record.endTime.seconds * 1000)
                const fmt = (d: Date) =>
                    d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                return (
                    <Space direction='vertical' size={0}>
                        <Text>Start: {fmt(startDate)}</Text>
                        <Text>End: {fmt(endDate)}</Text>
                    </Space>
                )
            }
        },
        {
            title: 'Value',
            key: 'qty',
            render: (_: any, record: Allocation) => {
                const res = resources.find(r => r.id === record.resourceId)
                const mode = (safeString(res?.allocationMode) as AllocationMode) || inferModeAndUnitFromType(res?.type || '').mode
                const unit = mode === 'booking' ? 'Booking' : safeString(res?.unitLabel) || inferModeAndUnitFromType(res?.type || '').unit
                if (mode === 'booking') return <Tag>Booked</Tag>
                if (mode === 'amount') return <Text>{record.quantity.toLocaleString()} {unit || 'ZAR'}</Text>
                return <Text>{record.quantity} {unit}</Text>
            }
        },
        {
            title: 'Status',
            dataIndex: 'status',
            key: 'status',
            render: (status: string) => {
                const statusInfo = allocationStatuses.find(s => s.value === status)
                return <Tag color={statusInfo?.color || 'default'}>{statusInfo?.label || status}</Tag>
            }
        },
        {
            title: 'Actions',
            key: 'actions',
            render: (_: any, record: Allocation) => (
                <Space size='small'>
                    <Tooltip title='Edit Allocation'>
                        <Button type='text' icon={<EditOutlined />} onClick={() => showAllocationModal(undefined, record)} />
                    </Tooltip>
                    <Tooltip title='Delete'>
                        <Button type='text' danger icon={<DeleteOutlined />} onClick={() => handleDeleteAllocation(record)} />
                    </Tooltip>
                </Space>
            )
        }
    ]

    // ----------------------------- Stats -----------------------------
    const getTotalCapacity = () => resources.reduce((sum, r) => sum + Number(r.capacity || 0), 0)
    const getTotalAvailable = () => resources.reduce((sum, r) => sum + Number(r.available || 0), 0)
    const getUtilizationPercentage = () => {
        const total = getTotalCapacity()
        const available = getTotalAvailable()
        return total > 0 ? Math.round(((total - available) / total) * 100) : 0
    }
    const getUpcomingAllocations = () => {
        const now = new Date()
        return allocations.filter(a => new Date(a.startTime.seconds * 1000) > now && a.status === 'scheduled').length
    }

    const calendarEvents = useMemo(() => {
        return allocations.map(alloc => {
            const r = resources.find(x => x.id === alloc.resourceId)
            const statusInfo = allocationStatuses.find(s => s.value === alloc.status)
            return {
                id: alloc.id,
                title: `${r?.name || 'Resource'} → ${alloc.allocatedToName}`,
                start: new Date(alloc.startTime.seconds * 1000),
                end: new Date(alloc.endTime.seconds * 1000),
                extendedProps: { allocation: alloc },
                backgroundColor: statusInfo?.color === 'grey' ? '#8c8c8c' : undefined,
                borderColor: statusInfo?.color === 'grey' ? '#8c8c8c' : undefined
            }
        })
    }, [allocations, resources, allocationStatuses])

    const topActions = (
        <Space wrap style={{ width: '100%', justifyContent: 'space-between' }}>
            <Input
                placeholder={segment === 'resources' ? 'Search resources...' : 'Search allocations...'}
                prefix={<SearchOutlined />}
                allowClear
                onChange={e => handleSearch(e.target.value)}
                style={{ width: screens.xs ? '100%' : 320 }}
            />

            <Space wrap>
                {segment === 'allocations' && (
                    <Button icon={<CalendarOutlined />} style={roundBtn} onClick={() => setIsCalendarModalVisible(true)}>
                        Calendar
                    </Button>
                )}
                <Button
                    type='primary'
                    icon={<PlusOutlined />}
                    style={roundBtn}
                    onClick={() => (segment === 'resources' ? showResourceModal() : showAllocationModal())}
                >
                    {segment === 'resources' ? 'Add Resource' : 'Create Allocation'}
                </Button>
            </Space>
        </Space>
    )

    return (
        <div style={{ padding: 24, minHeight: '100vh' }}>
            <Helmet>
                <title>Resources Overview | Smart Incubation</title>
            </Helmet>

            <DashboardHeaderCard
                title='Resource Management'
                subtitle='Manage and allocate resources for incubation program operations'
                extraRight={
                    <Segmented
                        value={segment}
                        onChange={(v: SegmentedValue) => setSegment(v as SegmentKey)}
                        options={[
                            {
                                label: (
                                    <Space size={8}>
                                        <ApartmentOutlined />
                                        Resources
                                    </Space>
                                ),
                                value: 'resources'
                            },
                            {
                                label: (
                                    <Space size={8}>
                                        <TeamOutlined />
                                        Allocations
                                    </Space>
                                ),
                                value: 'allocations'
                            }
                        ]}
                    />
                }
            />

            {/* Stats */}
            <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
                <Col xs={24} sm={12} md={6}>
                    <MotionCard loading={loading}>
                        <Statistic
                            title='Resource Types'
                            value={
                                resources.reduce((acc, curr) => {
                                    if (!acc.includes(curr.type)) acc.push(curr.type)
                                    return acc
                                }, [] as string[]).length
                            }
                            prefix={<DashboardOutlined />}
                            valueStyle={{ color: '#1890ff' }}
                        />
                    </MotionCard>
                </Col>
                <Col xs={24} sm={12} md={6}>
                    <MotionCard loading={loading}>
                        <Statistic
                            title='Overall Utilization'
                            value={getUtilizationPercentage()}
                            suffix='%'
                            prefix={<AuditOutlined />}
                            valueStyle={{ color: getUtilizationPercentage() > 80 ? '#ff4d4f' : '#52c41a' }}
                        />
                    </MotionCard>
                </Col>
                <Col xs={24} sm={12} md={6}>
                    <MotionCard loading={loading}>
                        <Statistic
                            title='Active Allocations'
                            value={allocations.filter(a => a.status === 'active').length}
                            prefix={<TeamOutlined />}
                            valueStyle={{ color: '#722ed1' }}
                        />
                    </MotionCard>
                </Col>
                <Col xs={24} sm={12} md={6}>
                    <MotionCard loading={loading}>
                        <Statistic
                            title='Upcoming Allocations'
                            value={getUpcomingAllocations()}
                            prefix={<CalendarOutlined />}
                            valueStyle={{ color: '#faad14' }}
                        />
                    </MotionCard>
                </Col>
            </Row>

            <MotionCard style={{ borderRadius: 14 }}>
                {topActions}
                <Divider style={{ margin: '16px 0' }} />

                {segment === 'resources' ? (
                    <Table
                        dataSource={getFilteredResources()}
                        columns={resourceColumns as any}
                        rowKey='id'
                        loading={loading}
                        pagination={{ pageSize: 10, showSizeChanger: false }}
                        expandable={{
                            expandedRowRender: record => (
                                <div style={{ margin: 0 }}>
                                    <div>
                                        <Text strong>Description:</Text> <Text>{record.description}</Text>
                                    </div>

                                    {record.type === 'space' && record.location && (
                                        <div style={{ marginTop: 6 }}>
                                            <Text strong>Location:</Text> <Text>{record.location}</Text>
                                        </div>
                                    )}

                                    {record.allocationMode ? (
                                        <div style={{ marginTop: 6 }}>
                                            <Text strong>Allocation:</Text>{' '}
                                            <Text>
                                                {record.allocationMode === 'booking'
                                                    ? 'Booking'
                                                    : `${record.allocationMode} • ${record.unitLabel || 'Units'}`}
                                            </Text>
                                        </div>
                                    ) : null}
                                </div>
                            )
                        }}
                    />
                ) : (
                    <Table
                        dataSource={getFilteredAllocations()}
                        columns={allocationColumns as any}
                        rowKey='id'
                        loading={loading}
                        pagination={{ pageSize: 10, showSizeChanger: false }}
                    />
                )}
            </MotionCard>

            {/* Resource Modal */}
            <Modal
                title={currentResource ? 'Edit Resource' : 'Add New Resource'}
                open={isResourceModalVisible}
                onCancel={handleResourceCancel}
                onOk={handleResourceSubmit}
                width={600}
                okText={currentResource ? 'Save Changes' : 'Create Resource'}
            >
                <Form
                    form={resourceForm}
                    layout='vertical'
                    onValuesChange={(changed, all) => {
                        if (Object.prototype.hasOwnProperty.call(changed, 'type')) {
                            const t = safeString(all?.type)
                            if (t !== 'space') resourceForm.setFieldsValue({ location: undefined })

                            const inferred = inferModeAndUnitFromType(t)
                            // only auto-set if user hasn't explicitly changed them
                            if (!safeString(all?.allocationMode)) resourceForm.setFieldsValue({ allocationMode: inferred.mode })
                            if (!safeString(all?.unitLabel)) resourceForm.setFieldsValue({ unitLabel: inferred.unit })
                        }

                        if (Object.prototype.hasOwnProperty.call(changed, 'allocationMode')) {
                            const mode = safeString(all?.allocationMode) as AllocationMode
                            if (mode === 'booking') {
                                resourceForm.setFieldsValue({ unitLabel: '' })
                            } else if (!safeString(all?.unitLabel)) {
                                const inferred = inferModeAndUnitFromType(safeString(all?.type))
                                resourceForm.setFieldsValue({ unitLabel: inferred.unit || 'Units' })
                            }
                        }
                    }}
                >
                    <Form.Item
                        name='name'
                        label='Resource Name'
                        rules={[{ required: true, message: 'Please enter a resource name' }]}
                    >
                        <Input placeholder='Enter resource name' />
                    </Form.Item>

                    <Form.Item
                        name='type'
                        label='Resource Type'
                        rules={[{ required: true, message: 'Please select or add a resource type' }]}
                        tooltip='You can also add a custom resource type if it’s not listed.'
                    >
                        <Select
                            placeholder='Select or add a type'
                            showSearch
                            optionFilterProp='children'
                            dropdownRender={menu => {
                                let inputVal = ''
                                return (
                                    <div>
                                        {menu}
                                        <Divider style={{ margin: '8px 0' }} />
                                        <div style={{ display: 'flex', gap: 8, padding: '0 8px 8px' }}>
                                            <Input
                                                placeholder='Add a new type (e.g. Vehicle, Printing)'
                                                onChange={e => (inputVal = e.target.value)}
                                                onKeyDown={e => {
                                                    if (e.key === 'Enter') {
                                                        e.preventDefault()
                                                        const v = safeString(inputVal)
                                                        if (!v) return
                                                        setCustomTypes(prev => Array.from(new Set([...prev, v])))
                                                        resourceForm.setFieldsValue({ type: v })
                                                    }
                                                }}
                                            />
                                            <Button
                                                onClick={() => {
                                                    const v = safeString(inputVal)
                                                    if (!v) return
                                                    setCustomTypes(prev => Array.from(new Set([...prev, v])))
                                                    resourceForm.setFieldsValue({ type: v })
                                                }}
                                            >
                                                Add
                                            </Button>
                                        </div>
                                    </div>
                                )
                            }}
                        >
                            {allTypeOptions.map(type => (
                                <Option key={type.value} value={type.value}>
                                    {type.label}
                                </Option>
                            ))}
                        </Select>
                    </Form.Item>

                    <Form.Item
                        name='capacity'
                        label='Total Capacity'
                        rules={[{ required: true, message: 'Please enter the total capacity' }]}
                    >
                        <InputNumber min={1} style={{ width: '100%' }} placeholder='Enter total capacity' />
                    </Form.Item>

                    <Form.Item
                        name='description'
                        label='Description'
                        rules={[{ required: true, message: 'Please enter a description' }]}
                    >
                        <Input.TextArea rows={3} placeholder='Enter resource description' />
                    </Form.Item>

                    <Form.Item
                        name='status'
                        label='Status'
                        rules={[{ required: true, message: 'Please select a status' }]}
                        initialValue='available'
                    >
                        <Select placeholder='Select status'>
                            {resourceStatuses.map(status => (
                                <Option key={status.value} value={status.value}>
                                    {status.label}
                                </Option>
                            ))}
                        </Select>
                    </Form.Item>

                    {/* Location only for Space */}
                    <Form.Item noStyle shouldUpdate={(prev, curr) => prev?.type !== curr?.type}>
                        {({ getFieldValue }) => {
                            const type = safeString(getFieldValue('type'))
                            if (type !== 'space') return null
                            return (
                                <Form.Item
                                    name='location'
                                    label='Location'
                                    rules={[{ required: true, message: 'Location is required for Space resources' }]}
                                >
                                    <Input placeholder='Enter location (e.g. Room A, Floor 2, Hub Office)' />
                                </Form.Item>
                            )
                        }}
                    </Form.Item>

                    {/* Allocation mode + unit */}
                    <Divider style={{ margin: '12px 0' }} />
                    <Form.Item
                        name='allocationMode'
                        label='Allocation Mode'
                        rules={[{ required: true, message: 'Please select how this resource is allocated' }]}
                        tooltip='Controls how the allocation input behaves (booking hides quantity, amount becomes ZAR, etc.)'
                    >
                        <Select placeholder='Select allocation mode'>
                            <Option value='count'>Count (Items/Units)</Option>
                            <Option value='capacity'>Capacity (Seats/People)</Option>
                            <Option value='time'>Time (Hours/Sessions)</Option>
                            <Option value='amount'>Amount (ZAR)</Option>
                            <Option value='booking'>Booking (no quantity)</Option>
                        </Select>
                    </Form.Item>

                    <Form.Item noStyle shouldUpdate={(prev, curr) => prev?.allocationMode !== curr?.allocationMode}>
                        {({ getFieldValue }) => {
                            const mode = safeString(getFieldValue('allocationMode')) as AllocationMode
                            if (mode === 'booking') {
                                return (
                                    <div style={{ marginTop: -6 }}>
                                        <Text type='secondary' style={{ fontSize: 12 }}>
                                            Booking mode hides quantity during allocation and uses a fixed value of 1 per booking.
                                        </Text>
                                    </div>
                                )
                            }
                            return (
                                <Form.Item
                                    name='unitLabel'
                                    label='Unit Label'
                                    rules={[{ required: true, message: 'Please enter a unit label' }]}
                                >
                                    <Input placeholder='e.g. Seats, Hours, Sessions, People, Items, ZAR' />
                                </Form.Item>
                            )
                        }}
                    </Form.Item>
                </Form>
            </Modal>

            {/* Allocation Modal */}
            <Modal
                title={currentAllocation ? 'Edit Allocation' : 'Create New Allocation'}
                open={isAllocationModalVisible}
                onCancel={handleAllocationCancel}
                onOk={handleAllocationSubmit}
                width={600}
                okText={currentAllocation ? 'Save Changes' : 'Create Allocation'}
            >
                {!activeProgramId ? (
                    <Card style={{ marginBottom: 12, borderRadius: 12 }}>
                        <Text strong>Active program not resolved.</Text>
                        <div style={{ marginTop: 6 }}>
                            <Text type='secondary' style={{ fontSize: 12 }}>
                                Set localStorage key <Text code>activeProgramId</Text> or ensure your programs collection has an active flag.
                            </Text>
                        </div>
                    </Card>
                ) : null}

                <Form form={allocationForm} layout='vertical'>
                    <Form.Item
                        name='resourceId'
                        label='Resource'
                        rules={[{ required: true, message: 'Please select a resource' }]}
                    >
                        <Select placeholder='Select resource' showSearch optionFilterProp='children'>
                            {resources.map(resource => (
                                <Option key={resource.id} value={resource.id}>
                                    {resource.name}
                                </Option>
                            ))}
                        </Select>
                    </Form.Item>

                    <Form.Item
                        name='allocatedToApplicationId'
                        label='SME (Accepted Applicant)'
                        rules={[{ required: true, message: 'Please select an SME' }]}
                    >
                        <Select
                            showSearch
                            loading={smesLoading}
                            disabled={!activeProgramId}
                            placeholder='Select accepted SME'
                            options={smes.map(s => ({ value: s.applicationId, label: s.label }))}
                            optionFilterProp='label'
                            filterOption={(input, opt) =>
                                safeString(opt?.label).toLowerCase().includes(input.toLowerCase())
                            }
                        />
                    </Form.Item>

                    <Form.Item
                        name='purpose'
                        label='Purpose'
                        rules={[{ required: true, message: 'Please enter the purpose of this allocation' }]}
                    >
                        <Input.TextArea rows={2} placeholder='Enter purpose of allocation' />
                    </Form.Item>

                    <Form.Item
                        name='dateRange'
                        label='Date & Time Range'
                        rules={[{ required: true, message: 'Please select the date and time range' }]}
                    >
                        <RangePicker showTime format='YYYY-MM-DD HH:mm' style={{ width: '100%' }} />
                    </Form.Item>

                    {/* Dynamic value/quantity */}
                    <Form.Item noStyle shouldUpdate>
                        {() => {
                            if (!selectedResourceId) {
                                return (
                                    <Form.Item
                                        name='quantity'
                                        label='Value'
                                        rules={[{ required: true, message: 'Please enter a value' }]}
                                    >
                                        <InputNumber min={1} style={{ width: '100%' }} />
                                    </Form.Item>
                                )
                            }

                            if (effectiveAllocationMode === 'booking') {
                                return (
                                    <Card style={{ borderRadius: 12, marginBottom: 12 }}>
                                        <Text strong>Booking resource</Text>
                                        <div style={{ marginTop: 6 }}>
                                            <Text type='secondary' style={{ fontSize: 12 }}>
                                                Quantity is not required for this resource type. A single booking is created.
                                            </Text>
                                        </div>
                                    </Card>
                                )
                            }

                            const label =
                                effectiveAllocationMode === 'amount'
                                    ? `Amount (${effectiveUnitLabel || 'ZAR'})`
                                    : `Quantity (${effectiveUnitLabel || 'Units'})`

                            return (
                                <Form.Item
                                    name='quantity'
                                    label={label}
                                    rules={[{ required: true, message: 'Please enter a value' }]}
                                >
                                    <InputNumber
                                        min={1}
                                        style={{ width: '100%' }}
                                        formatter={val => {
                                            if (effectiveAllocationMode !== 'amount') return String(val ?? '')
                                            const n = Number(String(val ?? '').replace(/[^\d.]/g, ''))
                                            if (Number.isNaN(n)) return ''
                                            return n.toLocaleString()
                                        }}
                                        parser={val => {
                                            if (!val) return 0
                                            return Number(String(val).replace(/[^\d.]/g, ''))
                                        }}
                                    />
                                </Form.Item>
                            )
                        }}
                    </Form.Item>

                    <Form.Item
                        name='status'
                        label='Status'
                        rules={[{ required: true, message: 'Please select a status' }]}
                        initialValue='scheduled'
                    >
                        <Select placeholder='Select status'>
                            {allocationStatuses.map(status => (
                                <Option key={status.value} value={status.value}>
                                    {status.label}
                                </Option>
                            ))}
                        </Select>
                    </Form.Item>
                </Form>
            </Modal>

            {/* Calendar Modal */}
            <Modal
                title={
                    <Space size={10}>
                        <CalendarOutlined />
                        Allocation Calendar
                    </Space>
                }
                open={isCalendarModalVisible}
                onCancel={() => setIsCalendarModalVisible(false)}
                footer={null}
                width={screens.xl ? 1100 : 980}
                styles={{ body: { padding: 0 } }}
            >
                <div style={{ padding: 16 }}>
                    <MotionCard
                        style={{
                            borderRadius: 16,
                            border: '1px solid #eef2ff',
                            boxShadow: '0 12px 30px rgba(0,0,0,0.08)'
                        }}
                        bodyStyle={{ padding: 16 }}
                        title={
                            <Space wrap style={{ justifyContent: 'space-between', width: '100%' }}>
                                <Space wrap>
                                    <Tag color='blue'>Scheduled</Tag>
                                    <Tag color='green'>Active</Tag>
                                    <Tag color='default'>Completed</Tag>
                                    <Tag color='red'>Cancelled</Tag>
                                </Space>

                                <Space wrap>
                                    <Button onClick={() => fetchAllocations()}>Refresh</Button>
                                </Space>
                            </Space>
                        }
                    >
                        <div
                            style={{
                                borderRadius: 14,
                                overflow: 'hidden',
                                border: '1px solid #f0f0f0'
                            }}
                        >
                            <FullCalendar
                                plugins={[dayGridPlugin, timeGridPlugin, interactionPlugin]}
                                initialView={screens.md ? 'timeGridWeek' : 'dayGridMonth'}
                                height={screens.md ? 720 : 640}
                                headerToolbar={{
                                    left: 'prev,next today',
                                    center: 'title',
                                    right: 'dayGridMonth,timeGridWeek,timeGridDay'
                                }}
                                nowIndicator
                                selectable={false}
                                events={calendarEvents as any}
                                eventClick={info => {
                                    const alloc = (info.event.extendedProps as any)?.allocation as Allocation | undefined
                                    if (!alloc) return
                                    showAllocationModal(undefined, alloc)
                                }}
                            />
                        </div>

                        <div style={{ marginTop: 12 }}>
                            <Text type='secondary' style={{ fontSize: 12 }}>
                                Tip: click an event to edit the allocation.
                            </Text>
                        </div>
                    </MotionCard>
                </div>
            </Modal>
        </div>
    )
}

export default OperationsResourceManagement
