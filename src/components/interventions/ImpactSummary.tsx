import React, { useEffect, useState } from 'react'
import { Alert, Col, Row, Skeleton, Space, Statistic, Tag, Tooltip, Typography } from 'antd'
import { InfoCircleOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import {
    formatPoints,
    impactForIntervention,
    type InterventionImpact
} from '@/services/interventionImpactService'

const { Text } = Typography

const STATUS_LABEL: Record<InterventionImpact['status'], { label: string; color: string; hint: string }> = {
    reportable: { label: 'Reportable', color: 'green', hint: 'At least 10 SMEs and 10 comparison SMEs.' },
    early: { label: 'Early signal', color: 'gold', hint: 'Between 5 and 9 SMEs. Not shown to funders.' },
    insufficient: { label: 'Not enough data', color: 'default', hint: 'Fewer than 5 SMEs with revenue on both sides.' }
}

const monthLabel = (month: string) => dayjs(`${month}-01`).format('MMM YYYY')

/** One programme's result for an intervention, as staff see it. */
export const ImpactResultView: React.FC<{ result: InterventionImpact; programLabel?: string }> = ({ result, programLabel }) => {
    const status = STATUS_LABEL[result.status]
    const pointsColour = result.liftPercent === null || result.status === 'insufficient'
        ? undefined
        : result.liftPercent > 0 ? '#389e0d' : result.liftPercent < 0 ? '#cf1322' : undefined

    return (
        <Space direction='vertical' size={12} style={{ width: '100%' }}>
            <Space size={6} wrap>
                {programLabel ? <Text strong>{programLabel}</Text> : null}
                <Tooltip title={status.hint}><Tag color={status.color} style={{ borderRadius: 999 }}>{status.label}</Tag></Tooltip>
                {result.demo ? (
                    <Tooltip title='Includes seeded demo SMEs. Never use these figures in reports.'>
                        <Tag color='purple' style={{ borderRadius: 999 }}>Demo data</Tag>
                    </Tooltip>
                ) : null}
                {result.period ? (
                    <Text type='secondary' style={{ fontSize: 12 }}>
                        Completed {monthLabel(result.period.from)}–{monthLabel(result.period.to)}
                    </Text>
                ) : null}
            </Space>

            {result.status === 'insufficient' ? (
                <Text type='secondary'>
                    {result.treatedCount} SME{result.treatedCount === 1 ? '' : 's'} could be measured
                    {result.treatedWithoutData ? `; ${result.treatedWithoutData} more lack revenue before or after completing it` : ''}.
                </Text>
            ) : (
                <>
                    <Row gutter={[12, 12]}>
                        <Col xs={12} md={8}>
                            <Statistic
                                title='Difference vs similar SMEs'
                                value={formatPoints(result.liftPercent)}
                                suffix='pts'
                                valueStyle={{ color: pointsColour }}
                            />
                            <Text type='secondary' style={{ fontSize: 11 }}>
                                Likely range {formatPoints(result.rangeLowPercent)} to {formatPoints(result.rangeHighPercent)}
                            </Text>
                        </Col>
                        <Col xs={12} md={8}>
                            <Statistic title='Their revenue change' value={formatPoints(result.treatedChangePercent)} suffix='%' />
                            <Text type='secondary' style={{ fontSize: 11 }}>{result.treatedCount} SMEs who completed it</Text>
                        </Col>
                        <Col xs={12} md={8}>
                            <Statistic title='Similar SMEs' value={formatPoints(result.comparisonChangePercent)} suffix='%' />
                            <Text type='secondary' style={{ fontSize: 11 }}>{result.comparisonCount} SMEs not yet given it</Text>
                        </Col>
                    </Row>

                    {(result.byOutcome.achieved.liftPercent !== null || result.byOutcome.notAchieved.liftPercent !== null) && (
                        <Text style={{ fontSize: 13 }}>
                            By check-back: outcome achieved {formatPoints(result.byOutcome.achieved.liftPercent)} pts
                            ({result.byOutcome.achieved.count} SMEs) · not yet or partly {formatPoints(result.byOutcome.notAchieved.liftPercent)} pts
                            ({result.byOutcome.notAchieved.count} SMEs)
                        </Text>
                    )}

                    {result.overlapShare >= 0.5 && (
                        <Text type='secondary' style={{ fontSize: 12 }}>
                            {Math.round(result.overlapShare * 100)}% of these SMEs completed other interventions in the same months, so they share the credit.
                        </Text>
                    )}
                    {result.headline ? (
                        <Alert
                            type={result.demo ? 'info' : 'success'}
                            showIcon
                            message={result.demo ? 'Funder line (demo data, not for reports)' : 'Funder line'}
                            description={result.headline}
                        />
                    ) : null}
                </>
            )}
        </Space>
    )
}

/** The Impact section of an intervention: every programme it was measured in. */
export const InterventionImpactSection: React.FC<{ interventionId: string; programLabels?: Record<string, string> }> = ({
    interventionId,
    programLabels
}) => {
    const [results, setResults] = useState<InterventionImpact[] | null>(null)
    const [failed, setFailed] = useState(false)

    useEffect(() => {
        let cancelled = false
        setResults(null)
        setFailed(false)
        impactForIntervention(interventionId)
            .then(rows => {
                if (!cancelled) setResults(rows.sort((a, b) => b.treatedCount - a.treatedCount))
            })
            .catch(error => {
                console.error('Could not load impact results', error)
                if (!cancelled) setFailed(true)
            })
        return () => { cancelled = true }
    }, [interventionId])

    if (failed) return <Text type='secondary'>Impact results could not be loaded.</Text>
    if (!results) return <Skeleton active paragraph={{ rows: 4 }} />
    if (!results.length) {
        return (
            <Text type='secondary'>
                No SME has completed this intervention with revenue on record yet. Results are worked out on the 1st of each month.
            </Text>
        )
    }

    const computedAt = results.find(row => row.computedAt)?.computedAt
    return (
        <Space direction='vertical' size={20} style={{ width: '100%' }}>
            {results.map(result => (
                <ImpactResultView
                    key={result.id}
                    result={result}
                    programLabel={results.length > 1 ? programLabels?.[result.programId] || 'Programme' : undefined}
                />
            ))}
            <Text type='secondary' style={{ fontSize: 12 }}>
                <InfoCircleOutlined /> Revenue change from 3 months before completion to months 3–6 after, against SMEs in the same programme
                (same sector where possible) who hadn't had it yet. It shows a link, not proof of cause.
                {computedAt ? ` Worked out ${dayjs(computedAt).format('D MMM YYYY')}.` : ''}
            </Text>
        </Space>
    )
}
