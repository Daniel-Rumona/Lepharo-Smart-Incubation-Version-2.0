import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Col, Row, Spin, Table, Tag, Typography } from 'antd'
import { getDocs, collection } from 'firebase/firestore'
import dayjs from 'dayjs'

import { useAuth } from '@/hooks/useAuth'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { inquiryService } from '@/services/inquiryService'
import { ReceptionistDashboardData } from '@/types/inquiry'
import { db } from '@/firebase'

import DashboardMetrics from './DashboardMetrics'
import RecentInquiries from './RecentInquiries'
import UrgentInquiries from './UrgentInquiries'

const { Text } = Typography

type ScheduleKind = 'event' | 'appointment'

type ScheduleItem = {
    id: string
    kind: ScheduleKind
    title: string
    date: Date
    startTime?: string
    endTime?: string
    participant?: string
    facilitator?: string
    location?: string
    branchId?: string
    programId?: string
}

const clean = (value: unknown) => String(value ?? '').trim()

const toDate = (value: any): Date | null => {
    if (!value) return null
    if (typeof value?.toDate === 'function') return value.toDate()

    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
}

const resolveBranchId = (data: any) =>
    clean(
        data?.branchId ||
        data?.assignedBranch?.id ||
        data?.assignedBranch ||
        data?.branch?.id ||
        data?.branchCode
    )

const resolveProgramId = (data: any) =>
    clean(data?.programId || data?.activeProgramId || data?.program?.id)

const resolveScheduleDate = (data: any) =>
    toDate(
        data?.eventDate ||
        data?.appointmentDate ||
        data?.scheduledAt ||
        data?.date ||
        data?.startDate
    )

