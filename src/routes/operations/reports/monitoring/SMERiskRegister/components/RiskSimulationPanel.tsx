import { useEffect, useMemo, useState } from 'react'
import { Button, Space, Switch, Typography } from 'antd'
import { ReloadOutlined } from '@ant-design/icons'
import { AnimatePresence, animate, motion, useMotionValue, useReducedMotion, useTransform } from 'framer-motion'

import { computeRiskScore } from '../riskEngine'
import type { RiskScoreInputs, SMERow } from '../types'
import { getRiskTag } from './riskPresentation'

const { Text } = Typography

type Props = {
    row: SMERow
}

function AnimatedPercent({ value, reduceMotion }: { value: number; reduceMotion: boolean | null }) {
    const motionValue = useMotionValue(value)
    const label = useTransform(motionValue, latest => `${Math.round(latest)}%`)

    useEffect(() => {
        if (reduceMotion) {
            motionValue.set(value)
            return
        }
        const controls = animate(motionValue, value, { duration: 0.5, ease: 'easeOut' })
        return () => controls.stop()
    }, [value, reduceMotion, motionValue])

    return <motion.span style={{ fontWeight: 700, fontSize: 18 }}>{label}</motion.span>
}

export default function RiskSimulationPanel({ row }: Props) {
    const shouldReduceMotion = useReducedMotion()

    const [deptConfirmedOverride, setDeptConfirmedOverride] = useState(false)
    const [interventionCompletedOverride, setInterventionCompletedOverride] = useState(false)
    const [serviceHappenedOverride, setServiceHappenedOverride] = useState(false)

    const hasAnyOverride = deptConfirmedOverride || interventionCompletedOverride || serviceHappenedOverride

    const baseHasNeverReceivedService = row.fullyConfirmedDepartmentsCount > 0 && row.totalTouches === 0

    const simulated = useMemo(() => {
        const input: RiskScoreInputs = {
            daysSinceLastService: serviceHappenedOverride ? 0 : row.daysSinceLastService,
            hasNeverReceivedService: serviceHappenedOverride ? false : baseHasNeverReceivedService,
            docsMissing: row.docsMissing,
            docsQueried: row.docsQueried,
            docsRejected: row.docsRejected,
            missingDepartmentsCount: deptConfirmedOverride ? 0 : row.missingDepartmentsCount,
            smePendingAcceptanceCount: interventionCompletedOverride
                ? Math.max(0, row.smePendingAcceptanceCount - 1)
                : row.smePendingAcceptanceCount,
            smePendingConfirmationCount: interventionCompletedOverride && row.smePendingAcceptanceCount === 0
                ? Math.max(0, row.smePendingConfirmationCount - 1)
                : row.smePendingConfirmationCount,
            declinedTouches: row.declinedTouches
        }
        return computeRiskScore(input)
    }, [
        row.daysSinceLastService,
        row.docsMissing,
        row.docsQueried,
        row.docsRejected,
        row.missingDepartmentsCount,
        row.smePendingAcceptanceCount,
        row.smePendingConfirmationCount,
        row.declinedTouches,
        baseHasNeverReceivedService,
        deptConfirmedOverride,
        interventionCompletedOverride,
        serviceHappenedOverride
    ])

    const resetOverrides = () => {
        setDeptConfirmedOverride(false)
        setInterventionCompletedOverride(false)
        setServiceHappenedOverride(false)
    }

    return (
        <div style={{ border: '1px solid #d9d9d9', borderRadius: 8, padding: 12, height: '100%' }}>
            <Space align="center" style={{ justifyContent: 'space-between', width: '100%' }}>
                <Text strong>What if…</Text>
                <Button
                    size="small"
                    type="text"
                    icon={<ReloadOutlined />}
                    disabled={!hasAnyOverride}
                    onClick={resetOverrides}
                >
                    Reset
                </Button>
            </Space>

            <Space direction="vertical" size={6} style={{ width: '100%', marginTop: 8 }}>
                <Space align="center">
                    <Switch size="small" checked={deptConfirmedOverride} onChange={setDeptConfirmedOverride} disabled={row.missingDepartmentsCount === 0} />
                    <Text type="secondary">All pending departments get confirmed</Text>
                </Space>
                <Space align="center">
                    <Switch
                        size="small"
                        checked={interventionCompletedOverride}
                        onChange={setInterventionCompletedOverride}
                        disabled={row.smePendingAcceptanceCount + row.smePendingConfirmationCount === 0}
                    />
                    <Text type="secondary">The next pending intervention gets completed</Text>
                </Space>
                <Space align="center">
                    <Switch size="small" checked={serviceHappenedOverride} onChange={setServiceHappenedOverride} />
                    <Text type="secondary">A service visit happens today</Text>
                </Space>
            </Space>

            <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 16 }}>
                <div>
                    <Text type="secondary" style={{ fontSize: 12 }}>Current</Text>
                    <div>
                        <Text style={{ fontWeight: 700, fontSize: 18 }}>{row.riskScore}%</Text>
                        <span style={{ marginLeft: 6 }}>{getRiskTag(row.riskLevel)}</span>
                    </div>
                </div>
                <div>→</div>
                <div>
                    <Text type="secondary" style={{ fontSize: 12 }}>Simulated</Text>
                    <div>
                        <AnimatedPercent value={simulated.score} reduceMotion={shouldReduceMotion} />
                        <span style={{ marginLeft: 6 }}>
                            <AnimatePresence mode="wait">
                                <motion.span
                                    key={simulated.level}
                                    initial={shouldReduceMotion ? undefined : { opacity: 0, y: -4 }}
                                    animate={shouldReduceMotion ? undefined : { opacity: 1, y: 0 }}
                                    exit={shouldReduceMotion ? undefined : { opacity: 0, y: 4 }}
                                    transition={{ duration: 0.2 }}
                                    style={{ display: 'inline-block' }}
                                >
                                    {getRiskTag(simulated.level)}
                                </motion.span>
                            </AnimatePresence>
                        </span>
                    </div>
                </div>
            </div>

            <Text type="secondary" style={{ display: 'block', marginTop: 8, fontSize: 12 }}>
                Preview only — does not change stored data or the {row.riskScore}% official risk score.
            </Text>
        </div>
    )
}
