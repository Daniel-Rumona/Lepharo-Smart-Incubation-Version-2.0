import React, { useEffect, useState } from 'react'
import { App, Button, Modal, Skeleton } from 'antd'
import { DownloadOutlined } from '@ant-design/icons'
import { LightSurface } from '@/components/shared/LightSurface'
import { MovDocumentView } from '@/components/movs/MovDocumentView'
import { PreIncPoeButton } from '@/components/movs/PreIncPoeButton'
import { hasPreIncAgreementEvidence } from '@/services/movService'
import { buildPoeList, enrichMov, type Mov } from '@/routes/operations/movs/movData'
import { PoeButton } from '@/routes/operations/movs/movParts'
import { downloadMovDoc } from '@/routes/operations/movs/movDownloads'
import '@/routes/operations/movs/movs.css'

/**
 * A validated MOV, read only: its confirmation sheet, evidence and the Word
 * download. Nothing can change once M&E has validated it.
 */
export const MovViewerModal: React.FC<{ mov: Mov | null; activeProgramId?: string | null; onClose: () => void }> = ({
    mov,
    activeProgramId,
    onClose
}) => {
    const { message } = App.useApp()
    const [full, setFull] = useState<Mov | null>(null)
    const [downloading, setDownloading] = useState(false)

    useEffect(() => {
        if (!mov) return
        let cancelled = false
        setFull(null)
        enrichMov(mov, activeProgramId)
            .then(m => !cancelled && setFull(m))
            .catch(() => !cancelled && setFull(mov))
        return () => {
            cancelled = true
        }
    }, [mov?.id, activeProgramId]) // eslint-disable-line react-hooks/exhaustive-deps

    if (!mov) return null
    const current = full || mov
    const poes = buildPoeList(current)

    const download = async () => {
        setDownloading(true)
        try {
            await downloadMovDoc(current, activeProgramId)
        } catch (error) {
            console.error('MOV download failed', error)
            message.error('The MOV couldn’t be generated. Try again.')
        } finally {
            setDownloading(false)
        }
    }

    return (
        <Modal
            open
            onCancel={onClose}
            centered
            width='min(1080px, calc(100vw - 24px))'
            title={[current.smmeCompanyName || 'MOV', current.interventionTitle].filter(Boolean).join(' · ')}
            footer={null}
            destroyOnClose
        >
            <div className='mv-detail-body'>
                <div className='mv-actions'>
                    {poes.length ? <PoeButton list={poes} /> : hasPreIncAgreementEvidence(current) ? <PreIncPoeButton mov={current} /> : null}
                    <Button icon={<DownloadOutlined />} loading={downloading} disabled={!full} onClick={download}>
                        Download
                    </Button>
                </div>
                <section>
                    <h3 className='ws-section-title'>Confirmation sheet</h3>
                    {full ? (
                        <div className='mv-doc-frame'>
                            <LightSurface className='mov-document-preview-surface' style={{ background: '#fff' }}>
                                <MovDocumentView mov={full} />
                            </LightSurface>
                        </div>
                    ) : (
                        <Skeleton active paragraph={{ rows: 10 }} />
                    )}
                </section>
            </div>
        </Modal>
    )
}

export default MovViewerModal
