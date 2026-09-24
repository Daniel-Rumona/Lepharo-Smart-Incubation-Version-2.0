import React, { useEffect, useMemo, useState } from 'react'
import {
    Row,
    Col,
    Table,
    Button,
    Modal,
    Form,
    Input,
    InputNumber,
    Select,
    message,
    Typography,
    Switch,
    Segmented,
    Popconfirm,
    Skeleton
} from 'antd'
import {
    PlusOutlined,
    EditOutlined,
    UserOutlined,
    MailOutlined,
    ApartmentOutlined,
    EnvironmentOutlined,
    CloseOutlined,
    SettingOutlined,
    DeleteOutlined
} from '@ant-design/icons'
import {
    addDoc,
    collection,
    deleteField,
    deleteDoc,
    doc,
    getDocs,
    query,
    updateDoc,
    where
} from 'firebase/firestore'
import { db } from '@/firebase'
import dayjs from 'dayjs'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { BranchManagement } from '@/components/branch-management'
import { motion } from 'framer-motion'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import {
    DEFAULT_PROGRAM_LIMIT,
    getProgramLimit,
    saveProgramLimit
} from '@/services/systemSettingsService'
import { AgreementTemplatesManager } from '@/components/compliance/AgreementTemplatesManager'

const { Option } = Select
const { TextArea } = Input
const { Text } = Typography

type SegmentKey = 'department' | 'branch' | 'programs' | 'agreements'

type RoleUser = {
    id: string
    name: string
    email: string
    phone?: string
    role: string
}

const normalizeUser = (id: string, data: any): RoleUser => ({
    id,
    name: String(data?.fullName || data?.name || data?.displayName || data?.email || 'Unnamed user').trim(),
    email: String(data?.email || '').trim(),
    phone: data?.phone ? String(data.phone).trim() : undefined,
    role: String(data?.role || '').trim().toLowerCase()
})

