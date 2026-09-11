import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
    Alert,
    Button,
    Empty,
    Grid,
    Modal,
    Segmented,
    Space,
    Spin,
    Tag,
    Tooltip,
    Typography,
    message,
    theme
} from 'antd'
import { ReloadOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { SECTION_ADAPTERS, SectionKey } from '../sections'
import {
    GapMappingResult,
    GapMappingSection,
    mapGapToInterventions
} from '@/services/gapInterventionMappingService'

const { useBreakpoint } = Grid
const { Text } = Typography

type Line = {
    key: string
    path: string
    questionIndex: number
    interventionId: string
    confidence: number
    rationale: string
}

type Props = {
    open: boolean
    onClose: () => void
    gapId?: string | null
    companyName?: string
    /** Sections the viewer can see; the backend narrows this to their department */
    sections: SectionKey[]
}

/**
 * Gap → intervention mapping.
 *
 * Gaps sit on the left, the department's interventions on the right, and the
 * curves between them are drawn from measured DOM positions so they stay
 * correct as the panel reflows.
 */
const GapMappingModal: React.FC<Props> = ({ open, onClose, gapId, companyName, sections }) => {
    const screens = useBreakpoint()
    const isMobile = !screens.md
    const { token } = theme.useToken()

    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [result, setResult] = useState<GapMappingResult | null>(null)
    const [activeSection, setActiveSection] = useState<SectionKey | null>(null)
    const [hoverGap, setHoverGap] = useState<number | null>(null)
    const [hoverIntervention, setHoverIntervention] = useState<string | null>(null)

    const canvasRef = useRef<HTMLDivElement | null>(null)
    const gapRefs = useRef<Record<number, HTMLDivElement | null>>({})
    const interventionRefs = useRef<Record<string, HTMLDivElement | null>>({})
    const [lines, setLines] = useState<Line[]>([])

    const run = useCallback(
        async (regenerate: boolean) => {
            if (!gapId || !sections.length) return
            setLoading(true)
            setError('')
            try {
                const data = await mapGapToInterventions(gapId, sections, { regenerate })
                setResult(data)
                setActiveSection(prev => {
                    if (prev && data.sections.some(s => s.section === prev)) return prev
                    const withGaps = data.sections.find(s => s.gaps.length > 0)
                    return (withGaps || data.sections[0])?.section ?? null
                })
                if (regenerate) message.success('Mapping regenerated.')
            } catch (e: any) {
                setError(e?.message || 'Intervention mapping failed.')
            } finally {
                setLoading(false)
            }
        },
        [gapId, sections]
    )

    useEffect(() => {
        if (!open) return
        if (result) return
        run(false)
    }, [open, result, run])

    // Drop the cached result when the modal closes so a reopen reflects any
    // answers that changed in the meantime.
    useEffect(() => {
        if (open) return
        setResult(null)
        setError('')
        setHoverGap(null)
        setHoverIntervention(null)
        setLines([])
    }, [open])

    const section: GapMappingSection | null = useMemo(
        () => result?.sections.find(s => s.section === activeSection) || null,
        [result, activeSection]
    )

    const interventionsInPlay = useMemo(() => {
        if (!section) return []
        // Showing the whole catalogue drowns the diagram; keep what was mapped.
        const used = new Set(section.edges.map(e => e.interventionId))
        return section.interventions.filter(i => used.has(i.id))
    }, [section])

    const unmapped = useMemo(() => {
        if (!section) return []
        const mapped = new Set(section.edges.map(e => e.questionIndex))
        return section.gaps.filter(g => !mapped.has(g.questionIndex))
    }, [section])

    /** Measure node positions and rebuild the curves. */
    const measure = useCallback(() => {
        const canvas = canvasRef.current
        if (!canvas || !section) {
            setLines([])
            return
        }

        const box = canvas.getBoundingClientRect()
        const next: Line[] = []
        section.edges.forEach(edge => {
            const from = gapRefs.current[edge.questionIndex]
            const to = interventionRefs.current[edge.interventionId]
            if (!from || !to) return

            const a = from.getBoundingClientRect()
            const b = to.getBoundingClientRect()

            const x1 = a.right - box.left
            const y1 = a.top + a.height / 2 - box.top
            const x2 = b.left - box.left
            const y2 = b.top + b.height / 2 - box.top
            const dx = Math.max(40, (x2 - x1) / 2)

            next.push({
                key: `${edge.questionIndex}-${edge.interventionId}`,
                path: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`,
                questionIndex: edge.questionIndex,
                interventionId: edge.interventionId,
                confidence: edge.confidence,
                rationale: edge.rationale
            })
        })
        setLines(next)
    }, [section])

    useLayoutEffect(() => {
        measure()
    }, [measure, section, isMobile])

    useEffect(() => {
        if (!open) return
        const canvas = canvasRef.current
        if (!canvas || typeof ResizeObserver === 'undefined') return
        const observer = new ResizeObserver(() => measure())
        observer.observe(canvas)
        return () => observer.disconnect()
    }, [open, measure])

    const isDimmed = (line: Line) => {
        if (hoverGap == null && hoverIntervention == null) return false
        if (hoverGap != null && line.questionIndex === hoverGap) return false
        if (hoverIntervention != null && line.interventionId === hoverIntervention) return false
        return true
    }

    const edgeColor = (confidence: number) =>
        confidence >= 70 ? token.colorPrimary : confidence >= 40 ? token.colorWarning : token.colorTextQuaternary

    const body = () => {
        if (loading) {
            return (
                <div style={{ padding: 48, textAlign: 'center' }}>
                    <Spin tip='Mapping gaps to interventions…' size='large'>
                        <div style={{ height: 80 }} />
                    </Spin>
                </div>
            )
        }

        if (error) {
            return (
                <Alert
                    type='error'
                    showIcon
                    message='Mapping unavailable'
                    description={error}
                    action={
                        <Button size='small' onClick={() => run(false)}>
                            Retry
                        </Button>
                    }
                />
            )
        }

        if (!result || !result.sections.length) {
            return <Empty description='Nothing to map for your department on this GAP.' />
        }

        return (
            <Space direction='vertical' size={12} style={{ width: '100%' }}>
                {result.sections.length > 1 && (
                    <Segmented
                        value={activeSection ?? undefined}
                        onChange={value => setActiveSection(value as SectionKey)}
                        options={result.sections.map(s => ({
                            value: s.section,
                            label: `${SECTION_ADAPTERS[s.section]?.title ?? s.section} (${s.gaps.length})`
                        }))}
                        style={{ overflowX: 'auto', maxWidth: '100%' }}
                    />
                )}

                {!section ? null : section.note ? (
                    <Alert type='info' showIcon message={section.note} />
                ) : (
                    <>
                        <Text type='secondary' style={{ fontSize: 12 }}>
                            {section.departmentName} · {section.gaps.length} gap
                            {section.gaps.length === 1 ? '' : 's'} · {section.edges.length} suggested
                            link{section.edges.length === 1 ? '' : 's'}
                        </Text>

                        <div
                            ref={canvasRef}
                            style={{
                                position: 'relative',
                                display: 'grid',
                                gridTemplateColumns: isMobile ? '1fr' : 'minmax(0,1fr) 160px minmax(0,1fr)',
                                alignItems: 'start',
                                gap: isMobile ? 12 : 0
                            }}
                        >
                            {/* Curves sit behind the cards, spanning the whole canvas */}
                            {!isMobile && (
                                <svg
                                    // Sized by CSS rather than measurement: a zero-width
                                    // measurement would otherwise blank the whole overlay.
                                    // inset:0 makes SVG user units match container pixels.
                                    style={{
                                        position: 'absolute',
                                        inset: 0,
                                        width: '100%',
                                        height: '100%',
                                        pointerEvents: 'none',
                                        overflow: 'visible'
                                    }}
                                >
                                    {lines.map(line => (
                                        <path
                                            key={line.key}
                                            d={line.path}
                                            fill='none'
                                            stroke={edgeColor(line.confidence)}
                                            strokeWidth={isDimmed(line) ? 1 : 2}
                                            strokeOpacity={isDimmed(line) ? 0.15 : 0.85}
                                            strokeLinecap='round'
                                        />
                                    ))}
                                </svg>
                            )}

                            {/* Gaps */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, zIndex: 1 }}>
                                <ColumnLabel token={token} text='Identified gaps' />
                                {section.gaps.map(gap => {
                                    const linked = section.edges.filter(
                                        e => e.questionIndex === gap.questionIndex
                                    )
                                    const active = hoverGap === gap.questionIndex
                                    return (
                                        <div
                                            key={gap.questionIndex}
                                            ref={el => {
                                                gapRefs.current[gap.questionIndex] = el
                                            }}
                                            onMouseEnter={() => setHoverGap(gap.questionIndex)}
                                            onMouseLeave={() => setHoverGap(null)}
                                            style={{
                                                border: `1px solid ${active ? token.colorPrimary : token.colorBorderSecondary}`,
                                                background: token.colorBgContainer,
                                                borderRadius: token.borderRadius,
                                                padding: '8px 10px',
                                                marginRight: isMobile ? 0 : 8
                                            }}
                                        >
                                            <div style={{ display: 'flex', gap: 8 }}>
                                                <span
                                                    style={{
                                                        color: token.colorTextTertiary,
                                                        fontVariantNumeric: 'tabular-nums'
                                                    }}
                                                >
                                                    {gap.questionIndex + 1}
                                                </span>
                                                <span style={{ flex: 1, minWidth: 0 }}>{gap.question}</span>
                                                <Tag
                                                    color={gap.answer.toLowerCase() === 'no' ? 'red' : undefined}
                                                    style={{ marginInlineEnd: 0 }}
                                                >
                                                    {gap.answer}
                                                </Tag>
                                            </div>
                                            {gap.comment ? (
                                                <div
                                                    style={{
                                                        marginTop: 4,
                                                        fontSize: 12,
                                                        color: token.colorTextSecondary
                                                    }}
                                                >
                                                    {gap.comment}
                                                </div>
                                            ) : null}
                                            {!linked.length && (
                                                <div
                                                    style={{
                                                        marginTop: 4,
                                                        fontSize: 12,
                                                        color: token.colorTextTertiary
                                                    }}
                                                >
                                                    No confident match
                                                </div>
                                            )}
                                        </div>
                                    )
                                })}
                            </div>

                            {/* Spacer column the curves cross */}
                            {!isMobile && <div />}

                            {/* Interventions */}
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, zIndex: 1 }}>
                                <ColumnLabel token={token} text='Suggested interventions' />
                                {interventionsInPlay.length === 0 ? (
                                    <Alert
                                        type='warning'
                                        showIcon
                                        message='No interventions matched these gaps.'
                                    />
                                ) : (
                                    interventionsInPlay.map(item => {
                                        const linked = section.edges.filter(
                                            e => e.interventionId === item.id
                                        )
                                        const best = Math.max(...linked.map(e => e.confidence), 0)
                                        const active = hoverIntervention === item.id
                                        return (
                                            <div
                                                key={item.id}
                                                ref={el => {
                                                    interventionRefs.current[item.id] = el
                                                }}
                                                onMouseEnter={() => setHoverIntervention(item.id)}
                                                onMouseLeave={() => setHoverIntervention(null)}
                                                style={{
                                                    border: `1px solid ${active ? token.colorPrimary : token.colorBorderSecondary}`,
                                                    background: token.colorBgContainer,
                                                    borderRadius: token.borderRadius,
                                                    padding: '8px 10px',
                                                    marginLeft: isMobile ? 0 : 8
                                                }}
                                            >
                                                <div
                                                    style={{
                                                        display: 'flex',
                                                        gap: 8,
                                                        alignItems: 'baseline'
                                                    }}
                                                >
                                                    <span style={{ flex: 1, minWidth: 0 }}>{item.title}</span>
                                                    <Tooltip
                                                        title={linked
                                                            .map(e => e.rationale)
                                                            .filter(Boolean)
                                                            .join(' · ')}
                                                    >
                                                        <Tag
                                                            color={
                                                                best >= 70
                                                                    ? 'blue'
                                                                    : best >= 40
                                                                        ? 'orange'
                                                                        : undefined
                                                            }
                                                            style={{ marginInlineEnd: 0 }}
                                                        >
                                                            {best}%
                                                        </Tag>
                                                    </Tooltip>
                                                </div>
                                                <div
                                                    style={{
                                                        marginTop: 4,
                                                        fontSize: 12,
                                                        color: token.colorTextSecondary
                                                    }}
                                                >
                                                    Covers {linked.length} gap
                                                    {linked.length === 1 ? '' : 's'}
                                                </div>
                                            </div>
                                        )
                                    })
                                )}
                            </div>
                        </div>

                        {unmapped.length > 0 && (
                            <Alert
                                type='info'
                                showIcon
                                message={`${unmapped.length} gap${unmapped.length === 1 ? '' : 's'} had no confident intervention match`}
                                description='These may need a new intervention in the catalogue, or referral to another department.'
                            />
                        )}

                        <Text type='secondary' style={{ fontSize: 12 }}>
                            AI-suggested mapping — review before acting on it.
                            {result.cached ? ' Showing a previously saved mapping.' : ''}
                        </Text>
                    </>
                )}
            </Space>
        )
    }

    return (
        <Modal
            title={
                <Space>
                    <ThunderboltOutlined />
                    <span>Intervention Mapping{companyName ? ` — ${companyName}` : ''}</span>
                </Space>
            }
            open={open}
            onCancel={onClose}
            width={isMobile ? '100%' : 1100}
            style={isMobile ? { top: 8 } : undefined}
            styles={{ body: { maxHeight: '72vh', overflowY: 'auto' } }}
            footer={
                <Space>
                    <Button
                        shape='round'
                        icon={<ReloadOutlined />}
                        loading={loading}
                        onClick={() => run(true)}
                    >
                        Regenerate
                    </Button>
                    <Button shape='round' onClick={onClose}>
                        Close
                    </Button>
                </Space>
            }
        >
            {body()}
        </Modal>
    )
}

const ColumnLabel: React.FC<{ token: any; text: string }> = ({ token, text }) => (
    <div
        style={{
            fontSize: 12,
            color: token.colorTextTertiary,
            textTransform: 'uppercase',
            letterSpacing: 0.4,
            marginBottom: 2
        }}
    >
        {text}
    </div>
)

export default GapMappingModal
