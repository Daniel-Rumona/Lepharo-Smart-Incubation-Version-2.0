import React, { useCallback, useEffect, useState } from 'react'
import { Button, Card, Skeleton, Space, Tag, Typography, Upload, message } from 'antd'
import { UploadOutlined } from '@ant-design/icons'
import { collection, deleteField, doc, getDocs, query, Timestamp, updateDoc, where } from 'firebase/firestore'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { db, storage } from '@/firebase'
import { COMPLETION_MAX_FILE_SIZE_BYTES } from '@/services/interventionCompletionService'
import EvidenceFileRow from '@/components/interventions/EvidenceFileRow'
import { EvidenceCardTitle, evidenceCardProps, pillTag } from '@/components/interventions/EvidenceCardTitle'

const { Text } = Typography

export type MovTarget = { id: string; name: string; programId?: string | null; participantId?: string | null }

const STATUS: Record<string, { label: string; color: string }> = {
    awaiting_smme: { label: 'Awaiting SME', color: 'gold' },
    awaiting_hod: { label: 'Awaiting HOD', color: 'purple' },
    approved: { label: 'Approved', color: 'green' },
    queried: { label: 'Queried', color: 'orange' },
    rejected: { label: 'Rejected', color: 'red' },
    draft: { label: 'Draft', color: 'default' }
}

