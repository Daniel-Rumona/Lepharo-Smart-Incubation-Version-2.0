import React, { useEffect, useState } from 'react'
import {
    Alert,
    Button,
    Card,
    Checkbox,
    Col,
    Divider,
    Form,
    Grid,
    Input,
    Modal,
    Row,
    Space,
    Tag,
    Typography,
    Upload,
    message
} from 'antd'
import type { UploadFile } from 'antd'
import { UploadOutlined, EyeOutlined } from '@ant-design/icons'
import { doc, getDoc } from 'firebase/firestore'
import { getDownloadURL, getStorage, ref as storageRef, uploadBytes } from 'firebase/storage'
import { db } from '@/firebase'
import { workflowQueryService } from '@/services/workflowQueryService'
import {
    collectPoeUrlsFromRecord,
    findAssignedInterventionForMov,
    findAssignedInterventionRecordForMov,
    resolveInterventionRecords,
    syncUploadedPoesToIntervention,
    syncUploadedPoesToMov,
    type PoeResource,
    type UploadedPoe
} from '@/services/poeSyncService'

const { Text, Paragraph } = Typography

// Narrow, structural shape covering every page-local `QueryDoc` type in the
// app (they all differ slightly - flattened aliases vs. nested target/context)
// so this modal can accept any of them without callers needing to cast.
export type ResolvableQuery = {
    id: string
    programId?: string | null
    type?: string | null
    queryType?: string | null
    message?: string | null
    queryMessage?: string | null
    targetType?: string | null
    movId?: string | null
    interventionId?: string | null
    target?: {
        type?: string | null
        id?: string | null
        parentType?: string | null
        parentId?: string | null
    } | null
}

// Static per-type rules (matches what the old dedicated Queries page used),
// with a keyword fallback for any query type this table doesn't know about
// (matches the heuristic the MOVs page used).
const QUERY_TYPE_FILE_RULES: Record<string, boolean> = {
    'completion-rejected': true,
    'completion-rejection': true,
    'mov-request': true,
    'poe-request': true,
    'mov-issue': false,
    'general-query': false,
    'me-query': true,
    'cc-poe-query': true,
    'cc-pack-query': true
}

const queryRequiresFile = (q?: ResolvableQuery | null) => {
    if (!q) return false
    const type = String((q as any).queryType || (q as any).type || '').trim().toLowerCase()
    if (type in QUERY_TYPE_FILE_RULES) return QUERY_TYPE_FILE_RULES[type]
    const targetType = String((q as any).targetType || (q as any).target?.type || '').trim().toLowerCase()
    return /(poe|proof|evidence|document|attachment|file)/.test(`${type} ${targetType}`)
}

const normalizePoeResources = (record: any): PoeResource[] => {
    if (!record) return []
    if (Array.isArray(record.resources) && record.resources.length) {
        return record.resources.filter((resource: any) => resource?.link)
    }
    return collectPoeUrlsFromRecord(record).map((link, index) => ({
        type: 'poe',
        label: `POE ${index + 1}`,
        link
    }))
}

// Uploaded POEs commonly end up on the linked assignedIntervention or
// assignedInterventions record rather than the MOV doc itself, so
// the "current evidence" preview has to union all three, deduped by link.
const mergePoeResourceLists = (records: any[]): PoeResource[] => {
    const byLink = new Map<string, PoeResource>()
    records.forEach(record => {
        normalizePoeResources(record).forEach(resource => {
            if (resource?.link) byLink.set(resource.link, resource)
        })
    })
    return Array.from(byLink.values())
}

type EvidenceContext =
    | { kind: 'mov'; mov: any; existingPoes: PoeResource[] }
    | { kind: 'intervention'; assignedInterventionId: string; existingPoes: PoeResource[] }
    | { kind: 'none' }

