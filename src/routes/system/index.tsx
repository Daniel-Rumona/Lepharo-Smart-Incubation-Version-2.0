import React, { useEffect, useMemo, useState } from 'react'
import {
    Row,
    Col,
    Grid,
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
    Tag,
    Popconfirm,
    Popover,
    Skeleton,
    Card,
    Segmented
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
    DeleteOutlined,
    ProjectOutlined,
    FileProtectOutlined,
    BranchesOutlined,
    TagsOutlined,
    SearchOutlined
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
import { Helmet } from 'react-helmet'
import { AdminKpiTile } from '@/components/admin/AdminKpiTile'
import '@/styles/admin-overview.css'
import type { MetricTone } from '@/components/dashboards/metrics/MetricTile'
import {
    DEFAULT_PROGRAM_LIMIT,
    getProgramLimit,
    saveProgramLimit
} from '@/services/systemSettingsService'
import { MobileCardList } from '@/components/shared/MobileCardList'
import '@/components/shared/setup-segmented.css'
import { AgreementTemplatesManager } from '@/components/compliance/AgreementTemplatesManager'
import {
    DEPARTMENT_ROLES,
    type DepartmentRoleKey,
    type DepartmentRoleMap,
    departmentLineage,
    getDepartmentRole,
    saveDepartmentRoles,
    useDepartmentRoles
} from '@/services/departmentRoles'

const { Option } = Select
const { TextArea } = Input
const { Text } = Typography

type SegmentKey = 'department' | 'branch' | 'programs' | 'agreements'

const SEGMENT_ICONS: Record<SegmentKey, React.ReactNode> = {
    department: <ApartmentOutlined />,
    branch: <EnvironmentOutlined />,
    programs: <ProjectOutlined />,
    agreements: <FileProtectOutlined />
}

/** Tab names short enough for a phone, and for the search placeholder. */
const SEGMENT_SHORT: Record<SegmentKey, string> = {
    department: 'Departments',
    branch: 'Branches',
    programs: 'Programs',
    agreements: 'Agreements'
}

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
    const screens = Grid.useBreakpoint()
    const isMobile = !screens.md
    const [activeSegment, setActiveSegment] = useState<SegmentKey>('department')
    const [departments, setDepartments] = useState<any[]>([])
    const [branches, setBranches] = useState<any[]>([])
    const [programs, setPrograms] = useState<any[]>([])
    const [agreementTemplates, setAgreementTemplates] = useState<{ total: number; active: number } | null>(null)
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
    const [agreementSearch, setAgreementSearch] = useState('')
    const [agreementAddSignal, setAgreementAddSignal] = useState(0)
    const [branchSearch, setBranchSearch] = useState('')
    const [branchAddSignal, setBranchAddSignal] = useState(0)
    const [programsLoading, setProgramsLoading] = useState(false)
    const [programTogglingId, setProgramTogglingId] = useState<string | null>(null)
    const [programLimitModalOpen, setProgramLimitModalOpen] = useState(false)
    const [deletingDepartmentId, setDeletingDepartmentId] = useState<string | null>(null)

    const selectedHeadUserId = Form.useWatch('headUserId', form)
    const selectedRoleKey = Form.useWatch('roleKey', form) as DepartmentRoleKey | undefined
    const selectedParentId = Form.useWatch('parentDepartmentId', form) as string | undefined

    const isSystemAdmin = ['system admin', 'system_admin'].includes(
        String(user?.role || '').toLowerCase()
    )
    // The role map (systemSettings/departmentRoles) is writable by these two only; see firestore.rules.
    const canEditRoles = isSystemAdmin || String(user?.role || '').toLowerCase() === 'director'
    const { roles: departmentRoles } = useDepartmentRoles()

    const departmentName = (id?: string | null) => departments.find(d => d.id === id)?.name || ''
    const parentIdOf = (record: any) => String(record?.parentDepartmentId || record?.parentDeptId || '')
    const roleLabel = (key?: string | null) => DEPARTMENT_ROLES.find(r => r.key === key)?.label || ''
    /** The role a department was given directly (not inherited). */
    const ownRoleOf = (id: string) =>
        DEPARTMENT_ROLES.find(r => departmentRoles[r.key] === id)?.key as DepartmentRoleKey | undefined
    /** A department and every department under it, at any depth. */
    const subtreeOf = (id: string) =>
        departments.filter(d => departmentLineage(d.id, departments).includes(id)).map(d => d.id as string)

    useEffect(() => {
        if (identityLoading) return

        void fetchAll()
        void fetchOperationsUsers()
        void loadProgramLimit()

        if (isSystemAdmin) {
            void fetchPrograms()
            void fetchAgreementTemplates()
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

    const fetchAgreementTemplates = async () => {
        try {
            const snap = await getDocs(collection(db, 'agreementTemplates'))
            setAgreementTemplates({
                total: snap.size,
                active: snap.docs.filter(item => item.data().active !== false).length
            })
        } catch (error) {
            console.error(error)
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

    // The toolbar's one search box edits whichever tab is open.
    const activeSearch: [string, (value: string) => void] =
        activeSegment === 'department'
            ? [departmentSearch, setDepartmentSearch]
            : activeSegment === 'branch'
                ? [branchSearch, setBranchSearch]
                : activeSegment === 'programs'
                    ? [programSearch, setProgramSearch]
                    : [agreementSearch, setAgreementSearch]

    const assignedRoleCount = DEPARTMENT_ROLES.filter(r => departmentRoles[r.key]).length
    const withHead = departments.filter(d => d.headUserId || d.hodUserId || d.managerId || d.headName || d.manager).length
    const withCoordinator = branches.filter(b => b.centreCoordinatorUserId).length
    const activePrograms = programs.filter(p => p.isActive !== false).length

    const metrics: Array<{
        key: SegmentKey
        title: string
        value: number
        subtitle: string
        icon: React.ReactNode
        tone: MetricTone
    }> = [
        {
            key: 'department',
            title: 'Departments',
            value: departments.length,
            subtitle: `${withHead} with a head · ${assignedRoleCount}/${DEPARTMENT_ROLES.length} roles assigned`,
            icon: <ApartmentOutlined />,
            tone: 'accent'
        },
        {
            key: 'branch',
            title: 'Branches',
            value: branches.length,
            subtitle: `${withCoordinator} with a centre coordinator`,
            icon: <EnvironmentOutlined />,
            tone: 'info'
        },
        ...(isSystemAdmin
            ? [
                  {
                      key: 'programs' as SegmentKey,
                      title: 'Programs',
                      value: programs.length,
                      subtitle: `${activePrograms} available · ${programs.length - activePrograms} deactivated`,
                      icon: <ProjectOutlined />,
                      tone: 'info' as const
                  },
                  {
                      key: 'agreements' as SegmentKey,
                      title: 'Agreement Templates',
                      value: agreementTemplates?.total ?? 0,
                      subtitle: `${agreementTemplates?.active ?? 0} active`,
                      icon: <FileProtectOutlined />,
                      tone: 'warning' as const
                  }
              ]
            : [])
    ]

    /** The department's own role, or the one it inherits from a parent. */
    const roleCell = (record: any) => {
        const own = ownRoleOf(record.id)
        if (own) return <Tag color='processing' bordered={false}>{roleLabel(own)}</Tag>
        const inherited = getDepartmentRole(record.id, departmentRoles, departments)
        return inherited ? (
            <Tag bordered={false} title='Inherited from its parent department'>
                <BranchesOutlined /> {roleLabel(inherited)}
            </Tag>
        ) : (
            <Text type='secondary'>—</Text>
        )
    }

    const departmentColumns = [
        {
            title: 'Department',
            dataIndex: 'name',
            key: 'name',
            render: (name: string, record: any) => (
                <div style={{ minWidth: 220 }}>
                    <Text strong>{name}</Text>
                    {parentIdOf(record) && (
                        <div>
                            <Text type='secondary' style={{ fontSize: 12 }}>
                                <BranchesOutlined /> Under {departmentName(parentIdOf(record)) || 'a removed department'}
                            </Text>
                        </div>
                    )}
                    {record.description && (
                        <Text type='secondary' style={{ fontSize: 12.5, display: 'block', marginTop: 2 }} ellipsis={{ tooltip: record.description }}>
                            {record.description}
                        </Text>
                    )}
                </div>
            ),
            width: '38%'
        },
        { title: 'Role', key: 'role', render: (_: any, record: any) => roleCell(record), width: 220 },
        {
            title: 'Head and contact',
            key: 'contact',
            render: (_: any, record: any) => {
                const headName = record.headName || record.manager || ''
                return (
                    <div style={{ display: 'grid', gap: 4 }}>
                        <span>
                            <UserOutlined className='admin-muted-icon' />
                            {headName ? <Text>{headName}</Text> : <Text type='secondary'>No head assigned</Text>}
                        </span>
                        <span>
                            <MailOutlined className='admin-muted-icon' />
                            {record.contactEmail ? (
                                <Text copyable={{ text: record.contactEmail }}>{record.contactEmail}</Text>
                            ) : (
                                <Text type='secondary'>—</Text>
                            )}
                        </span>
                    </div>
                )
            }
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
                item.contactEmail,
                roleLabel(getDepartmentRole(item.id, departmentRoles, departments)),
                departmentName(parentIdOf(item))
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
            contactEmail: matchedHead?.email || record.contactEmail || '',
            parentDepartmentId: parentIdOf(record) || undefined,
            roleKey: ownRoleOf(record.id)
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

        // Sub-departments would silently lose their parent (and the role they inherit from it).
        const children = departments.filter(d => parentIdOf(d) === record.id)
        if (children.length) {
            message.error(`Move or delete its sub-departments first: ${children.map(d => d.name || d.id).join(', ')}`)
            return
        }

        setDeletingDepartmentId(record.id)
        try {
            await deleteDoc(doc(db, 'departments', record.id))
            const ownRole = ownRoleOf(record.id)
            if (ownRole && canEditRoles) {
                await saveDepartmentRoles({ ...departmentRoles, [ownRole]: undefined }, user?.name || user?.email || 'System Admin')
            }
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
                parentDepartmentId: values.parentDepartmentId || null,
                createdAt: editingRecord?.createdAt || new Date().toISOString()
            }

            let departmentId: string
            if (editingRecord) {
                departmentId = editingRecord.id
                await updateDoc(doc(db, 'departments', editingRecord.id), {
                    ...departmentValues,
                    manager: deleteField(),
                    managerId: deleteField(),
                    hodUserId: deleteField(),
                    isTraining: deleteField(),
                    // Older spelling of the parent link; parentDepartmentId replaces it.
                    parentDeptId: deleteField()
                })
            } else {
                departmentId = (await addDoc(collection(db, 'departments'), departmentValues)).id
            }

            // A department plays at most one role and a role belongs to one department, so picking a
            // role here also takes it from whichever department held it.
            const nextRole = (values.roleKey || undefined) as DepartmentRoleKey | undefined
            if (canEditRoles && nextRole !== ownRoleOf(departmentId)) {
                const nextRoles: DepartmentRoleMap = { ...departmentRoles }
                DEPARTMENT_ROLES.forEach(r => {
                    if (nextRoles[r.key] === departmentId) delete nextRoles[r.key]
                })
                if (nextRole) nextRoles[nextRole] = departmentId
                await saveDepartmentRoles(nextRoles, user?.name || user?.email || 'System Admin')
            }

            message.success(editingRecord ? 'Department updated successfully' : 'Department created successfully')

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
        <div className='admin-overview'>
            <Helmet>
                <title>System Setup | Smart Incubation</title>
            </Helmet>

            <Row gutter={[16, 16]}>
                {metrics.map(metric => (
                    <Col key={metric.key} xs={12} xl={24 / metrics.length}>
                        <AdminKpiTile
                            compact
                            loading={metric.key === 'programs' ? programsLoading : loading}
                            icon={metric.icon}
                            label={metric.title}
                            value={metric.value}
                            note={isMobile ? undefined : metric.subtitle}
                        />
                    </Col>
                ))}
            </Row>

            <div className='admin-toolbar'>
                <Segmented
                    className='admin-toolbar-tabs'
                    block
                    value={activeSegment}
                    onChange={value => setActiveSegment(value as SegmentKey)}
                    options={metrics.map(metric => ({
                        value: metric.key,
                        label: (
                            <span className='admin-toolbar-tab'>
                                {SEGMENT_ICONS[metric.key]}
                                <span>{isMobile ? SEGMENT_SHORT[metric.key] : metric.title}</span>
                            </span>
                        )
                    }))}
                />
                <Input
                    allowClear
                    className='admin-toolbar-search'
                    prefix={<SearchOutlined />}
                    placeholder={`Search ${SEGMENT_SHORT[activeSegment].toLowerCase()}`}
                    value={activeSearch[0]}
                    onChange={event => activeSearch[1](event.target.value)}
                />
                <div className='admin-toolbar-actions'>
                    {activeSegment === 'department' ? (
                        <>
                            <Popover
                                trigger='click'
                                placement='bottomRight'
                                title='Which department plays each role'
                                content={
                                    <div style={{ display: 'grid', gap: 6, maxWidth: 420 }}>
                                        {DEPARTMENT_ROLES.map(r => (
                                            <div key={r.key} style={{ display: 'flex', justifyContent: 'space-between', gap: 16 }}>
                                                <Text>{r.label}</Text>
                                                {departmentRoles[r.key] ? (
                                                    <Text strong>{departmentName(departmentRoles[r.key]) || 'Removed department'}</Text>
                                                ) : (
                                                    <Text type='secondary'>Unassigned</Text>
                                                )}
                                            </div>
                                        ))}
                                        <Text type='secondary' style={{ fontSize: 12, marginTop: 4 }}>
                                            Set a department’s role from its Edit form.
                                        </Text>
                                    </div>
                                }
                            >
                                <Button icon={<TagsOutlined />}>
                                    Roles {assignedRoleCount}/{DEPARTMENT_ROLES.length}
                                </Button>
                            </Popover>
                            <Button type='primary' icon={<PlusOutlined />} onClick={openAdd}>
                                {isMobile ? 'Add' : 'Add Department'}
                            </Button>
                        </>
                    ) : activeSegment === 'branch' ? (
                        <Button type='primary' icon={<PlusOutlined />} onClick={() => setBranchAddSignal(count => count + 1)}>
                            {isMobile ? 'Add' : 'Add Branch'}
                        </Button>
                    ) : activeSegment === 'programs' ? (
                        <Button icon={<SettingOutlined />} onClick={() => setProgramLimitModalOpen(true)}>
                            Program limit: {programLimit}
                        </Button>
                    ) : (
                        <Button type='primary' icon={<PlusOutlined />} onClick={() => setAgreementAddSignal(count => count + 1)}>
                            {isMobile ? 'Add' : 'Add Agreement'}
                        </Button>
                    )}
                </div>
            </div>

            <motion.div
                key={activeSegment}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.25 }}
            >
                {activeSegment === 'department' ? (
                    <Card className='admin-card' bordered={false}>
                        {loading ? (
                            <Skeleton
                                active
                                title={false}
                                paragraph={{ rows: 8, width: '100%' }}
                            />
                        ) : isMobile ? (
                            <MobileCardList
                                data={filteredDepartments}
                                getKey={(row: any) => row.id}
                                pageSize={8}
                                emptyText='No departments'
                                renderCard={(record: any) => ({
                                    title: record.name || 'Unnamed department',
                                    subtitle: record.contactEmail || undefined,
                                    fields: [
                                        { label: 'Head', value: record.headName || record.manager || '—' },
                                        { label: 'Role', value: roleCell(record) },
                                        ...(parentIdOf(record) ? [{ label: 'Under', value: departmentName(parentIdOf(record)) || '—' }] : [])
                                    ],
                                    note: record.description ? (
                                        <Text type='secondary'>{record.description}</Text>
                                    ) : undefined,
                                    actions: [
                                        <Button key='edit' icon={<EditOutlined />} onClick={() => openEdit(record)}>
                                            Edit
                                        </Button>,
                                        <Popconfirm
                                            key='delete'
                                            title='Delete department?'
                                            description={`This will permanently delete ${record.name || 'this department'}.`}
                                            okText='Delete'
                                            cancelText='Cancel'
                                            okButtonProps={{ danger: true, loading: deletingDepartmentId === record.id }}
                                            onConfirm={() => handleDeleteDepartment(record)}
                                        >
                                            <Button danger icon={<DeleteOutlined />} loading={deletingDepartmentId === record.id}>
                                                Delete
                                            </Button>
                                        </Popconfirm>
                                    ]
                                })}
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
                    </Card>
                ) : activeSegment === 'branch' ? (
                    <Card className='admin-card' bordered={false}>
                        <BranchManagement search={branchSearch} addSignal={branchAddSignal} onChanged={() => void fetchAll()} />
                    </Card>
                ) : activeSegment === 'programs' && isSystemAdmin ? (
                    <Card className='admin-card' bordered={false}>
                        {programsLoading ? (
                            <Skeleton
                                active
                                title={false}
                                paragraph={{ rows: 8, width: '100%' }}
                            />
                        ) : isMobile ? (
                            <MobileCardList
                                data={filteredPrograms}
                                getKey={(row: any) => row.id}
                                pageSize={8}
                                emptyText='No programs'
                                renderCard={(record: any) => ({
                                    title: record.name || 'Unnamed program',
                                    subtitle: record.code || undefined,
                                    badge: (
                                        <Tag color={record.isActive !== false ? 'green' : 'default'}>
                                            {record.isActive !== false ? 'Available' : 'Deactivated'}
                                        </Tag>
                                    ),
                                    note: record.description ? (
                                        <Text type='secondary'>{record.description}</Text>
                                    ) : undefined,
                                    actions: [
                                        <Button
                                            key='toggle'
                                            loading={programTogglingId === record.id}
                                            onClick={() => toggleProgramStatus(record)}
                                        >
                                            {record.isActive !== false ? 'Deactivate' : 'Activate'}
                                        </Button>
                                    ]
                                })}
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
                    </Card>
                ) : activeSegment === 'agreements' && isSystemAdmin ? (
                    <Card className='admin-card' bordered={false}>
                        <AgreementTemplatesManager
                            canManage={isSystemAdmin}
                            search={agreementSearch}
                            addSignal={agreementAddSignal}
                            onChanged={() => void fetchAgreementTemplates()}
                        />
                    </Card>
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
                            <Form.Item
                                label='Parent department (Optional)'
                                name='parentDepartmentId'
                                tooltip='Makes this a sub-department. Without a role of its own it acts in its parent’s role.'
                            >
                                <Select
                                    allowClear
                                    showSearch
                                    optionFilterProp='label'
                                    placeholder='None (top-level department)'
                                    prefix={<BranchesOutlined />}
                                    // Not itself or anything under it, which would make a loop.
                                    options={departments
                                        .filter(d => !editingRecord || !subtreeOf(editingRecord.id).includes(d.id))
                                        .map(d => ({ value: d.id, label: d.name || d.id }))
                                        .sort((a, b) => a.label.localeCompare(b.label))}
                                />
                            </Form.Item>
                        </Col>

                        <Col xs={24} md={12}>
                            <Form.Item
                                label='Role (Optional)'
                                name='roleKey'
                                tooltip='Dashboards, menus and permissions follow the role, so renaming the department changes nothing but its label.'
                                extra={(() => {
                                    if (selectedRoleKey) {
                                        const holder = departmentRoles[selectedRoleKey]
                                        if (holder && holder !== editingRecord?.id) {
                                            return <Text type='warning'>Moves this role from {departmentName(holder) || 'another department'}.</Text>
                                        }
                                        return DEPARTMENT_ROLES.find(r => r.key === selectedRoleKey)?.description
                                    }
                                    const inherited = selectedParentId
                                        ? getDepartmentRole(selectedParentId, departmentRoles, departments)
                                        : null
                                    return inherited ? `Acts as ${roleLabel(inherited)} through its parent.` : undefined
                                })()}
                            >
                                <Select
                                    allowClear
                                    showSearch
                                    optionFilterProp='label'
                                    disabled={!canEditRoles}
                                    placeholder={canEditRoles ? 'No special role' : 'Set by a System Admin or Director'}
                                    prefix={<TagsOutlined />}
                                    popupMatchSelectWidth={false}
                                    options={DEPARTMENT_ROLES.map(r => {
                                        const holder = departmentRoles[r.key]
                                        return {
                                            value: r.key,
                                            label: r.label,
                                            holder: holder && holder !== editingRecord?.id ? departmentName(holder) : ''
                                        }
                                    })}
                                    optionRender={o => (
                                        <div>
                                            <div>{o.data.label}</div>
                                            {o.data.holder && (
                                                <Text type='secondary' style={{ fontSize: 12 }}>
                                                    Currently {o.data.holder}
                                                </Text>
                                            )}
                                        </div>
                                    )}
                                />
                            </Form.Item>
                        </Col>
                    </Row>

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
                                    prefix={<MailOutlined className='admin-muted-icon' />}
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
