import {
    ApartmentOutlined,
    CheckCircleOutlined,
    DashboardOutlined,
    ExclamationCircleOutlined,
    EyeInvisibleOutlined,
    PauseCircleOutlined,
    SafetyCertificateOutlined
} from '@ant-design/icons'
import {
    Card,
    Col,
    Empty,
    Modal,
    Pagination,
    Progress,
    Row,
    Space,
    Tag,
    Typography,
    theme
} from 'antd'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import {
    useEffect,
    useMemo,
    useState,
    type ReactNode
} from 'react'
import { motion, useReducedMotion } from 'framer-motion'

import type { RiskLevel, SMERow } from '../types'
import {
    buildPortfolioRiskChartOptions,
    type ChartTheme
} from './charts'

const { Text, Title } = Typography

type Props = {
    open: boolean
    onClose: () => void
    isDepartmentScopedView: boolean
    departmentScopeLabel: string
    rows: SMERow[]
}

type ReadinessStage = {
    key: string
    title: string
    count: number
    smeCount: number
    color: string
    background: string
    icon: ReactNode
}

type DepartmentPressure = {
    departmentName: string
    departmentReview: number
    awaitingSme: number
    readyNoService: number
    total: number
}

type RiskDriver = {
    key: string
    label: string
    count: number
}

const PRESSURE_PAGE_SIZE = 4