const ReceptionistDashboard: React.FC = () => {
    const { user } = useAuth()
    const { activeProgramId, isAllPrograms } = useActiveProgramId()

    const [dashboardData, setDashboardData] =
        useState<ReceptionistDashboardData | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [refreshing, setRefreshing] = useState(false)
    const [scheduleLoading, setScheduleLoading] = useState(false)
    const [scheduleItems, setScheduleItems] = useState<ScheduleItem[]>([])
    const [branchMap, setBranchMap] = useState<Record<string, string>>({})

    const userEmail = clean(user?.email).toLowerCase()
    const assignedBranch = clean(user?.assignedBranch)

    const fetchDashboardData = async (showRefreshing = false) => {
        if (!user) {
            setError('User not authenticated. Please log in.')
            setLoading(false)
            return
        }

        if (!assignedBranch) {
            console.warn('ReceptionistDashboard: No branch assigned to receptionist')
            setError(
                'No branch assigned to your account. Please contact your administrator to assign you to a branch.'
            )
            setLoading(false)
            return
        }

        try {
            if (showRefreshing) setRefreshing(true)
            else setLoading(true)

            setError(null)

            try {
                const testResult = await inquiryService.getInquiries({ limit: 1 })
                console.log(
                    'ReceptionistDashboard: Firestore test successful, got',
                    testResult.length,
                    'results'
                )
            } catch (testError) {
                console.error(
                    'ReceptionistDashboard: Firestore test failed:',
                    testError
                )
                throw new Error(
                    `Firestore connectivity test failed: ${testError instanceof Error ? testError.message : 'Unknown error'
                    }`
                )
            }

            const data = await inquiryService.getReceptionistDashboard(
                assignedBranch,
                user.uid,
                isAllPrograms ? undefined : activeProgramId
            )

            setDashboardData(data)
        } catch (err) {
            console.error(
                'ReceptionistDashboard: Error fetching dashboard data:',
                err
            )

            if (err instanceof Error) {
                if (err.message.includes('permission-denied')) {
                    setError(
                        'Access denied. Please ensure you have proper permissions for your assigned branch.'
                    )
                } else if (err.message.includes('not-found')) {
                    setError('Branch data not found. Please contact your administrator.')
                } else {
                    setError(`Error: ${err.message}`)
                }
            } else {
                setError('Failed to load dashboard data. Please try again.')
            }
        } finally {
            setLoading(false)
            setRefreshing(false)
        }
    }

    const fetchSchedule = async () => {
        if (!user || !assignedBranch) {
            setScheduleItems([])
            return
        }

        setScheduleLoading(true)

        try {
            const [eventsSnap, appointmentsSnap] = await Promise.all([
                getDocs(collection(db, 'events')),
                getDocs(collection(db, 'appointments'))
            ])

            const programMatches = (data: any) => {
                if (isAllPrograms || !activeProgramId) return true
                return resolveProgramId(data) === activeProgramId
            }

            const branchMatches = (data: any) => {
                const branchId = resolveBranchId(data)
                return !branchId || branchId === assignedBranch
            }

            const eventItems: ScheduleItem[] = eventsSnap.docs
                .map(docSnap => {
                    const data = docSnap.data() as any
                    const date = resolveScheduleDate(data)
                    if (!date || !programMatches(data) || !branchMatches(data)) return null

                    const participants = Array.isArray(data.participants)
                        ? data.participants
                        : []

                    const isParticipant = participants.some(
                        (participant: any) =>
                            clean(participant?.email).toLowerCase() === userEmail
                    )

                    const organizerEmail = clean(
                        data.createdByEmail ||
                        data.organizerEmail ||
                        data.ownerEmail ||
                        data.createdBy
                    ).toLowerCase()

                    const hasExplicitBranch = Boolean(resolveBranchId(data))

                    // Branch events are visible to the receptionist. Events without a
                    // branch remain visible only when the receptionist is involved.
                    if (!hasExplicitBranch && !isParticipant && organizerEmail !== userEmail) {
                        return null
                    }

                    return {
                        id: `event-${docSnap.id}`,
                        kind: 'event' as const,
                        title: clean(data.title || data.name) || 'Event',
                        date,
                        startTime: clean(data.startTime) || undefined,
                        endTime: clean(data.endTime) || undefined,
                        participant: clean(data.participantName) || undefined,
                        location: clean(data.location) || undefined,
                        branchId: resolveBranchId(data) || undefined,
                        programId: resolveProgramId(data) || undefined
                    }
                })
                .filter(Boolean) as ScheduleItem[]

            const appointmentItems: ScheduleItem[] = appointmentsSnap.docs
                .map(docSnap => {
                    const data = docSnap.data() as any
                    const date = resolveScheduleDate(data)
                    if (!date || !programMatches(data) || !branchMatches(data)) return null

                    return {
                        id: `appointment-${docSnap.id}`,
                        kind: 'appointment' as const,
                        title:
                            clean(
                                data.interventionTitle ||
                                data.sessionTitle ||
                                data.title ||
                                data.areaOfSupport
                            ) || 'Appointment',
                        date,
                        startTime: clean(data.startTime || data.time) || undefined,
                        endTime: clean(data.endTime) || undefined,
                        participant:
                            clean(
                                data.participantName ||
                                data.beneficiaryName ||
                                data.companyName
                            ) || undefined,
                        facilitator:
                            clean(
                                data.assigneeName ||
                                data.coordinatorName ||
                                data.facilitatorName
                            ) || undefined,
                        location: clean(data.location) || undefined,
                        branchId: resolveBranchId(data) || undefined,
                        programId: resolveProgramId(data) || undefined
                    }
                })
                .filter(Boolean) as ScheduleItem[]

            const now = dayjs().startOf('day')

            const combined = [...eventItems, ...appointmentItems]
                .filter(item => dayjs(item.date).isSame(now, 'day') || dayjs(item.date).isAfter(now, 'day'))
                .sort((a, b) => {
                    const aTime = `${dayjs(a.date).format('YYYY-MM-DD')} ${a.startTime || '00:00'}`
                    const bTime = `${dayjs(b.date).format('YYYY-MM-DD')} ${b.startTime || '00:00'}`
                    return aTime.localeCompare(bTime)
                })

            setScheduleItems(combined)
        } catch (scheduleError) {
            console.error(
                'ReceptionistDashboard: Error fetching events and appointments:',
                scheduleError
            )
            setScheduleItems([])
        } finally {
            setScheduleLoading(false)
        }
    }

    useEffect(() => {
        const run = async () => {
            const snap = await getDocs(collection(db, 'branches'))
            const map: Record<string, string> = {}

            snap.docs.forEach(docSnap => {
                const branch = docSnap.data() as any
                map[docSnap.id] = branch.name || branch.branchName || '—'
            })

            setBranchMap(map)
        }

        run()
    }, [])

    useEffect(() => {
        if (!user) return
        fetchDashboardData()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [assignedBranch, user?.uid, activeProgramId, isAllPrograms])

    useEffect(() => {
        fetchSchedule()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        assignedBranch,
        user?.uid,
        userEmail,
        activeProgramId,
        isAllPrograms
    ])

    const handleRefresh = async () => {
        await Promise.all([
            fetchDashboardData(true),
            fetchSchedule()
        ])
    }

    const headerBranchName = assignedBranch
        ? branchMap[assignedBranch] || 'Unknown Branch'
        : 'Not Assigned'

    const scheduleColumns = useMemo(
        () => [
            {
                title: 'Type',
                dataIndex: 'kind',
                key: 'kind',
                width: 120,
                render: (kind: ScheduleKind) => (
                    <Tag color={kind === 'appointment' ? 'blue' : 'purple'}>
                        {kind === 'appointment' ? 'Appointment' : 'Event'}
                    </Tag>
                )
            },
            {
                title: 'Date',
                dataIndex: 'date',
                key: 'date',
                width: 125,
                render: (date: Date) => dayjs(date).format('DD MMM YYYY')
            },
            {
                title: 'Time',
                key: 'time',
                width: 120,
                render: (_: unknown, item: ScheduleItem) =>
                    [item.startTime, item.endTime].filter(Boolean).join(' – ') || '—'
            },
            {
                title: 'Activity',
                dataIndex: 'title',
                key: 'title',
                render: (title: string, item: ScheduleItem) => (
                    <div>
                        <Text strong>{title}</Text>
                        {(item.participant || item.facilitator) && (
                            <div>
                                <Text type='secondary'>
                                    {[
                                        item.participant,
                                        item.facilitator ? `Coordinator: ${item.facilitator}` : ''
                                    ]
                                        .filter(Boolean)
                                        .join(' • ')}
                                </Text>
                            </div>
                        )}
                    </div>
                )
            },
            {
                title: 'Location',
                dataIndex: 'location',
                key: 'location',
                width: 180,
                ellipsis: true,
                render: (location?: string) => location || '—'
            }
        ],
        []
    )

    if (loading) {
        return (
            <div
                style={{
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    minHeight: '100vh'
                }}
            >
                <Spin size='large' />
            </div>
        )
    }

    if (error) {
        console.log(error)
        return (
            <div style={{ margin: '24px' }}>
                <Alert
                    message='Error Loading Dashboard'
                    description={error}
                    type='error'
                    showIcon
                    action={
                        <Button onClick={handleRefresh} type='primary' loading={refreshing}>
                            Try Again
                        </Button>
                    }
                    style={{ marginBottom: '16px' }}
                />

                {error.includes('No branch assigned') && (
                    <Alert
                        message='Branch Assignment Required'
                        description={
                            <div>
                                <p>
                                    As a receptionist, you need to be assigned to a specific
                                    branch to access the dashboard.
                                </p>
                                <p>
                                    <strong>For Directors:</strong> Use the User Management
                                    interface to assign this receptionist to a branch.
                                </p>
                                <p>
                                    <strong>For System Administrators:</strong> Use the branch
                                    assignment script or User Management interface.
                                </p>
                            </div>
                        }
                        type='info'
                        showIcon
                        style={{ marginTop: '16px' }}
                    />
                )}
            </div>
        )
    }

    if (!dashboardData) {
        return (
            <Alert
                message='No Data Available'
                description='Dashboard data could not be loaded.'
                type='warning'
                showIcon
                style={{ margin: '20px' }}
            />
        )
    }

    return (
        <div style={{ padding: '24px', minHeight: '100vh' }}>
            <DashboardMetrics dashboardData={dashboardData} />

            <Row gutter={[24, 24]} style={{ marginTop: '24px' }}>
                <Col xs={24} lg={12}>
                    <RecentInquiries
                        inquiries={dashboardData.recentInquiries}
                        onRefresh={handleRefresh}
                    />
                </Col>

                <Col xs={24} lg={12}>
                    <UrgentInquiries
                        urgentInquiries={dashboardData.urgentInquiries}
                        pendingFollowUps={dashboardData.pendingFollowUps}
                        onRefresh={handleRefresh}
                    />
                </Col>

                <Col span={24}>
                    <Card
                        title={`Upcoming Schedule · ${headerBranchName}`}
                        extra={
                            <Button onClick={handleRefresh} loading={refreshing || scheduleLoading}>
                                Refresh
                            </Button>
                        }
                    >
                        <Table
                            rowKey='id'
                            columns={scheduleColumns as any}
                            dataSource={scheduleItems}
                            loading={scheduleLoading}
                            pagination={{
                                pageSize: 6,
                                position: ['bottomCenter'],
                                showSizeChanger: false
                            }}
                            locale={{
                                emptyText: 'No upcoming appointments or events found.'
                            }}
                        />
                    </Card>
                </Col>
            </Row>
        </div>
    )
}

export default ReceptionistDashboard
