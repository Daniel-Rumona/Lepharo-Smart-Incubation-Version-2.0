import React, { useEffect, useMemo, useState, useCallback } from 'react'
import { Drawer, Row, Col, Segmented, Tag, Empty, Button, Grid } from 'antd'
import { TeamOutlined, DollarCircleOutlined, UserOutlined, FileProtectOutlined, UsergroupAddOutlined, ThunderboltOutlined, LineChartOutlined } from '@ant-design/icons'
import { Helmet } from 'react-helmet'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useColorMode } from '@/contexts/ThemeContext'
import { isQuantilytixDomain } from '@/utils/quantilytixAccess'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { MetricTile } from '@/components/dashboards/metrics/MetricTile'
import dayjs, { Dayjs } from 'dayjs'
import { PreIncubationContractModal } from '@/components/modals/Contracts/PreIncubationContract'
import GapAnalysisViewModal from '@/routes/gap/view/GapModal'
import { usePageGuides } from '@/components/guide-me'
import TrainingSmesRepository from '@/components/trainings/TrainingSmesRepository'
import { listTrainings as listTrainingsForRepository } from '@/components/trainings/trainingStorage'
import { ALL_DEPTS, ComplianceBucket, InterventionBucket, SmeRow, cleanText, toDateSafe } from './participantsData'
import { EditSmeModal } from './EditSmeModal'
import { motion, useReducedMotion } from 'framer-motion'
import { EntityAvatar } from '@/components/workspace'
import { ParticipantFilters } from './ParticipantFilters'
import { DEFAULT_PARTICIPANT_FILTERS, buildChoices, matchesChoices, type ParticipantFilterState } from './participantFilterDefs'
import { ParticipantList, type ParticipantSort } from './ParticipantList'
import { SME_OVERVIEW_GUIDES } from './smeOverviewGuides'
import { useSmeRows } from './useSmeRows'
import { useSmeDetail, type SmeSection } from './useSmeDetail'
import { useAgreementViewers } from './useAgreementViewers'
import { DemographicsSection } from './DemographicsSection'
import { PerformanceSection } from './PerformanceSection'
import { InterventionsSection } from './InterventionsSection'
import { ComplianceSection } from './ComplianceSection'
import { DetailActions } from './DetailActions'
import { MoaViewerModal } from './MoaViewerModal'
import { DummySmeModal } from './DummySmeModal'
import { ImportSmesModal } from './import/ImportSmesModal'
import { exportAllSmes } from './exportParticipants'
import './participants.css'

const { useBreakpoint } = Grid

