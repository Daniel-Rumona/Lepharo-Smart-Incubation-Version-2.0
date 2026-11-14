import React, { useEffect, useState } from 'react'
import { Alert, Button, Col, Descriptions, Row, Skeleton, Space, Tag, Tooltip, Typography, theme } from 'antd'
import { ArrowRightOutlined, InfoCircleOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import {
    IMPACT_METRIC_LABEL,
    formatChange,
    formatLift,
    formatPoints,
    formatRange,
    impactForIntervention,
    metricOf,
    programmeNames,
    type InterventionImpact
} from '@/services/interventionImpactService'

const { Text } = Typography

export const IMPACT_STATUS: Record<InterventionImpact['status'], { label: string; color: string; hint: string }> = {
    reportable: { label: 'Reportable', color: 'green', hint: 'At least 10 SMEs and 10 comparison SMEs.' },
    early: { label: 'Early signal', color: 'gold', hint: 'Between 5 and 9 SMEs. Not shown to funders.' },
    insufficient: { label: 'Not enough data', color: 'default', hint: 'Fewer than 5 SMEs with revenue on both sides.' }
}

export const IMPACT_ROUTE = '/impact'

const monthLabel = (month: string) => dayjs(`${month}-01`).format('MMM YYYY')

export const impactPeriod = (result: InterventionImpact) =>
    !result.period
        ? null
        : result.period.from === result.period.to
            ? monthLabel(result.period.from)
            : `${monthLabel(result.period.from)}–${monthLabel(result.period.to)}`

type RangeFields = Pick<InterventionImpact, 'liftPercent' | 'rangeLowPercent' | 'rangeHighPercent' | 'status'>

/** True when the likely range includes zero: no difference can't be ruled out. */
export const rangeCrossesZero = (result: RangeFields) =>
    result.rangeLowPercent !== null && result.rangeHighPercent !== null &&
    result.rangeLowPercent < 0 && result.rangeHighPercent > 0

/**
 * Green above similar SMEs, red below. Neutral when there is nothing to judge or
 * when the likely range crosses zero, since then the direction itself is uncertain.
 */
export const useLiftColour = () => {
    const { token } = theme.useToken()
    return (result: RangeFields) =>
        result.liftPercent === null || result.status === 'insufficient' || rangeCrossesZero(result)
            ? undefined
            : result.liftPercent > 0 ? token.colorSuccess : result.liftPercent < 0 ? token.colorError : undefined
}

/**
 * The likely range drawn against zero: the line is the range, the dot the
 * measured difference. `scale` is the largest size in view, so rows compare.
 */
export const RangeBar: React.FC<{ result: RangeFields; scale: number; width?: number }> = ({ result, scale, width = 160 }) => {
    const { token } = theme.useToken()
    const liftColour = useLiftColour()
    if (result.liftPercent === null || result.rangeLowPercent === null || result.rangeHighPercent === null || scale <= 0) return null
    const at = (value: number) => `${50 + (Math.max(-scale, Math.min(scale, value)) / scale) * 50}%`
    const colour = liftColour(result) || token.colorTextTertiary
    const low = Math.min(result.rangeLowPercent, result.liftPercent)
    const high = Math.max(result.rangeHighPercent, result.liftPercent)
    return (
        <div
            aria-hidden
            style={{ position: 'relative', width, maxWidth: '100%', height: 12, marginTop: 6 }}
        >
            <div style={{ position: 'absolute', left: 0, right: 0, top: 5, height: 2, borderRadius: 1, background: token.colorFillSecondary }} />
            <div style={{ position: 'absolute', left: '50%', top: 0, bottom: 0, width: 1, background: token.colorTextQuaternary }} />
            <div
                style={{
                    position: 'absolute',
                    left: at(low),
                    width: `calc(${at(high)} - ${at(low)})`,
                    minWidth: 2,
                    top: 4,
                    height: 4,
                    borderRadius: 2,
                    background: colour,
                    opacity: 0.45
                }}
            />
            <div
                style={{
                    position: 'absolute',
                    left: at(result.liftPercent),
                    top: 2,
                    width: 8,
                    height: 8,
                    marginLeft: -4,
                    borderRadius: '50%',
                    background: colour
                }}
            />
        </div>
    )
}

export const ImpactStatusTags: React.FC<{ result: InterventionImpact }> = ({ result }) => {
    const status = IMPACT_STATUS[result.status]
    return (
        <Space size={6} wrap>
            <Tooltip title={status.hint}><Tag color={status.color} style={{ borderRadius: 999, marginInlineEnd: 0 }}>{status.label}</Tag></Tooltip>
            {result.demo ? (
                <Tooltip title='Includes seeded demo SMEs. Never use these figures in reports.'>
                    <Tag color='purple' style={{ borderRadius: 999, marginInlineEnd: 0 }}>Demo data</Tag>
                </Tooltip>
            ) : null}
        </Space>
    )
}

const Figure: React.FC<{ label: string; value: string; note: string; colour?: string }> = ({ label, value, note, colour }) => {
    const { token } = theme.useToken()
    return (
        <div
            style={{
                height: '100%',
                padding: '14px 16px',
                borderRadius: token.borderRadiusLG,
                border: `1px solid ${token.colorBorderSecondary}`,
                background: token.colorFillQuaternary
            }}
        >
            <Text type='secondary' style={{ fontSize: 12 }}>{label}</Text>
            <div style={{ fontSize: 26, fontWeight: 600, lineHeight: 1.3, color: colour, margin: '4px 0' }}>
                {value}
            </div>
            <Text type='secondary' style={{ fontSize: 12 }}>{note}</Text>
        </div>
    )
}

const outcomeCell = (result: InterventionImpact, group: { count: number; liftPercent: number | null }) =>
    group.count === 0
        ? 'None'
        : group.liftPercent === null
            ? `${group.count} SME${group.count === 1 ? '' : 's'}, too few to compare`
            : `${formatLift(result, group.liftPercent)} (${group.count} SME${group.count === 1 ? '' : 's'})`

/** The full result for one intervention in one programme, as staff see it. */
export const ImpactResultView: React.FC<{ result: InterventionImpact; compact?: boolean }> = ({ result, compact = false }) => {
    const liftColour = useLiftColour()

    if (result.status === 'insufficient') {
        return (
            <Space direction='vertical' size={12} style={{ width: '100%' }}>
                <ImpactStatusTags result={result} />
                <Text type='secondary'>
                    {result.treatedCount} SME{result.treatedCount === 1 ? '' : 's'} could be measured
                    {result.treatedWithoutData ? `; ${result.treatedWithoutData} more lack revenue before or after completing it` : ''}.
                    At least 5 are needed for an early signal and 10 for a reportable result.
                </Text>
            </Space>
        )
    }

    const showOutcome = result.byOutcome.achieved.count + result.byOutcome.notAchieved.count > 0
    const jobs = metricOf(result) === 'jobs'
    return (
        <Space direction='vertical' size={16} style={{ width: '100%' }}>
            <Space size={10} wrap>
                <ImpactStatusTags result={result} />
                {impactPeriod(result) ? <Text type='secondary'>Completed {impactPeriod(result)}</Text> : null}
            </Space>

            <Row gutter={[12, 12]}>
                <Col xs={24} sm={8}>
                    <Figure
                        label={jobs ? 'Jobs per SME vs similar SMEs' : 'Difference vs similar SMEs'}
                        value={formatLift(result, result.liftPercent)}
                        colour={liftColour(result)}
                        note={`Likely range ${formatRange(result.rangeLowPercent, result.rangeHighPercent)}`}
                    />
                </Col>
                <Col xs={12} sm={8}>
                    <Figure
                        label={jobs ? 'Their change in jobs' : 'Their revenue change'}
                        value={formatChange(result, result.treatedChangePercent)}
                        note={`${result.treatedCount} SMEs who completed it`}
                    />
                </Col>
                <Col xs={12} sm={8}>
                    <Figure
                        label='Similar SMEs'
                        value={formatChange(result, result.comparisonChangePercent)}
                        note={`${result.comparisonCount} SMEs not yet given it`}
                    />
                </Col>
            </Row>

            <Descriptions size='small' column={1} bordered layout={compact ? 'vertical' : 'horizontal'} labelStyle={compact ? undefined : { width: 220 }}>
                {showOutcome ? (
                    <>
                        <Descriptions.Item label='Check-back: outcome achieved'>{outcomeCell(result, result.byOutcome.achieved)}</Descriptions.Item>
                        <Descriptions.Item label='Check-back: not yet or partly'>{outcomeCell(result, result.byOutcome.notAchieved)}</Descriptions.Item>
                    </>
                ) : null}
                <Descriptions.Item label='Other interventions at the same time'>
                    {Math.round(result.overlapShare * 100)}% of these SMEs
                    {result.overlapShare >= 0.5 ? ', so they share the credit' : ''}
                </Descriptions.Item>
                <Descriptions.Item label='Compared with'>
                    {[
                        result.matching.sectorAndBand ? `${result.matching.sectorAndBand} matched on sector and ${jobs ? 'team' : 'revenue'} size` : '',
                        result.matching.sector ? `${result.matching.sector} on sector only` : '',
                        result.matching.programme ? `${result.matching.programme} on programme only` : ''
                    ].filter(Boolean).join(', ') || 'Same programme'}
                </Descriptions.Item>
                {result.treatedWithoutData ? (
                    <Descriptions.Item label='Not measurable yet'>
                        {result.treatedWithoutData} SME{result.treatedWithoutData === 1 ? '' : 's'} lack {jobs ? 'staff numbers' : 'revenue'} before or after completing it
                    </Descriptions.Item>
                ) : null}
            </Descriptions>

            {result.headline ? (
                <Alert
                    type={result.demo ? 'warning' : 'success'}
                    showIcon
                    message={result.demo ? 'Funder line (demo data, not for reports)' : 'Funder line'}
                    description={result.headline}
                />
            ) : null}
        </Space>
    )
}

/**
 * The Impact tab of an intervention: one line per programme, with the full
 * analysis on the Impact Analytics page.
 */
export const InterventionImpactSection: React.FC<{ interventionId: string }> = ({ interventionId }) => {
    const navigate = useNavigate()
    const { token } = theme.useToken()
    const liftColour = useLiftColour()
    const [results, setResults] = useState<InterventionImpact[] | null>(null)
    const [names, setNames] = useState<Record<string, string>>({})
    const [failed, setFailed] = useState(false)

    useEffect(() => {
        let cancelled = false
        setResults(null)
        setFailed(false)
        Promise.all([impactForIntervention(interventionId), programmeNames().catch(() => ({}))])
            .then(([rows, programmeLabels]) => {
                if (cancelled) return
                setNames(programmeLabels)
                setResults(rows.sort((a, b) =>
                    a.programId.localeCompare(b.programId) || metricOf(a).localeCompare(metricOf(b)) * -1 || b.treatedCount - a.treatedCount))
            })
            .catch(error => {
                console.error('Could not load impact results', error)
                if (!cancelled) setFailed(true)
            })
        return () => { cancelled = true }
    }, [interventionId])

    if (failed) return <Text type='secondary'>Impact results could not be loaded.</Text>
    if (!results) return <Skeleton active paragraph={{ rows: 3 }} />
    if (!results.length) {
        return (
            <Text type='secondary'>
                No SME has completed this intervention with revenue on record yet. Results are worked out on the 1st of each month.
            </Text>
        )
    }

    return (
        <Space direction='vertical' size={12} style={{ width: '100%' }}>
            {results.map(result => (
                <div
                    key={result.id}
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        flexWrap: 'wrap',
                        padding: '12px 14px',
                        borderRadius: token.borderRadiusLG,
                        border: `1px solid ${token.colorBorderSecondary}`
                    }}
                >
                    <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                        <Space size={6}>
                            <Text strong>{names[result.programId] || 'Programme'}</Text>
                            <Tag style={{ borderRadius: 999, marginInlineEnd: 0 }}>{IMPACT_METRIC_LABEL[metricOf(result)].name}</Tag>
                        </Space>
                        <Text type='secondary' style={{ fontSize: 12 }}>
                            {result.status === 'insufficient'
                                ? `${result.treatedCount} SME${result.treatedCount === 1 ? '' : 's'} measured so far`
                                : `${result.treatedCount} SMEs vs ${result.comparisonCount} similar${impactPeriod(result) ? ` · ${impactPeriod(result)}` : ''}`}
                        </Text>
                    </div>
                    {result.status !== 'insufficient' ? (
                        <Text strong style={{ fontSize: 18, color: liftColour(result) }}>
                            {formatLift(result, result.liftPercent)}
                        </Text>
                    ) : null}
                    <ImpactStatusTags result={result} />
                </div>
            ))}
            <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
                <Text type='secondary' style={{ fontSize: 12 }}>
                    <InfoCircleOutlined /> Revenue: growth in points above or below similar SMEs. Jobs: extra jobs per SME. A link, not proof of cause.
                </Text>
                <Button
                    type='link'
                    style={{ paddingInline: 0 }}
                    onClick={() => navigate(`${IMPACT_ROUTE}?intervention=${encodeURIComponent(interventionId)}`)}
                >
                    Open in Impact Analytics <ArrowRightOutlined />
                </Button>
            </Space>
        </Space>
    )
}
