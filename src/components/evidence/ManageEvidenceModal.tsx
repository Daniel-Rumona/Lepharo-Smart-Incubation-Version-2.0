import React, { useEffect, useRef, useState } from 'react'
import { App, Button, Card, Col, Modal, Row, Skeleton, Space, Tag, Typography } from 'antd'
import { UploadOutlined } from '@ant-design/icons'
import { doc, getDoc, Timestamp, updateDoc } from 'firebase/firestore'
import { getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage'
import { db } from '@/firebase'
import EvidenceManagerPanel from '@/components/evidence/EvidenceManagerPanel'
import EvidenceFileRow from '@/components/interventions/EvidenceFileRow'
import { EvidenceCardTitle, evidenceCardProps, pillTag } from '@/components/interventions/EvidenceCardTitle'
import IncubateeBanner from '@/components/interventions/IncubateeBanner'
import ManageMovCard from '@/components/interventions/ManageMovCard'
import { DEFAULT_EVIDENCE_MODEL, resolveDeliverableName } from '@/services/evidenceModel'
import { syncUploadedPoesToIntervention } from '@/services/poeSyncService'

const { Text } = Typography

type Resource = { type?: string; label?: string; link: string; originalName?: string }

const canonical = (value: unknown) => {
    const raw = String(value || '').trim()
    try {
        return decodeURIComponent(raw).replace(/\/$/, '')
    } catch {
        return raw.replace(/\/$/, '')
    }
}

/**
 * One assignment's evidence, as on the facilitator's interventions page: the
 * POE on the left (add, replace, remove), the signed MOV on the right. Used
 * where a single intervention is open, e.g. an MOV on the MOVs page.
 */
export const ManageEvidenceModal: React.FC<{
    open: boolean
    assignedInterventionId: string | null
    companyName?: string | null
    participantId?: string | null
    programId?: string | null
    interventionTitle?: string | null
    onClose: () => void
    /** After anything was saved or removed. */
    onChanged?: () => void
}> = ({ open, assignedInterventionId, companyName, participantId, programId, interventionTitle, onClose, onChanged }) => {
    const { message } = App.useApp()
    const [record, setRecord] = useState<any | null>(null)
    const [loading, setLoading] = useState(false)
    const [pending, setPending] = useState<File[]>([])
    const [replaceLink, setReplaceLink] = useState<string | null>(null)
    const [saving, setSaving] = useState(false)
    const input = useRef<HTMLInputElement | null>(null)

    const load = async () => {
        if (!assignedInterventionId) return
        setLoading(true)
        try {
            const snap = await getDoc(doc(db, 'assignedInterventions', assignedInterventionId))
            setRecord(snap.exists() ? { id: snap.id, ...(snap.data() as any) } : null)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        if (!open) return
        setPending([])
        setReplaceLink(null)
        void load()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, assignedInterventionId])

    const resources: Resource[] = (Array.isArray(record?.resources) ? record.resources : []).filter((r: any) => r?.link)
    const named = record ? resolveDeliverableName(record, null, { ...DEFAULT_EVIDENCE_MODEL, deliverable: 'named' }) : null
    const deliverable = named?.isConfigured ? named.name : 'Proof of Execution (POE)'
    const addLabel = deliverable === 'Proof of Execution (POE)' ? 'POE' : deliverable

    const pick = (replace?: string) => {
        setReplaceLink(replace || null)
        input.current?.click()
    }

    const write = async (next: Resource[]) => {
        await updateDoc(doc(db, 'assignedInterventions', String(assignedInterventionId)), { resources: next, updatedAt: Timestamp.now() } as any)
    }

    const save = async () => {
        if (!assignedInterventionId || !pending.length) return
        setSaving(true)
        try {
            const uploaded = []
            for (const file of pending) {
                const path = `assignedInterventions/${assignedInterventionId}/evidence/${Date.now()}_${String(file.name || 'evidence').replace(/\s+/g, '_')}`
                const fileRef = ref(getStorage(), path)
                await uploadBytes(fileRef, file)
                uploaded.push({ name: file.name || 'Evidence', link: await getDownloadURL(fileRef) })
            }
            // Replacing one file: take it out first, then add the new ones as usual.
            if (replaceLink && replaceLink !== 'all') {
                await write(resources.filter(r => canonical(r.link) !== canonical(replaceLink)))
            }
            await syncUploadedPoesToIntervention({ assignedInterventionId, uploaded, replaceExisting: replaceLink === 'all' })
            message.success(`${uploaded.length} file${uploaded.length === 1 ? '' : 's'} saved.`)
            setPending([])
            setReplaceLink(null)
            await load()
            onChanged?.()
        } catch (error) {
            console.error(error)
            message.error('The files couldn’t be saved. Try again.')
        } finally {
            setSaving(false)
        }
    }

    const remove = async (resource: Resource) => {
        await write(resources.filter(r => canonical(r.link) !== canonical(resource.link)))
        message.success('Removed.')
        await load()
        onChanged?.()
    }

    return (
        <Modal
            open={open}
            title='Manage evidence'
            width='min(900px, calc(100vw - 20px))'
            centered
            onCancel={onClose}
            footer={pending.length ? (
                <Button block type='primary' shape='round' icon={<UploadOutlined />} loading={saving} onClick={save}>
                    Save {pending.length} file{pending.length === 1 ? '' : 's'}
                </Button>
            ) : null}
            destroyOnClose
        >
            <div style={{ marginBottom: 16 }}>
                <IncubateeBanner participantId={participantId || null} companyName={companyName} subtitle={interventionTitle || 'Untitled intervention'} />
            </div>
            {!assignedInterventionId ? (
                <Text type='secondary'>This MOV isn’t linked to its intervention, so evidence can’t be managed here. Ask the ROM team to repair it.</Text>
            ) : (
                <Row gutter={[20, 20]} align='top'>
                    <Col xs={24} md={12}>
                        <Card
                            {...evidenceCardProps}
                            style={{ ...evidenceCardProps.style, height: 'auto' }}
                            extra={<Tag style={pillTag}>Optional</Tag>}
                            title={<EvidenceCardTitle tone='optional' title={deliverable} />}
                        >
                            <Space direction='vertical' size={16} style={{ width: '100%' }}>
                                <Text type='secondary' style={{ fontSize: 13 }}>What was produced from this intervention.</Text>
                                <Button block shape='round' size='large' type='dashed' icon={<UploadOutlined />} loading={saving} onClick={() => pick()}>
                                    {pending.length ? 'Add more' : `Add ${addLabel}`}
                                </Button>
                                <input
                                    ref={input}
                                    type='file'
                                    hidden
                                    multiple
                                    accept='image/*,.pdf,.doc,.docx,.xls,.xlsx'
                                    onChange={e => {
                                        const files = Array.from(e.target.files || [])
                                        if (files.length) setPending(current => [...current, ...files])
                                        e.target.value = ''
                                    }}
                                />
                                {pending.length > 0 && (
                                    <div>
                                        <Text strong style={{ display: 'block', marginBottom: 6 }}>Ready to save ({pending.length})</Text>
                                        {replaceLink && (
                                            <Text type='secondary' style={{ display: 'block', fontSize: 12, marginBottom: 6 }}>
                                                These will replace the file you chose to replace.
                                            </Text>
                                        )}
                                        <Space direction='vertical' size={6} style={{ width: '100%' }}>
                                            {pending.map((file, index) => (
                                                <EvidenceFileRow
                                                    key={`${file.name}-${file.size}-${index}`}
                                                    name={file.name}
                                                    type={file.type}
                                                    size={file.size}
                                                    disabled={saving}
                                                    onRemove={() => setPending(current => {
                                                        const next = current.filter((_, at) => at !== index)
                                                        if (!next.length) setReplaceLink(null)
                                                        return next
                                                    })}
                                                />
                                            ))}
                                        </Space>
                                    </div>
                                )}
                                {loading ? (
                                    <Skeleton active paragraph={{ rows: 2 }} title={false} />
                                ) : resources.length ? (
                                    <EvidenceManagerPanel
                                        resources={resources}
                                        showHeader={false}
                                        showUpload={false}
                                        bare
                                        onReplace={resource => pick(resource.link)}
                                        onUpload={() => undefined}
                                        onRemove={remove}
                                        uploading={saving}
                                    />
                                ) : null}
                            </Space>
                        </Card>
                    </Col>
                    <Col xs={24} md={12}>
                        <ManageMovCard targets={[{ id: assignedInterventionId, name: String(companyName || 'SME'), programId: programId || null, participantId: participantId || null }]} />
                    </Col>
                </Row>
            )}
        </Modal>
    )
}

export default ManageEvidenceModal