function PortfolioRiskPanel({
    rows,
    chartTheme,
    shouldReduceMotion
}: {
    rows: SMERow[]
    chartTheme: ChartTheme
    shouldReduceMotion: boolean | null
}) {
    const { token } = theme.useToken()
    const [hiddenLevels, setHiddenLevels] = useState<RiskLevel[]>([])

    useEffect(() => {
        setHiddenLevels([])
    }, [rows])

    const riskCounts = useMemo(
        () => ({
            Critical: rows.filter(
                row => row.riskLevel === 'Critical'
            ).length,
            High: rows.filter(
                row => row.riskLevel === 'High'
            ).length,
            Medium: rows.filter(
                row => row.riskLevel === 'Medium'
            ).length,
            Low: rows.filter(
                row => row.riskLevel === 'Low'
            ).length
        }),
        [rows]
    )

    const levels: Array<{
        level: RiskLevel
        color: string
        background: string
    }> = [
            {
                level: 'Critical',
                color: token.colorError,
                background: token.colorErrorBg
            },
            {
                level: 'High',
                color: token.colorWarningActive,
                background: token.colorWarningBg
            },
            {
                level: 'Medium',
                color: token.colorWarning,
                background: token.colorWarningBg
            },
            {
                level: 'Low',
                color: token.colorSuccess,
                background: token.colorSuccessBg
            }
        ]

    const visibleCount = levels.reduce(
        (sum, item) =>
            hiddenLevels.includes(item.level)
                ? sum
                : sum + riskCounts[item.level],
        0
    )

    const options = useMemo(
        () =>
            buildPortfolioRiskChartOptions(
                rows,
                chartTheme,
                hiddenLevels
            ),
        [rows, chartTheme, hiddenLevels]
    )

    const toggleLevel = (level: RiskLevel) => {
        setHiddenLevels(current =>
            current.includes(level)
                ? current.filter(item => item !== level)
                : [...current, level]
        )
    }

    return (
        <motion.div
            initial={
                shouldReduceMotion
                    ? undefined
                    : { opacity: 0, y: 10 }
            }
            animate={
                shouldReduceMotion
                    ? undefined
                    : { opacity: 1, y: 0 }
            }
            transition={{ duration: 0.28 }}
            style={{ height: '100%' }}
        >
            <Card
                size="small"
                styles={{ body: { padding: 14 } }}
                style={{
                    height: '100%',
                    borderRadius: 14,
                    border: `1px solid ${token.colorBorderSecondary}`,
                    boxShadow: 'none'
                }}
            >
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        justifyContent: 'space-between',
                        gap: 10,
                        marginBottom: 2
                    }}
                >
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: 10
                        }}
                    >
                        <div
                            style={{
                                width: 34,
                                height: 34,
                                borderRadius: 10,
                                display: 'grid',
                                placeItems: 'center',
                                flex: '0 0 auto',
                                background: token.colorPrimaryBg,
                                color: token.colorPrimary,
                                fontSize: 16
                            }}
                        >
                            <DashboardOutlined />
                        </div>

                        <div>
                            <Text
                                strong
                                style={{
                                    display: 'block',
                                    fontSize: 14
                                }}
                            >
                                Portfolio risk
                            </Text>

                            <Text
                                type="secondary"
                                style={{
                                    display: 'block',
                                    marginTop: 2,
                                    fontSize: 11
                                }}
                            >
                                Click a status below to include or exclude it.
                            </Text>
                        </div>
                    </div>

                    <Tag
                        style={{
                            marginInlineEnd: 0,
                            borderRadius: 999
                        }}
                    >
                        {visibleCount}/{rows.length} visible
                    </Tag>
                </div>

                <div
                    style={{
                        height: 138,
                        marginTop: -2
                    }}
                >
                    <HighchartsReact
                        highcharts={Highcharts}
                        options={options}
                    />
                </div>

                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns:
                            'repeat(4, minmax(0, 1fr))',
                        gap: 6
                    }}
                >
                    {levels.map(item => {
                        const hidden =
                            hiddenLevels.includes(item.level)
                        const count =
                            riskCounts[item.level]
                        const percentage =
                            rows.length > 0
                                ? Math.round(
                                    (count / rows.length) * 100
                                )
                                : 0

                        return (
                            <button
                                key={item.level}
                                type="button"
                                aria-pressed={!hidden}
                                onClick={() =>
                                    toggleLevel(item.level)
                                }
                                style={{
                                    appearance: 'none',
                                    border: `1px solid ${hidden
                                            ? token.colorBorderSecondary
                                            : item.color
                                        }`,
                                    borderRadius: 10,
                                    padding: '7px 8px',
                                    background: hidden
                                        ? token.colorFillQuaternary
                                        : item.background,
                                    cursor: 'pointer',
                                    textAlign: 'left',
                                    opacity: hidden ? 0.52 : 1,
                                    transition:
                                        'opacity .18s ease, border-color .18s ease, background .18s ease'
                                }}
                            >
                                <div
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent:
                                            'space-between',
                                        gap: 6
                                    }}
                                >
                                    <div
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 6,
                                            minWidth: 0
                                        }}
                                    >
                                        <span
                                            style={{
                                                width: 7,
                                                height: 7,
                                                borderRadius: 999,
                                                flex: '0 0 auto',
                                                background:
                                                    item.color
                                            }}
                                        />

                                        <Text
                                            type="secondary"
                                            style={{
                                                fontSize: 9
                                            }}
                                        >
                                            {item.level}
                                        </Text>
                                    </div>

                                    {hidden && (
                                        <EyeInvisibleOutlined
                                            style={{
                                                color:
                                                    token.colorTextQuaternary,
                                                fontSize: 10
                                            }}
                                        />
                                    )}
                                </div>

                                <div
                                    style={{
                                        display: 'flex',
                                        alignItems: 'baseline',
                                        gap: 4,
                                        marginTop: 3
                                    }}
                                >
                                    <Text
                                        strong
                                        style={{
                                            fontSize: 17,
                                            lineHeight: 1
                                        }}
                                    >
                                        {count}
                                    </Text>

                                    <Text
                                        type="secondary"
                                        style={{
                                            fontSize: 9
                                        }}
                                    >
                                        {percentage}%
                                    </Text>
                                </div>
                            </button>
                        )
                    })}
                </div>
            </Card>
        </motion.div>
    )
}

