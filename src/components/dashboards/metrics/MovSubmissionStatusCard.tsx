import React, { useEffect, useMemo, useState } from 'react'
import { Button, Progress, Skeleton, Space, Tag, Typography, theme } from 'antd'
import {
    ArrowRightOutlined,
    CheckCircleOutlined,
    ClockCircleOutlined,
    ExclamationCircleOutlined,
    FileDoneOutlined
} from '@ant-design/icons'
import { collection, getDocs, query, where } from 'firebase/firestore'
import dayjs, { Dayjs } from 'dayjs'
import { useNavigate } from 'react-router-dom'
import { db } from '@/firebase'
import { isSmeConfirmedMov } from '@/services/movService'
import { MotionCard } from './Header'

const { Text } = Typography

type MovSubmissionStatusCardProps = {
    departmentName?: string
    programId?: string | null
    /** Reporting window supplied by the dashboard topbar. */
    dateRange?: [Dayjs, Dayjs] | null
    title?: React.ReactNode
}

const asDay = (value: any) => {
    if (!value) return null
    if (typeof value?.toDate === 'function') return dayjs(value.toDate())
    if (value?.seconds) return dayjs(value.seconds * 1000)
    return dayjs(value)
}

const resolveAssignmentDate = (mov: any) =>
    asDay(
        mov?.assignmentCreatedAt ||
        mov?.periodStart ||
        mov?.interventionDate ||
        mov?.assignedAt ||
        mov?.createdAt
    )

/** MOVs that have reached the HOD review queue - SME-confirmed, or already
 * decided (approved/queried) so records do not disappear the moment a
 * decision is made. */
const isAvailableForReview = (mov: any) =>
    isSmeConfirmedMov(mov) ||
    mov?.status === 'approved' ||
    mov?.status === 'queried'

