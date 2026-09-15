import { useEffect, useMemo, useState } from 'react'
import {
    Button,
    Col,
    Row,
    Space,
    Switch,
    Tag,
    Typography,
    theme
} from 'antd'
import {
    ApartmentOutlined,
    ArrowRightOutlined,
    CalendarOutlined,
    CheckCircleOutlined,
    ExperimentOutlined,
    ReloadOutlined
} from '@ant-design/icons'
import {
    AnimatePresence,
    animate,
    motion,
    useMotionValue,
    useReducedMotion,
    useTransform
} from 'framer-motion'

import { computeRiskScore } from '../riskEngine'
import type { RiskScoreInputs, SMERow } from '../types'
import { getRiskTag } from './riskPresentation'

const { Text } = Typography

type Props = {
    row: SMERow
}

function AnimatedPercent({
    value,
    reduceMotion
}: {
    value: number
    reduceMotion: boolean | null
}) {
    const motionValue = useMotionValue(value)

    const label = useTransform(
        motionValue,
        latest => `${Math.round(latest)}%`
    )

    useEffect(() => {
        if (reduceMotion) {
            motionValue.set(value)
            return
        }

        const controls = animate(motionValue, value, {
            duration: 0.45,
            ease: 'easeOut'
        })

        return () => controls.stop()
    }, [value, reduceMotion, motionValue])

    return (
        <motion.span
            style={{
                fontWeight: 700,
                fontSize: 26,
                lineHeight: 1
            }}
        >
            {label}
        </motion.span>
    )
}

type ScenarioCardProps = {
    icon: React.ReactNode
    title: string
    description: string
    checked: boolean
    disabled?: boolean
    onChange: (checked: boolean) => void
}

function ScenarioCard({
    icon,
    title,
    description,
    checked,
    disabled,
    onChange
}: ScenarioCardProps) {
    const { token } = theme.useToken()

    return (
        <div
            style={{
                height: '100%',
                minHeight: 108,
                padding: 12,
                borderRadius: 12,
                border: checked
                    ? `1px solid ${token.colorPrimaryBorder}`
                    : `1px solid ${token.colorBorderSecondary}`,
                background: checked
                    ? token.colorPrimaryBg
                    : token.colorFillQuaternary,
                opacity: disabled ? 0.55 : 1,
                transition:
                    'background .18s ease, border-color .18s ease, box-shadow .18s ease',
                boxShadow: checked
                    ? token.boxShadowTertiary
                    : 'none'
            }}
        >
            <div
                style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: 10
                }}
            >
                <div
                    style={{
                        width: 32,
                        height: 32,
                        borderRadius: 9,
                        display: 'grid',
                        placeItems: 'center',
                        flex: '0 0 auto',
                        background: checked
                            ? token.colorPrimary
                            : token.colorFillSecondary,
                        color: checked
                            ? token.colorTextLightSolid
                            : token.colorTextSecondary,
                        fontSize: 15
                    }}
                >
                    {icon}
                </div>

                <Switch
                    size="small"
                    checked={checked}
                    disabled={disabled}
                    onChange={onChange}
                />
            </div>

            <Text
                strong
                style={{
                    display: 'block',
                    marginTop: 9,
                    fontSize: 13
                }}
            >
                {title}
            </Text>

            <Text
                type="secondary"
                style={{
                    display: 'block',
                    marginTop: 3,
                    fontSize: 11,
                    lineHeight: 1.35
                }}
            >
                {description}
            </Text>
        </div>
    )
}

