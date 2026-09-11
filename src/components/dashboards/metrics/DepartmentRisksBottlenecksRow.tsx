import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Col, Divider, Empty, List, Progress, Row, Space, Spin, Tag, Typography } from 'antd'
import {
    AlertOutlined,
    ClockCircleOutlined,
    StopOutlined,
    UserSwitchOutlined
} from '@ant-design/icons'
import { collection, onSnapshot, query, where } from 'firebase/firestore'
import dayjs, { Dayjs } from 'dayjs'

import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { MotionCard } from '@/components/dashboards/metrics/Header'

const { Text } = Typography

type DateRangeValue = [Dayjs | null, Dayjs | null] | null

type Props = {
    dateRange?: DateRangeValue
    departmentId?: string
}

type AssignmentRow = {
    id: string
    programId?: string
    departmentId?: string

    beneficiaryName?: string
    participantName?: string
    smmeName?: string

    interventionTitle?: string
    title?: string

    status?: string
    assigneeAcceptanceStatus?: string
    participantAcceptanceStatus?: string
    participantAcceptanceStatus?: string
    assigneeCompletionStatus?: string
    participantCompletionStatus?: string
    completionStatus?: string

    dueDate?: any
    assignedAt?: any
    createdAt?: any
    updatedAt?: any

    progress?: {
        percentage?: number
    }

    computedProgress?: number
}

const norm = (value: any) => String(value || '').trim().toLowerCase()

const toDayjs = (value: any): Dayjs | null => {
    if (!value) return null

    if (dayjs.isDayjs(value)) return value

    if (typeof value?.toDate === 'function') {
        const d = dayjs(value.toDate())
        return d.isValid() ? d : null
    }

    if (typeof value?.seconds === 'number') {
        const d = dayjs(value.seconds * 1000)
        return d.isValid() ? d : null
    }

    const d = dayjs(value)
    return d.isValid() ? d : null
}

const getScopeDate = (row: AssignmentRow) =>
    toDayjs(row.assignedAt) ||
    toDayjs(row.createdAt) ||
    toDayjs(row.updatedAt) ||
    toDayjs(row.dueDate)

const getDueDate = (row: AssignmentRow) => toDayjs(row.dueDate)

const getProgress = (row: AssignmentRow) => {
    const value = Number(row.progress?.percentage ?? row.computedProgress ?? 0)
    return Number.isFinite(value) ? value : 0
}

const isCompleted = (row: AssignmentRow) => {
    const status = norm(row.assignmentStatus)
    const completionStatus = norm(row.completionStatus)
    const assigneeCompletionStatus = norm(row.assigneeCompletionStatus)
    const participantCompletionStatus = norm(row.participantCompletionStatus)

    return (
        status === 'completed' ||
        completionStatus === 'confirmed' ||
        (
            ['done', 'completed'].includes(assigneeCompletionStatus) &&
            participantCompletionStatus === 'confirmed'
        )
    )
}

const isCancelledOrDeclined = (row: AssignmentRow) => {
    const status = norm(row.assignmentStatus)
    const participantAcceptanceStatus = norm(row.participantAcceptanceStatus || row.participantAcceptanceStatus)

    return (
        ['cancelled', 'canceled', 'declined', 'rejected'].includes(status) ||
        ['declined', 'rejected'].includes(participantAcceptanceStatus)
    )
}

const isActiveOpen = (row: AssignmentRow) =>
    !isCompleted(row) && !isCancelledOrDeclined(row)

const isUnserviced = (row: AssignmentRow) => {
    const status = norm(row.assignmentStatus)
    const progress = getProgress(row)

    return (
        isActiveOpen(row) &&
        progress <= 0 &&
        ['assigned', 'pending', ''].includes(status)
    )
}

const isOverdue = (row: AssignmentRow) => {
    const due = getDueDate(row)
    if (!due) return false

    return isActiveOpen(row) && due.endOf('day').isBefore(dayjs())
}

const isUnresponsive = (row: AssignmentRow) => {
    if (!isActiveOpen(row)) return false

    const participantAcceptanceStatus = norm(row.participantAcceptanceStatus || row.participantAcceptanceStatus)
    const assigneeCompletionStatus = norm(row.assigneeCompletionStatus)
    const participantCompletionStatus = norm(row.participantCompletionStatus)

    const awaitingAcceptance =
        (!participantAcceptanceStatus || participantAcceptanceStatus === 'pending')

    const awaitingCompletionConfirmation =
        ['done', 'completed'].includes(assigneeCompletionStatus) &&
        participantCompletionStatus !== 'confirmed'

    return awaitingAcceptance || awaitingCompletionConfirmation
}