const SMEOverview: React.FC = () => {
    const { user } = useFullIdentity()
    const { activeProgramId, isAllPrograms } = useActiveProgramId()
    const navigate = useNavigate()
    const isQuantilytixViewer = isQuantilytixDomain(user?.email)
    const { isDark } = useColorMode()

    // Departments granted "repository" access to a training (Training.access,
    // src/components/trainings/trainingStorage.ts) can view that training's
    // SMEs here via a separate, self-contained view rather than mixed into
    // the incubatee table below, since training-sourced SMEs have none of
    // the intervention/KPI/compliance history that table assumes.
    const [viewMode, setViewMode] = useState<'incubatees' | 'training'>('incubatees')
    const [hasTrainingAccess, setHasTrainingAccess] = useState(false)
    const viewerRecord = user as Record<string, unknown> | null
    const viewerDepartmentId = String(viewerRecord?.departmentId || '').trim()
    const viewerIsCenterCoordinator = viewerRecord?.role === 'projectadmin'
    const viewerAssignedBranch = String(viewerRecord?.assignedBranch || '').trim()
    useEffect(() => {
        let cancelled = false
        if (!viewerDepartmentId && !(viewerIsCenterCoordinator && viewerAssignedBranch)) return
        listTrainingsForRepository()
            .then((trainings) => {
                if (cancelled) return
                setHasTrainingAccess(
                    trainings.some((t) => {
                        const departmentGranted = t.access?.some((a) => a.departmentId === viewerDepartmentId && a.capabilities.includes('repository'))
                        const coordinatorGranted =
                            viewerIsCenterCoordinator && t.centerCoordinatorAccess && t.centers.some((c) => c.id === viewerAssignedBranch)
                        return departmentGranted || coordinatorGranted
                    })
                )
            })
            .catch(() => setHasTrainingAccess(false))
        return () => {
            cancelled = true
        }
    }, [viewerDepartmentId, viewerIsCenterCoordinator, viewerAssignedBranch])


    usePageGuides(SME_OVERVIEW_GUIDES)

    const screens = useBreakpoint()
    const isPhone = !screens.md
    const reduceMotion = useReducedMotion()
    /** Page entrance: tiles, then the filter bar, rise in one after another. */
    const rise = (delay: number) =>
        reduceMotion
            ? {}
            : {
                initial: { opacity: 0, y: 10 },
                animate: { opacity: 1, y: 0 },
                transition: { duration: 0.3, ease: 'easeOut' as const, delay }
            }
    const [detailOpen, setDetailOpen] = useState(false)
    const [editAppId, setEditAppId] = useState<string | null>(null)
    const [segment, setSegment] = useState<SmeSection>('demographics')
    const [reportingRange, setReportingRange] = useState<[Dayjs, Dayjs]>(() => [
        dayjs().subtract(11, 'month').startOf('month'),
        dayjs().endOf('month')
    ])

    const [selectedDeptKey, setSelectedDeptKey] = useState<string | null>(null)
    const [interventionStatusFilter, setInterventionStatusFilter] = useState<InterventionBucket | null>(null)
    const [complianceFilter, setComplianceFilter] = useState<ComplianceBucket | null>(null)

    const [filters, setFilters] = useState<ParticipantFilterState>(DEFAULT_PARTICIPANT_FILTERS)
    const [sort, setSort] = useState<ParticipantSort>('name')
    const patchFilters = (patch: Partial<ParticipantFilterState>) => setFilters(prev => ({ ...prev, ...patch }))
    const [dummySmeModalVisible, setDummySmeModalVisible] = useState(false)
    const [importOpen, setImportOpen] = useState(false)

    const {
        loading,
        rows,
        setRows,
        activeInterventionsBySme,
        selectedAppId,
        setSelectedAppId,
        showHubFilter,
        hasOnboardingAccess,
        reload: loadSMEs
    } = useSmeRows({
        user,
        activeProgramId,
        isAllPrograms,
        isQuantilytixViewer,
        onHubFilterHidden: () => setFilters(prev => ({ ...prev, hub: 'all' }))
    })

    const selectedRow = useMemo(() => rows.find(r => r.appId === selectedAppId) || null, [rows, selectedAppId])
    const detail = useSmeDetail(selectedRow, reportingRange)
    const agreements = useAgreementViewers(selectedRow, detail.selectedApplicationData, detail.selectedParticipantData)

    const hubFilterVisible = showHubFilter
    // Only the filters that would narrow these SMEs are offered (see participantFilterDefs).
    const choices = useMemo(() => buildChoices(rows, { showHub: hubFilterVisible }), [rows, hubFilterVisible])

    const filteredRows = useMemo(() => {
        const term = filters.search.trim().toLowerCase()
        const activeKeys = choices.map(c => c.key)
        return rows.filter(r => {
            if (term && ![r.companyName, r.registrationNumber, r.smmeNo, r.email].some(v => String(v || '').toLowerCase().includes(term))) return false
            return matchesChoices(r, filters, activeKeys)
        })
    }, [rows, filters, choices])

    const onboardedTime = (r: SmeRow) => toDateSafe(r.onboardedAt)?.getTime() ?? 0
    const sortedRows = useMemo(() => {
        const list = [...filteredRows]
        const by: Record<ParticipantSort, (a: SmeRow, b: SmeRow) => number> = {
            name: (a, b) => a.companyName.localeCompare(b.companyName),
            revenue: (a, b) => (b.metrics.totalRevenue || 0) - (a.metrics.totalRevenue || 0),
            employees: (a, b) => (b.metrics.currentEmployees || 0) - (a.metrics.currentEmployees || 0),
            newest: (a, b) => onboardedTime(b) - onboardedTime(a)
        }
        return list.sort(by[sort])
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filteredRows, sort])

    const overviewMetrics = useMemo(() => filteredRows.reduce(
        (totals, row) => ({
            smes: totals.smes + 1,
            revenue: totals.revenue + (row.metrics.totalRevenue || 0),
            employees: totals.employees + (row.metrics.currentEmployees || 0),
            activeInterventions: totals.activeInterventions + (
                activeInterventionsBySme.get(String(row.participantId || row.appId)) || 0
            )
        }),
        { smes: 0, revenue: 0, employees: 0, activeInterventions: 0 }
    ), [activeInterventionsBySme, filteredRows])

    // ?sme=<participantId or appId> (links from reports) opens that SME once the list has it.
    const [searchParams, setSearchParams] = useSearchParams()
    const linkedSme = searchParams.get('sme')
    useEffect(() => {
        if (!linkedSme || !rows.length) return
        const row = rows.find(r => String(r.participantId) === linkedSme || r.appId === linkedSme)
        if (row) {
            setSelectedAppId(row.appId)
            if (isPhone) setDetailOpen(true)
        }
        searchParams.delete('sme')
        setSearchParams(searchParams, { replace: true })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [linkedSme, rows.length])

    // Desktop always shows a detail: keep the selection while it's visible, otherwise take the first row.
    useEffect(() => {
        if (!sortedRows.length) return
        if (!selectedAppId || !sortedRows.some(r => r.appId === selectedAppId)) {
            setSelectedAppId(sortedRows[0].appId)
        }
    }, [sortedRows, selectedAppId])


    const selectSme = (record: SmeRow) => {
        if (isPhone) setDetailOpen(true)
        if (record.appId === selectedAppId) return
        // The open section reloads for the new SME; show its skeleton straight away.
        detail.markSectionLoading(segment)
        setSelectedDeptKey(null)
        setSelectedAppId(record.appId)
    }

    const handleExportAll = useCallback(() => exportAllSmes(filteredRows), [filteredRows])

    const editRow = useMemo(() => rows.find(r => r.appId === editAppId) || null, [rows, editAppId])
    const sectorChoices = useMemo(
        () => Array.from(new Set(rows.map(r => cleanText(r.sector)).filter(Boolean))),
        [rows]
    )

    const handleSmeUpdated = useCallback((appId: string, patch: Partial<SmeRow>) => {
        setRows(prev => prev.map(r => r.appId !== appId ? r : {
            ...r,
            ...patch,
            ownership: patch.ownership ? { ...r.ownership, ...patch.ownership } : r.ownership
        }))
    }, [setRows])

    useEffect(() => {
        setInterventionStatusFilter(null)
        setComplianceFilter(null)
    }, [selectedRow?.appId])

    const { deptGaps } = detail
    useEffect(() => {
        if (!deptGaps.length) {
            setSelectedDeptKey(null)
            return
        }
        if (selectedDeptKey && selectedDeptKey !== ALL_DEPTS && !deptGaps.some(d => d.key === selectedDeptKey)) {
            setSelectedDeptKey(null)
        }
    }, [deptGaps, selectedDeptKey])

    // Shared by the desktop details column and the phone bottom drawer.
    const sectionEnter = reduceMotion
        ? {}
        : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.26, ease: 'easeOut' as const } }

    const renderDetailWorkspace = () => {
        if (!selectedRow) return null
        const sub = [selectedRow.smmeNo, selectedRow.sector, selectedRow.province || selectedRow.town].filter(Boolean).join(' · ')
        return (
            <div className='ws-detail' data-guide='sme-detail-workspace'>
                <MotionCard>
                    <motion.header key={`head-${selectedRow.appId}`} className='ws-detail-head' {...sectionEnter}>
                        <EntityAvatar name={selectedRow.companyName} photo={selectedRow.photoUrl} size={52} />
                        <div className='ws-detail-identity'>
                            <h2 className='ws-detail-name'>{selectedRow.companyName}</h2>
                            {sub && <div className='ws-detail-sub'>{sub}</div>}
                            <div className='ws-detail-tags'>
                                {selectedRow.group && <Tag bordered={false} className='ptx-group-tag'>Group {selectedRow.group}</Tag>}
                                <Tag>{selectedRow.branchName || 'No branch'}</Tag>
                                {isQuantilytixDomain(selectedRow.email) && <Tag color='purple'>Internal / Dummy</Tag>}
                            </div>
                        </div>
                        {/* Same people who can onboard SMEs (plus internal Quantilytix users) can edit their details. */}
                        <DetailActions
                            record={selectedRow}
                            canEdit={hasOnboardingAccess || isQuantilytixViewer}
                            canDelete={isQuantilytixViewer && isQuantilytixDomain(selectedRow.email)}
                            onEdit={record => setEditAppId(record.appId)}
                            onDeleted={loadSMEs}
                        />
                    </motion.header>

                    <div className='ws-detail-tabs' data-guide='sme-detail-tabs'>
                        <Segmented
                            className='ptx-sections'
                            block
                            value={segment}
                            onChange={val => setSegment(val as 'demographics' | 'performance' | 'interventions' | 'compliance')}
                            options={[
                                { label: <span data-guide='sme-demographics-tab'>Demographics</span>, value: 'demographics', icon: <UserOutlined /> },
                                { label: <span data-guide='sme-performance-tab'>Performance</span>, value: 'performance', icon: <LineChartOutlined /> },
                                { label: <span data-guide='sme-interventions-tab'>Interventions</span>, value: 'interventions', icon: <ThunderboltOutlined /> },
                                { label: <span data-guide='sme-compliance-tab'>Compliance</span>, value: 'compliance', icon: <FileProtectOutlined /> }
                            ]}
                        />
                        <div className='ws-detail-pane'>
                            <motion.div key={`${selectedRow.appId}-${segment}`} {...sectionEnter}>
                                {segment === 'demographics' && <div data-guide='sme-demographics-content'><DemographicsSection row={selectedRow} /></div>}
                                {segment === 'performance' && <div data-guide='sme-performance-content' className='ptx-section-pad'>
                                    <PerformanceSection
                                        row={selectedRow}
                                        perfDetail={detail.perfDetail}
                                        financeRevenue={detail.financeRevenue}
                                        jobContracts={detail.jobContracts}
                                        reportingRange={reportingRange}
                                        loading={detail.performanceTrendLoading}
                                        isPhone={isPhone}
                                        isDark={isDark}
                                    />
                                </div>}
                                {segment === 'interventions' && <div data-guide='sme-interventions-content' className='ptx-section-pad'>
                                    <InterventionsSection
                                        row={selectedRow}
                                        interventions={detail.interventions}
                                        loading={detail.interventionsLoading}
                                        diagnosticConfirmed={detail.diagnosticConfirmed}
                                        deptGaps={deptGaps}
                                        reportingRange={reportingRange}
                                        statusFilter={interventionStatusFilter}
                                        onStatusFilterChange={setInterventionStatusFilter}
                                        selectedDeptKey={selectedDeptKey}
                                        onSelectDept={setSelectedDeptKey}
                                        isDark={isDark}
                                    />
                                </div>}
                                {segment === 'compliance' && <div data-guide='sme-compliance-content' className='ptx-section-pad'>
                                    <ComplianceSection
                                        row={selectedRow}
                                        loading={detail.complianceLoading}
                                        stats={detail.complianceStats}
                                        documents={detail.complianceDocuments}
                                        filter={complianceFilter}
                                        onFilterChange={setComplianceFilter}
                                        applicationData={detail.selectedApplicationData}
                                        hasOnboardingAccess={hasOnboardingAccess}
                                        agreementViewerLoading={agreements.agreementViewerLoading}
                                        onOpenGeneratedAgreement={agreements.openGeneratedAgreement}
                                        isPhone={isPhone}
                                    />
                                </div>}
                            </motion.div>
                        </div>
                    </div>
                </MotionCard>
            </div>
        )
    }

    if (viewMode === 'training') {
        return (
            <div
                style={{
                    padding: screens.xs ? 12 : screens.sm ? 16 : 20,
                    minHeight: '100vh'
                }}
            >
                <Helmet>
                    <title>Training SMEs | Smart Incubation</title>
                </Helmet>
                <TrainingSmesRepository onBack={() => setViewMode('incubatees')} />
            </div>
        )
    }

    return (
        <div className='ws-page'>
            <Helmet>
                <title>SME Overview | Smart Incubation</title>
            </Helmet>

            {hasTrainingAccess && (
                <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'flex-end' }}>
                    <Button onClick={() => setViewMode('training')}>View Training SMEs</Button>
                </div>
            )}

            <Row data-guide='sme-overview-metrics' gutter={[12, 12]} style={{ marginBottom: 12 }}>
                {[
                    {
                        key: 'smes',
                        title: isPhone ? 'SMEs' : 'SMEs in view',
                        value: overviewMetrics.smes,
                        icon: <TeamOutlined />,
                        tone: 'accent' as const
                    },
                    {
                        key: 'revenue',
                        title: isPhone ? 'Revenue' : 'Total revenue',
                        value: new Intl.NumberFormat('en-ZA', {
                            style: 'currency', currency: 'ZAR', maximumFractionDigits: isPhone ? 1 : 0,
                            ...(isPhone ? { notation: 'compact' as const } : {})
                        }).format(overviewMetrics.revenue),
                        icon: <DollarCircleOutlined />,
                        tone: 'success' as const
                    },
                    {
                        key: 'employees',
                        title: isPhone ? 'Employees' : 'Current employees',
                        value: overviewMetrics.employees,
                        icon: <UserOutlined />,
                        tone: 'info' as const
                    },
                    {
                        key: 'interventions',
                        title: isPhone ? 'Interventions' : 'Active interventions',
                        value: overviewMetrics.activeInterventions,
                        icon: <UsergroupAddOutlined />,
                        tone: 'warning' as const
                    }
                ].map((t, i) => (
                    <Col key={t.key} xs={12} xl={6}>
                        <motion.div {...rise(i * 0.05)}>
                            <MetricTile
                                title={t.title}
                                value={t.value}
                                icon={t.icon}
                                tone={t.tone}
                                loading={loading}
                                compact={isPhone}
                            />
                        </motion.div>
                    </Col>
                ))}
            </Row>

            <motion.div {...rise(0.22)}>
                <ParticipantFilters
                    filters={filters}
                    onChange={patchFilters}
                    choices={choices}
                    reportingRange={reportingRange}
                    onReportingRangeChange={setReportingRange}
                    canAdd={hasOnboardingAccess}
                    addDisabled={!activeProgramId || isAllPrograms}
                    onAdd={() => navigate(`/operations/participants/new/${activeProgramId}`)}
                    onImport={() => setImportOpen(true)}
                    canAddDummy={isQuantilytixViewer}
                    onAddDummy={() => setDummySmeModalVisible(true)}
                    onExport={handleExportAll}
                />
            </motion.div>

            {!loading && !rows.length ? (
                <MotionCard>
                    <Empty className='ws-detail-empty' description='No accepted SMEs found for this programme.' />
                </MotionCard>
            ) : (
                <div className='ws-layout'>
                    <ParticipantList
                        rows={sortedRows}
                        loading={loading}
                        selectedId={selectedAppId}
                        onSelect={selectSme}
                        sort={sort}
                        onSortChange={setSort}
                        resetKey={JSON.stringify(filters)}
                    />

                    {!isPhone && (
                        <div className='ws-detail-sticky'>
                            {loading ? (
                                <MotionCard loading skeleton='text' skeletonRows={10}>{null}</MotionCard>
                            ) : renderDetailWorkspace() || (
                                <MotionCard>
                                    <Empty className='ws-detail-empty' description='No SMEs match these filters' />
                                </MotionCard>
                            )}
                        </div>
                    )}
                </div>
            )}

            {isPhone && (
                <Drawer
                    className='ws-drawer'
                    open={detailOpen && !!selectedRow}
                    onClose={() => setDetailOpen(false)}
                    placement='right'
                    width='100%'
                    title={selectedRow?.companyName || 'SME'}
                >
                    {renderDetailWorkspace()}
                </Drawer>
            )}

            <EditSmeModal
                row={editRow}
                sectors={sectorChoices}
                onClose={() => setEditAppId(null)}
                onSaved={handleSmeUpdated}
            />

            <PreIncubationContractModal
                open={!!agreements.preIncViewer}
                participantId={selectedRow?.participantId || ''}
                applicationId={selectedRow?.appId}
                onClose={agreements.closePreIncViewer}
                onSigned={async () => undefined}
                readOnly
                signedMeta={agreements.preIncViewer?.meta}
                viewerRole='operations'
            />

            <GapAnalysisViewModal
                open={agreements.gapViewerOpen}
                onClose={agreements.closeGapViewer}
                gapId={agreements.gapViewerId}
                isROM={false}
                allowedSections={'ALL' as any}
                romName={''}
                romEmail={''}
            />

            <MoaViewerModal viewer={agreements.moaViewer} onClose={agreements.closeMoaViewer} />

            <ImportSmesModal
                open={importOpen}
                onClose={() => setImportOpen(false)}
                onImported={() => void loadSMEs()}
                programId={activeProgramId && !isAllPrograms ? activeProgramId : null}
                actor={{ email: user?.email || null, name: user?.name || null }}
            />

            <DummySmeModal
                open={dummySmeModalVisible}
                onClose={() => setDummySmeModalVisible(false)}
                activeProgramId={activeProgramId}
                isAllPrograms={isAllPrograms}
                onCreated={loadSMEs}
            />
        </div >
    )
}

export default SMEOverview
