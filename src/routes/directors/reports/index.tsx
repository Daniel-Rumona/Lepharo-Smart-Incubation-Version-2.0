import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Col, Empty, Row, Segmented } from 'antd'
import { Helmet } from 'react-helmet'
import {
    BarChartOutlined,
    CheckCircleOutlined,
    FileTextOutlined,
    PieChartOutlined,
    RiseOutlined,
    TeamOutlined
} from '@ant-design/icons'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import { collection, documentId, getDocs, query, where } from 'firebase/firestore'
import dayjs from 'dayjs'
import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { useColorMode } from '@/contexts/ThemeContext'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { listenToProposals } from '@/services/proposalService'
import { PROPOSAL_STAGE_GROUPS } from '@/types/proposal'
import type { Proposal } from '@/types/proposal'

/*
  Director analytics on one page: four headline numbers and four charts.
  Applications, participants and assigned interventions are loaded once for the
  active programme and feed every chart; proposals stream from the pipeline.
*/

type AppDoc = {
    id: string
    participantId?: string
    ageGroup?: string
    interventions?: { required?: Array<{ area?: string }> }
}

type ParticipantDoc = {
    id: string
    sector?: string
    gender?: string
    beeLevel?: string
}

type AssignedDoc = {
    id: string
    participantId?: string
    beneficiaryId?: string
    interventionId?: string
    areaOfSupport?: string
    status?: string
    assignmentStatus?: string
    assigneeCompletionStatus?: string
    completedAt?: any
    updatedAt?: any
    dueDate?: any
    createdAt?: any
}

type MixDimension = 'sector' | 'gender' | 'age' | 'bee'

// Support departments that do not deliver interventions to beneficiaries.
const EXCLUDED_DEPARTMENTS = ['ihf', 'm&e', 'stakeholder', 'hrm']
const IN_QUERY_LIMIT = 30
const MIX_TOP_N = 6

// Series colours, stepped per mode (validated reference palette, slot 1) plus
// a recessive neutral for the "required" context series.
const SERIES = {
    light: { primary: '#2a78d6', context: '#cfcdc6', exceeded: '#059669' },
    dark: { primary: '#3987e5', context: '#4a4945', exceeded: '#10b981' }
}

const clean = (value?: string) => String(value || '').replace(/\s+/g, ' ').trim()
const lower = (value?: string) => clean(value).toLowerCase()

const isExcludedDepartment = (name: string) =>
    EXCLUDED_DEPARTMENTS.some(part => name.toLowerCase().includes(part))

const chunk = <T,>(items: T[], size: number) => {
    const out: T[][] = []
    for (let index = 0; index < items.length; index += size) out.push(items.slice(index, index + size))
    return out
}

const toDate = (value: any): Date | null => {
    if (!value) return null
    if (typeof value.toDate === 'function') return value.toDate()
    if (typeof value.seconds === 'number') return new Date(value.seconds * 1000)
    if (value instanceof Date) return value
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
}

// The status fields differ between older and newer intervention records.
const isCompleted = (row: AssignedDoc) => {
    const status = lower(row.status)
    const completion = lower(row.assigneeCompletionStatus)
    return ['completed', 'done', 'approved'].includes(status) ||
        lower(row.assignmentStatus) === 'completed' ||
        completion.includes('done') ||
        completion.includes('complete')
}

const rand = (value: number) => {
    if (value >= 1_000_000) return `R${(value / 1_000_000).toFixed(1)}m`
    if (value >= 1_000) return `R${Math.round(value / 1_000)}k`
    return `R${Math.round(value)}`
}

const randFull = (value: number) =>
    new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 })
        .format(value)

/** Count values, keeping the largest groups and folding the rest into "Other". */
const topWithOther = (values: string[], topN: number) => {
    const counts = new Map<string, number>()
    values.forEach(value => {
        const key = clean(value) || 'Unspecified'
        counts.set(key, (counts.get(key) || 0) + 1)
    })
    const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1])
    if (sorted.length <= topN + 1) return sorted
    const rest = sorted.slice(topN).reduce((total, [, count]) => total + count, 0)
    return [...sorted.slice(0, topN), ['Other', rest] as [string, number]]
}

const ChartEmpty = ({ description }: { description: string }) => (
    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={description}
        style={{ padding: '48px 0' }} />
)

