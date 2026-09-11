import React, { useEffect, useMemo, useState } from 'react'
import {
    Typography,
    Row,
    Col,
    Input,
    Select,
    Tag,
    Button,
    Modal,
    Space,
    Empty,
    Divider,
    Form,
    Switch,
    message,
    Alert
} from 'antd'
import {
    PlayCircleOutlined,
    LinkOutlined,
    SearchOutlined,
    BookOutlined,
    VideoCameraOutlined,
    PlusOutlined,
    QuestionCircleOutlined
} from '@ant-design/icons'
import { Helmet } from 'react-helmet'
import {
    addDoc,
    collection,
    onSnapshot,
    orderBy,
    query,
    serverTimestamp
} from 'firebase/firestore'
import { db } from '@/firebase'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { useFullIdentity } from '@/hooks/useFullIdentity'

const { Title, Text, Paragraph } = Typography
const { Search, TextArea } = Input

type TutorialType = 'video' | 'guide' | 'link'

type TutorialDoc = {
    id: string
    title: string
    description: string
    category: string
    type: TutorialType
    allowedRoles: string[]
    videoUrl?: string
    externalUrl?: string
    guideContent?: string
    featured?: boolean
    status?: 'active' | 'inactive'
    createdAt?: any
    updatedAt?: any
    createdBy?: string
    createdByEmail?: string
}

const ROLE_OPTIONS = [
    'admin',
    'director',
    'projectadmin',
    'projectmanager',
    'consultant',
    'operations',
    'incubatee'
]

const CATEGORY_OPTIONS = [
    'Getting Started',
    'Profile & Account',
    'Applications',
    'Compliance',
    'Meetings & Attendance',
    'Interventions',
    'Documents',
    'Reports',
    'General'
]

const TYPE_OPTIONS: TutorialType[] = ['video', 'guide', 'link']

function normalizeRole(role?: string) {
    return String(role || '')
        .toLowerCase()
        .replace(/\s+/g, '')
        .trim()
}

function getTypeColor(type: TutorialType) {
    switch (type) {
        case 'video':
            return 'red'
        case 'guide':
            return 'blue'
        case 'link':
            return 'green'
        default:
            return 'default'
    }
}

function getTutorialIcon(type: TutorialType) {
    switch (type) {
        case 'video':
            return <VideoCameraOutlined />
        case 'guide':
            return <BookOutlined />
        case 'link':
            return <LinkOutlined />
        default:
            return <QuestionCircleOutlined />
    }
}

function toYouTubeEmbedUrl(url?: string) {
    if (!url) return undefined

    const trimmed = url.trim()

    if (trimmed.includes('youtu.be/')) {
        const id = trimmed.split('youtu.be/')[1]?.split('?')[0]
        return id ? `https://www.youtube.com/embed/${id}` : undefined
    }

    if (trimmed.includes('youtube.com/watch?v=')) {
        const id = trimmed.split('v=')[1]?.split('&')[0]
        return id ? `https://www.youtube.com/embed/${id}` : undefined
    }

    if (trimmed.includes('youtube.com/embed/')) {
        return trimmed
    }

    return undefined
}

const TutorialCard: React.FC<{
    tutorial: TutorialDoc
    onOpen: (tutorial: TutorialDoc) => void
}> = ({ tutorial, onOpen }) => {
    return (
        <MotionCard
            style={{ height: '100%', borderRadius: 18 }}
            bodyStyle={{ padding: 18, height: '100%' }}
        >
            <div
                style={{
                    display: 'flex',
                    flexDirection: 'column',
                    height: '100%',
                    gap: 12
                }}
            >
                <Space wrap>
                    <Tag color={getTypeColor(tutorial.type)} icon={getTutorialIcon(tutorial.type)}>
                        {tutorial.type.toUpperCase()}
                    </Tag>

                    <Tag>{tutorial.category || 'General'}</Tag>

                    {tutorial.featured ? <Tag color='gold'>Featured</Tag> : null}
                </Space>

                <Title level={5} style={{ margin: 0 }}>
                    {tutorial.title}
                </Title>

                <Paragraph
                    style={{
                        marginBottom: 0,
                        color: 'rgba(0,0,0,0.65)',
                        flex: 1
                    }}
                >
                    {tutorial.description}
                </Paragraph>

                <Divider style={{ margin: '4px 0 0' }} />

                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
                    <Button
                        type='primary'
                        block
                        icon={
                            tutorial.type === 'video' ? (
                                <PlayCircleOutlined />
                            ) : tutorial.type === 'link' ? (
                                <LinkOutlined />
                            ) : (
                                <BookOutlined />
                            )
                        }
                        onClick={() => onOpen(tutorial)}
                    >
                        {tutorial.type === 'video'
                            ? 'Watch'
                            : tutorial.type === 'link'
                                ? 'Open'
                                : 'Read'}
                    </Button>
                </div>
            </div>
        </MotionCard>
    )
}

