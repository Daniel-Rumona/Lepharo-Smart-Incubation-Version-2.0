// MonitoringReports.tsx
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
    Card,
    Row,
    Col,
    DatePicker,
    Space,
    Typography,
    Button,
    Modal,
    message,
    Segmented,
    Select,
    Tag
} from 'antd'
import { motion } from 'framer-motion'
import dayjs, { Dayjs } from 'dayjs'
import { db } from '@/firebase'
import {
    collection,
    getDocs,
    query,
    where,
    getDoc,
    doc
} from 'firebase/firestore'
import {
    ExpandOutlined,
    DownloadOutlined,
    FileTextOutlined,
    BarChartOutlined,
    TeamOutlined,
    SolutionOutlined,
    WarningOutlined,
    PlayCircleOutlined
} from '@ant-design/icons'
import { useFullIdentity } from '@/hooks/useFullIdentity'

// charts
import InterventionsDeptDrilldownChart from './DepartmentInterventionsDrilldown'
import BarRaceChart from './BarChart'
import ProvinceMapDashboard from './ProvinceMap'
import IncubateesInsights from './IncubateesInsights'
import FacilitatorsTab from './FacilitatorsTab'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { DashboardFilterBar } from '@/components/dashboards/metrics/Header'
import '@/styles/nav-segmented.css'
import { PageSkeleton } from '@/components/shared/PageSkeleton'
import { assignedInterventionService } from '@/services/assignedInterventionService'
import { filterReportRecords } from '@/utils/reportVisibility'

// DOCX export + Programme Summary builder
import { exportMonthlyDepartmentReportDocx } from '@/utils/monthlyReportDocx'
import { buildConsolidatedMeProgramReport } from '@/utils/buildProgramSummaryReportWithCharts'
import type { MonthlyReportData } from '@/utils/monthlyReportDocx'
import { buildExecutiveQuarterlyReportData } from '@/utils/buildExecutiveQuarterlyReport'
import { fillDocxTemplateAndDownload } from '@/utils/docxTemplateFill'
import SMERiskRegisterPage from './SMERiskRegister'
import MonitoringReportPlayer from './MonitoringReportPlayer'
import { useColorMode } from '@/contexts/ThemeContext'

const { Text } = Typography
const { RangePicker } = DatePicker

const getFiscalQuarterRange = (base = dayjs()): [Dayjs, Dayjs] => {
    const fiscalMonth = (base.month() - 3 + 12) % 12
    const startMonth = 3 + Math.floor(fiscalMonth / 3) * 3
    const start = base.startOf('year').month(startMonth === 12 ? 0 : startMonth)
    return [start.startOf('month'), start.add(2, 'month').endOf('month')]
}

const getFiscalYtdRange = (base = dayjs()): [Dayjs, Dayjs] => {
    const start = base.month() >= 3
        ? base.startOf('year').month(3).startOf('month')
        : base.subtract(1, 'year').startOf('year').month(3).startOf('month')
    return [start, base.endOf('day')]
}

// Report exports used to be capped at a quarter (3 months); the underlying builders
// support any span, so this only bounds the export to a sensible upper limit (2 years).
const EXPORT_MAX_SPAN_MONTHS = 24

const exportSpanLabel = (spanMonths: number): string => {
    switch (spanMonths) {
        case 1: return 'Monthly'
        case 3: return 'Quarterly'
        case 6: return 'Half-Yearly'
        case 12: return 'Annual'
        case 24: return 'Biennial'
        default: return 'Custom-Range'
    }
}


type Intervention = {
    id: string
    programId?: string
    areaOfSupport?: string
    departmentId?: string
    departmentName?: string
    branchName?: string
    status?: string
    interventionDate?: any
}

const asDate = (v: any) =>
    v?.toDate?.() ??
    (v instanceof Date ? v : typeof v === 'string' ? new Date(v) : undefined)

const CARD_STYLE: React.CSSProperties = {
    boxShadow: '0 12px 32px rgba(0, 0, 0, 0.12)',
    transition: 'all 0.3s ease',
    borderRadius: 8,
    border: '1px solid #d6e4ff'
}