const getSMEName = (row: AssignmentRow) =>
    row.beneficiaryName ||
    row.participantName ||
    row.smmeName ||
    'Unnamed SME'

const getInterventionTitle = (row: AssignmentRow) =>
    row.interventionTitle ||
    row.title ||
    'Untitled intervention'

const DepartmentRisksBottlenecksCard: React.FC<Props> = ({
    dateRange,
    departmentId
}) => {
    const { user } = useFullIdentity() as { user?: any }
    const { activeProgramId, isAllPrograms } = useActiveProgramId()

    const [loading, setLoading] = useState(true)
    const [rows, setRows] = useState<AssignmentRow[]>([])


    useEffect(() => {

        setLoading(true)

        const constraints: any[] = []

        if (departmentId && departmentId !== 'all') {
            constraints.push(where('departmentId', '==', departmentId))
        }

        if (!isAllPrograms && activeProgramId) {
            constraints.push(where('programId', '==', activeProgramId))
        }

        const unsub = onSnapshot(
            query(collection(db, 'assignedInterventions'), ...constraints),
            snap => {
                setRows(
                    snap.docs.map(d => ({
                        id: d.id,
                        ...(d.data() as any)
                    }))
                )
                setLoading(false)
            },
            error => {
                console.error('Failed to load department risks:', error)
                setRows([])
                setLoading(false)
            }
        )

        return () => unsub()
    }, [departmentId, activeProgramId, isAllPrograms])

    const getSMEKey = (row: AssignmentRow) =>
        String(
            (row as any).participantId ||
            (row as any).beneficiaryId ||
            row.beneficiaryName ||
            row.participantName ||
            row.smmeName ||
            row.id
        ).trim()

    const uniqueSMECount = (items: AssignmentRow[]) =>
        new Set(items.map(getSMEKey).filter(Boolean)).size

    const stats = useMemo(() => {
        const [start, end] = dateRange || []

        const scoped = rows.filter(row => {
            if (!start && !end) return true

            const d = getScopeDate(row)
            if (!d) return false

            if (start && d.isBefore(start.startOf('day'))) return false
            if (end && d.isAfter(end.endOf('day'))) return false

            return true
        })

        const openRows = scoped.filter(isActiveOpen)

        const overdueRows = openRows.filter(row => {
            const due = getDueDate(row)
            return due ? due.endOf('day').isBefore(dayjs()) : false
        })

        const overdueStillInProgress = overdueRows.filter(row => {
            const progress = getProgress(row)
            return progress < 100
        })

        const completedAwaitingSME = overdueRows.filter(row => {
            const assigneeCompletionStatus = norm(row.assigneeCompletionStatus)
            const participantCompletionStatus = norm(row.participantCompletionStatus)

            return (
                ['done', 'completed'].includes(assigneeCompletionStatus) &&
                participantCompletionStatus !== 'confirmed'
            )
        })

        const neverServicedRows = openRows.filter(row => {
            return getProgress(row) <= 0
        })

        const neverServicedSMEs = uniqueSMECount(neverServicedRows)

        const noServiceThreeMonthsRows = openRows.filter(row => {
            const lastActivity =
                toDayjs(row.updatedAt) ||
                toDayjs(row.createdAt) ||
                toDayjs(row.assignedAt)

            if (!lastActivity) return false

            return getProgress(row) <= 0 && dayjs().diff(lastActivity, 'day') >= 90
        })

        const noServiceThreeMonthsSMEs = uniqueSMECount(noServiceThreeMonthsRows)

        const unservicedRows = openRows.filter(row => getProgress(row) <= 0)
        const totalUnservicedSMEs = uniqueSMECount(unservicedRows)

        const totalBottlenecks = Array.from(
            new Set([
                ...overdueRows.map(x => x.id),
                ...completedAwaitingSME.map(x => x.id),
                ...noServiceThreeMonthsRows.map(x => x.id)
            ])
        ).length

        const denominator = Math.max(openRows.length, 1)

        return {
            scoped,
            openRows,
            totalUnservicedSMEs,
            neverServicedRows,
            neverServicedSMEs,
            noServiceThreeMonthsRows,
            noServiceThreeMonthsSMEs,
            totalBottlenecks,

            overdueStillInProgress,
            completedAwaitingSME,

            breakdown: [
                {
                    key: 'overdue_in_progress',
                    label: 'Overdue but still in progress',
                    description: 'Past due date and assignee has not reached 100%',
                    value: overdueStillInProgress.length,
                    percent: Math.round((overdueStillInProgress.length / denominator) * 100),
                    color: '#dc2626'
                },
                {
                    key: 'awaiting_sme_confirmation',
                    label: 'Completed, awaiting SME confirmation',
                    description: 'Assignee marked done but SME has not confirmed',
                    value: completedAwaitingSME.length,
                    percent: Math.round((completedAwaitingSME.length / denominator) * 100),
                    color: '#ea580c'
                },
                {
                    key: 'never_serviced',
                    label: 'Never serviced SMEs',
                    description: 'SMEs with assigned interventions but no recorded service progress',
                    value: neverServicedSMEs,
                    percent: Math.round((neverServicedSMEs / Math.max(uniqueSMECount(openRows), 1)) * 100),
                    color: '#d97706'
                },
                {
                    key: 'three_months_no_service',
                    label: '3+ months no service',
                    description: 'SMEs with no recorded service activity for 90+ days',
                    value: noServiceThreeMonthsSMEs,
                    percent: Math.round((noServiceThreeMonthsSMEs / Math.max(uniqueSMECount(openRows), 1)) * 100),
                    color: '#7c2d12'
                }
            ],

            riskRows: [
                ...overdueStillInProgress.map(row => ({
                    row,
                    type: 'Overdue in progress',
                    color: 'red'
                })),
                ...completedAwaitingSME.map(row => ({
                    row,
                    type: 'Awaiting SME confirmation',
                    color: 'orange'
                })),
                ...neverServicedRows.map(row => ({
                    row,
                    type: 'Never serviced',
                    color: 'gold'
                })),
                ...noServiceThreeMonthsRows.map(row => ({
                    row,
                    type: '3+ months no service',
                    color: 'volcano'
                }))
            ].slice(0, 6)
        }
    }, [rows, dateRange])

    return (
        <MotionCard
            title={
                <Space>
                    <AlertOutlined />
                    <span>Risks & Bottlenecks</span>
                </Space>
            }
        >
            <Spin spinning={loading}>
                <Space direction='vertical' size={16} style={{ width: '100%' }}>
                    <Row gutter={[12, 12]}>
                        <Col xs={24} md={12}>
                            <MotionCard
                                bodyStyle={{ padding: 16 }}
                                style={{
                                    borderRadius: 16,
                                    border: '1px solid #fecaca',
                                    background: 'linear-gradient(135deg,#fef2f2 0%,#ffffff 100%)'
                                }}
                            >
                                <MotionCard.Metric
                                    title='Bottlenecks'
                                    value={stats.totalBottlenecks}
                                    subtitle='Overdue or waiting on action'
                                    icon={<AlertOutlined style={{ color: '#dc2626' }} />}
                                    iconBg='rgba(220,38,38,0.12)'
                                />
                            </MotionCard>
                        </Col>

                        <Col xs={24} md={12}>
                            <MotionCard
                                bodyStyle={{ padding: 16 }}
                                style={{
                                    borderRadius: 16,
                                    border: '1px solid #fef3c7',
                                    background: 'linear-gradient(135deg,#fffbeb 0%,#ffffff 100%)'
                                }}
                            >
                                <MotionCard.Metric
                                    title='Total Unserviced'
                                    value={stats.totalUnservicedSMEs}
                                    subtitle='SMEs with no recorded service progress'
                                    icon={<StopOutlined style={{ color: '#d97706' }} />}
                                    iconBg='rgba(217,119,6,0.12)'
                                />
                            </MotionCard>
                        </Col>
                    </Row>

                    <Divider />

                    <Space direction='vertical' size={12} style={{ width: '100%' }}>
                        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                            <Text strong>Bottleneck breakdown</Text>
                            <Text type='secondary'>
                                {uniqueSMECount(stats.openRows)} SME(s) with open assignments
                            </Text>
                        </Space>

                        {stats.breakdown.map(item => (
                            <div key={item.key}>
                                <Space style={{ width: '100%', justifyContent: 'space-between' }}>
                                    <Space direction='vertical' size={0}>
                                        <Text>{item.label}</Text>
                                        <Text type='secondary' style={{ fontSize: 12 }}>
                                            {item.description}
                                        </Text>
                                    </Space>

                                    <Text strong>
                                        {item.value}
                                    </Text>
                                </Space>

                                <Progress
                                    percent={item.percent}
                                    showInfo={false}
                                    strokeColor={item.color}
                                />
                            </div>
                        ))}
                    </Space>
                </Space>
            </Spin>
        </MotionCard>
    )
}

export default DepartmentRisksBottlenecksCard
