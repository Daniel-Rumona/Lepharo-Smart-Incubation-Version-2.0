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
    Typography,
    Card
} from 'antd'
import {
    PlusOutlined,
    EditOutlined,
    DeleteOutlined,
    ReloadOutlined,
    FilePdfOutlined,
    FileProtectOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { QualityObjectiveForm } from './QualityObjectiveForm'
import { qualityObjectiveService } from '@/services/qualityObjectiveService'
import { downloadQualityObjectivePDF } from '@/services/qualityObjectivePdfService'
import { departmentService } from '@/services/departmentService'
import { QualityObjective, QualityObjectiveFormData, Department } from '@/types/types'
import { useFullIdentity } from '@/hooks/useFullIdentity'

const { Search } = Input
const { Title, Text } = Typography

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
                qo.objectiveText?.toLowerCase().includes(search)
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

    const columns = [
        {
            title: 'Department',
            dataIndex: 'departmentName',
            key: 'departmentName',
            render: (name: string) => <Text strong>{name}</Text>,
            width: '18%'
        },
        {
            title: 'Reference No.',
            dataIndex: 'referenceNumber',
            key: 'referenceNumber',
            width: '12%',
            render: (ref: string, record: QualityObjective) => (
                <Space direction='vertical' size={0}>
                    <Text>{ref}</Text>
                    <Tag color='blue'>Objective {record.objectiveNumber}</Tag>
                </Space>
            )
        },
        {
            title: 'Quality Objective',
            dataIndex: 'objectiveText',
            key: 'objectiveText',
            render: (text: string) => (
                <Text ellipsis={{ tooltip: text }} style={{ maxWidth: 360, display: 'inline-block' }}>
                    {text}
                </Text>
            ),
            width: '35%'
        },
        {
            title: 'Period',
            key: 'period',
            width: '15%',
            render: (_: any, record: QualityObjective) => (
                <Text>
                    {record.periodStart ? dayjs(record.periodStart).format('DD MMM YYYY') : '-'}
                    {' – '}
                    {record.periodEnd ? dayjs(record.periodEnd).format('DD MMM YYYY') : '-'}
                </Text>
            )
        },
        {
            title: 'Steps',
            key: 'steps',
            width: '8%',
            render: (_: any, record: QualityObjective) => <Tag>{record.steps?.length || 0}</Tag>
        },
        {
            title: 'Actions',
            key: 'actions',
            width: '12%',
            render: (_: any, record: QualityObjective) => (
                <Space size='small'>
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
        <div>
            <Card>
                <div style={{ marginBottom: 16 }}>
                    <Title level={3}>
                        <FileProtectOutlined style={{ marginRight: 8 }} />
                        Quality Objectives
                    </Title>
                    <Text type='secondary'>
                        Define each department's yearly quality objectives, steps, responsible persons, and
                        target/completion dates (LEP-QMS 024 F). Directors and HR manage these centrally.
                    </Text>
                </div>

                <div
                    style={{
                        marginBottom: 16,
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        flexWrap: 'wrap',
                        gap: 16
                    }}
                >
                    <Space wrap>
                        <Button type='primary' icon={<PlusOutlined />} onClick={() => showModal()}>
                            Add Quality Objective
                        </Button>
                        <Button icon={<ReloadOutlined />} onClick={fetchObjectives} loading={loading}>
                            Refresh
                        </Button>
                    </Space>

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
                </div>

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
                    scroll={{ x: 1100 }}
                />

                <Modal
                    title={isEditMode ? 'Edit Quality Objective' : 'Add Quality Objective'}
                    open={isModalVisible}
                    onCancel={handleCancel}
                    footer={null}
                    maskClosable={false}
                    width={960}
                    destroyOnClose
                >
                    <QualityObjectiveForm
                        initialValues={current}
                        onSubmit={handleSubmit}
                        onCancel={handleCancel}
                        isEditMode={isEditMode}
                    />
                </Modal>
            </Card>
        </div>
    )
}
