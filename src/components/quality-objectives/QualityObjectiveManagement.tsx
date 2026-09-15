import React, { useEffect, useState } from 'react'
import {
    Table,
    Button,
    Modal,
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
    FilePdfOutlined,
    EyeOutlined,
    FileProtectOutlined,
    ApartmentOutlined,
    CheckCircleOutlined,
    ThunderboltOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { QualityObjectiveForm } from './QualityObjectiveForm'
import { QualityObjectiveDetail } from './QualityObjectiveDetail'
import { qualityObjectiveService } from '@/services/qualityObjectiveService'
import { downloadQualityObjectivePDF } from '@/services/qualityObjectivePdfService'
import { departmentService } from '@/services/departmentService'
import {
    QualityObjective,
    QualityObjectiveFormData,
    Department,
    getRatingMeta,
    SMART_CRITERIA_META
} from '@/types/types'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { MetricsGrid, type DashboardMetric } from '@/components/dashboards/metrics/MetricsGrid'

const { Search } = Input
const { Text } = Typography

export const QualityObjectiveManagement: React.FC = () => {
    const { user } = useFullIdentity()

    const [objectives, setObjectives] = useState<QualityObjective[]>([])
    const [filtered, setFiltered] = useState<QualityObjective[]>([])
    const [departments, setDepartments] = useState<Department[]>([])
    const [loading, setLoading] = useState(true)
    const [isModalVisible, setIsModalVisible] = useState(false)
    const [isEditMode, setIsEditMode] = useState(false)
    const [current, setCurrent] = useState<QualityObjective | null>(null)
    const [searchText, setSearchText] = useState('')
    const [departmentFilter, setDepartmentFilter] = useState<string | undefined>(undefined)
    const [printingId, setPrintingId] = useState<string | null>(null)
    const [viewing, setViewing] = useState<QualityObjective | null>(null)

    const fetchObjectives = async () => {
        try {
            setLoading(true)
            const data = await qualityObjectiveService.getQualityObjectives()
            setObjectives(data)
            setFiltered(data)
        } catch (error) {
            console.error('Error fetching quality objectives:', error)
            message.error(error instanceof Error ? error.message : 'Failed to fetch quality objectives')
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
        fetchObjectives()
        fetchDepartments()
    }, [])

    useEffect(() => {
        const search = searchText.toLowerCase()
        const result = objectives.filter(qo => {
            const matchesSearch =
                !search ||
                qo.departmentName?.toLowerCase().includes(search) ||
                qo.referenceNumber?.toLowerCase().includes(search) ||
                qo.objectiveText?.toLowerCase().includes(search) ||
                qo.kpaName?.toLowerCase().includes(search)
            const matchesDepartment = !departmentFilter || qo.departmentId === departmentFilter
            return matchesSearch && matchesDepartment
        })
        setFiltered(result)
    }, [searchText, departmentFilter, objectives])

    const showModal = (edit: boolean = false, objective: QualityObjective | null = null) => {
        setIsEditMode(edit)
        setCurrent(objective)
        setIsModalVisible(true)
    }

    const handleCancel = () => {
        setIsModalVisible(false)
        setCurrent(null)
    }

    const handleSubmit = async (values: QualityObjectiveFormData) => {
        try {
            if (isEditMode && current) {
                await qualityObjectiveService.updateQualityObjective(current.id, values)
                message.success('Quality objective updated successfully!')
            } else {
                await qualityObjectiveService.createQualityObjective(values)
                message.success('Quality objective created successfully!')
            }
            setIsModalVisible(false)
            setCurrent(null)
            await fetchObjectives()
        } catch (error: any) {
            message.error(error.message || 'Operation failed')
        }
    }

    const handleDelete = async (id: string) => {
        try {
            await qualityObjectiveService.deleteQualityObjective(id)
            message.success('Quality objective deleted successfully!')
            await fetchObjectives()
        } catch (error: any) {
            message.error(error.message || 'Failed to delete quality objective')
        }
    }

    const handlePrint = async (objective: QualityObjective) => {
        try {
            setPrintingId(objective.id)
            await downloadQualityObjectivePDF(objective)
        } catch (error: any) {
            console.error('Error generating quality objective PDF:', error)
            message.error(error.message || 'Failed to generate PDF')
        } finally {
            setPrintingId(null)
        }
    }

    const departmentsCovered = new Set(objectives.map(o => o.departmentId)).size
    const ratedCount = objectives.filter(o => !!o.overallRating).length
    const fullySmartCount = objectives.filter(o => o.smart && SMART_CRITERIA_META.every(c => o.smart[c.key])).length

    const metricCards: DashboardMetric[] = [
        {
            key: 'total-objectives',
            title: 'Quality Objectives',
            value: objectives.length,
            subtitle: 'Across all departments',
            important: true,
            icon: <FileProtectOutlined style={{ color: '#1677ff' }} />,
            iconBg: 'rgba(22,119,255,.12)'
        },
        {
            key: 'departments-covered',
            title: 'Departments Covered',
            value: `${departmentsCovered} / ${departments.length}`,
            subtitle: 'Have at least one objective',
            important: true,
            icon: <ApartmentOutlined style={{ color: '#722ed1' }} />,
            iconBg: 'rgba(114,46,209,.12)'
        },
        {
            key: 'rated',
            title: 'Rated',
            value: ratedCount,
            subtitle: `${objectives.length - ratedCount} awaiting a rating`,
            icon: <CheckCircleOutlined style={{ color: '#52c41a' }} />,
            iconBg: 'rgba(82,196,26,.12)'
        },
        {
            key: 'fully-smart',
            title: 'Fully SMART',
            value: fullySmartCount,
            subtitle: 'Meet all 5 SMART criteria',
            icon: <ThunderboltOutlined style={{ color: '#faad14' }} />,
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
            title: 'Objective',
            key: 'objective',
            width: '38%',
            render: (_: any, record: QualityObjective) => (
                <Space direction='vertical' size={0} style={{ maxWidth: '100%' }}>
                    <Space size={6} wrap>
                        <Text strong>{record.referenceNumber}</Text>
                        <Tag color='blue'>Objective {record.objectiveNumber}</Tag>
                    </Space>
                    <Text ellipsis={{ tooltip: record.objectiveText }} style={{ maxWidth: 380, display: 'inline-block' }}>
                        {record.objectiveText}
                    </Text>
                </Space>
            )
        },
        {
            title: 'Period',
            key: 'period',
            width: '18%',
            render: (_: any, record: QualityObjective) => (
                <Text>
                    {record.periodStart ? dayjs(record.periodStart).format('DD MMM YYYY') : '-'}
                    {' – '}
                    {record.periodEnd ? dayjs(record.periodEnd).format('DD MMM YYYY') : '-'}
                </Text>
            )
        },
        {
            title: 'Rating',
            key: 'rating',
            width: '12%',
            render: (_: any, record: QualityObjective) => {
                const meta = getRatingMeta(record.overallRating)
                return meta ? (
                    <Tooltip title={meta.description}>
                        <Tag color={meta.color}>{meta.shortLabel}</Tag>
                    </Tooltip>
                ) : (
                    <Tag>Not rated</Tag>
                )
            }
        },
        {
            title: 'Actions',
            key: 'actions',
            width: '12%',
            render: (_: any, record: QualityObjective) => (
                <Space size='small'>
                    <Tooltip title='View'>
                        <Button
                            type='text'
                            icon={<EyeOutlined />}
                            onClick={() => setViewing(record)}
                            size='small'
                        />
                    </Tooltip>
                    <Tooltip title='Print / Export PDF'>
                        <Button
                            type='text'
                            icon={<FilePdfOutlined />}
                            loading={printingId === record.id}
                            onClick={() => handlePrint(record)}
                            size='small'
                        />
                    </Tooltip>
                    <Tooltip title='Edit'>
                        <Button
                            type='text'
                            icon={<EditOutlined />}
                            onClick={() => showModal(true, record)}
                            size='small'
                        />
                    </Tooltip>
                    <Popconfirm
                        title='Delete Quality Objective'
                        description='Are you sure you want to delete this quality objective? This action cannot be undone.'
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
                                placeholder='Search by department, reference no, or objective'
                                value={searchText}
                                onChange={e => setSearchText(e.target.value)}
                                onSearch={setSearchText}
                                style={{ width: 320 }}
                                allowClear
                            />
                        </Space>

                        <Space wrap>
                            <Button type='primary' icon={<PlusOutlined />} onClick={() => showModal()}>
                                Add Quality Objective
                            </Button>
                            <Button icon={<ReloadOutlined />} onClick={fetchObjectives} loading={loading}>
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
                        showTotal: total => `Total ${total} quality objectives`
                    }}
                    scroll={{ x: 900 }}
                />
            </MotionCard>

            <Modal
                title={isEditMode ? 'Edit Quality Objective' : 'Add Quality Objective'}
                open={isModalVisible}
                onCancel={handleCancel}
                footer={null}
                maskClosable={false}
                width={960}
                centered
                destroyOnClose
            >
                <QualityObjectiveForm
                    initialValues={current}
                    onSubmit={handleSubmit}
                    onCancel={handleCancel}
                    isEditMode={isEditMode}
                />
            </Modal>

            <QualityObjectiveDetail
                objective={viewing}
                open={!!viewing}
                onClose={() => setViewing(null)}
                onEdit={objective => {
                    setViewing(null)
                    showModal(true, objective)
                }}
                onPrint={handlePrint}
                printing={!!viewing && printingId === viewing.id}
            />
        </div>
    )
}