const MonitoringReports: React.FC = () => {
    const { user } = useFullIdentity() as any
    const { isDark } = useColorMode()

    // use the hook properly
    const { programId, activeProgramId, isAllPrograms } = useActiveProgramId()

    const [interventions, setInterventions] = useState<Intervention[]>([])
    const [departments, setDepartments] = useState<Record<string, string>>({})
    const [initialLoading, setInitialLoading] = useState(true)
    const hasLoadedRef = useRef(false)

    const [isMainDept, setIsMainDept] = useState(false)
    const [exporting, setExporting] = useState(false)

    const [range, setRange] = useState<[Dayjs, Dayjs]>([
        dayjs().startOf('year'),
        dayjs().endOf('year')
    ])
    const [selectedDepartmentId, setSelectedDepartmentId] = useState<'all' | string>('all')
    const [selectedBranch, setSelectedBranch] = useState<'all' | string>('all')
    const [isMultiBranch, setIsMultiBranch] = useState(false)
    const [reportChooserOpen, setReportChooserOpen] = useState(false)
    const [playerOpen, setPlayerOpen] = useState(false)
    const [playerData, setPlayerData] = useState<MonthlyReportData | null>(null)
    const [playerLoading, setPlayerLoading] = useState(false)

    const [view, setView] = useState<'Interventions' | 'Incubatees' | 'Facilitators' | 'Risk'>(
        'Interventions'
    )

    const [expandedBar, setExpandedBar] = useState(false)
    const [expandedDrill, setExpandedDrill] = useState(false)

    useEffect(() => {
        let mounted = true

            ; (async () => {
                if (!hasLoadedRef.current) setInitialLoading(true)

                try {
                    // main department check
                    if (user?.departmentId) {
                        try {
                            const depRef = doc(db, 'departments', user.departmentId)
                            const depSnap = await getDoc(depRef)
                            if (mounted) {
                                setIsMainDept(!!depSnap.data()?.isMain)
                            }
                        } catch {
                            if (mounted) setIsMainDept(false)
                        }
                    } else if (mounted) {
                        setIsMainDept(false)
                    }

                    // Completed interventions are sourced from the canonical
                    // assignedInterventions records, specifically after SME
                    // completion confirmation.
                    const completedRows = await assignedInterventionService.listCompleted(
                        activeProgramId ? { programId: activeProgramId } : {}
                    )
                    const rows: Intervention[] = filterReportRecords(completedRows as Record<string, unknown>[], user?.email).map((raw: any) => {
                        return {
                            id: raw.id,
                            programId: raw.programId,
                            areaOfSupport: raw.areaOfSupport,
                            departmentId: raw.departmentId ?? undefined,
                            departmentName: raw.departmentName ?? undefined,
                            branchName: raw.branchName ?? raw.branch ?? undefined,
                            status: raw.status,
                            interventionDate: raw.interventionDate ?? raw.date
                        }
                    })

                    if (!mounted) return
                    setInterventions(rows)

                    // departments
                    const depSnap = await getDocs(
                        query(
                            collection(db, 'departments'),
                            where('interventionsDepartment', '==', true)
                        )
                    )

                    const depMap: Record<string, string> = {}
                    depSnap.docs.forEach(docu => {
                        const d: any = docu.data()
                        depMap[docu.id] =
                            d.title || d.name || d.departmentTitle || d.displayName || 'Untitled Department'
                    })

                    if (!mounted) return
                    setDepartments(depMap)

                    // multi-branch logic
                    if (activeProgramId) {
                        try {
                            const progRef = doc(db, 'programs', activeProgramId)
                            const progSnap = await getDoc(progRef)

                            if (mounted) {
                                if (progSnap.exists()) {
                                    const pdata: any = progSnap.data()
                                    setIsMultiBranch(!!pdata.isMultiBranch)
                                } else {
                                    setIsMultiBranch(false)
                                }
                            }
                        } catch {
                            if (mounted) setIsMultiBranch(false)
                        }
                    } else {
                        // all programs selected
                        // enable branch filter if any returned intervention already has a branch
                        if (mounted) {
                            setIsMultiBranch(rows.some(r => !!r.branchName))
                        }
                    }

                    if (mounted) {
                        setSelectedDepartmentId('all')
                        setSelectedBranch('all')
                    }
                } catch (e: any) {
                    console.error('[MonitoringReports] load error:', e)
                    message.error(e?.message || 'Failed to load monitoring data.')
                } finally {
                    if (mounted) {
                        hasLoadedRef.current = true
                        setInitialLoading(false)
                    }
                }
            })()

        return () => {
            mounted = false
        }
    }, [user?.departmentId, activeProgramId, isAllPrograms])

    const depTitleOf = useCallback(
        (idOrName?: string) => (idOrName ? departments[idOrName] || idOrName : 'Unknown'),
        [departments]
    )

    const departmentOptions = useMemo(
        () => [
            { value: 'all', label: 'All Departments' },
            ...Object.entries(departments).map(([id, title]) => ({
                value: id,
                label: title
            }))
        ],
        [departments]
    )

    const branchOptions = useMemo(() => {
        const set = new Set<string>()
        interventions.forEach(i => {
            if (i.branchName) set.add(i.branchName)
        })
        const arr = Array.from(set)
        return [
            { value: 'all', label: 'All Branches' },
            ...arr.map(b => ({ value: b, label: b }))
        ]
    }, [interventions])

    const filteredForBar = useMemo(() => {
        const [start, end] = range

        return interventions.filter(r => {
            const d = asDate(r.interventionDate)
            if (!d) return false
            if (dayjs(d).isBefore(start, 'day') || dayjs(d).isAfter(end, 'day')) return false

            if (selectedDepartmentId !== 'all' && r.departmentId !== selectedDepartmentId) {
                return false
            }

            if (selectedBranch !== 'all' && r.branchName !== selectedBranch) {
                return false
            }

            return true
        })
    }, [interventions, range, selectedDepartmentId, selectedBranch])

    const barMonthIndex = useMemo(
        () => range?.[0]?.month?.() ?? dayjs().month(),
        [range]
    )

    const barYear = useMemo(
        () => range?.[0]?.year?.() ?? dayjs().year(),
        [range]
    )

    const dateFrom = range?.[0]?.toDate?.()
    const dateTo = range?.[1]?.toDate?.()

    const effectiveDepartmentIdForConsultants =
        selectedDepartmentId === 'all' ? undefined : selectedDepartmentId

    // Shared by the DOCX export and the Play story: validates the selected range,
    // builds the consolidated programme report, and returns everything the caller needs.
    // Returns null when it has already shown the user why it couldn't proceed.
    // The DOCX export still names one specific program on its cover page, so it keeps
    // requiring one. The Play story can tell a combined story across every program, so
    // it opts in with allowAllPrograms.
    const buildProgrammeSummaryReportData = async (
        opts: { allowAllPrograms?: boolean } = {}
    ): Promise<{
        reportData: MonthlyReportData
        spanMonths: number
        start: Dayjs
        end: Dayjs
    } | null> => {
        const { allowAllPrograms = false } = opts

        if (isAllPrograms && !allowAllPrograms) {
            message.error('Select a specific program first.')
            return null
        }
        if (!isAllPrograms && !activeProgramId) {
            message.error('Select a specific program first.')
            return null
        }

        if (!isMainDept) {
            message.error('Only main departments can build a programme summary.')
            return null
        }

        const start = range[0].startOf('day')
        const end = range[1].endOf('day')

        const isStartAtMonthBoundary = start.isSame(start.startOf('month'), 'day')
        const isEndAtMonthBoundary = end.isSame(end.endOf('month'), 'day')
        const spanMonths = end.startOf('month').diff(start.startOf('month'), 'month') + 1
        const isValidSpan = spanMonths >= 1 && spanMonths <= EXPORT_MAX_SPAN_MONTHS

        if (!isStartAtMonthBoundary || !isEndAtMonthBoundary || !isValidSpan) {
            message.warning(`Select a FULL range of 1–${EXPORT_MAX_SPAN_MONTHS} months (month boundaries).`)
            return null
        }

        const reportData = await buildConsolidatedMeProgramReport({
            programId: isAllPrograms ? undefined : activeProgramId,
            reportTitleDepartmentName: 'M&E (Consolidated)',
            period: {
                month: start.month() + 1,
                year: start.year(),
                spanMonths
            },
            meta: {
                preparedBy: (user as any)?.name || (user as any)?.email || '—'
            }
        })

        return { reportData, spanMonths, start, end }
    }

    const handleExportProgrammeSummary = async () => {
        try {
            setExporting(true)

            const built = await buildProgrammeSummaryReportData()
            if (!built) return
            const { reportData, spanMonths, start, end } = built

            const fileLabel =
                spanMonths === 1
                    ? start.format('MMMM-YYYY')
                    : `${start.format('MMM-YYYY')}_to_${end.format('MMM-YYYY')}`

            await exportMonthlyDepartmentReportDocx(reportData, {
                filenameBase: `M&E-Programme-Consolidated-${fileLabel}-${exportSpanLabel(spanMonths)}-Report`
            })

            message.success('Programme summary exported.')
        } catch (err) {
            console.error(err)
            message.error('Failed to export programme summary.')
        } finally {
            setExporting(false)
        }
    }

    const handlePlayProgrammeSummary = async () => {
        try {
            setPlayerLoading(true)

            const built = await buildProgrammeSummaryReportData({ allowAllPrograms: true })
            if (!built) return

            setPlayerData(built.reportData)
            setPlayerOpen(true)
        } catch (err) {
            console.error(err)
            message.error('Failed to build the programme story.')
        } finally {
            setPlayerLoading(false)
        }
    }

    const handleExportExecutiveReport = async () => {
        try {
            if (isAllPrograms || !activeProgramId) {
                message.error('Select a specific program first.')
                return
            }

            if (!isMainDept) {
                message.error('Only main departments can export an executive report.')
                return
            }

            const start = range[0].startOf('day')
            const end = range[1].endOf('day')

            const isStartAtMonthBoundary = start.isSame(start.startOf('month'), 'day')
            const isEndAtMonthBoundary = end.isSame(end.endOf('month'), 'day')
            const spanMonths = end.startOf('month').diff(start.startOf('month'), 'month') + 1
            const isValidSpan = spanMonths >= 1 && spanMonths <= EXPORT_MAX_SPAN_MONTHS

            if (!isStartAtMonthBoundary || !isEndAtMonthBoundary || !isValidSpan) {
                message.warning(`Select a FULL range of 1–${EXPORT_MAX_SPAN_MONTHS} months (month boundaries).`)
                return
            }

            setExporting(true)

            const reportData = await buildExecutiveQuarterlyReportData({
                programId: activeProgramId,
                period: {
                    month: start.month() + 1,
                    year: start.year(),
                    spanMonths
                },
                preparedBy: (user as any)?.name || (user as any)?.email || 'Lepharo / ROM Department'
            })

            const fileLabel =
                spanMonths === 1
                    ? start.format('MMMM-YYYY')
                    : `${start.format('MMM-YYYY')}_to_${end.format('MMM-YYYY')}`

            await fillDocxTemplateAndDownload({
                templateUrl: '/templates/SRMCDT_Quarterly_Report_Template.docx',
                data: reportData as unknown as Record<string, unknown>,
                filenameBase: `${reportData.project_code}-${fileLabel}-Executive-Report`
            })

            message.success('Executive report exported.')
        } catch (err) {
            console.error(err)
            message.error('Failed to export executive report.')
        } finally {
            setExporting(false)
        }
    }

    return (
        <div style={{ padding: '5px 24px' }}>
            {initialLoading ? (
                <PageSkeleton variant='analytics' />
            ) : (
            <>
                <DashboardFilterBar>
                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 12,
                            width: '100%',
                            minWidth: 0,
                            overflowX: 'auto'
                        }}
                    >
                        <div style={{ flex: '1 1 0', minWidth: 180 }}>
                            <Select
                                size='large'
                                value={selectedDepartmentId}
                                onChange={value => setSelectedDepartmentId(value)}
                                options={departmentOptions}
                                style={{ width: '100%' }}
                                disabled={view === 'Incubatees'}
                            />
                        </div>
                        {isMultiBranch && (
                            <div style={{ flex: '0.8 1 0', minWidth: 150 }}>
                                <Select
                                    size='large'
                                    value={selectedBranch}
                                    onChange={value => setSelectedBranch(value)}
                                    options={branchOptions}
                                    style={{ width: '100%' }}
                                />
                            </div>
                        )}
                        <div style={{ flex: '1.3 1 0', minWidth: 260 }}>
                            <RangePicker
                                size='large'
                                value={range}
                                onChange={v => v && setRange(v as [Dayjs, Dayjs])}
                                presets={[
                                    { label: 'This Month', value: [dayjs().startOf('month'), dayjs().endOf('month')] },
                                    { label: 'This Quarter', value: getFiscalQuarterRange() },
                                    { label: 'YTD', value: getFiscalYtdRange() },
                                    { label: 'Last 12 Months', value: [dayjs().subtract(11, 'month').startOf('month'), dayjs().endOf('month')] },
                                    { label: 'This Year', value: [dayjs().startOf('year'), dayjs().endOf('year')] }
                                ]}
                                style={{ width: '100%' }}
                                allowClear={false}
                            />
                        </div>

                        <div style={{ flex: '0 0 auto' }}>
                            <Segmented
                                className='nav-pill-segmented'
                                value={view}
                                onChange={v => setView(v as any)}
                                options={[
                                    { value: 'Interventions', label: 'Interventions', icon: <BarChartOutlined /> },
                                    { value: 'Incubatees', label: 'Incubatees', icon: <TeamOutlined /> },
                                    { value: 'Facilitators', label: 'Facilitators', icon: <SolutionOutlined /> },
                                    { value: 'Risk', label: 'Risk', icon: <WarningOutlined /> }
                                ]}
                            />
                        </div>
                        {isMainDept && (
                            <div style={{ flex: '0 0 auto' }}>
                                <Space.Compact>
                                    <Button
                                        size='large'
                                        shape='round'
                                        type='primary'
                                        icon={<FileTextOutlined />}
                                        loading={exporting}
                                        onClick={() => setReportChooserOpen(true)}
                                        disabled={isAllPrograms}
                                    >
                                        Reports
                                    </Button>
                                    <Button
                                        size='large'
                                        shape='round'
                                        icon={<PlayCircleOutlined />}
                                        loading={playerLoading}
                                        onClick={() => void handlePlayProgrammeSummary()}
                                    >
                                        Play
                                    </Button>
                                </Space.Compact>
                            </div>
                        )}
                    </div>
                </DashboardFilterBar>

                {view === 'Interventions' && (
                    <div style={{ marginTop: 16 }}>
                        <Row>
                            <Col span={24}>
                                <Card
                                    style={CARD_STYLE}
                                    title='Interventions per Department (Drilldown)'
                                    extra={
                                        <Button
                                            size='small'
                                            icon={<ExpandOutlined />}
                                            onClick={() => setExpandedDrill(true)}
                                        >
                                            Expand
                                        </Button>
                                    }
                                >
                                    <InterventionsDeptDrilldownChart
                                        programId={activeProgramId}
                                        departmentId={
                                            selectedDepartmentId === 'all'
                                                ? undefined
                                                : selectedDepartmentId
                                        }
                                        dateFrom={dateFrom}
                                        dateTo={dateTo}
                                    />
                                </Card>
                            </Col>

                            <Col style={{ marginTop: 16 }} span={24}>
                                <ProvinceMapDashboard
                                    metric='interventions'
                                    dateFrom={range[0].toDate()}
                                    dateTo={range[1].toDate()}
                                    programId={activeProgramId}
                                />
                            </Col>
                        </Row>

                        <Modal
                            open={expandedBar}
                            footer={null}
                            onCancel={() => setExpandedBar(false)}
                            width={1100}
                            title={
                                <Space>
                                    <Text strong>Completed Interventions (Expanded)</Text>
                                    <Text type='secondary'>
                                        • {dayjs(
                                            `${barYear}-${String(barMonthIndex + 1).padStart(2, '0')}-01`
                                        ).format('MMMM YYYY')} • Departments
                                    </Text>
                                </Space>
                            }
                        >
                            <BarRaceChart
                                data={filteredForBar as any}
                                groupBy='department'
                                monthIndex={barMonthIndex}
                                year={barYear}
                                depTitleOf={depTitleOf}
                                title=''
                            />
                        </Modal>

                        <Modal
                            open={expandedDrill}
                            footer={null}
                            onCancel={() => setExpandedDrill(false)}
                            width={1100}
                            title='Interventions per Department (Expanded Drilldown)'
                        >
                            <InterventionsDeptDrilldownChart
                                programId={activeProgramId}
                                departmentId={
                                    selectedDepartmentId === 'all'
                                        ? undefined
                                        : selectedDepartmentId
                                }
                                dateFrom={dateFrom}
                                dateTo={dateTo}
                            />
                        </Modal>
                    </div>
                )}

                {view === 'Incubatees' && (
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3 }}
                        style={{ marginTop: 16 }}
                    >
                        <IncubateesInsights
                            programId={activeProgramId}
                            range={range}
                        />
                    </motion.div>
                )}

                {view === 'Facilitators' && (
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3 }}
                        style={{ marginTop: 16 }}
                    >
                        <FacilitatorsTab
                            programId={activeProgramId}
                            departmentId={effectiveDepartmentIdForConsultants}
                            dateFrom={dateFrom}
                            dateTo={dateTo}
                        />
                    </motion.div>
                )}

                {view === 'Risk' && (
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3 }}
                        style={{ marginTop: 16 }}
                    >
                        <SMERiskRegisterPage
                            programId={activeProgramId}
                        />
                    </motion.div>
                )}

                <Modal
                    open={reportChooserOpen}
                    onCancel={() => setReportChooserOpen(false)}
                    footer={null}
                    width={780}
                    title={
                        <Space direction='vertical' size={2}>
                            <Text strong style={{ fontSize: 20 }}>Choose a report</Text>
                            <Text type='secondary'>Select the report that matches the level of detail you need.</Text>
                        </Space>
                    }
                >
                    <Row gutter={[16, 16]} style={{ marginTop: 12 }}>
                        <Col xs={24} md={12}>
                            <Card
                                hoverable
                                style={{ height: '100%', borderRadius: 14, border: '1px solid #dbeafe', boxShadow: '0 8px 24px rgba(37, 99, 235, .10)' }}
                                bodyStyle={{ padding: 20 }}
                            >
                                <Space direction='vertical' size={12} style={{ width: '100%' }}>
                                    <Space align='center'>
                                        <div style={{ width: 40, height: 40, borderRadius: 12, display: 'grid', placeItems: 'center', background: '#eff6ff', color: '#2563eb' }}>
                                            <BarChartOutlined style={{ fontSize: 20 }} />
                                        </div>
                                        <div>
                                            <Text strong style={{ fontSize: 16 }}>Programme summary</Text>
                                            <div><Tag color='blue'>Detailed</Tag></div>
                                        </div>
                                    </Space>
                                    <Text type='secondary'>A consolidated view of interventions, department performance, incubatee activity and programme delivery for the selected period.</Text>
                                    <Button
                                        block
                                        type='primary'
                                        icon={<DownloadOutlined />}
                                        loading={exporting}
                                        onClick={() => { setReportChooserOpen(false); void handleExportProgrammeSummary() }}
                                    >
                                        Export programme report
                                    </Button>
                                </Space>
                            </Card>
                        </Col>
                        <Col xs={24} md={12}>
                            <Card
                                hoverable
                                style={{ height: '100%', borderRadius: 14, border: '1px solid #dcfce7', boxShadow: '0 8px 24px rgba(22, 163, 74, .10)' }}
                                bodyStyle={{ padding: 20 }}
                            >
                                <Space direction='vertical' size={12} style={{ width: '100%' }}>
                                    <Space align='center'>
                                        <div style={{ width: 40, height: 40, borderRadius: 12, display: 'grid', placeItems: 'center', background: '#f0fdf4', color: '#16a34a' }}>
                                            <FileTextOutlined style={{ fontSize: 20 }} />
                                        </div>
                                        <div>
                                            <Text strong style={{ fontSize: 16 }}>Executive report</Text>
                                            <div><Tag color='green'>Leadership view</Tag></div>
                                        </div>
                                    </Space>
                                    <Text type='secondary'>A concise leadership-ready report covering progress, headline outcomes, risks and key programme-level insights.</Text>
                                    <Button
                                        block
                                        icon={<DownloadOutlined />}
                                        loading={exporting}
                                        onClick={() => { setReportChooserOpen(false); void handleExportExecutiveReport() }}
                                    >
                                        Export executive report
                                    </Button>
                                </Space>
                            </Card>
                        </Col>
                    </Row>
                </Modal>

                <MonitoringReportPlayer
                    dark={isDark}
                    open={playerOpen}
                    onClose={() => setPlayerOpen(false)}
                    data={playerData}
                    rangeLabel={`${range[0].format('D MMM YYYY')} – ${range[1].format('D MMM YYYY')}`}
                />
            </>
            )}
        </div>
    )
}

export default MonitoringReports
