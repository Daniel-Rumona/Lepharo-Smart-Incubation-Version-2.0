import React, { useEffect, useMemo, useState, useCallback } from 'react'
import {
    Layout,
    Row,
    Col,
    Card,
    Statistic,
    Space,
    Typography,
    Button,
    DatePicker,
    Select,
    Input,
    Table,
    Tag,
    Modal,
    Form,
    Upload,
    message,
    Drawer,
    Descriptions,
    Empty,
    Divider,
    Image,
    Tooltip,
    Alert,
    Checkbox
} from 'antd'
import {
    PlusOutlined,
    UploadOutlined,
    EyeOutlined,
    DeleteOutlined,
    TeamOutlined,
    UserOutlined,
    UsergroupAddOutlined,
    PictureOutlined,
    CalendarOutlined,
    ImportOutlined
} from '@ant-design/icons'
import { } from '@ant-design/icons'
import { db, storage, auth } from '@/firebase'
import {
    addDoc,
    collection,
    doc,
    getDocs,
    onSnapshot,
    orderBy,
    query,
    serverTimestamp,
    Timestamp,
    where,
    updateDoc,
    deleteDoc
} from 'firebase/firestore'
import {
    ref,
    uploadBytes,
    getDownloadURL,
    deleteObject
} from 'firebase/storage'
import dayjs, { Dayjs } from 'dayjs'
import { useFullIdentity } from '@/hooks/src/useFullIdentity'
import {
    DashboardHeaderCard,
    MotionCard
} from '@/components/dashboards/metrics/Header'

const { Title, Text } = Typography
const { RangePicker } = DatePicker
const { Option } = Select
const { TextArea } = Input
const { Dragger } = Upload

type StakeholderType =
    | 'Funder'
    | 'Government'
    | 'Corporate'
    | 'SMME'
    | 'Community'
    | 'Other'
type EngagementMode = 'Online' | 'In-person' | 'Hybrid'

interface Engagement {
    id: string

    title: string
    stakeholder: string
    stakeholderType: StakeholderType
    date: Timestamp
    mode: EngagementMode
    location?: string
    attendees: string[]
    images: string[]
    meetingLink?: string
    notes?: string
    aiSource?: string // e.g. 'Otter', 'GoogleMeet', 'Teams', 'Generic'
    createdByUid: string
    createdByName?: string
    createdAt: Timestamp
    updatedAt?: Timestamp
}

const STAKEHOLDER_TYPES: StakeholderType[] = [
    'Funder',
    'Government',
    'Corporate',
    'SMME',
    'Community',
    'Other'
]
const MODES: EngagementMode[] = ['Online', 'In-person', 'Hybrid']

