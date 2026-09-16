import React, { useEffect, useState } from 'react'
import {
    Table,
    Button,
    Space,
    Tooltip,
    Popconfirm,
    message,
    Input,
    Select,
    Tag,
    Typography
} from 'antd'
import {
    PlusOutlined,
    EditOutlined,
    DeleteOutlined,
    ReloadOutlined,
    EyeOutlined,
    FileProtectOutlined,
    ApartmentOutlined,
    CheckCircleOutlined,
    AimOutlined
} from '@ant-design/icons'
import { KpiAgreementFormModal } from './KpiAgreementFormModal'
import { KpiAgreementDetail } from './KpiAgreementDetail'
import { kpiAgreementService } from '@/services/kpiAgreementService'
import { departmentService } from '@/services/departmentService'
import { KpiAgreement, KpiAgreementFormData, Department } from '@/types/types'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { MetricsGrid, type DashboardMetric } from '@/components/dashboards/metrics/MetricsGrid'

const { Search } = Input
const { Text } = Typography

const isFullySigned = (agreement: KpiAgreement) =>
    !!agreement.signOff?.hod?.name?.trim() &&
    !!agreement.signOff?.centerManager?.name?.trim() &&
    !!agreement.signOff?.ceo?.name?.trim()

export const KpiAgreementManagement: React.FC = () => {
    const [agreements, setAgreements] = useState<KpiAgreement[]>([])
    const [filtered, setFiltered] = useState<KpiAgreement[]>([])
    const [departments, setDepartments] = useState<Department[]>([])
    const [loading, setLoading] = useState(true)
    const [isFormOpen, setIsFormOpen] = useState(false)
    const [editing, setEditing] = useState<KpiAgreement | null>(null)
    const [viewing, setViewing] = useState<KpiAgreement | null>(null)
    const [searchText, setSearchText] = useState('')
    const [departmentFilter, setDepartmentFilter] = useState<string | undefined>(undefined)

    const fetchAgreements = async () => {
        try {
            setLoading(true)
            const data = await kpiAgreementService.getKpiAgreements()
            setAgreements(data)
            setFiltered(data)
        } catch (error) {
            console.error('Error fetching KPI agreements:', error)
            message.error(error instanceof Error ? error.message : 'Failed to fetch KPI agreements')
        } finally {
            setLoading(false)
        }
    }

    const fetchDepartments = async () => {
        try {
            const data = await departmentService.getDepartments()
            setDepartments(data)
        } catch (error) {
            console.error('Error fetching departments:', error)
        }
    }

    useEffect(() => {
        fetchAgreements()
        fetchDepartments()
    }, [])

    useEffect(() => {
        const search = searchText.toLowerCase()
        const result = agreements.filter(a => {
            const matchesSearch =
                !search ||
                a.departmentName?.toLowerCase().includes(search) ||
                a.serviceName?.toLowerCase().includes(search) ||
                a.fyLabel?.toLowerCase().includes(search)
            const matchesDepartment = !departmentFilter || a.departmentId === departmentFilter
            return matchesSearch && matchesDepartment
        })
        setFiltered(result)
    }, [searchText, departmentFilter, agreements])

    const openCreate = () => {
        setEditing(null)
        setIsFormOpen(true)
    }

    const openEdit = (agreement: KpiAgreement) => {
        setViewing(null)
        setEditing(agreement)
        setIsFormOpen(true)
    }

    const closeForm = () => {
        setIsFormOpen(false)
        setEditing(null)
    }

    const handleSave = async (values: KpiAgreementFormData) => {
        try {
            if (editing) {
                await kpiAgreementService.updateKpiAgreement(editing.id, values)
                message.success('KPI agreement updated successfully!')
            } else {
                await kpiAgreementService.createKpiAgreement(values)
                message.success('KPI agreement saved successfully!')
            }
            closeForm()
            await fetchAgreements()
        } catch (error: any) {
            message.error(error.message || 'Operation failed')
        }
    }

    const handleDelete = async (id: string) => {
        try {
            await kpiAgreementService.deleteKpiAgreement(id)
            message.success('KPI agreement deleted successfully!')
            await fetchAgreements()
        } catch (error: any) {
            message.error(error.message || 'Failed to delete KPI agreement')
        }
    }

    const departmentsCovered = new Set(agreements.map(a => a.departmentId)).size
    const fullySignedCount = agreements.filter(isFullySigned).length
    const totalTargetsTracked = agreements.reduce(
        (sum, a) => sum + (a.numericTargets?.length || 0) + (a.deliverables?.length || 0),
        0
    )

    const metricCards: DashboardMetric[] = [
        {
            key: 'total-agreements',
            title: 'KPI Agreements',
            value: agreements.length,
            subtitle: 'Across all departments',
            important: true,
            icon: <FileProtectOutlined style={{ color: '#1677ff' }} />,
            iconBg: 'rgba(22,119,255,.12)'
        },
        {
            key: 'departments-covered',
            title: 'Departments Covered',
            value: `${departmentsCovered} / ${departments.length}`,
            subtitle: 'Have at least one agreement',
            important: true,
            icon: <ApartmentOutlined style={{ color: '#722ed1' }} />,
            iconBg: 'rgba(114,46,209,.12)'
        },
        {
            key: 'fully-signed',
            title: 'Fully Signed',
            value: fullySignedCount,
            subtitle: `${agreements.length - fullySignedCount} awaiting sign-off`,
            icon: <CheckCircleOutlined style={{ color: '#52c41a' }} />,
            iconBg: 'rgba(82,196,26,.12)'
        },
        {
            key: 'targets-tracked',
            title: 'Targets Tracked',
            value: totalTargetsTracked,
            subtitle: 'Numeric targets + deliverables',
            icon: <AimOutlined style={{ color: '#faad14' }} />,
            iconBg: 'rgba(250,173,20,.12)'
        }
    ]

    const columns = [
        {
            title: 'Department',
            dataIndex: 'departmentName',
            key: 'departmentName',
            render: (name: string) => <Text strong>{name}</Text>,
            width: '20%'
        },
        {
            title: 'Agreement',
            key: 'agreement',
            width: '38%',
            render: (_: any, record: KpiAgreement) => (
                <Space direction='vertical' size={0} style={{ maxWidth: '100%' }}>
                    <Text ellipsis={{ tooltip: record.serviceName }} style={{ maxWidth: 380, display: 'inline-block' }}>
                        {record.serviceName || '-'}
                    </Text>
                    <Tag color='blue'>{record.fyLabel || 'FY not set'}</Tag>
                </Space>
            )
        },
        {
            title: 'Targets',
            key: 'targets',
            width: '18%',
            render: (_: any, record: KpiAgreement) => (
                <Space size={4} wrap>
                    {record.numericTargets?.length > 0 && <Tag>{record.numericTargets.length} numeric</Tag>}
                    {record.deliverables?.length > 0 && <Tag>{record.deliverables.length} deliverables</Tag>}
                    {!record.numericTargets?.length && !record.deliverables?.length && <Tag>None yet</Tag>}
                </Space>
            )
        },
        {
            title: 'Sign-off',
            key: 'signOff',
            width: '12%',
            render: (_: any, record: KpiAgreement) => (
                <Tag color={isFullySigned(record) ? 'green' : 'orange'}>
                    {isFullySigned(record) ? 'Fully signed' : 'Pending'}
                </Tag>
            )
        },
        {
            title: 'Actions',
            key: 'actions',
            width: '12%',
            render: (_: any, record: KpiAgreement) => (
                <Space size='small'>
                    <Tooltip title='View'>
                        <Button type='text' icon={<EyeOutlined />} onClick={() => setViewing(record)} size='small' />
                    </Tooltip>
                    <Tooltip title='Edit'>
                        <Button type='text' icon={<EditOutlined />} onClick={() => openEdit(record)} size='small' />
                    </Tooltip>
                    <Popconfirm
                        title='Delete KPI Agreement'
                        description='Are you sure you want to delete this KPI agreement? This action cannot be undone.'
                        onConfirm={() => handleDelete(record.id)}
                        okText='Yes'
                        cancelText='No'
                        okButtonProps={{ danger: true }}
                    >
                        <Tooltip title='Delete'>
                            <Button type='text' icon={<DeleteOutlined />} danger size='small' />
                        </Tooltip>
                    </Popconfirm>
                </Space>
            )
        }
    ]

    return (
        <div style={{ padding: '12px 24px 24px' }}>
            <MetricsGrid metrics={metricCards} />

            <div style={{ height: 16 }} />

            <MotionCard
                filterBarProps={{ marginBottom: 16, padding: 14 }}
                filterBar={
                    <div
                        style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: 12
                        }}
                    >
                        <Space wrap>
                            <Select
                                placeholder='Filter by department'
                                allowClear
                                style={{ width: 220 }}
                                value={departmentFilter}
                                onChange={setDepartmentFilter}
                                options={departments.map(d => ({ value: d.id, label: d.name }))}
                            />
                            <Search
                                placeholder='Search by department, service, or FY'
                                value={searchText}
                                onChange={e => setSearchText(e.target.value)}
                                onSearch={setSearchText}
                                style={{ width: 320 }}
                                allowClear
                            />
                        </Space>

                        <Space wrap>
                            <Button type='primary' icon={<PlusOutlined />} onClick={openCreate}>
                                Import KPI Agreement
                            </Button>
                            <Button icon={<ReloadOutlined />} onClick={fetchAgreements} loading={loading}>
                                Refresh
                            </Button>
                        </Space>
                    </div>
                }
            >
                <Table
                    dataSource={filtered}
                    columns={columns}
                    rowKey='id'
                    loading={loading}
                    pagination={{
                        pageSize: 10,
                        showSizeChanger: true,
                        pageSizeOptions: ['10', '20', '50'],
                        showTotal: total => `Total ${total} KPI agreements`
                    }}
                    scroll={{ x: 900 }}
                />
            </MotionCard>

            <KpiAgreementFormModal
                open={isFormOpen}
                onClose={closeForm}
                onSaved={handleSave}
                initialValues={editing}
            />

            <KpiAgreementDetail
                agreement={viewing}
                open={!!viewing}
                onClose={() => setViewing(null)}
                onEdit={openEdit}
            />
        </div>
    )
}
