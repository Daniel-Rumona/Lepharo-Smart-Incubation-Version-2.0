import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
    Alert,
    AutoComplete,
    Button,
    Card,
    Checkbox,
    Col,
    DatePicker,
    Empty,
    Form,
    Image,
    Input,
    InputNumber,
    Modal,
    Popconfirm,
    Row,
    Segmented,
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
    AlertOutlined,
    DeleteOutlined,
    DownloadOutlined,
    EditOutlined,
    FileExcelOutlined,
    PictureOutlined,
    PlusOutlined,
    ShopOutlined,
    ShoppingCartOutlined,
    ToolOutlined,
    WarningOutlined
} from '@ant-design/icons'
import { Helmet } from 'react-helmet'
import dayjs from 'dayjs'
import {
    addDoc,
    collection,
    doc,
    getDocs,
    query,
    Timestamp,
    updateDoc,
    deleteDoc,
    where,
    writeBatch
} from 'firebase/firestore'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { db, storage } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { DashboardFilterBar, MotionCard } from '@/components/dashboards/metrics/Header'
import { MetricTile } from '@/components/dashboards/metrics/MetricTile'
import { downloadNeedsTemplate, parseNeedsWorkbook, type NeedsParseResult } from './needsWorkbook'
import {
    effectiveLeaseStatus,
    leaseDuration,
    LEASE_STATUSES,
    sortWorkshops,
    WORKSHOPS,
    type FacilityWorkshop,
    type LeaseStatus
} from './workshops'

const { Text, Paragraph } = Typography
const { TextArea } = Input

type Segment = 'issues' | 'gaps' | 'workshops' | 'needs'
type Risk = 'Low' | 'Medium' | 'High'
type IssueStatus = 'Open' | 'In Progress' | 'Escalated' | 'Resolved'
type GapStatus = 'Open' | 'Funding Sought' | 'In Progress' | 'Closed'
type NeedStatus = 'Identified' | 'Submitted' | 'Approved' | 'Procured'

type FacilityImage = { name: string; url: string; path: string }

type FacilityIssue = {
    id: string
    area: string
    title: string
    risk: Risk
    actionType: 'Maintenance' | 'Escalated'
    escalatedTo?: string
    action?: string
    status: IssueStatus
    images: FacilityImage[]
    createdAt?: any
    updatedAt?: any
}

type FacilityGap = {
    id: string
    gap: string
    quantity?: number | null
    correctiveAction: string
    status: GapStatus
    notes?: string
    images: FacilityImage[]
    createdAt?: any
}

type FacilityNeed = {
    id: string
    need: string
    product: string
    quantity: number
    price: number | null
    status: NeedStatus
    notes?: string
    source?: 'manual' | 'excel'
    createdAt?: any
}

const ISSUES = 'facilityIssues'
const GAPS = 'facilityGaps'
const NEEDS = 'facilityNeeds'

const LEASE_COLOR: Record<LeaseStatus, string> = {
    'Lease signed': 'success',
    'Lease updated': 'processing',
    'Lease expired': 'error',
    Vacant: 'default'
}

const RISK_COLOR: Record<Risk, string> = { Low: 'green', Medium: 'orange', High: 'red' }
const ISSUE_STATUS_COLOR: Record<IssueStatus, string> = {
    Open: 'default',
    'In Progress': 'processing',
    Escalated: 'purple',
    Resolved: 'success'
}
const GAP_STATUSES: GapStatus[] = ['Open', 'Funding Sought', 'In Progress', 'Closed']
const NEED_STATUSES: NeedStatus[] = ['Identified', 'Submitted', 'Approved', 'Procured']
const AREA_SUGGESTIONS = ['Perimeter', 'Main Gate', 'Guard Room', 'Admin Block', 'Reception', 'Workshop Block', 'Training Room', 'Computer Room', 'Grounds']
const ESCALATION_SUGGESTIONS = ['Municipality', 'Guardian Security', 'Landlord', 'Head Office']
const CORRECTIVE_SUGGESTIONS = ['Source Funds', 'Electrician Required', 'Requires Repair', 'Requires Replacement', 'Quote Requested']

