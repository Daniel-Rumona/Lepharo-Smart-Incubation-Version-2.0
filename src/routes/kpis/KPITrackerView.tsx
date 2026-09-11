import React, { useEffect, useMemo, useState } from 'react'
import {
    Alert,
    Button,
    Col,
    DatePicker,
    Modal,
    Result,
    Row,
    Segmented,
    Select,
    Skeleton,
    Tag,
    theme,
    message
} from 'antd'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { computeKpi } from '@/services/kpiCalculationService'
import dayjs, { Dayjs } from 'dayjs'
import quarterOfYear from 'dayjs/plugin/quarterOfYear'
import { ExpandOutlined, LineChartOutlined, CheckCircleOutlined, AimOutlined, FilterOutlined } from '@ant-design/icons'
import { motion } from 'framer-motion'
import { DashboardFilterBar, MotionCard } from '@/components/dashboards/metrics/Header'

const { RangePicker } = DatePicker
const { Option } = Select

dayjs.extend(quarterOfYear)

type Unit = 'count' | 'ZAR' | 'percent' | 'text'
type SourceType = 'applications' | 'interventions' | 'metrics'
type CalculationType = 'count' | 'sum' | 'average' | 'ratio'
type CountMode = 'records' | 'distinct'
type TargetPeriodType = 'monthly' | 'quarterly'

type KpiFilter = {
    field: string
    op: '==' | '!=' | 'in'
    value: any
}

type RatioPartConfig = {
    calculationType: 'count_records' | 'sum_field' | 'avg_field'
    field?: string | null
    filters: KpiFilter[]
}

type KpiDef = {
    id: string
    department: string

    kpiLabel: string
    unit: Unit
    sourceType: SourceType
    calculationType: CalculationType
    countMode?: CountMode | null
    field?: string | null
    filters?: KpiFilter[]
    interventionIds?: string[]
    numerator?: RatioPartConfig | null
    denominator?: RatioPartConfig | null
    appliesToAllPrograms?: boolean
    programId?: string | null
    belongsToMe?: boolean
    contributorDepartmentIds?: string[]
    contributorDepartmentNames?: string[]
}

type LatestTarget = {
    target: number
    periodKey: string
    periodType: TargetPeriodType
}

type ComputedKpiResult = {
    kpiId: string
    actual: number
    target: number | null
    variance: number | null
    achievementPercent: number | null
    matchedCount: number
    periodType: 'monthly' | 'quarterly'
    periodKey: string
}

type MonthlyPoint = {
    periodKey: string
    achievement: number
}

type MonthlyKpiResults = {
    monthKey: string
    computed: Record<string, ComputedKpiResult>
}

const parsePeriodKeyToSortValue = (periodKey?: string | null) => {
    if (!periodKey) return 0
    if (periodKey.includes('-Q')) {
        const [y, qRaw] = periodKey.split('-Q')
        return Number(y) * 10 + Number(qRaw)
    }
    const [y, m] = periodKey.split('-')
    return Number(y) * 100 + Number(m)
}

const buildMonthKeys = (range: [Dayjs, Dayjs]) => {
    const start = range[0].startOf('month')
    const end = range[1].startOf('month')
    const keys: string[] = []
    let cursor = start.clone()

    while (cursor.isBefore(end) || cursor.isSame(end, 'month')) {
        keys.push(cursor.format('YYYY-MM'))
        cursor = cursor.add(1, 'month')
    }

    return keys
}

