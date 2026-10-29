import React, { useEffect, useState } from 'react'
import { Alert, Card, Col, Descriptions, Input, Modal, Row, message } from 'antd'
import { collection, getDocs, limit, query, where } from 'firebase/firestore'
import { db } from '@/firebase'
import { SignatureAnimation, useSignaturePlayback } from '@/components/shared/SignatureAnimation'

export type GapConfirmPayload = {
    comment: string
    romSignatureUrl: string
    romDigitalSignature: string
}

type Props = {
    open: boolean
    onCancel: () => void
    onConfirm: (payload: GapConfirmPayload) => Promise<void>
    romName?: string
    romEmail?: string
    isMobile?: boolean
}

/**
 * The one modal this flow keeps: a genuine, decision-shaped confirmation.
 * Loads the reviewer's signatures on open so they can see exactly what will be attached.
 */
const GapConfirmModal: React.FC<Props> = ({
    open,
    onCancel,
    onConfirm,
    romName,
    romEmail,
    isMobile
}) => {
    const [comment, setComment] = useState('')
    const [signatureUrl, setSignatureUrl] = useState('')
    const [digitalSignature, setDigitalSignature] = useState('')
    const [loadingSig, setLoadingSig] = useState(false)
    const [submitting, setSubmitting] = useState(false)
    // Confirm re-draws the signature before the GAP is saved with it.
    const [signing, setSigning] = useState(false)
    const signaturePlayback = useSignaturePlayback()

    useEffect(() => {
        if (!open) return

        setComment('')

        const run = async () => {
            if (!romEmail) return
            setLoadingSig(true)
            try {
                const [opQSnap, userQSnap] = await Promise.all([
                    getDocs(
                        query(
                            collection(db, 'operationsStaff'),
                            where('email', '==', romEmail),
                            limit(1)
                        )
                    ),
                    getDocs(query(collection(db, 'users'), where('email', '==', romEmail), limit(1)))
                ])

                const opDoc = opQSnap.docs[0]
                const userDoc = userQSnap.docs[0]

                setDigitalSignature(
                    (opDoc?.data() as any)?.digitalSignature ??
                    (userDoc?.data() as any)?.digitalSignature ??
                    ''
                )
                setSignatureUrl((userDoc?.data() as any)?.signatureURL ?? '')
            } catch (e) {
                console.error('Failed to load ROM signatures', e)
            } finally {
                setLoadingSig(false)
            }
        }

        run()
    }, [open, romEmail])

    const hasSignature = !!signatureUrl || !!digitalSignature

    const handleOk = async () => {
        if (loadingSig || !hasSignature) return
        setSubmitting(true)
        try {
            if (signatureUrl) {
                signaturePlayback.start()
                setSigning(true)
                await signaturePlayback.finished()
            }
            await onConfirm({
                comment,
                romSignatureUrl: signatureUrl,
                romDigitalSignature: digitalSignature
            })
        } catch (e) {
            console.error('Failed to confirm GAP', e)
            message.error('Failed to confirm GAP.')
        } finally {
            setSigning(false)
            setSubmitting(false)
        }
    }

    return (
        <Modal
            title='Confirm GAP'
            open={open}
            onCancel={onCancel}
            onOk={handleOk}
            okText='Confirm and sign'
            confirmLoading={submitting}
            // Signatures load on open; confirming before they arrive saved an unsigned GAP.
            okButtonProps={{ disabled: loadingSig || !hasSignature }}
            width={isMobile ? '100%' : 760}
            style={isMobile ? { top: 8 } : undefined}
        >
            {!loadingSig && !hasSignature ? (
                <Alert
                    type='error'
                    showIcon
                    message='You have no signature on file'
                    description='Add your signature to your profile first. A GAP Analysis is confirmed with the reviewer’s signature.'
                    style={{ marginBottom: 12 }}
                />
            ) : (
                <Alert
                    type='info'
                    showIcon
                    message='Your comment is saved with your signature.'
                    style={{ marginBottom: 12 }}
                />
            )}

            <Descriptions column={1} size='small' bordered style={{ marginBottom: 12 }}>
                <Descriptions.Item label='Reviewer'>{romName || '—'}</Descriptions.Item>
                <Descriptions.Item label='Reviewer Email'>{romEmail || '—'}</Descriptions.Item>
            </Descriptions>

            <Input.TextArea
                rows={4}
                placeholder='Add ROM review comment (optional)'
                value={comment}
                onChange={e => setComment(e.target.value)}
            />

            {loadingSig ? (
                <Alert type='info' showIcon message='Loading ROM signatures…' style={{ marginTop: 12 }} />
            ) : (
                <Row gutter={[12, 12]} style={{ marginTop: 12 }}>
                    <Col xs={24} md={12}>
                        <Card size='small' title='ROM Signature'>
                            {signatureUrl ? (
                                <SignatureAnimation
                                    src={signatureUrl}
                                    alt='ROM Signature'
                                    animate={signing}
                                    className='keep-light'
                                    onComplete={signaturePlayback.complete}
                                    // White behind the dark ink, so it reads in dark theme too.
                                    style={{ maxWidth: '100%', maxHeight: 140, objectFit: 'contain', background: '#fff', borderRadius: 6 }}
                                />
                            ) : (
                                <em>No signature image on file</em>
                            )}
                        </Card>
                    </Col>

                    <Col xs={24} md={12}>
                        <Card size='small' title='ROM Digital Signature'>
                            <div style={{ wordBreak: 'break-all', fontFamily: 'monospace' }}>
                                {digitalSignature || <em>No digital signature on file</em>}
                            </div>
                        </Card>
                    </Col>
                </Row>
            )}
        </Modal>
    )
}

export default GapConfirmModal
