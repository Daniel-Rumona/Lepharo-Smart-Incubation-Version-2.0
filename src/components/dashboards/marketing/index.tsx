// src/pages/marketing/MarketingDashboard.tsx
import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
    Card,
    Row,
    Col,
    Table,
    Tag,
    Typography,
    Button,
    message,
    Space,
    Tooltip
} from 'antd'
import {
    ReloadOutlined,
    ArrowRightOutlined
} from '@ant-design/icons'
import { db } from '@/firebase'
import { assignedInterventionService } from '@/services/assignedInterventionService'
import { loadInterventionMetrics, type InterventionMetricSummary } from '@/services/interventionMetricsService'
import { collection, documentId, getDocs, query, where } from 'firebase/firestore'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import dayjs from 'dayjs'
import { motion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import DepartmentInterventionsStatus from '../charts/InterventionsBreakdown'
import UpcomingAppointmentsCard from '@/components/modals/UpcomingAppointmentsCard'
import { DashboardHeaderCard } from '../metrics/Header'
import InterventionMetricsGrid from '../metrics/InterventionMetricsGrid'

const { Title, Text } = Typography

type SurveyStatus = 'pending' | 'sent' | 'completed' | 'overdue' | string

export interface SurveyRow {
    id: string
    template: string
    participant: string
    status: SurveyStatus
    dueDate?: any
}

export function chunk<T>(arr: readonly T[] = [], size = 10): T[][] {
    const n = Math.max(1, Math.floor(size || 1))
    const out: T[][] = []
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
    return out
}

const cardStyle: React.CSSProperties = {
    boxShadow: '0 12px 32px rgba(0,0,0,0.10)',
    transition: 'all 0.3s ease',
    borderRadius: 14,
    border: '1px solid #e6efff',
    backdropFilter: 'blur(3px)'
}

const MotionCard: React.FC<React.ComponentProps<typeof Card>> = ({
    children,
    style,
    ...rest
}) => (
    <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
    >
        <Card {...rest} style={{ ...cardStyle, ...(style || {}) }}>
            {children}
        </Card>
    </motion.div>
)

interface Intervention {
    id: string
    beneficiaryName: string
    interventionTitle: string
    status: 'planned' | 'in-progress' | 'completed' | string
    dueDate?: any
    coordinatorName?: string
}

interface ResourceRow {
    id: string
    name: string
    rating?: number
    skills?: string[]
}

const MarketingDashboard: React.FC = () => {
    const { user } = useFullIdentity()
    const { activeProgramId } = useActiveProgramId()

    const [loading, setLoading] = useState(false)
    const [interventions, setInterventions] = useState<Intervention[]>([])
    const [interventionMetrics, setInterventionMetrics] = useState<InterventionMetricSummary>({
        totalRequired: 0,
        assigned: 0,
        pendingAssignment: 0,
        inProgress: 0,
        completed: 0
    })
    const [resources, setResources] = useState<ResourceRow[]>([])
    const navigate = useNavigate()
    const [surveys, setSurveys] = useState<SurveyRow[]>([])

    // hard-stop if not marketing dept (keeps the page from querying wrong stuff)
    const canView = useMemo(() => {
        return !!user && user.departmentName === 'Marketing and Communication'
    }, [user])

    const fetchData = useCallback(async () => {
        if (!canView) return

        // 🔥 Program switching fix: don’t fetch until program exists, and always filter by it.
        if (!activeProgramId) {
            setInterventions([])
            setResources([])
            setSurveys([])
            return
        }

        setLoading(true)
        try {
            const departmentId = user?.departmentId || ''
            const deptName = user?.departmentName || ''

            // Completed SME-confirmed interventions are read from the canonical
            // assignedInterventions collection.
            const interData = (await assignedInterventionService.listCompleted({
                programId: activeProgramId
            })).filter((row: any) =>
                String(row.areaOfSupport || '').trim().toLowerCase() === 'marketing support'
            ) as unknown as Intervention[]

            setInterventions(interData)
            setInterventionMetrics(await loadInterventionMetrics({
                programId: activeProgramId,
                assignedMatches: row =>
                    (departmentId && row.departmentId === departmentId) ||
                    String(row.areaOfSupport || row.departmentName || '').trim().toLowerCase() === 'marketing support',
                requiredMatches: entry =>
                    (departmentId && entry.departmentId === departmentId) ||
                    String(entry.areaOfSupport || entry.area || entry.departmentName || '').trim().toLowerCase() === 'marketing support'
            }))

            // resources nested within interventions (best effort)
            const allResources: ResourceRow[] = (interData as any[])
                .flatMap((d: any) => d.resources || [])
                .map((r: any, idx: number) => ({
                    id: r.id || `r-${idx}`,
                    name: r.name || r.fullName || '—',
                    rating: typeof r.rating === 'number' ? r.rating : undefined,
                    skills: r.skills || r.expertise || []
                }))
            setResources(allResources)

            // -------------------------
            // Surveys (sentForms + responses) scoped by program
            // -------------------------
            const sentRef = collection(db, 'sentForms')
            const sentWheres: any[] = [
                where('programId', '==', activeProgramId)
            ]
            if (departmentId) sentWheres.push(where('department', '==', departmentId))

            const sentSnap = await getDocs(query(sentRef, ...sentWheres))

            type RawSurvey = {
                id: string
                templateId: string
                templateTitle?: string
                sentAt?: any
                participantId: string
                completed?: boolean
                dueDate?: any
            }

            const rawSurveys: RawSurvey[] = []

            await Promise.all(
                sentSnap.docs.map(async sDoc => {
                    const sData = sDoc.data() as any
                    const responsesRef = collection(db, 'sentForms', sDoc.id, 'responses')
                    const respSnap = await getDocs(responsesRef)

                    respSnap.docs.forEach(rDoc => {
                        const rData = rDoc.data() as any
                        const participantId = rData.participantId || rDoc.id
                        const sentAt = sData.sentAt?.toDate?.() ?? sData.sentAt
                        const due =
                            rData.dueDate ||
                            sData.dueDate ||
                            (sentAt ? dayjs(sentAt).add(7, 'day').toDate() : null)

                        rawSurveys.push({
                            id: `${sDoc.id}_${rDoc.id}`,
                            templateId: sData.templateId || sDoc.id,
                            templateTitle: sData.title,
                            sentAt,
                            participantId,
                            completed: !!rData.completed,
                            dueDate: due
                        })
                    })
                })
            )

            // resolve participant names (chunks of 10 ids)
            const participantIds = [
                ...new Set(rawSurveys.map(r => r.participantId).filter(Boolean))
            ]
            const participantsMap = new Map<string, any>()
            for (const ids of chunk(participantIds, 10)) {
                const pSnap = await getDocs(
                    query(collection(db, 'participants'), where(documentId(), 'in', ids))
                )
                pSnap.docs.forEach(p => participantsMap.set(p.id, p.data()))
            }

            // template status from departmentForms (scoped by program + department)
            const deptFormsQ = query(
                collection(db, 'departmentForms'),
                where('programId', '==', activeProgramId),
                where('department', '==', deptName)
            )
            const deptSnap = await getDocs(deptFormsQ)

            const tplStatusById = new Map<string, string>()
            const tplNameById = new Map<string, string>()
            deptSnap.docs.forEach(d => {
                const data = d.data() as any
                const key = data.templateId || d.id
                tplStatusById.set(key, data.status || data.state || 'pending')
                tplNameById.set(key, data.title || data.name || data.templateName || '')
            })

            const normalizedSurveys: SurveyRow[] = rawSurveys.map(r => {
                const p = participantsMap.get(r.participantId) || {}
                const participantName =
                    p.beneficiaryName || p.name || p.companyName || p.email || r.participantId

                let status: SurveyStatus = tplStatusById.get(r.templateId) || 'sent'
                if (r.completed) status = 'completed'
                else if (r.dueDate && dayjs(r.dueDate).isBefore(dayjs(), 'day'))
                    status = 'overdue'

                return {
                    id: r.id,
                    template: r.templateTitle || tplNameById.get(r.templateId) || '—',
                    participant: participantName || '—',
                    status,
                    dueDate: r.dueDate || null
                }
            })

            setSurveys(normalizedSurveys)
        } catch (err) {
            console.error(err)
            message.error('Failed to load marketing dashboard data for the selected programme.')
            // No fake data. If it fails, it stays empty.
            setInterventions([])
            setResources([])
            setSurveys([])
        } finally {
            setLoading(false)
        }
    }, [activeProgramId, canView, user])

    // ✅ Program switching: re-run whenever activeProgramId changes.
    useEffect(() => {
        fetchData()
        // also clear UI instantly on program change to prevent “carry over”
        // (fetchData already clears when no programId)
    }, [fetchData])

    // ===== KPIs =====
    const completedCount = useMemo(
        () => interventions.filter(i => i.status === 'completed').length,
        [interventions]
    )

    const avgRating = useMemo(() => {
        const withRatings = resources.filter(r => typeof r.rating === 'number')
        if (!withRatings.length) return 0
        const sum = withRatings.reduce((a, r) => a + (r.rating || 0), 0)
        return Number((sum / withRatings.length).toFixed(1))
    }, [resources])

    const statusColor = (s: SurveyStatus) => {
        switch ((s || '').toLowerCase()) {
            case 'completed':
                return 'green'
            case 'sent':
                return 'blue'
            case 'pending':
                return 'orange'
            case 'overdue':
                return 'red'
            default:
                return 'default'
        }
    }

    // ===== Tables =====
    const resourcesColumns = [
        { title: 'Coordinator', dataIndex: 'name' },
        {
            title: 'Skills',
            dataIndex: 'skills',
            render: (arr: string[]) =>
                (arr || []).slice(0, 3).map((s, i) => <Tag key={i}>{s}</Tag>)
        },
        {
            title: 'Rating',
            dataIndex: 'rating',
            render: (r?: number) => (typeof r === 'number' ? <>{r}</> : '—')
        }
    ]

    const surveysColumns = [
        { title: 'Survey Template', dataIndex: 'template', key: 'template' },
        { title: 'Participant', dataIndex: 'participant', key: 'participant' },
        {
            title: 'Status',
            dataIndex: 'status',
            key: 'status',
            filters: [
                { text: 'Pending', value: 'pending' },
                { text: 'Sent', value: 'sent' },
                { text: 'Completed', value: 'completed' },
                { text: 'Overdue', value: 'overdue' }
            ],
            onFilter: (value: any, rec: SurveyRow) =>
                (rec.status || '').toLowerCase() === String(value).toLowerCase(),
            render: (s: SurveyStatus) => <Tag color={statusColor(s)}>{String(s || '—')}</Tag>
        },
        {
            title: 'Due Date',
            dataIndex: 'dueDate',
            key: 'dueDate',
            sorter: (a: SurveyRow, b: SurveyRow) =>
                dayjs(a.dueDate?.toDate?.() ?? a.dueDate).valueOf() -
                dayjs(b.dueDate?.toDate?.() ?? b.dueDate).valueOf(),
            render: (d: any, rec: SurveyRow) => {
                const dt = d?.toDate?.() ?? (typeof d === 'string' ? new Date(d) : d)
                if (!dt) return '—'
                const isOverdue = dayjs(dt).isBefore(dayjs(), 'day') && rec.status !== 'completed'
                return (
                    <span style={{ color: isOverdue ? '#ff4d4f' : undefined }}>
                        {dayjs(dt).format('MMM D, YYYY')}
                        {isOverdue ? ' • Overdue' : ''}
                    </span>
                )
            }
        }
    ]

    return (
        <div style={{ padding: 24, minHeight: '100vh' }}>
            {/* Header */}
            <DashboardHeaderCard
                title='Marketing Overview'
                subtitle='Campaigns, resources, surveys, and intervention activity for the selected programme.'
                extraRight={
                    <Space>
                        <Tooltip title="Refresh">
                            <Button
                                icon={<ReloadOutlined />}
                                onClick={fetchData}
                                loading={loading}
                                disabled={!activeProgramId}
                            />
                        </Tooltip>
                    </Space>}
            />

            <div style={{ marginTop: 12, marginBottom: 12 }}>
                <InterventionMetricsGrid metrics={interventionMetrics} loading={loading} />
            </div>

            {/* Charts row */}
            <Row gutter={16}>
                <Col xs={24} md={12}>
                    <DepartmentInterventionsStatus programId={activeProgramId} departmentName={user?.departmentName} />
                </Col>

                <Col xs={24} md={12}>
                    <UpcomingAppointmentsCard
                        departmentId={user?.departmentId}
                        programId={activeProgramId}
                        daysAhead={7}
                        limit={3}
                    />

                    <MotionCard
                        extra={
                            <Button type="link" onClick={() => navigate('/operations/forms')}>
                                View All <ArrowRightOutlined />
                            </Button>
                        }
                        style={{ marginTop: 15 }}
                        title="Surveys Tracker"
                    >
                        <Table
                            columns={surveysColumns as any}
                            dataSource={surveys}
                            rowKey="id"
                            loading={loading}
                            locale={{ emptyText: 'No surveys found for this programme.' }}
                        />
                    </MotionCard>
                </Col>
            </Row>
        </div>
    )
}

export default MarketingDashboard
