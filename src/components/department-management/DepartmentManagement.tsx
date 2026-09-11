import React, { useState, useEffect } from 'react'
import {
    Table,
    Button,
    Modal,
    Space,
    Tooltip,
    Popconfirm,
    message,
    Input,
    Tag,
    Typography,
    Card
} from 'antd'
import {
    PlusOutlined,
    EditOutlined,
    DeleteOutlined,
    ReloadOutlined,
    TeamOutlined,
    MailOutlined,
    UserOutlined
} from '@ant-design/icons'
import { DepartmentForm } from './DepartmentForm'
import { departmentService } from '@/services/departmentService'
import { Department } from '@/types/types'

const { Search } = Input
const { Title, Text } = Typography

export const DepartmentManagement: React.FC = () => {
    const [departments, setDepartments] = useState<Department[]>([])
    const [filteredDepartments, setFilteredDepartments] = useState<Department[]>(
        []
    )
    const [loading, setLoading] = useState(true)
    const [isModalVisible, setIsModalVisible] = useState(false)
    const [isEditMode, setIsEditMode] = useState(false)
    const [currentDepartment, setCurrentDepartment] = useState<Department | null>(
        null
    )
    const [searchText, setSearchText] = useState('')
    const [initializing, setInitializing] = useState(false)

    // Fetch departments
    const fetchDepartments = async () => {
        try {
            setLoading(true)
            console.log('Fetching departments...')
            const departmentData = await departmentService.getAllDepartments()
            console.log('Departments fetched successfully:', departmentData)
            setDepartments(departmentData)
            setFilteredDepartments(departmentData)
        } catch (error) {
            console.error('Error fetching departments:', error)
            const errorMessage =
                error instanceof Error ? error.message : 'Failed to fetch departments'
            message.error(errorMessage)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchDepartments()
    }, [])

    // Filter departments based on search text
    useEffect(() => {
        const filtered = departments.filter(
            department =>
                department.name.toLowerCase().includes(searchText.toLowerCase()) ||
                department.description
                    ?.toLowerCase()
                    .includes(searchText.toLowerCase()) ||
                department.contactEmail
                    ?.toLowerCase()
                    .includes(searchText.toLowerCase())
        )
        setFilteredDepartments(filtered)
    }, [searchText, departments])

    // Handle modal visibility
    const showModal = (
        edit: boolean = false,
        department: Department | null = null
    ) => {
        setIsEditMode(edit)
        setCurrentDepartment(department)
        setIsModalVisible(true)
    }

    const handleCancel = () => {
        setIsModalVisible(false)
        setCurrentDepartment(null)
    }

    // Handle form submission
    const handleSubmit = async (values: any) => {
        try {
            if (isEditMode && currentDepartment) {
                await departmentService.updateDepartment(currentDepartment.id, values)
                message.success('Department updated successfully!')
            } else {
                await departmentService.createDepartment(values)
                message.success('Department created successfully!')
            }

            setIsModalVisible(false)
            setCurrentDepartment(null)
            await fetchDepartments()
        } catch (error: any) {
            message.error(error.message || 'Operation failed')
        }
    }

    // Handle department deletion
    const handleDelete = async (departmentId: string) => {
        try {
            await departmentService.deleteDepartment(departmentId)
            message.success('Department deleted successfully!')
            await fetchDepartments()
        } catch (error: any) {
            message.error(error.message || 'Failed to delete department')
        }
    }

    // Initialize Lepharo departments
    const handleInitializeDepartments = async () => {
        try {
            setInitializing(true)
            await departmentService.initializeLepharoDepartments()
            message.success('Lepharo departments initialized successfully!')
            await fetchDepartments()
        } catch (error: any) {
            message.error(error.message || 'Failed to initialize departments')
        } finally {
            setInitializing(false)
        }
    }

    // Table columns
    const columns = [
        {
            title: 'Department Name',
            dataIndex: 'name',
            key: 'name',
            render: (name: string, record: Department) => (
                <div>
                    <Text strong>{name}</Text>
                    {name.includes('ROM') && (
                        <Tag color='blue' style={{ marginLeft: 8 }}>
                            Core
                        </Tag>
                    )}
                    {record.isTraining && (
                        <Tag color='purple' style={{ marginLeft: 8 }}>
                            Training coverage
                        </Tag>
                    )}
                </div>
            ),
            width: '30%'
        },
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
            render: (text: any, record: Department) => (
                <div>
                    <div style={{ marginBottom: 4 }}>
                        <MailOutlined style={{ color: '#52c41a', marginRight: 8 }} />
                        <Text copyable={{ text: record.contactEmail }}>
                            {record.contactEmail}
                        </Text>
                    </div>
                    {record.manager && (
                        <div>
                            <UserOutlined style={{ color: '#1890ff', marginRight: 8 }} />
                            <Text>{record.manager}</Text>
                        </div>
                    )}
                </div>
            ),
            width: '25%'
        },
        {
            title: 'Actions',
            key: 'actions',
            render: (text: any, record: Department) => (
                <Space size='small'>
                    <Tooltip title='Edit Department'>
                        <Button
                            type='text'
                            icon={<EditOutlined />}
                            onClick={() => showModal(true, record)}
                            size='small'
                        />
                    </Tooltip>

                    <Popconfirm
                        title='Delete Department'
                        description={
                            <div>
                                <p>Are you sure you want to delete this department?</p>
                                <p style={{ color: '#ff4d4f', fontSize: '12px' }}>
                                    This action cannot be undone.
                                </p>
                            </div>
                        }
                        onConfirm={() => handleDelete(record.id)}
                        okText='Yes'
                        cancelText='No'
                        okButtonProps={{ danger: true }}
                    >
                        <Tooltip title='Delete Department'>
                            <Button
                                type='text'
                                icon={<DeleteOutlined />}
                                danger
                                size='small'
                            />
                        </Tooltip>
                    </Popconfirm>
                </Space>
            ),
            width: '10%'
        }
    ]

    return (
        <div>
            <Card>
                <div style={{ marginBottom: 16 }}>
                    <Title level={3}>Department Management</Title>
                    <Text type='secondary'>
                        Manage departments for operations users. Only Operations users are
                        assigned to departments.
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
                        <Button
                            type='primary'
                            icon={<PlusOutlined />}
                            onClick={() => showModal()}
                        >
                            Add Department
                        </Button>

                        <Button
                            icon={<ReloadOutlined />}
                            onClick={fetchDepartments}
                            loading={loading}
                        >
                            Refresh
                        </Button>

                        {departments.length === 0 && !loading && (
                            <Button
                                type='dashed'
                                loading={initializing}
                                onClick={handleInitializeDepartments}
                            >
                                Initialize Lepharo Departments
                            </Button>
                        )}
                    </Space>

                    <Search
                        placeholder='Search departments by name, description, or contact'
                        value={searchText}
                        onChange={e => setSearchText(e.target.value)}
                        onSearch={value => setSearchText(value)}
                        style={{ width: 300 }}
                        allowClear
                    />
                </div>

                <Table
                    dataSource={filteredDepartments}
                    columns={columns}
                    rowKey='id'
                    loading={loading}
                    pagination={{
                        pageSize: 10,
                        showSizeChanger: true,
                        pageSizeOptions: ['10', '20', '50'],
                        showTotal: total => `Total ${total} departments`
                    }}
                    scroll={{ x: 800 }}
                />

                {/* Department Create/Edit Modal */}
                <Modal
                    title={isEditMode ? 'Edit Department' : 'Create New Department'}
                    open={isModalVisible}
                    onCancel={handleCancel}
                    footer={null}
                    maskClosable={false}
                    width={600}
                    centered
                >
                    <DepartmentForm
                        initialValues={currentDepartment}
                        onSubmit={handleSubmit}
                        onCancel={handleCancel}
                        isEditMode={isEditMode}
                    />
                </Modal>
            </Card>
        </div>
    )
}