const TutorialsPage: React.FC = () => {
    const { user } = useFullIdentity()

    const [form] = Form.useForm()

    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [tutorials, setTutorials] = useState<TutorialDoc[]>([])

    const [searchText, setSearchText] = useState('')
    const [category, setCategory] = useState<string>('All')
    const [selectedTutorial, setSelectedTutorial] = useState<TutorialDoc | null>(null)
    const [createVisible, setCreateVisible] = useState(false)

    const currentRole = useMemo(() => {
        return normalizeRole(user?.role)
    }, [user])

    const canManageTutorials = currentRole === 'admin'

    useEffect(() => {
        const q = query(collection(db, 'tutorials'), orderBy('createdAt', 'desc'))

        const unsub = onSnapshot(
            q,
            (snapshot) => {
                const rows: TutorialDoc[] = snapshot.docs.map((docSnap) => {
                    const data = docSnap.data() as any
                    return {
                        id: docSnap.id,
                        title: data.title || '',
                        description: data.description || '',
                        category: data.category || 'General',
                        type: data.type || 'guide',
                        allowedRoles: Array.isArray(data.allowedRoles) ? data.allowedRoles : [],
                        videoUrl: data.videoUrl || '',
                        externalUrl: data.externalUrl || '',
                        guideContent: data.guideContent || '',
                        featured: Boolean(data.featured),
                        status: data.status || 'active',
                        createdAt: data.createdAt,
                        updatedAt: data.updatedAt,
                        createdBy: data.createdBy || '',
                        createdByEmail: data.createdByEmail || ''
                    }
                })

                setTutorials(rows)
                setLoading(false)
            },
            (error) => {
                console.error('Tutorials subscription error:', error)
                message.error('Failed to load tutorials.')
                setLoading(false)
            }
        )

        return () => unsub()
    }, [])

    const visibleTutorials = useMemo(() => {
        const term = searchText.trim().toLowerCase()

        return tutorials.filter((tutorial) => {
            if (tutorial.status !== 'active') return false

            const allowed = Array.isArray(tutorial.allowedRoles)
                ? tutorial.allowedRoles.map(normalizeRole)
                : []

            const rolePass =
                canManageTutorials ||
                allowed.includes('all') ||
                allowed.includes(currentRole)

            if (!rolePass) return false

            const categoryPass = category === 'All' || tutorial.category === category

            const searchPass =
                !term ||
                tutorial.title.toLowerCase().includes(term) ||
                tutorial.description.toLowerCase().includes(term) ||
                tutorial.category.toLowerCase().includes(term) ||
                tutorial.allowedRoles.some((r) => r.toLowerCase().includes(term))

            return categoryPass && searchPass
        })
    }, [tutorials, searchText, category, currentRole, canManageTutorials])

    const featuredTutorials = useMemo(() => {
        return visibleTutorials.filter((item) => item.featured)
    }, [visibleTutorials])

    const categories = useMemo(() => {
        const unique = Array.from(
            new Set(
                tutorials
                    .filter((t) => t.status === 'active')
                    .map((t) => t.category || 'General')
            )
        ).sort()

        return ['All', ...unique]
    }, [tutorials])

    const openTutorial = (tutorial: TutorialDoc) => {
        if (tutorial.type === 'link' && tutorial.externalUrl) {
            if (tutorial.externalUrl.startsWith('/')) {
                window.location.href = tutorial.externalUrl
            } else {
                window.open(tutorial.externalUrl, '_blank', 'noopener,noreferrer')
            }
            return
        }

        setSelectedTutorial(tutorial)
    }

    const handleCreate = async (values: any) => {
        try {
            setSaving(true)

            const payload: any = {
                title: String(values.title || '').trim(),
                description: String(values.description || '').trim(),
                category: String(values.category || 'General').trim(),
                type: values.type,
                allowedRoles: Array.isArray(values.allowedRoles) ? values.allowedRoles : [],
                featured: Boolean(values.featured),
                status: 'active',
                createdAt: serverTimestamp(),
                updatedAt: serverTimestamp(),
                createdBy: user?.uid || '',
                createdByEmail: user?.email || ''
            }

            if (values.type === 'video') {
                payload.videoUrl = String(values.videoUrl || '').trim()
            }

            if (values.type === 'link') {
                payload.externalUrl = String(values.externalUrl || '').trim()
            }

            if (values.type === 'guide') {
                payload.guideContent = String(values.guideContent || '').trim()
            }

            await addDoc(collection(db, 'tutorials'), payload)

            message.success('Tutorial added successfully.')
            setCreateVisible(false)
            form.resetFields()
        } catch (error) {
            console.error('Add tutorial error:', error)
            message.error('Failed to add tutorial.')
        } finally {
            setSaving(false)
        }
    }

    const selectedEmbedUrl = useMemo(() => {
        if (!selectedTutorial || selectedTutorial.type !== 'video') return undefined
        return toYouTubeEmbedUrl(selectedTutorial.videoUrl)
    }, [selectedTutorial])

    const filterBar = (
        <Row gutter={[12, 12]} align='middle'>
            <Col xs={24} md={14} lg={16}>
                <Space direction='vertical' size={4} style={{ width: '100%' }}>
                    <Text strong>Search tutorials</Text>
                    <Search
                        allowClear
                        placeholder='Search by title or category'
                        value={searchText}
                        onChange={(e) => setSearchText(e.target.value)}
                        prefix={<SearchOutlined />}
                    />
                </Space>
            </Col>

            <Col xs={24} md={10} lg={8}>
                <Space direction='vertical' size={4} style={{ width: '100%' }}>
                    <Text strong>Category</Text>
                    <Select
                        value={category}
                        onChange={setCategory}
                        options={categories.map((item) => ({
                            label: item,
                            value: item
                        }))}
                        style={{ width: '100%' }}
                    />
                </Space>
            </Col>
        </Row>
    )

    return (
        <div style={{ padding: 24, minHeight: '100vh' }}>
            <Helmet>
                <title>Tutorials | Smart Incubation Platform</title>
            </Helmet>

            <div>
                <MotionCard
                    filterBar={filterBar}
                    filterBarProps={{
                        background: '#f8fafc',
                        borderColor: '#d9e8ff',
                        borderRadius: 14,
                        padding: 14
                    }}
                >
                    {loading ? (
                        <Text type='secondary'>Loading tutorials...</Text>
                    ) : visibleTutorials.length === 0 ? (
                        <Empty
                            description='No tutorials available for your role yet.'
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                        />
                    ) : (
                        <Row gutter={[16, 16]}>
                            {visibleTutorials.map((tutorial) => (
                                <Col xs={24} sm={12} xl={8} key={tutorial.id}>
                                    <TutorialCard tutorial={tutorial} onOpen={openTutorial} />
                                </Col>
                            ))}
                        </Row>
                    )}
                </MotionCard>
            </div>

            <Modal
                open={!!selectedTutorial}
                onCancel={() => setSelectedTutorial(null)}
                footer={null}
                width={selectedTutorial?.type === 'video' ? 920 : 760}
                centered
                destroyOnClose
                title={selectedTutorial?.title || 'Tutorial'}
            >
                {selectedTutorial?.type === 'video' ? (
                    selectedEmbedUrl ? (
                        <div
                            style={{
                                position: 'relative',
                                width: '100%',
                                paddingTop: '56.25%',
                                borderRadius: 12,
                                overflow: 'hidden',
                                background: '#000'
                            }}
                        >
                            <iframe
                                src={selectedEmbedUrl}
                                title={selectedTutorial.title}
                                allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'
                                allowFullScreen
                                style={{
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    width: '100%',
                                    height: '100%',
                                    border: 'none'
                                }}
                            />
                        </div>
                    ) : (
                        <Alert
                            type='warning'
                            showIcon
                            message='Invalid video URL'
                            description='This tutorial does not currently have a valid YouTube URL.'
                        />
                    )
                ) : selectedTutorial?.type === 'guide' ? (
                    <Space direction='vertical' size={12} style={{ width: '100%' }}>
                        <Tag color='blue'>{selectedTutorial.category}</Tag>
                        <Paragraph style={{ marginBottom: 0 }}>
                            {selectedTutorial.guideContent || selectedTutorial.description}
                        </Paragraph>
                    </Space>
                ) : selectedTutorial?.type === 'link' ? (
                    <Space direction='vertical' size={12}>
                        <Text>{selectedTutorial.description}</Text>
                        {selectedTutorial.externalUrl ? (
                            <Button
                                type='primary'
                                icon={<LinkOutlined />}
                                onClick={() => {
                                    if (selectedTutorial.externalUrl?.startsWith('/')) {
                                        window.location.href = selectedTutorial.externalUrl
                                    } else {
                                        window.open(
                                            selectedTutorial.externalUrl,
                                            '_blank',
                                            'noopener,noreferrer'
                                        )
                                    }
                                }}
                            >
                                Open resource
                            </Button>
                        ) : null}
                    </Space>
                ) : (
                    <Empty description='Tutorial preview not available.' />
                )}
            </Modal>

            <Modal
                open={createVisible}
                onCancel={() => {
                    setCreateVisible(false)
                    form.resetFields()
                }}
                onOk={() => form.submit()}
                confirmLoading={saving}
                title='Add Tutorial'
                okText='Save Tutorial'
                width={760}
                destroyOnClose
            >
                <Form
                    layout='vertical'
                    form={form}
                    onFinish={handleCreate}
                    initialValues={{
                        type: 'video',
                        category: 'Getting Started',
                        allowedRoles: ['incubatee'],
                        featured: false
                    }}
                >
                    <Row gutter={[16, 0]}>
                        <Col xs={24} md={12}>
                            <Form.Item
                                name='title'
                                label='Title'
                                rules={[{ required: true, message: 'Please enter a title' }]}
                            >
                                <Input placeholder='Enter tutorial title' />
                            </Form.Item>
                        </Col>

                        <Col xs={24} md={12}>
                            <Form.Item
                                name='category'
                                label='Category'
                                rules={[{ required: true, message: 'Please select a category' }]}
                            >
                                <Select
                                    options={CATEGORY_OPTIONS.map((item) => ({
                                        label: item,
                                        value: item
                                    }))}
                                />
                            </Form.Item>
                        </Col>

                        <Col xs={24} md={12}>
                            <Form.Item
                                name='type'
                                label='Tutorial Type'
                                rules={[{ required: true, message: 'Please select a type' }]}
                            >
                                <Select
                                    options={TYPE_OPTIONS.map((item) => ({
                                        label: item.toUpperCase(),
                                        value: item
                                    }))}
                                />
                            </Form.Item>
                        </Col>

                        <Col xs={24} md={12}>
                            <Form.Item
                                name='allowedRoles'
                                label='Visible To Roles'
                                rules={[
                                    {
                                        required: true,
                                        message: 'Please select at least one role'
                                    }
                                ]}
                            >
                                <Select
                                    mode='multiple'
                                    placeholder='Select roles'
                                    options={ROLE_OPTIONS.map((item) => ({
                                        label: item,
                                        value: item
                                    }))}
                                />
                            </Form.Item>
                        </Col>

                        <Col xs={24}>
                            <Form.Item
                                name='description'
                                label='Description'
                                rules={[
                                    { required: true, message: 'Please enter a description' }
                                ]}
                            >
                                <TextArea rows={3} placeholder='Short tutorial description' />
                            </Form.Item>
                        </Col>

                        <Col xs={24}>
                            <Form.Item noStyle shouldUpdate={(prev, curr) => prev.type !== curr.type}>
                                {({ getFieldValue }) => {
                                    const type = getFieldValue('type') as TutorialType

                                    if (type === 'video') {
                                        return (
                                            <Form.Item
                                                name='videoUrl'
                                                label='Video URL'
                                                rules={[
                                                    {
                                                        required: true,
                                                        message: 'Please enter a YouTube URL'
                                                    }
                                                ]}
                                            >
                                                <Input placeholder='https://youtu.be/... or https://www.youtube.com/watch?v=...' />
                                            </Form.Item>
                                        )
                                    }

                                    if (type === 'link') {
                                        return (
                                            <Form.Item
                                                name='externalUrl'
                                                label='External / Internal URL'
                                                rules={[
                                                    {
                                                        required: true,
                                                        message: 'Please enter the URL'
                                                    }
                                                ]}
                                            >
                                                <Input placeholder='https://... or /some/internal/route' />
                                            </Form.Item>
                                        )
                                    }

                                    if (type === 'guide') {
                                        return (
                                            <Form.Item
                                                name='guideContent'
                                                label='Guide Content'
                                                rules={[
                                                    {
                                                        required: true,
                                                        message: 'Please enter the guide content'
                                                    }
                                                ]}
                                            >
                                                <TextArea
                                                    rows={7}
                                                    placeholder='Write the guide content here'
                                                />
                                            </Form.Item>
                                        )
                                    }

                                    return null
                                }}
                            </Form.Item>
                        </Col>

                        <Col xs={24}>
                            <Form.Item
                                name='featured'
                                label='Featured'
                                valuePropName='checked'
                            >
                                <Switch />
                            </Form.Item>
                        </Col>
                    </Row>
                </Form>
            </Modal>
        </div>
    )
}

export default TutorialsPage
