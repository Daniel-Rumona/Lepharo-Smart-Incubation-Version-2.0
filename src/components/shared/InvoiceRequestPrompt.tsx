import React, { useEffect, useMemo, useState } from 'react'
import { Button, Dropdown, Modal, Space, Tag, Typography, Upload, message, theme } from 'antd'
import { ClockCircleOutlined, DownOutlined, FileDoneOutlined, InboxOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { collection, doc, onSnapshot, query, Timestamp, updateDoc, where } from 'firebase/firestore'
import { getDownloadURL, getStorage, ref, uploadBytes } from 'firebase/storage'
import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { sendNotification } from '@/utils/sendNotification'

const { Text, Paragraph } = Typography
const { Dragger } = Upload

interface RequestedPack {
    id: string
    department?: string
    month?: string
    totalItems?: number
    invoiceRequestedAt?: Date
    invoiceRequestedBy?: { uid?: string; name?: string }
    snoozedUntil?: Date
}

const SNOOZE_OPTIONS = [
    { key: '30m', label: 'In 30 minutes', until: () => dayjs().add(30, 'minute') },
    { key: '1h', label: 'In 1 hour', until: () => dayjs().add(1, 'hour') },
    { key: '3h', label: 'In 3 hours', until: () => dayjs().add(3, 'hour') },
    {
        key: 'tomorrow',
        label: 'Tomorrow morning',
        until: () => dayjs().add(1, 'day').hour(8).minute(0).second(0)
    }
]

const toDate = (value: any): Date | undefined =>
    value?.toDate?.() ?? (value ? new Date(value) : undefined)

/**
 * When finance asks a head of department for a MOV pack's invoice, this pops
 * up for that HOD: on their next sign-in, or straight away if they're already
 * signed in. They can drop the invoice in right here, or snooze the reminder.
 * The snooze is stored on the pack so it holds across devices.
 */
const InvoiceRequestPrompt: React.FC = () => {
    const { user } = useFullIdentity()
    const { token } = theme.useToken()
    const [packs, setPacks] = useState<RequestedPack[]>([])
    const [file, setFile] = useState<File | null>(null)
    const [saving, setSaving] = useState(false)
    // Re-evaluated when the earliest snooze runs out
    const [now, setNow] = useState(() => Date.now())

    const uid = user?.uid

    useEffect(() => {
        if (!uid) {
            setPacks([])
            return
        }
        const unsub = onSnapshot(
            query(collection(db, 'consolidatedMOVs'), where('hodUid', '==', uid)),
            snap => {
                setPacks(
                    snap.docs
                        .map(d => ({ id: d.id, data: d.data() as any }))
                        // Asked for, and still without an invoice
                        .filter(
                            ({ data }) =>
                                data.invoiceRequestedAt &&
                                !(typeof data.invoiceAttachment === 'string'
                                    ? data.invoiceAttachment
                                    : data.invoiceAttachment?.url)
                        )
                        .map(({ id, data }) => ({
                            id,
                            department: data.department,
                            month: data.month,
                            totalItems: data.totalItems,
                            invoiceRequestedAt: toDate(data.invoiceRequestedAt),
                            invoiceRequestedBy: data.invoiceRequestedBy,
                            snoozedUntil: toDate(data.invoiceRequestSnoozedUntil)
                        }))
                )
            },
            error => console.error('Invoice request prompt failed to load:', error)
        )
        return () => unsub()
    }, [uid])

    // Wake up when the next snooze expires so the prompt comes back on time
    useEffect(() => {
        const upcoming = packs
            .map(p => p.snoozedUntil?.getTime() ?? 0)
            .filter(t => t > Date.now())
        if (!upcoming.length) return
        const timer = window.setTimeout(
            () => setNow(Date.now()),
            Math.min(...upcoming) - Date.now() + 500
        )
        return () => window.clearTimeout(timer)
    }, [packs, now])

    // One at a time, oldest request first
    const current = useMemo(
        () =>
            packs
                .filter(p => !p.snoozedUntil || p.snoozedUntil.getTime() <= now)
                .sort(
                    (a, b) =>
                        (a.invoiceRequestedAt?.getTime() ?? 0) -
                        (b.invoiceRequestedAt?.getTime() ?? 0)
                )[0],
        [packs, now]
    )

    useEffect(() => setFile(null), [current?.id])

    if (!current) return null

    const monthLabel = current.month ? dayjs(current.month).format('MMMM YYYY') : ''
    const waiting = packs.filter(p => p.id !== current.id).length

    const snooze = async (key: string) => {
        const option = SNOOZE_OPTIONS.find(o => o.key === key)
        if (!option) return
        try {
            await updateDoc(doc(db, 'consolidatedMOVs', current.id), {
                invoiceRequestSnoozedUntil: Timestamp.fromDate(option.until().toDate())
            })
            message.info(`We'll remind you ${option.label.toLowerCase()}.`)
        } catch (error) {
            console.error('Failed to snooze invoice reminder:', error)
            message.error('Could not snooze the reminder')
        }
    }

    const upload = async () => {
        if (!file) {
            message.error('Please add the invoice first.')
            return
        }
        setSaving(true)
        try {
            const safe = file.name.replace(/\s+/g, '_')
            // Same place the MOVs page keeps pack invoices
            const path = `consolidatedMOVs/${current.department || 'department'}/${current.month || 'month'}/${Date.now()}_${safe}`
            const fileRef = ref(getStorage(), path)
            await uploadBytes(fileRef, file)
            const url = await getDownloadURL(fileRef)

            await updateDoc(doc(db, 'consolidatedMOVs', current.id), {
                invoiceAttachment: { name: file.name, url, path },
                invoiceProvidedAt: Timestamp.now(),
                invoiceRequestSnoozedUntil: null,
                updatedAt: new Date(),
                updatedByName: user?.name || '',
                updatedByUid: user?.uid || ''
            })

            // Let whoever in finance asked know it's in
            if (current.invoiceRequestedBy?.uid) {
                await sendNotification({
                    type: 'mov_invoice_attached',
                    message: `${current.department || 'The department'} attached the invoice for its ${monthLabel} MOV pack. It's ready for your decision.`,
                    recipientRoles: [],
                    recipientIds: [current.invoiceRequestedBy.uid],
                    link: '/operations/inhouse/invoices',
                    actionTarget: { collection: 'consolidatedMOVs', docId: current.id }
                })
            }
            message.success('Invoice attached. Finance has been notified.')
        } catch (error) {
            console.error('Failed to attach invoice:', error)
            message.error('Could not attach the invoice')
        } finally {
            setSaving(false)
        }
    }

    return (
        <Modal
            open
            closable={false}
            maskClosable={false}
            keyboard={false}
            title='Finance needs an invoice'
            footer={
                <Space.Compact block>
                    <Dropdown
                        trigger={['click']}
                        menu={{
                            items: SNOOZE_OPTIONS.map(o => ({ key: o.key, label: o.label })),
                            onClick: ({ key }) => snooze(key)
                        }}
                    >
                        <Button block icon={<ClockCircleOutlined />} disabled={saving}>
                            Remind me later <DownOutlined />
                        </Button>
                    </Dropdown>
                    <Button block type='primary' loading={saving} onClick={upload}>
                        Attach invoice
                    </Button>
                </Space.Compact>
            }
        >
            <Space direction='vertical' size={16} style={{ width: '100%' }}>
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '10px 12px',
                        borderRadius: token.borderRadiusLG,
                        border: `1px solid ${token.colorWarningBorder}`,
                        background: token.colorWarningBg
                    }}
                >
                    <FileDoneOutlined style={{ fontSize: 20, color: token.colorWarning }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <Text strong style={{ display: 'block' }} ellipsis>
                            {current.department || 'Your department'} · {monthLabel}
                        </Text>
                        <Text type='secondary' style={{ fontSize: 12 }}>
                            {current.totalItems ? `${current.totalItems} interventions · ` : ''}
                            Requested{' '}
                            {current.invoiceRequestedAt
                                ? dayjs(current.invoiceRequestedAt).format('D MMM, HH:mm')
                                : ''}
                            {current.invoiceRequestedBy?.name &&
                                ` by ${current.invoiceRequestedBy.name}`}
                        </Text>
                    </div>
                    {waiting > 0 && <Tag style={{ marginInlineEnd: 0 }}>+{waiting} more</Tag>}
                </div>

                <Paragraph style={{ margin: 0 }}>
                    Your MOV pack has been confirmed, but it can&apos;t be paid until its invoice is
                    attached. Drop it in below.
                </Paragraph>

                <Dragger
                    maxCount={1}
                    accept='.pdf,.png,.jpg,.jpeg,.webp'
                    beforeUpload={f => {
                        setFile(f)
                        return false
                    }}
                    onRemove={() => setFile(null)}
                    fileList={file ? [{ uid: 'invoice', name: file.name, status: 'done' }] : []}
                >
                    <p className='ant-upload-drag-icon'>
                        <InboxOutlined />
                    </p>
                    <p className='ant-upload-text'>Drop the invoice here, or click to choose</p>
                    <p className='ant-upload-hint'>PDF or image</p>
                </Dragger>
            </Space>
        </Modal>
    )
}

export default InvoiceRequestPrompt
