import React, { useEffect, useState } from 'react'
import { Alert, App, Button, Empty, Modal, Skeleton, Table, Upload } from 'antd'
import { SendOutlined, UploadOutlined } from '@ant-design/icons'
import { PreIncPoeButton } from '@/components/movs/PreIncPoeButton'
import { hasPreIncAgreementEvidence } from '@/services/movService'
import { buildPoeList, fmtDate, isPackLocked, monthLabel, resolveMovCompletionDate, type Mov } from './movData'
import { PoeButton } from './movParts'
import type { MovWorkspace } from './useMovWorkspace'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useSigningCeremony } from '@/components/shared/SignatureAnimation'

type Props = {
    open: boolean
    onClose: () => void
    ws: MovWorkspace
    hasDepartment: boolean
}

/**
 * Submit a month's approved MOVs to the Center Coordinator, in one place:
 * pick a month (each shows what's ready), check the MOVs it will hold,
 * attach the invoice, submit. An invoice that fails to upload can be retried
 * or skipped right here.
 */
export const SubmitMonthModal: React.FC<Props> = ({ open, onClose, ws, hasDepartment }) => {
    const { message } = App.useApp()
    const { user } = useFullIdentity()
    const ceremony = useSigningCeremony()
    const [month, setMonth] = useState<string | null>(null)
    const [candidates, setCandidates] = useState<{ eligible: Mov[]; missingEvidence: Mov[] } | null>(null)
    const [loadingMonth, setLoadingMonth] = useState(false)
    const [invoice, setInvoice] = useState<File | null>(null)
    const [saving, setSaving] = useState(false)
    const [invoiceFailed, setInvoiceFailed] = useState(false)

    // Months with approved MOVs and no pack yet; months whose pack is still open get a pointer to Update pack.
    const open_ = ws.monthSummaries.filter(m => !ws.packIndex.packedMonths.has(m.month))
    const toAdd = ws.monthSummaries.filter(m => ws.packIndex.packedMonths.has(m.month) && m.ready > 0 && !ws.packs.some(p => p.month === m.month && isPackLocked(p)))

    useEffect(() => {
        if (!open) return
        setMonth(null)
        setCandidates(null)
        setInvoice(null)
        setInvoiceFailed(false)
    }, [open])

    const choose = async (key: string) => {
        setMonth(key)
        setCandidates(null)
        setInvoiceFailed(false)
        setLoadingMonth(true)
        try {
            setCandidates(await ws.monthCandidates(key))
        } catch (error) {
            console.error(error)
            message.error('Couldn’t load that month’s MOVs. Try again.')
        } finally {
            setLoadingMonth(false)
        }
    }

    const submit = async (skipInvoice = false) => {
        if (!month || !candidates?.eligible.length) return
        setSaving(true)
        try {
            // The pack carries the HOD's saved signature.
            const result = await ceremony.sign(
                user?.signatureURL,
                () => ws.createPack(month, candidates.eligible, invoice, skipInvoice),
                'Signing the pack',
                `${monthLabel(month)} · submitted to the Center Coordinator`
            )
            if (result === 'invoice-failed') {
                setInvoiceFailed(true)
                return
            }
            if (result === 'exists') message.warning(`${monthLabel(month)} already has a pack. Find it under Monthly packs.`)
            else message.success(`${monthLabel(month)} submitted to the Center Coordinator.`)
            await ws.reload()
            onClose()
        } catch (error) {
            console.error(error)
            message.error('The pack couldn’t be submitted. Nothing was saved; try again.')
        } finally {
            setSaving(false)
        }
    }

    return (
        <Modal
            className='guide-submit-movs-modal'
            centered
            open={open}
            onCancel={onClose}
            title='Submit a month'
            width={880}
            // The close button is the way out; Submit appears only once there's something to submit.
            footer={hasDepartment && open_.length ? (
                <Button
                    block
                    className='guide-generate-pack-submit'
                    type='primary'
                    icon={<SendOutlined />}
                    loading={saving}
                    disabled={!candidates?.eligible.length || invoiceFailed}
                    onClick={() => submit(false)}
                >
                    {month && candidates?.eligible.length
                        ? `Submit ${candidates.eligible.length} MOV${candidates.eligible.length === 1 ? '' : 's'} to the Center Coordinator`
                        : 'Choose a month to submit'}
                </Button>
            ) : null}
            destroyOnClose
        >
            {!hasDepartment ? (
                <Alert type='info' showIcon message='Only a department’s HOD can submit its monthly MOVs.' />
            ) : (
                <>
                    <div data-guide='submit-movs-month'>
                        <h3 className='ws-section-title'>Month</h3>
                        {open_.length ? (
                            <div className='mv-month-choices' role='radiogroup' aria-label='Month to submit'>
                                {open_.map(m => (
                                    <button
                                        key={m.month}
                                        type='button'
                                        role='radio'
                                        aria-checked={month === m.month}
                                        className={`mv-month-choice${month === m.month ? ' is-selected' : ''}`}
                                        onClick={() => choose(m.month)}
                                    >
                                        <span className='mv-month-choice-name'>{monthLabel(m.month)}</span>
                                        <span className='mv-month-choice-meta'>
                                            {m.ready} ready
                                            {m.noEvidence ? ` · ${m.noEvidence} without evidence` : ''}
                                            {m.late ? ` · ${m.late} late` : ''}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        ) : (
                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='No month has approved MOVs waiting to be submitted.' />
                        )}
                        {toAdd.map(m => (
                            <p key={m.month} className='mv-muted mv-hint'>
                                {monthLabel(m.month)}’s pack is waiting for the CC: add its {m.ready} new MOV{m.ready === 1 ? '' : 's'} with Update pack under Monthly packs.
                            </p>
                        ))}
                    </div>

                    {month && (
                        <section className='mv-submit-list'>
                            <h3 className='ws-section-title'>MOVs in the {monthLabel(month)} pack</h3>
                            {loadingMonth || !candidates ? (
                                <Skeleton active paragraph={{ rows: 4 }} />
                            ) : (
                                <>
                                    {candidates.missingEvidence.length > 0 && (
                                        <Alert
                                            type='warning'
                                            showIcon
                                            className='mv-alert'
                                            message={`${candidates.missingEvidence.length} approved MOV${candidates.missingEvidence.length === 1 ? ' has' : 's have'} no evidence and will be left out: ${candidates.missingEvidence.map(m => m.smmeCompanyName).filter(Boolean).slice(0, 4).join(', ')}${candidates.missingEvidence.length > 4 ? '…' : ''}`}
                                        />
                                    )}
                                    <Table
                                        size='small'
                                        rowKey='id'
                                        dataSource={candidates.eligible}
                                        pagination={candidates.eligible.length > 8 ? { pageSize: 8, size: 'small', showSizeChanger: false } : false}
                                        scroll={{ x: 640 }}
                                        locale={{ emptyText: 'No MOVs with evidence for this month.' }}
                                        columns={[
                                            { title: 'SME', dataIndex: 'smmeCompanyName', ellipsis: true },
                                            { title: 'Intervention', dataIndex: 'interventionTitle', ellipsis: true },
                                            { title: 'Facilitator', dataIndex: 'facilitatorName', ellipsis: true },
                                            { title: 'Confirmed', width: 120, render: (_: any, m: Mov) => fmtDate(resolveMovCompletionDate(m)) },
                                            {
                                                title: 'Evidence',
                                                width: 130,
                                                render: (_: any, m: Mov) => {
                                                    const list = buildPoeList(m)
                                                    if (!list.length && hasPreIncAgreementEvidence(m)) return <PreIncPoeButton mov={m} compact />
                                                    return <PoeButton list={list} type='link' />
                                                }
                                            }
                                        ]}
                                    />
                                </>
                            )}
                        </section>
                    )}

                    {month && candidates?.eligible.length ? (
                        <div data-guide='submit-movs-invoice' className='mv-invoice'>
                            <Upload maxCount={1} showUploadList={false} beforeUpload={f => { setInvoice(f); setInvoiceFailed(false); return Upload.LIST_IGNORE }}>
                                <Button icon={<UploadOutlined />}>{invoice ? invoice.name : 'Attach invoice (optional)'}</Button>
                            </Upload>
                            {invoiceFailed && (
                                <Alert
                                    type='error'
                                    showIcon
                                    className='mv-alert'
                                    message='The invoice didn’t upload, so nothing was submitted yet.'
                                    action={
                                        <div className='mv-alert-actions'>
                                            <Button size='small' type='primary' loading={saving} onClick={() => { setInvoiceFailed(false); void submit(false) }}>Retry upload</Button>
                                            <Button size='small' loading={saving} onClick={() => { setInvoiceFailed(false); void submit(true) }}>Submit without invoice</Button>
                                        </div>
                                    }
                                />
                            )}
                        </div>
                    ) : null}
                </>
            )}
            {ceremony.element}
        </Modal>
    )
}