export default function DirectorReports() {
    const { user } = useFullIdentity()
    const { activeProgramId } = useActiveProgramId()
    const { mode } = useColorMode()
    const colors = SERIES[mode]

    const [loading, setLoading] = useState(true)
    const [loadError, setLoadError] = useState<string | null>(null)
    const [apps, setApps] = useState<AppDoc[]>([])
    const [participants, setParticipants] = useState<ParticipantDoc[]>([])
    const [assigned, setAssigned] = useState<AssignedDoc[]>([])
    const [proposals, setProposals] = useState<Proposal[]>([])
    const [proposalsLoading, setProposalsLoading] = useState(true)
    const [mixDimension, setMixDimension] = useState<MixDimension>('sector')

    useEffect(() => {
        let cancelled = false
            ; (async () => {
                setLoading(true)
                setLoadError(null)
                try {
                    const appsSnap = await getDocs(query(
                        collection(db, 'applications'),
                        where('applicationStatus', 'in', ['accepted', 'Accepted']),
                        ...(activeProgramId ? [where('programId', '==', activeProgramId)] : [])
                    ))
                    const appRows = appsSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as AppDoc[]
                    const participantIds = Array.from(new Set(
                        appRows.map(app => app.participantId).filter(Boolean) as string[]
                    ))

                    const participantRows: ParticipantDoc[] = []
                    for (const ids of chunk(participantIds, IN_QUERY_LIMIT)) {
                        const snap = await getDocs(query(collection(db, 'participants'), where(documentId(), 'in', ids)))
                        snap.forEach(d => participantRows.push({ id: d.id, ...(d.data() as any) }))
                    }

                    const allowed = new Set(participantIds)
                    const assignedSnap = await getDocs(collection(db, 'assignedInterventions'))
                    let assignedRows = assignedSnap.docs
                        .map(d => ({ id: d.id, ...(d.data() as any) }) as AssignedDoc)
                        .filter(row => allowed.has(String(row.participantId || row.beneficiaryId || '')))

                    // Older assignments carry only an interventionId; take the department from it.
                    const missingIds = Array.from(new Set(assignedRows
                        .filter(row => !row.areaOfSupport && row.interventionId)
                        .map(row => row.interventionId as string)))
                    if (missingIds.length) {
                        const areaById = new Map<string, string>()
                        for (const ids of chunk(missingIds, IN_QUERY_LIMIT)) {
                            const snap = await getDocs(query(collection(db, 'interventions'), where(documentId(), 'in', ids)))
                            snap.forEach(d => {
                                const data = d.data() as any
                                areaById.set(d.id, data.areaOfSupport || data.department || '')
                            })
                        }
                        assignedRows = assignedRows.map(row => row.areaOfSupport || !row.interventionId
                            ? row
                            : { ...row, areaOfSupport: areaById.get(row.interventionId) })
                    }

                    if (cancelled) return
                    setApps(appRows)
                    setParticipants(participantRows)
                    setAssigned(assignedRows)
                } catch (error: any) {
                    console.error('[DirectorReports] Load failed', error)
                    if (!cancelled) setLoadError(error?.message || 'Analytics could not be loaded.')
                } finally {
                    if (!cancelled) setLoading(false)
                }
            })()
        return () => { cancelled = true }
    }, [activeProgramId])

    useEffect(() => {
        if (!user?.id) return
        setProposalsLoading(true)
        return listenToProposals(
            { id: user.id, name: user.name || 'Director', role: lower(user.role) },
            records => {
                setProposals(records)
                setProposalsLoading(false)
            },
            error => {
                console.error('[DirectorReports] Proposals failed', error)
                setProposalsLoading(false)
            }
        )
    }, [user?.id, user?.role, user?.name])

    // ---- 1. Delivery by department: required vs completed ----
    const delivery = useMemo(() => {
        const rows = new Map<string, { name: string; required: number; completed: number }>()
        const bump = (area: string | undefined, field: 'required' | 'completed') => {
            const name = clean(area) || 'Other'
            if (isExcludedDepartment(name)) return
            const key = name.toLowerCase()
            const row = rows.get(key) || { name, required: 0, completed: 0 }
            row[field] += 1
            rows.set(key, row)
        }
        apps.forEach(app => (app.interventions?.required || []).forEach(item => bump(item?.area, 'required')))

        // A recurring intervention (e.g. delivered monthly) gets a fresh assignedInterventions
        // row each cycle, so one required item can otherwise be counted as completed a dozen
        // times over a year. Count each participant+intervention pairing at most once instead.
        const completedOnce = new Set<string>()
        assigned.filter(isCompleted).forEach(row => {
            const participant = row.participantId || row.beneficiaryId || ''
            const identity = row.interventionId || row.areaOfSupport || ''
            if (!participant || !identity) return
            const key = `${participant}::${identity}`
            if (completedOnce.has(key)) return
            completedOnce.add(key)
            bump(row.areaOfSupport, 'completed')
        })

        const list = Array.from(rows.values())
            // Largest outstanding gap first, so the problems sit at the top.
            .sort((a, b) => (b.required - b.completed) - (a.required - a.completed) || b.required - a.required)
        const required = list.reduce((total, row) => total + row.required, 0)
        // Completions beyond what a department was required to deliver do not raise the rate.
        const completedTowardsRequired = list.reduce((total, row) => total + Math.min(row.completed, row.required), 0)
        return {
            list,
            required,
            completed: list.reduce((total, row) => total + row.completed, 0),
            rate: required ? Math.round((completedTowardsRequired / required) * 100) : null
        }
    }, [apps, assigned])

    // ---- 2. Delivery trend: completions over the last 12 months ----
    const trend = useMemo(() => {
        const months = Array.from({ length: 12 }, (_, index) => dayjs().startOf('month').subtract(11 - index, 'month'))
        const counts = months.map(() => 0)
        assigned.filter(isCompleted).forEach(row => {
            const date = toDate(row.completedAt) || toDate(row.updatedAt) || toDate(row.dueDate) || toDate(row.createdAt)
            if (!date) return
            const index = months.findIndex(month => dayjs(date).isSame(month, 'month'))
            if (index >= 0) counts[index] += 1
        })
        return { categories: months.map(month => month.format('MMM YY')), counts }
    }, [assigned])

    // ---- 3. Who we reach ----
    const mix = useMemo(() => {
        const values = mixDimension === 'age'
            ? apps.map(app => app.ageGroup || '')
            : participants.map(participant =>
                mixDimension === 'sector' ? participant.sector || ''
                    : mixDimension === 'gender' ? participant.gender || ''
                        : participant.beeLevel || '')
        return topWithOther(values, MIX_TOP_N)
    }, [apps, participants, mixDimension])

    const sectorLeader = useMemo(() => {
        const [top] = topWithOther(participants.map(participant => participant.sector || ''), Number.MAX_SAFE_INTEGER)
            .filter(([name]) => name !== 'Unspecified')
        return top && participants.length
            ? { name: top[0], share: Math.round((top[1] / participants.length) * 100) }
            : null
    }, [participants])

    // ---- 4. Proposal pipeline by stage ----
    const pipeline = useMemo(() => {
        const stages = PROPOSAL_STAGE_GROUPS.map(stage => {
            const records = proposals.filter(item => stage.statuses.includes(item.status))
            return {
                label: stage.label,
                count: records.length,
                value: records.reduce((total, item) => total + Number(item.estimatedValue || 0), 0)
            }
        })
        const open = proposals.filter(item => !['Active', 'Rejected', 'Archived'].includes(item.status))
        return {
            stages,
            openCount: open.length,
            openValue: open.reduce((total, item) => total + Number(item.estimatedValue || 0), 0)
        }
    }, [proposals])

    const activeBeneficiaries = useMemo(
        () => new Set(apps.map(app => app.participantId || app.id)).size,
        [apps]
    )

    // ---- chart options ----
    const barBase: Highcharts.Options = {
        chart: { type: 'bar', spacing: [8, 8, 8, 0] },
        title: { text: undefined },
        credits: { enabled: false },
        exporting: { enabled: false },
        yAxis: { min: 0, allowDecimals: false, title: { text: undefined }, gridLineDashStyle: 'Dot' },
        plotOptions: {
            bar: { borderRadius: 4, borderWidth: 0, pointPadding: 0.08, groupPadding: 0.14 }
        }
    }

    const deliveryOptions: Highcharts.Options = {
        ...barBase,
        chart: { ...barBase.chart, height: Math.max(240, delivery.list.length * 52 + 70) },
        xAxis: { categories: delivery.list.map(row => row.name), lineWidth: 0 },
        legend: { enabled: true, align: 'right', verticalAlign: 'top', floating: false },
        tooltip: {
            shared: true,
            formatter() {
                const row = delivery.list[this.points?.[0]?.index ?? this.index ?? 0]
                if (!row) return false
                const pct = row.required ? Math.round((row.completed / row.required) * 100) : 0
                const exceeded = row.required > 0 && row.completed > row.required
                return `<b>${row.name}</b><br/>Completed ${row.completed} of ${row.required} required` +
                    (row.required ? ` (${pct}%${exceeded ? ' — target exceeded' : ''})` : '')
            }
        },
        series: [
            { type: 'bar', name: 'Required', color: colors.context, data: delivery.list.map(row => row.required) },
            {
                type: 'bar', name: 'Completed',
                data: delivery.list.map(row => ({
                    y: row.completed,
                    color: row.required > 0 && row.completed > row.required ? colors.exceeded : colors.primary
                })),
                dataLabels: {
                    enabled: true,
                    formatter() {
                        const row = delivery.list[this.index]
                        return row?.required ? `${Math.round((row.completed / row.required) * 100)}%` : ''
                    }
                }
            }
        ]
    }

    const trendOptions: Highcharts.Options = {
        chart: { type: 'areaspline', height: 300, spacing: [8, 8, 8, 0] },
        title: { text: undefined },
        credits: { enabled: false },
        exporting: { enabled: false },
        legend: { enabled: false },
        xAxis: { categories: trend.categories, crosshair: { width: 1 }, tickInterval: 2 },
        yAxis: { min: 0, allowDecimals: false, title: { text: undefined }, gridLineDashStyle: 'Dot' },
        tooltip: { pointFormat: '<b>{point.y}</b> completed' },
        plotOptions: {
            areaspline: {
                lineWidth: 2,
                color: colors.primary,
                fillColor: {
                    linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
                    stops: [
                        [0, Highcharts.color(colors.primary).setOpacity(0.22).get('rgba') as string],
                        [1, Highcharts.color(colors.primary).setOpacity(0).get('rgba') as string]
                    ]
                },
                marker: { enabled: true, radius: 3, states: { hover: { enabled: true } } },
                dataLabels: {
                    enabled: true,
                    format: '{y}',
                    y: -8,
                    style: { fontSize: '10px', fontWeight: '600', textOutline: 'none' }
                }
            }
        },
        series: [{ type: 'areaspline', name: 'Completed interventions', data: trend.counts }]
    }

    const mixOptions: Highcharts.Options = {
        ...barBase,
        chart: { ...barBase.chart, height: Math.max(220, mix.length * 40 + 50) },
        legend: { enabled: false },
        xAxis: { categories: mix.map(([name]) => name), lineWidth: 0 },
        tooltip: { pointFormat: '<b>{point.y}</b> beneficiaries' },
        series: [{
            type: 'bar', name: 'Beneficiaries', color: colors.primary,
            data: mix.map(([, count]) => count),
            dataLabels: { enabled: true }
        }]
    }

    const pipelineOptions: Highcharts.Options = {
        ...barBase,
        chart: { ...barBase.chart, height: 260 },
        legend: { enabled: false },
        xAxis: { categories: pipeline.stages.map(stage => stage.label), lineWidth: 0 },
        yAxis: { ...(barBase.yAxis as Highcharts.YAxisOptions), allowDecimals: true, labels: { formatter() { return rand(Number(this.value)) } } },
        tooltip: {
            formatter() {
                const stage = pipeline.stages[this.index]
                return `<b>${stage.label}</b><br/>${randFull(stage.value)} · ${stage.count} proposal${stage.count === 1 ? '' : 's'}`
            }
        },
        series: [{
            type: 'bar', name: 'Pipeline value', color: colors.primary,
            data: pipeline.stages.map(stage => stage.value),
            dataLabels: { enabled: true, formatter() { return this.y ? rand(Number(this.y)) : '' } }
        }]
    }

    const mixLabel: Record<MixDimension, string> = {
        sector: 'sector', gender: 'gender', age: 'age group', bee: 'B-BBEE level'
    }

    return (
        <div style={{ padding: '5px 24px' }}>
            <Helmet>
                <title>Analytics & Overview</title>
            </Helmet>

            {loadError && <Alert type='error' showIcon closable message='Some analytics could not be loaded'
                description={loadError} style={{ marginBottom: 16 }} />}

            <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                <Col xs={24} sm={12} xl={6}>
                    <MotionCard.Metric loading={loading}
                        title='Active beneficiaries' value={activeBeneficiaries}
                        subtitle='Accepted into the programme'
                        icon={<TeamOutlined style={{ color: '#2563eb' }} />} iconBg='rgba(37,99,235,.12)' />
                </Col>
                <Col xs={24} sm={12} xl={6}>
                    <MotionCard.Metric loading={loading}
                        title='Interventions delivered'
                        value={delivery.rate === null ? '—' : `${delivery.rate}%`}
                        subtitle={delivery.required
                            ? `Of ${delivery.required} required interventions`
                            : 'No required interventions recorded'}
                        icon={<CheckCircleOutlined style={{ color: '#059669' }} />} iconBg='rgba(5,150,105,.12)' />
                </Col>
                <Col xs={24} sm={12} xl={6}>
                    <MotionCard.Metric loading={proposalsLoading}
                        title='Open pipeline' value={randFull(pipeline.openValue)}
                        subtitle={`${pipeline.openCount} open proposal${pipeline.openCount === 1 ? '' : 's'}`}
                        icon={<FileTextOutlined style={{ color: '#7c3aed' }} />} iconBg='rgba(124,58,237,.12)' />
                </Col>
                <Col xs={24} sm={12} xl={6}>
                    <MotionCard.Metric loading={loading}
                        title='Largest sector' value={sectorLeader?.name || '—'}
                        subtitle={sectorLeader ? `${sectorLeader.share}% of beneficiaries` : 'No sector data yet'}
                        icon={<PieChartOutlined style={{ color: '#d97706' }} />} iconBg='rgba(217,119,6,.12)' />
                </Col>
            </Row>

            <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                <Col xs={24} xl={15}>
                    <MotionCard loading={loading} skeletonRows={8} style={{ height: '100%' }}
                        title={<span><BarChartOutlined /> Delivery by department</span>}
                        extra={<span style={{ fontSize: 12, opacity: 0.7 }}>Largest gap first</span>}>
                        {delivery.list.length
                            ? <HighchartsReact highcharts={Highcharts} options={deliveryOptions} />
                            : <ChartEmpty description='No required or completed interventions yet' />}
                    </MotionCard>
                </Col>
                <Col xs={24} xl={9}>
                    <MotionCard loading={loading} skeletonRows={8} style={{ height: '100%' }}
                        title={<span><RiseOutlined /> Delivery trend</span>}
                        extra={<span style={{ fontSize: 12, opacity: 0.7 }}>Completed, last 12 months</span>}>
                        {trend.counts.some(Boolean)
                            ? <HighchartsReact highcharts={Highcharts} options={trendOptions} />
                            : <ChartEmpty description='No completed interventions in the last 12 months' />}
                    </MotionCard>
                </Col>
            </Row>

            <Row gutter={[16, 16]}>
                <Col xs={24} xl={12}>
                    <MotionCard loading={loading} skeletonRows={7} style={{ height: '100%' }}
                        title={<span><TeamOutlined /> Who we reach</span>}
                        extra={<Segmented<MixDimension> size='small' value={mixDimension}
                            onChange={value => setMixDimension(value as MixDimension)}
                            options={[
                                { label: 'Sector', value: 'sector' },
                                { label: 'Gender', value: 'gender' },
                                { label: 'Age', value: 'age' },
                                { label: 'B-BBEE', value: 'bee' }
                            ]} />}>
                        {mix.length
                            ? <HighchartsReact highcharts={Highcharts} options={mixOptions} />
                            : <ChartEmpty description={`No ${mixLabel[mixDimension]} data yet`} />}
                    </MotionCard>
                </Col>
                <Col xs={24} xl={12}>
                    <MotionCard loading={proposalsLoading} skeletonRows={7} style={{ height: '100%' }}
                        title={<span><FileTextOutlined /> Proposal pipeline</span>}
                        extra={<span style={{ fontSize: 12, opacity: 0.7 }}>Value by stage</span>}>
                        {proposals.length
                            ? <HighchartsReact highcharts={Highcharts} options={pipelineOptions} />
                            : <ChartEmpty description='No proposals in the pipeline' />}
                    </MotionCard>
                </Col>
            </Row>
        </div>
    )
}
