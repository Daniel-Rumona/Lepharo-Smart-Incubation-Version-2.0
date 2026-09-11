import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { Col, Empty, Modal, Progress, Row, Space, Table, Tag, Typography, theme } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { ShopOutlined, UserOutlined } from '@ant-design/icons'
import { Helmet } from 'react-helmet'
import dayjs from 'dayjs'

import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { useDashboardDateRange } from '@/lib/useDashboardDateRange'
import {
    loadInterventionMetricsDetailed,
    type InterventionMetricSummary
} from '@/services/interventionMetricsService'
import { getAssignedInterventionLifecycle } from '@/services/assignedInterventionService'
import { fetchAppointments } from '@/services/appointmentService'

import InterventionMetricsGrid, {
    type InterventionMetricKey
} from '../metrics/InterventionMetricsGrid'
import DepartmentInterventionsStatus from '../charts/InterventionsBreakdown'
import UpcomingAppointmentsCard from '@/components/modals/UpcomingAppointmentsCard'
import AppointmentsCalendarModal from '@/components/modals/AppointmentsCalender'
import AppointmentDetailsModal from '@/components/modals/AppointmentDetails'

const { Text } = Typography

const EMPTY_METRICS: InterventionMetricSummary = {
    totalRequired: 0,
    assigned: 0,
    inProgress: 0,
    completed: 0,
    pendingAssignment: 0
}

const DRILL_TITLES: Record<InterventionMetricKey, string> = {
    assigned: 'Assigned interventions',
    'in-progress': 'Interventions in progress',
    completed: 'Completed interventions'
}

const asDay = (value: any) => {
    if (!value) return null
    if (typeof value?.toDate === 'function') return dayjs(value.toDate())
    if (value?.seconds) return dayjs(value.seconds * 1000)
    return dayjs(value)
}

const formatDate = (value: any) => {
    const d = asDay(value)
    return d && d.isValid() ? d.format('DD MMM YYYY') : '—'
}

const text = (...candidates: any[]) =>
    candidates.map(v => String(v ?? '').trim()).find(Boolean) || '—'

export type InterventionsDashboardProps = {
    /** Page title. Used for the browser tab. */
    title: string

    /**
     * Decides whether an intervention or a required-intervention entry belongs
     * to this department.
     *
     * Each department matches differently — some on departmentId, some on an
     * areaOfSupport string that does not equal the department name — so this
     * stays with the caller rather than being guessed here.
     */
    matchesDepartment: (entry: Record<string, any>) => boolean

    /**
     * Cards specific to this department, stacked in the right column beneath
     * upcoming appointments. HSE passes its jobs card here.
     */
    sideCards?: React.ReactNode

    /** Full-width sections below the main row. */
    children?: React.ReactNode

    /** Set false for departments that do not run appointments. */
    showAppointments?: boolean
}

/**
 * Shared shell for the department intervention dashboards (HSE, legal, finance,
 * marketing, linkage).
 *
 * Those five pages had each rebuilt the same three things — a metrics row, a
 * workflow breakdown and an appointments card — around a small amount of
 * department-specific content. This owns the common part and takes the rest as
 * slots.
 *
 * Scope comes from the topbar: the program control and the reporting-period
 * filter both apply here, so the page shows the current month until someone
 * widens it. Nothing on the page repeats itself — the metrics row carries the
 * totals, so the breakdown below runs in `bucketScope="open"` and shows only
 * work still waiting on someone.
 */
