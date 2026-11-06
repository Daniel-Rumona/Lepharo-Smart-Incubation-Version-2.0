import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
    Button,
    Col,
    Form,
    Grid,
    Input,
    InputNumber,
    Modal,
    Row,
    Select,
    Space,
    Switch,
    Table,
    Tag,
    Typography,
    message
} from 'antd'
import {
    CloseOutlined,
    EditOutlined,
    FileTextOutlined,
    KeyOutlined,
    LinkOutlined,
    PlusOutlined,
    SaveOutlined
} from '@ant-design/icons'
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
import { REGISTERED_SIGNING_ROUTES } from '@/services/signingRoutes'
import { MobileCardList } from '@/components/shared/MobileCardList'

const { Text } = Typography

/** Agreements whose signing form is built into the app and chosen by ID, not by route. */
const BUILT_IN_AGREEMENT_IDS = new Set(['pre-incubation-contract', 'moa', 'gap-analysis'])

type Props = {
    canManage?: boolean
    /** Filters the table by agreement title, ID or form number. */
    search?: string
    /** Bump this number to open the "add agreement" dialog from outside. */
    addSignal?: number
    /** Called after a template is saved, so parent counts can refresh. */
    onChanged?: () => void
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
    canManage = false,
    search = '',
    addSignal = 0,
    onChanged
}) => {
    const [rows, setRows] = useState<AgreementRow[]>([])
    const [loading, setLoading] = useState(false)
    const [saving, setSaving] = useState(false)
    const [open, setOpen] = useState(false)
    const [editingId, setEditingId] = useState<string | null>(null)
    const [form] = Form.useForm()
    const screens = Grid.useBreakpoint()
    const isMobile = !screens.md
    const watchedAgreementId = Form.useWatch('agreementId', form)
    const watchedSigningRoute = Form.useWatch('signingRoute', form)
    // Registered pages, plus the saved route if it is no longer registered so an
    // existing template does not silently lose its value.
    const signingRouteOptions = useMemo(() => {
        const options = REGISTERED_SIGNING_ROUTES.map(item => ({ value: item.value, label: item.label }))
        const current = String(watchedSigningRoute || '').trim()
        if (current && !options.some(item => item.value === current)) {
            options.push({ value: current, label: `${current} (not registered)` })
        }
        return options
    }, [watchedSigningRoute])
    const isBuiltIn = BUILT_IN_AGREEMENT_IDS.has(normalizeComplianceId(watchedAgreementId || ''))

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
        form.setFieldsValue({ active: true })
        setOpen(true)
    }

    useEffect(() => {
        if (addSignal > 0 && canManage) startCreate()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [addSignal])

    const visibleRows = useMemo(() => {
        const needle = search.trim().toLowerCase()
        if (!needle) return rows
        return rows.filter(row =>
            [row.title, row.agreementId, row.formNo, row.revisionNo]
                .filter(Boolean)
                .some(value => String(value).toLowerCase().includes(needle))
        )
    }, [rows, search])

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
            onChanged?.()
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

                {isMobile ? (
                    <MobileCardList
                        data={visibleRows}
                        loading={loading}
                        getKey={(row: AgreementRow) => row.id}
                        pageSize={8}
                        emptyText='No agreement templates'
                        renderCard={(row: AgreementRow) => ({
                            title: row.title,
                            subtitle: row.agreementId,
                            badge: <Tag color={row.active ? 'green' : 'default'}>{row.active ? 'Active' : 'Inactive'}</Tag>,
                            fields: [
                                { label: 'Form No.', value: row.formNo || '\u2014' },
                                { label: 'Revision No.', value: row.revisionNo || '\u2014' }
                            ],
                            actions: canManage
                                ? [
                                    <Button key='edit' icon={<EditOutlined />} onClick={() => startEdit(row)}>
                                        Edit
                                    </Button>
                                ]
                                : undefined
                        })}
                    />
                ) : (
                <Table
                    rowKey='id'
                    loading={loading}
                    dataSource={visibleRows}
                    pagination={{
                        pageSize: 8,
                        showSizeChanger: false,
                        position: ['bottomCenter']
                    }}
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
                )}
            </Space>

            <Modal
                title={editingId ? 'Edit Agreement Template' : 'Add Agreement Template'}
                open={open}
                onCancel={saving ? undefined : () => setOpen(false)}
                closable={!saving}
                footer={null}
                centered
                maskClosable={false}
                width={760}
                destroyOnClose
            >
                <Form form={form} layout='vertical' requiredMark disabled={saving}>
                    <Row gutter={16}>
                        <Col xs={24} md={12}>
                            <Form.Item
                                name='agreementId'
                                label='Agreement ID'
                                tooltip='A stable lowercase ID, e.g. pre-incubation-contract. It cannot be changed after saving.'
                                rules={[{ required: true, message: 'Enter an agreement ID' }]}
                            >
                                <Input
                                    prefix={<KeyOutlined />}
                                    placeholder='pre-incubation-contract'
                                    disabled={Boolean(editingId)}
                                />
                            </Form.Item>
                        </Col>
                        <Col xs={24} md={12}>
                            <Form.Item
                                name='title'
                                label='Display Title'
                                rules={[{ required: true, message: 'Enter a display title' }]}
                            >
                                <Input prefix={<FileTextOutlined />} placeholder='Pre-Incubation Contract' />
                            </Form.Item>
                        </Col>
                    </Row>

                    <Row gutter={16}>
                        <Col xs={24} md={10}>
                            <Form.Item
                                name='signingRoute'
                                label='Signing Page'
                                tooltip={
                                    isBuiltIn
                                        ? 'This agreement uses a form built into the system, so no page is needed.'
                                        : 'The page the SME is sent to when they press Sign. Pages are registered by the development team.'
                                }
                            >
                                <Select
                                    allowClear
                                    showSearch
                                    optionFilterProp='label'
                                    suffixIcon={<LinkOutlined />}
                                    disabled={isBuiltIn || signingRouteOptions.length === 0}
                                    placeholder={
                                        isBuiltIn
                                            ? 'Built-in form'
                                            : signingRouteOptions.length === 0
                                                ? 'No signing pages registered'
                                                : 'Select a signing page'
                                    }
                                    options={signingRouteOptions}
                                />
                            </Form.Item>
                        </Col>
                        <Col xs={12} md={8}>
                            <Form.Item
                                name='availabilityDelayMonths'
                                label='Available After'
                                tooltip='Hide this agreement from the SME until this many months after acceptance. Leave empty for immediately.'
                            >
                                <InputNumber min={0} precision={0} style={{ width: '100%' }} placeholder='Immediately' addonAfter='months' />
                            </Form.Item>
                        </Col>
                        <Col xs={12} md={6}>
                            <Form.Item name='active' label='Status' valuePropName='checked'>
                                <Switch checkedChildren='Active' unCheckedChildren='Inactive' />
                            </Form.Item>
                        </Col>
                    </Row>

                    <Row gutter={16}>
                        <Col xs={12} md={6}>
                            <Form.Item name='formNo' label='Form No.'>
                                <Input placeholder='LEP-SIB QMS 057.1 F' />
                            </Form.Item>
                        </Col>
                        <Col xs={12} md={6}>
                            <Form.Item name='version' label='Version'>
                                <Input placeholder='2026-01' />
                            </Form.Item>
                        </Col>
                        <Col xs={12} md={6}>
                            <Form.Item name='revisionNo' label='Revision No.'>
                                <Input placeholder='05' />
                            </Form.Item>
                        </Col>
                        <Col xs={12} md={6}>
                            <Form.Item name='effectiveDate' label='Effective Date'>
                                <Input placeholder='April 2026' />
                            </Form.Item>
                        </Col>
                    </Row>

                    <Row gutter={12}>
                        <Col span={12}>
                            <Button block icon={<CloseOutlined />} onClick={() => setOpen(false)} disabled={saving}>
                                Cancel
                            </Button>
                        </Col>
                        <Col span={12}>
                            <Button
                                block
                                type='primary'
                                icon={editingId ? <SaveOutlined /> : <PlusOutlined />}
                                loading={saving}
                                onClick={save}
                            >
                                {editingId ? 'Save Changes' : 'Create Template'}
                            </Button>
                        </Col>
                    </Row>
                </Form>
            </Modal>
        </>
    )
}