export default function RiskSimulationPanel({ row }: Props) {
    const { token } = theme.useToken()
    const shouldReduceMotion = useReducedMotion()

    const [deptConfirmedOverride, setDeptConfirmedOverride] =
        useState(false)

    const [
        interventionCompletedOverride,
        setInterventionCompletedOverride
    ] = useState(false)

    const [
        serviceHappenedOverride,
        setServiceHappenedOverride
    ] = useState(false)

    const hasAnyOverride =
        deptConfirmedOverride ||
        interventionCompletedOverride ||
        serviceHappenedOverride

    const baseHasNeverReceivedService =
        row.fullyConfirmedDepartmentsCount > 0 &&
        row.totalTouches === 0

    const simulated = useMemo(() => {
        const input: RiskScoreInputs = {
            daysSinceLastService: serviceHappenedOverride
                ? 0
                : row.daysSinceLastService,

            hasNeverReceivedService: serviceHappenedOverride
                ? false
                : baseHasNeverReceivedService,

            docsMissing: row.docsMissing,
            docsQueried: row.docsQueried,
            docsRejected: row.docsRejected,

            missingDepartmentsCount: deptConfirmedOverride
                ? 0
                : row.missingDepartmentsCount,

            smePendingAcceptanceCount:
                interventionCompletedOverride
                    ? Math.max(
                        0,
                        row.smePendingAcceptanceCount - 1
                    )
                    : row.smePendingAcceptanceCount,

            smePendingConfirmationCount:
                interventionCompletedOverride &&
                    row.smePendingAcceptanceCount === 0
                    ? Math.max(
                        0,
                        row.smePendingConfirmationCount - 1
                    )
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

    const difference =
        simulated.score - row.riskScore

    const resetOverrides = () => {
        setDeptConfirmedOverride(false)
        setInterventionCompletedOverride(false)
        setServiceHappenedOverride(false)
    }

    return (
        <div
            style={{
                border: `1px solid ${token.colorBorderSecondary}`,
                borderRadius: 14,
                padding: 14,
                background: token.colorBgContainer
            }}
        >
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    marginBottom: 12
                }}
            >
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 9
                    }}
                >
                    <div
                        style={{
                            width: 34,
                            height: 34,
                            borderRadius: 10,
                            display: 'grid',
                            placeItems: 'center',
                            background: token.colorPrimaryBg,
                            color: token.colorPrimary,
                            fontSize: 16
                        }}
                    >
                        <ExperimentOutlined />
                    </div>

                    <div>
                        <Text strong>
                            Risk simulation
                        </Text>

                        <Text
                            type="secondary"
                            style={{
                                display: 'block',
                                fontSize: 11,
                                marginTop: 1
                            }}
                        >
                            Preview how operational changes may affect risk.
                        </Text>
                    </div>
                </div>

                <Button
                    size="small"
                    shape="round"
                    type="text"
                    icon={<ReloadOutlined />}
                    disabled={!hasAnyOverride}
                    onClick={resetOverrides}
                >
                    Reset
                </Button>
            </div>

            <Row gutter={[8, 8]}>
                <Col xs={24} md={8}>
                    <ScenarioCard
                        icon={<ApartmentOutlined />}
                        title="Departments confirmed"
                        description="Assume all pending department confirmations are completed."
                        checked={deptConfirmedOverride}
                        onChange={setDeptConfirmedOverride}
                        disabled={
                            row.missingDepartmentsCount === 0
                        }
                    />
                </Col>

                <Col xs={24} md={8}>
                    <ScenarioCard
                        icon={<CheckCircleOutlined />}
                        title="Next intervention completed"
                        description="Assume the next pending SME intervention is completed."
                        checked={interventionCompletedOverride}
                        onChange={
                            setInterventionCompletedOverride
                        }
                        disabled={
                            row.smePendingAcceptanceCount +
                            row.smePendingConfirmationCount ===
                            0
                        }
                    />
                </Col>

                <Col xs={24} md={8}>
                    <ScenarioCard
                        icon={<CalendarOutlined />}
                        title="Service delivered today"
                        description="Assume a new service interaction is recorded today."
                        checked={serviceHappenedOverride}
                        onChange={setServiceHappenedOverride}
                    />
                </Col>
            </Row>

            <div
                style={{
                    marginTop: 12,
                    padding: 12,
                    borderRadius: 12,
                    background: token.colorFillQuaternary,
                    border: `1px solid ${token.colorBorderSecondary}`
                }}
            >
                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns:
                            'minmax(0, 1fr) 40px minmax(0, 1fr)',
                        alignItems: 'center',
                        gap: 10
                    }}
                >
                    <div>
                        <Text
                            type="secondary"
                            style={{
                                display: 'block',
                                fontSize: 11
                            }}
                        >
                            Current risk
                        </Text>

                        <Space
                            size={7}
                            wrap
                            style={{ marginTop: 5 }}
                        >
                            <Text
                                strong
                                style={{
                                    fontSize: 26,
                                    lineHeight: 1
                                }}
                            >
                                {row.riskScore}%
                            </Text>

                            {getRiskTag(row.riskLevel)}
                        </Space>
                    </div>

                    <div
                        style={{
                            width: 34,
                            height: 34,
                            borderRadius: 999,
                            display: 'grid',
                            placeItems: 'center',
                            background: token.colorBgContainer,
                            border: `1px solid ${token.colorBorderSecondary}`,
                            color: token.colorTextSecondary
                        }}
                    >
                        <ArrowRightOutlined />
                    </div>

                    <div>
                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 8
                            }}
                        >
                            <Text
                                type="secondary"
                                style={{
                                    fontSize: 11
                                }}
                            >
                                Simulated risk
                            </Text>

                            {hasAnyOverride && (
                                <Tag
                                    color={
                                        difference < 0
                                            ? 'green'
                                            : difference > 0
                                                ? 'red'
                                                : 'default'
                                    }
                                    style={{
                                        marginInlineEnd: 0,
                                        borderRadius: 999
                                    }}
                                >
                                    {difference < 0
                                        ? `${Math.abs(difference)}% lower`
                                        : difference > 0
                                            ? `${difference}% higher`
                                            : 'No change'}
                                </Tag>
                            )}
                        </div>

                        <Space
                            size={7}
                            wrap
                            style={{ marginTop: 5 }}
                        >
                            <AnimatedPercent
                                value={simulated.score}
                                reduceMotion={
                                    shouldReduceMotion
                                }
                            />

                            <AnimatePresence mode="wait">
                                <motion.span
                                    key={simulated.level}
                                    initial={
                                        shouldReduceMotion
                                            ? undefined
                                            : {
                                                opacity: 0,
                                                y: -4
                                            }
                                    }
                                    animate={
                                        shouldReduceMotion
                                            ? undefined
                                            : {
                                                opacity: 1,
                                                y: 0
                                            }
                                    }
                                    exit={
                                        shouldReduceMotion
                                            ? undefined
                                            : {
                                                opacity: 0,
                                                y: 4
                                            }
                                    }
                                    transition={{
                                        duration: 0.2
                                    }}
                                    style={{
                                        display:
                                            'inline-block'
                                    }}
                                >
                                    {getRiskTag(
                                        simulated.level
                                    )}
                                </motion.span>
                            </AnimatePresence>
                        </Space>
                    </div>
                </div>
            </div>

            <Text
                type="secondary"
                style={{
                    display: 'block',
                    marginTop: 9,
                    fontSize: 11
                }}
            >
                Simulation only. These assumptions do not update the SME record or change the official {row.riskScore}% risk score.
            </Text>
        </div>
    )
}