const safe = (value: unknown, fallback: string) =>
    String(value || fallback).trim().replace(/[\\/#?%]+/g, '_') || fallback

/**
 * The signed MOV on each assignment, kept apart from the POE. It can be added,
 * replaced or removed until the HOD approves it; after that it is locked, because
 * the approval was given for that file.
 */
export const ManageMovCard: React.FC<{ targets: MovTarget[] }> = ({ targets }) => {
    const [movs, setMovs] = useState<Record<string, any>>({})
    const [loading, setLoading] = useState(true)
    const [busy, setBusy] = useState<string | null>(null)
    const [reload, setReload] = useState(0)

    const ids = targets.map(target => target.id).join('|')

    useEffect(() => {
        let cancelled = false
        const idList = ids ? ids.split('|') : []
        setLoading(true)
        ;(async () => {
            const found: Record<string, any> = {}
            // "in" takes at most ten values, so a large group is read in chunks.
            for (let start = 0; start < idList.length; start += 10) {
                const snapshot = await getDocs(
                    query(collection(db, 'movDocuments'), where('assignedInterventionId', 'in', idList.slice(start, start + 10)))
                )
                snapshot.docs.forEach(item => {
                    const data = item.data() as any
                    const key = String(data.assignedInterventionId || '')
                    const current = found[key]
                    const createdAt = data.createdAt?.toMillis?.() || 0
                    if (!current || createdAt > (current.createdAt?.toMillis?.() || 0)) found[key] = { ...data, id: item.id }
                })
            }
            if (!cancelled) setMovs(found)
        })()
            .catch(error => {
                console.error('Could not load MOVs', error)
                if (!cancelled) message.error('Could not load the MOVs for this intervention.')
            })
            .finally(() => { if (!cancelled) setLoading(false) })
        return () => { cancelled = true }
    }, [ids, reload])

    const upload = useCallback(async (target: MovTarget, mov: any, file: File) => {
        if (file.size > COMPLETION_MAX_FILE_SIZE_BYTES) {
            message.error('Each MOV file must be 25 MB or smaller.')
            return
        }
        setBusy(target.id)
        try {
            const path = `mov-documents/${safe(mov.programId || target.programId, 'no-program')}/${safe(mov.participantId || target.participantId, 'unknown-participant')}/${safe(target.id, 'no-assignment')}/manual/${Date.now()}_${crypto.randomUUID()}_${safe(file.name, 'manual-mov')}`
            const fileRef = ref(storage, path)
            await uploadBytes(fileRef, file)
            await updateDoc(doc(db, 'movDocuments', mov.id), {
                uploadedMovUrl: await getDownloadURL(fileRef),
                uploadedMovFileName: file.name,
                uploadedMovContentType: file.type || null,
                uploadedMovSize: file.size,
                uploadedMovUploadedAt: Timestamp.now(),
                updatedAt: Timestamp.now()
            })
            message.success('MOV saved.')
            setReload(value => value + 1)
        } catch (error) {
            console.error('Could not save MOV', error)
            message.error('Could not save the MOV. Please try again.')
        } finally {
            setBusy(null)
        }
    }, [])

    const remove = useCallback(async (target: MovTarget, mov: any) => {
        setBusy(target.id)
        try {
            await updateDoc(doc(db, 'movDocuments', mov.id), {
                uploadedMovUrl: deleteField(),
                uploadedMovFileName: deleteField(),
                uploadedMovContentType: deleteField(),
                uploadedMovSize: deleteField(),
                uploadedMovUploadedAt: deleteField(),
                updatedAt: Timestamp.now()
            })
            message.success('MOV removed.')
            setReload(value => value + 1)
        } catch (error) {
            console.error('Could not remove MOV', error)
            message.error('Could not remove the MOV. Please try again.')
        } finally {
            setBusy(null)
        }
    }, [])

    return (
        <Card
            {...evidenceCardProps}
            style={{ ...evidenceCardProps.style, height: 'auto' }}
            title={<EvidenceCardTitle title='MOV' tone='required' />}
            extra={<Tag color='red' style={pillTag}>Required</Tag>}
        >
            <Text type='secondary' style={{ fontSize: 13, display: 'block', marginBottom: 16 }}>
                Proof the service was delivered: the signed MOV for each SME.
            </Text>
            {loading ? (
                <Skeleton active paragraph={{ rows: 2 }} />
            ) : (
                <Space direction='vertical' size={18} style={{ width: '100%' }}>
                    {targets.map(target => {
                        const mov = movs[target.id]
                        // A review status only means something once a file is on the MOV.
                        const status = mov?.uploadedMovUrl ? STATUS[String(mov?.status || '')] || null : null
                        const locked = String(mov?.status || '') === 'approved'
                        return (
                            <div key={target.id}>
                                {targets.length > 1 || status ? (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10, minWidth: 0 }}>
                                        {targets.length > 1 ? (
                                            <Text strong ellipsis={{ tooltip: target.name }} style={{ flex: 1, minWidth: 0 }}>{target.name}</Text>
                                        ) : <span style={{ flex: 1 }} />}
                                        {status ? <Tag color={status.color} style={{ ...pillTag, flex: '0 0 auto' }}>{status.label}</Tag> : null}
                                    </div>
                                ) : null}
                                {!mov ? (
                                    <div style={{ textAlign: 'center', padding: '16px 8px' }}>
                                        <Text type='secondary'>The MOV is created when the intervention is completed.</Text>
                                    </div>
                                ) : (
                                    <>
                                        {locked ? (
                                            <Text type='secondary' style={{ display: 'block', fontSize: 12, marginBottom: 6, textAlign: 'center' }}>
                                                Approved, so this file is locked.
                                            </Text>
                                        ) : (
                                            <Upload
                                                className='completion-upload'
                                                maxCount={1}
                                                showUploadList={false}
                                                accept='.pdf,.doc,.docx'
                                                beforeUpload={file => {
                                                    void upload(target, mov, file as File)
                                                    return false
                                                }}
                                                disabled={busy === target.id}
                                            >
                                                <Button block shape='round' size='large' type='dashed' icon={<UploadOutlined />} loading={busy === target.id}>
                                                    {mov.uploadedMovUrl ? 'Replace MOV' : 'Upload signed MOV'}
                                                </Button>
                                            </Upload>
                                        )}
                                        {mov.uploadedMovUrl ? (
                                            <div style={{ marginTop: 12 }}>
                                                <EvidenceFileRow
                                                    name={String(mov.uploadedMovFileName || 'MOV')}
                                                    type={mov.uploadedMovContentType || undefined}
                                                    size={mov.uploadedMovSize || undefined}
                                                    href={mov.uploadedMovUrl}
                                                    onRemove={locked ? undefined : () => void remove(target, mov)}
                                                    confirmTitle='Remove this MOV file?'
                                                    confirmDescription='The MOV record stays, but it will need a file again.'
                                                    disabled={busy === target.id}
                                                />
                                            </div>
                                        ) : null}
                                    </>
                                )}
                            </div>
                        )
                    })}
                </Space>
            )}
        </Card>
    )
}

export default ManageMovCard
