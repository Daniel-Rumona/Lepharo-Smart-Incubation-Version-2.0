// MonitoringReports.tsx
import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
    Row,
    Col,
    Typography,
    Badge,
    Button,
    Dropdown,
    Popover,
    message,
    Segmented,
    Select
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
    CloseOutlined,
    DownOutlined,
    FilterOutlined,
    FileTextOutlined,
    BarChartOutlined,
    TeamOutlined,
    SolutionOutlined,
    WarningOutlined,
    AuditOutlined,
    SafetyCertificateOutlined,
    PlayCircleOutlined
} from '@ant-design/icons'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useDepartmentRoles } from '@/services/departmentRoles'

// charts
import InterventionsDeptDrilldownChart from './DepartmentInterventionsDrilldown'
import ProvinceMapDashboard from './ProvinceMap'
import IncubateesInsights, {
    EMPTY_INCUBATEE_FILTERS,
    type IncubateeFilterOptions,
    type IncubateeFilters
} from './IncubateesInsights'
import FacilitatorsTab from './FacilitatorsTab'
import MovsTab from './MovsTab'
import ComplianceTab from './ComplianceTab'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { useDashboardDateRange } from '@/lib/useDashboardDateRange'
import { Helmet } from 'react-helmet'
import { DashboardFilterBar, MotionCard } from '@/components/dashboards/metrics/Header'
import { FilterPanel } from '@/components/workspace'
// The tab / period / Filters / Report bar is shared with the project admin reports.
import '@/routes/projectadmin/reports/projectReports.css'
import { PageSkeleton } from '@/components/shared/PageSkeleton'
import { assignedInterventionService } from '@/services/assignedInterventionService'
import { filterReportRecords } from '@/utils/reportVisibility'

// DOCX export + Programme Summary builder
import { exportMonthlyDepartmentReportDocx } from '@/utils/monthlyReportDocx'
import { buildConsolidatedMeProgramReport } from '@/utils/buildProgramSummaryReportWithCharts'
import type { MonthlyReportData } from '@/utils/monthlyReportDocx'
import { buildExecutiveQuarterlyReportData } from '@/utils/buildExecutiveQuarterlyReport'
import { fillDocxTemplateAndDownload } from '@/utils/docxTemplateFill'
import RiskTab from './RiskTab'
import MonitoringReportPlayer from './MonitoringReportPlayer'
import { useColorMode } from '@/contexts/ThemeContext'

const { Text } = Typography

// A Reports menu item: the action, with a one-line description under it.
const reportMenuLabel = (title: string, description: string) => (
    <div style={{ padding: '2px 0' }}>
        <div>{title}</div>
        <Text type='secondary' style={{ fontSize: 12 }}>{description}</Text>
    </div>
)

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
    departmentId?: string
    departmentName?: string
    branchName?: string
    status?: string
    interventionDate?: any
}

const asDate = (v: any) =>
    v?.toDate?.() ??
    (v instanceof Date ? v : typeof v === 'string' ? new Date(v) : undefined)

