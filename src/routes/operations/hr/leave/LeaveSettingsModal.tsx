import React, { useEffect, useState } from 'react'
import { Button, Col, DatePicker, Form, InputNumber, Modal, Row, Switch, message } from 'antd'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { addDoc, collection, doc, setDoc } from 'firebase/firestore'
import { db } from '@/firebase'
import { collapseDays, expandRanges } from './leavePolicy'
import type { LeaveSettings } from './types'

type Props = {
    open: boolean
    onClose: () => void
    settings: LeaveSettings
    settingsDocId: string | null
    onSaved: (settings: LeaveSettings, docId: string) => void
}

const CAP_FIELDS: Array<{ name: string; label: string }> = [
    { name: 'annual', label: 'Annual (per 12 months)' },
    { name: 'sick12', label: 'Sick (per 12 months)' },
    { name: 'sick24', label: 'Sick (per 24 months)' },
    { name: 'family', label: 'Family responsibility (per 12 months)' },
    { name: 'study', label: 'Study (per 12 months)' },
    { name: 'maternity', label: 'Maternity (per 24 months)' },
    { name: 'parental', label: 'Parental (per 12 months)' }
]

/** The leave policy: caps per type, sick-note rule and blackout periods. */
export const LeaveSettingsModal: React.FC<Props> = ({ open, onClose, settings, settingsDocId, onSaved }) => {
    const [form] = Form.useForm()
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        if (!open) return
        form.setFieldsValue({
            annual: settings.caps.annual,
            sick12: settings.caps.sick.per12,
            sick24: settings.caps.sick.per24,
            family: settings.caps.family,
            study: settings.caps.study,
            maternity: settings.caps.maternity,
            parental: settings.caps.parental,
            sickProofAfterDays: settings.sickProofAfterDays,
            autoApproveHalfDay: settings.autoApproveHalfDay,
            blackouts: collapseDays(settings.blackoutDates)
        })
    }, [open, settings, form])

    const save = async () => {
        const v = await form.validateFields()
        const payload: LeaveSettings = {
            type: 'leave',
            caps: {
                annual: v.annual,
                sick: { per12: v.sick12, per24: v.sick24 },
                family: v.family,
                study: v.study,
                maternity: v.maternity,
                parental: v.parental
            },
            sickProofAfterDays: v.sickProofAfterDays,
            autoApproveHalfDay: !!v.autoApproveHalfDay,
            // Every day of each period, so a range blocks all its days.
            blackoutDates: expandRanges((v.blackouts || []).filter(Boolean))
        }
        setSaving(true)
        try {
            let id = settingsDocId
            if (id) await setDoc(doc(db, 'system_settings', id), payload, { merge: true })
            else id = (await addDoc(collection(db, 'system_settings'), payload)).id
            onSaved(payload, id)
            message.success('Leave policy saved')
            onClose()
        } catch (error: any) {
            console.error('[leave] policy save failed', error)
            message.error(error?.code === 'permission-denied' ? 'You can’t change the leave policy.' : 'The policy didn’t save. Please try again.')
        } finally {
            setSaving(false)
        }
    }

    return (
        <Modal
            title='Leave policy'
            open={open}
            onCancel={onClose}
            onOk={save}
            okText='Save policy'
            okButtonProps={{ loading: saving }}
            width={760}
        >
            <Form form={form} layout='vertical'>
                <h4 className='ws-section-title'>Days allowed</h4>
                <Row gutter={16}>
                    {CAP_FIELDS.map(f => (
                        <Col xs={24} sm={12} md={8} key={f.name}>
                            <Form.Item name={f.name} label={f.label} rules={[{ required: true, message: 'Required' }]}>
                                <InputNumber min={0} max={365} style={{ width: '100%' }} />
                            </Form.Item>
                        </Col>
                    ))}
                </Row>

                <h4 className='ws-section-title'>Rules</h4>
                <Row gutter={16}>
                    <Col xs={24} sm={12}>
                        <Form.Item
                            name='sickProofAfterDays'
                            label='Sick note needed after (days)'
                            rules={[{ required: true, message: 'Required' }]}
                        >
                            <InputNumber min={0} max={30} style={{ width: '100%' }} />
                        </Form.Item>
                    </Col>
                    <Col xs={24} sm={12}>
                        <Form.Item name='autoApproveHalfDay' label='Auto-approve half-day sick leave' valuePropName='checked'>
                            <Switch />
                        </Form.Item>
                    </Col>
                </Row>

                <h4 className='ws-section-title'>Blackout periods</h4>
                <Form.List name='blackouts'>
                    {(fields, { add, remove }) => (
                        <>
                            {fields.map(field => (
                                <div key={field.key} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                                    <Form.Item {...field} noStyle rules={[{ required: true }]}>
                                        <DatePicker.RangePicker style={{ flex: 1 }} />
                                    </Form.Item>
                                    <Button icon={<DeleteOutlined />} onClick={() => remove(field.name)} aria-label='Remove period' />
                                </div>
                            ))}
                            <Button type='dashed' icon={<PlusOutlined />} onClick={() => add()} block>
                                Add blackout period
                            </Button>
                        </>
                    )}
                </Form.List>
            </Form>
        </Modal>
    )
}
