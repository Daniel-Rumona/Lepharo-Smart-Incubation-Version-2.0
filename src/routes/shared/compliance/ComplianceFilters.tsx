import React from 'react'
import { Badge, Button, Input, Popover, Segmented, Select } from 'antd'
import { FilterOutlined, SearchOutlined } from '@ant-design/icons'
import { DashboardFilterBar } from '@/components/dashboards/metrics/Header'
import { ChoiceFilter, FilterPanel } from '@/components/workspace'
import { useIsMobile } from '@/hooks/useIsMobile'
import type { ComplianceFilterState } from './complianceWorkspace'
import './compliance.css'

const SEGMENT_OPTIONS: { value: ComplianceFilterState['segment']; label: string; longLabel: string }[] = [
    { value: 'all', label: 'All', longLabel: 'All SMEs' },
    { value: 'action', label: 'SME action', longLabel: 'Need SME action' },
    { value: 'review', label: 'To review', longLabel: 'Awaiting staff review' },
    { value: 'expiring', label: 'Expiring', longLabel: 'Expiring within 30 days' },
    { value: 'compliant', label: 'Compliant', longLabel: 'Fully compliant' }
]

type Props = {
    filters: ComplianceFilterState
    onChange: (patch: Partial<ComplianceFilterState>) => void
    programmeOptions: string[]
    branchOptions: string[]
    groupOptions: string[]
    documentOptions: string[]
    /** Reminder, AI and setup buttons, which belong to the page. */
    actions?: React.ReactNode
}

/** Search, the who-acts-next switch, a filter popover and the page's actions, on one wrapping row. */
export const ComplianceFilters: React.FC<Props> = ({
    filters,
    onChange,
    programmeOptions,
    branchOptions,
    groupOptions,
    documentOptions,
    actions
}) => {
    const isMobile = useIsMobile()
    const showProgramme = programmeOptions.length > 1
    const advancedCount =
        Number(showProgramme && filters.programme !== 'all') +
        Number(filters.branch !== 'all') +
        Number(filters.group !== 'all') +
        Number(filters.document !== 'all')
    const hasAdvanced =
        showProgramme || branchOptions.length > 0 || groupOptions.length > 0 || documentOptions.length > 0

    const panel = (
        <FilterPanel
            canReset={advancedCount > 0}
            onReset={() => onChange({ programme: 'all', branch: 'all', group: 'all', document: 'all' })}
        >
            {showProgramme && (
                <ChoiceFilter
                    id='cmp-programme'
                    label='Programme'
                    allLabel='All programmes'
                    value={filters.programme}
                    values={programmeOptions}
                    onChange={programme => onChange({ programme })}
                />
            )}
            <ChoiceFilter
                id='cmp-document'
                label='Outstanding document'
                allLabel='Any document'
                value={filters.document}
                values={documentOptions}
                onChange={document => onChange({ document })}
            />
            <ChoiceFilter
                id='cmp-branch'
                label='Branch'
                allLabel='All branches'
                value={filters.branch}
                values={branchOptions}
                onChange={branch => onChange({ branch })}
            />
            <ChoiceFilter
                id='cmp-group'
                label='Group'
                allLabel='All groups'
                value={filters.group}
                values={groupOptions}
                onChange={group => onChange({ group })}
            />
        </FilterPanel>
    )

    return (
        <DashboardFilterBar>
            <div className='ws-toolbar cmp-toolbar' data-guide='compliance-filters'>
                <Input
                    className='ws-toolbar-search'
                    placeholder='Search SME by name or email'
                    prefix={<SearchOutlined />}
                    value={filters.search}
                    onChange={event => onChange({ search: event.target.value })}
                    allowClear
                    aria-label='Search SMEs by name or email'
                />

                {/* Five segments don't fit a phone, so there it's a dropdown. */}
                {isMobile ? (
                    <Select
                        className='cmp-toolbar-select'
                        value={filters.segment}
                        onChange={segment => onChange({ segment })}
                        options={SEGMENT_OPTIONS.map(option => ({ ...option, label: option.longLabel }))}
                        aria-label='Show SMEs'
                    />
                ) : (
                    <Segmented
                        className='ws-toolbar-status'
                        block
                        value={filters.segment}
                        onChange={segment => onChange({ segment: segment as ComplianceFilterState['segment'] })}
                        options={SEGMENT_OPTIONS.map(({ label, value }) => ({ label, value }))}
                    />
                )}

                {hasAdvanced && (
                    <Popover content={panel} trigger='click' placement='bottomLeft' title='Filters'>
                        <Badge className='ws-toolbar-button' count={advancedCount} size='small' offset={[-6, 4]}>
                            <Button block icon={<FilterOutlined />}>
                                Filters
                            </Button>
                        </Badge>
                    </Popover>
                )}

                {actions}
            </div>
        </DashboardFilterBar>
    )
}