const SystemSetupForm: React.FC = () => {
    const [activeSegment, setActiveSegment] = useState<SegmentKey>('department')
    const [departments, setDepartments] = useState<any[]>([])
    const [branches, setBranches] = useState<any[]>([])
    const [programs, setPrograms] = useState<any[]>([])
    const [operationsUsers, setOperationsUsers] = useState<RoleUser[]>([])
    const [loading, setLoading] = useState(false)
    const [modalVisible, setModalVisible] = useState(false)
    const [editingRecord, setEditingRecord] = useState<any | null>(null)
    const [form] = Form.useForm()
    const { user, loading: identityLoading } = useFullIdentity()
    const [programLimit, setProgramLimit] = useState(DEFAULT_PROGRAM_LIMIT)
    const [programLimitLoading, setProgramLimitLoading] = useState(false)
    const [departmentSearch, setDepartmentSearch] = useState('')
    const [programSearch, setProgramSearch] = useState('')
    const [programsLoading, setProgramsLoading] = useState(false)
    const [programTogglingId, setProgramTogglingId] = useState<string | null>(null)
    const [programLimitModalOpen, setProgramLimitModalOpen] = useState(false)
    const [deletingDepartmentId, setDeletingDepartmentId] = useState<string | null>(null)

    const selectedHeadUserId = Form.useWatch('headUserId', form)

    const isSystemAdmin = ['admin', 'system admin', 'system_admin'].includes(
        String(user?.role || '').toLowerCase()
    )

    useEffect(() => {
        if (identityLoading) return

        void fetchAll()
        void fetchOperationsUsers()
        void loadProgramLimit()

        if (isSystemAdmin) {
            void fetchPrograms()
        }
    }, [identityLoading, isSystemAdmin])

    const loadProgramLimit = async () => {
        try {
            setProgramLimit(await getProgramLimit())
        } catch (error) {
            console.error(error)
            message.error('Could not load the program limit')
        }
    }

    const handleSaveProgramLimit = async () => {
        if (!Number.isInteger(programLimit) || programLimit < 1) {
            return message.error('Program limit must be a whole number of at least 1')
        }

        setProgramLimitLoading(true)
        try {
            await saveProgramLimit(programLimit)
            message.success('Program limit saved')
        } catch (error) {
            console.error(error)
            message.error('Failed to save program limit')
        } finally {
            setProgramLimitLoading(false)
        }
    }

    const fetchAll = async () => {
        setLoading(true)
        try {
            const [deptSnap, branchSnap] = await Promise.all([
                getDocs(query(collection(db, 'departments'))),
                getDocs(query(collection(db, 'branches')))
            ])

            setDepartments(deptSnap.docs.map(d => ({ id: d.id, ...d.data() })))
            setBranches(branchSnap.docs.map(d => ({ id: d.id, ...d.data() })))
        } catch (error) {
            console.error(error)
            message.error('Error fetching data')
        } finally {
            setLoading(false)
        }
    }

    const fetchOperationsUsers = async () => {
        try {
            const snap = await getDocs(
                query(collection(db, 'users'), where('role', '==', 'operations'))
            )

            const rows = snap.docs
                .map(d => normalizeUser(d.id, d.data()))
                .sort((a, b) => a.name.localeCompare(b.name))

            setOperationsUsers(rows)
        } catch (error) {
            console.error(error)
            message.error('Could not load HOD / Head users')
        }
    }

    const fetchPrograms = async () => {
        setProgramsLoading(true)
        try {
            const snap = await getDocs(query(collection(db, 'programs')))
            setPrograms(
                snap.docs.map(programDoc => ({
                    id: programDoc.id,
                    ...programDoc.data(),
                    isActive: programDoc.data().isActive !== false
                }))
            )
        } catch (error) {
            console.error(error)
            message.error('Could not load programs')
        } finally {
            setProgramsLoading(false)
        }
    }

    const toggleProgramStatus = async (program: any) => {
        setProgramTogglingId(program.id)
        try {
            const nextValue = program.isActive === false
            await updateDoc(doc(db, 'programs', program.id), { isActive: nextValue })
            setPrograms(prev =>
                prev.map(item =>
                    item.id === program.id ? { ...item, isActive: nextValue } : item
                )
            )
            window.dispatchEvent(
                new CustomEvent('program-availability-changed', {
                    detail: { programId: program.id, isActive: nextValue }
                })
            )
            message.success(
                `${program.name || 'Program'} ${nextValue ? 'activated' : 'deactivated'}`
            )
        } catch (error) {
            console.error(error)
            message.error('Failed to update program status')
        } finally {
            setProgramTogglingId(null)
        }
    }

    const metrics = [
        {
            title: 'Departments',
            value: departments.length,
            icon: <ApartmentOutlined style={{ fontSize: 20, color: '#1677ff' }} />,
            iconBg: '#e6f4ff',
        },
        {
            title: 'Branches',
            value: branches.length,
            icon: <EnvironmentOutlined style={{ fontSize: 20, color: '#722ed1' }} />,
            iconBg: '#f9f0ff',
        }
    ]

    const departmentColumns = [
        { title: 'Department Name', dataIndex: 'name', key: 'name' },
        {
            title: 'Description',
            dataIndex: 'description',
            key: 'description',
            render: (description: string) => <Text>{description}</Text>,
            width: '35%'
        },
        {
            title: 'Contact',
            key: 'contact',
            render: (_: any, record: any) => {
                const headName = record.headName || record.manager || ''
                return (
                    <div>
                        <div style={{ marginBottom: 4 }}>
                            <MailOutlined style={{ color: '#52c41a', marginRight: 8 }} />
                            {record.contactEmail ? (
                                <Text copyable={{ text: record.contactEmail }}>
                                    {record.contactEmail}
                                </Text>
                            ) : (
                                <Text type='secondary'>—</Text>
                            )}
                        </div>

                        {headName ? (
                            <div>
                                <UserOutlined style={{ color: '#1890ff', marginRight: 8 }} />
                                <Text>{headName}</Text>
                            </div>
                        ) : null}
                    </div>
                )
            },
            width: '25%'
        },
        {
            title: 'Actions',
            key: 'actions',
            width: 112,
            render: (_: any, record: any) => (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Button
                        shape='circle'
                        icon={<EditOutlined />}
                        onClick={() => openEdit(record)}
                    />

                    <Popconfirm
                        title='Delete department?'
                        description={`This will permanently delete ${record.name || 'this department'}.`}
                        okText='Delete'
                        cancelText='Cancel'
                        okButtonProps={{
                            danger: true,
                            loading: deletingDepartmentId === record.id
                        }}
                        onConfirm={() => handleDeleteDepartment(record)}
                    >
                        <Button
                            danger
                            shape='circle'
                            icon={<DeleteOutlined />}
                            loading={deletingDepartmentId === record.id}
                        />
                    </Popconfirm>
                </div>
            )
        }
    ]

    const filteredDepartments = useMemo(() => {
        const keyword = departmentSearch.trim().toLowerCase()
        if (!keyword) return departments

        return departments.filter(item =>
            [
                item.name,
                item.description,
                item.headName,
                item.manager,
                item.contactEmail
            ]
                .filter(Boolean)
                .some(value => String(value).toLowerCase().includes(keyword))
        )
    }, [departments, departmentSearch])

    const filteredPrograms = useMemo(() => {
        const keyword = programSearch.trim().toLowerCase()
        if (!keyword) return programs

        return programs.filter(program =>
            [program.name, program.description, program.code]
                .filter(Boolean)
                .some(value => String(value).toLowerCase().includes(keyword))
        )
    }, [programs, programSearch])

    const segmentControl = (
        <Segmented
            block
            options={[
                { label: 'Departments', value: 'department' },
                { label: 'Branches', value: 'branch' },
                ...(isSystemAdmin
                    ? [
                        { label: 'Program Settings', value: 'programs' },
                        { label: 'Agreement Templates', value: 'agreements' }
                    ]
                    : [])
            ]}
            value={activeSegment}
            onChange={value => setActiveSegment(value as SegmentKey)}
        />
    )

    const openEdit = (record: any) => {
        setEditingRecord(record)

        const explicitHeadId = String(
            record.headUserId || record.hodUserId || record.managerId || ''
        ).trim()

        const matchedHead = operationsUsers.find(candidate => {
            if (explicitHeadId && candidate.id === explicitHeadId) return true
            if (record.contactEmail && candidate.email) {
                return candidate.email.toLowerCase() === String(record.contactEmail).toLowerCase()
            }
            if (record.headName || record.manager) {
                return candidate.name.toLowerCase() ===
                    String(record.headName || record.manager).trim().toLowerCase()
            }
            return false
        })

        form.setFieldsValue({
            ...record,
            headUserId: matchedHead?.id || undefined,
            contactEmail: matchedHead?.email || record.contactEmail || ''
        })
        setModalVisible(true)
    }

    const openAdd = () => {
        setEditingRecord(null)
        form.resetFields()
        form.setFieldsValue({ isMain: false })
        setModalVisible(true)
    }

    const closeDepartmentModal = () => {
        setModalVisible(false)
        setEditingRecord(null)
        form.resetFields()
    }

    const handleHeadChange = (headUserId?: string) => {
        if (!headUserId) {
            form.setFieldsValue({
                headUserId: undefined,
                contactEmail: ''
            })
            return
        }

        const selected = operationsUsers.find(item => item.id === headUserId)
        form.setFieldsValue({
            headUserId,
            contactEmail: selected?.email || ''
        })
    }

    const handleDeleteDepartment = async (record: any) => {
        if (!record?.id) return

        setDeletingDepartmentId(record.id)
        try {
            await deleteDoc(doc(db, 'departments', record.id))
            setDepartments(prev => prev.filter(item => item.id !== record.id))
            message.success('Department deleted successfully')
        } catch (error) {
            console.error(error)
            message.error('Failed to delete department')
        } finally {
            setDeletingDepartmentId(null)
        }
    }

    const handleFinish = async (values: any) => {
        setLoading(true)
        try {
            const selectedHead = values.headUserId
                ? operationsUsers.find(item => item.id === values.headUserId)
                : undefined

            const departmentValues = {
                name: String(values.name || '').trim(),
                description: String(values.description || '').trim(),
                isMain: Boolean(values.isMain),
                headUserId: selectedHead?.id || null,
                headName: selectedHead?.name || null,
                contactEmail: String(values.contactEmail || '').trim(),
                createdAt: editingRecord?.createdAt || new Date().toISOString()
            }

            if (editingRecord) {
                await updateDoc(doc(db, 'departments', editingRecord.id), {
                    ...departmentValues,
                    manager: deleteField(),
                    managerId: deleteField(),
                    hodUserId: deleteField(),
                    isTraining: deleteField()
                })
                message.success('Department updated successfully')
            } else {
                await addDoc(collection(db, 'departments'), departmentValues)
                message.success('Department created successfully')
            }

            await fetchAll()
            closeDepartmentModal()
        } catch (error) {
            console.error(error)
            message.error('Failed to save department')
        } finally {
            setLoading(false)
        }
    }

    return (
        <div style={{ padding: 24, minHeight: '100vh' }}>
            <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
                {metrics.map((metric, index) => (
                    <Col key={metric.title} xs={24} sm={24} md={12} lg={12} xl={12}>
                        <MotionCard.Metric
                            icon={metric.icon}
                            iconBg={metric.iconBg}
                            title={metric.title}
                            value={metric.value}
                        />
                    </Col>
                ))}
            </Row>

            <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
            >
                {activeSegment === 'department' ? (
                    <MotionCard
                        filterBar={
                            <Row gutter={12} wrap={false} style={{ width: '100%' }}>
                                <Col span={8}>
                                    {segmentControl}
                                </Col>

                                <Col span={8}>
                                    <Input.Search
                                        placeholder='Search departments'
                                        value={departmentSearch}
                                        onChange={event => setDepartmentSearch(event.target.value)}
                                        onSearch={setDepartmentSearch}
                                        style={{ width: '100%' }}
                                        allowClear
                                    />
                                </Col>

                                <Col span={8}>
                                    <Button
                                        block
                                        type='primary'
                                        icon={<PlusOutlined />}
                                        onClick={openAdd}
                                    >
                                        Add Department
                                    </Button>
                                </Col>
                            </Row>
                        }
                    >
                        {loading ? (
                            <Skeleton
                                active
                                title={false}
                                paragraph={{ rows: 8, width: '100%' }}
                            />
                        ) : (
                            <Table
                                columns={departmentColumns}
                                dataSource={filteredDepartments}
                                rowKey='id'
                                pagination={{
                                    pageSize: 8,
                                    showSizeChanger: false,
                                    position: ['bottomCenter']
                                }}
                            />
                        )}
                    </MotionCard>
                ) : activeSegment === 'branch' ? (
                    <BranchManagement filterBarLeading={segmentControl} />
                ) : activeSegment === 'programs' && isSystemAdmin ? (
                    <MotionCard
                        filterBar={
                            <Row gutter={12} wrap={false} style={{ width: '100%' }}>
                                <Col span={8}>
                                    {segmentControl}
                                </Col>

                                <Col span={8}>
                                    <Input.Search
                                        placeholder='Search programs'
                                        value={programSearch}
                                        onChange={event => setProgramSearch(event.target.value)}
                                        onSearch={setProgramSearch}
                                        style={{ width: '100%' }}
                                        allowClear
                                    />
                                </Col>

                                <Col span={8}>
                                    <Button
                                        block
                                        icon={<SettingOutlined />}
                                        onClick={() => setProgramLimitModalOpen(true)}
                                    >
                                        Program limit: {programLimit}
                                    </Button>
                                </Col>
                            </Row>
                        }
                    >
                        {programsLoading ? (
                            <Skeleton
                                active
                                title={false}
                                paragraph={{ rows: 8, width: '100%' }}
                            />
                        ) : (
                            <Table
                                columns={[
                                    { title: 'Program', dataIndex: 'name', key: 'name' },
                                    {
                                        title: 'Availability',
                                        key: 'status',
                                        render: (_: any, record: any) => (
                                            <span
                                                style={{
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: 8
                                                }}
                                            >
                                                <Switch
                                                    checked={record.isActive !== false}
                                                    loading={programTogglingId === record.id}
                                                    onChange={() => toggleProgramStatus(record)}
                                                />
                                                <Text>
                                                    {record.isActive !== false
                                                        ? 'Available'
                                                        : 'Deactivated'}
                                                </Text>
                                            </span>
                                        )
                                    },
                                    {
                                        title: 'Code',
                                        dataIndex: 'code',
                                        key: 'code',
                                        render: (value: string) => value || '—'
                                    },
                                    {
                                        title: 'Description',
                                        dataIndex: 'description',
                                        key: 'description',
                                        render: (value: string) => value || '—'
                                    }
                                ]}
                                dataSource={filteredPrograms}
                                rowKey='id'
                                pagination={{
                                    pageSize: 8,
                                    showSizeChanger: false,
                                    position: ['bottomCenter']
                                }}
                            />
                        )}
                    </MotionCard>
                ) : activeSegment === 'agreements' && isSystemAdmin ? (
                    <MotionCard filterBar={segmentControl}>
                        <AgreementTemplatesManager canManage={isSystemAdmin} />
                    </MotionCard>
                ) : null}
            </motion.div>

            <Modal
                open={programLimitModalOpen}
                title='Maximum programs'
                okText='Save limit'
                confirmLoading={programLimitLoading}
                onOk={async () => {
                    await handleSaveProgramLimit()
                    setProgramLimitModalOpen(false)
                }}
                onCancel={() => setProgramLimitModalOpen(false)}
                centered
            >
                <Text type='secondary'>
                    Set the maximum number of programs that can be created for this organization.
                </Text>
                <InputNumber
                    min={1}
                    precision={0}
                    value={programLimit}
                    onChange={value => setProgramLimit(value ?? DEFAULT_PROGRAM_LIMIT)}
                    style={{ width: '100%', marginTop: 16 }}
                />
            </Modal>

            <Modal
                open={modalVisible}
                title={editingRecord ? 'Edit Department' : 'Add Department'}
                onCancel={closeDepartmentModal}
                footer={null}
                centered
            >
                <Form layout='vertical' form={form} onFinish={handleFinish}>
                    <Form.Item
                        name='name'
                        label='Department Name'
                        rules={[{ required: true, message: 'Please enter a department name' }]}
                    >
                        <Input placeholder='e.g. Finance, Operations' />
                    </Form.Item>

                    <Form.Item
                        label='Description'
                        name='description'
                        rules={[
                            {
                                required: true,
                                message: 'Please enter department description'
                            },
                            {
                                min: 10,
                                message: 'Description must be at least 10 characters'
                            },
                            {
                                max: 500,
                                message: 'Description cannot exceed 500 characters'
                            }
                        ]}
                    >
                        <TextArea
                            placeholder="Describe the department's role and responsibilities"
                            rows={3}
                            showCount
                            maxLength={500}
                        />
                    </Form.Item>

                    <Row gutter={16}>
                        <Col xs={24} md={12}>
                            <Form.Item label='HOD / Head (Optional)' name='headUserId'>
                                <Select
                                    allowClear
                                    showSearch
                                    optionFilterProp='label'
                                    placeholder='Select an operations user'
                                    onChange={handleHeadChange}
                                    options={operationsUsers.map(item => ({
                                        label: item.email
                                            ? `${item.name} — ${item.email}`
                                            : `${item.name} — No email`,
                                        value: item.id,
                                        disabled: !item.email
                                    }))}
                                />
                            </Form.Item>
                        </Col>

                        <Col xs={24} md={12}>
                            <Form.Item
                                label='Contact Email'
                                name='contactEmail'
                                rules={[
                                    { required: true, message: 'Please enter contact email' },
                                    {
                                        type: 'email',
                                        message: 'Please enter a valid email address'
                                    }
                                ]}
                            >
                                <Input
                                    disabled={Boolean(selectedHeadUserId)}
                                    placeholder={
                                        selectedHeadUserId
                                            ? 'Filled from selected HOD / Head'
                                            : 'department@company.com'
                                    }
                                    prefix={<MailOutlined style={{ color: '#f5222d' }} />}
                                    maxLength={100}
                                />
                            </Form.Item>
                        </Col>
                    </Row>

                    <Form.Item style={{ marginTop: 24 }}>
                        <Row gutter={12}>
                            <Col span={12}>
                                <Button
                                    block
                                    danger
                                    icon={<CloseOutlined />}
                                    onClick={closeDepartmentModal}
                                >
                                    Cancel
                                </Button>
                            </Col>
                            <Col span={12}>
                                <Button
                                    block
                                    type='primary'
                                    htmlType='submit'
                                    loading={loading}
                                    icon={editingRecord ? <EditOutlined /> : <PlusOutlined />}
                                >
                                    {editingRecord ? 'Update Department' : 'Create Department'}
                                </Button>
                            </Col>
                        </Row>
                    </Form.Item>
                </Form>
            </Modal>
        </div>
    )
}

export default SystemSetupForm
