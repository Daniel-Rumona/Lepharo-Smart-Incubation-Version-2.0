// src/components/dashboards/director/charts/SectorAnalysis.tsx
import React, { useEffect, useMemo, useState } from 'react'
import { Card, Row, Col, message, Empty, Spin, Statistic } from 'antd'
import { PieChartOutlined, RiseOutlined, FundOutlined } from '@ant-design/icons'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import drilldown from 'highcharts/modules/drilldown'
import {
    collection,
    getDocs,
    query,
    where,
    documentId
} from 'firebase/firestore'
import { getAuth } from 'firebase/auth'
import { db } from '@/firebase'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { MotionCard } from '../../metrics/Header'
import { LoadingOverlay } from '@/components/shared/LoadingOverlay'

if (typeof drilldown === 'function') drilldown(Highcharts)

type Participant = {
    id: string
    sector?: string
    beneficiaryName?: string
    businessName?: string
    participantName?: string
    applicantName?: string
}

type ApplicationDoc = {
    id: string
    participantId?: string
    applicationStatus?: string
    programId?: string
}

type AI = {
    id: string
    participantId?: string
    beneficiaryId?: string
    status?: string
    assigneeCompletionStatus?: string
    dueDate?: any
    createdAt?: any
}

const MONTHS = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec'
]

const tsToDate = (ts: any): Date | null => {
    if (!ts) return null
    if (typeof ts?.toDate === 'function') return ts.toDate()
    if (ts instanceof Date) return ts
    if (typeof ts === 'string' || typeof ts === 'number') {
        const d = new Date(ts)
        return Number.isNaN(d.getTime()) ? null : d
    }
    return null
}

const nameOf = (p: Partial<Participant>) =>
    p.beneficiaryName ||
    p.businessName ||
    p.participantName ||
    p.applicantName ||
    'Incubatee'

const batchIds = <T extends string>(ids: T[], size = 10): T[][] => {
    const out: T[][] = []
    for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size))
    return out
}

const isCompleted = (ai: AI) => {
    const s = String(ai.assignmentStatus || '').toLowerCase()
    const cc = String(ai.assigneeCompletionStatus || '').toLowerCase()
    return s === 'completed' || cc.includes('done') || cc.includes('complete')
}

