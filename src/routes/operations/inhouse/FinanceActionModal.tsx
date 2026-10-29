import React, { useEffect, useState } from 'react'
import {
    Button,
    Form,
    Input,
    InputNumber,
    Modal,
    Segmented,
    Space,
    Tag,
    Typography,
    Upload,
    message,
    theme
} from 'antd'
import { FileTextOutlined, InboxOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import {
    FINANCE_STEP_LABEL,
    FinanceRequestLike,
    FinanceUser,
    MovPackLike,
    approveInvoice,
    approveQuotation,
    decidePack,
    financeStepFor,
    rejectRequest
} from '@/lib/financeActions'

const { Text } = Typography
const { Dragger } = Upload

export type FinanceActionTarget =
    | { kind: 'request'; request: FinanceRequestLike }
    | { kind: 'pack'; pack: MovPackLike }

interface Props {
    target: FinanceActionTarget | null
    // Which side of the switch to open on
    initialMode?: 'approve' | 'reject'
    user?: FinanceUser | null
    onClose: () => void
    // After a successful save, e.g. to refresh a list the caller owns
    onDone?: () => void
}

// One quick modal for every finance step: approve a quote (amount), approve
// and pay an invoice (proof of payment), decide a MOV pack's invoice, or reject
// any of them with a reason.
const FinanceActionModal: React.FC<Props> = ({
    target,
    initialMode = 'approve',
    user,
    onClose,
    onDone
}) => {
    const { token } = theme.useToken()
    const [form] = Form.useForm()
    const [mode, setMode] = useState<'approve' | 'reject'>(initialMode)
    const [popFile, setPopFile] = useState<File | null>(null)
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        if (!target) return
        setMode(initialMode)
        setPopFile(null)
        form.resetFields()
        if (target.kind === 'request' && typeof target.request.amount === 'number') {
            form.setFieldsValue({ amount: target.request.amount })
        }
    }, [target, initialMode, form])

    if (!target) return null

    const request = target.kind === 'request' ? target.request : undefined
    const pack = target.kind === 'pack' ? target.pack : undefined
    const step = request ? financeStepFor(request.status) : undefined

    const title = request
        ? step
            ? FINANCE_STEP_LABEL[step]
            : 'Request'
        : 'Decide on invoice'
    const subject = request
        ? request.resourceName || 'Unnamed request'
        : `${pack?.department || 'Department'}${pack?.month ? ` · ${dayjs(pack.month).format('MMM YYYY')}` : ''}`

    // The document finance is deciding on
    const doc = request
        ? step === 'quote'
            ? request.quotationUrl && { label: 'Quotation', url: request.quotationUrl }
            : request.invoiceUrl && { label: 'Invoice', url: request.invoiceUrl }
        : pack?.invoice?.url && { label: pack.invoice.name || 'Invoice', url: pack.invoice.url }

    // Paying a request needs proof of payment (kept if one is already on record);
    // for MOV packs it's optional, as on the Departmental Invoices page
    const popRequired = step === 'invoice' && !request?.popUrl

    const submitLabel =
        mode === 'reject'
            ? 'Reject'
            : step === 'quote'
              ? 'Approve & request invoice'
              : step === 'invoice'
                ? 'Approve & mark paid'
                : 'Approve invoice'

    const handleSubmit = async () => {
        let values: Record<string, any>
        try {
            values = await form.validateFields()
        } catch {
            return
        }
        if (mode === 'approve' && popRequired && !popFile) {
            message.error('Please add the proof of payment.')
            return
        }
        setSaving(true)
        try {
            if (request) {
                if (mode === 'reject') await rejectRequest(request, values.reason, user)
                else if (step === 'quote')
                    await approveQuotation(request, { amount: values.amount, notes: values.notes }, user)
                else if (step === 'invoice')
                    await approveInvoice(
                        request,
                        { amount: values.amount, notes: values.notes, popFile },
                        user
                    )
            } else if (pack) {
                await decidePack(
                    pack,
                    mode === 'reject' ? 'rejected' : 'approved',
                    {
                        reason: values.reason,
                        amount: values.amount,
                        notes: values.notes,
                        popFile
                    },
                    user
                )
            }
            message.success(mode === 'reject' ? 'Rejected' : 'Approved')
            onDone?.()
            onClose()
        } catch (error: any) {
            console.error('Finance action failed:', error)
            message.error(error?.message || 'Action failed')
        } finally {
            setSaving(false)
        }
    }

    return (
        <Modal
            open
            onCancel={onClose}
            title={title}
            destroyOnClose
            footer={
                <Button
                    block
                    type='primary'
                    danger={mode === 'reject'}
                    loading={saving}
                    onClick={handleSubmit}
                >
                    {submitLabel}
                </Button>
            }
        >
            <Space direction='vertical' size={16} style={{ width: '100%' }}>
                <div>
                    <Text strong style={{ display: 'block' }} ellipsis>
                        {subject}
                    </Text>
                    <Space size={8} wrap style={{ marginTop: 4 }}>
                        {request?.branch && <Tag style={{ marginInlineEnd: 0 }}>{request.branch}</Tag>}
                        {doc ? (
                            <Button
                                size='small'
                                shape='round'
                                color='default'
                                variant='filled'
                                icon={<FileTextOutlined />}
                                href={doc.url}
                                target='_blank'
                                rel='noreferrer'
                            >
                                {doc.label}
                            </Button>
                        ) : (
                            <Text type='secondary' style={{ fontSize: 12 }}>
                                No document attached
                            </Text>
                        )}
                    </Space>
                </div>

                <Segmented
                    block
                    value={mode}
                    onChange={value => setMode(value as 'approve' | 'reject')}
                    options={[
                        { value: 'approve', label: 'Approve' },
                        { value: 'reject', label: 'Reject' }
                    ]}
                />

                <Form form={form} layout='vertical' requiredMark={false}>
                    {mode === 'reject' ? (
                        <Form.Item
                            name='reason'
                            label='Reason'
                            rules={[{ required: true, whitespace: true, message: 'Please give a reason' }]}
                            extra='The requester sees this with their request.'
                        >
                            <Input.TextArea rows={3} autoFocus />
                        </Form.Item>
                    ) : (
                        <>
                            <Form.Item
                                name='amount'
                                label={
                                    step === 'quote'
                                        ? 'Quoted amount'
                                        : step === 'invoice'
                                          ? 'Amount paid'
                                          : 'Amount (optional)'
                                }
                                rules={
                                    step === 'quote'
                                        ? [{ required: true, message: 'Enter the quoted amount' }]
                                        : []
                                }
                            >
                                <InputNumber
                                    min={0}
                                    prefix='R'
                                    style={{ width: '100%' }}
                                    placeholder='0.00'
                                />
                            </Form.Item>

                            {step !== 'quote' && (
                                <Form.Item
                                    label={`Proof of payment${popRequired ? '' : ' (optional)'}`}
                                    extra={
                                        request?.popUrl
                                            ? 'A proof of payment is already on record; adding one replaces it.'
                                            : undefined
                                    }
                                >
                                    <Dragger
                                        maxCount={1}
                                        accept='.pdf,.png,.jpg,.jpeg,.webp'
                                        beforeUpload={file => {
                                            setPopFile(file)
                                            return false
                                        }}
                                        onRemove={() => setPopFile(null)}
                                        fileList={
                                            popFile
                                                ? [{ uid: 'pop', name: popFile.name, status: 'done' }]
                                                : []
                                        }
                                        style={{ borderRadius: token.borderRadiusLG }}
                                    >
                                        <p className='ant-upload-drag-icon'>
                                            <InboxOutlined />
                                        </p>
                                        <p className='ant-upload-text'>
                                            Drop the proof of payment here, or click to choose
                                        </p>
                                        <p className='ant-upload-hint'>PDF or image</p>
                                    </Dragger>
                                </Form.Item>
                            )}

                            <Form.Item name='notes' label='Notes (optional)' style={{ marginBottom: 0 }}>
                                <Input.TextArea rows={2} />
                            </Form.Item>
                        </>
                    )}
                </Form>
            </Space>
        </Modal>
    )
}

export default FinanceActionModal
