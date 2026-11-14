import React, { useEffect, useState } from 'react'
import { Alert, Button, Checkbox, Col, DatePicker, Divider, Form, Input, InputNumber, Modal, Row, Select, Space, Upload, message } from 'antd'
import { RobotOutlined, SaveOutlined, UploadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { SA_SECTORS } from '@/routes/shared/incubatees/participantsData'
import {
    SA_PROVINCES,
    STAGES,
    createOpportunity,
    extractOpportunity,
    updateOpportunity,
    type Opportunity,
    type OpportunityDraft,
    type OpportunityInput
} from '@/services/marketLinkage'

type Props = {
    open: boolean
    editing: Opportunity | null
    uid: string
    /** The active programme; a new opportunity is matched against its SMEs. */
    programId: string | null
    onClose: () => void
    onSaved: (id: string) => void
}

const COMMON_DOCUMENTS = [
    'Tax compliance status PIN', 'B-BBEE certificate or affidavit', 'CIPC registration documents',
    'Bank confirmation letter', 'COID letter of good standing', 'CIDB grading', 'Proof of insurance'
]

const formValues = (o: Opportunity | null) => o ? {
    title: o.title,
    buyer: o.buyer,
    reference: o.reference,
    summary: o.summary,
    location: o.location,
    value: o.value,
    closingDate: o.closingDate ? dayjs(o.closingDate) : null,
    sectors: o.requirements.sectors,
    provinces: o.requirements.provinces,
    documents: o.requirements.documents,
    maxBeeLevel: o.requirements.maxBeeLevel,
    black: o.requirements.ownership.black ?? null,
    women: o.requirements.ownership.women ?? null,
    youth: o.requirements.ownership.youth ?? null,
    requireCsd: o.requirements.requireCsd,
    minStage: o.requirements.minStage
} : { sectors: [], provinces: [], documents: [], requireCsd: false }

/**
 * New or edit opportunity. Pasting the RFQ text or uploading the document lets
 * the assistant fill the form; nothing is saved until the officer reviews it.
 */
export const OpportunityForm: React.FC<Props> = ({ open, editing, uid, programId, onClose, onSaved }) => {
    const [form] = Form.useForm()
    const [text, setText] = useState('')
    const [file, setFile] = useState<File | null>(null)
    const [reading, setReading] = useState(false)
    const [saving, setSaving] = useState(false)
    const [warnings, setWarnings] = useState<string[]>([])

    useEffect(() => {
        if (!open) return
        form.resetFields()
        form.setFieldsValue(formValues(editing))
        setText('')
        setFile(null)
        setWarnings([])
    }, [open, editing, form])

    const applyDraft = (draft: OpportunityDraft) => {
        form.setFieldsValue({
            title: draft.title,
            buyer: draft.buyer,
            reference: draft.reference,
            summary: draft.summary,
            location: draft.location,
            value: draft.value,
            closingDate: draft.closingDate ? dayjs(draft.closingDate) : null,
            sectors: draft.sectors,
            provinces: draft.provinces,
            documents: draft.documents,
            maxBeeLevel: draft.maxBeeLevel,
            black: draft.ownership.black,
            women: draft.ownership.women,
            youth: draft.ownership.youth,
            requireCsd: draft.requireCsd
        })
        setWarnings(draft.warnings)
    }

    const read = async () => {
        if (!file && !text.trim()) {
            message.info('Paste the opportunity text or choose a document first.')
            return
        }
        setReading(true)
        try {
            applyDraft(await extractOpportunity(file ? { file } : { text }))
            message.success('Filled in from the document. Please check it before saving.')
        } catch (e: any) {
            message.error(e?.message || 'The assistant could not read it. Fill the form in yourself.')
        } finally {
            setReading(false)
        }
    }

    const save = async () => {
        let v: any
        try {
            v = await form.validateFields()
        } catch {
            return
        }
        const num = (value: unknown) => (value === null || value === undefined || value === '' ? null : Number(value))
        const input: OpportunityInput = {
            title: v.title || '',
            buyer: v.buyer || '',
            reference: v.reference || '',
            summary: v.summary || '',
            location: v.location || '',
            value: v.value || '',
            closingDate: v.closingDate ? v.closingDate.endOf('day').toDate() : null,
            requirements: {
                sectors: v.sectors || [],
                provinces: v.provinces || [],
                documents: (v.documents || []).map((d: string) => d.trim()).filter(Boolean),
                maxBeeLevel: num(v.maxBeeLevel),
                ownership: { black: num(v.black), women: num(v.women), youth: num(v.youth) },
                requireCsd: !!v.requireCsd,
                minStage: v.minStage || null
            }
        }
        setSaving(true)
        try {
            if (editing) {
                await updateOpportunity(editing.id, input)
                onSaved(editing.id)
            } else {
                onSaved(await createOpportunity(input, uid, programId))
            }
            message.success(editing ? 'Opportunity updated. Run the match again.' : 'Opportunity saved.')
        } catch (e) {
            console.error('[market-linkage] save failed', e)
            message.error('Could not save the opportunity.')
        } finally {
            setSaving(false)
        }
    }

    return (
        <Modal
            open={open}
            onCancel={onClose}
            width='min(760px, 96vw)'
            centered
            wrapClassName='mobile-sheet'
            title={editing ? 'Edit opportunity' : 'New opportunity'}
            destroyOnClose
            styles={{ body: { maxHeight: '72vh', overflowY: 'auto', paddingRight: 4 } }}
            footer={[
                <Button key='cancel' onClick={onClose} disabled={saving}>Cancel</Button>,
                <Button key='save' type='primary' icon={<SaveOutlined />} loading={saving} onClick={save}>Save</Button>
            ]}
        >
            {!editing && (
                <>
                    <Input.TextArea
                        value={text}
                        onChange={e => setText(e.target.value)}
                        autoSize={{ minRows: 3, maxRows: 8 }}
                        placeholder='Paste the RFQ, tender notice or the buyer’s email here'
                        disabled={!!file}
                    />
                    <Space style={{ marginTop: 8 }} wrap>
                        <Upload
                            accept='.pdf,.docx,.txt'
                            maxCount={1}
                            beforeUpload={f => {
                                setFile(f)
                                return false
                            }}
                            onRemove={() => setFile(null)}
                            fileList={file ? [{ uid: '1', name: file.name, status: 'done' }] : []}
                        >
                            <Button icon={<UploadOutlined />}>Or upload the document</Button>
                        </Upload>
                        <Button type='primary' ghost icon={<RobotOutlined />} loading={reading} onClick={read}>
                            Fill in with AI
                        </Button>
                    </Space>
                    <Divider />
                </>
            )}

            {warnings.length > 0 && (
                <Alert style={{ marginBottom: 12 }} type='warning' showIcon message='Check these' description={<ul style={{ margin: 0, paddingLeft: 18 }}>{warnings.map(w => <li key={w}>{w}</li>)}</ul>} />
            )}

            <Form form={form} layout='vertical' requiredMark={false}>
                <Row gutter={12}>
                    <Col xs={24}>
                        <Form.Item name='title' label='Title' rules={[{ required: true, message: 'Give the opportunity a title' }]}>
                            <Input placeholder='e.g. Supply of PPE to the Rustenburg mine' />
                        </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                        <Form.Item name='buyer' label='Buyer'><Input /></Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                        <Form.Item name='reference' label='Reference number'><Input /></Form.Item>
                    </Col>
                    <Col xs={24}>
                        <Form.Item name='summary' label='Scope of work'>
                            <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} />
                        </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                        <Form.Item name='closingDate' label='Closing date' rules={[{ required: true, message: 'When does it close?' }]}>
                            <DatePicker style={{ width: '100%' }} format='D MMM YYYY' />
                        </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                        <Form.Item name='value' label='Value'><Input placeholder='e.g. R250 000' /></Form.Item>
                    </Col>
                    <Col xs={24}>
                        <Form.Item name='location' label='Location'><Input /></Form.Item>
                    </Col>
                </Row>

                <Divider orientation='left' plain>Who can supply it</Divider>
                <Row gutter={12}>
                    <Col xs={24} sm={12}>
                        <Form.Item name='sectors' label='Sectors' extra='Empty means any sector'>
                            <Select mode='multiple' allowClear options={SA_SECTORS.map(s => ({ value: s, label: s }))} />
                        </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                        <Form.Item name='provinces' label='Provinces' extra='Empty means anywhere'>
                            <Select mode='multiple' allowClear options={SA_PROVINCES.map(p => ({ value: p, label: p }))} />
                        </Form.Item>
                    </Col>
                    <Col xs={24}>
                        <Form.Item name='documents' label='Required documents' extra='Each must still be valid on the closing date'>
                            <Select mode='tags' allowClear options={COMMON_DOCUMENTS.map(d => ({ value: d, label: d }))} />
                        </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                        <Form.Item name='maxBeeLevel' label='B-BBEE level or better'>
                            <Select allowClear placeholder='Any level' options={[1, 2, 3, 4, 5, 6, 7, 8].map(l => ({ value: l, label: `Level ${l} or better` }))} />
                        </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                        <Form.Item name='minStage' label='Minimum readiness'>
                            <Select allowClear placeholder='Any stage' options={STAGES.map(s => ({ value: s.key, label: s.label }))} />
                        </Form.Item>
                    </Col>
                    <Col xs={8}>
                        <Form.Item name='black' label='Black-owned ≥'><InputNumber min={0} max={100} addonAfter='%' style={{ width: '100%' }} /></Form.Item>
                    </Col>
                    <Col xs={8}>
                        <Form.Item name='women' label='Women-owned ≥'><InputNumber min={0} max={100} addonAfter='%' style={{ width: '100%' }} /></Form.Item>
                    </Col>
                    <Col xs={8}>
                        <Form.Item name='youth' label='Youth-owned ≥'><InputNumber min={0} max={100} addonAfter='%' style={{ width: '100%' }} /></Form.Item>
                    </Col>
                    <Col xs={24}>
                        <Form.Item name='requireCsd' valuePropName='checked'>
                            <Checkbox>CSD registration required</Checkbox>
                        </Form.Item>
                    </Col>
                </Row>
            </Form>
        </Modal>
    )
}
