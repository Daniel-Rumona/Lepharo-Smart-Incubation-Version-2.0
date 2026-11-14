import { useCallback, useMemo, useState } from 'react'
import { Col, Grid, Row, Skeleton, theme } from 'antd'
import { useSearchParams } from 'react-router-dom'

import { MotionCard } from '@/components/dashboards/metrics/Header'

import AnalyticsModal from './components/AnalyticsModal'
import NextStepBar from './components/NextStepBar'
import RegisterFilterBar, { DRIVER_LABELS, type CoverageFilter } from './components/RegisterFilterBar'
import RegisterMetricsRow, { type MetricFocus } from './components/RegisterMetricsRow'
import SMEDetailModal from './components/SMEDetailModal'
import SMEDetailPanel from './components/SMEDetailPanel'
import SMEList, {
    isAttentionRow,
    orderRows,
    SORT_OPTIONS,
    type ListMode,
    type ListSort
} from './components/SMEList'
import { matchesServiceRecency, normalizeLower, riskMovement, rowHasDriver } from './riskEngine'
import type { Props, RiskDriverKey, RiskLevel, ServiceRecencyFilter, SMERow } from './types'
import { useSMERiskRegisterData } from './useSMERiskRegisterData'

type StatusFocus = 'staff_delays' | 'rising'

const RISK_LEVELS: RiskLevel[] = ['Low', 'Medium', 'High', 'Critical']
const COVERAGE_FILTERS: CoverageFilter[] = ['all', 'fully_covered', 'partially_covered', 'not_serviced']
const SERVICE_FILTERS: ServiceRecencyFilter[] = ['all', 'one_month', 'three_months', 'six_months', 'never_serviced']
const STATUS_FOCUSES: StatusFocus[] = ['staff_delays', 'rising']

const PARAM_DEFAULTS: Record<string, string> = {
    risk: 'all',
    coverage: 'all',
    service: 'all',
    driver: 'all',
    dept: 'all',
    group: 'all',
    focus: 'none',
    list: 'attention',
    sort: 'risk'
}

const pick = <T extends string>(value: string | null, allowed: readonly T[], fallback: T): T =>
    allowed.includes(value as T) ? (value as T) : fallback