const loadEvidenceContext = async (q: ResolvableQuery): Promise<EvidenceContext> => {
    const targetType = String((q as any).target?.type || (q as any).targetType || '').trim()
    const parentType = String((q as any).target?.parentType || '').trim()

    if (targetType === 'mov' || targetType === 'mov-pack' || (targetType === 'poe' && parentType !== 'intervention')) {
        const movId = String(
            (targetType === 'mov' || targetType === 'poe' ? (q as any).target?.id : '') ||
            (q as any).movId ||
            ''
        ).trim()

        if (movId) {
            const snap = await getDoc(doc(db, 'movDocuments', movId))
            if (snap.exists()) {
                const mov = { id: snap.id, ...(snap.data() as any) }
                const programId = (q as any).programId || mov.programId || null
                const assignment = await findAssignedInterventionForMov(mov, programId)
                const deliveryRecord = await findAssignedInterventionRecordForMov({
                    mov,
                    assignedInterventionId: assignment?.record?.id || mov?.assignedInterventionId || null,
                    programId
                })

                return {
                    kind: 'mov',
                    mov,
                    existingPoes: mergePoeResourceLists([
                        mov,
                        assignment?.record,
                        deliveryRecord?.record
                    ])
                }
            }
        }

        return { kind: 'none' }
    }

    if (['assigned-intervention', 'intervention', 'completion'].includes(targetType)) {
        const assignedInterventionId = String(
            (q as any).target?.id || (q as any).interventionId || ''
        ).trim()

        if (assignedInterventionId) {
            const { assignmentRecord, deliveryRecord } = await resolveInterventionRecords(assignedInterventionId)
            if (assignmentRecord) {
                return {
                    kind: 'intervention',
                    assignedInterventionId,
                    existingPoes: mergePoeResourceLists([assignmentRecord, deliveryRecord])
                }
            }
        }

        return { kind: 'none' }
    }

    return { kind: 'none' }
}

export type ResolveQueryModalActor = {
    id: string
    name?: string | null
    email?: string | null
    role?: string | null
    departmentName?: string | null
}

export type ResolveQueryModalProps = {
    open: boolean
    query: ResolvableQuery | null
    actor: ResolveQueryModalActor
    onClose: () => void
    onResolved?: (queryId: string) => void
    width?: number | string
}