function ServiceReadinessFlow({
    rows,
    shouldReduceMotion
}: {
    rows: SMERow[]
    shouldReduceMotion: boolean | null
}) {
    const { token } = theme.useToken()

    const departmentReviewSmes = new Set<string>()
    const awaitingSmeSmes = new Set<string>()
    const readyNoServiceSmes = new Set<string>()
    const servicedSmes = new Set<string>()

    rows.forEach(row => {
        const smeKey = String(
            row.participantId ||
            row.applicationId ||
            row.key
        )

        row.expectedDepartments.forEach(department => {
            if (!department.deptConfirmed) {
                departmentReviewSmes.add(smeKey)
                return
            }

            if (!department.smmeConfirmed) {
                awaitingSmeSmes.add(smeKey)
                return
            }

            if (department.servicedCount === 0) {
                readyNoServiceSmes.add(smeKey)
                return
            }

            servicedSmes.add(smeKey)
        })
    })

    const blockedSmes = new Set<string>([
        ...departmentReviewSmes,
        ...awaitingSmeSmes,
        ...readyNoServiceSmes
    ])

    const stages = [
        {
            key: 'department-review',
            title: 'Awaiting department review',
            smeCount: departmentReviewSmes.size,
            color: token.colorError,
            background: token.colorErrorBg,
            icon: <PauseCircleOutlined />
        },
        {
            key: 'awaiting-sme',
            title: 'Awaiting SME confirmation',
            smeCount: awaitingSmeSmes.size,
            color: token.colorErrorActive,
            background: token.colorErrorBg,
            icon: <SafetyCertificateOutlined />
        },
        {
            key: 'ready-no-service',
            title: 'Ready, no service',
            smeCount: readyNoServiceSmes.size,
            color: token.colorWarning,
            background: token.colorWarningBg,
            icon: <ExclamationCircleOutlined />
        },
        {
            key: 'serviced',
            title: 'Serviced',
            smeCount: servicedSmes.size,
            color: token.colorSuccess,
            background: token.colorSuccessBg,
            icon: <CheckCircleOutlined />
        }
    ]

    return (
        <motion.div
            initial={
                shouldReduceMotion
                    ? undefined
                    : { opacity: 0, y: 10 }
            }
            animate={
                shouldReduceMotion
                    ? undefined
                    : { opacity: 1, y: 0 }
            }
            transition={{
                duration: 0.28,
                delay: 0.04
            }}
        >
            <Card
                size="small"
                styles={{ body: { padding: 12 } }}
                style={{
                    borderRadius: 14,
                    border: `1px solid ${token.colorBorderSecondary}`,
                    boxShadow: 'none'
                }}
            >
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 10,
                        marginBottom: 8
                    }}
                >
                    <div>
                        <Text
                            strong
                            style={{
                                display: 'block',
                                fontSize: 14
                            }}
                        >
                            Service readiness
                        </Text>

                        <Text
                            type="secondary"
                            style={{
                                display: 'block',
                                marginTop: 1,
                                fontSize: 10
                            }}
                        >
                            Number of SMEs affected at each readiness stage.
                        </Text>
                    </div>

                    <Tag
                        color={
                            blockedSmes.size > 0
                                ? 'red'
                                : 'green'
                        }
                        style={{
                            marginInlineEnd: 0,
                            borderRadius: 999
                        }}
                    >
                        {blockedSmes.size} SME
                        {blockedSmes.size === 1 ? '' : 's'} with blockers
                    </Tag>
                </div>

                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns:
                            'repeat(4, minmax(0, 1fr))',
                        gap: 7
                    }}
                >
                    {stages.map(stage => {
                        const percent =
                            rows.length > 0
                                ? Math.round(
                                    (stage.smeCount /
                                        rows.length) *
                                    100
                                )
                                : 0

                        return (
                            <div
                                key={stage.key}
                                style={{
                                    minHeight: 96,
                                    padding: '8px 9px',
                                    borderRadius: 10,
                                    border: `1px solid ${token.colorBorderSecondary}`,
                                    background:
                                        stage.background
                                }}
                            >
                                <div
                                    style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent:
                                            'space-between',
                                        gap: 6
                                    }}
                                >
                                    <span
                                        style={{
                                            width: 24,
                                            height: 24,
                                            borderRadius: 8,
                                            display: 'grid',
                                            placeItems: 'center',
                                            color:
                                                token.colorTextLightSolid,
                                            background:
                                                stage.color,
                                            fontSize: 12,
                                            flex: '0 0 auto'
                                        }}
                                    >
                                        {stage.icon}
                                    </span>

                                    <Text
                                        type="secondary"
                                        style={{
                                            fontSize: 9,
                                            flex: '0 0 auto'
                                        }}
                                    >
                                        {percent}% of SMEs
                                    </Text>
                                </div>

                                <Text
                                    strong
                                    style={{
                                        display: 'block',
                                        marginTop: 6,
                                        fontSize: 10,
                                        lineHeight: 1.25,
                                        whiteSpace: 'normal'
                                    }}
                                >
                                    {stage.title}
                                </Text>

                                <div
                                    style={{
                                        display: 'flex',
                                        alignItems: 'baseline',
                                        gap: 4,
                                        marginTop: 5
                                    }}
                                >
                                    <Text
                                        strong
                                        style={{
                                            fontSize: 18,
                                            lineHeight: 1
                                        }}
                                    >
                                        {stage.smeCount}
                                    </Text>

                                    <Text
                                        type="secondary"
                                        style={{ fontSize: 9 }}
                                    >
                                        SME
                                        {stage.smeCount === 1
                                            ? ''
                                            : 's'}
                                    </Text>
                                </div>

                                <Progress
                                    percent={percent}
                                    showInfo={false}
                                    size="small"
                                    strokeColor={stage.color}
                                    style={{
                                        marginTop: 5,
                                        marginBottom: 0
                                    }}
                                />
                            </div>
                        )
                    })}
                </div>
            </Card>
        </motion.div>
    )
}

