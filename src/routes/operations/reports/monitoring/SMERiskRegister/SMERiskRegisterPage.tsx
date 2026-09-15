import { useMemo, useState } from 'react'
import { Card, Col, Row, Skeleton } from 'antd'

import { MotionCard } from '@/components/dashboards/metrics/Header'

import AnalyticsModal from './components/AnalyticsModal'
import RegisterFilterBar from './components/RegisterFilterBar'
import RegisterMetricsRow from './components/RegisterMetricsRow'
import RegisterTable from './components/RegisterTable'
import SMEDetailModal from './components/SMEDetailModal'
import { matchesServiceRecency, normalizeLower } from './riskEngine'
import type { Props, RiskLevel, ServiceRecencyFilter, SMERow } from './types'
import { useSMERiskRegisterData } from './useSMERiskRegisterData'

type CoverageFilter =
    | 'all'
    | 'fully_covered'
    | 'partially_covered'
    | 'not_serviced'

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

    const [searchText, setSearchText] = useState('')
    const [riskFilter, setRiskFilter] = useState<'all' | RiskLevel>('all')
    const [coverageFilter, setCoverageFilter] =
        useState<CoverageFilter>('all')
    const [serviceRecencyFilter, setServiceRecencyFilter] =
        useState<ServiceRecencyFilter>('all')
    const [analyticsOpen, setAnalyticsOpen] = useState(false)
    const [selectedRow, setSelectedRow] = useState<SMERow | null>(null)

    const filteredRows = useMemo(() => {
        const text = normalizeLower(searchText)

        return rows.filter(row => {
            const matchesSearch =
                !text ||
                normalizeLower(row.smeName).includes(text) ||
                normalizeLower(row.ownerName).includes(text) ||
                normalizeLower(row.currentGroup).includes(text) ||
                row.expectedDepartments.some(department =>
                    normalizeLower(department.departmentName).includes(text)
                ) ||
                row.servicedDepartments.some(department =>
                    normalizeLower(department.departmentName).includes(text)
                ) ||
                row.missingDepartments.some(department =>
                    normalizeLower(department.departmentName).includes(text)
                ) ||
                row.expectedDepartments.some(department =>
                    department.expectedInterventionTitles.some(title =>
                        normalizeLower(title).includes(text)
                    )
                )

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

            const matchesService = matchesServiceRecency(
                row,
                serviceRecencyFilter
            )

            return (
                matchesSearch &&
                matchesRisk &&
                matchesCoverage &&
                matchesService
            )
        })
    }, [
        rows,
        searchText,
        riskFilter,
        coverageFilter,
        serviceRecencyFilter
    ])

    const metrics = useMemo(
        () => ({
            total: filteredRows.length,
            fullyCovered: filteredRows.filter(
                row =>
                    row.expectedDepartmentsCount > 0 &&
                    row.missingDepartmentsCount === 0
            ).length,
            withMissing: filteredRows.filter(
                row => row.missingDepartmentsCount > 0
            ).length,
            notServiced: filteredRows.filter(
                row =>
                    row.expectedDepartmentsCount > 0 &&
                    row.servicedDepartmentsCount === 0
            ).length,
            critical: filteredRows.filter(
                row => row.riskLevel === 'Critical'
            ).length,
            totalTouches: filteredRows.reduce(
                (sum, row) => sum + row.totalTouches,
                0
            )
        }),
        [filteredRows]
    )

    const missingDeptChartData = useMemo(() => {
        const map = new Map<string, number>()

        filteredRows.forEach(row => {
            row.missingDepartments.forEach(department => {
                map.set(
                    department.departmentName,
                    (map.get(department.departmentName) ?? 0) + 1
                )
            })
        })

        return [...map.entries()]
            .map(([departmentName, count]) => ({
                departmentName,
                count
            }))
            .sort((a, b) => b.count - a.count)
            .slice(0, 10)
    }, [filteredRows])

    const servicedTouchRows = useMemo(
        () =>
            filteredRows
                .filter(row => Number(row.totalTouches || 0) > 0)
                .sort(
                    (a, b) =>
                        Number(b.totalTouches || 0) -
                        Number(a.totalTouches || 0)
                )
                .slice(0, 10),
        [filteredRows]
    )

    const neglectedRows = useMemo(
        () =>
            filteredRows
                .filter(
                    row =>
                        Number(row.totalTouches || 0) === 0 ||
                        (row.daysSinceLastService ?? 0) >= 30
                )
                .sort((a, b) => {
                    if (b.riskScore !== a.riskScore) {
                        return b.riskScore - a.riskScore
                    }

                    if (
                        (b.daysSinceLastService || 0) !==
                        (a.daysSinceLastService || 0)
                    ) {
                        return (
                            (b.daysSinceLastService || 0) -
                            (a.daysSinceLastService || 0)
                        )
                    }

                    return (
                        b.missingDepartmentsCount -
                        a.missingDepartmentsCount
                    )
                })
                .slice(0, 10),
        [filteredRows]
    )

    if (loading) {
        return (
            <div
                style={{
                    padding: parentPadding,
                    minHeight: '100vh'
                }}
                aria-busy="true"
                aria-label="Loading SME risk register"
            >
                <Row gutter={[12, 12]}>
                    {[0, 1, 2, 3].map(item => (
                        <Col key={item} xs={12} xl={6}>
                            <Card>
                                <Skeleton
                                    active
                                    title={{ width: 100 }}
                                    paragraph={{ rows: 1 }}
                                />
                            </Card>
                        </Col>
                    ))}
                </Row>

                <Card style={{ marginTop: 16 }}>
                    <Skeleton
                        active
                        title={{ width: 180 }}
                        paragraph={{ rows: 1 }}
                    />

                    <div style={{ height: 12 }} />

                    {[0, 1, 2, 3, 4].map(item => (
                        <div
                            key={item}
                            style={{
                                padding: '14px 0',
                                borderTop:
                                    item === 0
                                        ? undefined
                                        : '1px solid rgba(0,0,0,.06)'
                            }}
                        >
                            <Skeleton
                                active
                                avatar
                                title={{ width: '36%' }}
                                paragraph={{
                                    rows: 1,
                                    width: ['72%']
                                }}
                            />
                        </div>
                    ))}
                </Card>
            </div>
        )
    }

    return (
        <div
            style={{
                padding: parentPadding,
                minHeight: '100vh'
            }}
        >
            <RegisterMetricsRow
                metrics={metrics}
                isDepartmentScopedView={isDepartmentScopedView}
                departmentScopeLabel={departmentScopeLabel}
            />

            <div style={{ height: 16 }} />

            <MotionCard
                styles={{
                    body: {
                        padding: 0
                    }
                }}
                filterBarProps={{
                    marginBottom: 0,
                    padding: 14
                }}
                filterBar={
                    <RegisterFilterBar
                        isDepartmentScopedView={isDepartmentScopedView}
                        searchText={searchText}
                        onSearchTextChange={setSearchText}
                        riskFilter={riskFilter}
                        onRiskFilterChange={setRiskFilter}
                        coverageFilter={coverageFilter}
                        onCoverageFilterChange={setCoverageFilter}
                        serviceRecencyFilter={serviceRecencyFilter}
                        onServiceRecencyFilterChange={
                            setServiceRecencyFilter
                        }
                        onOpenAnalytics={() => setAnalyticsOpen(true)}
                    />
                }
            >
                <RegisterTable
                    loading={false}
                    rows={filteredRows}
                    isDepartmentScopedView={isDepartmentScopedView}
                    onViewRow={setSelectedRow}
                />
            </MotionCard>

            <SMEDetailModal
                open={Boolean(selectedRow)}
                row={selectedRow}
                onClose={() => setSelectedRow(null)}
                isDepartmentScopedView={isDepartmentScopedView}
                resolvedProgramId={resolvedProgramId}
                scopedDepartmentId={scopedDepartment?.departmentId}
                scopedDepartmentName={scopedDepartment?.departmentName}
                getSMEChallenges={getSMEChallenges}
                getCommunicationAttempts={getCommunicationAttempts}
                getReminderEmails={getReminderEmails}
                getBounceStatus={getBounceStatus}
            />

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
