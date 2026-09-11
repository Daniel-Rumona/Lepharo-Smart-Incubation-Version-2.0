import { Button, Col, Input, Row, Select, Tooltip } from 'antd'
import { BarChartOutlined } from '@ant-design/icons'

import type { RiskLevel, ServiceRecencyFilter } from '../types'

type CoverageFilter = 'all' | 'fully_covered' | 'partially_covered' | 'not_serviced'

type Props = {
    isDepartmentScopedView: boolean
    searchText: string
    onSearchTextChange: (value: string) => void
    riskFilter: 'all' | RiskLevel
    onRiskFilterChange: (value: 'all' | RiskLevel) => void
    coverageFilter: CoverageFilter
    onCoverageFilterChange: (value: CoverageFilter) => void
    serviceRecencyFilter: ServiceRecencyFilter
    onServiceRecencyFilterChange: (value: ServiceRecencyFilter) => void
    onOpenAnalytics: () => void
}

export default function RegisterFilterBar({
    isDepartmentScopedView,
    searchText,
    onSearchTextChange,
    riskFilter,
    onRiskFilterChange,
    coverageFilter,
    onCoverageFilterChange,
    serviceRecencyFilter,
    onServiceRecencyFilterChange,
    onOpenAnalytics
}: Props) {
    return (
        <Row gutter={[12, 12]} align="middle">
            <Col xs={24} lg={8}>
                <Input
                    allowClear
                    value={searchText}
                    onChange={e => onSearchTextChange(e.target.value)}
                    placeholder={isDepartmentScopedView ? 'Search SME, owner or service' : 'Search SME, owner, department or intervention'}
                />
            </Col>

            <Col xs={24} md={12} lg={4}>
                <Select
                    value={riskFilter}
                    onChange={onRiskFilterChange}
                    style={{ width: '100%' }}
                    options={[
                        { value: 'all', label: 'All Risk Levels' },
                        { value: 'Low', label: 'Low' },
                        { value: 'Medium', label: 'Medium' },
                        { value: 'High', label: 'High' },
                        { value: 'Critical', label: 'Critical' }
                    ]}
                />
            </Col>

            <Col xs={24} md={12} lg={5}>
                <Select
                    value={coverageFilter}
                    onChange={onCoverageFilterChange}
                    style={{ width: '100%' }}
                    options={[
                        { value: 'all', label: isDepartmentScopedView ? 'All Service States' : 'All Coverage States' },
                        { value: 'fully_covered', label: isDepartmentScopedView ? 'Complete' : 'Fully Covered' },
                        { value: 'partially_covered', label: isDepartmentScopedView ? 'Needs Follow-Up' : 'Partially Covered' },
                        { value: 'not_serviced', label: 'Not Serviced' }
                    ]}
                />
            </Col>

            <Col xs={24} md={16} lg={5}>
                <Select
                    value={serviceRecencyFilter}
                    onChange={onServiceRecencyFilterChange}
                    style={{ width: '100%' }}
                    options={[
                        { value: 'all', label: 'All Last Service' },
                        { value: 'one_month', label: 'No Service in 1 Month' },
                        { value: 'three_months', label: 'No Service in 3 Months' },
                        { value: 'six_months', label: 'No Service in 6 Months' },
                        { value: 'never_serviced', label: 'Never Serviced' }
                    ]}
                />
            </Col>

            <Col xs={24} md={8} lg={2}>
                <Tooltip title="Open analytics">
                    <Button block icon={<BarChartOutlined />} onClick={onOpenAnalytics}>
                        Analytics
                    </Button>
                </Tooltip>
            </Col>
        </Row>
    )
}
