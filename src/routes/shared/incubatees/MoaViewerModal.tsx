import React, { useState } from 'react'
import { Button, Modal, message } from 'antd'
import { DownloadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { renderMoaPages, saveMoaDocx } from '@/components/modals/Contracts/moa.pages'
import { MoaViewerState, formatDateTime, toDateSafe } from './participantsData'
import { moaParticipantSignature, moaRomSignature, renderStyledMoaPage } from './MoaPreview'
import '@/styles/contract-paper.css'

/** Read-only paper view of a signed MOA, with a Word download. */
export const MoaViewerModal: React.FC<{ viewer: MoaViewerState | null; onClose: () => void }> = ({ viewer: moaViewer, onClose }) => {
    const [moaDownloading, setMoaDownloading] = useState(false)

    const downloadViewedMoa = async () => {
        if (!moaViewer) return
        setMoaDownloading(true)
        try {
            const meta = moaViewer.meta || {}
            const acceptedAt = toDateSafe(meta.acceptedAt || meta.signedAt)
            const romSignedAt = toDateSafe(meta.romSignedAt || meta.operationsSignedAt)
            await saveMoaDocx(
                moaViewer.vars,
                `MOA_${moaViewer.vars.beneficiaryName.replace(/[^a-z0-9]+/gi, '_')}.docx`,
                {
                    centerTitle: 'INCUBATION MEMORANDUM OF AGREEMENT',
                    formNo: 'LEP QMS 074.1 F',
                    revisionNo: '0',
                    effectiveDate: moaViewer.vars.effectiveDate
                },
                {
                    incubatee: {
                        name: meta.signerName || moaViewer.vars.participantName,
                        positionOrTitle: meta.signerTitle || 'Director',
                        place: meta.place || 'Rustenburg',
                        day: acceptedAt ? dayjs(acceptedAt).format('DD') : '',
                        month: acceptedAt ? dayjs(acceptedAt).format('MMMM') : '',
                        year: acceptedAt ? dayjs(acceptedAt).format('YYYY') : '',
                        signatureUrl:
                            moaParticipantSignature(meta)
                    },
                    incubator: {
                        name: meta.romSignerName || meta.romName || '',
                        positionOrTitle: meta.romSignerTitle || meta.romPosition || 'Centre Coordinator',
                        place: meta.romPlace || 'Rustenburg',
                        day: romSignedAt ? dayjs(romSignedAt).format('DD') : '',
                        month: romSignedAt ? dayjs(romSignedAt).format('MMMM') : '',
                        year: romSignedAt ? dayjs(romSignedAt).format('YYYY') : '',
                        signatureUrl: moaRomSignature(meta)
                    }
                }
            )
            message.success('MOA downloaded successfully.')
        } catch (error) {
            console.error('Failed to download MOA.', error)
            message.error('The MOA could not be downloaded.')
        } finally {
            setMoaDownloading(false)
        }
    }

    return (
        <Modal
            title='Memorandum of Agreement (MOA)'
            open={!!moaViewer}
            onCancel={() => onClose()}
            width='min(960px, 96vw)'
            styles={{ body: { padding: 0, maxHeight: '76vh', overflowY: 'auto' } }}
            footer={<div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, width: '100%' }}>
                <Button block onClick={() => onClose()}>Close</Button>
                <Button
                    block
                    type='primary'
                    icon={<DownloadOutlined />}
                    loading={moaDownloading}
                    onClick={downloadViewedMoa}
                >
                    Download MOA
                </Button>
            </div>}
            destroyOnClose
        >
            {moaViewer && (
                <div className='contract-document-stage'>
                    {renderMoaPages(moaViewer.vars).map((page, index, pages) => (
                        <article key={index} className='contract-paper contract-paper--page'>
                            <header className='contract-paper__header'>
                                <div><img src='/assets/images/lepharo.png' alt='Lepharo' /></div>
                                <div className='contract-paper__header-title'>
                                    INCUBATION MEMORANDUM OF AGREEMENT
                                </div>
                                <div className='contract-paper__header-meta'>
                                    <span><strong>Form No:</strong> LEP QMS 074.1 F</span>
                                    <span><strong>Revision No:</strong> 0</span>
                                    <span><strong>Effective date:</strong> {moaViewer.vars.effectiveDate}</span>
                                </div>
                            </header>
                            {renderStyledMoaPage(page, index)}
                            <footer className='contract-paper__page-footer'>
                                <span><span className='contract-paper__reference-label'>Ref No:</span> LEP QMS 074.1 F</span>
                                <span>-{index + 1}-</span>
                            </footer>
                        </article>
                    ))}
                    <article className='contract-paper contract-paper--page'>
                        <header className='contract-paper__header'>
                            <div><img src='/assets/images/lepharo.png' alt='Lepharo' /></div>
                            <div className='contract-paper__header-title'>INCUBATION MEMORANDUM OF AGREEMENT</div>
                            <div className='contract-paper__header-meta'>
                                <span><strong>Form No:</strong> LEP QMS 074.1 F</span>
                                <span><strong>Revision No:</strong> 0</span>
                                <span><strong>Effective date:</strong> {moaViewer.vars.effectiveDate}</span>
                            </div>
                        </header>
                        <div className='moa-preview-signatures'>
                            <h2 className='moa-preview-signatures__title'>29 &nbsp;&nbsp;&nbsp; SIGNATURES</h2>
                            <section className='moa-preview-signatures__block'>
                                <h3>The Incubatee or SMME</h3>
                                <div className='moa-preview-signatures__row'>
                                    <span>SIGNED on</span>
                                    <span className='moa-preview-signatures__field'>
                                        {moaViewer.meta?.acceptedAt ? formatDateTime(moaViewer.meta.acceptedAt) : 'Date not recorded'}
                                    </span>
                                </div>
                                <div className='moa-preview-signatures__row'>
                                    <span>Name &amp; Surname:</span>
                                    <strong className='moa-preview-signatures__field'>
                                        {moaViewer.meta?.signerName || moaViewer.vars.participantName}
                                    </strong>
                                </div>
                                <p className='moa-preview-signatures__statement'>[For and on behalf of the INCUBATEE, duly authorized]</p>
                                {moaParticipantSignature(moaViewer.meta) ? (
                                    <img className='contract-paper__signature-image moa-preview-signatures__signature' src={moaParticipantSignature(moaViewer.meta)} alt='Incubatee signature' />
                                ) : <div className='contract-paper__signature-line moa-preview-signatures__signature' />}
                                <p>Signature</p>
                            </section>
                            <section className='moa-preview-signatures__block'>
                                <h3>The Incubator</h3>
                                <div className='moa-preview-signatures__row'>
                                    <span>Name &amp; Surname:</span>
                                    <strong className='moa-preview-signatures__field'>
                                        {moaViewer.meta?.romSignerName || 'Lepharo representative'}
                                    </strong>
                                    <span>Position:</span>
                                    <span className='moa-preview-signatures__field'>
                                        {moaViewer.meta?.romSignerTitle || 'Centre Coordinator'}
                                    </span>
                                </div>
                                <p className='moa-preview-signatures__statement'>[For and on behalf of the INCUBATOR, duly authorized]</p>
                                {moaRomSignature(moaViewer.meta) ? (
                                    <img className='contract-paper__signature-image moa-preview-signatures__signature' src={moaRomSignature(moaViewer.meta)} alt='Incubator signature' />
                                ) : <div className='contract-paper__signature-line moa-preview-signatures__signature' />}
                                <p>Signature</p>
                            </section>
                        </div>
                        <footer className='contract-paper__page-footer'>
                            <span><span className='contract-paper__reference-label'>Ref No:</span> LEP QMS 074.1 F</span>
                            <span>-{renderMoaPages(moaViewer.vars).length + 1}-</span>
                        </footer>
                    </article>
                </div>
            )}
        </Modal>
    )
}
