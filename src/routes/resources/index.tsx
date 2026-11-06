import React, { useEffect, useMemo, useState } from 'react'
import {
    Card,
    List,
    Result,
    Popconfirm,
    Grid,
    theme,
    Button,
    Space,
    Tag,
    Input,
    Tooltip,
    Progress,
    Typography,
    Modal,
    Form,
    Select,
    InputNumber,
    message,
    notification,
    Row,
    Col,
    Segmented,
    Badge
} from 'antd'
import {
    PlusOutlined,
    EditOutlined,
    DeleteOutlined,
    SearchOutlined,
    DashboardOutlined,
    TeamOutlined,
    PieChartOutlined,
    CalendarOutlined,
    AppstoreOutlined,
    CheckCircleOutlined,
    ToolOutlined,
    StopOutlined,
    InboxOutlined,
    LockOutlined,
    GlobalOutlined
} from '@ant-design/icons'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import OptionCards from './OptionCards'
import { getTypeIcon, isSpaceType } from './typeIcons'
import {
    collection,
    getDocs,
    addDoc,
    updateDoc,
    deleteDoc,
    doc
} from 'firebase/firestore'
import { db } from '@/firebase'
import {
    ResourceItem,
    ResourceVisibility,
    isBookableResource
} from '@/types/resources'
import { motion } from 'framer-motion'
import { DashboardFilterBar } from '@/components/dashboards/metrics/Header'
import { MetricTile } from '@/components/dashboards/metrics/MetricTile'
import ResourceTypesModal, {
    ResourceTypeOption,
    DEFAULT_RESOURCE_TYPES,
    getBookingMode
} from './ResourceTypesModal'
import BookingModal, { BookingPrefill } from './BookingModal'
import RequestsView, { REQUEST_FILTER_OPTIONS, RequestStatusFilter } from './RequestsView'
import { DeclineRequestModal, RequestDetailsModal } from './RequestModals'
import {
    SmeResourceRequest,
    fetchSmeRequests,
    markRequestApproved,
    markRequestDeclined,
    requestReason,
    requestStatus
} from '@/lib/resourceRequests'
import BookingDetailsModal from './BookingDetailsModal'
import BookingsView, { BOOKINGS_VIEW_OPTIONS, BookingsViewMode } from './BookingsView'
import ResourceDrawer from './ResourceDrawer'
import {
    BookableUnit,
    ResourceBooking,
    availableNow,
    bookedByName,
    currentBooking,
    fetchBookings,
    toDate
} from '@/lib/resourceBookings'

const { Text } = Typography


const VISIBILITY_OPTIONS = [
    {
        value: 'internal',
        label: 'Internal',
        icon: <LockOutlined />,
        description: 'Branch inventory'
    },
    {
        value: 'external',
        label: 'External',
        icon: <GlobalOutlined />,
        description: 'SMEs can book it'
    }
]

