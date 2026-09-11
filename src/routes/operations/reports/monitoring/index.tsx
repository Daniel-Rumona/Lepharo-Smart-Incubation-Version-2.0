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
import { ExpandOutlined, DownloadOutlined, FileTextOutlined, BarChartOutlined } from '@ant-design/icons'
import { useFullIdentity } from '@/hooks/useFullIdentity'

// charts
import InterventionsDeptDrilldownChart from './DepartmentInterventionsDrilldown'
import BarRaceChart from './BarChart'
import ProvinceMapDashboard from './ProvinceMap'
import IncubateesInsights from './IncubateesInsights'
import FacilitatorsTab from './FacilitatorsTab'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { LoadingOverlay } from '@/components/shared/LoadingOverlay'
import { assignedInterventionService } from '@/services/assignedInterventionService'
import { filterReportRecords } from '@/utils/reportVisibility'

// DOCX export + Programme Summary builder
import { exportMonthlyDepartmentReportDocx } from '@/utils/monthlyReportDocx'
import { buildConsolidatedMeProgramReport } from '@/utils/buildProgramSummaryReportWithCharts'
import { buildExecutiveQuarterlyReportData } from '@/utils/buildExecutiveQuarterlyReport'
import { fillDocxTemplateAndDownload } from '@/utils/docxTemplateFill'
import SMERiskRegisterPage from './SMERiskRegister'

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

    const handleExportProgrammeSummary = async () => {
        try {
            // must be specific program, not all
            if (isAllPrograms || !activeProgramId) {
                message.error('Select a specific program first.')
                return
            }

            if (!isMainDept) {
                message.error('Only main departments can export a programme summary.')
                return
            }

            const start = range[0].startOf('day')
            const end = range[1].endOf('day')

            const isStartAtMonthBoundary = start.isSame(start.startOf('month'), 'day')
            const isEndAtMonthBoundary = end.isSame(end.endOf('month'), 'day')
            const spanMonths = end.startOf('month').diff(start.startOf('month'), 'month') + 1
            const isValidSpan = spanMonths >= 1 && spanMonths <= 3

            if (!isStartAtMonthBoundary || !isEndAtMonthBoundary || !isValidSpan) {
                message.warning('Select a FULL range of 1–3 months (month boundaries).')
                return
            }

            setExporting(true)

            const reportData = await buildConsolidatedMeProgramReport({
                programId: activeProgramId,
                reportTitleDepartmentName: 'M&E (Consolidated)',
                period: {
                    month: start.month() + 1,
                    year: start.year(),
                    spanMonths: spanMonths as 1 | 2 | 3
                },
                meta: {
                    preparedBy: (user as any)?.name || (user as any)?.email || '—'
                }
            })

            const fileLabel =
                spanMonths === 1
                    ? start.format('MMMM-YYYY')
                    : `${start.format('MMM-YYYY')}_to_${end.format('MMM-YYYY')}`

            await exportMonthlyDepartmentReportDocx(reportData, {
                filenameBase: `M&E-Programme-Consolidated-${fileLabel}-${spanMonths === 3 ? 'Quarterly' : 'Monthly'}-Report`
            })

            message.success('Programme summary exported.')
        } catch (err) {
            console.error(err)
            message.error('Failed to export programme summary.')
        } finally {
            setExporting(false)
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
            const isValidSpan = spanMonths >= 1 && spanMonths <= 3

            if (!isStartAtMonthBoundary || !isEndAtMonthBoundary || !isValidSpan) {
                message.warning('Select a FULL range of 1-3 months (month boundaries).')
                return
            }

            setExporting(true)

            const reportData = await buildExecutiveQuarterlyReportData({
                programId: activeProgramId,
                period: {
                    month: start.month() + 1,
                    year: start.year(),
                    spanMonths: spanMonths as 1 | 2 | 3
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
        <div style={{ padding: 24, minHeight: '100vh' }}>
            {initialLoading && (
                <LoadingOverlay tip='Loading Departmental Analytics' />
            )}
            <>
                <MotionCard
                    filterBarProps={{
                        padding: 8,
                        marginBottom: 0,
                        background: '#f8fafc',
                        style: { overflow: 'hidden' }
                    }}
                    filterBar={
                        <Space
                            size={12}
                            align='center'
                            wrap={false}
                            style={{
                                width: '100%',
                                justifyContent: 'space-between',
                                gap: 16,
                                overflowX: 'auto',
                                overflowY: 'hidden',
                                padding: '0 4px',
                                flexWrap: 'nowrap'
                            }}
                        >
                            <Space size={6} align='center' style={{ flex: '1 1 260px', minWidth: 210 }}>
                                <Text type='secondary' style={{ fontSize: 12 }}>Department</Text>
                                <Select
                                    size='small'
                                    value={selectedDepartmentId}
                                    onChange={value => setSelectedDepartmentId(value)}
                                    options={departmentOptions}
                                    style={{ flex: 1, minWidth: 140 }}
                                    disabled={view === 'Incubatees'}
                                />
                            </Space>
                            {isMultiBranch && (
                                <Space size={6} align='center' style={{ flex: '1 1 190px', minWidth: 160 }}>
                                    <Text type='secondary' style={{ fontSize: 12 }}>Branch</Text>
                                    <Select
                                        size='small'
                                        value={selectedBranch}
                                        onChange={value => setSelectedBranch(value)}
                                        options={branchOptions}
                                        style={{ flex: 1, minWidth: 110 }}
                                    />
                                </Space>
                            )}
                            <Space size={6} align='center' style={{ flex: '1 1 330px', minWidth: 285 }}>
                                <Text type='secondary' style={{ fontSize: 12 }}>Period</Text>
                                <RangePicker
                                    size='small'
                                    value={range}
                                    onChange={v => v && setRange(v as [Dayjs, Dayjs])}
                                    presets={[
                                        { label: 'This Month', value: [dayjs().startOf('month'), dayjs().endOf('month')] },
                                        { label: 'This Quarter', value: getFiscalQuarterRange() },
                                        { label: 'YTD', value: getFiscalYtdRange() }
                                    ]}
                                    style={{ flex: 1, minWidth: 240 }}
                                    allowClear={false}
                                />
                            </Space>

                            <Space size={8} align='center' style={{ flex: '0 0 auto' }}>
                                <Segmented
                                    size='small'
                                    value={view}
                                    onChange={v => setView(v as any)}
                                    options={['Interventions', 'Incubatees', 'Facilitators', 'Risk']}
                                />
                                {isMainDept && (
                                    <Button
                                        size='small'
                                        type='primary'
                                        icon={<FileTextOutlined />}
                                        loading={exporting}
                                        onClick={() => setReportChooserOpen(true)}
                                        disabled={isAllPrograms}
                                    >
                                        Reports
                                    </Button>
                                )}
                            </Space>
                        </Space>
                    }
                />

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
            </>
        </div>
    )
}

export default MonitoringReports
