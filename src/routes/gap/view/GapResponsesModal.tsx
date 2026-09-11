import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Empty, Grid, Modal, Space, Spin, Switch, Tag, Typography, theme } from 'antd'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/firebase'
import {
    AnswerState,
    QA,
    SECTION_ADAPTERS,
    SectionKey,
    getAnswerStates,
    yes
} from '../sections'

const { useBreakpoint } = Grid
const { Text } = Typography

type Props = {
    open: boolean
    onClose: () => void
    gapId?: string | null
    /** Sections to show — normally the viewer's own department's */
    sections: SectionKey[]
    companyName?: string
}

/**
 * Read-only view of a GAP's answers for a given set of sections.
 *
 * Exists so a planner can check the source answers without leaving the plan
 * builder — navigating to the GAP page would unmount the builder and discard
 * any selections not yet saved.
 */
const GapResponsesModal: React.FC<Props> = ({
    open,
    onClose,
    gapId,
    sections,
    companyName
}) => {
    const screens = useBreakpoint()
    const isMobile = !screens.md
    const { token } = theme.useToken()

    const [loading, setLoading] = useState(false)
    const [gap, setGap] = useState<any | null>(null)
    const [error, setError] = useState('')
    const [gapsOnly, setGapsOnly] = useState(true)

    useEffect(() => {
        if (!open || !gapId) return

        let cancelled = false
        setLoading(true)
        setError('')

        getDoc(doc(db, 'gapAnalysis', gapId))
            .then(snapshot => {
                if (cancelled) return
                if (!snapshot.exists()) {
                    setError('This GAP Analysis could not be found.')
                    setGap(null)
                    return
                }
                setGap({ id: snapshot.id, ...(snapshot.data() as any) })
            })
            .catch(e => {
                console.error('Failed to load GAP responses', e)
                if (!cancelled) setError('The GAP responses could not be loaded.')
            })
            .finally(() => {
                if (!cancelled) setLoading(false)
            })

        return () => {
            cancelled = true
        }
    }, [open, gapId])

    const blocks = useMemo(() => {
        if (!gap) return []

        return sections.map(section => {
            const def = SECTION_ADAPTERS[section]
            const states = getAnswerStates(gap, section)
            const qas: QA[] = def.getQA(gap)

            const rows = def.qText.map((question, index) => ({
                index,
                question,
                state: states[index] || ('blank' as AnswerState),
                answer: qas?.[index]?.answer || '',
                comment: qas?.[index]?.comment || ''
            }))

            return {
                section,
                title: def.title,
                states,
                rows,
                gapCount: states.filter(s => s !== 'yes').length
            }
        })
    }, [gap, sections])

    const colourFor = (state: AnswerState) =>
        state === 'yes'
            ? token.colorSuccess
            : state === 'no'
                ? token.colorError
                : token.colorFill

    return (
        <Modal
            title={`GAP responses${companyName ? ` — ${companyName}` : ''}`}
            open={open}
            onCancel={onClose}
            footer={null}
            width={isMobile ? '100%' : 900}
            style={isMobile ? { top: 8 } : undefined}
            styles={{ body: { maxHeight: '72vh', overflowY: 'auto' } }}
            destroyOnClose
        >
            {loading ? (
                <div style={{ padding: 40, textAlign: 'center' }}>
                    <Spin />
                </div>
            ) : error ? (
                <Alert type='error' showIcon message={error} />
            ) : !blocks.length ? (
                <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description='No sections to show for your department.'
                />
            ) : (
                <Space direction='vertical' size={16} style={{ width: '100%' }}>
                    <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
                        <Switch size='small' checked={gapsOnly} onChange={setGapsOnly} />
                        <Text>Show gaps only</Text>
                    </Space>

                    {blocks.map(block => {
                        const rows = gapsOnly
                            ? block.rows.filter(row => row.state !== 'yes')
                            : block.rows

                        return (
                            <div key={block.section}>
                                <Space
                                    align='center'
                                    style={{
                                        width: '100%',
                                        justifyContent: 'space-between',
                                        marginBottom: 8
                                    }}
                                >
                                    <Text strong>{block.title}</Text>
                                    <Text type='secondary' style={{ fontSize: 12 }}>
                                        {block.gapCount} gap{block.gapCount === 1 ? '' : 's'} of{' '}
                                        {block.rows.length}
                                    </Text>
                                </Space>

                                <div
                                    style={{
                                        display: 'grid',
                                        gridTemplateColumns: `repeat(${block.states.length}, minmax(0, 1fr))`,
                                        maxWidth:
                                            block.states.length * 64 +
                                            (block.states.length - 1) * 4,
                                        gap: 4,
                                        marginBottom: 10
                                    }}
                                >
                                    {block.states.map((state, index) => (
                                        <div
                                            key={index}
                                            title={`Q${index + 1} — ${state === 'yes' ? 'Yes' : state === 'no' ? 'No' : 'Unanswered'}`}
                                            style={{
                                                height: 22,
                                                borderRadius: 4,
                                                border: `1px solid ${token.colorBorderSecondary}`,
                                                background: colourFor(state)
                                            }}
                                        />
                                    ))}
                                </div>

                                {rows.length === 0 ? (
                                    <Text type='secondary'>
                                        No gaps — every question answered Yes.
                                    </Text>
                                ) : (
                                    rows.map(row => (
                                        <div
                                            key={row.index}
                                            style={{
                                                display: 'flex',
                                                gap: 12,
                                                padding: '8px 4px',
                                                borderTop: `1px solid ${token.colorBorderSecondary}`
                                            }}
                                        >
                                            <div
                                                style={{
                                                    flex: '0 0 auto',
                                                    width: 3,
                                                    borderRadius: 2,
                                                    background: colourFor(row.state)
                                                }}
                                            />
                                            <div
                                                style={{
                                                    flex: '0 0 auto',
                                                    width: 22,
                                                    color: token.colorTextTertiary,
                                                    fontVariantNumeric: 'tabular-nums'
                                                }}
                                            >
                                                {row.index + 1}
                                            </div>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div>{row.question}</div>
                                                {row.comment ? (
                                                    <div
                                                        style={{
                                                            marginTop: 2,
                                                            fontSize: 12,
                                                            color: token.colorTextSecondary,
                                                            whiteSpace: 'pre-wrap'
                                                        }}
                                                    >
                                                        {row.comment}
                                                    </div>
                                                ) : null}
                                            </div>
                                            <div style={{ flex: '0 0 auto' }}>
                                                {row.answer ? (
                                                    <Tag color={yes(row.answer) ? 'green' : 'red'}>
                                                        {row.answer}
                                                    </Tag>
                                                ) : (
                                                    <Tag>—</Tag>
                                                )}
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                        )
                    })}
                </Space>
            )}
        </Modal>
    )
}

export default GapResponsesModal