const Resources: React.FC = () => {
    const [resources, setResources] = useState<ResourceItem[]>([])
    const [loading, setLoading] = useState<boolean>(true)
    const [searchText, setSearchText] = useState<string>('')
    const [typeFilter, setTypeFilter] = useState<string | undefined>()
    const [visibilityFilter, setVisibilityFilter] = useState<
        ResourceVisibility | undefined
    >()
    const [modalOpen, setModalOpen] = useState(false)
    const [saving, setSaving] = useState(false)
    const [form] = Form.useForm()
    const selectedType: string | undefined = Form.useWatch('type', form)
    const selectedVisibility: ResourceVisibility | undefined = Form.useWatch(
        'visibility',
        form
    )
    const [editingResource, setEditingResource] = useState<ResourceItem | null>(
        null
    )

    const [resourceTypes, setResourceTypes] = useState<ResourceTypeOption[]>(
        DEFAULT_RESOURCE_TYPES
    )
    const [typesModalOpen, setTypesModalOpen] = useState(false)
    const [view, setView] = useState<'resources' | 'bookings' | 'requests'>('resources')
    const [bookings, setBookings] = useState<ResourceBooking[]>([])
    const [bookingsLoading, setBookingsLoading] = useState(true)
    const [bookingModal, setBookingModal] = useState<{
        open: boolean
        editing?: ResourceBooking | null
        prefill?: BookingPrefill
        // Set when the booking is being made to approve an SME request
        requestId?: string
    }>({ open: false })
    const [drawerResourceId, setDrawerResourceId] = useState<string | null>(null)
    const [viewingBooking, setViewingBooking] = useState<ResourceBooking | null>(null)
    const [requests, setRequests] = useState<SmeResourceRequest[]>([])
    const [requestsLoading, setRequestsLoading] = useState(true)
    const [viewingRequest, setViewingRequest] = useState<SmeResourceRequest | null>(null)
    const [decliningRequest, setDecliningRequest] = useState<SmeResourceRequest | null>(null)
    const [bookingsMode, setBookingsMode] = useState<BookingsViewMode>('list')
    const [requestFilter, setRequestFilter] = useState<RequestStatusFilter>('pending')

    const getTypeMode = (value: string) =>
        getBookingMode(
            resourceTypes.find(type => type.value === value) || { value }
        )

    // Single-mode types (e.g. a vehicle) are one distinct unit per resource,
    // whether it's bookable or just branch inventory.
    const isSingleUnit = (resource: Pick<ResourceItem, 'type'>) =>
        getTypeMode(resource.type) === 'single'

    const selectedIsSingle = !!selectedType && isSingleUnit({ type: selectedType })
    // Bookable spaces hold people at once; everything else is a count of units
    const capacityLabel =
        selectedVisibility === 'internal' ||
            (selectedType && !isSpaceType(selectedType))
            ? 'Quantity'
            : 'Capacity'

    const { user } = useFullIdentity()
    const { token } = theme.useToken()
    const screens = Grid.useBreakpoint()
    // Below sm the card actions drop to a full-width row of labelled buttons
    const isDesktop = screens.sm !== false
    // Below md, modals become bottom sheets (index.css), so the drawer and the
    // filter bar switch to their mobile layout at the same width
    const isMobile = screens.md === false
    // Filter bar columns share rows on wider screens; on mobile each control gets its own full row
    const barCol = (flex: string, mobileSpan = 24) =>
        isMobile ? { span: mobileSpan } : { flex }

    const resourceStatuses = [
        {
            value: 'available',
            label: 'Available',
            color: 'green',
            icon: <CheckCircleOutlined />
        },
        {
            value: 'maintenance',
            label: 'Maintenance',
            color: 'orange',
            icon: <ToolOutlined />
        },
        {
            value: 'unavailable',
            label: 'Unavailable',
            color: 'red',
            icon: <StopOutlined />
        }
    ]

    useEffect(() => {
        fetchResources()
        fetchResourceTypes()
        loadBookings()
        loadRequests()
    }, [])

    const loadRequests = async () => {
        setRequestsLoading(true)
        try {
            setRequests(await fetchSmeRequests())
        } catch (error) {
            console.error('Failed to load requests:', error)
            message.error('Failed to fetch requests')
        } finally {
            setRequestsLoading(false)
        }
    }

    // Approving opens the booking form filled from the request, so the same
    // availability check runs; the request is only marked approved once the
    // booking saves
    const approveRequest = (request: SmeResourceRequest) => {
        setViewingRequest(null)
        const start = request.startTime ? toDate(request.startTime) : undefined
        const end = request.endTime ? toDate(request.endTime) : undefined
        openBooking({
            requestId: request.id,
            prefill: {
                fromRequest: true,
                resourceId: request.resourceId,
                range: start && end ? [start, end] : undefined,
                applicationId: request.applicationId,
                participantId: request.participantId,
                smeName: request.requestedBy,
                smeEmail: request.requestedByEmail,
                quantity: request.quantity,
                purpose: requestReason(request)
            }
        })
    }

    const handleBookingSaved = async (bookingId: string) => {
        loadBookings()
        const { requestId } = bookingModal
        if (!requestId) return
        try {
            await markRequestApproved(requestId, bookingId)
            message.success('Request approved')
        } catch (error) {
            console.error('Failed to mark request approved:', error)
            message.error('Booking saved, but the request could not be marked approved')
        }
        loadRequests()
    }

    const handleDeclineRequest = async (request: SmeResourceRequest, reason: string) => {
        try {
            await markRequestDeclined(request.id, reason)
            message.success('Request declined')
            setDecliningRequest(null)
            loadRequests()
        } catch (error) {
            console.error('Failed to decline request:', error)
            message.error('Failed to decline request')
        }
    }

    const loadBookings = async () => {
        setBookingsLoading(true)
        try {
            setBookings(await fetchBookings())
        } catch (error) {
            console.error('Failed to load bookings:', error)
            message.error('Failed to fetch bookings')
        } finally {
            setBookingsLoading(false)
        }
    }

    const toUnit = (resource: ResourceItem): BookableUnit => ({
        id: resource.id,
        name: resource.name,
        capacity: Number(resource.capacity) || 0,
        single: isSingleUnit(resource)
    })

    const handleDeleteBooking = async (booking: ResourceBooking) => {
        try {
            await deleteDoc(doc(db, 'resourceAllocations', booking.id))
            message.success('Booking deleted')
            loadBookings()
        } catch (error) {
            console.error('Delete failed:', error)
            message.error('Delete failed')
        }
    }

    const openBooking = (options: {
        editing?: ResourceBooking
        prefill?: BookingPrefill
        requestId?: string
    } = {}) => setBookingModal({ open: true, ...options })

    const fetchResourceTypes = async () => {
        try {
            const snapshot = await getDocs(collection(db, 'resourceTypes'))
            const data = snapshot.docs
                .map(d => ({ id: d.id, ...d.data() } as ResourceTypeOption))
                .sort((a, b) => a.label.localeCompare(b.label))
            setResourceTypes(data.length ? data : DEFAULT_RESOURCE_TYPES)
        } catch (error) {
            console.error('Failed to load resource types:', error)
        }
    }

    const typeUsage = resources.reduce<Record<string, number>>((acc, r) => {
        acc[r.type] = (acc[r.type] || 0) + 1
        return acc
    }, {})

    const getTypeLabel = (value: string) =>
        resourceTypes.find(type => type.value === value)?.label || value

    const fetchResources = async () => {
        setLoading(true)
        try {
            const snapshot = await getDocs(collection(db, 'resources'))
            const data = snapshot.docs.map(
                doc => ({ id: doc.id, ...doc.data() } as ResourceItem)
            )
            setResources(data)
        } catch (error) {
            console.error('Failed to load resources:', error)
            message.error('Failed to fetch resources')
        } finally {
            setLoading(false)
        }
    }

    const handleSearch = (value: string) => {
        setSearchText(value)
    }

    const getFilteredResources = () => {
        const query = searchText.toLowerCase()
        return resources.filter(
            resource =>
                (!typeFilter || resource.type === typeFilter) &&
                // Resources saved before visibility existed count as external
                (!visibilityFilter ||
                    (resource.visibility || 'external') === visibilityFilter) &&
                (!query ||
                    resource.name.toLowerCase().includes(query) ||
                    (resource.description || '').toLowerCase().includes(query) ||
                    getTypeLabel(resource.type).toLowerCase().includes(query))
        )
    }

    const showResourceModal = (record?: ResourceItem) => {
        setEditingResource(record || null)
        form.resetFields()
        form.setFieldsValue(
            record
                ? { ...record, visibility: record.visibility || 'external' }
                : { visibility: 'external' }
        )
        setModalOpen(true)
    }

    const handleDeleteResource = async (record: ResourceItem) => {
        try {
            await deleteDoc(doc(db, 'resources', record.id))
            message.success('Resource deleted')
            fetchResources()
        } catch (error) {
            console.error('Delete failed:', error)
            message.error('Delete failed')
        }
    }

    const handleModalSubmit = async () => {
        let values
        try {
            values = await form.validateFields()
        } catch {
            return
        }
        // Firestore rejects undefined, so optional fields are normalised and
        // single-booking resources (no capacity field shown) are always one unit.
        const capacity = isSingleUnit(values) ? 1 : Number(values.capacity)
        const payload = {
            name: values.name.trim(),
            visibility: values.visibility as ResourceVisibility,
            type: values.type,
            status: values.status,
            capacity,
            // Only single units record a size; null clears it if the type changed
            seats: isSingleUnit(values) && values.seats ? Number(values.seats) : null,
            description: values.description?.trim() || ''
        }
        setSaving(true)
        try {
            if (editingResource) {
                // Shift availability by the capacity change so units already
                // allocated stay accounted for.
                const capacityDelta = capacity - editingResource.capacity
                await updateDoc(doc(db, 'resources', editingResource.id), {
                    ...payload,
                    available: Math.min(
                        capacity,
                        Math.max(0, editingResource.available + capacityDelta)
                    )
                })
                message.success('Resource updated')
            } else {
                await addDoc(collection(db, 'resources'), {
                    ...payload,
                    available: capacity,
                    branchId: user?.assignedBranch || null
                })
                message.success('Resource created')
            }
            setModalOpen(false)
            fetchResources()
        } catch (err) {
            console.error('Failed to save resource:', err)
            message.error('Failed to save resource')
        } finally {
            setSaving(false)
        }
    }

    // Capacity and utilisation only make sense for what SMEs can book, and
    // are measured right now from the bookings covering this moment
    const bookableResources = resources.filter(isBookableResource)
    const availableNowById = new Map(
        bookableResources.map(r => [r.id, availableNow(toUnit(r), bookings)])
    )
    const unitCapacity = (r: ResourceItem) => (isSingleUnit(r) ? 1 : r.capacity)
    const getTotalCapacity = () =>
        bookableResources.reduce((acc, r) => acc + unitCapacity(r), 0)
    const getTotalAvailable = () =>
        bookableResources.reduce((acc, r) => acc + (availableNowById.get(r.id) ?? 0), 0)
    const getUtilizationRate = () => {
        const total = getTotalCapacity()
        const used = total - getTotalAvailable()
        return total > 0 ? Math.round((used / total) * 100) : 0
    }

    const resourcesById = useMemo(
        () => new Map(resources.map(r => [r.id, r])),
        [resources]
    )

    // Timeline rows: bookable resources under the type filter, and for a search,
    // those whose name matches or that have a matching booking
    const getTimelineResources = () => {
        const query = searchText.toLowerCase()
        const matchingIds = new Set(getFilteredBookings().map(b => b.resourceId))
        return bookableResources.filter(
            r =>
                (!typeFilter || r.type === typeFilter) &&
                (!query || r.name.toLowerCase().includes(query) || matchingIds.has(r.id))
        )
    }

    const getFilteredBookings = () => {
        const query = searchText.toLowerCase()
        return bookings.filter(booking => {
            const resource = resourcesById.get(booking.resourceId)
            return (
                (!typeFilter || resource?.type === typeFilter) &&
                (!query ||
                    bookedByName(booking).toLowerCase().includes(query) ||
                    (booking.purpose || '').toLowerCase().includes(query) ||
                    (resource?.name || '').toLowerCase().includes(query))
            )
        })
    }

    // Looked up by id so the drawer reflects edits after a refetch
    const pendingRequestCount = requests.filter(r => requestStatus(r) === 'pending').length

    const getFilteredRequests = () => {
        const query = searchText.toLowerCase()
        return requests.filter(request => {
            const resource = resourcesById.get(request.resourceId)
            return (
                (!typeFilter || resource?.type === typeFilter) &&
                (!query ||
                    (resource?.name || request.resourceName || '')
                        .toLowerCase()
                        .includes(query) ||
                    (request.requestedBy || '').toLowerCase().includes(query) ||
                    requestReason(request).toLowerCase().includes(query))
            )
        })
    }

    const viewingRequestResource = viewingRequest
        ? resourcesById.get(viewingRequest.resourceId)
        : undefined

    const viewingResource = viewingBooking
        ? resourcesById.get(viewingBooking.resourceId)
        : undefined

    const drawerResource = drawerResourceId
        ? resourcesById.get(drawerResourceId) || null
        : null

    const renderStatusTag = (record: ResourceItem) => {
        const statusInfo = resourceStatuses.find(s => s.value === record.status)
        return (
            <Tag icon={statusInfo?.icon} color={statusInfo?.color || 'default'}>
                {statusInfo?.label || record.status}
            </Tag>
        )
    }

    const renderAvailability = (record: ResourceItem) => {
        if (!isBookableResource(record)) {
            // Inventory isn't booked, so there's no availability to chart
            return (
                <Tooltip title={`${record.capacity} in inventory`}>
                    <div
                        style={{
                            width: 56,
                            height: 56,
                            borderRadius: '50%',
                            border: `6px solid ${token.colorFillSecondary}`,
                            display: 'grid',
                            placeItems: 'center',
                            fontSize: 13,
                            fontWeight: 600,
                            boxSizing: 'border-box'
                        }}
                    >
                        {record.capacity}
                    </div>
                </Tooltip>
            )
        }
        const available = availableNowById.get(record.id) ?? 0
        if (isSingleUnit(record)) {
            const holder = currentBooking(record.id, bookings)
            return (
                <Tooltip
                    title={
                        holder
                            ? `Booked by ${bookedByName(holder)} until ${toDate(
                                holder.endTime
                            ).toLocaleString()}`
                            : 'Free right now'
                    }
                >
                    <Progress
                        type='circle'
                        size={56}
                        percent={100}
                        strokeColor={holder ? token.colorPrimary : token.colorSuccess}
                        format={() => (
                            <span style={{ fontSize: 11 }}>
                                {holder ? 'Booked' : 'Free'}
                            </span>
                        )}
                    />
                </Tooltip>
            )
        }
        const ratio = record.capacity > 0 ? available / record.capacity : 0
        return (
            <Tooltip title={`${available} of ${record.capacity} available right now`}>
                <Progress
                    type='circle'
                    size={56}
                    percent={Math.round(ratio * 100)}
                    status={ratio < 0.2 ? 'exception' : 'normal'}
                    format={() => (
                        <span style={{ fontSize: 11 }}>
                            {available}/{record.capacity}
                        </span>
                    )}
                />
            </Tooltip>
        )
    }

    const renderResourceCard = (record: ResourceItem) => {
        const isSingle = isSingleUnit(record)
        const isInternal = !isBookableResource(record)
        const deleteConfirm = (button: React.ReactNode) => (
            <Popconfirm
                title={`Delete "${record.name}"?`}
                okText='Delete'
                okButtonProps={{ danger: true }}
                onConfirm={() => handleDeleteResource(record)}
            >
                {button}
            </Popconfirm>
        )

        return (
            <Card
                size='small'
                hoverable
                style={{ width: '100%', borderRadius: 12 }}
                onClick={() => setDrawerResourceId(record.id)}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <div style={{ flexShrink: 0 }}>{renderAvailability(record)}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <Space size={8} wrap>
                            <Text strong>{record.name}</Text>
                            {renderStatusTag(record)}
                            {isInternal ? (
                                <Tag icon={<LockOutlined />}>Internal</Tag>
                            ) : (
                                <Tag icon={<GlobalOutlined />} color='blue'>
                                    External
                                </Tag>
                            )}
                        </Space>
                        <div>
                            <Text type='secondary' style={{ fontSize: 12 }}>
                                <span style={{ marginRight: 6 }}>
                                    {getTypeIcon(record.type)}
                                </span>
                                {getTypeLabel(record.type)}
                                {!isSingle &&
                                    ` · ${record.capacity} ${!isInternal && isSpaceType(record.type)
                                        ? 'capacity'
                                        : 'units'
                                    }`}
                                {isSingle && !!record.seats && ` · ${record.seats} seats`}
                            </Text>
                        </div>
                        {record.description && (
                            <Text
                                type='secondary'
                                style={{ fontSize: 12, display: 'block' }}
                                ellipsis={{ tooltip: record.description }}
                            >
                                {record.description}
                            </Text>
                        )}
                    </div>
                    {isDesktop && (
                        <Space
                            size='small'
                            style={{ flexShrink: 0 }}
                            // Actions (and their portal popups) mustn't open the drawer
                            onClick={e => e.stopPropagation()}
                        >
                            <Tooltip title='Edit resource'>
                                <Button
                                    shape='circle'
                                    icon={<EditOutlined />}
                                    onClick={() => showResourceModal(record)}
                                />
                            </Tooltip>
                            {deleteConfirm(
                                <Tooltip title='Delete resource'>
                                    <Button shape='circle' danger icon={<DeleteOutlined />} />
                                </Tooltip>
                            )}
                        </Space>
                    )}
                </div>
                {!isDesktop && (
                    <Row
                        gutter={8}
                        style={{ marginTop: 12 }}
                        onClick={e => e.stopPropagation()}
                    >
                        <Col span={12}>
                            <Button
                                block
                                icon={<EditOutlined />}
                                onClick={() => showResourceModal(record)}
                            >
                                Edit
                            </Button>
                        </Col>
                        <Col span={12}>
                            {deleteConfirm(
                                <Button block danger icon={<DeleteOutlined />}>
                                    Delete
                                </Button>
                            )}
                        </Col>
                    </Row>
                )}
            </Card>
        )
    }

    return (
        <div style={{ minHeight: '100vh', padding: 24 }}>
            <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
                <Col xs={12} md={8}>
                    <MetricTile
                        icon={<DashboardOutlined />}
                        tone='accent'
                        title='Total Resources'
                        value={resources.length}
                        loading={loading}
                    />
                </Col>
                {/* Two metrics fit side by side on mobile; capacity is the one left out */}
                <Col xs={0} md={8}>
                    <MetricTile
                        icon={<TeamOutlined />}
                        tone='success'
                        title='Bookable Capacity'
                        value={getTotalCapacity()}
                        loading={loading}
                    />
                </Col>
                <Col xs={12} md={8}>
                    <MetricTile
                        icon={<PieChartOutlined />}
                        tone='warning'
                        title='Utilization Rate'
                        value={`${getUtilizationRate()}%`}
                        loading={loading}
                    />
                </Col>
            </Row>

            <DashboardFilterBar>
                <Row gutter={[12, 12]} align='middle'>
                    <Col {...barCol('2 1 220px')}>
                        <Input
                            placeholder='Search resources...'
                            prefix={<SearchOutlined />}
                            allowClear
                            value={searchText}
                            onChange={e => handleSearch(e.target.value)}
                            style={{ width: '100%' }}
                        />
                    </Col>
                    <Col {...barCol('1 1 180px')}>
                        <Select
                            placeholder='All types'
                            allowClear
                            value={typeFilter}
                            onChange={setTypeFilter}
                            options={resourceTypes.map(({ value, label }) => ({
                                value,
                                label
                            }))}
                            style={{ width: '100%' }}
                        />
                    </Col>
                    {/* Bookings are only ever for external resources */}
                    {view === 'resources' && (
                        <Col {...barCol('1 1 180px')}>
                            <Select
                                placeholder='All visibility'
                                allowClear
                                value={visibilityFilter}
                                onChange={setVisibilityFilter}
                                options={VISIBILITY_OPTIONS.map(({ value, label }) => ({
                                    value,
                                    label
                                }))}
                                style={{ width: '100%' }}
                            />
                        </Col>
                    )}
                    {/* Wide enough for all three labels and the pending badge */}
                    <Col {...barCol('1 1 360px')}>
                        <Segmented
                            block
                            value={view}
                            onChange={value => setView(value as typeof view)}
                            options={[
                                {
                                    value: 'resources',
                                    label: 'Resources',
                                    icon: <AppstoreOutlined />
                                },
                                {
                                    value: 'bookings',
                                    label: 'Bookings',
                                    icon: <CalendarOutlined />
                                },
                                {
                                    value: 'requests',
                                    label: (
                                        <Space size={6}>
                                            Requests
                                            {pendingRequestCount > 0 && (
                                                <Badge
                                                    count={pendingRequestCount}
                                                    size='small'
                                                />
                                            )}
                                        </Space>
                                    ),
                                    icon: <InboxOutlined />
                                }
                            ]}
                        />
                    </Col>
                    {/* Each view's own control sits here: types for resources,
                        the layout for bookings, the status for requests */}
                    {view === 'resources' && (
                        <Col {...barCol('1 1 160px', 12)}>
                            <Button
                                block
                                icon={<AppstoreOutlined />}
                                onClick={() => setTypesModalOpen(true)}
                            >
                                Manage Types
                            </Button>
                        </Col>
                    )}
                    {view === 'bookings' && (
                        <Col {...barCol('2 1 300px')}>
                            <Segmented
                                block
                                value={bookingsMode}
                                onChange={value => setBookingsMode(value as BookingsViewMode)}
                                options={BOOKINGS_VIEW_OPTIONS}
                            />
                        </Col>
                    )}
                    {view === 'requests' && (
                        <Col {...barCol('2 1 360px')}>
                            <Segmented
                                block
                                value={requestFilter}
                                onChange={value => setRequestFilter(value as RequestStatusFilter)}
                                options={REQUEST_FILTER_OPTIONS}
                            />
                        </Col>
                    )}
                    {/* Requests are acted on from their cards, so there's no add button */}
                    {view !== 'requests' && (
                        // Kept compact on Bookings so the layout switch has room for its labels
                        <Col
                            {...barCol(
                                view === 'bookings' ? '0 1 140px' : '1 1 160px',
                                // Shares a mobile row with Manage Types on the resources view
                                view === 'resources' ? 12 : 24
                            )}
                        >
                            {view === 'resources' ? (
                                <Button
                                    block
                                    type='primary'
                                    icon={<PlusOutlined />}
                                    onClick={() => showResourceModal()}
                                >
                                    Add Resource
                                </Button>
                            ) : (
                                <Button
                                    block
                                    type='primary'
                                    icon={<PlusOutlined />}
                                    onClick={() => openBooking()}
                                >
                                    Booking
                                </Button>
                            )}
                        </Col>
                    )}
                </Row>
            </DashboardFilterBar>

            {view === 'bookings' && (
                <BookingsView
                    bookings={getFilteredBookings()}
                    resourcesById={resourcesById}
                    loading={bookingsLoading}
                    isDesktop={isDesktop}
                    hasFilters={!!(searchText || typeFilter)}
                    isSingle={isSingleUnit}
                    getTypeIcon={getTypeIcon}
                    getTypeLabel={getTypeLabel}
                    onAdd={() => openBooking()}
                    hasBookableResources={bookableResources.length > 0}
                    timelineResources={getTimelineResources()}
                    allBookings={bookings}
                    onBookSlot={(resourceId, day) =>
                        openBooking({
                            prefill: {
                                resourceId,
                                // A working day by default; staff adjust it in the form
                                range: [day.hour(9).toDate(), day.hour(17).toDate()]
                            }
                        })
                    }
                    onAddResource={() => showResourceModal()}
                    onView={booking => setViewingBooking(booking)}
                    onEdit={booking => openBooking({ editing: booking })}
                    onDelete={handleDeleteBooking}
                    mode={bookingsMode}
                    onClearFilters={() => {
                        setSearchText('')
                        setTypeFilter(undefined)
                    }}
                />
            )}

            {view === 'requests' && (
                <RequestsView
                    requests={getFilteredRequests()}
                    resourcesById={resourcesById}
                    loading={requestsLoading}
                    isDesktop={isDesktop}
                    hasFilters={!!(searchText || typeFilter)}
                    isSingle={isSingleUnit}
                    getTypeIcon={getTypeIcon}
                    onView={request => setViewingRequest(request)}
                    onApprove={approveRequest}
                    onDecline={request => setDecliningRequest(request)}
                    filter={requestFilter}
                    onClearFilters={() => {
                        setSearchText('')
                        setTypeFilter(undefined)
                    }}
                />
            )}

            {view === 'resources' && (
            <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
            >
                <List
                    dataSource={getFilteredResources()}
                    rowKey='id'
                    loading={loading}
                    split={false}
                    pagination={{ pageSize: 10, hideOnSinglePage: true }}
                    locale={{
                        emptyText:
                            searchText || typeFilter || visibilityFilter ? (
                                <Result
                                    icon={<SearchOutlined />}
                                    title='No resources found'
                                    subTitle='Nothing matches your search or filters.'
                                    extra={
                                        <Button
                                            onClick={() => {
                                                setSearchText('')
                                                setTypeFilter(undefined)
                                                setVisibilityFilter(undefined)
                                            }}
                                        >
                                            Clear filters
                                        </Button>
                                    }
                                />
                            ) : (
                                <Result
                                    icon={<AppstoreOutlined />}
                                    title='No resources yet'
                                    subTitle='Add your first resource to start tracking inventory and bookings.'
                                    extra={
                                        <Button
                                            type='primary'
                                            icon={<PlusOutlined />}
                                            onClick={() => showResourceModal()}
                                        >
                                            Add Resource
                                        </Button>
                                    }
                                />
                            )
                    }}
                    renderItem={record => (
                        <List.Item style={{ padding: '6px 0' }}>
                            {renderResourceCard(record)}
                        </List.Item>
                    )}
                />
            </motion.div>
            )}

            <Modal
                title={editingResource ? 'Edit Resource' : 'Add Resource'}
                open={modalOpen}
                onCancel={() => setModalOpen(false)}
                footer={
                    <Button
                        type='primary'
                        block
                        loading={saving}
                        onClick={handleModalSubmit}
                    >
                        {editingResource ? 'Update Resource' : 'Save Resource'}
                    </Button>
                }
                destroyOnClose
            >
                <Form form={form} layout='vertical'>
                    <Form.Item
                        name='visibility'
                        label='Visibility'
                        rules={[{ required: true }]}
                    >
                        <OptionCards
                            indicator
                            options={VISIBILITY_OPTIONS}
                        />
                    </Form.Item>
                    <Form.Item name='type' label='Type' rules={[{ required: true }]}>
                        <OptionCards
                            placeholder='Select type'
                            options={resourceTypes.map(({ value, label }) => ({
                                value,
                                label,
                                icon: getTypeIcon(value)
                            }))}
                        />
                    </Form.Item>
                    <Row gutter={12}>
                        <Col xs={24} sm={16}>
                            <Form.Item
                                name='name'
                                label='Resource Name'
                                rules={[{ required: true }]}
                            >
                                <Input />
                            </Form.Item>
                        </Col>
                        <Col xs={24} sm={8}>
                            {selectedIsSingle ? (
                                // A single unit isn't counted, but its size
                                // (seats in a vehicle or boardroom) still matters
                                <Form.Item name='seats' label='Seats'>
                                    <InputNumber
                                        min={1}
                                        placeholder='Optional'
                                        style={{ width: '100%' }}
                                    />
                                </Form.Item>
                            ) : (
                                <Form.Item
                                    name='capacity'
                                    label={capacityLabel}
                                    rules={[{ required: true }]}
                                >
                                    <InputNumber min={1} style={{ width: '100%' }} />
                                </Form.Item>
                            )}
                        </Col>
                    </Row>
                    <Form.Item name='status' label='Status' rules={[{ required: true }]}>
                        <OptionCards
                            placeholder='Select status'
                            options={resourceStatuses}
                        />
                    </Form.Item>
                    <Form.Item name='description' label='Description'>
                        <Input.TextArea rows={3} />
                    </Form.Item>
                </Form>
            </Modal>

            <ResourceDrawer
                resource={drawerResource}
                bookings={bookings}
                isMobile={isMobile}
                isSingle={!!drawerResource && isSingleUnit(drawerResource)}
                typeLabel={drawerResource ? getTypeLabel(drawerResource.type) : ''}
                statusTag={drawerResource && renderStatusTag(drawerResource)}
                availability={drawerResource && renderAvailability(drawerResource)}
                onClose={() => setDrawerResourceId(null)}
                onEdit={() => drawerResource && showResourceModal(drawerResource)}
                onBook={() =>
                    drawerResource &&
                    openBooking({ prefill: { resourceId: drawerResource.id } })
                }
                onEditBooking={booking => setViewingBooking(booking)}
            />

            <RequestDetailsModal
                request={viewingRequest}
                resource={viewingRequestResource}
                isSingle={!!viewingRequestResource && isSingleUnit(viewingRequestResource)}
                typeLabel={
                    viewingRequestResource ? getTypeLabel(viewingRequestResource.type) : ''
                }
                typeIcon={
                    viewingRequestResource ? getTypeIcon(viewingRequestResource.type) : null
                }
                onClose={() => setViewingRequest(null)}
                onApprove={approveRequest}
                onDecline={request => {
                    setViewingRequest(null)
                    setDecliningRequest(request)
                }}
            />

            <DeclineRequestModal
                request={decliningRequest}
                onClose={() => setDecliningRequest(null)}
                onConfirm={handleDeclineRequest}
            />

            <BookingDetailsModal
                booking={viewingBooking}
                resource={viewingResource}
                isSingle={!!viewingResource && isSingleUnit(viewingResource)}
                typeLabel={viewingResource ? getTypeLabel(viewingResource.type) : ''}
                typeIcon={viewingResource ? getTypeIcon(viewingResource.type) : <CalendarOutlined />}
                onClose={() => setViewingBooking(null)}
                onEdit={booking => {
                    setViewingBooking(null)
                    openBooking({ editing: booking })
                }}
                onDelete={booking => {
                    setViewingBooking(null)
                    handleDeleteBooking(booking)
                }}
            />

            <BookingModal
                open={bookingModal.open}
                onClose={() => setBookingModal({ open: false })}
                resources={bookableResources}
                toUnit={toUnit}
                bookings={bookings}
                editing={bookingModal.editing}
                prefill={bookingModal.prefill}
                onSaved={handleBookingSaved}
                onAddResource={() => showResourceModal()}
            />

            <ResourceTypesModal
                open={typesModalOpen}
                onClose={() => setTypesModalOpen(false)}
                types={resourceTypes}
                usage={typeUsage}
                onChanged={() => {
                    fetchResourceTypes()
                    // Switching a type to single booking rewrites its resources' quantities
                    fetchResources()
                }}
            />
        </div>
    )
}

export default Resources
