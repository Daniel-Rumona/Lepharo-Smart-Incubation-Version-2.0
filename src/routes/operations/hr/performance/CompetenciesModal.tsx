import React, { useState } from 'react'
import { Button, Col, Empty, Form, Input, Modal, Popconfirm, Row, Segmented, Select, Space, Table, Tag, Typography, message } from 'antd'
import { DeleteOutlined, EditOutlined, PlusOutlined, SafetyCertificateOutlined } from '@ant-design/icons'
import { addDoc, collection, deleteDoc, doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db } from '@/firebase'
import { MobileCardList } from '@/components/shared/MobileCardList'
import { useIsMobile } from '@/hooks/useIsMobile'
import { COMPETENCY_CLUSTERS, type Competency, type CompetencyCluster } from './ipm'

const { Text } = Typography

export const clusterLabel = (cluster?: CompetencyCluster) =>
    COMPETENCY_CLUSTERS.find(c => c.value === cluster)?.label || 'Competency'

export const clusterColor = (cluster?: CompetencyCluster) =>
    cluster === 'leadership' ? 'purple' : cluster === 'behavioural' ? 'blue' : 'cyan'

/** HR's competency library: what compacts pick their competencies from. */
export const CompetenciesModal: React.FC<{
    open: boolean
    onClose: () => void
    competencies: Competency[]
    onChanged: () => void
    userId: string
}> = ({ open, onClose, competencies, onChanged, userId }) => {
    const [form] = Form.useForm<{ name: string; cluster: CompetencyCluster; description?: string }>()
    const isMobile = useIsMobile()
    const [editing, setEditing] = useState<Competency | null>(null)
    const [formOpen, setFormOpen] = useState(false)
    const [cluster, setCluster] = useState<CompetencyCluster | 'all'>('all')
    const [saving, setSaving] = useState(false)

    const startNew = () => {
        setEditing(null)
        form.setFieldsValue({ name: '', cluster: cluster === 'all' ? 'behavioural' : cluster, description: '' })
        setFormOpen(true)
    }

    const startEdit = (competency: Competency) => {
        setEditing(competency)
        form.setFieldsValue({ name: competency.name, cluster: competency.cluster, description: competency.description || '' })
        setFormOpen(true)
    }

    const save = async (values: { name: string; cluster: CompetencyCluster; description?: string }) => {
        const payload = { name: values.name.trim(), cluster: values.cluster, description: (values.description || '').trim() }
        setSaving(true)
        try {
            if (editing) {
                await updateDoc(doc(db, 'ipmCompetencies', editing.id), { ...payload, updatedAt: serverTimestamp(), updatedBy: userId })
            } else {
                await addDoc(collection(db, 'ipmCompetencies'), {
                    ...payload,
                    active: true,
                    createdAt: serverTimestamp(),
                    createdBy: userId
                })
            }
            message.success(editing ? 'Competency updated.' : 'Competency added.')
            setFormOpen(false)
            onChanged()
        } catch (error) {
            console.error(error)
            message.error('Could not save the competency.')
        } finally {
            setSaving(false)
        }
    }

    const remove = async (competency: Competency) => {
        try {
            await deleteDoc(doc(db, 'ipmCompetencies', competency.id))
            message.success('Competency removed. Compacts that already use it keep their copy.')
            onChanged()
        } catch (error) {
            console.error(error)
            message.error('Could not remove the competency.')
        }
    }

    const visible = competencies.filter(c => cluster === 'all' || c.cluster === cluster)

    return (
        <Modal
            open={open}
            onCancel={onClose}
            footer={null}
            width={820}
            destroyOnClose
            title={
                <Space>
                    <SafetyCertificateOutlined />
                    Competency library
                </Space>
            }
        >
            <div
                style={{
                    display: 'flex',
                    flexDirection: isMobile ? 'column' : 'row',
                    flexWrap: 'wrap',
                    justifyContent: 'space-between',
                    gap: 8,
                    marginBottom: 12
                }}
            >
                <Segmented
                    block={isMobile}
                    size={isMobile ? 'small' : 'middle'}
                    value={cluster}
                    onChange={value => setCluster(value as CompetencyCluster | 'all')}
                    options={[{ value: 'all', label: 'All' }, ...COMPETENCY_CLUSTERS.map(c => ({ value: c.value, label: c.label }))]}
                />
                <Button type='primary' block={isMobile} icon={<PlusOutlined />} onClick={startNew}>
                    Add competency
                </Button>
            </div>

            {cluster !== 'all' ? (
                <Text type='secondary' style={{ display: 'block', marginBottom: 12, fontSize: 12 }}>
                    {COMPETENCY_CLUSTERS.find(c => c.value === cluster)?.description}
                </Text>
            ) : null}

            {formOpen ? (
                <Form form={form} layout='vertical' onFinish={save} requiredMark={false} style={{ marginBottom: 16 }}>
                    <Row gutter={12}>
                        <Col xs={24} md={14}>
                            <Form.Item name='name' label='Competency' rules={[{ required: true, whitespace: true, message: 'Name the competency' }]}>
                                <Input placeholder='e.g. Client focus' />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={10}>
                            <Form.Item name='cluster' label='Cluster' rules={[{ required: true }]}>
                                <Select options={COMPETENCY_CLUSTERS.map(c => ({ value: c.value, label: c.label }))} />
                            </Form.Item>
                        </Col>
                        <Col span={24}>
                            <Form.Item name='description' label='What it looks like in practice'>
                                <Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} placeholder='The behaviours expected when this competency is shown well.' />
                            </Form.Item>
                        </Col>
                    </Row>
                    <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
                        <Button onClick={() => setFormOpen(false)} disabled={saving}>
                            Cancel
                        </Button>
                        <Button type='primary' htmlType='submit' loading={saving}>
                            {editing ? 'Save' : 'Add'}
                        </Button>
                    </Space>
                </Form>
            ) : null}

            {isMobile ? (
                <MobileCardList
                    data={visible}
                    getKey={c => c.id}
                    emptyText='No competencies yet. Add the competencies positions are assessed on.'
                    renderCard={(c: Competency) => ({
                        title: c.name,
                        subtitle: c.description || undefined,
                        badge: (
                            <Tag color={clusterColor(c.cluster)} style={{ borderRadius: 999, margin: 0 }}>
                                {clusterLabel(c.cluster)}
                            </Tag>
                        ),
                        actions: [
                            <Button key='edit' icon={<EditOutlined />} onClick={() => startEdit(c)}>
                                Edit
                            </Button>,
                            <Popconfirm key='remove' title='Remove this competency?' okText='Remove' onConfirm={() => remove(c)}>
                                <Button danger icon={<DeleteOutlined />}>
                                    Remove
                                </Button>
                            </Popconfirm>
                        ]
                    })}
                />
            ) : (
            <Table
                rowKey='id'
                size='small'
                dataSource={visible}
                pagination={{ pageSize: 8, hideOnSinglePage: true }}
                locale={{
                    emptyText: (
                        <Empty
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description='No competencies yet. Add the competencies positions are assessed on, and managers can then pick them for each compact.'
                        />
                    )
                }}
                columns={[
                    {
                        title: 'Competency',
                        key: 'name',
                        render: (_: any, c: Competency) => (
                            <Space direction='vertical' size={0}>
                                <Text strong>{c.name}</Text>
                                {c.description ? <Text type='secondary' style={{ fontSize: 12 }}>{c.description}</Text> : null}
                            </Space>
                        )
                    },
                    {
                        title: 'Cluster',
                        key: 'cluster',
                        width: 130,
                        render: (_: any, c: Competency) => (
                            <Tag color={clusterColor(c.cluster)} style={{ borderRadius: 999 }}>
                                {clusterLabel(c.cluster)}
                            </Tag>
                        )
                    },
                    {
                        title: '',
                        key: 'actions',
                        width: 90,
                        align: 'right' as const,
                        render: (_: any, c: Competency) => (
                            <Space size={4}>
                                <Button type='text' icon={<EditOutlined />} onClick={() => startEdit(c)} aria-label='Edit' />
                                <Popconfirm title='Remove this competency?' okText='Remove' onConfirm={() => remove(c)}>
                                    <Button type='text' danger icon={<DeleteOutlined />} aria-label='Remove' />
                                </Popconfirm>
                            </Space>
                        )
                    }
                ]}
            />
            )}
        </Modal>
    )
}