function RiskDriversPanel({
    rows,
    shouldReduceMotion
}: {
    rows: SMERow[]
    shouldReduceMotion: boolean | null
}) {
    const { token } = theme.useToken()

    const drivers = useMemo<RiskDriver[]>(() => {
        const affected = (
            predicate: (row: SMERow) => boolean
        ) => rows.filter(predicate).length

        return [
            {
                key: 'dp-department-review',
                label: 'DP department review',
                count: affected(row =>
                    row.expectedDepartments.some(
                        department =>
                            !department.deptConfirmed
                    )
                )
            },
            {
                key: 'dp-sme-confirmation',
                label: 'DP SME confirmation',
                count: affected(row =>
                    row.expectedDepartments.some(
                        department =>
                            department.deptConfirmed &&
                            !department.smmeConfirmed
                    )
                )
            },
            {
                key: 'ready-unserviced',
                label: 'Ready but unserviced',
                count: affected(row =>
                    row.expectedDepartments.some(
                        department =>
                            department.deptConfirmed &&
                            department.smmeConfirmed &&
                            department.servicedCount === 0
                    )
                )
            },
            {
                key: 'missing-documents',
                label: 'Missing documents',
                count: affected(
                    row => row.docsMissing > 0
                )
            },
            {
                key: 'queried-rejected-documents',
                label: 'Queried / rejected documents',
                count: affected(
                    row =>
                        row.docsQueried > 0 ||
                        row.docsRejected > 0
                )
            },
            {
                key: 'sme-intervention-response',
                label: 'SME intervention response',
                count: affected(
                    row =>
                        row.smePendingAcceptanceCount > 0 ||
                        row.smePendingConfirmationCount >
                        0
                )
            },
            {
                key: 'inactive',
                label: '30+ days inactive',
                count: affected(
                    row =>
                        row.daysSinceLastService !== null &&
                        row.daysSinceLastService >= 30
                )
            },
            {
                key: 'declined',
                label: 'Declined interventions',
                count: affected(
                    row => row.declinedTouches > 0
                )
            }
        ]
            .filter(item => item.count > 0)
            .sort((a, b) => b.count - a.count)
    }, [rows])

    return (
        <motion.div
            initial={
                shouldReduceMotion
                    ? undefined
                    : { opacity: 0, y: 10 }
            }
            animate={
                shouldReduceMotion
                    ? undefined
                    : { opacity: 1, y: 0 }
            }
            transition={{
                duration: 0.28,
                delay: 0.08
            }}
            style={{ height: '100%' }}
        >
            <Card
                size="small"
                styles={{ body: { padding: 14 } }}
                style={{
                    height: '100%',
                    borderRadius: 14,
                    border: `1px solid ${token.colorBorderSecondary}`,
                    boxShadow: 'none'
                }}
            >
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        justifyContent: 'space-between',
                        gap: 10,
                        marginBottom: 12
                    }}
                >
                    <div>
                        <Text
                            strong
                            style={{
                                display: 'block',
                                fontSize: 14
                            }}
                        >
                            What is driving risk?
                        </Text>

                        <Text
                            type="secondary"
                            style={{
                                display: 'block',
                                marginTop: 2,
                                fontSize: 10
                            }}
                        >
                            SMEs affected by each active risk signal.
                        </Text>
                    </div>

                    <Space size={5}>
                        <span
                            style={{
                                width: 7,
                                height: 7,
                                borderRadius: 999,
                                background:
                                    token.colorErrorActive
                            }}
                        />
                        <Text
                            type="secondary"
                            style={{ fontSize: 9 }}
                        >
                            % of SMEs affected
                        </Text>
                    </Space>
                </div>

                {drivers.length === 0 ? (
                    <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description="No active risk drivers"
                    />
                ) : (
                    <div
                        style={{
                            display: 'grid',
                            gap: 9
                        }}
                    >
                        {drivers.map(driver => {
                            const percent =
                                rows.length > 0
                                    ? Math.round(
                                        (driver.count /
                                            rows.length) *
                                        100
                                    )
                                    : 0

                            return (
                                <div key={driver.key}>
                                    <div
                                        style={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent:
                                                'space-between',
                                            gap: 10,
                                            marginBottom: 3
                                        }}
                                    >
                                        <Text
                                            type="secondary"
                                            ellipsis={{
                                                tooltip:
                                                    driver.label
                                            }}
                                            style={{
                                                minWidth: 0,
                                                fontSize: 10
                                            }}
                                        >
                                            {driver.label}
                                        </Text>

                                        <Space size={5}>
                                            <Text
                                                strong
                                                style={{
                                                    flex: '0 0 auto',
                                                    fontSize: 12
                                                }}
                                            >
                                                {driver.count}
                                            </Text>
                                            <Text
                                                type="secondary"
                                                style={{ fontSize: 9 }}
                                            >
                                                {percent}%
                                            </Text>
                                        </Space>
                                    </div>

                                    <Progress
                                        percent={percent}
                                        showInfo={false}
                                        size="small"
                                        strokeColor={
                                            token.colorErrorActive
                                        }
                                        trailColor={
                                            token.colorFillSecondary
                                        }
                                        style={{
                                            marginBottom: 0
                                        }}
                                    />
                                </div>
                            )
                        })}
                    </div>
                )}
            </Card>
        </motion.div>
    )
}

