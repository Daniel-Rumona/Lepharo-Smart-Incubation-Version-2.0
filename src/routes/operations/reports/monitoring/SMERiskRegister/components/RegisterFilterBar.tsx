import { Badge, Button, Input, Popover, Segmented } from 'antd'
import { FilterOutlined, PieChartOutlined, SearchOutlined } from '@ant-design/icons'

import { DashboardFilterBar } from '@/components/dashboards/metrics/Header'
import { ChoiceFilter, FilterPanel } from '@/components/workspace'
import type { RiskDriverKey, RiskLevel, ServiceRecencyFilter } from '../types'
import type { ListMode } from './SMEList'

export type CoverageFilter = 'all' | 'fully_covered' | 'partially_covered' | 'not_serviced'

export const DRIVER_LABELS: Record<RiskDriverKey, string> = {
    inactivity: 'No recent service',
    unresponsive: 'Waiting on SME',
    departments: 'Plan awaiting SME',
    documents: 'Documents',
    expired: 'Expired documents',
    overdue: 'Overdue work',
    appointments: 'Missed appointments',
    declines: 'Declined support',
    revenue: 'Revenue drop',
    followUps: 'Check-backs overdue',
    queries: 'Open queries',
    bounced: 'Email bouncing',
    feedback: 'Low feedback'
}

const RISK_LEVELS: RiskLevel[] = ['Critical', 'High', 'Medium', 'Low']

type Props = {
    isDepartmentScopedView: boolean
    searchText: string
    onSearchTextChange: (value: string) => void
    listMode: ListMode
    onListModeChange: (mode: ListMode) => void
    attentionCount: number
    allCount: number
    riskFilter: 'all' | RiskLevel
    onRiskFilterChange: (value: 'all' | RiskLevel) => void
    coverageFilter: CoverageFilter
    onCoverageFilterChange: (value: CoverageFilter) => void
    serviceRecencyFilter: ServiceRecencyFilter
    onServiceRecencyFilterChange: (value: ServiceRecencyFilter) => void
    driverFilter: 'all' | RiskDriverKey
    onDriverFilterChange: (value: 'all' | RiskDriverKey) => void
    /** How many SMEs in view each driver affects; drivers affecting none are left out. */
    driverCounts: Array<{ key: RiskDriverKey; count: number }>
    /** A department id, or 'all'. */
    departmentFilter: string
    onDepartmentFilterChange: (value: string) => void
    /** Departments with outstanding work and how many SMEs in view each affects. */
    departmentCounts: Array<{ id: string; name: string; count: number }>
    /** A group, e.g. "A", or 'all'. */
    groupFilter: string
    onGroupFilterChange: (value: string) => void
    groupOptions: string[]
    onResetFilters: () => void
    onOpenAnalytics: () => void
}

/** One-line register toolbar, as on the Applications page: search, the list switch, a Filters popover and Analytics. */
export default function RegisterFilterBar({
    isDepartmentScopedView,
    searchText,
    onSearchTextChange,
    listMode,
    onListModeChange,
    attentionCount,
    allCount,
    riskFilter,
    onRiskFilterChange,
    coverageFilter,
    onCoverageFilterChange,
    serviceRecencyFilter,
    onServiceRecencyFilterChange,
    driverFilter,
    onDriverFilterChange,
    driverCounts,
    departmentFilter,
    onDepartmentFilterChange,
    departmentCounts,
    groupFilter,
    onGroupFilterChange,
    groupOptions,
    onResetFilters,
    onOpenAnalytics
}: Props) {
    const activeCount =
        Number(departmentFilter !== 'all') +
        Number(groupFilter !== 'all') +
        Number(riskFilter !== 'all') +
        Number(coverageFilter !== 'all') +
        Number(serviceRecencyFilter !== 'all') +
        Number(driverFilter !== 'all')

    const panel = (
        <FilterPanel canReset={activeCount > 0} onReset={onResetFilters}>
            {/* A department-scoped view already shows one department only. */}
            {!isDepartmentScopedView && (
                <ChoiceFilter
                    id="rr-department"
                    label="Department to act"
                    allLabel="Any department"
                    value={departmentFilter}
                    values={departmentCounts.map(({ id, name, count }) => ({
                        value: id,
                        label: `${name} · ${count}`
                    }))}
                    onChange={onDepartmentFilterChange}
                />
            )}
            <ChoiceFilter
                id="rr-group"
                label="Group"
                allLabel="All groups"
                value={groupFilter}
                values={groupOptions.map(group => ({ value: group, label: `Group ${group}` }))}
                onChange={onGroupFilterChange}
            />
            <ChoiceFilter
                id="rr-risk"
                label="Risk level"
                allLabel="All risk levels"
                value={riskFilter}
                values={RISK_LEVELS}
                onChange={value => onRiskFilterChange(value as 'all' | RiskLevel)}
            />
            <ChoiceFilter
                id="rr-driver"
                label="Driven by"
                allLabel="Any risk driver"
                value={driverFilter}
                values={driverCounts.map(({ key, count }) => ({
                    value: key,
                    label: `${DRIVER_LABELS[key]} · ${count}`
                }))}
                onChange={value => onDriverFilterChange(value as 'all' | RiskDriverKey)}
            />
            <ChoiceFilter
                id="rr-coverage"
                label={isDepartmentScopedView ? 'Service state' : 'Coverage'}
                allLabel={isDepartmentScopedView ? 'All service states' : 'All coverage states'}
                value={coverageFilter}
                values={[
                    { value: 'fully_covered', label: isDepartmentScopedView ? 'Complete' : 'Fully covered' },
                    {
                        value: 'partially_covered',
                        label: isDepartmentScopedView ? 'Needs follow-up' : 'Partially covered'
                    },
                    { value: 'not_serviced', label: 'Not serviced' }
                ]}
                onChange={value => onCoverageFilterChange(value as CoverageFilter)}
            />
            <ChoiceFilter
                id="rr-service"
                label="Last service"
                allLabel="Any time"
                value={serviceRecencyFilter}
                values={[
                    { value: 'one_month', label: 'None in 1 month' },
                    { value: 'three_months', label: 'None in 3 months' },
                    { value: 'six_months', label: 'None in 6 months' },
                    { value: 'never_serviced', label: 'Never serviced' }
                ]}
                onChange={value => onServiceRecencyFilterChange(value as ServiceRecencyFilter)}
            />
        </FilterPanel>
    )

    return (
        <DashboardFilterBar>
            <div className="ws-toolbar">
                <Input
                    className="ws-toolbar-search"
                    placeholder="Search SME or owner"
                    prefix={<SearchOutlined />}
                    value={searchText}
                    onChange={event => onSearchTextChange(event.target.value)}
                    allowClear
                    aria-label="Search the risk register"
                />

                <Segmented<ListMode>
                    className="ws-toolbar-status"
                    block
                    value={listMode}
                    onChange={onListModeChange}
                    options={[
                        { label: `Needs attention · ${attentionCount}`, value: 'attention' },
                        { label: `All · ${allCount}`, value: 'all' }
                    ]}
                />

                <Popover content={panel} trigger="click" placement="bottomLeft" title="Filters">
                    <Badge className="ws-toolbar-button" count={activeCount} size="small" offset={[-6, 4]}>
                        <Button block icon={<FilterOutlined />}>
                            Filters
                        </Button>
                    </Badge>
                </Popover>

                <Button className="ws-toolbar-button" icon={<PieChartOutlined />} onClick={onOpenAnalytics}>
                    Analytics
                </Button>
            </div>
        </DashboardFilterBar>
    )
}
