import React, { useEffect, useState } from 'react'
import {
    Card,
    Table,
    Row,
    Col,
    Button,
    Typography,
    Input,
    Space,
    Statistic,
    Spin,
    Form,
    Select,
    Modal,
    message,
    Layout
} from 'antd'
import {
    collection,
    getDocs,
    setDoc,
    query,
    where,
    doc,
    addDoc
} from 'firebase/firestore'
import { db, auth } from '@/firebase'
import { useNavigate } from 'react-router-dom'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { PlusOutlined } from '@ant-design/icons'
import { Helmet } from 'react-helmet'
import { createUserWithEmailAndPassword } from 'firebase/auth'
import { getFunctions, httpsCallable } from 'firebase/functions'

const { Title } = Typography
const { Option } = Select

// include digitalSignature in the shape
interface OperationsUser {
    id: string
    name: string
    email: string
    gender: string
    phone: string

    department?: string
    departmentId?: string
    departmentName?: string
    createdAt: Date
    updatedAt?: Date
    digitalSignature?: string
}

interface UserIdentity {
    id: string
    email: string
    name?: string
    avatar?: string
    role?: string

    digitalSignature?: string
}

// quick hash-preview for UI
const previewHash = (s?: string) =>
    s ? `${s.slice(0, 10)}…${s.slice(-6)}` : '—'

const getFriendlyAuthErrorMessage = (error: any, fallback = 'Failed to save operations staff.') => {
    const code = error?.code

    if (typeof code === 'string') {
        switch (code) {
            case 'auth/email-already-in-use':
                return 'This email address is already in use. Please use a different email.'
            case 'auth/invalid-email':
                return 'The email address is not valid. Please check and try again.'
            case 'auth/network-request-failed':
                return 'Network issue detected. Check your connection and try again.'
            case 'auth/weak-password':
                return 'Password is too weak. Use at least 6 characters.'
            case 'auth/too-many-requests':
                return 'Too many attempts. Please wait a moment and try again.'
            case 'auth/internal-error':
                return 'An authentication service error occurred. Please try again shortly.'
            default:
                break
        }
    }

    const raw = String(error?.message || error?.details || error?.error || error || '').trim()
    if (!raw) return fallback

    const normalized = raw.toLowerCase()
    if (
        normalized.includes('network') ||
        normalized.includes('failed to fetch') ||
        normalized.includes('timeout')
    ) {
        return 'Network issue detected. Check your connection and try again.'
    }

    if (
        normalized.includes('email-already-in-use') ||
        normalized.includes('email already exists') ||
        normalized.includes('already exists')
    ) {
        return 'This email address is already linked to another user.'
    }

    if (
        normalized.includes('invalid email') ||
        normalized.includes('auth/invalid-email')
    ) {
        return 'Please enter a valid email address.'
    }

    return raw
}

// make a SHA-256 hex digest using Web Crypto
const generateDigitalSignature = async (seed: string) => {
    // include time + a strong random nonce so two users with same email never collide
    const nonceArr = new Uint32Array(1)
    window.crypto.getRandomValues(nonceArr)
    const payload = `${seed}|${Date.now()}|${nonceArr[0]}`
    const bytes = new TextEncoder().encode(payload)
    const hashBuf = await window.crypto.subtle.digest('SHA-256', bytes)
    const hashArray = Array.from(new Uint8Array(hashBuf))
    const hex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')
    return hex
}