const rand = (value: number | null | undefined) =>
    value === null || value === undefined
        ? '—'
        : `R ${value.toLocaleString('en-ZA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const toMillis = (value: any) => value?.toMillis?.() ?? (value ? new Date(value).getTime() : 0)
const formatDate = (value: any) => (value ? dayjs(toMillis(value)).format('DD MMM YYYY') : '')

const uploadImages = async (files: UploadFile[], folder: string): Promise<FacilityImage[]> =>
    Promise.all(
        files
            .map(item => item.originFileObj)
            .filter(Boolean)
            .map(async file => {
                const safeName = file!.name.replace(/[^\w.\-]+/g, '_')
                const path = `${folder}/${Date.now()}_${safeName}`
                const storageRef = ref(storage, path)
                await uploadBytes(storageRef, file!)
                return { name: file!.name, url: await getDownloadURL(storageRef), path }
            })
    )

// Existing images show in the uploader as done files; new ones carry originFileObj.
const imagesToFileList = (images: FacilityImage[] = []): UploadFile[] =>
    images.map((image, index) => ({ uid: `existing-${index}`, name: image.name, status: 'done', url: image.url }))

const keptImages = (fileList: UploadFile[], previous: FacilityImage[] = []) =>
    previous.filter(image => fileList.some(file => !file.originFileObj && file.url === image.url))

const ImageField: React.FC<{ value?: UploadFile[]; onChange?: (files: UploadFile[]) => void }> = ({ value = [], onChange }) => (
    <Upload
        listType='picture-card'
        accept='image/*'
        multiple
        fileList={value}
        beforeUpload={file => {
            if (file.size > 10 * 1024 * 1024) {
                message.error(`${file.name} is larger than 10 MB`)
                return Upload.LIST_IGNORE
            }
            return false
        }}
        onChange={({ fileList }) => onChange?.(fileList)}
    >
        <div>
            <PlusOutlined />
            <div style={{ marginTop: 6 }}>Photo</div>
        </div>
    </Upload>
)

const FacilitiesManagementPage: React.FC = () => {
    const { user } = useFullIdentity()
    const [segment, setSegment] = useState<Segment>('issues')
    // A project admin manages their own centre only.
    const branchId: string | undefined = user?.assignedBranch || undefined
    const [loading, setLoading] = useState(false)
    const [saving, setSaving] = useState(false)

    const [issues, setIssues] = useState<FacilityIssue[]>([])
    const [gaps, setGaps] = useState<FacilityGap[]>([])
    const [needs, setNeeds] = useState<FacilityNeed[]>([])
    const [workshops, setWorkshops] = useState<FacilityWorkshop[]>([])

    const [riskFilter, setRiskFilter] = useState<Risk | 'all'>('all')
    const [statusFilter, setStatusFilter] = useState<IssueStatus | 'active' | 'all'>('active')
    const [areaFilter, setAreaFilter] = useState<string | undefined>()

    const [issueModal, setIssueModal] = useState<{ open: boolean; record?: FacilityIssue }>({ open: false })
    const [gapModal, setGapModal] = useState<{ open: boolean; record?: FacilityGap }>({ open: false })
    const [needModal, setNeedModal] = useState<{ open: boolean; record?: FacilityNeed }>({ open: false })
    const [workshopModal, setWorkshopModal] = useState<{ open: boolean; record?: FacilityWorkshop }>({ open: false })
    const [importOpen, setImportOpen] = useState(false)
    const [importResult, setImportResult] = useState<NeedsParseResult | null>(null)
    const [importFileName, setImportFileName] = useState('')
    const [replaceExisting, setReplaceExisting] = useState(false)

    const [issueForm] = Form.useForm()
    const [gapForm] = Form.useForm()
    const [needForm] = Form.useForm()
    const [workshopForm] = Form.useForm()


    const load = useCallback(async () => {
        if (!branchId) return
        setLoading(true)
        try {
            const fetchAll = async <T,>(name: string) => {
                const snap = await getDocs(query(collection(db, name), where('branchId', '==', branchId)))
                return snap.docs
                    .map(d => ({ id: d.id, images: [], ...(d.data() as any) }) as T)
                    .sort((a: any, b: any) => toMillis(b.createdAt) - toMillis(a.createdAt))
            }
            const [issueRows, gapRows, needRows, workshopRows] = await Promise.all([
                fetchAll<FacilityIssue>(ISSUES),
                fetchAll<FacilityGap>(GAPS),
                fetchAll<FacilityNeed>(NEEDS),
                fetchAll<FacilityWorkshop>(WORKSHOPS)
            ])
            setIssues(issueRows)
            setGaps(gapRows)
            setNeeds(needRows.sort((a, b) => a.need.localeCompare(b.need)))
            setWorkshops(sortWorkshops(workshopRows))
        } catch (error) {
            console.error('Facilities load failed', error)
            message.error('Could not load facilities records')
        } finally {
            setLoading(false)
        }
    }, [branchId])

    useEffect(() => {
        load()
    }, [load])

    const stamp = () => ({
        branchId,
        companyCode: user?.companyCode || null,
        updatedAt: Timestamp.now(),
        updatedById: user?.id || null,
        updatedByName: user?.name || null
    })
    const createdStamp = () => ({ createdAt: Timestamp.now(), createdById: user?.id || null, createdByName: user?.name || null })

    // ---- issues -------------------------------------------------------------

    const openIssue = (record?: FacilityIssue) => {
        issueForm.resetFields()
        issueForm.setFieldsValue(
            record
                ? { ...record, images: imagesToFileList(record.images) }
                : { risk: 'Medium', actionType: 'Maintenance', status: 'Open', images: [] }
        )
        setIssueModal({ open: true, record })
    }

    const saveIssue = async () => {
        const values = await issueForm.validateFields()
        setSaving(true)
        try {
            const fileList: UploadFile[] = values.images || []
            const uploaded = await uploadImages(fileList, `facilities/${branchId}`)
            const images = [...keptImages(fileList, issueModal.record?.images), ...uploaded]
            const payload = {
                area: values.area.trim(),
                title: values.title.trim(),
                risk: values.risk,
                actionType: values.actionType,
                escalatedTo: values.actionType === 'Escalated' ? values.escalatedTo || null : null,
                action: values.action || '',
                status: values.status,
                images,
                ...stamp()
            }
            if (issueModal.record) await updateDoc(doc(db, ISSUES, issueModal.record.id), payload)
            else await addDoc(collection(db, ISSUES), { ...payload, ...createdStamp() })
            message.success('Facility issue saved')
            setIssueModal({ open: false })
            load()
        } catch (error) {
            console.error(error)
            message.error('Could not save the issue')
        } finally {
            setSaving(false)
        }
    }

    // ---- gaps ---------------------------------------------------------------

    const openGap = (record?: FacilityGap) => {
        gapForm.resetFields()
        gapForm.setFieldsValue(record ? { ...record, images: imagesToFileList(record.images) } : { status: 'Open', images: [] })
        setGapModal({ open: true, record })
    }

    const saveGap = async () => {
        const values = await gapForm.validateFields()
        setSaving(true)
        try {
            const fileList: UploadFile[] = values.images || []
            const uploaded = await uploadImages(fileList, `facilities/${branchId}`)
            const payload = {
                gap: values.gap.trim(),
                quantity: values.quantity ?? null,
                correctiveAction: values.correctiveAction.trim(),
                status: values.status,
                notes: values.notes || '',
                images: [...keptImages(fileList, gapModal.record?.images), ...uploaded],
                ...stamp()
            }
            if (gapModal.record) await updateDoc(doc(db, GAPS, gapModal.record.id), payload)
            else await addDoc(collection(db, GAPS), { ...payload, ...createdStamp() })
            message.success('Gap saved')
            setGapModal({ open: false })
            load()
        } catch (error) {
            console.error(error)
            message.error('Could not save the gap')
        } finally {
            setSaving(false)
        }
    }

    // ---- workshops ----------------------------------------------------------

    const openWorkshop = (record?: FacilityWorkshop) => {
        workshopForm.resetFields()
        workshopForm.setFieldsValue(
            record
                ? {
                    ...record,
                    leasePeriod: record.leaseStart || record.leaseEnd
                        ? [record.leaseStart ? dayjs(record.leaseStart) : null, record.leaseEnd ? dayjs(record.leaseEnd) : null]
                        : undefined
                }
                : { leaseStatus: 'Lease signed' }
        )
        setWorkshopModal({ open: true, record })
    }

    const saveWorkshop = async () => {
        const values = await workshopForm.validateFields()
        setSaving(true)
        try {
            const [start, end] = values.leasePeriod || []
            const vacant = values.leaseStatus === 'Vacant'
            const payload = {
                workshopNo: values.workshopNo.trim(),
                smeName: vacant ? '' : (values.smeName || '').trim(),
                trade: vacant ? '' : (values.trade || '').trim(),
                leaseStatus: values.leaseStatus,
                leaseStart: !vacant && start ? start.format('YYYY-MM-DD') : null,
                leaseEnd: !vacant && end ? end.format('YYYY-MM-DD') : null,
                comments: values.comments || '',
                ...stamp()
            }
            if (workshopModal.record) await updateDoc(doc(db, WORKSHOPS, workshopModal.record.id), payload)
            else await addDoc(collection(db, WORKSHOPS), { ...payload, ...createdStamp() })
            message.success('Workshop saved')
            setWorkshopModal({ open: false })
            load()
        } catch (error) {
            console.error(error)
            message.error('Could not save the workshop')
        } finally {
            setSaving(false)
        }
    }

    // ---- needs --------------------------------------------------------------

    const openNeed = (record?: FacilityNeed) => {
        needForm.resetFields()
        needForm.setFieldsValue(record || { quantity: 1, status: 'Identified' })
        setNeedModal({ open: true, record })
    }

    const saveNeed = async () => {
        const values = await needForm.validateFields()
        setSaving(true)
        try {
            const payload = {
                need: values.need.trim(),
                product: values.product.trim(),
                quantity: values.quantity || 1,
                price: values.price ?? null,
                status: values.status,
                notes: values.notes || '',
                ...stamp()
            }
            if (needModal.record) await updateDoc(doc(db, NEEDS, needModal.record.id), payload)
            else await addDoc(collection(db, NEEDS), { ...payload, source: 'manual', ...createdStamp() })
            message.success('Need saved')
            setNeedModal({ open: false })
            load()
        } catch (error) {
            console.error(error)
            message.error('Could not save the need')
        } finally {
            setSaving(false)
        }
    }

    const readWorkbook = async (file: File) => {
        try {
            const result = parseNeedsWorkbook(await file.arrayBuffer())
            if (!result.needs.length) throw new Error('No needs were found under the header row.')
            setImportResult(result)
            setImportFileName(file.name)
        } catch (error: any) {
            setImportResult(null)
            message.error(error?.message || 'Could not read that workbook')
        }
        return false
    }

    const confirmImport = async () => {
        if (!importResult) return
        setSaving(true)
        try {
            const importedAt = Timestamp.now()
            const writes: Array<(batch: ReturnType<typeof writeBatch>) => void> = []
            if (replaceExisting) needs.forEach(item => writes.push(batch => batch.delete(doc(db, NEEDS, item.id))))
            importResult.needs.forEach(item =>
                writes.push(batch =>
                    batch.set(doc(collection(db, NEEDS)), {
                        need: item.need,
                        product: item.product,
                        quantity: item.quantity,
                        price: item.price,
                        notes: item.notes,
                        status: 'Identified',
                        source: 'excel',
                        sourceFile: importFileName,
                        ...stamp(),
                        ...createdStamp(),
                        createdAt: importedAt
                    })
                )
            )
            // Firestore batches cap at 500 writes.
            for (let i = 0; i < writes.length; i += 450) {
                const batch = writeBatch(db)
                writes.slice(i, i + 450).forEach(write => write(batch))
                await batch.commit()
            }
            message.success(`Imported ${importResult.needs.length} needs`)
            setImportOpen(false)
            setImportResult(null)
            setReplaceExisting(false)
            load()
        } catch (error) {
            console.error(error)
            message.error('Import failed')
        } finally {
            setSaving(false)
        }
    }

    const remove = async (name: string, id: string) => {
        try {
            await deleteDoc(doc(db, name, id))
            message.success('Removed')
            load()
        } catch (error) {
            console.error(error)
            message.error('Could not remove the record')
        }
    }

    // ---- derived ------------------------------------------------------------

    const areas = useMemo(() => Array.from(new Set(issues.map(item => item.area).filter(Boolean))).sort(), [issues])
    const visibleIssues = useMemo(
        () =>
            issues.filter(
                item =>
                    (riskFilter === 'all' || item.risk === riskFilter) &&
                    (statusFilter === 'all' || (statusFilter === 'active' ? item.status !== 'Resolved' : item.status === statusFilter)) &&
                    (!areaFilter || item.area === areaFilter)
            ),
        [issues, riskFilter, statusFilter, areaFilter]
    )
    const activeIssues = issues.filter(item => item.status !== 'Resolved')
    const highRisk = activeIssues.filter(item => item.risk === 'High').length
    const openGaps = gaps.filter(item => item.status !== 'Closed').length
    const needsTotal = needs.reduce((sum, item) => sum + (item.price || 0), 0)

    const gapColumns: ColumnsType<FacilityGap> = [
        {
            title: 'Gap',
            dataIndex: 'gap',
            render: (value, record) => (
                <Space direction='vertical' size={0}>
                    <Text strong>{record.quantity ? `${record.quantity} × ` : ''}{value}</Text>
                    {record.notes && <Text type='secondary' style={{ fontSize: 12 }}>{record.notes}</Text>}
                </Space>
            )
        },
        { title: 'Corrective action', dataIndex: 'correctiveAction' },
        { title: 'Status', dataIndex: 'status', width: 140, render: value => <Tag color={value === 'Closed' ? 'success' : value === 'Open' ? 'default' : 'processing'}>{value}</Tag> },
        {
            title: 'Photos',
            dataIndex: 'images',
            width: 140,
            render: (images: FacilityImage[] = []) =>
                images.length ? (
                    <Image.PreviewGroup>
                        <Space size={4}>
                            {images.slice(0, 3).map(image => <Image key={image.url} src={image.url} width={36} height={36} style={{ objectFit: 'cover', borderRadius: 4 }} />)}
                        </Space>
                    </Image.PreviewGroup>
                ) : <Text type='secondary'>—</Text>
        },
        {
            title: '',
            width: 90,
            render: (_, record) => (
                <Space>
                    <Button size='small' type='text' icon={<EditOutlined />} onClick={() => openGap(record)} />
                    <Popconfirm title='Remove this gap?' onConfirm={() => remove(GAPS, record.id)}>
                        <Button size='small' type='text' danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                </Space>
            )
        }
    ]

    const workshopColumns: ColumnsType<FacilityWorkshop> = [
        { title: 'Workshop', dataIndex: 'workshopNo', width: 100 },
        { title: 'SMME', dataIndex: 'smeName', render: value => value || <Text type='secondary'>—</Text> },
        { title: 'Trade', dataIndex: 'trade', render: value => value || <Text type='secondary'>—</Text> },
        {
            title: 'Status',
            width: 140,
            render: (_, record) => {
                const status = effectiveLeaseStatus(record)
                return <Tag color={LEASE_COLOR[status]}>{status}</Tag>
            }
        },
        { title: 'Lease duration', width: 170, render: (_, record) => leaseDuration(record) },
        { title: 'Comments', dataIndex: 'comments', render: value => value || <Text type='secondary'>—</Text> },
        {
            title: '',
            width: 90,
            render: (_, record) => (
                <Space>
                    <Button size='small' type='text' icon={<EditOutlined />} onClick={() => openWorkshop(record)} />
                    <Popconfirm title='Remove this workshop?' onConfirm={() => remove(WORKSHOPS, record.id)}>
                        <Button size='small' type='text' danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                </Space>
            )
        }
    ]

    const needColumns: ColumnsType<FacilityNeed> = [
        { title: 'Qty', dataIndex: 'quantity', width: 64 },
        { title: 'Need', dataIndex: 'need', sorter: (a, b) => a.need.localeCompare(b.need) },
        { title: 'Product', dataIndex: 'product' },
        { title: 'Price', dataIndex: 'price', align: 'right', width: 150, sorter: (a, b) => (a.price || 0) - (b.price || 0), render: value => rand(value) },
        {
            title: 'Status',
            dataIndex: 'status',
            width: 130,
            filters: NEED_STATUSES.map(value => ({ text: value, value })),
            onFilter: (value, record) => record.status === value,
            render: value => <Tag color={value === 'Procured' ? 'success' : value === 'Approved' ? 'blue' : value === 'Submitted' ? 'gold' : 'default'}>{value}</Tag>
        },
        {
            title: '',
            width: 90,
            render: (_, record) => (
                <Space>
                    <Button size='small' type='text' icon={<EditOutlined />} onClick={() => openNeed(record)} />
                    <Popconfirm title='Remove this need?' onConfirm={() => remove(NEEDS, record.id)}>
                        <Button size='small' type='text' danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                </Space>
            )
        }
    ]

    const issueCard = (item: FacilityIssue) => (
        <Card
            key={item.id}
            size='small'
            hoverable
            style={{ height: '100%' }}
            cover={
                item.images.length ? (
                    <Image.PreviewGroup items={item.images.map(image => image.url)}>
                        <Image src={item.images[0].url} height={170} width='100%' style={{ objectFit: 'cover' }} />
                    </Image.PreviewGroup>
                ) : (
                    <div style={{ height: 170, display: 'grid', placeItems: 'center', background: 'var(--ant-color-fill-tertiary, #f5f5f5)' }}>
                        <PictureOutlined style={{ fontSize: 32, opacity: 0.35 }} />
                    </div>
                )
            }
            actions={[
                <EditOutlined key='edit' onClick={() => openIssue(item)} />,
                <Popconfirm key='delete' title='Remove this issue?' onConfirm={() => remove(ISSUES, item.id)}>
                    <DeleteOutlined />
                </Popconfirm>
            ]}
        >
            <Space direction='vertical' size={6} style={{ width: '100%' }}>
                <Space size={4} wrap>
                    <Tag color={RISK_COLOR[item.risk]}>{item.risk} risk</Tag>
                    <Tag color={ISSUE_STATUS_COLOR[item.status]}>{item.status}</Tag>
                    {item.images.length > 1 && <Tag icon={<PictureOutlined />}>{item.images.length}</Tag>}
                </Space>
                <Text type='secondary' style={{ fontSize: 12 }}>{item.area}</Text>
                <Text strong>{item.title}</Text>
                <Paragraph type='secondary' ellipsis={{ rows: 2 }} style={{ marginBottom: 0, fontSize: 13 }}>
                    {item.actionType === 'Escalated' ? `Escalated${item.escalatedTo ? ` to ${item.escalatedTo}` : ''}` : 'Maintenance issue'}
                    {item.action ? ` — ${item.action}` : ''}
                </Paragraph>
                <Text type='secondary' style={{ fontSize: 11 }}>{formatDate(item.updatedAt || item.createdAt)}</Text>
            </Space>
        </Card>
    )

    return (
        <div style={{ padding: 24, minHeight: '100vh' }}>
            <Helmet>
                <title>Facilities Management</title>
            </Helmet>

            <Space direction='vertical' size={16} style={{ width: '100%' }}>
                {!branchId && (
                    <Alert type='warning' showIcon message='No centre assigned' description='Your profile has no assigned branch, so there is no centre to manage. Ask an administrator to assign one.' />
                )}

                <Row gutter={[16, 16]}>
                    {[
                        { icon: <ToolOutlined />, tone: 'warning' as const, title: 'Open issues', value: activeIssues.length, onClick: () => { setSegment('issues'); setStatusFilter('active'); setRiskFilter('all') } },
                        { icon: <AlertOutlined />, tone: 'danger' as const, title: 'High risk', value: highRisk, onClick: () => { setSegment('issues'); setStatusFilter('active'); setRiskFilter('High') } },
                        { icon: <WarningOutlined />, tone: 'info' as const, title: 'Open gaps', value: openGaps, onClick: () => setSegment('gaps') },
                        { icon: <ShoppingCartOutlined />, tone: 'accent' as const, title: 'Needs list value', value: rand(needsTotal), subtitle: `${needs.length} items`, onClick: () => setSegment('needs') }
                    ].map(metric => (
                        <Col xs={24} sm={12} xl={6} key={metric.title}>
                            <MetricTile {...metric} loading={loading} />
                        </Col>
                    ))}
                </Row>

                <DashboardFilterBar>
                    <Row gutter={[12, 12]} align='middle'>
                        <Col flex='auto'>
                            <Segmented<Segment>
                                block
                                value={segment}
                                onChange={value => setSegment(value as Segment)}
                                options={[
                                    { label: 'Issues & images', value: 'issues', icon: <PictureOutlined /> },
                                    { label: 'Gaps', value: 'gaps', icon: <WarningOutlined /> },
                                    { label: 'Workshops', value: 'workshops', icon: <ShopOutlined /> },
                                    { label: 'Needs list', value: 'needs', icon: <ShoppingCartOutlined /> }
                                ]}
                            />
                        </Col>
                        <Col>
                            <Space wrap>
                                {segment === 'issues' && (
                                    <Button type='primary' icon={<PlusOutlined />} disabled={!branchId} onClick={() => openIssue()}>Log issue</Button>
                                )}
                                {segment === 'gaps' && (
                                    <Button type='primary' icon={<PlusOutlined />} disabled={!branchId} onClick={() => openGap()}>Add gap</Button>
                                )}
                                {segment === 'workshops' && (
                                    <Button type='primary' icon={<PlusOutlined />} disabled={!branchId} onClick={() => openWorkshop()}>Add workshop</Button>
                                )}
                                {segment === 'needs' && (
                                    <>
                                        <Button icon={<DownloadOutlined />} onClick={downloadNeedsTemplate}>Template</Button>
                                        <Button icon={<FileExcelOutlined />} disabled={!branchId} onClick={() => { setImportResult(null); setImportOpen(true) }}>Import Excel</Button>
                                        <Button type='primary' icon={<PlusOutlined />} disabled={!branchId} onClick={() => openNeed()}>Add need</Button>
                                    </>
                                )}
                            </Space>
                        </Col>
                    </Row>
                </DashboardFilterBar>

                {segment === 'issues' && (
                    <MotionCard
                        filterBar={
                            <Row gutter={[12, 12]}>
                                <Col xs={24} md={8}>
                                    <Select style={{ width: '100%' }} value={statusFilter} onChange={setStatusFilter} options={[
                                        { value: 'active', label: 'Not resolved' },
                                        { value: 'all', label: 'All statuses' },
                                        ...(['Open', 'In Progress', 'Escalated', 'Resolved'] as IssueStatus[]).map(value => ({ value, label: value }))
                                    ]} />
                                </Col>
                                <Col xs={24} md={8}>
                                    <Select style={{ width: '100%' }} value={riskFilter} onChange={setRiskFilter} options={[
                                        { value: 'all', label: 'All risks' },
                                        ...(['High', 'Medium', 'Low'] as Risk[]).map(value => ({ value, label: `${value} risk` }))
                                    ]} />
                                </Col>
                                <Col xs={24} md={8}>
                                    <Select style={{ width: '100%' }} allowClear placeholder='All areas of the centre' value={areaFilter} onChange={setAreaFilter} options={areas.map(value => ({ value, label: value }))} />
                                </Col>
                            </Row>
                        }
                        loading={loading}
                        skeleton='list'
                    >
                        {visibleIssues.length ? (
                            <Row gutter={[16, 16]}>
                                {visibleIssues.map(item => (
                                    <Col xs={24} sm={12} lg={8} xxl={6} key={item.id}>{issueCard(item)}</Col>
                                ))}
                            </Row>
                        ) : (
                            <Empty description='No facility issues match these filters' />
                        )}
                    </MotionCard>
                )}

                {segment === 'gaps' && (
                    <MotionCard
                        loading={loading}
                        skeleton='table'
                    >
                        <Table rowKey='id' columns={gapColumns} dataSource={gaps} pagination={{ pageSize: 15 }} scroll={{ x: 720 }} />
                    </MotionCard>
                )}

                {segment === 'workshops' && (
                    <MotionCard
                        loading={loading}
                        skeleton='table'
                    >
                        <Table rowKey='id' columns={workshopColumns} dataSource={workshops} pagination={{ pageSize: 15 }} scroll={{ x: 860 }} />
                    </MotionCard>
                )}

                {segment === 'needs' && (
                    <MotionCard
                        loading={loading}
                        skeleton='table'
                    >
                        <Table
                            rowKey='id'
                            columns={needColumns}
                            dataSource={needs}
                            pagination={{ pageSize: 20 }}
                            scroll={{ x: 760 }}
                            summary={() => (
                                <Table.Summary.Row>
                                    <Table.Summary.Cell index={0} colSpan={3}><Text strong>Total</Text></Table.Summary.Cell>
                                    <Table.Summary.Cell index={3} align='right'><Text strong>{rand(needsTotal)}</Text></Table.Summary.Cell>
                                    <Table.Summary.Cell index={4} colSpan={2} />
                                </Table.Summary.Row>
                            )}
                        />
                    </MotionCard>
                )}
            </Space>

            <Modal
                title={issueModal.record ? 'Edit facility issue' : 'Log facility issue'}
                open={issueModal.open}
                onCancel={() => setIssueModal({ open: false })}
                onOk={saveIssue}
                okText='Save'
                confirmLoading={saving}
                destroyOnClose
                width={620}
            >
                <Form form={issueForm} layout='vertical'>
                    <Row gutter={12}>
                        <Col xs={24} sm={10}>
                            <Form.Item name='area' label='Area' rules={[{ required: true, whitespace: true }]}>
                                <AutoComplete options={AREA_SUGGESTIONS.map(value => ({ value }))} placeholder='e.g. Guard Room' filterOption />
                            </Form.Item>
                        </Col>
                        <Col xs={24} sm={14}>
                            <Form.Item name='title' label='Issue' rules={[{ required: true, whitespace: true }]}>
                                <Input placeholder='e.g. Roof leaking' />
                            </Form.Item>
                        </Col>
                        <Col xs={12} sm={8}>
                            <Form.Item name='risk' label='Risk' rules={[{ required: true }]}>
                                <Select options={(['High', 'Medium', 'Low'] as Risk[]).map(value => ({ value, label: value }))} />
                            </Form.Item>
                        </Col>
                        <Col xs={12} sm={8}>
                            <Form.Item name='actionType' label='Handling' rules={[{ required: true }]}>
                                <Select options={[{ value: 'Maintenance', label: 'Maintenance' }, { value: 'Escalated', label: 'Escalated' }]} />
                            </Form.Item>
                        </Col>
                        <Col xs={24} sm={8}>
                            <Form.Item name='status' label='Status' rules={[{ required: true }]}>
                                <Select options={(['Open', 'In Progress', 'Escalated', 'Resolved'] as IssueStatus[]).map(value => ({ value, label: value }))} />
                            </Form.Item>
                        </Col>
                        <Form.Item noStyle shouldUpdate={(prev, next) => prev.actionType !== next.actionType}>
                            {({ getFieldValue }) =>
                                getFieldValue('actionType') === 'Escalated' ? (
                                    <Col span={24}>
                                        <Form.Item name='escalatedTo' label='Escalated to'>
                                            <AutoComplete options={ESCALATION_SUGGESTIONS.map(value => ({ value }))} placeholder='e.g. Municipality' filterOption />
                                        </Form.Item>
                                    </Col>
                                ) : null
                            }
                        </Form.Item>
                        <Col span={24}>
                            <Form.Item name='action' label='Action required'>
                                <TextArea rows={2} placeholder='e.g. Roof to be patched; quote requested' />
                            </Form.Item>
                        </Col>
                        <Col span={24}>
                            <Form.Item name='images' label='Images' valuePropName='value'>
                                <ImageField />
                            </Form.Item>
                        </Col>
                    </Row>
                </Form>
            </Modal>

            <Modal
                title={gapModal.record ? 'Edit gap' : 'Add facilities gap'}
                open={gapModal.open}
                onCancel={() => setGapModal({ open: false })}
                onOk={saveGap}
                okText='Save'
                confirmLoading={saving}
                destroyOnClose
            >
                <Form form={gapForm} layout='vertical'>
                    <Row gutter={12}>
                        <Col xs={24} sm={17}>
                            <Form.Item name='gap' label='Gap' rules={[{ required: true, whitespace: true }]}>
                                <Input placeholder='e.g. Lights not working' />
                            </Form.Item>
                        </Col>
                        <Col xs={24} sm={7}>
                            <Form.Item name='quantity' label='Quantity'>
                                <InputNumber min={1} style={{ width: '100%' }} />
                            </Form.Item>
                        </Col>
                        <Col xs={24} sm={14}>
                            <Form.Item name='correctiveAction' label='Corrective action' rules={[{ required: true, whitespace: true }]}>
                                <AutoComplete options={CORRECTIVE_SUGGESTIONS.map(value => ({ value }))} placeholder='e.g. Source funds' filterOption />
                            </Form.Item>
                        </Col>
                        <Col xs={24} sm={10}>
                            <Form.Item name='status' label='Status' rules={[{ required: true }]}>
                                <Select options={GAP_STATUSES.map(value => ({ value, label: value }))} />
                            </Form.Item>
                        </Col>
                        <Col span={24}>
                            <Form.Item name='notes' label='Notes'>
                                <TextArea rows={2} />
                            </Form.Item>
                        </Col>
                        <Col span={24}>
                            <Form.Item name='images' label='Images' valuePropName='value'>
                                <ImageField />
                            </Form.Item>
                        </Col>
                    </Row>
                </Form>
            </Modal>

            <Modal
                title={needModal.record ? 'Edit need' : 'Add need'}
                open={needModal.open}
                onCancel={() => setNeedModal({ open: false })}
                onOk={saveNeed}
                okText='Save'
                confirmLoading={saving}
                destroyOnClose
            >
                <Form form={needForm} layout='vertical'>
                    <Row gutter={12}>
                        <Col xs={24} sm={12}>
                            <Form.Item name='need' label='Need / category' rules={[{ required: true, whitespace: true }]}>
                                <AutoComplete options={Array.from(new Set(needs.map(item => item.need))).map(value => ({ value }))} filterOption />
                            </Form.Item>
                        </Col>
                        <Col xs={24} sm={12}>
                            <Form.Item name='product' label='Product' rules={[{ required: true, whitespace: true }]}>
                                <Input />
                            </Form.Item>
                        </Col>
                        <Col xs={8}>
                            <Form.Item name='quantity' label='Qty'>
                                <InputNumber min={1} style={{ width: '100%' }} />
                            </Form.Item>
                        </Col>
                        <Col xs={16}>
                            <Form.Item name='price' label='Price (R)'>
                                <InputNumber min={0} step={100} style={{ width: '100%' }} />
                            </Form.Item>
                        </Col>
                        <Col span={24}>
                            <Form.Item name='status' label='Status' rules={[{ required: true }]}>
                                <Select options={NEED_STATUSES.map(value => ({ value, label: value }))} />
                            </Form.Item>
                        </Col>
                        <Col span={24}>
                            <Form.Item name='notes' label='Notes'>
                                <TextArea rows={2} />
                            </Form.Item>
                        </Col>
                    </Row>
                </Form>
            </Modal>

            <Modal
                title={workshopModal.record ? 'Edit workshop' : 'Add workshop'}
                open={workshopModal.open}
                onCancel={() => setWorkshopModal({ open: false })}
                onOk={saveWorkshop}
                okText='Save'
                confirmLoading={saving}
                destroyOnClose
            >
                <Form form={workshopForm} layout='vertical'>
                    <Row gutter={12}>
                        <Col xs={24} sm={8}>
                            <Form.Item name='workshopNo' label='Workshop no.' rules={[{ required: true, whitespace: true }]}>
                                <Input placeholder='e.g. A' />
                            </Form.Item>
                        </Col>
                        <Col xs={24} sm={16}>
                            <Form.Item name='leaseStatus' label='Status' rules={[{ required: true }]}>
                                <Select options={LEASE_STATUSES.map(value => ({ value, label: value }))} />
                            </Form.Item>
                        </Col>
                        <Form.Item noStyle shouldUpdate={(prev, next) => prev.leaseStatus !== next.leaseStatus}>
                            {({ getFieldValue }) =>
                                getFieldValue('leaseStatus') === 'Vacant' ? null : (
                                    <>
                                        <Col xs={24} sm={12}>
                                            <Form.Item name='smeName' label='SMME' rules={[{ required: true, whitespace: true }]}>
                                                <Input placeholder='Tenant business' />
                                            </Form.Item>
                                        </Col>
                                        <Col xs={24} sm={12}>
                                            <Form.Item name='trade' label='Trade'>
                                                <Input placeholder='e.g. Steel works' />
                                            </Form.Item>
                                        </Col>
                                        <Col span={24}>
                                            <Form.Item name='leasePeriod' label='Lease period' extra='A lease past its end date shows as expired.'>
                                                <DatePicker.RangePicker allowEmpty={[true, true]} style={{ width: '100%' }} />
                                            </Form.Item>
                                        </Col>
                                    </>
                                )
                            }
                        </Form.Item>
                        <Col span={24}>
                            <Form.Item name='comments' label='Comments'>
                                <TextArea rows={2} />
                            </Form.Item>
                        </Col>
                    </Row>
                </Form>
            </Modal>

            <Modal
                title='Import needs list from Excel'
                open={importOpen}
                onCancel={() => setImportOpen(false)}
                onOk={confirmImport}
                okText={importResult ? `Import ${importResult.needs.length} needs` : 'Import'}
                okButtonProps={{ disabled: !importResult }}
                confirmLoading={saving}
                width={820}
                destroyOnClose
            >
                <Space direction='vertical' size={12} style={{ width: '100%' }}>
                    <Text type='secondary'>
                        The sheet needs a header row with a <Text code>Price</Text> column and a <Text code>Product</Text> or{' '}
                        <Text code>Needs identified</Text> column; <Text code>Quantity</Text> and <Text code>Notes</Text> are optional.
                        A category written once in the needs column carries down to the rows under it.
                    </Text>
                    <Upload.Dragger accept='.xlsx,.xls,.csv' maxCount={1} showUploadList={false} beforeUpload={readWorkbook}>
                        <p className='ant-upload-drag-icon'><FileExcelOutlined /></p>
                        <p className='ant-upload-text'>{importFileName && importResult ? importFileName : 'Click or drop an Excel file'}</p>
                    </Upload.Dragger>
                    {importResult && (
                        <>
                            <Alert
                                type={importResult.warnings.length ? 'warning' : 'success'}
                                showIcon
                                message={`Sheet "${importResult.sheetName}", header on row ${importResult.headerRow}: ${importResult.needs.length} needs totalling ${rand(importResult.needs.reduce((sum, item) => sum + (item.price || 0), 0))}`}
                                description={importResult.warnings.join(' ') || undefined}
                            />
                            <Table
                                size='small'
                                rowKey='row'
                                dataSource={importResult.needs}
                                pagination={{ pageSize: 8 }}
                                columns={[
                                    { title: 'Row', dataIndex: 'row', width: 60 },
                                    { title: 'Qty', dataIndex: 'quantity', width: 60 },
                                    { title: 'Need', dataIndex: 'need' },
                                    { title: 'Product', dataIndex: 'product' },
                                    { title: 'Price', dataIndex: 'price', align: 'right', render: value => rand(value) }
                                ]}
                            />
                            {needs.length > 0 && (
                                <Checkbox checked={replaceExisting} onChange={event => setReplaceExisting(event.target.checked)}>
                                    Replace the current list ({needs.length} items) instead of adding to it
                                </Checkbox>
                            )}
                        </>
                    )}
                </Space>
            </Modal>
        </div>
    )
}

export default FacilitiesManagementPage
