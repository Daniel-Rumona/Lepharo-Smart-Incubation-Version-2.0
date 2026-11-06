import React from 'react'
import { Alert, Button, Card, Col, Form, Input, Row, Select, Space, Tag, Typography, Upload } from 'antd'
import { UploadOutlined } from '@ant-design/icons'
import type { UploadFile } from 'antd'
import {
    COMPLETION_MAX_FILES,
    type InterventionCompletionContext
} from '@/services/interventionCompletionService'
import { SUPPORTED_RECURRENCE_OPTIONS } from '@/services/interventionRecurrenceService'
import { DEFAULT_EVIDENCE_MODEL, resolveDeliverableName } from '@/services/evidenceModel'
import { missingMovAssignmentIds, splitMovRequirement } from '@/services/completionMovRules'
import EvidenceFileRow from '@/components/interventions/EvidenceFileRow'
import { EvidenceCardTitle, evidenceCardProps, pillTag } from '@/components/interventions/EvidenceCardTitle'

const { Text } = Typography

const fileOf = (file: UploadFile | undefined) => (file as any)?.originFileObj || file

/** MOV card body: one signed MOV per SME who received the intervention. */
const MovUploads: React.FC<{
    required: Array<Record<string, any>>
    value?: Record<string, UploadFile>
    onChange?: (next: Record<string, UploadFile>) => void
}> = ({ required, value = {}, onChange }) => (
    <Space direction='vertical' size={16} style={{ width: '100%' }}>
        {required.map(assignment => {
            const selected = value[assignment.id]
            const raw = fileOf(selected)
            const name = String(assignment.participantName || assignment.beneficiaryName || 'SME')
            return (
                <div key={assignment.id}>
                    {required.length > 1 ? (
                        <Text strong style={{ display: 'block', marginBottom: 6 }}>{name}</Text>
                    ) : null}
                    <Upload
                        className='completion-upload'
                        maxCount={1}
                        showUploadList={false}
                        beforeUpload={() => false}
                        fileList={selected ? [selected] : []}
                        onChange={({ fileList }) => {
                            const next = { ...value }
                            const picked = fileList.slice(-1)[0]
                            if (picked) next[assignment.id] = picked
                            else delete next[assignment.id]
                            onChange?.(next)
                        }}
                        accept='.pdf,.doc,.docx'
                    >
                        <Button block shape='round' size='large' type='dashed' icon={<UploadOutlined />}>
                            {selected ? 'Replace MOV' : required.length > 1 ? `Upload MOV for ${name}` : 'Upload signed MOV'}
                        </Button>
                    </Upload>
                    {selected ? (
                        <div style={{ marginTop: 12 }}>
                            <EvidenceFileRow
                                name={String(raw?.name || selected.name || 'MOV')}
                                type={raw?.type}
                                size={raw?.size}
                                onRemove={() => {
                                    const next = { ...value }
                                    delete next[assignment.id]
                                    onChange?.(next)
                                }}
                            />
                        </div>
                    ) : null}
                </div>
            )
        })}
    </Space>
)

/** POE card body: optional files, listed under the button; files already saved are shown read-only. */
const PoeUploads: React.FC<{
    saved: Array<{ link: string; label?: string; originalName?: string }>
    buttonLabel: string
    value?: UploadFile[]
    onChange?: (next: UploadFile[]) => void
}> = ({ saved, buttonLabel, value = [], onChange }) => (
    <Space direction='vertical' size={12} style={{ width: '100%' }}>
        <Upload
            className='completion-upload'
            multiple
            showUploadList={false}
            beforeUpload={() => false}
            fileList={value}
            maxCount={COMPLETION_MAX_FILES}
            onChange={({ fileList }) => onChange?.(fileList)}
            accept='image/*,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx'
        >
            <Button block shape='round' size='large' type='dashed' icon={<UploadOutlined />} title={buttonLabel}>
                {buttonLabel}
            </Button>
        </Upload>
        {saved.length || value.length ? (
            <Space direction='vertical' size={6} style={{ width: '100%' }}>
                {saved.map((resource, index) => (
                    <EvidenceFileRow
                        key={`${resource.link}-${index}`}
                        name={resource.originalName || resource.label || `Saved file ${index + 1}`}
                        href={resource.link}
                    />
                ))}
                {value.map(file => {
                    const raw = fileOf(file)
                    return (
                        <EvidenceFileRow
                            key={file.uid}
                            name={String(raw?.name || file.name)}
                            type={raw?.type}
                            size={raw?.size}
                            onRemove={() => onChange?.(value.filter(item => item.uid !== file.uid))}
                        />
                    )
                })}
            </Space>
        ) : null}
    </Space>
)