export const OperationsOnboardingDashboard: React.FC = () => {
    const [operationsStaff, setOperationsStaff] = useState<OperationsUser[]>([])
    const [filteredStaff, setFilteredStaff] = useState<OperationsUser[]>([])
    const [loading, setLoading] = useState(true)
    const [searchText, setSearchText] = useState('')
    const [addModalVisible, setAddModalVisible] = useState(false)
    const [departments, setDepartments] = useState<any[]>([])
    const [form] = Form.useForm()
    const [editingStaff, setEditingStaff] = useState<OperationsUser | null>(null)
    const navigate = useNavigate()
    const { user, loading: identityLoading } = useFullIdentity()
    const functions = getFunctions() // add region if needed

    // helper to find a user uid by email in /users
    const getUserUidByEmail = async (email: string) => {
        const snapshot = await getDocs(
            query(collection(db, 'users'), where('email', '==', email))
        )
        if (snapshot.empty) throw new Error('No user found with that email')
        return snapshot.docs[0].id
    }

    useEffect(() => {

        const fetchDepartments = async () => {
            const snapshot = await getDocs(
                query(
                    collection(db, 'departments'),

                )
            )
            setDepartments(
                snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
            )
        }
        fetchDepartments()

    }, [])

    const fetchOperationsStaff = async () => {
        try {
            setLoading(true)
            const snapshot = await getDocs(
                query(
                    collection(db, 'operationsStaff')
                )
            )
            const staffList = snapshot.docs.map(d => ({
                id: d.id,
                ...d.data()
            })) as OperationsUser[]
            setOperationsStaff(staffList)
            setFilteredStaff(staffList)
        } catch (error) {
            console.error('Error fetching operations staff:', error)
        } finally {
            setLoading(false)
        }
    }

    const handleSearch = (value: string) => {
        setSearchText(value)
        const filtered = operationsStaff.filter(
            s =>
                s.name?.toLowerCase().includes(value.toLowerCase()) ||
                s.email?.toLowerCase().includes(value.toLowerCase())
        )
        setFilteredStaff(filtered)
    }

    // create/update staff; set digitalSignature on create; backfill if missing on edit
    const handleFinish = async (values: any) => {
        try {
            const { email, password, name, department } = values

            // resolve department name by id
            const depName = departments.find(d => d.id === department)?.name || ''

            if (editingStaff) {
                // editing existing staff: keep their digitalSignature if present; generate if missing
                const existingSig = editingStaff.digitalSignature
                const digitalSignature =
                    existingSig && existingSig.length > 0
                        ? existingSig
                        : await generateDigitalSignature(`${email}|${name}`)

                // update /users (merge by uid resolved from email)
                const userUid = await getUserUidByEmail(email)
                await setDoc(
                    doc(db, 'users', userUid),
                    {
                        name,
                        email,
                        role: 'operations',
                        departmentId: department,
                        departmentName: depName,
                        digitalSignature,
                        updatedAt: new Date()
                    },
                    { merge: true }
                )

                // update /operationsStaff by document id
                await setDoc(
                    doc(db, 'operationsStaff', editingStaff.id),
                    {
                        name,
                        email,
                        gender: values.gender,
                        phone: values.phone,
                        departmentId: department,
                        departmentName: depName,
                        digitalSignature,
                        updatedAt: new Date()
                    },
                    { merge: true }
                )

                message.success('Staff updated successfully!')
            } else {
                // creating a new auth user
                const userCredential = await createUserWithEmailAndPassword(
                    auth,
                    email,
                    password
                )
                const firebaseUser = userCredential.user
                if (!firebaseUser)
                    throw new Error(
                        'Failed to create user. The authentication service did not return a valid user.'
                    )

                // generate a fresh digital signature for this operations user
                const digitalSignature = await generateDigitalSignature(
                    `${email}|${name}`
                )

                // set in /users (uid = auth uid)
                await setDoc(doc(db, 'users', firebaseUser.uid), {
                    uid: firebaseUser.uid,
                    email,
                    name,
                    role: 'operations',
                    departmentId: department,
                    departmentName: depName,
                    digitalSignature,
                    createdAt: new Date()
                })

                // set in /operationsStaff (own doc id)
                await addDoc(collection(db, 'operationsStaff'), {
                    email,
                    name,
                    gender: values.gender,
                    phone: values.phone,
                    departmentId: department,
                    departmentName: depName,
                    digitalSignature,
                    createdAt: new Date()
                })

                message.success('Operations staff added successfully!')
            }

            form.resetFields()
            setAddModalVisible(false)
            setEditingStaff(null)
            fetchOperationsStaff()
        } catch (error: any) {
            console.error('Error saving staff:', error)
            message.error(getFriendlyAuthErrorMessage(error))
        }
    }

    const handleEdit = (record: OperationsUser) => {
        setEditingStaff(record)
        form.setFieldsValue({
            ...record,
            department: record.departmentId || record.department // prefer id
        })
        setAddModalVisible(true)
    }

    const handleDelete = async (record: OperationsUser) => {
        Modal.confirm({
            title: 'Confirm Delete',
            content: `Delete "${record.name}" (${record.email})? This cannot be undone.`,
            okText: 'Delete',
            okType: 'danger',
            cancelText: 'Cancel',
            async onOk() {
                try {
                    const functions = getFunctions()
                    const deleteUser = httpsCallable(functions, 'deleteUserCascade')
                    await deleteUser({ email: record.email, role: 'operations', confirm: true })
                    message.success('Staff deleted successfully.')
                    fetchOperationsStaff()
                } catch (error: any) {
                    console.error('Error deleting staff:', error)
                    message.error(
                        error?.message ||
                        error?.details ||
                        'Failed to delete staff from Auth/Firestore.'
                    )
                }
            }
        })
    }

    // include a small Crypto Sig column so I can verify the field is set
    const columns = [
        {
            title: 'Full Name',
            dataIndex: 'name',
            key: 'name',
            sorter: (a: any, b: any) => (a.name || '').localeCompare(b.name || '')
        },
        {
            title: 'Email',
            dataIndex: 'email',
            key: 'email',
            sorter: (a: any, b: any) => (a.email || '').localeCompare(b.email || '')
        },
        { title: 'Phone', dataIndex: 'phone', key: 'phone' },
        { title: 'Gender', dataIndex: 'gender', key: 'gender' },
        {
            title: 'Department',
            dataIndex: 'departmentName',
            key: 'departmentName',
            render: (dept: string) =>
                dept || <span style={{ color: '#bbb' }}>Not set</span>
        },
        {
            title: 'Crypto Sig',
            dataIndex: 'digitalSignature',
            key: 'digitalSignature',
            render: (sig: string) => <code>{previewHash(sig)}</code>,
            width: 200
        },
        {
            title: 'Actions',
            key: 'actions',
            render: (_: any, record: OperationsUser) => (
                <Space>
                    <Button size='small' onClick={() => handleEdit(record)}>
                        Edit
                    </Button>
                    <Button size='small' danger onClick={() => handleDelete(record)}>
                        Delete
                    </Button>
                </Space>
            )
        }
    ]

    const totalUsers = filteredStaff.length

    return (
        <Layout style={{ minHeight: '100vh', backgroundColor: 'white' }}>
            <Helmet>
                <title>Operations Staff | Smart Incubation</title>
            </Helmet>

            <Row justify='space-between' align='middle' style={{ marginBottom: 24 }}>
                <Col>
                    <Title level={3}>Operations Staff</Title>
                </Col>
                <Col>
                    <Space>
                        <Input.Search
                            placeholder='Search by name or email'
                            onSearch={handleSearch}
                            allowClear
                            style={{ width: 250 }}
                        />
                        <Button
                            type='primary'
                            icon={<PlusOutlined />}
                            onClick={() => setAddModalVisible(true)}
                        >
                            Add New
                        </Button>
                    </Space>
                </Col>
            </Row>

            <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
                <Col xs={24} sm={8}>
                    <Card>
                        <Statistic title='Total Operations Users' value={totalUsers} />
                    </Card>
                </Col>
            </Row>

            {loading ? (
                <div
                    style={{
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        height: '50vh'
                    }}
                >
                    <Spin size='large' />
                </div>
            ) : (
                <Card>
                    <Table
                        columns={columns as any}
                        dataSource={filteredStaff}
                        rowKey='id'
                        pagination={{ pageSize: 8 }}
                    />
                </Card>
            )}

            {/* Add / Edit Modal */}
            <Modal
                title={
                    editingStaff ? 'Edit Operations Staff' : 'Add New Operations Staff'
                }
                open={addModalVisible}
                onCancel={() => {
                    setAddModalVisible(false)
                    setEditingStaff(null)
                    form.resetFields()
                }}
                onOk={() => form.submit()}
                okText={editingStaff ? 'Update Staff' : 'Add Staff'}
            >
                <Form form={form} layout='vertical' onFinish={handleFinish}>
                    <Form.Item
                        label='Full Name'
                        name='name'
                        rules={[{ required: true, message: 'Please enter full name' }]}
                    >
                        <Input placeholder='Enter full name' />
                    </Form.Item>

                    <Form.Item
                        label='Department'
                        name='department'
                        rules={[{ required: true, message: 'Please select department' }]}
                    >
                        <Select placeholder='Select department'>
                            {departments.map(dep => (
                                <Option key={dep.id} value={dep.id}>
                                    {dep.name || dep.id}
                                </Option>
                            ))}
                        </Select>
                    </Form.Item>

                    <Form.Item
                        label='Gender'
                        name='gender'
                        rules={[{ required: true, message: 'Please select gender' }]}
                    >
                        <Select placeholder='Select gender'>
                            <Option value='Male'>Male</Option>
                            <Option value='Female'>Female</Option>
                        </Select>
                    </Form.Item>

                    <Form.Item
                        label='Phone Number'
                        name='phone'
                        rules={[{ required: true, message: 'Please enter phone number' }]}
                    >
                        <Input placeholder='Enter phone number' />
                    </Form.Item>

                    <Form.Item
                        label='Email Address'
                        name='email'
                        rules={[
                            { required: true, message: 'Please enter email address' },
                            { type: 'email', message: 'Enter a valid email address' }
                        ]}
                    >
                        <Input placeholder='Enter email address' />
                    </Form.Item>

                    {!editingStaff && (
                        <Form.Item
                            label='Password'
                            name='password'
                            rules={[{ required: true, message: 'Please set a password' }]}
                        >
                            <Input.Password placeholder='Enter password' />
                        </Form.Item>
                    )}

                    {/* When editing, show a subtle hint of current crypto sig */}
                    {editingStaff?.digitalSignature && (
                        <div style={{ marginTop: -6, marginBottom: 6 }}>
                            <Typography.Text type='secondary'>
                                Current Crypto Sig:{' '}
                                <code>{previewHash(editingStaff.digitalSignature)}</code>
                            </Typography.Text>
                        </div>
                    )}
                </Form>
            </Modal>
        </Layout>
    )
}

export default OperationsOnboardingDashboard