function DepartmentRiskPressurePanel({
    rows,
    isDepartmentScopedView,
    shouldReduceMotion
}: {
    rows: SMERow[]
    isDepartmentScopedView: boolean
    shouldReduceMotion: boolean | null
}) {
    const { token } = theme.useToken()
    const [page, setPage] = useState(1)

    const pressureRows = useMemo<DepartmentPressure[]>(() => {
        const map = new Map<
            string,
            DepartmentPressure
        >()

        rows.forEach(row => {
            row.expectedDepartments.forEach(
                department => {
                    const name =
                        department.departmentName ||
                        'Unknown Department'

                    const current =
                        map.get(name) || {
                            departmentName: name,
                            departmentReview: 0,
                            awaitingSme: 0,
                            readyNoService: 0,
                            total: 0
                        }

                    if (!department.deptConfirmed) {
                        current.departmentReview += 1
                    } else if (
                        !department.smmeConfirmed
                    ) {
                        current.awaitingSme += 1
                    } else if (
                        department.servicedCount === 0
                    ) {
                        current.readyNoService += 1
                    }

                    current.total =
                        current.departmentReview +
                        current.awaitingSme +
                        current.readyNoService

                    map.set(name, current)
                }
            )
        })

        return [...map.values()]
            .filter(item => item.total > 0)
            .sort((a, b) => b.total - a.total)
    }, [rows])

    useEffect(() => {
        const maxPage = Math.max(
            1,
            Math.ceil(
                pressureRows.length /
                PRESSURE_PAGE_SIZE
            )
        )

        setPage(current =>
            Math.min(current, maxPage)
        )
    }, [pressureRows.length])

    const visibleRows = pressureRows.slice(
        (page - 1) * PRESSURE_PAGE_SIZE,
        page * PRESSURE_PAGE_SIZE
    )

    return (
        <motion.div
            initial={
                shouldReduceMotion
                    ? undefined
                    : { opacity: 0, y: 10 }
            }
            animate={
                shouldReduceMotion
                    ? undefined
                    : { opacity: 1, y: 0 }
            }
            transition={{
                duration: 0.28,
                delay: 0.12
            }}
        >
            <Card
                size="small"
                styles={{ body: { padding: 12 } }}
                style={{
                    borderRadius: 14,
                    border: `1px solid ${token.colorBorderSecondary}`,
                    boxShadow: 'none'
                }}
            >
                <div
                    style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        justifyContent: 'space-between',
                        gap: 12,
                        marginBottom: 8
                    }}
                >
                    <div>
                        <Text
                            strong
                            style={{
                                display: 'block',
                                fontSize: 14
                            }}
                        >
                            {isDepartmentScopedView
                                ? 'Service risk pressure'
                                : 'Department risk pressure'}
                        </Text>

                        <Text
                            type="secondary"
                            style={{
                                display: 'block',
                                marginTop: 2,
                                fontSize: 10
                            }}
                        >
                            Departments ranked by unresolved risk pressure.
                        </Text>
                    </div>

                    <Tag
                        style={{
                            marginInlineEnd: 0,
                            borderRadius: 999
                        }}
                    >
                        {pressureRows.length} departments
                    </Tag>
                </div>

                {pressureRows.length === 0 ? (
                    <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description="No department risk pressure"
                    />
                ) : (
                    <>
                        <Row gutter={[8, 8]}>
                            {visibleRows.map(item => (
                                <Col
                                    xs={24}
                                    md={12}
                                    key={
                                        item.departmentName
                                    }
                                >
                                    <div
                                        style={{
                                            height: '100%',
                                            minHeight: 98,
                                            padding: '9px 10px',
                                            borderRadius: 11,
                                            border: `1px solid ${token.colorBorderSecondary}`,
                                            background:
                                                token.colorFillQuaternary
                                        }}
                                    >
                                        <div
                                            style={{
                                                display: 'flex',
                                                alignItems:
                                                    'flex-start',
                                                justifyContent:
                                                    'space-between',
                                                gap: 8
                                            }}
                                        >
                                            <Text
                                                strong
                                                ellipsis={{
                                                    tooltip:
                                                        item.departmentName
                                                }}
                                                style={{
                                                    minWidth: 0,
                                                    fontSize: 12
                                                }}
                                            >
                                                {
                                                    item.departmentName
                                                }
                                            </Text>

                                            <Tag
                                                color="red"
                                                style={{
                                                    marginInlineEnd: 0,
                                                    borderRadius: 999,
                                                    flex: '0 0 auto'
                                                }}
                                            >
                                                {item.total}
                                            </Tag>
                                        </div>

                                        <div
                                            style={{
                                                display: 'flex',
                                                width: '100%',
                                                height: 7,
                                                overflow: 'hidden',
                                                borderRadius: 999,
                                                background:
                                                    token.colorFillSecondary,
                                                marginTop: 8
                                            }}
                                        >
                                            {item.departmentReview >
                                                0 && (
                                                    <div
                                                        title={`${item.departmentReview} department review`}
                                                        style={{
                                                            width: `${(
                                                                item.departmentReview /
                                                                item.total
                                                            ) * 100}%`,
                                                            background:
                                                                token.colorError
                                                        }}
                                                    />
                                                )}

                                            {item.awaitingSme >
                                                0 && (
                                                    <div
                                                        title={`${item.awaitingSme} awaiting SME`}
                                                        style={{
                                                            width: `${(
                                                                item.awaitingSme /
                                                                item.total
                                                            ) * 100}%`,
                                                            background:
                                                                token.colorErrorActive
                                                        }}
                                                    />
                                                )}

                                            {item.readyNoService >
                                                0 && (
                                                    <div
                                                        title={`${item.readyNoService} ready, no service`}
                                                        style={{
                                                            width: `${(
                                                                item.readyNoService /
                                                                item.total
                                                            ) * 100}%`,
                                                            background:
                                                                token.colorWarning
                                                        }}
                                                    />
                                                )}
                                        </div>

                                        <div
                                            style={{
                                                display: 'grid',
                                                gridTemplateColumns:
                                                    'repeat(3, minmax(0, 1fr))',
                                                gap: 6,
                                                marginTop: 8
                                            }}
                                        >
                                            <div>
                                                <Text
                                                    strong
                                                    style={{
                                                        display:
                                                            'block',
                                                        fontSize:
                                                            11
                                                    }}
                                                >
                                                    {
                                                        item.departmentReview
                                                    }
                                                </Text>
                                                <Text
                                                    type="secondary"
                                                    style={{
                                                        fontSize:
                                                            8
                                                    }}
                                                >
                                                    Dept review
                                                </Text>
                                            </div>

                                            <div>
                                                <Text
                                                    strong
                                                    style={{
                                                        display:
                                                            'block',
                                                        fontSize:
                                                            11
                                                    }}
                                                >
                                                    {
                                                        item.awaitingSme
                                                    }
                                                </Text>
                                                <Text
                                                    type="secondary"
                                                    style={{
                                                        fontSize:
                                                            8
                                                    }}
                                                >
                                                    Awaiting SME
                                                </Text>
                                            </div>

                                            <div>
                                                <Text
                                                    strong
                                                    style={{
                                                        display:
                                                            'block',
                                                        fontSize:
                                                            11
                                                    }}
                                                >
                                                    {
                                                        item.readyNoService
                                                    }
                                                </Text>
                                                <Text
                                                    type="secondary"
                                                    style={{
                                                        fontSize:
                                                            8
                                                    }}
                                                >
                                                    No service
                                                </Text>
                                            </div>
                                        </div>
                                    </div>
                                </Col>
                            ))}
                        </Row>

                        {pressureRows.length >
                            PRESSURE_PAGE_SIZE && (
                                <div
                                    style={{
                                        display: 'flex',
                                        justifyContent:
                                            'center',
                                        marginTop: 10
                                    }}
                                >
                                    <Pagination
                                        current={page}
                                        pageSize={
                                            PRESSURE_PAGE_SIZE
                                        }
                                        total={
                                            pressureRows.length
                                        }
                                        showSizeChanger={false}
                                        size="small"
                                        onChange={setPage}
                                    />
                                </div>
                            )}
                    </>
                )}
            </Card>
        </motion.div>
    )
}

