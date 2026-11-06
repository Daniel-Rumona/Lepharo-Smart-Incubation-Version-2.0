import React, { useEffect, useState } from 'react'
import { Alert, App, Button, Modal, Skeleton } from 'antd'
import { DownloadOutlined, QuestionCircleOutlined } from '@ant-design/icons'
import { LightSurface } from '@/components/shared/LightSurface'
import { MovDocumentView } from '@/components/movs/MovDocumentView'
import { PreIncPoeButton } from '@/components/movs/PreIncPoeButton'
import { hasPreIncAgreementEvidence } from '@/services/movService'
import { buildPoeList, fmtDate, type Mov, type Pack } from './movData'
import { PoeButton } from './movParts'
import { QueryThread, RaiseQueryModal } from './MovQueries'
import { downloadMovDoc } from './movDownloads'
import type { MovWorkspace } from './useMovWorkspace'

/**
 * One MOV inside a monthly pack, for the CC and M&E: its confirmation sheet,
 * evidence and the pack queries about it, with Query while the pack is theirs.
 */
export const PackMovModal: React.FC<{
    pack: Pack
    item: Mov | null
    ws: MovWorkspace
    queries: any[]
    canQuery: boolean
    currentUid?: string
    activeProgramId?: string | null
    onClose: () => void
    onChanged: () => void
}> = ({ pack, item, ws, queries, canQuery, currentUid, activeProgramId, onClose, onChanged }) => {
    const { message } = App.useApp()
    const [full, setFull] = useState<Mov | null>(null)
    const [raiseOpen, setRaiseOpen] = useState(false)
    const [downloading, setDownloading] = useState(false)

    useEffect(() => {
        if (!item) return
        let cancelled = false
        setFull(null)
        ws.loadPackMov(item)
            .then(m => !cancelled && setFull(m))
            .catch(() => !cancelled && setFull(item))
        return () => { cancelled = true }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [item?.id])

    if (!item) return null
    const current = full || item
    const override = (current as any).confirmationOverride
    const poes = buildPoeList(current)

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
                    {canQuery && (
                        <Button danger icon={<QuestionCircleOutlined />} onClick={() => setRaiseOpen(true)}>
                            Query
                        </Button>
                    )}
                    {poes.length ? <PoeButton list={poes} /> : hasPreIncAgreementEvidence(current) ? <PreIncPoeButton mov={current} /> : null}
                    <Button
                        icon={<DownloadOutlined />}
                        loading={downloading}
                        disabled={!full}
                        onClick={async () => {
                            setDownloading(true)
                            try {
                                await downloadMovDoc(current, activeProgramId)
                            } catch (error) {
                                console.error(error)
                                message.error('The MOV couldn’t be generated. Try again.')
                            } finally {
                                setDownloading(false)
                            }
                        }}
                    >
                        Download
                    </Button>
                </div>

                {override && (
                    <Alert
                        type='warning'
                        showIcon
                        message='Confirmed by the HOD’s dispute decision, not the SME’s signature'
                        description={`The SME disputed this delivery. ${override.byName || 'The HOD'} decided on ${fmtDate(override.at)} that it was delivered as recorded: “${override.reason || '—'}”`}
                    />
                )}

                {queries.length > 0 && (
                    <section>
                        <h3 className='ws-section-title'>Queries on this MOV</h3>
                        <QueryThread
                            queries={queries}
                            currentUid={currentUid}
                            onAccept={async q => {
                                await ws.acceptPackAnswer(q.id)
                                message.success('Answer accepted.')
                                onChanged()
                            }}
                            onSendBack={async (q, notes) => {
                                await ws.sendBackAnswer(q.id, notes)
                                message.success('Sent back to the facilitator.')
                                onChanged()
                            }}
                        />
                    </section>
                )}

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

            <RaiseQueryModal
                open={raiseOpen}
                inPack
                facilitatorName={current.facilitatorName}
                title='Query this MOV'
                note={`It goes to ${current.facilitatorName || 'the facilitator'}, who answers; you then accept it or send it back. The pack can’t be ${ws.role === 'me' ? 'validated' : 'confirmed'} while it’s open.`}
                onCancel={() => setRaiseOpen(false)}
                onSend={async values => {
                    try {
                        await ws.raisePackQuery(pack, current, values)
                        message.success(`Query sent to ${current.facilitatorName || 'the facilitator'}.`)
                        setRaiseOpen(false)
                        onChanged()
                    } catch (error: any) {
                        console.error(error)
                        message.error(error?.message === 'no-recipient' ? 'This MOV has no facilitator to send it to.' : 'The query couldn’t be sent. Try again.')
                    }
                }}
            />
        </Modal>
    )
}