export const InterventionsDashboard: React.FC<InterventionsDashboardProps> = ({
    title,
    matchesDepartment,
    sideCards,
    children,
    showAppointments = true
}) => {
    const { token } = theme.useToken()
    const { user } = useFullIdentity() as any
    const { activeProgramId } = useActiveProgramId()
    const { range, label: periodLabel, withinRange } = useDashboardDateRange()
    const programId = activeProgramId || null

    const [metrics, setMetrics] = useState<InterventionMetricSummary>(EMPTY_METRICS)
    const [rows, setRows] = useState<Record<string, any>[]>([])
    const [metricsLoading, setMetricsLoading] = useState(false)
    const [drillKey, setDrillKey] = useState<InterventionMetricKey | null>(null)

    const [appointments, setAppointments] = useState<any[]>([])
    const [calendarVisible, setCalendarVisible] = useState(false)
    const [selectedAppointment, setSelectedAppointment] = useState<any>(null)
    const [appointmentDetailsVisible, setAppointmentDetailsVisible] = useState(false)

    /**
     * Department membership AND the reporting window.
     *
     * The window is applied to assigned rows only. Required interventions are a
     * standing target rather than dated events, so narrowing the period must not
     * make the target itself appear to shrink.
     */
    const assignedMatches = useCallback(
        (row: Record<string, any>) =>
            matchesDepartment(row) &&
            withinRange(row.assignedAt || row.createdAt || row.startDate),
        [matchesDepartment, withinRange]
    )

    useEffect(() => {
        let cancelled = false

        const load = async () => {
            setMetricsLoading(true)
            try {
                const detail = await loadInterventionMetricsDetailed({
                    programId,
                    assignedMatches: row => assignedMatches(row as Record<string, any>),
                    requiredMatches: entry => matchesDepartment(entry as Record<string, any>)
                })
                if (cancelled) return
                setMetrics(detail.summary)
                setRows(detail.rows as Record<string, any>[])
            } catch (error) {
                console.error('[InterventionsDashboard] Failed to load metrics:', error)
                if (cancelled) return
                setMetrics(EMPTY_METRICS)
                setRows([])
            } finally {
                if (!cancelled) setMetricsLoading(false)
            }
        }

        void load()
        return () => {
            cancelled = true
        }
    }, [programId, assignedMatches, matchesDepartment])

    useEffect(() => {
        if (!showAppointments) return

        let cancelled = false

        const load = async () => {
            try {
                const result = await fetchAppointments({
                    programId,
                    departmentId: user?.departmentId ?? null
                })
                if (!cancelled) setAppointments(Array.isArray(result) ? result : [])
            } catch (error) {
                console.error('[InterventionsDashboard] Failed to load appointments:', error)
                if (!cancelled) setAppointments([])
            }
        }

        void load()
        return () => {
            cancelled = true
        }
    }, [programId, user?.departmentId, showAppointments])

    /** Records behind whichever metric tile was clicked. */
    const drillRows = useMemo(() => {
        if (!drillKey) return []
        if (drillKey === 'assigned') return rows

        const wanted = drillKey === 'in-progress' ? 'in-progress' : 'completed'
        return rows.filter(row => getAssignedInterventionLifecycle(row as any) === wanted)
    }, [drillKey, rows])

    const progressPercent = (row: Record<string, any>) => {
        const raw =
            row.computedProgress ??
            (typeof row.progress === 'number' ? row.progress : row.progress?.percentage) ??
            0
        const value = Number(raw)
        return Number.isFinite(value) ? Math.max(0, Math.min(100, Math.round(value))) : 0
    }

    const renderPeopleIdentity = (row: Record<string, any>) => {
        const identityIconStyle: React.CSSProperties = {
            width: 28,
            height: 28,
            flex: '0 0 28px',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 8
        }

        return (
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <span
                        style={{
                            ...identityIconStyle,
                            color: token.colorPrimary,
                            background: token.colorPrimaryBg
                        }}
                    >
                        <ShopOutlined />
                    </span>
                    <div style={{ minWidth: 0 }}>
                        <Text type="secondary" style={{ display: 'block', fontSize: 11 }}>
                            Beneficiary
                        </Text>
                        <Text strong>
                            {text(
                                row.beneficiaryName,
                                row.participantName,
                                row.businessName,
                                row.snapshot?.beneficiaryName
                            )}
                        </Text>
                    </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    <span
                        style={{
                            ...identityIconStyle,
                            color: token.colorSuccess,
                            background: token.colorSuccessBg
                        }}
                    >
                        <UserOutlined />
                    </span>
                    <div style={{ minWidth: 0 }}>
                        <Text type="secondary" style={{ display: 'block', fontSize: 11 }}>
                            Facilitator
                        </Text>
                        <Text>{text(row.assigneeName, row.snapshot?.assigneeName, row.assigneeEmail)}</Text>
                    </div>
                </div>
            </Space>
        )
    }

    const renderWorkflowProgress = (row: Record<string, any>) => {
        const lifecycle = getAssignedInterventionLifecycle(row as any)
        const percent = progressPercent(row)
        const color =
            lifecycle === 'completed'
                ? 'green'
                : lifecycle === 'in-progress'
                    ? 'blue'
                    : lifecycle === 'cancelled'
                        ? 'default'
                        : 'red'
        const label = String(lifecycle || 'unknown')
            .replace(/-/g, ' ')
            .replace(/\b\w/g, letter => letter.toUpperCase())

        return (
            <Space direction="vertical" size={7} style={{ width: '100%' }}>
                <Tag color={color} style={{ width: 'fit-content', marginInlineEnd: 0 }}>
                    {label}
                </Tag>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
                    <Progress
                        percent={percent}
                        showInfo={false}
                        size="small"
                        strokeColor={percent >= 100 ? token.colorSuccess : token.colorPrimary}
                        trailColor={token.colorFillSecondary}
                        style={{ flex: 1, minWidth: 64, margin: 0 }}
                    />
                    <Text strong style={{ minWidth: 38, textAlign: 'right', fontSize: 12 }}>
                        {percent}%
                    </Text>
                </div>
            </Space>
        )
    }

    const drillColumns: ColumnsType<Record<string, any>> = [
        {
            title: 'Beneficiary & facilitator',
            key: 'people',
            width: 280,
            render: (_, row) => renderPeopleIdentity(row)
        },
        {
            title: 'Intervention',
            key: 'intervention',
            render: (_, r) => text(r.interventionTitle, r.title, r.snapshot?.interventionTitle)
        },
        {
            title: 'Dates',
            key: 'dates',
            width: 170,
            render: (_, row) => {
                const due = asDay(row.dueDate)
                const lifecycle = getAssignedInterventionLifecycle(row as any)
                const overdue =
                    lifecycle !== 'completed' &&
                    lifecycle !== 'cancelled' &&
                    Boolean(due?.isValid() && due.isBefore(dayjs(), 'day'))

                return (
                    <Space direction="vertical" size={6}>
                        <div>
                            <Text type="secondary" style={{ display: 'block', fontSize: 11 }}>
                                Assigned
                            </Text>
                            <Text>{formatDate(row.assignedAt || row.createdAt || row.startDate)}</Text>
                        </div>
                        <div>
                            <Text type="secondary" style={{ display: 'block', fontSize: 11 }}>
                                Due
                            </Text>
                            <Text
                                strong={overdue}
                                style={{ color: overdue ? token.colorError : undefined }}
                            >
                                {formatDate(row.dueDate)}
                            </Text>
                        </div>
                    </Space>
                )
            }
        },
        {
            title: 'Workflow',
            key: 'workflow',
            width: 250,
            render: (_, row) => renderWorkflowProgress(row)
        }
    ]

    return (
        <div style={{ padding: 24, minHeight: '100vh' }}>
            <Helmet>
                <title>{title} | Smart Incubation</title>
            </Helmet>

            <InterventionMetricsGrid
                metrics={metrics}
                loading={metricsLoading}
                onSelect={setDrillKey}
                periodLabel={periodLabel}
            />

            <Row gutter={[24, 24]} style={{ marginTop: 16 }}>
                <Col xs={24} xl={12}>
                    <DepartmentInterventionsStatus
                        departmentName={user?.departmentName}
                        programId={programId || undefined}
                        title="Where work is stuck"
                        bucketScope="open"
                        tableMode="modal"
                        dateRange={range}
                        pageSize={8}
                    />
                </Col>

                <Col xs={24} xl={12}>
                    <Space direction="vertical" size={24} style={{ width: '100%' }}>
                        {showAppointments ? (
                            <UpcomingAppointmentsCard
                                departmentId={user?.departmentId}
                                programId={activeProgramId}
                                daysAhead={7}
                                limit={8}
                                onViewCalendar={() => setCalendarVisible(true)}
                            />
                        ) : null}

                        {sideCards}
                    </Space>
                </Col>
            </Row>

            {children}

            <Modal
                open={Boolean(drillKey)}
                onCancel={() => setDrillKey(null)}
                title={drillKey ? `${DRILL_TITLES[drillKey]} · ${periodLabel}` : ''}
                width="min(1100px, 94vw)"
                footer={null}
                destroyOnClose
                centered
            >
                {drillRows.length ? (
                    <Table
                        rowKey={(r, index) => String(r.id ?? index)}
                        size="small"
                        dataSource={drillRows}
                        columns={drillColumns}
                        scroll={{ x: 900 }}
                        pagination={{ pageSize: 5, showSizeChanger: false, position: ['bottomCenter'] }}
                    />
                ) : (
                    <Empty description={`No interventions match this metric for ${periodLabel.toLowerCase()}.`} />
                )}
            </Modal>

            {showAppointments ? (
                <>
                    <AppointmentsCalendarModal
                        open={calendarVisible}
                        onClose={() => setCalendarVisible(false)}
                        appointments={appointments}
                        departmentId={user?.departmentId}
                        onAppointmentClick={appointment => {
                            setSelectedAppointment(appointment)
                            setAppointmentDetailsVisible(true)
                        }}
                    />

                    <AppointmentDetailsModal
                        open={appointmentDetailsVisible}
                        onClose={() => setAppointmentDetailsVisible(false)}
                        appointment={selectedAppointment}
                    />
                </>
            ) : null}
        </div>
    )
}

export default InterventionsDashboard