const MonitoringReports: React.FC = () => {
    const { user } = useFullIdentity() as any
    const { nameOf, idForRole } = useDepartmentRoles()
    const { isDark } = useColorMode()

    // use the hook properly
    const { programId, activeProgramId, isAllPrograms } = useActiveProgramId()

    const [interventions, setInterventions] = useState<Intervention[]>([])
    const [departments, setDepartments] = useState<Record<string, string>>({})
    const [initialLoading, setInitialLoading] = useState(true)
    const hasLoadedRef = useRef(false)

    const [isMainDept, setIsMainDept] = useState(false)
    const [exporting, setExporting] = useState(false)

    // The reporting window comes from the period control in the topbar, shared
    // with the other dashboards. "All time" has no bounds, but the charts and
    // exports here need real dates, so it becomes everything up to today.
    const { range: dashboardRange, label: periodLabel } = useDashboardDateRange()
    const range = useMemo<[Dayjs, Dayjs]>(
        () => dashboardRange ?? [dayjs('2000-01-01').startOf('day'), dayjs().endOf('day')],
        [dashboardRange]
    )
    const [selectedDepartmentId, setSelectedDepartmentId] = useState<'all' | string>('all')
    const [incubateeFilters, setIncubateeFilters] = useState<IncubateeFilters>(EMPTY_INCUBATEE_FILTERS)
    const [incubateeFilterOptions, setIncubateeFilterOptions] = useState<IncubateeFilterOptions | null>(null)
    const [isMultiBranch, setIsMultiBranch] = useState(false)
    const [playerOpen, setPlayerOpen] = useState(false)
    const [playerData, setPlayerData] = useState<MonthlyReportData | null>(null)
    const [playerLoading, setPlayerLoading] = useState(false)

    const [view, setView] = useState<'Interventions' | 'Incubatees' | 'Facilitators' | 'MOVs' | 'Compliance' | 'Risk'>(
        'Interventions'
    )

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

    // Department doesn't apply to the incubatee view, which has its own
    // demographic filters instead.
    const showDepartmentFilter = view !== 'Incubatees'
    const showIncubateeFilters = view === 'Incubatees' && !!incubateeFilterOptions

    const activeFilterCount =
        (showDepartmentFilter && selectedDepartmentId !== 'all' ? 1 : 0) +
        (view === 'Incubatees'
            ? Object.values(incubateeFilters).filter(values => values.length > 0).length
            : 0)

    const clearFilters = () => {
        setSelectedDepartmentId('all')
        setIncubateeFilters(EMPTY_INCUBATEE_FILTERS)
    }

    const setIncubateeFilter = (key: keyof IncubateeFilters) => (values: string[]) =>
        setIncubateeFilters(current => ({ ...current, [key]: values }))

    // Same filter popover as the project admin reports: labelled fields and a
    // Reset link.
    const filterField = (id: string, label: string, control: React.ReactNode) => (
        <div key={id}>
            <label className='ws-filter-label' htmlFor={id}>{label}</label>
            {control}
        </div>
    )

    const multiFilter = (key: keyof IncubateeFilters, label: string, values: string[]) =>
        filterField(
            `me-${key}`,
            label,
            <Select
                id={`me-${key}`}
                mode='multiple'
                allowClear
                maxTagCount='responsive'
                placeholder={`All ${label.toLowerCase()}`}
                value={incubateeFilters[key]}
                onChange={setIncubateeFilter(key)}
                options={values.map(value => ({ label: value, value }))}
                style={{ width: '100%' }}
            />
        )

    const hasFilters = showDepartmentFilter || showIncubateeFilters

    const filtersPanel = hasFilters ? (
        <FilterPanel canReset={activeFilterCount > 0} onReset={clearFilters}>
            {showDepartmentFilter && filterField(
                'me-department',
                'Department',
                <Select
                    id='me-department'
                    value={selectedDepartmentId}
                    onChange={value => setSelectedDepartmentId(value)}
                    options={departmentOptions}
                    showSearch
                    optionFilterProp='label'
                    style={{ width: '100%' }}
                />
            )}
            {showIncubateeFilters && incubateeFilterOptions && (
                <>
                    {multiFilter('gender', 'Genders', incubateeFilterOptions.genders)}
                    {multiFilter('ageBand', 'Age groups', incubateeFilterOptions.ageBands)}
                    {multiFilter('sector', 'Sectors', incubateeFilterOptions.sectors)}
                    {incubateeFilterOptions.canFilterProvince &&
                        multiFilter('province', 'Provinces', incubateeFilterOptions.provinces)}
                    {multiFilter('bee', 'B-BBEE levels', incubateeFilterOptions.beeLevels)}
                </>
            )}
        </FilterPanel>
    ) : null

    // One line beside the period saying what the open view is filtered by;
    // an active filter is highlighted with a clear button.
    const incubateeFilterLabels: Record<keyof IncubateeFilters, string> = {
        gender: 'Gender',
        ageBand: 'Age',
        sector: 'Sector',
        province: 'Province',
        bee: 'B-BBEE'
    }
    const filterSummary: Array<{ label: string; value: string; onClear?: () => void }> = [
        ...(showDepartmentFilter
            ? [{
                label: 'Department',
                value: selectedDepartmentId === 'all' ? 'All' : departments[selectedDepartmentId] || 'Selected',
                onClear: selectedDepartmentId === 'all' ? undefined : () => setSelectedDepartmentId('all')
            }]
            : []),
        ...(view === 'Incubatees'
            ? (Object.keys(incubateeFilterLabels) as Array<keyof IncubateeFilters>)
                .filter(key => incubateeFilters[key].length > 0)
                .map(key => ({
                    label: incubateeFilterLabels[key],
                    value: incubateeFilters[key].length > 2
                        ? `${incubateeFilters[key].length} selected`
                        : incubateeFilters[key].join(', '),
                    onClear: () => setIncubateeFilter(key)([])
                }))
            : [])
    ]

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
            reportTitleDepartmentName: `${nameOf(idForRole('monitoring'), 'Monitoring & Evaluation')} (Consolidated)`,
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
        <div style={{ padding: 24, minHeight: '100vh' }}>
            <Helmet>
                <title>Monitoring Reports & Analytics</title>
            </Helmet>
            {initialLoading ? (
                <PageSkeleton variant='analytics' />
            ) : (
            <>
                {/* Same bar as the project admin reports: tabs, what's shown
                    (period and active filters), Filters, Report. */}
                <DashboardFilterBar>
                    <div className='pr-bar'>
                        <Segmented
                            className='pr-tabs'
                            value={view}
                            onChange={v => setView(v as any)}
                            options={[
                                { value: 'Interventions', label: 'Interventions', icon: <BarChartOutlined /> },
                                { value: 'Incubatees', label: 'Incubatees', icon: <TeamOutlined /> },
                                { value: 'Facilitators', label: 'Facilitators', icon: <SolutionOutlined /> },
                                { value: 'MOVs', label: 'MOVs', icon: <AuditOutlined /> },
                                { value: 'Compliance', label: 'Compliance', icon: <SafetyCertificateOutlined /> },
                                { value: 'Risk', label: 'Risk', icon: <WarningOutlined /> }
                            ]}
                        />
                        <div className='pr-scope' aria-label='Showing'>
                            <span className='pr-scope-item' title='Change the period from the calendar button in the top bar'>
                                <span className='pr-scope-label'>Period:</span> {periodLabel}
                            </span>
                            {filterSummary.map(item => (
                                <span key={item.label} className={`pr-scope-item${item.onClear ? ' is-active' : ''}`}>
                                    <span className='pr-scope-label'>{item.label}:</span> {item.value}
                                    {item.onClear ? (
                                        <button
                                            type='button'
                                            className='pr-scope-clear'
                                            aria-label={`Clear ${item.label.toLowerCase()} filter`}
                                            onClick={item.onClear}
                                        >
                                            <CloseOutlined />
                                        </button>
                                    ) : null}
                                </span>
                            ))}
                        </div>
                        {filtersPanel ? (
                            <Popover content={filtersPanel} trigger='click' placement='bottomRight' title='Filters'>
                                <Badge count={activeFilterCount} size='small' offset={[-6, 4]}>
                                    <Button size='large' icon={<FilterOutlined />}>
                                        Filters
                                    </Button>
                                </Badge>
                            </Popover>
                        ) : null}
                        {isMainDept && (
                                <Dropdown
                                    trigger={['click']}
                                    placement='bottomRight'
                                    disabled={exporting || playerLoading}
                                    menu={{
                                        items: [
                                            {
                                                key: 'play',
                                                icon: <PlayCircleOutlined />,
                                                label: reportMenuLabel(
                                                    'Play programme summary',
                                                    'An animated walkthrough of the selected period'
                                                ),
                                                onClick: () => void handlePlayProgrammeSummary()
                                            },
                                            { type: 'divider' },
                                            {
                                                key: 'programme',
                                                icon: <BarChartOutlined />,
                                                disabled: isAllPrograms,
                                                label: reportMenuLabel(
                                                    'Export programme report',
                                                    isAllPrograms
                                                        ? 'Choose a programme first'
                                                        : 'Detailed: interventions, departments, incubatees and delivery'
                                                ),
                                                onClick: () => void handleExportProgrammeSummary()
                                            },
                                            {
                                                key: 'executive',
                                                icon: <FileTextOutlined />,
                                                disabled: isAllPrograms,
                                                label: reportMenuLabel(
                                                    'Export executive report',
                                                    isAllPrograms
                                                        ? 'Choose a programme first'
                                                        : 'Leadership view: progress, outcomes and risks'
                                                ),
                                                onClick: () => void handleExportExecutiveReport()
                                            }
                                        ]
                                    }}
                                >
                                    <Button
                                        size='large'
                                        shape='round'
                                        type='primary'
                                        icon={<FileTextOutlined />}
                                        loading={exporting || playerLoading}
                                    >
                                        Report <DownOutlined />
                                    </Button>
                                </Dropdown>
                        )}
                    </div>
                </DashboardFilterBar>

                {view === 'Interventions' && (
                    <Row gutter={[16, 16]}>
                        <Col xs={24}>
                            <InterventionsDeptDrilldownChart
                                title='Department intervention snapshot'
                                programId={activeProgramId}
                                departmentId={selectedDepartmentId === 'all' ? undefined : selectedDepartmentId}
                                dateFrom={dateFrom}
                                dateTo={dateTo}
                            />
                        </Col>
                        <Col xs={24}>
                            <ProvinceMapDashboard
                                metric='interventions'
                                dateFrom={range[0].toDate()}
                                dateTo={range[1].toDate()}
                                programId={activeProgramId}
                            />
                        </Col>
                    </Row>
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
                            filters={incubateeFilters}
                            onFilterOptionsChange={setIncubateeFilterOptions}
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

                {view === 'MOVs' && (
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3 }}
                        style={{ marginTop: 16 }}
                    >
                        <MovsTab
                            programId={activeProgramId}
                            departmentId={effectiveDepartmentIdForConsultants}
                            dateFrom={dateFrom}
                            dateTo={dateTo}
                        />
                    </motion.div>
                )}

                {view === 'Compliance' && (
                    <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3 }}
                        style={{ marginTop: 16 }}
                    >
                        <ComplianceTab
                            programId={activeProgramId}
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
                        <RiskTab programId={activeProgramId} />
                    </motion.div>
                )}

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
