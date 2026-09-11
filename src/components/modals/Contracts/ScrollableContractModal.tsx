import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Modal, Button, Checkbox, Divider, Space, Typography } from 'antd'
import '@/styles/contract-paper.css'

type Props = {
  open: boolean
  title: string
  loading?: boolean
  onCancel: () => void
  onConfirm?: () => void
  requireScroll?: boolean
  alwaysEnableIfShort?: boolean
  minContentToRequire?: number
  bodyMaxVh?: number
  children: React.ReactNode
  readOnly?: boolean
  signedMeta?: any
  showSignatureSummary?: boolean
  footerActions?: React.ReactNode
  rawDocument?: boolean
}

export const ScrollableContractModal: React.FC<Props> = ({
  open,
  title,
  loading,
  onCancel,
  onConfirm,
  requireScroll = true,
  alwaysEnableIfShort = true,
  minContentToRequire = 80,
  bodyMaxVh,
  children,
  readOnly,
  signedMeta,
  showSignatureSummary = true,
  footerActions,
  rawDocument = false
}) => {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [atBottom, setAtBottom] = useState(false)
  const [shortDoc, setShortDoc] = useState(false)
  const [ack, setAck] = useState(false)

  const normalizeAcceptedAt = (v: any): string | null => {
    if (!v) return null

    let d: Date | null = null
    if (v?.seconds) d = new Date(v.seconds * 1000) // Firestore Timestamp
    else if (v instanceof Date) d = v
    else if (typeof v === 'string') {
      const parsed = new Date(v)
      d = isNaN(parsed.getTime()) ? null : parsed
    }

    return d ? d.toISOString().split('T')[0] : null
  }

  const extractSignatureMeta = (
    meta: any,
    fallbackImg?: string,
    fallbackHash?: string
  ) => {
    if (!meta)
      return {
        sigImg: null,
        digital: null,
        signedAt: null,
        signerName: null,
        signerEmail: null,
        pdfUrl: null
      }

    const sigImg = meta?.signatureURL ?? fallbackImg ?? null

    const digital = meta?.digitalSignature ?? fallbackHash ?? null

    const signedAt = normalizeAcceptedAt(meta?.acceptedAt) ?? null

    const signerName = meta?.signerName ?? null
    const signerEmail = meta?.signerEmail ?? null
    const pdfUrl = meta?.pdfUrl ?? null

    return { sigImg, digital, signedAt, signerName, signerEmail, pdfUrl }
  }

  const sig = extractSignatureMeta(signedMeta)

  const maxVh = useMemo(() => {
    if (typeof window !== 'undefined') {
      const isMobile = window.innerWidth < 768
      return bodyMaxVh ?? (isMobile ? 70 : 60)
    }
    return bodyMaxVh ?? 60
  }, [bodyMaxVh])

  const recompute = () => {
    const el = scrollerRef.current
    if (!el) return
    const overflow = el.scrollHeight - el.clientHeight
    setShortDoc(overflow <= minContentToRequire)
    setAtBottom(overflow <= minContentToRequire) // treat short as already at bottom
  }

  useEffect(() => {
    if (!open) return
    // reset each time modal opens
    setAtBottom(false)
    setAck(false)
    // compute after paint
    const id = setTimeout(recompute, 0)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, children])

  const onScroll = () => {
    const el = scrollerRef.current
    if (!el) return
    const nearBottom = el.scrollTop + el.clientHeight >= el.scrollHeight - 8
    if (nearBottom) setAtBottom(true)
  }

  const canConfirm = !!loading
    ? false
    : !requireScroll || (alwaysEnableIfShort && shortDoc) || atBottom || ack

  const signatureImg =
    signedMeta?.signatureUrl ||
    signedMeta?.userSignatureUrl ||
    signedMeta?.smmeSignatureUrl ||
    null

  const acceptedAt =
    signedMeta?.acceptedAt || signedMeta?.signedAt || signedMeta?.date || null

  return (
    <Modal
      title={title}
      open={open}
      onCancel={onCancel}
      width='min(920px, 96vw)'
      styles={{ body: { padding: 0 } }}
      footer={[
        <div key='foot' style={{ width: '100%' }}>
          {!readOnly &&
            requireScroll &&
            (alwaysEnableIfShort ? !shortDoc : true) && (
              <div style={{ padding: '8px 16px' }}>
                <Checkbox
                  checked={ack}
                  onChange={e => setAck(e.target.checked)}
                >
                  I have read and agree to the contents.
                </Checkbox>
              </div>
            )}
          {/* The buttons share the row equally (see modal-footer.css), so there
              is no free space for justify-content to place. Wrapping lets a
              button that can no longer fit its label move to its own row
              instead of being squeezed until the text is clipped. */}
          <div
            className='contract-modal-footer-actions'
            style={{
              padding: '8px 16px',
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8
            }}
          >
            {footerActions}
            <Button danger onClick={onCancel}>
              {readOnly ? 'Close' : 'Cancel'}
            </Button>
            {!readOnly && onConfirm && (
              <Button
                type='primary'
                onClick={onConfirm}
                loading={loading}
                disabled={!canConfirm}
              >
                Confirm & Sign
              </Button>
            )}
          </div>
        </div>
      ]}
    >
      <div
        ref={scrollerRef}
        onScroll={onScroll}
        style={{ maxHeight: `${maxVh}vh`, overflowY: 'auto' }}
      >
        <div className='contract-document-stage'>
          {rawDocument ? children : (
            <article className='contract-paper'>
              {children}
              {showSignatureSummary && readOnly && signedMeta && (
          <>
            <Divider />
            <Typography.Title level={5}>Signatures</Typography.Title>

            <Space direction='vertical' size={6} style={{ width: '100%' }}>
              {(sig.signerName || sig.signerEmail) && (
                <Typography.Text>
                  <strong>Signed By:</strong> {sig.signerName || '—'}
                  {sig.signerEmail ? ` (${sig.signerEmail})` : ''}
                </Typography.Text>
              )}

              <div style={{ marginTop: 4 }}>
                <Typography.Text strong>Signature:</Typography.Text>
                <div style={{ marginTop: 6 }}>
                  {sig.sigImg ? (
                    <img
                      alt='Signature'
                      src={sig.sigImg}
                      style={{
                        maxWidth: 320,
                        width: '100%',
                        border: '1px solid #eee',
                        borderRadius: 6
                      }}
                    />
                  ) : (
                    <Typography.Text type='secondary'>
                      No signature image on file.
                    </Typography.Text>
                  )}
                </div>
              </div>

              <Typography.Text>
                <strong>Cryptographic Signature:</strong> {sig.digital || '—'}
              </Typography.Text>

              <Typography.Text>
                <strong>Signed At:</strong> {sig.signedAt ?? '—'}
              </Typography.Text>

              {sig.pdfUrl && (
                <a href={sig.pdfUrl} target='_blank' rel='noopener noreferrer'>
                  <Button size='small' type='link'>
                    Open PDF
                  </Button>
                </a>
              )}
            </Space>
          </>
              )}
            </article>
          )}
        </div>
      </div>
    </Modal>
  )
}