export default function InterventionCompletionFields({
    context,
    failureMessage
}: {
    context: InterventionCompletionContext | null
    failureMessage?: string
}) {
    if (!context)
        return (
            <Alert
                type="warning"
                message="Reopen completion to load the selected assignments."
            />
        )

    const { required: movRequired, notRequired: movNotRequired } = splitMovRequirement(context.assignments)
    // "Cash Flow Forecast" rather than "POE" when the intervention names its deliverable.
    const deliverable = resolveDeliverableName(
        context.assignments[0] as any,
        context.definitions.get(String(context.assignments[0]?.interventionId)) as any,
        { ...DEFAULT_EVIDENCE_MODEL, deliverable: 'named' }
    )

    return (
        <>
            {failureMessage ? (
                <Alert
                    type="warning"
                    showIcon
                    message="Completion needs to be retried"
                    description={failureMessage}
                    style={{ marginBottom: 16 }}
                />
            ) : null}
            {context.needsRecurrence ? (
                <Form.Item
                    name="recurrencePreset"
                    label="How often does this intervention take place?"
                    rules={[
                        {
                            required: true,
                            message: 'Select the intervention frequency.'
                        }
                    ]}
                    extra="This updates the main intervention definition and applies to its sub-interventions."
                >
                    <Select
                        placeholder="Select frequency"
                        options={[...SUPPORTED_RECURRENCE_OPTIONS]}
                    />
                </Form.Item>
            ) : null}

            <Row gutter={[20, 20]} style={{ marginBottom: 20 }}>
                <Col xs={24} md={context.requiresFiles ? 12 : 24}>
                    <Card
                        {...evidenceCardProps}
                        title={<EvidenceCardTitle title="MOV" tone="required" />}
                        extra={<Tag color="red" style={pillTag}>Required</Tag>}
                    >
                        <Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 16 }}>
                            Proof the service was delivered.{' '}
                            {movRequired.length > 1
                                ? 'Upload the signed MOV for each SME who received it.'
                                : 'Upload the signed MOV.'}
                        </Text>
                        <Form.Item
                            name="movs"
                            noStyle
                            rules={[
                                {
                                    validator: (_, value) =>
                                        missingMovAssignmentIds(movRequired, value || {}).length
                                            ? Promise.reject(
                                                  new Error(
                                                      movRequired.length > 1
                                                          ? 'Upload the signed MOV for every SME who received the intervention.'
                                                          : 'Upload the signed MOV.'
                                                  )
                                              )
                                            : Promise.resolve()
                                }
                            ]}
                        >
                            <MovUploads required={movRequired} />
                        </Form.Item>
                        {movNotRequired.length ? (
                            <Alert
                                type="info"
                                showIcon
                                style={{ marginTop: 10 }}
                                message={`${movNotRequired.length} SME${movNotRequired.length === 1 ? '' : 's'} did not receive this intervention, so no MOV is needed.`}
                            />
                        ) : null}
                    </Card>
                </Col>

                {context.requiresFiles ? (
                    <Col xs={24} md={12}>
                        <Card
                            {...evidenceCardProps}
                            title={
                                <EvidenceCardTitle
                                    title={deliverable.isConfigured ? deliverable.name : 'Proof of Execution (POE)'}
                                    tone="optional"
                                />
                            }
                            extra={<Tag style={pillTag}>Optional</Tag>}
                        >
                            <Text type="secondary" style={{ fontSize: 13, display: 'block', marginBottom: 16 }}>
                                {deliverable.isConfigured
                                    ? 'What was produced from this intervention. You can add it now or leave it out.'
                                    : 'Anything produced from this intervention. You can add it now or leave it out.'}
                            </Text>
                            <Form.Item
                                name="files"
                                noStyle
                                valuePropName="value"
                                getValueFromEvent={(next: UploadFile[]) => next}
                            >
                                <PoeUploads
                                    saved={context.savedEvidence}
                                    buttonLabel={`Add ${deliverable.isConfigured ? deliverable.name : 'POE'}`}
                                />
                            </Form.Item>
                        </Card>
                    </Col>
                ) : null}
            </Row>

            {context.requiresSummary ? (
                <Form.Item
                    name="notes"
                    label="Completion summary"
                    rules={[
                        {
                            required: true,
                            whitespace: true,
                            message: 'Add the completion summary.'
                        }
                    ]}
                >
                    <Input.TextArea
                        rows={4}
                        placeholder="Briefly summarise the delivered work and outcome."
                    />
                </Form.Item>
            ) : null}
        </>
    )
}
