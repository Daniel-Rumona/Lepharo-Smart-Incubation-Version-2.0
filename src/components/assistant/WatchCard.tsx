import React, { useEffect, useState } from 'react'
import { Button, Skeleton, Typography, theme } from 'antd'
import { CheckCircleFilled, EyeOutlined } from '@ant-design/icons'
import { motion, useReducedMotion } from 'framer-motion'
import { previewWatch, startWatch, withChoice, type WatchDraft, type WatchPreview } from '@/services/watchService'
import { endsOnFire, WATCH_LIFETIME_DAYS } from '../../../functions/src/watchesLogic'

const { Text } = Typography

const CHOOSE_LABEL = { participant: 'Which SME?', programme: 'Which programme?', intervention: 'Which intervention?' }

/**
 * A watch the assistant drafted from the person's words, under its reply. It is matched to real
 * records first (names can be ambiguous) and says what already matches, since a watch only
 * reports what changes from now on. Nothing is saved until Start watching. When the assistant
 * offered the watch after an answer (rather than being asked for one), the card is one question
 * until accepted, and nothing is looked up before that.
 */
export const WatchCard: React.FC<{ draft: WatchDraft; words?: string; onStarted?: () => void }> = ({ draft, words, onStarted }) => {
    const { token } = theme.useToken()
    const reduced = useReducedMotion()
    const [spec, setSpec] = useState<WatchDraft>(draft)
    const [preview, setPreview] = useState<WatchPreview | null>(null)
    const [loading, setLoading] = useState(true)
    const [starting, setStarting] = useState(false)
    const [started, setStarted] = useState(false)
    const [accepted, setAccepted] = useState(!draft.offer)

    useEffect(() => {
        if (!accepted) return
        let live = true
        setLoading(true)
        previewWatch(spec)
            .then(result => {
                if (!live) return
                setPreview(result)
                if (result.alreadyWatching) setStarted(true)
            })
            .catch(() => { if (live) setPreview({ problem: "This watch couldn't be checked right now. Try again shortly." }) })
            .finally(() => { if (live) setLoading(false) })
        return () => { live = false }
    }, [spec, accepted])

    const start = async () => {
        setStarting(true)
        try {
            const result = await startWatch(preview?.spec || spec, words)
            if (result.id) {
                setStarted(true)
                onStarted?.()
            } else {
                setPreview(current => ({ ...current, problem: result.problem || 'That watch could not be started.' }))
            }
        } catch {
            setPreview(current => ({ ...current, problem: 'That watch could not be started. Try again.' }))
        } finally {
            setStarting(false)
        }
    }

    const already = preview?.alreadyMatching || []

    if (!accepted) {
        return (
            <Button shape='round' icon={<EyeOutlined />} onClick={() => setAccepted(true)} style={{ alignSelf: 'flex-start' }}>
                Want me to tell you when this changes?
            </Button>
        )
    }
    return (
        <motion.section
            initial={reduced ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            aria-label='Suggested watch'
            style={{
                width: '100%',
                maxWidth: 440,
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
                    : <EyeOutlined style={{ color: token.colorPrimary }} aria-hidden />}
                <Text strong>{started ? 'Watching' : 'Watch'}</Text>
                <Text type='secondary' style={{ fontSize: 12, marginLeft: 'auto' }}>Checked every morning</Text>
            </div>

            {loading ? (
                <Skeleton active title={false} paragraph={{ rows: 2 }} />
            ) : preview?.choose ? (
                <div style={{ display: 'grid', gap: 6 }}>
                    <Text>{CHOOSE_LABEL[preview.choose.field]}</Text>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {preview.choose.options.map(option => (
                            <Button key={option.id} size='small' shape='round' onClick={() => setSpec(withChoice(spec, preview.choose!.field, option))}>
                                {option.name}
                            </Button>
                        ))}
                    </div>
                </div>
            ) : (
                <>
                    {preview?.description ? <Text>{preview.description}</Text> : null}
                    {already.length && !started ? (
                        <Text type='secondary' style={{ fontSize: 12 }}>
                            Already true now: {already.slice(0, 3).join('; ')}{already.length > 3 ? `; and ${already.length - 3} more` : ''}.
                            {' '}You'll hear only about changes from here on.
                        </Text>
                    ) : null}
                    {preview?.problem ? <Text type='danger' style={{ fontSize: 12 }}>{preview.problem}</Text> : null}
                    {started ? (
                        <Text type='secondary' style={{ fontSize: 12 }}>
                            You'll get a notification, and it'll lead your morning brief, when this happens.{' '}
                            {endsOnFire(preview?.spec || spec as any) ? 'It ends once it has told you.' : `It runs for ${WATCH_LIFETIME_DAYS} days or until you end it.`}
                        </Text>
                    ) : preview?.spec ? (
                        <Button type='primary' shape='round' icon={<EyeOutlined />} loading={starting} onClick={() => void start()} style={{ justifySelf: 'start' }}>
                            Start watching
                        </Button>
                    ) : null}
                </>
            )}
        </motion.section>
    )
}

export default WatchCard
