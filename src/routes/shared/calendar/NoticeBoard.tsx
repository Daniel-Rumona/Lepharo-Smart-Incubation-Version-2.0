import React, { useEffect, useMemo, useState } from 'react'
import {
    Button,
    Card,
    Col,
    DatePicker,
    Empty,
    Form,
    Input,
    List,
    Modal,
    Popconfirm,
    Row,
    Select,
    Space,
    Tag,
    Typography,
    message
} from 'antd'
import {
    DeleteOutlined,
    EditOutlined,
    LinkOutlined,
    PlusOutlined,
    PushpinFilled
} from '@ant-design/icons'
import {
    Timestamp,
    addDoc,
    collection,
    deleteDoc,
    doc,
    onSnapshot,
    query,
    serverTimestamp,
    updateDoc,
    where
} from 'firebase/firestore'
import dayjs, { Dayjs } from 'dayjs'
import { db } from '@/firebase'

const { Paragraph, Text, Title } = Typography
const { TextArea } = Input

type NoticePriority = 'normal' | 'important' | 'urgent'

type NoticeRecord = {
    id: string
    title: string
    message: string
    priority: NoticePriority
    linkUrl?: string
    programId?: string | null
    branchId?: string | null

    createdBy: string
    createdByName?: string
    createdAt?: any
    updatedAt?: any
    expiresAt?: any
}

type NoticeFormValues = {
    title: string
    message: string
    priority: NoticePriority
    linkUrl?: string
    programScope: 'current' | 'all'
    expiresAt?: Dayjs
}

type Props = {
    user: Record<string, any> | null
    activeProgramId?: string
    isAllPrograms: boolean
}

const normalizeRole = (value: unknown) =>
    String(value || '').trim().toLowerCase().replace(/\s+/g, '')

const toDate = (value: any): Date | null => {
    if (!value) return null
    if (value instanceof Date) return value
    if (typeof value?.toDate === 'function') return value.toDate()
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
}

const priorityMeta: Record<NoticePriority, { color: string; label: string }> = {
    normal: { color: 'blue', label: 'General' },
    important: { color: 'gold', label: 'Important' },
    urgent: { color: 'red', label: 'Urgent' }
}

