import React, { useCallback, useEffect, useState } from 'react'
import {
    Button,
    Form,
    Input,
    InputNumber,
    Modal,
    Select,
    Space,
    Switch,
    Table,
    Tag,
    Typography,
    message
} from 'antd'
import { EditOutlined, PlusOutlined } from '@ant-design/icons'
import {
    collection,
    deleteField,
    doc,
    getDocs,
    serverTimestamp,
    setDoc
} from 'firebase/firestore'
import { db } from '@/firebase'
import { normalizeComplianceId } from '@/services/complianceResolver'

const { Paragraph, Text } = Typography

type Props = {
    canManage?: boolean
}

type AgreementRow = {
    id: string
    agreementId: string
    title: string
    renderer?: string
    signingRoute?: string
    availabilityDelayMonths?: number | null
    formNo?: string
    revisionNo?: string
    effectiveDate?: string
    version?: string
    active: boolean
}

export const AgreementTemplatesManager: React.FC<Props> = ({
    canManage = false
}) => {
    const [rows, setRows] = useState<AgreementRow[]>([])
    const [loading, setLoading] = useState(false)
    const [saving, setSaving] = useState(false)
    const [open, setOpen] = useState(false)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [form] = Form.useForm()

    const load = useCallback(async () => {
        setLoading(true)
        try {
            const snapshot = await getDocs(collection(db, 'agreementTemplates'))
            setRows(snapshot.docs
                .map(item => ({ id: item.id, ...(item.data() as any) }))
                .map(item => ({
                    ...item,
                    agreementId: normalizeComplianceId(item.agreementId || item.id),
                    active: item.active !== false
                })))
        } catch (error) {
            console.error(error)
            message.error('Could not load agreement templates.')
        } finally {
            setLoading(false)
        }
    }, [])

    useEffect(() => {
        void load()
    }, [load])

    const startCreate = () => {
        setEditingId(null)
        form.resetFields()
        form.setFieldsValue({ active: true, renderer: 'generic' })
        setOpen(true)
    }

    const startEdit = (row: AgreementRow) => {
        setEditingId(row.id)
        form.setFieldsValue(row)
        setOpen(true)
    }

    const save = async () => {
        const values = await form.validateFields()
        const agreementId = normalizeComplianceId(values.agreementId)
        if (!agreementId) return message.error('Enter a valid agreement ID.')

        setSaving(true)
        try {
            const recordId = editingId || agreementId
            await setDoc(doc(db, 'agreementTemplates', recordId), {
                agreementId,
                title: String(values.title).trim(),
                renderer: values.renderer || 'generic',
                signingRoute: String(values.signingRoute || '').trim(),
                availabilityDelayMonths: values.availabilityDelayMonths ?? null,
                version: String(values.version || '').trim(),
                formNo: String(values.formNo || '').trim(),
                revisionNo: String(values.revisionNo || '').trim(),
                effectiveDate: String(values.effectiveDate || '').trim(),
                content: deleteField(),
                active: values.active !== false,
                updatedAt: serverTimestamp()
            }, { merge: true })
            message.success('Agreement template saved.')
            setOpen(false)
            await load()
        } catch (error) {
            console.error(error)
            message.error('Could not save the agreement template.')
        } finally {
            setSaving(false)
        }
    }

    return (
        <>
            <Space direction='vertical' size={12} style={{ width: '100%' }}>
                <Space align='start' style={{ width: '100%', justifyContent: 'space-between' }}>
                    <div>
                        <Text strong>Agreement templates</Text>
                        <Paragraph type='secondary' style={{ marginBottom: 0 }}>
                            Canonical IDs are stored on requirements and signed records. Every agreement uses one ID everywhere.
                        </Paragraph>
                    </div>
                    {canManage && (
                        <Button type='primary' icon={<PlusOutlined />} onClick={startCreate}>
                            Add agreement
                        </Button>
                    )}
                </Space>

                <Table
                    rowKey='id'
                    loading={loading}
                    dataSource={rows}
                    pagination={false}
                    columns={[
                        { title: 'Agreement', dataIndex: 'title', key: 'title' },
                        {
                            title: 'Agreement ID',
                            dataIndex: 'agreementId',
                            key: 'agreementId',
                            render: value => <Text code>{value}</Text>
                        },
                        { title: 'Form No.', dataIndex: 'formNo', key: 'formNo', render: value => value || '—' },
                        { title: 'Revision No.', dataIndex: 'revisionNo', key: 'revisionNo', render: value => value || '—' },
                        { title: 'Effective Date', dataIndex: 'effectiveDate', key: 'effectiveDate', render: value => value || '—' },
                        {
                            title: 'Status',
                            dataIndex: 'active',
                            key: 'active',
                            render: active => <Tag color={active ? 'green' : 'default'}>{active ? 'Active' : 'Inactive'}</Tag>
                        },
                        ...(canManage ? [{
                            title: 'Actions',
                            key: 'actions',
                            render: (_: unknown, row: AgreementRow) => (
                                <Button icon={<EditOutlined />} onClick={() => startEdit(row)}>Edit</Button>
                            )
                        }] : [])
                    ]}
                />
            </Space>

            <Modal
                title={editingId ? 'Edit agreement template' : 'Add agreement template'}
                open={open}
                onCancel={() => setOpen(false)}
                onOk={save}
                confirmLoading={saving}
                width={760}
            >
                <Form form={form} layout='vertical'>
                    <Form.Item
                        name='agreementId'
                        label='Agreement ID'
                        rules={[{ required: true, message: 'Enter a canonical ID.' }]}
                        extra='Use one stable lowercase ID, for example pre-incubation-contract.'
                    >
                        <Input disabled={Boolean(editingId)} />
                    </Form.Item>
                    <Form.Item name='title' label='Display title' rules={[{ required: true }]}>
                        <Input />
                    </Form.Item>
                    <Space wrap align='start'>
                        <Form.Item name='renderer' label='Signing renderer'>
                            <Select style={{ width: 210 }} options={[
                                { value: 'generic', label: 'Configured signing route' },
                                { value: 'pre-incubation', label: 'Pre-Incubation workflow' },
                                { value: 'moa', label: 'MOA workflow' },
                                { value: 'gap-analysis', label: 'GAP Analysis workflow' },
                                { value: 'mov', label: 'MOV workflow' }
                            ]} />
                        </Form.Item>
                        <Form.Item name='availabilityDelayMonths' label='Available after (months)'>
                            <InputNumber min={0} precision={0} />
                        </Form.Item>
                        <Form.Item name='version' label='Version'>
                            <Input style={{ width: 150 }} placeholder='2026-01' />
                        </Form.Item>
                        <Form.Item name='active' label='Active' valuePropName='checked'>
                            <Switch />
                        </Form.Item>
                    </Space>
                    <Form.Item name='signingRoute' label='Signing route'>
                        <Input placeholder='/incubatee/moa' />
                    </Form.Item>
                    <Space wrap align='start'>
                        <Form.Item name='formNo' label='Form No.'>
                            <Input style={{ width: 250 }} placeholder='LEP-SIB QMS 057.1 F' />
                        </Form.Item>
                        <Form.Item name='revisionNo' label='Revision No.'>
                            <Input style={{ width: 150 }} placeholder='05' />
                        </Form.Item>
                        <Form.Item name='effectiveDate' label='Effective Date'>
                            <Input style={{ width: 210 }} placeholder='April 2026' />
                        </Form.Item>
                    </Space>
                </Form>
            </Modal>
        </>
    )
}