export const StakeholderEngagementPage: React.FC = () => {
    const { user, loading: identityLoading } = useFullIdentity()

    // Data state
    const [engagements, setEngagements] = useState<Engagement[]>([])
    const [loading, setLoading] = useState<boolean>(true)

    // Filters
    const [search, setSearch] = useState('')
    const [typeFilter, setTypeFilter] = useState<StakeholderType | 'All'>('All')
    const [modeFilter, setModeFilter] = useState<EngagementMode | 'All'>('All')
    const [dateRange, setDateRange] = useState<[Dayjs | null, Dayjs | null]>([
        null,
        null
    ])

    // Create/edit modal
    const [form] = Form.useForm()
    const [createOpen, setCreateOpen] = useState(false)
    const [uploadFileList, setUploadFileList] = useState<any[]>([])
    const [saving, setSaving] = useState(false)
    const [includeAiImportedNotes, setIncludeAiImportedNotes] =
        useState<boolean>(true)

    // Detail drawer
    const [drawerOpen, setDrawerOpen] = useState(false)
    const [selected, setSelected] = useState<Engagement | null>(null)
    const [deleteLoading, setDeleteLoading] = useState(false)

    // AI Import modal
    const [aiOpen, setAiOpen] = useState(false)
    const [aiRaw, setAiRaw] = useState<string>('')
    const [aiParsing, setAiParsing] = useState(false)

    // Calendar modal (simple monthly list view)
    const [calendarOpen, setCalendarOpen] = useState(false)

    useEffect(() => {
        setLoading(true)
        const qy = query(
            collection(db, 'stakeholderEngagements'),
            orderBy('date', 'desc')
        )
        const unsub = onSnapshot(
            qy,
            snap => {
                const rows: Engagement[] = snap.docs.map(d => {
                    const data = d.data() as Omit<Engagement, 'id'>
                    return { id: d.id, ...data } as Engagement
                })
                setEngagements(rows)
                setLoading(false)
            },
            err => {
                console.error(err)
                message.error('Failed to load stakeholder engagements.')
                setLoading(false)
            }
        )
        return () => unsub()
    }, [])

    const filtered = useMemo(() => {
        const term = search.trim().toLowerCase()
        return engagements.filter(e => {
            const matchText =
                !term ||
                e.title.toLowerCase().includes(term) ||
                e.stakeholder.toLowerCase().includes(term) ||
                (e.notes || '').toLowerCase().includes(term) ||
                e.attendees.join(' ').toLowerCase().includes(term)

            const matchType = typeFilter === 'All' || e.stakeholderType === typeFilter
            const matchMode = modeFilter === 'All' || e.mode === modeFilter

            const inRange =
                (!dateRange[0] && !dateRange[1]) ||
                (!!e.date &&
                    (!!dateRange[0]
                        ? e.date.toDate() >= dateRange[0]!.startOf('day').toDate()
                        : true) &&
                    (!!dateRange[1]
                        ? e.date.toDate() <= dateRange[1]!.endOf('day').toDate()
                        : true))

            return matchText && matchType && matchMode && inRange
        })
    }, [engagements, search, typeFilter, modeFilter, dateRange])

    // Metrics
    const metrics = useMemo(() => {
        const uniqueStakeholders = new Set(filtered.map(f => f.stakeholder)).size
        const totalImages = filtered.reduce(
            (acc, f) => acc + (f.images?.length || 0),
            0
        )
        const totalAttendees = filtered.reduce(
            (acc, f) => acc + (f.attendees?.length || 0),
            0
        )
        return {
            totalEngagements: filtered.length,
            uniqueStakeholders,
            totalImages,
            totalAttendees
        }
    }, [filtered])

    // Upload handlers
    const uploadProps = {
        multiple: true,
        beforeUpload: (file: File) => {
            setUploadFileList(prev => [...prev, file])
            return false // prevent auto upload; we upload on submit
        },
        onRemove: (file: any) => {
            setUploadFileList(prev => prev.filter(f => f !== file))
        },
        fileList: uploadFileList as any[]
    }

    const resetCreateState = () => {
        form.resetFields()
        setUploadFileList([])
        setAiRaw('')
        setIncludeAiImportedNotes(true)
    }

    const handleCreate = async (values: any) => {
        try {
            if (!auth.currentUser) {
                message.error('You must be logged in.')
                return
            }

            setSaving(true)

            // 1) Create shell doc
            const mode = values.mode as 'Online' | 'In-person' | 'Hybrid'

            // normalize times
            let startAt: Timestamp | null = null
            let endAt: Timestamp | null = null
            let onlineStartAt: Timestamp | null = null
            let onlineEndAt: Timestamp | null = null
            let inPersonStartAt: Timestamp | null = null
            let inPersonEndAt: Timestamp | null = null

            if (mode === 'Online' || mode === 'In-person') {
                const [s, e] = values.timeRange || []
                startAt = s ? Timestamp.fromDate(s.toDate()) : null
                endAt = e ? Timestamp.fromDate(e.toDate()) : null
            } else if (mode === 'Hybrid') {
                const [os, oe] = values.onlineTimeRange || []
                const [is, ie] = values.inPersonTimeRange || []
                onlineStartAt = os ? Timestamp.fromDate(os.toDate()) : null
                onlineEndAt = oe ? Timestamp.fromDate(oe.toDate()) : null
                inPersonStartAt = is ? Timestamp.fromDate(is.toDate()) : null
                inPersonEndAt = ie ? Timestamp.fromDate(ie.toDate()) : null
            }

            const payload = {
                title: values.title,
                stakeholder: values.stakeholder,
                stakeholderType: values.stakeholderType,
                date: Timestamp.fromDate(values.date.toDate()), // anchor date
                mode,
                // show/hide-driven fields:
                meetingLink:
                    mode === 'Online' || mode === 'Hybrid' ? values.meetingLink : null,
                location:
                    mode === 'In-person' || mode === 'Hybrid' ? values.location : null,
                // times:
                startAt,
                endAt,
                onlineStartAt,
                onlineEndAt,
                inPersonStartAt,
                inPersonEndAt,
                attendees: (values.attendees || []).filter((s: string) => !!s.trim()),
                notes: values.notes || null,
                aiSource: values.aiSource || null,
                createdByUid: auth.currentUser!.uid,
                createdByName: user?.name || user?.email || 'User',
                images: [], // will update after upload
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp()
            }
            const docRef = await addDoc(
                collection(db, 'stakeholderEngagements'),
                payload
            )

            // 2) Upload images (if any)
            let imageUrls: string[] = []
            if (uploadFileList.length > 0) {
                const uploads = uploadFileList.map(async (file: File, idx: number) => {
                    const storageRef = ref(
                        storage,
                        `stakeholder-engagements/${docRef.id}/${Date.now()}_${idx}_${file.name
                        }`
                    )
                    const snap = await uploadBytes(storageRef, file)
                    return getDownloadURL(snap.ref)
                })
                imageUrls = await Promise.all(uploads)
            }

            // 3) Update doc with images
            if (imageUrls.length > 0) {
                await updateDoc(doc(db, 'stakeholderEngagements', docRef.id), {
                    images: imageUrls,
                    updatedAt: serverTimestamp()
                })
            } else {
                await updateDoc(doc(db, 'stakeholderEngagements', docRef.id), {
                    images: [],
                    updatedAt: serverTimestamp()
                })
            }

            message.success('Engagement saved.')
            setCreateOpen(false)
            resetCreateState()
        } catch (err) {
            console.error(err)
            message.error('Failed to save engagement.')
        } finally {
            setSaving(false)
        }
    }

    const openDetail = (record: Engagement) => {
        setSelected(record)
        setDrawerOpen(true)
    }

    const handleDelete = async (row: Engagement) => {
        try {
            setDeleteLoading(true)
            // delete storage images first
            if (row.images && row.images.length) {
                await Promise.all(
                    row.images.map(async url => {
                        try {
                            const pathStart = url.indexOf('/o/') + 3
                            const pathEncoded = url.substring(
                                pathStart,
                                url.indexOf('?', pathStart)
                            )
                            const pathDecoded = decodeURIComponent(pathEncoded)
                            await deleteObject(ref(storage, pathDecoded))
                        } catch {
                            /* ignore single image failures */
                        }
                    })
                )
            }
            await deleteDoc(doc(db, 'stakeholderEngagements', row.id))
            message.success('Engagement deleted.')
            setDrawerOpen(false)
            setSelected(null)
        } catch (e) {
            console.error(e)
            message.error('Delete failed.')
        } finally {
            setDeleteLoading(false)
        }
    }

    // AI import minimal parser: accept JSON or free text
    const parseAiNotes = useCallback((raw: string) => {
        // Try JSON first
        try {
            const obj = JSON.parse(raw)
            const title: string =
                obj.title || obj.meeting_title || 'Stakeholder Meeting'
            const stakeholder: string =
                obj.stakeholder || obj.client || obj.company || ''
            const dateStr: string = obj.date || obj.datetime || obj.meeting_date || ''
            const attendees: string[] =
                obj.attendees || obj.participants || obj.people || []
            const notes: string =
                obj.summary || obj.notes || obj.transcript || obj.key_points || raw

            return {
                title,
                stakeholder,
                date: dateStr ? dayjs(dateStr) : dayjs(),
                attendees: Array.isArray(attendees) ? attendees : [],
                notes
            }
        } catch {
            // Fallback: crude text extraction (first line=title, look for Attendees:, Date:)
            const lines = raw
                .split('\n')
                .map(l => l.trim())
                .filter(Boolean)
            const titleLine = lines[0] || 'Stakeholder Meeting'
            const attendeesLine = lines.find(l => /^attendees?:/i.test(l))
            const dateLine = lines.find(
                l => /^date(time)?:/i.test(l) || /\b\d{4}-\d{2}-\d{2}\b/.test(l)
            )
            const attendees = attendeesLine
                ? attendeesLine
                    .replace(/^attendees?:/i, '')
                    .split(',')
                    .map(s => s.trim())
                    .filter(Boolean)
                : []
            let parsedDate = dayjs()
            if (dateLine) {
                const iso = dateLine.match(/\d{4}-\d{2}-\d{2}/)?.[0]
                if (iso) parsedDate = dayjs(iso)
            }
            const rest = lines.slice(1).join('\n')
            return {
                title: titleLine,
                stakeholder: '',
                date: parsedDate,
                attendees,
                notes: rest || raw
            }
        }
    }, [])

    const handleAiImport = () => {
        setAiParsing(true)
        try {
            const parsed = parseAiNotes(aiRaw)
            // Pre-fill the create form (if open), else open it
            if (!createOpen) setCreateOpen(true)
            // Merge with existing form data (respect user edits)
            const existing = form.getFieldsValue()
            const mergedNotes = includeAiImportedNotes
                ? [existing.notes || '', parsed.notes || '']
                    .filter(Boolean)
                    .join('\n\n')
                : existing.notes || ''

            form.setFieldsValue({
                title: existing.title || parsed.title,
                stakeholder: existing.stakeholder || parsed.stakeholder,
                date: existing.date || parsed.date,
                attendees:
                    existing.attendees && existing.attendees.length
                        ? existing.attendees
                        : parsed.attendees,
                notes: mergedNotes,
                aiSource: existing.aiSource || 'Generic'
            })
            message.success('AI notes parsed and loaded into the form.')
            setAiOpen(false)
            setAiRaw('')
        } catch (e) {
            console.error(e)
            message.error('Could not parse the AI notes.')
        } finally {
            setAiParsing(false)
        }
    }

    const columns = [
        {
            title: 'Date',
            dataIndex: 'date',
            key: 'date',
            sorter: (a: Engagement, b: Engagement) =>
                a.date.toMillis() - b.date.toMillis(),
            render: (val: Timestamp) => dayjs(val.toDate()).format('YYYY-MM-DD')
        },
        {
            title: 'Title',
            dataIndex: 'title',
            key: 'title',
            render: (_: any, row: Engagement) => (
                <Space direction='vertical' size={0}>
                    <Text strong>{row.title}</Text>
                    <Text type='secondary' style={{ fontSize: 12 }}>
                        {row.meetingLink || ''}
                    </Text>
                </Space>
            )
        },
        {
            title: 'Stakeholder',
            dataIndex: 'stakeholder',
            key: 'stakeholder',
            render: (txt: string, row: Engagement) => (
                <Space>
                    <Text>{txt}</Text>
                    <Tag color='blue'>{row.stakeholderType}</Tag>
                </Space>
            )
        },
        {
            title: 'Mode',
            dataIndex: 'mode',
            key: 'mode',
            render: (m: EngagementMode) => {
                const color =
                    m === 'Online' ? 'geekblue' : m === 'In-person' ? 'green' : 'purple'
                return <Tag color={color}>{m}</Tag>
            }
        },
        {
            title: 'Attendees',
            key: 'attendees',
            render: (_: any, row: Engagement) => (
                <Text>{row.attendees?.length || 0}</Text>
            )
        },
        {
            title: 'Images',
            key: 'images',
            render: (_: any, row: Engagement) => (
                <Text>{row.images?.length || 0}</Text>
            )
        },
        {
            title: 'Actions',
            key: 'actions',
            render: (_: any, row: Engagement) => (
                <Space>
                    <Button
                        icon={<EyeOutlined />}
                        onClick={() => openDetail(row)}
                        size='small'
                    >
                        View
                    </Button>
                </Space>
            )
        }
    ]

    // Basic text-only "calendar": group by month
    const groupedByMonth = useMemo(() => {
        const groups: Record<string, Engagement[]> = {}
        engagements.forEach(e => {
            const key = dayjs(e.date.toDate()).format('YYYY MMM')
            groups[key] = groups[key] || []
            groups[key].push(e)
        })
        // sort entries by date desc
        Object.keys(groups).forEach(k => {
            groups[k].sort((a, b) => b.date.toMillis() - a.date.toMillis())
        })
        return groups
    }, [engagements])

    return (
        <Layout
            style={{ minHeight: '100vh', padding: 24, background: 'transparent' }}
        >
            <DashboardHeaderCard
                title=' Stakeholder Engagement'
                subtitle=' Track meetings, images, and notes. Import notes from AI
              notetakers.'
                extraRight={
                    <Space wrap>
                        <Button
                            icon={<CalendarOutlined />}
                            onClick={() => setCalendarOpen(true)}
                        >
                            Calendar
                        </Button>
                        <Button icon={<ImportOutlined />} onClick={() => setAiOpen(true)}>
                            Import AI Notes
                        </Button>
                        <Button
                            type='primary'
                            icon={<PlusOutlined />}
                            onClick={() => setCreateOpen(true)}
                        >
                            New Engagement
                        </Button>
                    </Space>
                }
            />

            <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                <Col xs={24} sm={12} md={6}>
                    <MotionCard>
                        <Statistic
                            title='Total Engagements'
                            value={metrics.totalEngagements}
                            prefix={<UserOutlined style={{ color: '#1890ff' }} />}
                        />
                    </MotionCard>
                </Col>

                <Col xs={24} sm={12} md={6}>
                    <MotionCard>
                        <Statistic
                            title='Unique Stakeholders'
                            value={metrics.uniqueStakeholders}
                            prefix={<UsergroupAddOutlined style={{ color: '#52c41a' }} />}
                        />
                    </MotionCard>
                </Col>

                <Col xs={24} sm={12} md={6}>
                    <MotionCard>
                        <Statistic
                            title='Total Attendees'
                            value={metrics.totalAttendees}
                            prefix={<TeamOutlined style={{ color: '#faad14' }} />}
                        />
                    </MotionCard>
                </Col>

                <Col xs={24} sm={12} md={6}>
                    <MotionCard>
                        <Statistic
                            title='Images Uploaded'
                            value={metrics.totalImages}
                            prefix={<PictureOutlined style={{ color: '#eb2f96' }} />}
                        />
                    </MotionCard>
                </Col>
            </Row>

            <MotionCard style={{ marginBottom: 16 }}>
                <Space wrap align='center' style={{ width: '100%' }}>
                    <Input.Search
                        allowClear
                        placeholder='Search title, stakeholder, notes, attendees'
                        onChange={e => setSearch(e.target.value)}
                        style={{ width: 320 }}
                    />

                    <Select
                        value={typeFilter}
                        onChange={v => setTypeFilter(v as any)}
                        style={{ width: 200 }}
                    >
                        <Option value='All'>All Types</Option>
                        {STAKEHOLDER_TYPES.map(t => (
                            <Option key={t} value={t}>
                                {t}
                            </Option>
                        ))}
                    </Select>

                    <Select
                        value={modeFilter}
                        onChange={v => setModeFilter(v as any)}
                        style={{ width: 180 }}
                    >
                        <Option value='All'>All Modes</Option>
                        {MODES.map(m => (
                            <Option key={m} value={m}>
                                {m}
                            </Option>
                        ))}
                    </Select>

                    <RangePicker
                        value={dateRange}
                        onChange={v => setDateRange(v as any)}
                    />
                </Space>
            </MotionCard>

            <MotionCard>
                <Table
                    rowKey='id'
                    loading={loading}
                    columns={columns as any}
                    dataSource={filtered}
                    pagination={{ pageSize: 10 }}
                    locale={{ emptyText: <Empty description='No engagements yet' /> }}
                />
            </MotionCard>

            {/* Create Modal */}
            <Modal
                open={createOpen}
                title='Log Stakeholder Engagement'
                onCancel={() => {
                    setCreateOpen(false)
                    resetCreateState()
                }}
                onOk={() => form.submit()}
                okText={saving ? 'Saving...' : 'Save'}
                confirmLoading={saving}
                width={800}
                destroyOnClose
            >
                <Alert
                    type='info'
                    showIcon
                    message='Tip'
                    description='Attach meeting images. If Online/Hybrid, paste the meeting link; if In-person/Hybrid, add a location. Hybrid asks for both.'
                    style={{ marginBottom: 16 }}
                />

                {/*
    👇 watch the current mode live (Online / In-person / Hybrid)
  */}
                {(() => {
                    const mode = Form.useWatch('mode', form) as
                        | 'Online'
                        | 'In-person'
                        | 'Hybrid'
                        | undefined

                    const showOnline = mode === 'Online' || mode === 'Hybrid'
                    const showInPerson = mode === 'In-person' || mode === 'Hybrid'

                    return (
                        <Form
                            form={form}
                            layout='vertical'
                            onFinish={handleCreate}
                            initialValues={{
                                stakeholderType: 'Other',
                                mode: 'Online',
                                attendees: [],
                                aiSource: 'Generic',
                                date: dayjs()
                            }}
                        >
                            {/* Basics */}
                            <Row gutter={12}>
                                <Col span={16}>
                                    <Form.Item
                                        name='title'
                                        label='Title'
                                        rules={[{ required: true, message: 'Title is required' }]}
                                    >
                                        <Input placeholder='e.g., Quarterly review with IDC' />
                                    </Form.Item>
                                </Col>
                                <Col span={8}>
                                    <Form.Item
                                        name='date'
                                        label='Date'
                                        rules={[{ required: true }]}
                                    >
                                        <DatePicker style={{ width: '100%' }} />
                                    </Form.Item>
                                </Col>
                            </Row>

                            <Row gutter={12}>
                                <Col span={12}>
                                    <Form.Item
                                        name='stakeholder'
                                        label='Stakeholder'
                                        rules={[
                                            {
                                                required: true,
                                                message: 'Stakeholder name is required'
                                            }
                                        ]}
                                    >
                                        <Input placeholder='e.g., IDC, Exxaro, Municipality' />
                                    </Form.Item>
                                </Col>
                                <Col span={12}>
                                    <Form.Item
                                        name='stakeholderType'
                                        label='Stakeholder Type'
                                        rules={[{ required: true }]}
                                    >
                                        <Select>
                                            {STAKEHOLDER_TYPES.map(t => (
                                                <Option key={t} value={t}>
                                                    {t}
                                                </Option>
                                            ))}
                                        </Select>
                                    </Form.Item>
                                </Col>
                            </Row>

                            {/* Mode selection */}
                            <Row gutter={12}>
                                <Col span={12}>
                                    <Form.Item
                                        name='mode'
                                        label='Mode'
                                        rules={[{ required: true }]}
                                    >
                                        <Select>
                                            {MODES.map(m => (
                                                <Option key={m} value={m}>
                                                    {m}
                                                </Option>
                                            ))}
                                        </Select>
                                    </Form.Item>
                                </Col>

                                {/* ONLINE link (required when Online or Hybrid) */}
                                {showOnline && (
                                    <Col span={12}>
                                        <Form.Item
                                            name='meetingLink'
                                            label='Meeting Link'
                                            rules={[
                                                {
                                                    required: true,
                                                    message: 'Link is required for Online/Hybrid'
                                                }
                                            ]}
                                        >
                                            <Input placeholder='https://...' />
                                        </Form.Item>
                                    </Col>
                                )}

                                {/* IN-PERSON location (required when In-person or Hybrid) */}
                                {showInPerson && (
                                    <Col span={12}>
                                        <Form.Item
                                            name='location'
                                            label='Location'
                                            rules={[
                                                {
                                                    required: true,
                                                    message: 'Location is required for In-person/Hybrid'
                                                }
                                            ]}
                                        >
                                            <Input placeholder='e.g., Head Office, Boardroom A' />
                                        </Form.Item>
                                    </Col>
                                )}
                            </Row>

                            {/* Time spans */}
                            {/* For Online or In-person: one time range */}
                            {(mode === 'Online' || mode === 'In-person') && (
                                <Form.Item
                                    name='timeRange'
                                    label='Meeting Time'
                                    rules={[
                                        {
                                            required: true,
                                            message: 'Please select start and end time'
                                        }
                                    ]}
                                >
                                    <RangePicker showTime style={{ width: '100%' }} />
                                </Form.Item>
                            )}

                            {/* For Hybrid: ask for BOTH online and in-person time ranges */}
                            {mode === 'Hybrid' && (
                                <Row gutter={12}>
                                    <Col span={12}>
                                        <Form.Item
                                            name='onlineTimeRange'
                                            label='Online Session Time'
                                            rules={[
                                                {
                                                    required: true,
                                                    message: 'Select online session time'
                                                }
                                            ]}
                                        >
                                            <RangePicker showTime style={{ width: '100%' }} />
                                        </Form.Item>
                                    </Col>
                                    <Col span={12}>
                                        <Form.Item
                                            name='inPersonTimeRange'
                                            label='In-person Session Time'
                                            rules={[
                                                {
                                                    required: true,
                                                    message: 'Select in-person session time'
                                                }
                                            ]}
                                        >
                                            <RangePicker showTime style={{ width: '100%' }} />
                                        </Form.Item>
                                    </Col>
                                </Row>
                            )}

                            {/* AI source */}
                            <Form.Item name='aiSource' label='AI Notes Source'>
                                <Select>
                                    <Option value='Generic'>Generic</Option>
                                    <Option value='Otter'>Otter.ai</Option>
                                    <Option value='GoogleMeet'>Google Meet</Option>
                                    <Option value='Teams'>Microsoft Teams</Option>
                                    <Option value='Zoom'>Zoom</Option>
                                </Select>
                            </Form.Item>

                            {/* Attendees */}
                            <Form.Item
                                name='attendees'
                                label='Attendees (press Enter to add each)'
                                tooltip='Type a name and press Enter; repeat for each attendee'
                            >
                                <Select
                                    mode='tags'
                                    tokenSeparators={[',']}
                                    placeholder='e.g., Jane Doe, John Smith'
                                />
                            </Form.Item>

                            {/* Notes */}
                            <Form.Item name='notes' label='Meeting Notes'>
                                <TextArea
                                    rows={6}
                                    placeholder='Key outcomes, decisions, next steps...'
                                />
                            </Form.Item>

                            {/* Images */}
                            <Form.Item label='Images'>
                                <Dragger {...uploadProps} accept='image/*' listType='picture'>
                                    <p className='ant-upload-drag-icon'>
                                        <UploadOutlined />
                                    </p>
                                    <p className='ant-upload-text'>
                                        Click or drag images to this area to upload
                                    </p>
                                    <p className='ant-upload-hint'>Support for multiple files.</p>
                                </Dragger>
                            </Form.Item>

                            <Checkbox
                                checked={includeAiImportedNotes}
                                onChange={e => setIncludeAiImportedNotes(e.target.checked)}
                            >
                                When I import AI notes, append them to the Notes field
                            </Checkbox>
                        </Form>
                    )
                })()}
            </Modal>

            {/* Detail Drawer */}
            <Drawer
                width={720}
                open={drawerOpen}
                onClose={() => {
                    setDrawerOpen(false)
                    setSelected(null)
                }}
                title={selected ? selected.title : 'Details'}
                extra={
                    selected && (
                        <Space>
                            <Button
                                danger
                                icon={<DeleteOutlined />}
                                loading={deleteLoading}
                                onClick={() => selected && handleDelete(selected)}
                            >
                                Delete
                            </Button>
                        </Space>
                    )
                }
            >
                {!selected ? (
                    <Empty />
                ) : (
                    <>
                        <Descriptions bordered size='middle' column={1}>
                            <Descriptions.Item label='Date'>
                                {dayjs(selected.date.toDate()).format('YYYY-MM-DD HH:mm')}
                            </Descriptions.Item>
                            <Descriptions.Item label='Stakeholder'>
                                <Space>
                                    <Text>{selected.stakeholder}</Text>
                                    <Tag color='blue'>{selected.stakeholderType}</Tag>
                                </Space>
                            </Descriptions.Item>
                            <Descriptions.Item label='Mode'>
                                <Tag
                                    color={
                                        selected.mode === 'Online'
                                            ? 'geekblue'
                                            : selected.mode === 'In-person'
                                                ? 'green'
                                                : 'purple'
                                    }
                                >
                                    {selected.mode}
                                </Tag>
                            </Descriptions.Item>
                            {selected.location ? (
                                <Descriptions.Item label='Location'>
                                    {selected.location}
                                </Descriptions.Item>
                            ) : null}
                            {selected.meetingLink ? (
                                <Descriptions.Item label='Meeting Link'>
                                    <a
                                        href={selected.meetingLink}
                                        target='_blank'
                                        rel='noreferrer'
                                    >
                                        {selected.meetingLink}
                                    </a>
                                </Descriptions.Item>
                            ) : null}
                            <Descriptions.Item label='Attendees'>
                                {selected.attendees?.length ? (
                                    <Space wrap>
                                        {selected.attendees.map((a, i) => (
                                            <Tag key={i}>{a}</Tag>
                                        ))}
                                    </Space>
                                ) : (
                                    '—'
                                )}
                            </Descriptions.Item>
                            <Descriptions.Item label='Notes'>
                                {selected.notes ? (
                                    <pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>
                                        {selected.notes}
                                    </pre>
                                ) : (
                                    '—'
                                )}
                            </Descriptions.Item>
                            <Descriptions.Item label='AI Source'>
                                {selected.aiSource || '—'}
                            </Descriptions.Item>
                        </Descriptions>

                        <Divider />

                        <Title level={5} style={{ marginTop: 0 }}>
                            Images
                        </Title>
                        {selected.images?.length ? (
                            <Image.PreviewGroup>
                                <Space wrap>
                                    {selected.images.map((url, idx) => (
                                        <Image key={idx} width={160} src={url} />
                                    ))}
                                </Space>
                            </Image.PreviewGroup>
                        ) : (
                            <Empty description='No images uploaded' />
                        )}
                    </>
                )}
            </Drawer>

            {/* AI Import Modal */}
            <Modal
                open={aiOpen}
                title='Import Notes from AI Notetaker'
                onCancel={() => setAiOpen(false)}
                onOk={handleAiImport}
                okText={aiParsing ? 'Parsing...' : 'Import'}
                confirmLoading={aiParsing}
            >
                <Alert
                    type='info'
                    showIcon
                    style={{ marginBottom: 12 }}
                    message='Paste JSON or raw transcript'
                    description={
                        <div>
                            <div>JSON example:</div>
                            <pre style={{ whiteSpace: 'pre-wrap', margin: '8px 0' }}>
                                {`{
  "title": "Quarterly Review",
  "stakeholder": "IDC",
  "date": "2025-09-28T09:00:00",
  "attendees": ["Jane Doe", "John Smith"],
  "summary": "We agreed on KPIs and next steps..."
}`}
                            </pre>
                            <div>Raw text example:</div>
                            <pre style={{ whiteSpace: 'pre-wrap', margin: '8px 0' }}>
                                {`Quarterly Review with IDC
Date: 2025-09-28
Attendees: Jane Doe, John Smith
Notes:
- Agreed on KPIs
- Next review in Q4
`}
                            </pre>
                        </div>
                    }
                />
                <TextArea
                    rows={10}
                    value={aiRaw}
                    onChange={e => setAiRaw(e.target.value)}
                    placeholder='Paste AI notes/transcript or JSON here...'
                />
            </Modal>

            {/* Calendar Modal */}
            <Modal
                open={calendarOpen}
                title='Engagement Calendar'
                onCancel={() => setCalendarOpen(false)}
                footer={null}
                width={800}
            >
                {Object.keys(groupedByMonth).length === 0 ? (
                    <Empty />
                ) : (
                    Object.entries(groupedByMonth).map(([month, items]) => (
                        <Card
                            key={month}
                            size='small'
                            title={month}
                            style={{ marginBottom: 12 }}
                        >
                            {items.map(it => (
                                <Row
                                    key={it.id}
                                    align='middle'
                                    justify='space-between'
                                    style={{
                                        padding: '6px 0',
                                        borderBottom: '1px solid rgba(0,0,0,0.06)'
                                    }}
                                >
                                    <Col>
                                        <Space direction='vertical' size={0}>
                                            <Text strong>
                                                {dayjs(it.date.toDate()).format('YYYY-MM-DD')}
                                            </Text>
                                            <Text>{it.title}</Text>
                                            <Text type='secondary'>
                                                {it.stakeholder} • {it.mode}
                                            </Text>
                                        </Space>
                                    </Col>
                                    <Col>
                                        <Button
                                            size='small'
                                            icon={<EyeOutlined />}
                                            onClick={() => {
                                                setCalendarOpen(false)
                                                openDetail(it)
                                            }}
                                        >
                                            View
                                        </Button>
                                    </Col>
                                </Row>
                            ))}
                        </Card>
                    ))
                )}
            </Modal>
        </Layout>
    )
}

export default StakeholderEngagementPage