const KPITrackerView: React.FC = () => {
    const { user, loading: identityLoading } = useFullIdentity()
    const { activeProgramId, isAllPrograms } = useActiveProgramId()
    const { token } = theme.useToken()

    const [department, setDepartment] = useState<string>('')
    const [isMainDept, setIsMainDept] = useState(false)
    const [allDepartments, setAllDepartments] = useState<string[]>([])

    const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([
        dayjs().startOf('month'),
        dayjs().endOf('month')
    ])

    const [expandedChart, setExpandedChart] = useState<
        null | 'actualTarget' | 'achievement' | 'department' | 'monthlyComparison'
    >(null)

    const [defsByDept, setDefsByDept] = useState<Record<string, KpiDef[]>>({})
    const [latestTargetsByKpi, setLatestTargetsByKpi] = useState<Record<string, LatestTarget>>({})
    const [deptResults, setDeptResults] = useState<
        Record<string, Record<string, ComputedKpiResult>>
    >({})
    const [deptMonthlyTrends, setDeptMonthlyTrends] = useState<
        Record<string, MonthlyPoint[]>
    >({})
    const [deptMonthlyResults, setDeptMonthlyResults] = useState<
        Record<string, MonthlyKpiResults[]>
    >({})
    const [targetsByKpi, setTargetsByKpi] = useState<Record<string, LatestTarget[]>>({})
    const [selectedKpiIds, setSelectedKpiIds] = useState<string[]>([])
    const [comparisonView, setComparisonView] = useState<'performance' | 'actual'>('performance')

    const [loading, setLoading] = useState(false)
    const isDemoMode = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('demo') === '1'

    useEffect(() => {
        if (identityLoading || !user) return

            ; (async () => {
                try {
                    if (user.departmentId) {
                        const snap = await getDocs(collection(db, 'departments'))
                        const deptDoc = snap.docs.find(d => d.id === user.departmentId)
                        const dept = deptDoc?.data() as any

                        if (dept) {
                            const main = Boolean(dept.isMain)
                            setIsMainDept(main)
                            setDepartment(String(dept.name || '').trim())

                            if (main) {
                                setAllDepartments(
                                    snap.docs
                                        .map(d => String(d.data()?.name || '').trim())
                                        .filter(Boolean)
                                )
                            }
                            return
                        }
                    }

                    setDepartment(String(user.departmentName || '').trim())
                } catch (err) {
                    console.error(err)
                }
            })()
    }, [identityLoading, user])

    useEffect(() => {
        if (!user) return

            ; (async () => {
                try {
                    const defsSnap = await getDocs(collection(db, 'kpiDefinitions'))

                    const defs: KpiDef[] = defsSnap.docs.map(d => {
                        const data = d.data() as any
                        return {
                            id: d.id,
                            department: String(data.department || '').trim(),

                            kpiLabel: String(data.kpiLabel || d.id),
                            unit: (data.unit || 'count') as Unit,
                            sourceType: data.sourceType as SourceType,
                            calculationType: data.calculationType as CalculationType,
                            countMode: (data.countMode || 'records') as CountMode,
                            field: data.field || null,
                            filters: Array.isArray(data.filters) ? data.filters : [],
                            interventionIds: Array.isArray(data.interventionIds) ? data.interventionIds : [],
                            numerator: data.numerator || null,
                            denominator: data.denominator || null,
                            appliesToAllPrograms: !!data.appliesToAllPrograms,
                            programId: data.programId || null,
                            // Definitions created before shared KPIs did not carry
                            // this flag. They remain department KPIs by default.
                            belongsToMe: data.belongsToMe !== false,
                            contributorDepartmentIds: Array.isArray(data.contributorDepartmentIds) ? data.contributorDepartmentIds : [],
                            contributorDepartmentNames: Array.isArray(data.contributorDepartmentNames) ? data.contributorDepartmentNames : []
                        }
                    })

                    const grouped: Record<string, KpiDef[]> = {}
                    defs.forEach(def => {
                        if (!def.department) return
                        if (!grouped[def.department]) grouped[def.department] = []
                        grouped[def.department].push(def)
                    })

                    setDefsByDept(grouped)

                    if (!allDepartments.length) {
                        setAllDepartments(Object.keys(grouped).sort())
                    }

                    const targetSnap = await getDocs(collection(db, 'kpiTargets'))

                    const targets = targetSnap.docs.map(d => ({ id: d.id, ...(d.data() as any) }))

                    const latest: Record<string, LatestTarget> = {}
                    const byKpi: Record<string, LatestTarget[]> = {}
                    for (const row of targets) {
                        const target = {
                            target: Number(row.target || 0),
                            periodKey: row.periodKey,
                            periodType: row.periodType as TargetPeriodType
                        }
                        if (!byKpi[row.kpiId]) byKpi[row.kpiId] = []
                        byKpi[row.kpiId].push(target)
                        const existing = latest[row.kpiId]
                        const nextSort = parsePeriodKeyToSortValue(row.periodKey)
                        const existingSort = existing ? parsePeriodKeyToSortValue(existing.periodKey) : -1

                        if (!existing || nextSort > existingSort) {
                            latest[row.kpiId] = target
                        }
                    }

                    setLatestTargetsByKpi(latest)
                    setTargetsByKpi(byKpi)
                } catch (err) {
                    console.error(err)
                    message.error('Failed to load KPI definitions and targets.')
                }
            })()
    }, [])

    const monthKeys = useMemo(() => buildMonthKeys(dateRange), [dateRange])

    const targetForMonth = (kpiId: string, monthKey: string) => {
        const rows = targetsByKpi[kpiId] || []
        const quarterlyKey = `${dayjs(monthKey).year()}-Q${dayjs(monthKey).quarter()}`

        return rows.find(row => row.periodType === 'monthly' && row.periodKey === monthKey)
            || rows.find(row => row.periodType === 'quarterly' && row.periodKey === quarterlyKey)
            || null
    }

    const computeDepartmentKpis = async (defs: KpiDef[], monthKey: string) => {
        const entries = await Promise.all(
            defs.map(async def => {
                try {
                    const targetInfo = targetForMonth(def.id, monthKey)

                    const result = await computeKpi({
                        kpi: {
                            id: def.id,
                            sourceType: def.sourceType,
                            calculationType: def.calculationType,
                            field: def.field || null,
                            filters: def.filters || [],
                            interventionIds: def.interventionIds || [],
                            numerator: def.numerator || null,
                            denominator: def.denominator || null,
                            countMode: (def.countMode || 'records') as CountMode,
                            appliesToAllPrograms: !!def.appliesToAllPrograms
                        },
                        programId: def.appliesToAllPrograms ? null : activeProgramId,
                        isAllPrograms: !!def.appliesToAllPrograms || isAllPrograms,
                        periodType: 'monthly',
                        periodKey: monthKey,
                        target: targetInfo?.target ?? null
                    })

                    return [def.id, result] as const
                } catch (err) {
                    console.error(`Failed to compute KPI: ${def.kpiLabel}`, err)
                    return [
                        def.id,
                        {
                            kpiId: def.id,
                            actual: 0,
                            target: targetForMonth(def.id, monthKey)?.target ?? null,
                            variance: null,
                            achievementPercent: null,
                            matchedCount: 0,
                            periodType: 'monthly' as const,
                            periodKey: monthKey
                        }
                    ] as const
                }
            })
        )

        return Object.fromEntries(entries)
    }

    useEffect(() => {
        if (!department || !Object.keys(defsByDept).length) return
        if (!monthKeys.length) return

            ; (async () => {
                setLoading(true)
                try {
                    const nextResults: Record<string, Record<string, ComputedKpiResult>> = {}
                    const nextTrends: Record<string, MonthlyPoint[]> = {}
                    const nextMonthlyResults: Record<string, MonthlyKpiResults[]> = {}

                    const deptsToRun = isMainDept
                        ? (allDepartments.length ? allDepartments : [department]).filter(d => defsByDept[d]?.length)
                        : [department].filter(Boolean)

                    for (const deptName of deptsToRun) {
                        const defs = defsByDept[deptName] || []
                        if (!defs.length) continue

                        const monthlyResults = await Promise.all(
                            monthKeys.map(async monthKey => {
                                const computed = await computeDepartmentKpis(defs, monthKey)
                                return { monthKey, computed }
                            })
                        )

                        const latestMonth = monthlyResults[monthlyResults.length - 1]
                        nextResults[deptName] = latestMonth?.computed || {}
                        nextMonthlyResults[deptName] = monthlyResults

                        nextTrends[deptName] = monthlyResults.map(row => {
                            const eligible = defs
                                .map(def => Number(row.computed[def.id]?.achievementPercent))
                                .filter(value => Number.isFinite(value))

                            return {
                                periodKey: row.monthKey,
                                achievement: eligible.length
                                    ? Math.round(eligible.reduce((sum, value) => sum + value, 0) / eligible.length)
                                    : 0
                            }
                        })
                    }

                    setDeptResults(nextResults)
                    setDeptMonthlyTrends(nextTrends)
                    setDeptMonthlyResults(nextMonthlyResults)
                } catch (err) {
                    console.error(err)
                    message.error('Failed to compute KPI results.')
                } finally {
                    setLoading(false)
                }
            })()
    }, [
        department,
        isMainDept,
        allDepartments,
        defsByDept,
        targetsByKpi,
        activeProgramId,
        isAllPrograms,
        monthKeys
    ])

    const visibleDepts = isMainDept
        ? (allDepartments.length ? allDepartments : [department]).filter(d => defsByDept[d]?.length)
        : [department].filter(Boolean)

    const deptCards = visibleDepts.map(depName => {
        const defs = defsByDept[depName] || []
        const results = deptResults[depName] || {}

        const totalKPIs = defs.length

        const achieved = defs.filter(def => {
            const r = results[def.id]
            if (!r || r.target == null || r.target === 0) return false
            return Number(r.actual || 0) >= Number(r.target || 0)
        }).length

        const onTrack = defs.filter(def => {
            const r = results[def.id]
            if (!r || r.target == null || r.target === 0) return false
            return Number(r.actual || 0) >= 0.8 * Number(r.target || 0)
        }).length

        const avgPct =
            totalKPIs === 0
                ? 0
                : Math.round(
                    (defs.reduce((sum, def) => {
                        const r = results[def.id]
                        if (!r || r.target == null || r.target === 0) return sum
                        return sum + Math.min(Number(r.actual || 0) / Number(r.target || 1), 1)
                    }, 0) /
                        totalKPIs) *
                    100
                )

        return { depName, totalKPIs, achieved, onTrack, avgPct }
    })

    const currentDefs = defsByDept[department] || []
    const currentResults = deptResults[department] || {}
    const currentTrend = deptMonthlyTrends[department] || []
    const currentMonthlyResults = deptMonthlyResults[department] || []

    const demoPreview = useMemo(() => {
        const defs: KpiDef[] = [
            { id: 'demo-onboarded', department: 'Operations', kpiLabel: 'Number of SMMEs Onboarded', unit: 'count', sourceType: 'applications', calculationType: 'count' },
            { id: 'demo-plan', department: 'Operations', kpiLabel: 'Development Plan Completion', unit: 'percent', sourceType: 'interventions', calculationType: 'ratio' },
            { id: 'demo-compliance', department: 'Operations', kpiLabel: 'Compliance Group Progression', unit: 'percent', sourceType: 'metrics', calculationType: 'ratio' },
            { id: 'demo-jobs', department: 'Operations', kpiLabel: 'Jobs Created', unit: 'count', sourceType: 'metrics', calculationType: 'count' }
        ]
        const results: Record<string, ComputedKpiResult> = {
            'demo-onboarded': { kpiId: 'demo-onboarded', actual: 47, target: 50, variance: -3, achievementPercent: 94, matchedCount: 47, periodType: 'monthly', periodKey: dayjs().format('YYYY-MM') },
            'demo-plan': { kpiId: 'demo-plan', actual: 86, target: 100, variance: -14, achievementPercent: 86, matchedCount: 86, periodType: 'monthly', periodKey: dayjs().format('YYYY-MM') },
            'demo-compliance': { kpiId: 'demo-compliance', actual: 62, target: 100, variance: -38, achievementPercent: 62, matchedCount: 62, periodType: 'monthly', periodKey: dayjs().format('YYYY-MM') },
            'demo-jobs': { kpiId: 'demo-jobs', actual: 18, target: 15, variance: 3, achievementPercent: 120, matchedCount: 18, periodType: 'monthly', periodKey: dayjs().format('YYYY-MM') }
        }
        const trend: MonthlyPoint[] = [
            { periodKey: dayjs().subtract(5, 'month').format('YYYY-MM'), achievement: 58 },
            { periodKey: dayjs().subtract(4, 'month').format('YYYY-MM'), achievement: 64 },
            { periodKey: dayjs().subtract(3, 'month').format('YYYY-MM'), achievement: 72 },
            { periodKey: dayjs().subtract(2, 'month').format('YYYY-MM'), achievement: 76 },
            { periodKey: dayjs().subtract(1, 'month').format('YYYY-MM'), achievement: 82 },
            { periodKey: dayjs().format('YYYY-MM'), achievement: 88 }
        ]
        const monthlyResults: MonthlyKpiResults[] = trend.map((point, index) => {
            const makeResult = (kpiId: string, actual: number, target: number): ComputedKpiResult => ({
                kpiId,
                actual,
                target,
                variance: actual - target,
                achievementPercent: (actual / target) * 100,
                matchedCount: actual,
                periodType: 'monthly',
                periodKey: point.periodKey
            })
            return {
                monthKey: point.periodKey,
                computed: {
                    'demo-onboarded': makeResult('demo-onboarded', [28, 31, 35, 38, 42, 47][index], [30, 30, 35, 40, 45, 50][index]),
                    'demo-plan': makeResult('demo-plan', [58, 64, 72, 76, 81, 86][index], 100),
                    'demo-compliance': makeResult('demo-compliance', [45, 49, 52, 56, 59, 62][index], 100),
                    'demo-jobs': makeResult('demo-jobs', [8, 10, 12, 14, 16, 18][index], [8, 10, 12, 14, 15, 15][index])
                }
            }
        })
        const departments = [
            { depName: 'Operations', totalKPIs: 4, achieved: 2, onTrack: 3, avgPct: 88 },
            { depName: 'Business Development', totalKPIs: 5, achieved: 4, onTrack: 4, avgPct: 91 },
            { depName: 'Compliance', totalKPIs: 4, achieved: 2, onTrack: 3, avgPct: 74 },
            { depName: 'Project Administration', totalKPIs: 3, achieved: 1, onTrack: 2, avgPct: 67 }
        ]
        return { defs, results, trend, monthlyResults, departments }
    }, [identityLoading, user])

    const chartDefs = isDemoMode ? demoPreview.defs : currentDefs
    const chartResults = isDemoMode ? demoPreview.results : currentResults
    const chartTrend = isDemoMode ? demoPreview.trend : currentTrend
    const chartMonthlyResults = isDemoMode ? demoPreview.monthlyResults : currentMonthlyResults
    const chartDepartments = isDemoMode ? demoPreview.departments : deptCards

    const chartDefIdKey = chartDefs.map(def => def.id).join('|')
    useEffect(() => {
        setSelectedKpiIds(current => {
            return current.filter(id => chartDefs.some(def => def.id === id)).slice(0, 2)
        })
    }, [chartDefIdKey])

    const filteredChartDefs = selectedKpiIds.length
        ? chartDefs.filter(def => selectedKpiIds.includes(def.id))
        : chartDefs
    const comparisonDefs = selectedKpiIds.length
        ? filteredChartDefs.slice(0, 2)
        : chartDefs.slice(0, 1)
    const canCompareActuals = comparisonDefs.length > 0
        && comparisonDefs.every(def => def.unit === comparisonDefs[0].unit)

    const totalKpis = filteredChartDefs.length
    const targetedKpiCount = filteredChartDefs.filter(def => {
        const target = chartResults[def.id]?.target
        return target !== null && target !== undefined && Number(target) > 0
    }).length
    const achievedCount = filteredChartDefs.filter(def => {
        const r = chartResults[def.id]
        if (!r || r.target == null || r.target === 0) return false
        return Number(r.actual || 0) >= Number(r.target || 0)
    }).length
    const onTrackCount = filteredChartDefs.filter(def => {
        const r = chartResults[def.id]
        if (!r || r.target == null || r.target === 0) return false
        return Number(r.actual || 0) >= 0.8 * Number(r.target || 0)
    }).length
    const avgAchievement =
        totalKpis === 0
            ? 0
            : Math.round(
                (filteredChartDefs.reduce((sum, def) => {
                    const r = chartResults[def.id]
                    if (!r || r.target == null || r.target === 0) return sum
                    return sum + Math.min(Number(r.actual || 0) / Number(r.target || 1), 1)
                }, 0) /
                    totalKpis) *
                100
            )

    const actualTargetOptions: Highcharts.Options = {
        chart: { type: 'pie', height: 360, spacing: [8, 8, 8, 8], backgroundColor: 'transparent' },
        title: {
            text: `<span style="font-size:28px;font-weight:700;color:${token.colorText}">${avgAchievement}%</span><br/><span style="font-size:12px;color:${token.colorTextSecondary}">Health</span>`,
            useHTML: true,
            verticalAlign: 'middle',
            y: 12,
            style: { textAlign: 'center' }
        },
        credits: { enabled: false },
        legend: { enabled: false },
        plotOptions: {
            pie: {
                innerSize: '62%',
                borderWidth: 8,
                borderColor: token.colorBgContainer,
                borderRadius: 8,
                slicedOffset: 0,
                dataLabels: {
                    enabled: true,
                    style: { color: token.colorText, textOutline: 'none', fontWeight: '600' },
                    formatter: function () {
                        return Number(this.y || 0) > 0 ? `<b>${this.point.name}</b><br/>${this.y}` : undefined
                    }
                }
            }
        },
        series: [
            {
                type: 'pie',
                name: 'KPIs',
                data: [
                    { name: 'Achieved', y: achievedCount, color: '#22c55e' },
                    { name: 'On track', y: Math.max(onTrackCount - achievedCount, 0), color: '#38bdf8' },
                    { name: 'Needs attention', y: Math.max(targetedKpiCount - onTrackCount, 0), color: '#f59e0b' },
                    { name: 'No target', y: Math.max(totalKpis - targetedKpiCount, 0), color: '#94a3b8' }
                ].filter(point => point.y > 0)
            }
        ]
    }

    const achievementOptions: Highcharts.Options = {
        chart: { type: 'bar', height: Math.max(320, filteredChartDefs.length * 46 + 90), spacing: [8, 8, 8, 8] },
        title: { text: undefined },
        credits: { enabled: false },
        legend: { enabled: false },
        xAxis: {
            categories: filteredChartDefs.map(d => d.kpiLabel),
            title: { text: '' }
        },
        yAxis: {
            min: 0,
            max: 100,
            title: { text: '' },
            plotBands: [
                { from: 0, to: 80, color: 'rgba(255,77,79,.07)' },
                { from: 80, to: 100, color: 'rgba(82,196,26,.08)' }
            ],
            plotLines: [
                { value: 80, color: '#faad14', width: 1, dashStyle: 'Dash' },
                { value: 100, color: '#52c41a', width: 1, dashStyle: 'Dash' }
            ]
        },
        plotOptions: {
            bar: {
                borderRadius: 6,
                dataLabels: {
                    enabled: true,
                    formatter: function () {
                        return Number(this.y || 0) > 0 ? `${Math.round(Number(this.y))}%` : undefined
                    }
                }
            }
        },
        series: [
            {
                type: 'bar',
                name: 'Achievement',
                data: filteredChartDefs.map(d => {
                    const value = Math.min(Number(chartResults[d.id]?.achievementPercent || 0), 100)
                    return { y: value, color: value >= 100 ? '#52c41a' : value >= 80 ? '#1677ff' : '#ff4d4f' }
                })
            }
        ]
    }

    const comparisonColours = ['#1677ff', '#7c3aed']
    const monthlyComparisonOptions: Highcharts.Options = {
        chart: { type: 'column', height: 320, spacing: [8, 8, 8, 8] },
        title: { text: undefined },
        credits: { enabled: false },
        legend: { enabled: true, align: 'center', verticalAlign: 'bottom', itemStyle: { fontWeight: '500' } },
        tooltip: {
            shared: true,
            valueSuffix: comparisonView === 'performance' ? '%' : ` ${comparisonDefs[0]?.unit === 'ZAR' ? 'ZAR' : comparisonDefs[0]?.unit || ''}`
        },
        xAxis: {
            categories: chartMonthlyResults.map(t => t.monthKey),
            title: { text: '' }
        },
        yAxis: comparisonView === 'performance'
            ? {
                min: 0,
                max: 120,
                title: { text: 'Performance rate' },
                labels: { format: '{value}%' },
                plotLines: [{ value: 100, color: '#52c41a', width: 1, dashStyle: 'Dash', label: { text: 'Target', style: { color: token.colorTextSecondary } } }]
            }
            : {
                min: 0,
                title: { text: `Actual ${comparisonDefs[0]?.unit || ''}` }
            },
        plotOptions: {
            column: {
                grouping: false,
                borderWidth: 0,
                shadow: false,
                dataLabels: {
                    enabled: true,
                    formatter: function () {
                        if (!Number(this.y || 0)) return undefined
                        return comparisonView === 'performance'
                            ? `${Math.round(Number(this.y))}%`
                            : `${Math.round(Number(this.y))}`
                    }
                }
            }
        },
        series: comparisonView === 'performance'
            ? comparisonDefs.map((def, index) => ({
                type: 'column' as const,
                name: def.kpiLabel,
                color: comparisonColours[index],
                pointPadding: comparisonDefs.length === 1 ? 0.25 : 0.16,
                pointPlacement: comparisonDefs.length === 1 ? 0 : index === 0 ? -0.18 : 0.18,
                data: chartMonthlyResults.map(row => Number(row.computed[def.id]?.achievementPercent || 0))
            }))
            : comparisonDefs.flatMap((def, index) => {
                const offset = comparisonDefs.length === 1 ? 0.13 : index === 0 ? -0.2 : 0.2
                return [{
                    type: 'column' as const,
                    name: `${def.kpiLabel} target`,
                    color: index === 0 ? 'rgba(22,119,255,.28)' : 'rgba(124,58,237,.28)',
                    pointPadding: 0.3,
                    pointPlacement: offset - 0.08,
                    dataLabels: {
                        enabled: true,
                        formatter: function () {
                            return Number(this.y || 0) > 0 ? `${Math.round(Number(this.y))}` : undefined
                        }
                    },
                    data: chartMonthlyResults.map(row => Number(row.computed[def.id]?.target || 0))
                }, {
                    type: 'column' as const,
                    name: `${def.kpiLabel} actual`,
                    color: comparisonColours[index],
                    pointPadding: 0.3,
                    pointPlacement: offset + 0.08,
                    data: chartMonthlyResults.map(row => Number(row.computed[def.id]?.actual || 0))
                }]
            })
    }

    const departmentSummaryOptions: Highcharts.Options = {
        chart: { type: 'bar', height: Math.max(320, chartDepartments.length * 48 + 80), spacing: [8, 8, 8, 8] },
        title: { text: undefined },
        credits: { enabled: false },
        legend: { enabled: false },
        xAxis: {
            categories: chartDepartments.map(d => d.depName),
            title: { text: '' }
        },
        yAxis: {
            min: 0,
            max: 100,
            title: { text: '' },
            plotBands: [{ from: 0, to: 80, color: 'rgba(255,77,79,.07)' }, { from: 80, to: 100, color: 'rgba(82,196,26,.08)' }]
        },
        plotOptions: {
            bar: {
                borderRadius: 6,
                dataLabels: {
                    enabled: true,
                    formatter: function () {
                        return Number(this.y || 0) > 0 ? `${Math.round(Number(this.y))}%` : undefined
                    }
                }
            }
        },
        series: [
            {
                type: 'bar',
                name: 'Achieved %',
                data: chartDepartments.map(d => {
                    const value = d.totalKPIs ? Math.round((d.achieved / d.totalKPIs) * 100) : 0
                    return { y: value, color: value >= 80 ? '#52c41a' : value >= 50 ? '#faad14' : '#ff4d4f' }
                })
            }
        ]
    }

    const renderModal = (
        type: 'actualTarget' | 'achievement' | 'department' | 'monthlyComparison'
    ) => (
        <Modal
            open={expandedChart === type}
            onCancel={() => setExpandedChart(null)}
            footer={null}
            width='92%'
            destroyOnClose
        >
            <HighchartsReact
                highcharts={Highcharts}
                options={
                    type === 'actualTarget'
                        ? actualTargetOptions
                        : type === 'achievement'
                            ? achievementOptions
                            : type === 'monthlyComparison'
                                ? monthlyComparisonOptions
                                : departmentSummaryOptions
                }
            />
        </Modal>
    )

    return (
        <div style={{ padding: 24, minHeight: '100vh' }}>
            <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
                {loading ? [0, 1, 2].map(index => (
                    <Col xs={24} md={8} key={index}>
                        <Skeleton.Input active block style={{ height: 112, borderRadius: 14 }} />
                    </Col>
                )) : <>
                    <Col xs={24} md={8}>
                        <MotionCard.Metric icon={<LineChartOutlined style={{ color: '#1677ff', fontSize: 20 }} />} iconBg='rgba(22,119,255,0.12)' title='Total KPIs' value={totalKpis} />
                    </Col>
                    <Col xs={24} md={8}>
                        <MotionCard.Metric icon={<CheckCircleOutlined style={{ color: '#52c41a', fontSize: 20 }} />} iconBg='rgba(82,196,26,0.12)' title='Achieved' value={achievedCount} />
                    </Col>
                    <Col xs={24} md={8}>
                        <MotionCard.Metric icon={<AimOutlined style={{ color: '#fa8c16', fontSize: 20 }} />} iconBg='rgba(250,140,22,0.12)' title='Average Achievement' value={avgAchievement} suffix='%' />
                    </Col>
                </>}
            </Row>

            <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35 }}
                style={{ marginBottom: 16 }}
            >
                <DashboardFilterBar>
                    <Row gutter={[16, 16]} align='middle'>
                            {isMainDept ? (
                                <Col xs={24} lg={6}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                        <span style={{ fontWeight: 600 }}>
                                            <FilterOutlined style={{ marginRight: 6 }} />
                                            Department
                                        </span>
                                        <Select
                                            value={department}
                                            onChange={setDepartment}
                                            style={{ width: '100%' }}
                                        >
                                            {visibleDepts.map(name => (
                                                <Option key={name} value={name}>
                                                    {name}
                                                </Option>
                                            ))}
                                        </Select>
                                    </div>
                                </Col>
                            ) : null}

                            <Col xs={24} lg={isMainDept ? 6 : 7}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    <span style={{ fontWeight: 600 }}>
                                        <FilterOutlined style={{ marginRight: 6 }} />
                                        Date Range
                                    </span>
                                    <RangePicker
                                        picker='month'
                                        value={dateRange}
                                        onChange={value => {
                                            if (value?.[0] && value?.[1]) {
                                                setDateRange([value[0], value[1]])
                                            }
                                        }}
                                        presets={[
                                            { label: 'This month', value: [dayjs().startOf('month'), dayjs().endOf('month')] },
                                            { label: 'This quarter', value: [dayjs().startOf('quarter'), dayjs().endOf('quarter')] },
                                            { label: 'Last 3 months', value: [dayjs().subtract(2, 'month').startOf('month'), dayjs().endOf('month')] },
                                            { label: 'This year', value: [dayjs().startOf('year'), dayjs().endOf('year')] }
                                        ]}
                                        style={{ width: '100%' }}
                                    />
                                </div>
                            </Col>

                            <Col xs={24} lg={isMainDept ? 8 : 11}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    <span style={{ fontWeight: 600 }}>Compare KPIs</span>
                                    <Select
                                        mode='multiple'
                                        maxCount={2}
                                        value={selectedKpiIds}
                                        onChange={setSelectedKpiIds}
                                        placeholder='Choose up to two KPIs'
                                        style={{ width: '100%' }}
                                        options={chartDefs.map(def => ({
                                            value: def.id,
                                            label: `${def.kpiLabel} · ${def.unit === 'ZAR' ? 'ZAR' : def.unit === 'percent' ? 'Percent' : 'Count'}`
                                        }))}
                                    />
                                </div>
                            </Col>

                            <Col xs={24} lg={isMainDept ? 4 : 6}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    <span style={{ fontWeight: 600 }}>Comparison view</span>
                                    <Segmented
                                        block
                                        value={comparisonView}
                                        onChange={value => setComparisonView(value as 'performance' | 'actual')}
                                        options={[
                                            { label: 'Performance', value: 'performance' },
                                            { label: 'Actual vs target', value: 'actual' }
                                        ]}
                                    />
                                </div>
                            </Col>
                    </Row>
                </DashboardFilterBar>
            </motion.div>

            {loading ? (
                <>
                    <Row gutter={[16, 16]}>
                        {[0, 1, 2].map(index => (
                            <Col xs={24} xl={index === 2 ? 24 : 12} key={`chart-${index}`}>
                                <Skeleton active paragraph={{ rows: 9 }} style={{ padding: 24, borderRadius: 14, border: `1px solid ${token.colorBorderSecondary}` }} />
                            </Col>
                        ))}
                    </Row>
                </>
            ) : isMainDept ? (
                <>
                    <Row gutter={[16, 16]}>
                        <Col xs={24} xl={12}>
                            <MotionCard
                            >
                                <div
                                    style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                        alignItems: 'center',
                                        marginBottom: 8
                                    }}
                                >
                                    <strong>Department performance</strong>
                                    <Button icon={<ExpandOutlined />} onClick={() => setExpandedChart('department')} />
                                </div>
                                <HighchartsReact highcharts={Highcharts} options={departmentSummaryOptions} />
                            </MotionCard>
                        </Col>

                        <Col xs={24} xl={12}>
                            {chartDefs.length ? (
                                <MotionCard
                                >
                                    <div
                                        style={{
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                            marginBottom: 8
                                        }}
                                    >
                                        <strong>{department} — KPI health</strong>
                                        <Button icon={<ExpandOutlined />} onClick={() => setExpandedChart('actualTarget')} />
                                    </div>
                                    <HighchartsReact highcharts={Highcharts} options={actualTargetOptions} />
                                </MotionCard>
                            ) : (
                                <Result
                                    status='info'
                                    title='No KPI Definitions'
                                    subTitle='No KPI definitions were found for the selected department.'
                                />
                            )}
                        </Col>

                        <Col xs={24}>
                            <MotionCard>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                    <strong>Monthly achieved vs target</strong>
                                    <Button icon={<ExpandOutlined />} onClick={() => setExpandedChart('monthlyComparison')} />
                                </div>
                                {comparisonView === 'actual' && !canCompareActuals ? (
                                    <Alert
                                        type='info'
                                        showIcon
                                        message='Choose KPIs with the same unit for an actual-value comparison.'
                                        description='Use Performance to compare KPIs with different units against their own targets.'
                                    />
                                ) : <HighchartsReact highcharts={Highcharts} options={monthlyComparisonOptions} />}
                            </MotionCard>
                        </Col>
                    </Row>

                    {renderModal('department')}
                    {renderModal('actualTarget')}
                    {renderModal('monthlyComparison')}
                </>
            ) : !chartDefs.length ? (
                <Result
                    status='info'
                    title='No KPI Data Found'
                    subTitle='No KPI definitions were found for your department.'
                />
            ) : (
                <Row gutter={[16, 16]}>
                    <Col xs={24} xl={12}>
                        <MotionCard
                        >
                            <div
                                style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    marginBottom: 8
                                }}
                            >
                                <strong>KPI health</strong>
                                <Button icon={<ExpandOutlined />} onClick={() => setExpandedChart('actualTarget')} />
                            </div>
                            <HighchartsReact highcharts={Highcharts} options={actualTargetOptions} />
                        </MotionCard>
                    </Col>

                    <Col xs={24} xl={12}>
                        <MotionCard
                        >
                            <div
                                style={{
                                    display: 'flex',
                                    justifyContent: 'space-between',
                                    alignItems: 'center',
                                    marginBottom: 8
                                }}
                            >
                                <strong>Achievement by KPI</strong>
                                <Button icon={<ExpandOutlined />} onClick={() => setExpandedChart('achievement')} />
                            </div>
                            <HighchartsReact highcharts={Highcharts} options={achievementOptions} />
                        </MotionCard>
                    </Col>

                    <Col xs={24}>
                        <MotionCard>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                <strong>Monthly achieved vs target</strong>
                                <Button icon={<ExpandOutlined />} onClick={() => setExpandedChart('monthlyComparison')} />
                            </div>
                            {comparisonView === 'actual' && !canCompareActuals ? (
                                <Alert
                                    type='info'
                                    showIcon
                                    message='Choose KPIs with the same unit for an actual-value comparison.'
                                    description='Use Performance to compare KPIs with different units against their own targets.'
                                />
                            ) : <HighchartsReact highcharts={Highcharts} options={monthlyComparisonOptions} />}
                        </MotionCard>
                    </Col>

                    {renderModal('actualTarget')}
                    {renderModal('achievement')}
                    {renderModal('monthlyComparison')}
                </Row>
            )}
        </div>
    )
}

export default KPITrackerView
