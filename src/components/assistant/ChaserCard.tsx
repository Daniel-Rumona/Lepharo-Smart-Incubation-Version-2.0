import React, { useEffect, useState } from 'react'
import { Button, Skeleton, Typography, theme } from 'antd'
import { CheckCircleFilled, SendOutlined } from '@ant-design/icons'
import { motion, useReducedMotion } from 'framer-motion'
import { previewChaser, startChaser, type ChaserDraft, type ChaserPreview } from '@/services/chaserService'

const { Text } = Typography

const SHOWN = 6

/**
 * A chaser the assistant drafted from the person's words, under its reply. It lists the records
 * it found (so the person sees exactly who will be nudged about what) and the allowance. Nothing
 * is sent until Start chasing, which sends the first nudges straight away.
 */
export const ChaserCard: React.FC<{ draft: ChaserDraft; words?: string; onStarted?: () => void }> = ({ draft, words, onStarted }) => {
    const { token } = theme.useToken()
    const reduced = useReducedMotion()
    const [spec, setSpec] = useState<ChaserDraft>(draft)
    const [preview, setPreview] = useState<ChaserPreview | null>(null)
    const [loading, setLoading] = useState(true)
    const [starting, setStarting] = useState(false)
    const [started, setStarted] = useState<ChaserPreview | null>(null)
    const [showAll, setShowAll] = useState(false)

    useEffect(() => {
        let live = true
        setLoading(true)
        previewChaser(spec)
            .then(result => {
                if (!live) return
                setPreview(result)
                if (result.alreadyChasing) setStarted(result)
            })
            .catch(error => {
                if (!live) return
                const denied = String(error?.code || '').includes('permission-denied')
                setPreview({ problem: denied ? error.message : "This chaser couldn't be checked right now. Try again shortly." })
            })
            .finally(() => { if (live) setLoading(false) })
        return () => { live = false }
    }, [spec])

    const start = async () => {
        setStarting(true)
        try {
            const result = await startChaser(preview?.spec || spec, words)
            if (result.id) {
                setStarted(result)
                onStarted?.()
            } else {
                setPreview(current => ({ ...current, problem: result.problem || 'That chaser could not be started.' }))
            }
        } catch {
            setPreview(current => ({ ...current, problem: 'That chaser could not be started. Try again.' }))
        } finally {
            setStarting(false)
        }
    }

    const items = preview?.items || []
    const shown = showAll ? items : items.slice(0, SHOWN)

    return (
        <motion.section
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            aria-label='Suggested chaser'
            style={{
                width: '100%',
                maxWidth: 460,
                padding: '12px 14px',
                borderRadius: 14,
                border: `1px solid ${started ? token.colorSuccessBorder : token.colorBorderSecondary}`,
                background: token.colorBgContainer,
                display: 'grid',
                gap: 8
            }}
        >
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {started
                    ? <CheckCircleFilled style={{ color: token.colorSuccess }} aria-hidden />
                    : <SendOutlined style={{ color: token.colorPrimary }} aria-hidden />}
                <Text strong>{started ? 'Chasing' : 'Chaser'}</Text>
                <Text type='secondary' style={{ fontSize: 12, marginLeft: 'auto' }}>Weekday mornings</Text>
            </div>

            {loading ? (
                <Skeleton active title={false} paragraph={{ rows: 3 }} />
            ) : preview?.choose ? (
                <div style={{ display: 'grid', gap: 6 }}>
                    <Text>Which programme?</Text>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {preview.choose.options.map(option => (
                            <Button key={option.id} size='small' shape='round' onClick={() => setSpec({ ...spec, programId: option.id, programName: option.name })}>
                                {option.name}
                            </Button>
                        ))}
                    </div>
                </div>
            ) : (
                <>
                    {preview?.description ? <Text>{preview.description}</Text> : null}
                    {items.length ? (
                        <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 2, fontSize: 13 }}>
                            {shown.map((item, index) => (
                                <li key={index}>
                                    {item.label} <Text type='secondary' style={{ fontSize: 12 }}>· waiting on {item.waitingOn}</Text>
                                </li>
                            ))}
                            {items.length > SHOWN && !showAll ? (
                                <li style={{ listStyle: 'none', marginLeft: -18 }}>
                                    <Button type='link' size='small' style={{ padding: 0 }} onClick={() => setShowAll(true)}>
                                        Show all {items.length}
                                    </Button>
                                </li>
                            ) : null}
                        </ul>
                    ) : null}
                    {preview?.problem ? <Text type='danger' style={{ fontSize: 12 }}>{preview.problem}</Text> : null}
                    {started ? (
                        <Text type='secondary' style={{ fontSize: 12 }}>
                            {started.alreadyChasing
                                ? 'This chaser is already running.'
                                : `${started.nudged ? `First nudges sent for ${started.nudged}.` : 'Nothing could be nudged yet; it will keep checking.'}`}
                            {' '}It stops when everything has moved on, and asks you before escalating anything.
                        </Text>
                    ) : preview?.spec && items.length ? (
                        <>
                            <Text type='secondary' style={{ fontSize: 12 }}>
                                Nudges go out in your name through the Intervention Oversight reminder, one a day at most per record.
                            </Text>
                            <Button type='primary' shape='round' icon={<SendOutlined />} loading={starting} onClick={() => void start()} style={{ justifySelf: 'start' }}>
                                Start chasing
                            </Button>
                        </>
                    ) : null}
                </>
            )}
        </motion.section>
    )
}

export default ChaserCard