export default function SMERiskRegisterPage({
    programId: programIdProp,
    parentPadding
}: Props) {
    const {
        loading,
        rows,
        resolvedProgramId,
        isDepartmentScopedView,
        scopedDepartment,
        departmentScopeLabel,
        getSMEChallenges,
        getCommunicationAttempts,
        getReminderEmails,
        getBounceStatus
    } = useSMERiskRegisterData(programIdProp)
    const { token } = theme.useToken()
    const screens = Grid.useBreakpoint()
    const twoPanel = Boolean(screens.xl)

    // The view lives in the address, so refresh, Back and shared links keep it.
    const [params, setParams] = useSearchParams()
    const searchText = params.get('q') ?? ''
    const riskFilter = pick<'all' | RiskLevel>(params.get('risk'), ['all', ...RISK_LEVELS], 'all')
    const coverageFilter = pick(params.get('coverage'), COVERAGE_FILTERS, 'all')
    const serviceRecencyFilter = pick(params.get('service'), SERVICE_FILTERS, 'all')
    const driverFilter = pick<RiskDriverKey | 'all'>(
        params.get('driver'),
        ['all', ...(Object.keys(DRIVER_LABELS) as RiskDriverKey[])],
        'all'
    )
    const departmentFilter = params.get('dept') || 'all'
    const groupFilter = params.get('group') || 'all'
    const statusFocus = pick<StatusFocus | 'none'>(params.get('focus'), ['none', ...STATUS_FOCUSES], 'none')
    const listMode = pick<ListMode>(params.get('list'), ['attention', 'all'], 'attention')
    const listSort = pick<ListSort>(params.get('sort'), SORT_OPTIONS.map(option => option.value), 'risk')
    const selectedId = params.get('sme')

    const updateParams = useCallback(
        (changes: Record<string, string | null>) => {
            setParams(
                current => {
                    const next = new URLSearchParams(current)
                    Object.entries(changes).forEach(([key, value]) => {
                        // Defaults stay out of the address so plain links stay short.
                        if (value === null || value === '' || value === PARAM_DEFAULTS[key]) {
                            next.delete(key)
                        } else {
                            next.set(key, value)
                        }
                    })
                    return next
                },
                { replace: true }
            )
        },
        [setParams]
    )

    const [analyticsOpen, setAnalyticsOpen] = useState(false)
    const [modalOpen, setModalOpen] = useState(false)

    // Every filter but the department and driver ones; their counts come from this.
    const baseRows = useMemo(() => {
        const text = normalizeLower(searchText)

        return rows.filter(row => {
            // Search finds one SME; groups and departments have their own filters
            // (a group is a single letter, which every name would match).
            const matchesSearch =
                !text ||
                normalizeLower(row.smeName).includes(text) ||
                normalizeLower(row.ownerName).includes(text)

            const matchesGroup = groupFilter === 'all' || (row.currentGroup || '') === groupFilter

            const matchesRisk =
                riskFilter === 'all' || row.riskLevel === riskFilter

            const matchesCoverage =
                coverageFilter === 'all' ||
                (coverageFilter === 'fully_covered' &&
                    row.expectedDepartmentsCount > 0 &&
                    row.missingDepartmentsCount === 0) ||
                (coverageFilter === 'partially_covered' &&
                    row.expectedDepartmentsCount > 0 &&
                    row.servicedDepartmentsCount > 0 &&
                    row.missingDepartmentsCount > 0) ||
                (coverageFilter === 'not_serviced' &&
                    row.expectedDepartmentsCount > 0 &&
                    row.servicedDepartmentsCount === 0)

            const matchesFocus =
                statusFocus === 'none' ||
                (statusFocus === 'staff_delays' && row.staffDelayDepartments.length > 0) ||
                (statusFocus === 'rising' &&
                    ['escalated', 'up'].includes(riskMovement(row).kind))

            return (
                matchesSearch &&
                matchesGroup &&
                matchesRisk &&
                matchesCoverage &&
                matchesFocus &&
                matchesServiceRecency(row, serviceRecencyFilter)
            )
        })
    }, [rows, searchText, groupFilter, riskFilter, coverageFilter, serviceRecencyFilter, statusFocus])

    // The groups SMEs are in, for the Group filter; from every row so a choice never vanishes.
    const groupOptions = useMemo(
        () =>
            [...new Set(rows.map(row => row.currentGroup).filter((group): group is string => Boolean(group)))].sort(
                (a, b) => a.localeCompare(b, undefined, { numeric: true })
            ),
        [rows]
    )

    // A department matches where it still has to act: plan not reviewed, waiting on the SME, or nothing delivered.
    const rowsBeforeDriver = useMemo(
        () =>
            departmentFilter === 'all'
                ? baseRows
                : baseRows.filter(row =>
                    row.missingDepartments.some(department => department.departmentId === departmentFilter)
                ),
        [baseRows, departmentFilter]
    )

    // Each department with outstanding work and how many SMEs in view it affects.
    const departmentCounts = useMemo(() => {
        const counts = new Map<string, { id: string; name: string; count: number }>()
        baseRows.forEach(row =>
            row.missingDepartments.forEach(department => {
                const entry = counts.get(department.departmentId) ?? {
                    id: department.departmentId,
                    name: department.departmentName,
                    count: 0
                }
                entry.count += 1
                counts.set(department.departmentId, entry)
            })
        )
        return [...counts.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    }, [baseRows])

    const filteredRows = useMemo(
        () =>
            driverFilter === 'all'
                ? rowsBeforeDriver
                : rowsBeforeDriver.filter(row => rowHasDriver(row, driverFilter)),
        [rowsBeforeDriver, driverFilter]
    )

    const metrics = useMemo(() => {
        const moves = filteredRows.map(row => riskMovement(row).kind)
        return {
            total: filteredRows.length,
            withStaffDelays: filteredRows.filter(row => row.staffDelayDepartments.length > 0).length,
            notServiced: filteredRows.filter(
                row => row.expectedDepartmentsCount > 0 && row.servicedDepartmentsCount === 0
            ).length,
            critical: filteredRows.filter(row => row.riskLevel === 'Critical').length,
            rising: moves.filter(kind => kind === 'escalated' || kind === 'up').length,
        }
    }, [filteredRows])

    const listRows = useMemo(
        () => orderRows(filteredRows, listMode, listSort),
        [filteredRows, listMode, listSort]
    )
    const attentionCount = useMemo(() => filteredRows.filter(isAttentionRow).length, [filteredRows])

    // Counted before the driver filter, so picking one driver still shows the others' counts.
    const driverCounts = useMemo(
        () =>
            (Object.keys(DRIVER_LABELS) as RiskDriverKey[])
                .map(key => ({ key, count: rowsBeforeDriver.filter(row => rowHasDriver(row, key)).length }))
                .filter(item => item.count > 0 || item.key === driverFilter)
                .sort((a, b) => b.count - a.count),
        [rowsBeforeDriver, driverFilter]
    )

    // Wide screens always show someone: the chosen SME while it is in the list, else the first.
    const chosenRow = listRows.find(row => row.participantId === selectedId) ?? null
    const selectedRow: SMERow | null = twoPanel ? chosenRow ?? listRows[0] ?? null : chosenRow

    const selectRow = (row: SMERow) => {
        updateParams({ sme: row.participantId })
        if (!twoPanel) setModalOpen(true)
    }

    const activeFocus: MetricFocus | null =
        statusFocus !== 'none'
            ? statusFocus
            : coverageFilter === 'not_serviced'
                ? 'not_serviced'
                : riskFilter === 'Critical'
                    ? 'critical'
                    : null

    const filtersCleared = {
        q: null,
        risk: null,
        coverage: null,
        service: null,
        driver: null,
        dept: null,
        group: null,
        focus: null
    }

    const onMetricClick = (focus: MetricFocus | 'all') => {
        if (focus === 'all' || focus === activeFocus) {
            updateParams(filtersCleared)
            return
        }
        updateParams({
            ...filtersCleared,
            list: 'all',
            risk: focus === 'critical' ? 'Critical' : null,
            coverage: focus === 'not_serviced' ? 'not_serviced' : null,
            focus: focus === 'staff_delays' || focus === 'rising' ? focus : null
        })
    }

    const panelHeight = 'max(560px, calc(100vh - 120px))'

    const detailProps = {
        row: selectedRow,
        nextStep: selectedRow ? <NextStepBar row={selectedRow} /> : null,
        isDepartmentScopedView,
        resolvedProgramId,
        scopedDepartmentId: scopedDepartment?.departmentId,
        scopedDepartmentName: scopedDepartment?.departmentName,
        getSMEChallenges,
        getCommunicationAttempts,
        getReminderEmails,
        getBounceStatus
    }

    if (loading) {
        return (
            <div
                style={{ padding: parentPadding, minHeight: '100vh' }}
                aria-busy="true"
                aria-label="Loading SME risk register"
            >
                <Row gutter={[12, 12]}>
                    {[0, 1, 2, 3].map(item => (
                        <Col key={item} xs={12} xl={6}>
                            <MotionCard>
                                <Skeleton active title={{ width: 100 }} paragraph={{ rows: 1 }} />
                            </MotionCard>
                        </Col>
                    ))}
                </Row>

                <Row gutter={16} style={{ marginTop: 16 }}>
                    <Col xs={24} xl={9}>
                        <MotionCard>
                            {[0, 1, 2, 3, 4, 5].map(item => (
                                <div
                                    key={item}
                                    style={{
                                        padding: '12px 0',
                                        borderTop: item === 0 ? undefined : `1px solid ${token.colorBorderSecondary}`
                                    }}
                                >
                                    <Skeleton active avatar title={{ width: '50%' }} paragraph={{ rows: 1, width: ['80%'] }} />
                                </div>
                            ))}
                        </MotionCard>
                    </Col>
                    {twoPanel ? (
                        <Col xl={15}>
                            <MotionCard>
                                <Skeleton active avatar paragraph={{ rows: 8 }} />
                            </MotionCard>
                        </Col>
                    ) : null}
                </Row>
            </div>
        )
    }

    return (
        <div style={{ padding: parentPadding, minHeight: '100vh' }}>
            <RegisterMetricsRow
                metrics={metrics}
                activeFocus={activeFocus}
                onFocusClick={onMetricClick}
            />

            <div style={{ height: 16 }} />

            <RegisterFilterBar
                isDepartmentScopedView={isDepartmentScopedView}
                searchText={searchText}
                onSearchTextChange={value => updateParams({ q: value })}
                listMode={listMode}
                onListModeChange={mode => updateParams({ list: mode })}
                attentionCount={attentionCount}
                allCount={filteredRows.length}
                riskFilter={riskFilter}
                onRiskFilterChange={value => updateParams({ risk: value })}
                coverageFilter={coverageFilter}
                onCoverageFilterChange={value => updateParams({ coverage: value })}
                serviceRecencyFilter={serviceRecencyFilter}
                onServiceRecencyFilterChange={value => updateParams({ service: value })}
                driverFilter={driverFilter}
                onDriverFilterChange={value => updateParams({ driver: value })}
                driverCounts={driverCounts}
                departmentFilter={departmentFilter}
                onDepartmentFilterChange={value => updateParams({ dept: value })}
                departmentCounts={departmentCounts}
                groupFilter={groupFilter}
                onGroupFilterChange={value => updateParams({ group: value })}
                groupOptions={groupOptions}
                onResetFilters={() =>
                    updateParams({
                        risk: null,
                        coverage: null,
                        service: null,
                        driver: null,
                        dept: null,
                        group: null,
                        focus: null
                    })
                }
                onOpenAnalytics={() => setAnalyticsOpen(true)}
            />

            <div
                style={{
                    display: 'grid',
                    gridTemplateColumns: twoPanel ? 'minmax(320px, 380px) minmax(0, 1fr)' : 'minmax(0, 1fr)',
                    gap: 16
                }}
            >
                <SMEList
                    rows={listRows}
                    mode={listMode}
                    onModeChange={mode => updateParams({ list: mode })}
                    allCount={filteredRows.length}
                    sort={listSort}
                    onSortChange={sort => updateParams({ sort })}
                    selectedKey={twoPanel || modalOpen ? selectedRow?.key ?? null : null}
                    onSelect={selectRow}
                    isDepartmentScopedView={isDepartmentScopedView}
                    height={twoPanel ? panelHeight : 'auto'}
                />

                {twoPanel ? (
                    <div
                        style={{
                            height: panelHeight,
                            overflowY: 'auto',
                            minWidth: 0,
                            padding: 20,
                            border: `1px solid ${token.colorBorderSecondary}`,
                            borderRadius: 14,
                            background: token.colorBgContainer
                        }}
                    >
                        {selectedRow ? (
                            <SMEDetailPanel {...detailProps} />
                        ) : (
                            <div
                                style={{
                                    height: '100%',
                                    display: 'grid',
                                    placeItems: 'center',
                                    color: token.colorTextTertiary
                                }}
                            >
                                Choose an SME to see its risk detail
                            </div>
                        )}
                    </div>
                ) : null}
            </div>

            {!twoPanel ? (
                <SMEDetailModal
                    {...detailProps}
                    open={modalOpen}
                    onClose={() => setModalOpen(false)}
                />
            ) : null}

            <AnalyticsModal
                open={analyticsOpen}
                onClose={() => setAnalyticsOpen(false)}
                isDepartmentScopedView={isDepartmentScopedView}
                departmentScopeLabel={departmentScopeLabel}
                rows={filteredRows}
            />
        </div>
    )
}