const SectorAnalysis: React.FC = () => {
    const [loading, setLoading] = useState(true)
    // ---- state ----
    const [applications, setApplications] = useState<
        ApplicationDoc[] | undefined
    >(undefined)
    const [participants, setParticipants] = useState<Participant[] | undefined>(
        undefined
    )
    const [ais, setAis] = useState<AI[] | undefined>(undefined)

    // Derived gate
    const programId = useActiveProgramId()
    const appsReady = applications !== undefined
    const participantsReady = participants !== undefined
    const aisReady = ais !== undefined
    const allReady = !!programId && appsReady && participantsReady && aisReady


    // 1) Load accepted applications for active program
    useEffect(() => {
        if (!programId) return
            ; (async () => {
                try {
                    const appsSnap = await getDocs(
                        query(
                            collection(db, 'applications'),
                            where('programId', '==', programId),
                            where('applicationStatus', 'in', ['accepted', 'Accepted'])
                        )
                    )
                    setApplications(
                        appsSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
                    )
                } catch (e) {
                    console.error(e)
                    message.error('Failed to load applications.')
                    setApplications([]) // mark ready even on error
                }
            })()
    }, [programId])

    // 3) From those applications, fetch participants by participantId
    useEffect(() => {
        if (!applications) return // wait until apps set (even if empty)
            ; (async () => {
                try {
                    const pids = Array.from(
                        new Set(
                            applications.map(a => a.participantId).filter(Boolean) as string[]
                        )
                    )
                    if (!pids.length) {
                        setParticipants([])
                        return
                    }

                    const chunks = batchIds(pids, 10)
                    const partDocs: Participant[] = []
                    for (const chunk of chunks) {
                        const snap = await getDocs(
                            query(
                                collection(db, 'participants'),
                                where(documentId(), 'in', chunk)
                            )
                        )
                        partDocs.push(
                            ...snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
                        )
                    }
                    setParticipants(partDocs)
                } catch (e) {
                    console.error(e)
                    message.error('Failed to load participants.')
                    setParticipants([]) // mark ready on error
                }
            })()
    }, [applications])

    // 4) Load assignedInterventions for the company and filter to our participantIds
    useEffect(() => {
        if (!applications) return
            ; (async () => {
                try {
                    const aiSnap = await getDocs(
                        query(
                            collection(db, 'assignedInterventions'),
                        )
                    )
                    const aiList: AI[] = aiSnap.docs.map(d => ({
                        id: d.id,
                        ...(d.data() as any)
                    }))
                    const allowed = new Set(
                        applications.map(a => a.participantId).filter(Boolean) as string[]
                    )
                    setAis(
                        aiList.filter(ai => {
                            const pid = ai.participantId || ai.beneficiaryId
                            return pid && allowed.has(pid)
                        })
                    )
                } catch (e) {
                    console.error(e)
                    message.error('Failed to load interventions.')
                    setAis([]) // mark ready on error
                }
            })()
    }, [applications])

    // Quick lookups
    const pidToSector = useMemo(() => {
        const m = new Map<string, string>()
        if (!participants) return m
        participants.forEach(p => {
            const sector = (p.sector || 'Unspecified').trim() || 'Unspecified'
            m.set(p.id, sector)
        })
        return m
    }, [participants])

    // Aggregations
    const sectorCounts = useMemo(() => {
        const counts = new Map<string, number>()
            ; (participants ?? []).forEach(p => {
                const s = (p.sector || 'Unspecified').trim() || 'Unspecified'
                counts.set(s, (counts.get(s) || 0) + 1)
            })
        return counts
    }, [participants])

    const currentYear = new Date().getFullYear()

    // Completed interventions per sector (current year)
    const completedPerSector = useMemo(() => {
        const m = new Map<string, number>()
        if (!ais) return m // ✅ guard against undefined before looping

        for (const ai of ais) {
            if (!isCompleted(ai)) continue
            const pid = ai.participantId || ai.beneficiaryId
            if (!pid) continue
            const d = tsToDate(ai.dueDate) || tsToDate(ai.createdAt)
            if (!d || d.getFullYear() !== currentYear) continue
            const sector = pidToSector.get(pid) || 'Unspecified'
            m.set(sector, (m.get(sector) || 0) + 1)
        }

        return m
    }, [ais, pidToSector, currentYear])

    // Drilldown: sector -> incubatees by completed
    const drilldownSeries = useMemo(() => {
        const perPid = new Map<string, number>()
        for (const ai of safeArr(ais)) {
            // ✅ guard
            if (!isCompleted(ai)) continue
            const pid = ai.participantId || ai.beneficiaryId
            if (!pid) continue
            const d = tsToDate(ai.dueDate) || tsToDate(ai.createdAt)
            if (!d || d.getFullYear() !== currentYear) continue
            perPid.set(pid, (perPid.get(pid) || 0) + 1)
        }

        const sectorToRows = new Map<string, Array<[string, number]>>()
        safeArr(participants).forEach(p => {
            // ✅ guard
            const sector = (p.sector || 'Unspecified').trim() || 'Unspecified'
            const val = perPid.get(p.id) || 0
            if (val > 0) {
                const rows = sectorToRows.get(sector) || []
                rows.push([nameOf(p), val])
                sectorToRows.set(sector, rows)
            }
        })

        const series: Array<{ id: string; data: Array<[string, number]> }> = []
        sectorToRows.forEach((rows, sectorName) => {
            rows.sort((a, b) => b[1] - a[1])
            if (rows.length > 0) series.push({ id: sectorName, data: rows })
        })
        return series
    }, [participants, ais, currentYear])

    // Metrics
    const totalSectors = useMemo(() => sectorCounts.size, [sectorCounts])

    const bestSector = useMemo(() => {
        if (!completedPerSector.size) return '—'
        let best = '—'
        let bestVal = -1
        completedPerSector.forEach((v, k) => {
            if (v > bestVal) {
                bestVal = v
                best = k
            }
        })
        return best
    }, [completedPerSector])

    // Simple strategic suggestion:
    // If there is a clear best sector, recommend doubling down; if tie/none, recommend “Diversify Focus”.
    const strategicFocus = useMemo(() => {
        if (!completedPerSector.size) return 'Diversify Focus'
        const entries = Array.from(completedPerSector.entries()).sort(
            (a, b) => b[1] - a[1]
        )
        if (entries.length === 0) return 'Diversify Focus'
        const [top, second] = [entries[0], entries[1]]
        if (!second || top[1] > (second?.[1] ?? 0)) return `Strengthen ${top[0]}`
        return 'Diversify Focus'
    }, [completedPerSector])

    // Charts
    // 1) helper to build stable ids
    const sectorId = (s: string) =>
        s
            .toLowerCase()
            .trim()
            .replace(/\s+/g, '-')
            .replace(/[^a-z0-9\-]/g, '')

    function safeArr<T>(v: ReadonlyArray<T> | T[] | null | undefined): T[] {
        return Array.isArray(v) ? [...v] : []
    }

    // 2) build a map of sectorId -> rows (only >0 completions)
    const drilldownMap = useMemo(() => {
        const map = new Map<string, Array<[string, number]>>()
        drilldownSeries.forEach(s => {
            const id = sectorId(s.id)
            if (s.data && s.data.length > 0) map.set(id, s.data)
        })
        return map
    }, [drilldownSeries])

    // Monthly by sector (current year)
    const sectorMonthly = useMemo(() => {
        const m = new Map<string, number[]>()
        const ensure = (s: string) => {
            const key = s || 'Unspecified'
            if (!m.has(key)) m.set(key, Array(12).fill(0))
            return m.get(key)!
        }

        for (const ai of safeArr(ais)) {
            // ✅ guard
            if (!isCompleted(ai)) continue
            const pid = ai.participantId || ai.beneficiaryId
            if (!pid) continue
            const d = tsToDate(ai.dueDate) || tsToDate(ai.createdAt)
            if (!d || d.getFullYear() !== currentYear) continue
            const sector = pidToSector.get(pid) || 'Unspecified'
            const arr = ensure(sector)
            arr[d.getMonth()] += 1
        }
        return m
    }, [ais, pidToSector, currentYear])

    // 3) donut options: only attach `drilldown` when we have a series for it
    const donutOptions: Highcharts.Options = useMemo(() => {
        const data = Array.from(sectorCounts.entries()).map(([name, count]) => {
            const id = sectorId(name)
            const hasDrill = drilldownMap.has(id)
            return { name, y: count, ...(hasDrill ? { drilldown: id } : {}) }
        })

        return {
            chart: { type: 'pie' },
            title: { text: 'Participants per Sector' },
            plotOptions: { pie: { innerSize: '60%', dataLabels: { enabled: true } } },
            credits: { enabled: false },
            series: [{ name: 'Participants', colorByPoint: true, type: 'pie', data }],
            drilldown: {
                series: Array.from(drilldownMap.entries()).map(([id, rows]) => ({
                    id,
                    data: rows
                }))
            }
        }
    }, [sectorCounts, drilldownMap])

    const splineOptions: Highcharts.Options = useMemo(() => {
        // show top 5 sectors by participants for clarity
        const topSectors = Array.from(sectorCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([s]) => s)

        const series = topSectors.map(s => ({
            name: s,
            type: 'spline' as const,
            data: sectorMonthly.get(s) || Array(12).fill(0)
        }))

        return {
            chart: { type: 'spline' },
            title: {
                text: `Monthly Completed Interventions by Sector (${currentYear})`
            },
            xAxis: { categories: MONTHS },
            yAxis: { title: { text: 'Completed Interventions' }, min: 0 },
            credits: { enabled: false },
            series
        }
    }, [sectorCounts, sectorMonthly, currentYear])

    if (!allReady) {
        return (
            <div style={{ display: 'grid', placeItems: 'center', minHeight: 240 }}>
                <LoadingOverlay tip='Loading Sector Information' />
            </div>
        )
    }

    // Only now decide “no data”
    if ((applications?.length ?? 0) === 0 || (participants?.length ?? 0) === 0) {
        return <Empty description='No sector data found for the active program.' />
    }

    return (
        <div>
            {/* Metrics row */}
            <Row gutter={[16, 16]} style={{ marginBottom: 15 }}>
                <Col xs={24} md={8}>
                    <MotionCard style={{ borderRadius: 12, border: '1px solid #d6e4ff' }}>
                        <Statistic
                            title='Total Sectors'
                            value={totalSectors}
                            prefix={<PieChartOutlined />}
                        />
                    </MotionCard>
                </Col>
                <Col xs={24} md={8}>
                    <MotionCard style={{ borderRadius: 12, border: '1px solid #d6e4ff' }}>
                        <Statistic
                            title='Best Performing Sector'
                            value={bestSector}
                            prefix={<RiseOutlined />}
                            valueStyle={{ color: '#3f8600' }}
                        />
                    </MotionCard>
                </Col>
                <Col xs={24} md={8}>
                    <MotionCard style={{ borderRadius: 12, border: '1px solid #d6e4ff' }}>
                        <Statistic
                            title='Strategic Focus Recommendation'
                            value={strategicFocus}
                            prefix={<FundOutlined />}
                        />
                    </MotionCard>
                </Col>
            </Row>

            {/* Charts */}
            <Row gutter={16}>
                <Col span={12}>
                    <MotionCard
                        style={{
                            boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
                            transition: 'all 0.3s ease',
                            borderRadius: 12,
                            border: '1px solid #d6e4ff'
                        }}
                    >
                        <HighchartsReact highcharts={Highcharts} options={donutOptions} />
                    </MotionCard>
                </Col>
                <Col span={12}>
                    <MotionCard
                        style={{
                            boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
                            transition: 'all 0.3s ease',
                            borderRadius: 12,
                            border: '1px solid #d6e4ff'
                        }}
                    >
                        {Array.from(completedPerSector.values()).reduce(
                            (a, b) => a + b,
                            0
                        ) === 0 ? (
                            <Empty description='No completed interventions for this period.' />
                        ) : (
                            <HighchartsReact
                                highcharts={Highcharts}
                                options={splineOptions}
                            />
                        )}
                    </MotionCard>
                </Col>
            </Row>
        </div>
    )
}

export default SectorAnalysis
