import React from 'react'
import { Alert, Button, Form, Input, Select, Upload } from 'antd'
import { UploadOutlined } from '@ant-design/icons'
import {
    COMPLETION_MAX_FILES,
    type InterventionCompletionContext
} from '@/services/interventionCompletionService'
import { SUPPORTED_RECURRENCE_OPTIONS } from '@/services/interventionRecurrenceService'

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
            {context.savedEvidence.length ? (
                <Alert
                    type="info"
                    showIcon
                    message="Evidence already saved to this intervention"
                    description={
                        <div>
                            <div style={{ marginBottom: 6 }}>
                                These files will be reused when you select Complete
                                intervention again. You do not need to upload them again.
                            </div>
                            <div
                                style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 4,
                                    maxHeight: 120,
                                    overflowY: 'auto'
                                }}
                            >
                                {context.savedEvidence.map((resource, index) => (
                                    <a
                                        key={`${resource.link}-${index}`}
                                        href={resource.link}
                                        target="_blank"
                                        rel="noreferrer"
                                    >
                                        {resource.originalName ||
                                            resource.label ||
                                            `Evidence file ${index + 1}`}
                                    </a>
                                ))}
                            </div>
                        </div>
                    }
                    style={{ marginBottom: 16 }}
                />
            ) : null}
            {context.requiresFiles ? (
                <Form.Item
                    name="files"
                    label="Proof of Execution"
                    valuePropName="fileList"
                    getValueFromEvent={(event) =>
                        Array.isArray(event) ? event : event?.fileList || []
                    }
                    extra={
                        context.missingEvidenceCount
                            ? `${context.missingEvidenceCount} assignment(s) need evidence.`
                            : 'You can reuse saved evidence or add more files.'
                    }
                    rules={[
                        {
                            validator: (_, value) =>
                                (Array.isArray(value) && value.length) ||
                                !context.missingEvidenceCount
                                    ? Promise.resolve()
                                    : Promise.reject(
                                          new Error(
                                              'Attach at least one POE file.'
                                          )
                                      )
                        }
                    ]}
                >
                    <Upload
                        multiple
                        beforeUpload={() => false}
                        maxCount={COMPLETION_MAX_FILES}
                        accept="image/*,.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx"
                    >
                        <Button icon={<UploadOutlined />}>
                            Choose POE files
                        </Button>
                    </Upload>
                </Form.Item>
            ) : null}
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
