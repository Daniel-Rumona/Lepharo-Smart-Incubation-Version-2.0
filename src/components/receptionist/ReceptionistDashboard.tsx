import React, { useEffect, useState } from 'react'
import { Alert, Button, Col, Row, Spin } from 'antd'
import { getDocs, collection } from 'firebase/firestore'
import dayjs from 'dayjs'

import { useAuth } from '@/hooks/useAuth'
import { useDataColor } from '@/lib/chartColors'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { inquiryService } from '@/services/inquiryService'
import { ReceptionistDashboardData } from '@/types/inquiry'
import { db } from '@/firebase'

import DashboardMetrics from './DashboardMetrics'
import RecentInquiries from './RecentInquiries'
import WeekAgenda, { agendaWeekStart, type ScheduleItem } from './WeekAgenda'
import { followUpService, type FollowUp } from '@/services/followUpService'
import { countDueFollowUps, isOpenFollowUp } from '@/lib/followUpBuckets'
import '@/styles/admin-overview.css'
import '@/styles/receptionist-dashboard.css'

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
    // Mini bars on the tiles use the data colour (lib/chartColors), set here for the page.
    const DATA = useDataColor()
    const { activeProgramId, isAllPrograms } = useActiveProgramId()

    const [dashboardData, setDashboardData] =
        useState<ReceptionistDashboardData | null>(null)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [refreshing, setRefreshing] = useState(false)
    const [scheduleLoading, setScheduleLoading] = useState(false)
    const [scheduleItems, setScheduleItems] = useState<ScheduleItem[]>([])
    const [branchFollowUps, setBranchFollowUps] = useState<FollowUp[]>([])
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
                                data.title
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

            // From the Monday the agenda shows, so earlier days this week still list what happened.
            const weekStart = agendaWeekStart()

            const combined = [...eventItems, ...appointmentItems]
                .filter(item => !dayjs(item.date).isBefore(weekStart, 'day'))
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

    // The follow-ups tile counts the same records as the follow-ups page: the whole branch's.
    const fetchFollowUps = async () => {
        if (!user?.uid || !assignedBranch) return setBranchFollowUps([])
        try {
            setBranchFollowUps(await followUpService.getFollowUpsByBranch(assignedBranch))
        } catch (followUpError) {
            console.error('ReceptionistDashboard: Error fetching follow-ups:', followUpError)
            setBranchFollowUps([])
        }
    }

    useEffect(() => {
        fetchFollowUps()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [assignedBranch, user?.uid])

    const handleRefresh = async () => {
        await Promise.all([
            fetchDashboardData(true),
            fetchSchedule(),
            fetchFollowUps()
        ])
    }

    const headerBranchName = assignedBranch
        ? branchMap[assignedBranch] || 'Unknown Branch'
        : 'Not Assigned'

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
        <div className='admin-overview rcp-dashboard' style={{ ['--rcp-data' as any]: DATA }}>
            <DashboardMetrics
                inquiries={dashboardData.recentInquiries}
                dueFollowUps={countDueFollowUps(branchFollowUps, new Date())}
                openFollowUps={branchFollowUps.filter(isOpenFollowUp).length}
            />

            <Row gutter={[16, 16]} className='admin-overview-row'>
                <Col xs={24} lg={12}>
                    <RecentInquiries
                        inquiries={dashboardData.recentInquiries}
                        urgentInquiries={dashboardData.urgentInquiries}
                        onRefresh={handleRefresh}
                    />
                </Col>

                <Col xs={24} lg={12}>
                    <WeekAgenda
                        items={scheduleItems}
                        loading={scheduleLoading || refreshing}
                        branchName={headerBranchName}
                        onRefresh={handleRefresh}
                    />
                </Col>
            </Row>
        </div>
    )
}

export default ReceptionistDashboard
