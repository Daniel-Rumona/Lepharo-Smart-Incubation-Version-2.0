import React, { useEffect, useState } from 'react'
import { Button, Popconfirm, Progress, Typography, message, theme } from 'antd'
import { SendOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { endChaser, escalateChaser, extendChaser, listMyChasers, waitingOnYou, type Chaser } from '@/services/chaserService'
import { waitingOn } from '../../../functions/src/chasersLogic'

const { Text } = Typography

const STATUS_TEXT: Record<Chaser['status'], string> = { active: '', done: 'Done', ended: 'Stopped', expired: 'Finished' }
const RECENT_DAYS = 14
const OPEN_SHOWN = 4

/**
 * The person's chasers, in the Chasers popover on the Data Assistant's welcome screen: progress,
 * what is still waiting and on whom, and, for items that used their nudges, the decision the
 * chaser is waiting on (escalate to line managers, one more nudge, or leave it).
 */
export const ChasersList: React.FC<{ onChange?: () => void }> = ({ onChange }) => {
    const { token } = theme.useToken()
    const [chasers, setChasers] = useState<Chaser[] | null>(null)
    const [busy, setBusy] = useState<string | null>(null)

    const load = () => listMyChasers().then(setChasers).catch(() => setChasers([]))
    useEffect(() => { void load() }, [])

    const act = async (id: string, run: () => Promise<{ problem?: string } & Record<string, unknown>>, done: (result: any) => string) => {
        setBusy(id)
        try {
            const result = await run()
            if (result.problem) message.info(result.problem)
            else message.success(done(result))
            await load()
            onChange?.()
        } catch {
            message.error("That didn't work. Try again.")
        } finally {
            setBusy(null)
        }
    }

    if (chasers === null) return null
    const shown = chasers.filter(chaser => chaser.status === 'active' || dayjs().diff(chaser.createdAt, 'day') <= RECENT_DAYS)

    return (
        <section style={{ width: 'min(440px, 86vw)', textAlign: 'left' }} aria-label='Your chasers'>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                <SendOutlined style={{ fontSize: 16, color: token.colorPrimary }} aria-hidden />
                <Text strong style={{ flex: 1 }}>Your chasers</Text>
                <Text type='secondary' style={{ fontSize: 12 }}>Weekday mornings</Text>
            </div>
            {!shown.length ? (
                <Text type='secondary' style={{ fontSize: 12 }}>
                    Ask me to chase MOVs by a date, for example “Get the MOVs waiting for HOD approval approved by Friday”.
                </Text>
            ) : (
                <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 14 }}>
                    {shown.map(chaser => {
                        const done = chaser.items.filter(item => item.done).length
                        const open = chaser.items.filter(item => !item.done)
                        const decide = chaser.status === 'active' ? waitingOnYou(chaser) : []
                        return (
                            <li key={chaser.id} style={{ display: 'grid', gap: 4 }}>
                                <Text>
                                    {chaser.description}
                                    {STATUS_TEXT[chaser.status] ? <Text type='secondary'> · {STATUS_TEXT[chaser.status]}</Text> : null}
                                </Text>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <Progress
                                        percent={chaser.items.length ? Math.round((done / chaser.items.length) * 100) : 0}
                                        size='small'
                                        showInfo={false}
                                        style={{ flex: 1, margin: 0 }}
                                        aria-label={`${done} of ${chaser.items.length} done`}
                                    />
                                    <Text type='secondary' style={{ fontSize: 12 }}>{done} of {chaser.items.length} done</Text>
                                </div>
                                {open.length && chaser.status === 'active' ? (
                                    <Text type='secondary' style={{ fontSize: 12 }}>
                                        Waiting: {open.slice(0, OPEN_SHOWN).map(item => {
                                            const why = item.skipped ? 'not nudged' : `${item.nudges} nudge${item.nudges === 1 ? '' : 's'}`
                                            return `${item.label} (${waitingOn(item.collection, item.status)}, ${why})`
                                        }).join('; ')}
                                        {open.length > OPEN_SHOWN ? `; and ${open.length - OPEN_SHOWN} more` : ''}
                                    </Text>
                                ) : null}
                                {chaser.log[0] ? (
                                    <Text type='secondary' style={{ fontSize: 12 }}>
                                        {dayjs(chaser.log[0].at).format('D MMM')}: {chaser.log[0].text}
                                    </Text>
                                ) : null}
                                {decide.length ? (
                                    <div style={{ display: 'grid', gap: 6, padding: '8px 10px', borderRadius: 10, background: token.colorWarningBg, border: `1px solid ${token.colorWarningBorder}` }}>
                                        <Text style={{ fontSize: 13 }}>
                                            {decide.length} still waiting after {chaser.spec.maxNudges} nudge{chaser.spec.maxNudges === 1 ? '' : 's'}. What next?
                                        </Text>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                            <Popconfirm
                                                title='Escalate to their line managers?'
                                                description='Each gets one message saying what is stuck with their team member.'
                                                okText='Escalate'
                                                cancelText='Not yet'
                                                onConfirm={() => act(chaser.id, () => escalateChaser(chaser.id), result => (result.escalated || []).join('. ') || 'Escalated.')}
                                            >
                                                <Button size='small' type='primary' loading={busy === chaser.id}>Escalate</Button>
                                            </Popconfirm>
                                            <Button size='small' disabled={busy === chaser.id} onClick={() => void act(chaser.id, () => extendChaser(chaser.id), result => `One more nudge allowed${result.nudged ? `; ${result.nudged} sent now` : ''}.`)}>
                                                One more nudge
                                            </Button>
                                        </div>
                                    </div>
                                ) : null}
                                {chaser.status === 'active' ? (
                                    <Popconfirm title='Stop this chaser?' description='No more nudges will go out.' okText='Stop it' cancelText='Keep' onConfirm={() => act(chaser.id, () => endChaser(chaser.id), () => 'Chaser stopped.')}>
                                        <Button size='small' type='text' disabled={busy === chaser.id} style={{ justifySelf: 'start', paddingLeft: 0 }}>Stop</Button>
                                    </Popconfirm>
                                ) : null}
                            </li>
                        )
                    })}
                </ul>
            )}
        </section>
    )
}

export default ChasersList
