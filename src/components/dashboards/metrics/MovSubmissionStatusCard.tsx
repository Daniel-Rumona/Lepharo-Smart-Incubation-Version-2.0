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

    /** Explains an empty review queue from what the data actually holds. */
    const emptyState = useMemo(() => {
        const plural = (n: number) => `${n} MOV${n === 1 ? '' : 's'}`

        if (rows.length === 0) {
            return {
                title: 'No MOVs submitted',
                detail: 'No MOV documents have been recorded for this department yet.'
            }
        }

        if (periodRows.length === 0) {
            return {
                title: 'No MOVs in this period',
                detail: `${plural(rows.length)} on record, but none fall in the selected period.`
            }
        }

        return {
            title: 'Nothing to review yet',
            detail: `${plural(periodRows.length)} submitted this period, but none have been SME-confirmed and reached HOD review.`
        }
    }, [rows, periodRows])

    /**
     * A single at-a-glance number for "is this department keeping up with MOV
     * validation" - the validated share, penalised once the monthly deadline
     * has actually been missed rather than merely approaching. Only meaningful
     * when something is in the review queue - see emptyState otherwise.
     */
    const health = useMemo(() => {
        if (availableCount === 0) {
            return { score: 0, label: 'Nothing to review', color: token.colorTextSecondary }
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
                // Mirrors the loaded card: health ring + label, the
                // available/validated row, the progress bar, then View All.
                <Space direction="vertical" size={14} style={{ width: '100%' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                        <Skeleton.Avatar active shape="circle" size={64} />
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <Skeleton.Input active size="small" style={{ width: 90, height: 16, minWidth: 0 }} />
                            <Skeleton.Input active size="small" style={{ width: 160, height: 12, minWidth: 0 }} />
                        </div>
                    </div>
                    <div>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                            <Skeleton.Input active size="small" style={{ width: 80, height: 12, minWidth: 0 }} />
                            <Skeleton.Input active size="small" style={{ width: 120, height: 12, minWidth: 0 }} />
                        </div>
                        <Skeleton.Input active block size="small" style={{ height: 8, minWidth: 0, borderRadius: 999 }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <Skeleton.Input active size="small" style={{ width: 70, height: 14, minWidth: 0 }} />
                    </div>
                </Space>
            ) : availableCount === 0 ? (
                <Space direction="vertical" size={14} style={{ width: '100%' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                        <div
                            style={{
                                width: 64,
                                height: 64,
                                flexShrink: 0,
                                display: 'grid',
                                placeItems: 'center',
                                borderRadius: '50%',
                                background: token.colorFillSecondary,
                                color: token.colorTextSecondary,
                                fontSize: 26
                            }}
                        >
                            <FileDoneOutlined />
                        </div>
                        <div style={{ minWidth: 0 }}>
                            <Text strong style={{ display: 'block', fontSize: 14 }}>
                                {emptyState.title}
                            </Text>
                            <Text type="secondary" style={{ fontSize: 12 }}>
                                {emptyState.detail}
                            </Text>
                        </div>
                    </div>
                </Space>
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
                                <CheckCircleOutlined /> All {availableCount} available MOVs validated
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