export default function AnalyticsModal({
    open,
    onClose,
    isDepartmentScopedView,
    departmentScopeLabel,
    rows
}: Props) {
    const { token } = theme.useToken()
    const shouldReduceMotion =
        useReducedMotion()

    const chartTheme = useMemo<ChartTheme>(
        () => ({
            primary: token.colorPrimary,
            success: token.colorSuccess,
            mediumRisk: token.colorWarning,
            highRisk: token.colorErrorActive,
            criticalRisk: token.colorError,
            text: token.colorText,
            mutedText:
                token.colorTextSecondary,
            border:
                token.colorBorderSecondary,
            split: token.colorSplit,
            surface: token.colorBgContainer
        }),
        [
            token.colorPrimary,
            token.colorSuccess,
            token.colorWarning,
            token.colorErrorActive,
            token.colorError,
            token.colorText,
            token.colorTextSecondary,
            token.colorBorderSecondary,
            token.colorSplit,
            token.colorBgContainer
        ]
    )

    return (
        <Modal
            open={open}
            onCancel={onClose}
            footer={null}
            width="min(1380px, calc(100vw - 32px))"
            centered
            destroyOnHidden
            styles={{
                body: {
                    maxHeight:
                        'calc(100dvh - 138px)',
                    overflowY: 'auto',
                    overflowX: 'hidden',
                    paddingTop: 8,
                    paddingBottom: 0
                }
            }}
            title={
                <div
                    style={{
                        paddingRight: 28
                    }}
                >
                    <Space size={8} wrap>
                        <Title
                            level={4}
                            style={{ margin: 0 }}
                        >
                            SME Risk Analytics
                        </Title>

                        {isDepartmentScopedView && (
                            <Tag
                                color="blue"
                                style={{
                                    marginInlineEnd: 0,
                                    borderRadius: 999
                                }}
                            >
                                {departmentScopeLabel}
                            </Tag>
                        )}
                    </Space>

                    <Text
                        type="secondary"
                        style={{
                            display: 'block',
                            marginTop: 2,
                            fontSize: 11,
                            fontWeight: 400
                        }}
                    >
                        Portfolio risk, workflow bottlenecks and department pressure.
                    </Text>
                </div>
            }
        >
            <Row
                gutter={[12, 12]}
                align="top"
            >
                <Col xs={24} xl={8}>
                    <Space
                        direction="vertical"
                        size={12}
                        style={{ width: '100%' }}
                    >
                        <PortfolioRiskPanel
                            rows={rows}
                            chartTheme={chartTheme}
                            shouldReduceMotion={
                                shouldReduceMotion
                            }
                        />

                        <RiskDriversPanel
                            rows={rows}
                            shouldReduceMotion={
                                shouldReduceMotion
                            }
                        />
                    </Space>
                </Col>

                <Col xs={24} xl={16}>
                    <Space
                        direction="vertical"
                        size={12}
                        style={{ width: '100%' }}
                    >
                        <ServiceReadinessFlow
                            rows={rows}
                            shouldReduceMotion={
                                shouldReduceMotion
                            }
                        />

                        <DepartmentRiskPressurePanel
                            rows={rows}
                            isDepartmentScopedView={
                                isDepartmentScopedView
                            }
                            shouldReduceMotion={
                                shouldReduceMotion
                            }
                        />
                    </Space>
                </Col>
            </Row>
        </Modal>
    )
}