const MovSubmissionStatusCard: React.FC<MovSubmissionStatusCardProps> = ({
    departmentName,
    programId,
    dateRange,
    title = (
        <Space size={8}>
            <FileDoneOutlined />
            <span>MOV Submissions</span>
        </Space>
    )
}) => {
    const { token } = theme.useToken()
    const navigate = useNavigate()

    const [loading, setLoading] = useState(true)
    const [rows, setRows] = useState<any[]>([])

    useEffect(() => {
        let cancelled = false

        const load = async () => {
            setLoading(true)
            try {
                const clauses = [
                    ...(departmentName ? [where('departmentName', '==', departmentName)] : []),
                    ...(programId ? [where('programId', '==', programId)] : [])
                ]

                const snap = await getDocs(query(collection(db, 'movDocuments'), ...clauses))
                if (cancelled) return

                setRows(snap.docs.map(d => ({ id: d.id, ...(d.data() as any) })))
            } catch (error) {
                console.error('[MovSubmissionStatusCard] Failed to load MOVs:', error)
                if (!cancelled) setRows([])
            } finally {
                if (!cancelled) setLoading(false)
            }
        }

        void load()
        return () => {
            cancelled = true
        }
    }, [departmentName, programId])

    const periodRows = useMemo(() => {
        if (!dateRange?.[0] || !dateRange?.[1]) return rows

        const start = dateRange[0].startOf('day')
        const end = dateRange[1].endOf('day')

        return rows.filter(mov => {
            const assigned = resolveAssignmentDate(mov)
            // No usable date - keep it rather than silently drop it from view.
            if (!assigned || !assigned.isValid()) return true
            return !assigned.isBefore(start) && !assigned.isAfter(end)
        })
    }, [rows, dateRange])

    const availableRows = useMemo(
        () => periodRows.filter(isAvailableForReview),
        [periodRows]
    )

    const validatedCount = useMemo(
        () => availableRows.filter(mov => mov.approvedByHod === true).length,
        [availableRows]
    )

    const availableCount = availableRows.length
    const validatedPercent = availableCount > 0
        ? Math.round((validatedCount / availableCount) * 100)
        : 0

    const countdown = useMemo(() => {
        const now = dayjs().startOf('day')
        const deadline = now.endOf('month').startOf('day')
        const days = deadline.diff(now, 'day')

        if (days < 0) {
            return {
                state: 'overdue' as const,
                color: 'error' as const,
                icon: <ExclamationCircleOutlined />,
                label: `Overdue by ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'}`
            }
        }

        if (days === 0) {
            return {
                state: 'due-today' as const,
                color: 'warning' as const,
                icon: <ClockCircleOutlined />,
                label: 'Due today'
            }
        }

        return {
            state: 'upcoming' as const,
            color: days <= 5 ? ('warning' as const) : ('processing' as const),
            icon: <ClockCircleOutlined />,
            label: `${days} day${days === 1 ? '' : 's'} until due`
        }
    }, [])

    /**
     * A single at-a-glance number for "is this department keeping up with MOV
     * validation" - the validated share, penalised once the monthly deadline
     * has actually been missed rather than merely approaching. An empty queue
     * scores full marks: nothing outstanding means nothing at risk.
     */
    const health = useMemo(() => {
        if (availableCount === 0) {
            return { score: 100, label: 'All caught up', color: token.colorSuccess }
        }

        const score = countdown.state === 'overdue'
            ? Math.max(0, validatedPercent - 20)
            : validatedPercent

        if (score >= 90) return { score, label: 'Excellent', color: token.colorSuccess }
        if (score >= 60) return { score, label: 'On track', color: token.colorPrimary }
        if (score >= 30) return { score, label: 'At risk', color: token.colorWarning }
        return { score, label: 'Critical', color: token.colorError }
    }, [availableCount, validatedPercent, countdown.state, token])

    return (
        <MotionCard
            title={title}
            extra={
                <Tag color={countdown.color} icon={countdown.icon} style={{ borderRadius: 999, marginInlineEnd: 0 }}>
                    {countdown.label}
                </Tag>
            }
        >
            {loading ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <Skeleton.Avatar active shape="circle" size={64} />
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <Skeleton.Input active size="small" style={{ width: 140 }} />
                        <Skeleton.Input active size="small" style={{ width: '100%', height: 10, borderRadius: 999 }} />
                        <Skeleton.Input active size="small" style={{ width: 120 }} />
                    </div>
                </div>
            ) : (
                <Space direction="vertical" size={14} style={{ width: '100%' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                        <Progress
                            type="circle"
                            size={64}
                            percent={health.score}
                            strokeColor={health.color}
                            trailColor={token.colorFillSecondary}
                            format={value => (
                                <span style={{ fontSize: 15, fontWeight: 700 }}>{value}</span>
                            )}
                        />

                        <div style={{ minWidth: 0 }}>
                            <Text strong style={{ color: health.color, fontSize: 14, display: 'block' }}>
                                {health.label}
                            </Text>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                                Submission health this period
                            </Text>
                        </div>
                    </div>

                    <div>
                        <div
                            style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'baseline',
                                marginBottom: 6
                            }}
                        >
                            <Text style={{ fontSize: 12 }}>
                                Available <Text strong>{availableCount}</Text>
                            </Text>
                            <Text style={{ fontSize: 12 }}>
                                Validated by HOD{' '}
                                <Text strong>
                                    {validatedCount}/{availableCount}
                                </Text>
                            </Text>
                        </div>
                        <Progress
                            percent={validatedPercent}
                            showInfo={false}
                            size="small"
                            strokeColor={
                                validatedPercent >= 100 ? token.colorSuccess : token.colorPrimary
                            }
                            trailColor={token.colorFillSecondary}
                        />
                        {availableCount > 0 && validatedCount === availableCount ? (
                            <Text type="success" style={{ fontSize: 11 }}>
                                <CheckCircleOutlined /> All caught up
                            </Text>
                        ) : null}
                    </div>

                    <div style={{ textAlign: 'right' }}>
                        <Button
                            type="link"
                            style={{ paddingInline: 0 }}
                            onClick={() => navigate('/operations/movs')}
                        >
                            View All <ArrowRightOutlined />
                        </Button>
                    </div>
                </Space>
            )}
        </MotionCard>
    )
}

export default MovSubmissionStatusCard