const ResolveQueryModal: React.FC<ResolveQueryModalProps> = ({
    open,
    query,
    actor,
    onClose,
    onResolved,
    width
}) => {
    const screens = Grid.useBreakpoint()
    const [form] = Form.useForm()
    const [files, setFiles] = useState<UploadFile[]>([])
    const [submitting, setSubmitting] = useState(false)
    const [contextLoading, setContextLoading] = useState(false)
    const [evidenceContext, setEvidenceContext] = useState<EvidenceContext>({ kind: 'none' })

    useEffect(() => {
        if (!open || !query) return

        form.resetFields()
        setFiles([])
        setEvidenceContext({ kind: 'none' })

        let cancelled = false
        setContextLoading(true)

        loadEvidenceContext(query)
            .then(ctx => {
                if (!cancelled) setEvidenceContext(ctx)
            })
            .catch(() => {
                if (!cancelled) setEvidenceContext({ kind: 'none' })
            })
            .finally(() => {
                if (!cancelled) setContextLoading(false)
            })

        return () => {
            cancelled = true
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, query?.id])

    const requiresFile = queryRequiresFile(query)
    const existingPoes = evidenceContext.kind !== 'none' ? evidenceContext.existingPoes : []

    const uploadEvidence = async (file: File): Promise<UploadedPoe> => {
        const storage = getStorage()
        const safeName = String(file.name || 'evidence').replace(/\s+/g, '_')
        const path = `workflowQueries/${(query as any)?.programId || 'no-program'}/${query?.id}/${Date.now()}_${safeName}`
        const rf = storageRef(storage, path)
        await uploadBytes(rf, file)
        return { name: file.name || 'Evidence', link: await getDownloadURL(rf) }
    }

    const handleSubmit = async (values: { resolutionNotes: string; replaceExisting?: boolean }) => {
        if (!query) return

        if (requiresFile && !files.length) {
            message.warning('Please attach the requested document(s) before resolving.')
            return
        }

        setSubmitting(true)
        try {
            const uploaded: UploadedPoe[] = []
            for (const file of files) {
                const raw = file.originFileObj as File | undefined
                if (!raw) continue
                uploaded.push(await uploadEvidence(raw))
            }

            if (uploaded.length) {
                if (evidenceContext.kind === 'mov') {
                    await syncUploadedPoesToMov({
                        mov: evidenceContext.mov,
                        programId: (query as any)?.programId || null,
                        uploaded,
                        replaceExisting: !!values.replaceExisting
                    })
                } else if (evidenceContext.kind === 'intervention') {
                    await syncUploadedPoesToIntervention({
                        assignedInterventionId: evidenceContext.assignedInterventionId,
                        uploaded,
                        replaceExisting: !!values.replaceExisting
                    })
                }
            }

            await workflowQueryService.resolve(query.id, {
                notes: values.resolutionNotes || '',
                attachmentUrl: uploaded[0]?.link || null,
                actorId: actor.id,
                actor: {
                    name: actor.name || null,
                    email: actor.email || null,
                    role: actor.role || null,
                    departmentName: actor.departmentName || null
                }
            })

            message.success('Query resolved.')
            onResolved?.(query.id)
            onClose()
        } catch (error) {
            console.error(error)
            message.error('Failed to resolve query.')
        } finally {
            setSubmitting(false)
        }
    }

    return (
        <Modal
            open={open}
            onCancel={onClose}
            title="Resolve Query"
            width={width ?? (screens.xs ? '100%' : 900)}
            okText="Resolve Query"
            onOk={() => form.submit()}
            confirmLoading={submitting}
            okButtonProps={{ disabled: contextLoading }}
            cancelButtonProps={{ disabled: submitting }}
            destroyOnClose
        >
            <Alert
                type={requiresFile ? 'warning' : 'info'}
                showIcon
                message={requiresFile
                    ? 'This query requires supporting document(s) or POE before it can be resolved.'
                    : 'Add supporting documents when needed, or resolve this query with notes only.'}
                description="Uploaded files are saved as evidence on the linked record. Existing evidence is kept unless Replace current evidence is selected."
                style={{ marginBottom: 16 }}
            />

            <Row gutter={[16, 16]}>
                <Col xs={24} md={10}>
                    <Card size="small">
                        <Space direction="vertical" size={8} style={{ width: '100%' }}>
                            <Tag color="blue">{String((query as any)?.queryType || (query as any)?.type || 'Query').replace(/[-_]/g, ' ')}</Tag>
                            <Paragraph style={{ marginBottom: 0 }}>
                                {(query as any)?.queryMessage || (query as any)?.message || 'No details provided.'}
                            </Paragraph>

                            {existingPoes.length ? (
                                <>
                                    <Divider style={{ margin: '8px 0' }} />
                                    <Text strong>Current evidence ({existingPoes.length})</Text>
                                    <Space direction="vertical" size={4} style={{ width: '100%' }}>
                                        {existingPoes.map((resource, index) => (
                                            <Button
                                                key={`${resource.link}-${index}`}
                                                size="small"
                                                icon={<EyeOutlined />}
                                                onClick={() => window.open(resource.link, '_blank')}
                                            >
                                                {resource.label || `View ${index + 1}`}
                                            </Button>
                                        ))}
                                    </Space>
                                </>
                            ) : null}
                        </Space>
                    </Card>
                </Col>

                <Col xs={24} md={14}>
                    <Card size="small">
                        <Form
                            form={form}
                            layout="vertical"
                            onFinish={handleSubmit}
                            initialValues={{ replaceExisting: false }}
                        >
                            <Form.Item
                                label="Supporting documents / evidence"
                                required={requiresFile}
                                extra="You can upload PDF, image, Word, or Excel files."
                            >
                                <Upload
                                    multiple
                                    maxCount={10}
                                    beforeUpload={() => false}
                                    fileList={files}
                                    onChange={({ fileList }) => setFiles(fileList)}
                                    accept="image/*,.pdf,.doc,.docx,.xls,.xlsx"
                                >
                                    <Button icon={<UploadOutlined />} loading={submitting}>Choose Files</Button>
                                </Upload>
                            </Form.Item>

                            {existingPoes.length ? (
                                <Form.Item name="replaceExisting" valuePropName="checked">
                                    <Checkbox>Replace current evidence with the uploaded file(s)</Checkbox>
                                </Form.Item>
                            ) : null}

                            <Form.Item
                                label="Resolution notes"
                                name="resolutionNotes"
                                rules={[{ required: true, message: 'Please enter resolution notes.' }]}
                            >
                                <Input.TextArea rows={5} placeholder="Explain what was corrected, updated, or supplied for review." />
                            </Form.Item>
                        </Form>
                    </Card>
                </Col>
            </Row>
        </Modal>
    )
}

export default ResolveQueryModal