const NoticeBoard: React.FC<Props> = ({ user, activeProgramId, isAllPrograms }) => {
    const [form] = Form.useForm<NoticeFormValues>()
    const [notices, setNotices] = useState<NoticeRecord[]>([])
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const [editorOpen, setEditorOpen] = useState(false)
    const [editingNotice, setEditingNotice] = useState<NoticeRecord | null>(null)

    const role = normalizeRole(user?.role)
    const branchId = String(user?.assignedBranch || user?.branchId || '').trim()
    const userId = String(user?.uid || user?.id || '').trim()
    const canManage = (role === 'receptionist' || role === 'projectadmin') && !!branchId

    useEffect(() => {
        setLoading(true)
        return onSnapshot(
            query(collection(db, 'noticeBoard')),
            snapshot => {
                const rows = snapshot.docs.map(item => ({
                    id: item.id,
                    ...item.data()
                })) as NoticeRecord[]
                setNotices(rows)
                setLoading(false)
            },
            error => {
                console.error('Notice board snapshot error:', error)
                message.error('Failed to load notices.')
                setNotices([])
                setLoading(false)
            }
        )
    }, [])

    const visibleNotices = useMemo(() => {
        const now = Date.now()
        return notices
            .filter(notice => {
                const expiry = toDate(notice.expiresAt)
                if (expiry && expiry.getTime() < now) return false

                const noticeProgramId = String(notice.programId || '').trim()
                const programMatches =
                    !noticeProgramId ||
                    isAllPrograms ||
                    (!!activeProgramId && noticeProgramId === activeProgramId)

                const noticeBranchId = String(notice.branchId || '').trim()
                const branchMatches =
                    !noticeBranchId ||
                    !branchId ||
                    noticeBranchId === branchId

                return programMatches && branchMatches
            })
            .sort((a, b) => {
                const priorityRank = { urgent: 0, important: 1, normal: 2 }
                const priorityDifference =
                    priorityRank[a.priority || 'normal'] - priorityRank[b.priority || 'normal']
                if (priorityDifference !== 0) return priorityDifference
                return (toDate(b.createdAt)?.getTime() || 0) - (toDate(a.createdAt)?.getTime() || 0)
            })
    }, [activeProgramId, branchId, isAllPrograms, notices])

    const openCreate = () => {
        setEditingNotice(null)
        form.resetFields()
        form.setFieldsValue({
            priority: 'normal',
            programScope: activeProgramId && !isAllPrograms ? 'current' : 'all'
        })
        setEditorOpen(true)
    }

    const openEdit = (notice: NoticeRecord) => {
        setEditingNotice(notice)
        form.setFieldsValue({
            title: notice.title,
            message: notice.message,
            priority: notice.priority || 'normal',
            linkUrl: notice.linkUrl,
            programScope: notice.programId ? 'current' : 'all',
            expiresAt: toDate(notice.expiresAt) ? dayjs(toDate(notice.expiresAt)) : undefined
        })
        setEditorOpen(true)
    }

    const closeEditor = () => {
        setEditorOpen(false)
        setEditingNotice(null)
        form.resetFields()
    }

    const saveNotice = async (values: NoticeFormValues) => {
        if (!canManage || !userId) {
            message.error('You do not have permission to publish notices.')
            return
        }

        setSaving(true)
        try {
            const payload = {
                title: values.title.trim(),
                message: values.message.trim(),
                priority: values.priority,
                linkUrl: values.linkUrl?.trim() || null,
                branchId: branchId || null,
                programId:
                    values.programScope === 'current'
                        ? activeProgramId || editingNotice?.programId || null
                        : null,
                expiresAt: values.expiresAt
                    ? Timestamp.fromDate(values.expiresAt.endOf('day').toDate())
                    : null,
                updatedAt: serverTimestamp()
            }

            if (editingNotice) {
                await updateDoc(doc(db, 'noticeBoard', editingNotice.id), payload)
                message.success('Notice updated.')
            } else {
                await addDoc(collection(db, 'noticeBoard'), {
                    ...payload,
                    createdBy: userId,
                    createdByName: String(user?.name || user?.fullName || user?.email || 'Staff member'),
                    createdByRole: role,
                    createdAt: serverTimestamp()
                })
                message.success('Notice published.')
            }
            closeEditor()
        } catch (error) {
            console.error('Failed to save notice:', error)
            message.error('The notice could not be saved.')
        } finally {
            setSaving(false)
        }
    }

    const removeNotice = async (notice: NoticeRecord) => {
        try {
            await deleteDoc(doc(db, 'noticeBoard', notice.id))
            message.success('Notice removed.')
        } catch (error) {
            console.error('Failed to delete notice:', error)
            message.error('The notice could not be removed.')
        }
    }

    return (
        <section className="notice-board" aria-label="Digital notice board">
            {canManage && (
                <div className="notice-board__toolbar">
                    <Button
                        type="primary"
                        icon={<PlusOutlined />}
                        onClick={openCreate}
                    >
                        Add notice
                    </Button>
                </div>
            )}

            <List
                loading={loading}
                dataSource={visibleNotices}
                locale={{
                    emptyText: (
                        <Empty
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description="There are no current notices for you."
                        />
                    )
                }}
                renderItem={notice => {
                    const meta = priorityMeta[notice.priority || 'normal']
                    const createdAt = toDate(notice.createdAt)
                    const expiresAt = toDate(notice.expiresAt)
                    return (
                        <List.Item className="notice-board__list-item">
                            <Card className={`notice-card notice-card--${notice.priority || 'normal'}`}>
                                <Row gutter={[18, 12]} wrap={false}>
                                    <Col flex="none">
                                        <div className="notice-card__pin">
                                            <PushpinFilled />
                                        </div>
                                    </Col>
                                    <Col flex="auto" className="notice-card__content">
                                        <Space wrap size={[8, 8]} className="notice-card__tags">
                                            <Tag color={meta.color}>{meta.label}</Tag>
                                            {notice.programId && <Tag>Current programme</Tag>}
                                            {expiresAt && (
                                                <Tag color="default">
                                                    Until {dayjs(expiresAt).format('D MMM YYYY')}
                                                </Tag>
                                            )}
                                        </Space>
                                        <Title level={4}>{notice.title}</Title>
                                        <Paragraph className="notice-card__message">
                                            {notice.message}
                                        </Paragraph>
                                        <div className="notice-card__footer">
                                            <Text type="secondary">
                                                {notice.createdByName || 'Staff'}
                                                {createdAt
                                                    ? ` · ${dayjs(createdAt).format('D MMM YYYY, HH:mm')}`
                                                    : ''}
                                            </Text>
                                            <Space wrap>
                                                {notice.linkUrl && (
                                                    <Button
                                                        type="link"
                                                        href={notice.linkUrl}
                                                        target="_blank"
                                                        rel="noreferrer"
                                                        icon={<LinkOutlined />}
                                                    >
                                                        Open link
                                                    </Button>
                                                )}
                                                {canManage && (
                                                    <>
                                                        <Button
                                                            type="text"
                                                            icon={<EditOutlined />}
                                                            onClick={() => openEdit(notice)}
                                                        >
                                                            Edit
                                                        </Button>
                                                        <Popconfirm
                                                            title="Remove this notice?"
                                                            description="This will remove it for everyone."
                                                            okText="Remove"
                                                            okButtonProps={{ danger: true }}
                                                            onConfirm={() => removeNotice(notice)}
                                                        >
                                                            <Button type="text" danger icon={<DeleteOutlined />}>
                                                                Remove
                                                            </Button>
                                                        </Popconfirm>
                                                    </>
                                                )}
                                            </Space>
                                        </div>
                                    </Col>
                                </Row>
                            </Card>
                        </List.Item>
                    )
                }}
            />

            <Modal
                open={editorOpen}
                title={editingNotice ? 'Edit notice' : 'Publish a notice'}
                okText={editingNotice ? 'Save changes' : 'Publish notice'}
                confirmLoading={saving}
                onOk={() => form.submit()}
                onCancel={closeEditor}
                destroyOnClose
            >
                <Form
                    form={form}
                    layout="vertical"
                    onFinish={saveNotice}
                    requiredMark="optional"
                >
                    <Form.Item
                        name="title"
                        label="Title"
                        rules={[
                            { required: true, whitespace: true, message: 'Enter a notice title.' },
                            { max: 100, message: 'Use 100 characters or fewer.' }
                        ]}
                    >
                        <Input placeholder="e.g. Centre closed on Friday" maxLength={100} showCount />
                    </Form.Item>
                    <Form.Item
                        name="message"
                        label="Message"
                        rules={[
                            { required: true, whitespace: true, message: 'Enter the announcement.' },
                            { max: 1200, message: 'Use 1,200 characters or fewer.' }
                        ]}
                    >
                        <TextArea
                            rows={5}
                            placeholder="Share the details SMEs need to know."
                            maxLength={1200}
                            showCount
                        />
                    </Form.Item>
                    <Row gutter={12}>
                        <Col xs={24} sm={12}>
                            <Form.Item name="priority" label="Priority" rules={[{ required: true }]}>
                                <Select
                                    options={[
                                        { value: 'normal', label: 'General' },
                                        { value: 'important', label: 'Important' },
                                        { value: 'urgent', label: 'Urgent' }
                                    ]}
                                />
                            </Form.Item>
                        </Col>
                        <Col xs={24} sm={12}>
                            <Form.Item name="expiresAt" label="Show until">
                                <DatePicker
                                    style={{ width: '100%' }}
                                    disabledDate={date => date.endOf('day').isBefore(dayjs())}
                                />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Form.Item name="programScope" label="Programme visibility">
                        <Select
                            options={[
                                ...((activeProgramId && !isAllPrograms) || editingNotice?.programId
                                    ? [{ value: 'current', label: 'Current programme only' }]
                                    : []),
                                { value: 'all', label: 'All programmes' }
                            ]}
                        />
                    </Form.Item>
                    <Form.Item
                        name="linkUrl"
                        label="Optional link"
                        rules={[{ type: 'url', message: 'Enter a complete URL, including https://.' }]}
                    >
                        <Input prefix={<LinkOutlined />} placeholder="https://example.com/details" />
                    </Form.Item>
                </Form>
            </Modal>
        </section>
    )
}

export default NoticeBoard
