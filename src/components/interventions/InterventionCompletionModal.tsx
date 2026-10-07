import React, { useEffect, useRef, useState } from 'react'
import { Alert, Button, Card, Col, Form, Modal, Progress, Row, Steps, Typography, message } from 'antd'
import { CheckCircleOutlined } from '@ant-design/icons'
import { db, storage } from '@/firebase'
import {
    completeIntervention,
    completionFailureEvidence,
    COMPLETION_SUCCESS_MESSAGE,
    interventionCompletionError,
    loadInterventionCompletionContext,
    mergeCompletionFailureContext,
    type InterventionCompletionContext
} from '@/services/interventionCompletionService'
import InterventionCompletionFields from '@/components/interventions/InterventionCompletionFields'

const { Text, Title } = Typography

export type InterventionCompletionTarget = {
    assignmentIds: string[]
    interventionTitle: string
    sessionsCompleted: number
    plannedSessions: number
    deliveryMethod?: string
}

type Props = {
    target: InterventionCompletionTarget | null
    user: { uid?: string; name?: string; email?: string; departmentName?: string } | null
    onClose: () => void
    onCompleted: (assignmentIds: string[]) => void
}

/**
 * Two-step completion flow (review, then evidence & completion) for use outside
 * the Appointments page, built on the same completion service and fields.
 */
const InterventionCompletionModal: React.FC<Props> = ({
    target,
    user,
    onClose,
    onCompleted
}) => {
    const [form] = Form.useForm()
    const [step, setStep] = useState<0 | 1>(0)
    const [context, setContext] = useState<InterventionCompletionContext | null>(null)
    const [failureMessage, setFailureMessage] = useState('')
    const [saving, setSaving] = useState(false)
    const savingRef = useRef(false)

    useEffect(() => {
        setStep(0)
        setContext(null)
        setFailureMessage('')
        form.resetFields()
    }, [target, form])

    const openEvidence = async () => {
        if (!target || savingRef.current) return
        savingRef.current = true
        setSaving(true)
        try {
            setContext(await loadInterventionCompletionContext(db, target.assignmentIds))
            setFailureMessage('')
            form.resetFields()
            setStep(1)
        } catch (error) {
            message.error(interventionCompletionError(error))
        } finally {
            savingRef.current = false
            setSaving(false)
        }
    }

    const submit = async (values: any) => {
        if (savingRef.current) return
        if (!target || !context) {
            message.error('Reopen completion to load the selected assignments.')
            return
        }
        savingRef.current = true
        setSaving(true)
        try {
            const result = await completeIntervention({
                db,
                storage,
                user: {
                    uid: user?.uid,
                    name: user?.name,
                    email: user?.email,
                    departmentName: user?.departmentName
                },
                assignmentIds: context.assignments.map(row => row.id),
                files: values.files,
                notes: values.notes,
                recurrencePreset: values.recurrencePreset,
                deliveryMethod: target.deliveryMethod
            })
            message.success(COMPLETION_SUCCESS_MESSAGE)
            onCompleted(result.assignmentIds)
        } catch (error) {
            console.error('[Intervention completion] Completion failed', error)
            const errorMessage = interventionCompletionError(error)
            setFailureMessage(errorMessage)
            setContext(previous => mergeCompletionFailureContext(previous, error))
            message.error({ content: errorMessage, duration: 8 })
            if (completionFailureEvidence(error).length) {
                void loadInterventionCompletionContext(
                    db,
                    context.assignments.map(row => row.id)
                )
                    .then(setContext)
                    .catch(refreshError =>
                        console.error('[Intervention completion] Could not refresh retained evidence', refreshError)
                    )
            }
        } finally {
            savingRef.current = false
            setSaving(false)
        }
    }

    return (
        <Modal
            wrapClassName='mobile-sheet'
            centered
            open={Boolean(target)}
            title={null}
            closable={false}
            maskClosable={false}
            keyboard={false}
            width={680}
            destroyOnClose
            footer={
                <Row gutter={[12, 12]}>
                    <Col xs={24} sm={10}>
                        <Button
                            block
                            disabled={saving}
                            onClick={() => {
                                if (step === 1) {
                                    setStep(0)
                                    setFailureMessage('')
                                    form.resetFields()
                                } else {
                                    onClose()
                                }
                            }}
                        >
                            {step === 1 ? 'Back' : 'Not yet'}
                        </Button>
                    </Col>
                    <Col xs={24} sm={14}>
                        <Button
                            block
                            type='primary'
                            icon={<CheckCircleOutlined />}
                            loading={saving}
                            onClick={() => (step === 0 ? void openEvidence() : form.submit())}
                        >
                            {step === 0 ? 'Continue to completion' : 'Complete intervention'}
                        </Button>
                    </Col>
                </Row>
            }
        >
            <Steps
                current={step}
                size='small'
                items={[{ title: 'Review' }, { title: 'Evidence & completion' }]}
                style={{ marginBottom: 20 }}
            />

            {step === 0 ? (
                <div style={{ padding: '8px 6px 4px' }}>
                    <div style={{ textAlign: 'center', marginBottom: 20 }}>
                        <CheckCircleOutlined style={{ fontSize: 48, color: '#52c41a' }} />
                        <Title level={3} style={{ margin: '10px 0 4px' }}>
                            Intervention progress reached 100%
                        </Title>
                        <Text type='secondary'>{target?.interventionTitle}</Text>
                    </div>

                    <Progress percent={100} status='success' strokeWidth={12} format={() => '100%'} />
                    <Text type='secondary' style={{ display: 'block', textAlign: 'center' }}>
                        {target?.sessionsCompleted || 0}/{target?.plannedSessions || 1} planned sessions attended
                    </Text>

                    <Row gutter={[12, 12]} style={{ marginTop: 18 }}>
                        {[
                            ['1', 'Review the carried-forward session notes and photos.'],
                            ['2', 'Add the required evidence or completion summary.'],
                            ['3', 'Confirm delivery details to create the MOV and request SME confirmation.']
                        ].map(([number, text]) => (
                            <Col xs={24} sm={8} key={number}>
                                <Card size='small' style={{ height: '100%', background: '#f7faff' }}>
                                    <Text strong style={{ display: 'block', marginBottom: 6 }}>
                                        Step {number}
                                    </Text>
                                    <Text>{text}</Text>
                                </Card>
                            </Col>
                        ))}
                    </Row>

                    <Alert
                        type='warning'
                        showIcon
                        style={{ marginTop: 16 }}
                        message='Reaching 100% does not close the intervention automatically.'
                        description='Continue when the work is genuinely complete and ready for final evidence and SME confirmation. Choose “Not yet” if more delivery is still needed.'
                    />
                </div>
            ) : (
                <Form
                    form={form}
                    layout='vertical'
                    onFinish={submit}
                    onFinishFailed={({ errorFields }) =>
                        message.warning(errorFields[0]?.errors?.[0] || 'Check the required completion fields.')
                    }
                    scrollToFirstError
                >
                    <InterventionCompletionFields context={context} failureMessage={failureMessage} />
                </Form>
            )}
        </Modal>
    )
}

export default InterventionCompletionModal
