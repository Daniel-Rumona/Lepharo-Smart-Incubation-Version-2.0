import React, { useState } from 'react'
import { Button, Input, Modal, message } from 'antd'
import { CheckOutlined, CloseOutlined, UndoOutlined } from '@ant-design/icons'
import { displayName, toDayjs, type Application } from './applicationData'
import { decideApplication, reopenApplication } from './applicationDecision'

type Props = {
    app: Application
    /** Re-reads the application after a change and returns the fresh copy. */
    onChanged: (id: string) => Promise<unknown>
}

/**
 * The decision actions, shown in the detail header beside the status. Accept is the page's one primary action and is always
 * confirmed, with its side effects spelled out; Reject requires a reason;
 * a decided application can be reopened, with a warning that acceptance
 * side effects stay.
 */
export const DecisionActions: React.FC<Props> = ({ app, onChanged }) => {
    const [modal, contextHolder] = Modal.useModal()
    const [busy, setBusy] = useState<'accept' | 'reject' | 'reopen' | null>(null)
    const [rejectOpen, setRejectOpen] = useState(false)
    const [reason, setReason] = useState('')
    const name = displayName(app)

    const run = async (kind: 'accept' | 'reject' | 'reopen', action: () => Promise<string>) => {
        setBusy(kind)
        try {
            const note = await action()
            await onChanged(app.id)
            message.success(note)
        } catch (e: any) {
            console.error('[applications] decision failed:', e)
            message.error(`Could not update the application: ${e?.message || String(e)}`)
        } finally {
            setBusy(null)
        }
    }

    const confirmAccept = () =>
        modal.confirm({
            title: `Accept ${name}?`,
            icon: <CheckOutlined style={{ color: 'var(--app-accent)' }} />,
            content: (
                <div>
                    <p style={{ marginBottom: 6 }}>Accepting will:</p>
                    <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                        <li>mark the application as accepted,</li>
                        <li>ask the applicant to complete onboarding on their next sign-in,</li>
                        <li>add the programme&apos;s compulsory interventions to their plan.</li>
                    </ul>
                </div>
            ),
            okText: 'Accept application',
            cancelText: 'Cancel',
            onOk: () =>
                run('accept', async () => {
                    const { addedInterventions } = await decideApplication(app.id, 'accepted')
                    return addedInterventions
                        ? `Accepted · ${addedInterventions} compulsory intervention${addedInterventions === 1 ? '' : 's'} added`
                        : 'Application accepted'
                })
        })

    const submitReject = async () => {
        const text = reason.trim()
        if (!text) return
        setRejectOpen(false)
        await run('reject', async () => {
            await decideApplication(app.id, 'rejected', text)
            return 'Application rejected'
        })
        setReason('')
    }

    const confirmReopen = () =>
        modal.confirm({
            title: `Reopen ${name}?`,
            icon: <UndoOutlined />,
            content:
                app.applicationStatus === 'accepted'
                    ? 'The status goes back to Pending. Interventions already added and the onboarding prompt stay in place — remove them separately if needed.'
                    : 'The status goes back to Pending so the application can be decided again. The rejection reason is kept in its history.',
            okText: 'Reopen',
            cancelText: 'Cancel',
            onOk: () =>
                run('reopen', async () => {
                    await reopenApplication(app.id, app.applicationStatus)
                    return 'Application reopened'
                })
        })

    return (
        <>
            {contextHolder}
            <div className='ws-detail-actions'>
                {app.applicationStatus === 'pending' ? (
                    <>
                        <Button
                            danger
                            icon={<CloseOutlined />}
                            loading={busy === 'reject'}
                            disabled={!!busy}
                            onClick={() => setRejectOpen(true)}
                        >
                            Reject
                        </Button>
                        <Button
                            type='primary'
                            icon={<CheckOutlined />}
                            loading={busy === 'accept'}
                            disabled={!!busy}
                            onClick={confirmAccept}
                        >
                            Accept
                        </Button>
                    </>
                ) : (
                    <Button icon={<UndoOutlined />} loading={busy === 'reopen'} onClick={confirmReopen}>
                        Reopen
                    </Button>
                )}
            </div>

            <Modal
                open={rejectOpen}
                title={`Reject ${name}?`}
                okText='Reject application'
                okButtonProps={{ danger: true, disabled: !reason.trim() }}
                // The X closes it; one full-width action reads clearer than Cancel + Reject.
                cancelButtonProps={{ style: { display: 'none' } }}
                onOk={submitReject}
                onCancel={() => setRejectOpen(false)}
                destroyOnClose
            >
                <p className='ws-muted' style={{ marginBottom: 8 }}>
                    The reason is saved with the decision and shown to reviewers.
                </p>
                <Input.TextArea
                    autoFocus
                    autoSize={{ minRows: 3, maxRows: 8 }}
                    placeholder='Why is this application being rejected?'
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    maxLength={1000}
                    showCount
                    // antd places the counter below the box, outside its height; leave room for it.
                    style={{ marginBottom: 22 }}
                />
            </Modal>
        </>
    )
}

/** "Accepted by … on …" for a decided application; nothing while pending. */
export const DecisionNote: React.FC<{ app: Application }> = ({ app }) => {
    if (app.applicationStatus === 'pending') return null
    const decidedAt = toDayjs(app.decision?.decidedAt)
    const decidedBy = app.decision?.decidedBy?.email
    if (!decidedAt && !decidedBy) return null
    return (
        <span className='apx-decision-note'>
            {decidedBy ? `by ${decidedBy}` : ''}
            {decidedAt ? `${decidedBy ? ' · ' : ''}${decidedAt.format('D MMM YYYY')}` : ''}
        </span>
    )
}
