import React from 'react'
import { Badge, Button, Input, Popover, Segmented } from 'antd'
import { DownloadOutlined, FilterOutlined, PieChartOutlined, SearchOutlined } from '@ant-design/icons'
import { DashboardFilterBar } from '@/components/dashboards/metrics/Header'
import { ChoiceFilter, FilterPanel } from '@/components/workspace'
import type { ApplicationStatus } from './applicationData'

export type ApplicationSort = 'score' | 'newest' | 'name'

export type ApplicationFilterState = {
    search: string
    status: 'all' | ApplicationStatus
    gender: string
    ageGroup: string
    hub: string
    sort: ApplicationSort
}

export const DEFAULT_FILTERS: ApplicationFilterState = {
    search: '',
    status: 'all',
    gender: 'all',
    ageGroup: 'all',
    hub: 'all',
    sort: 'score'
}

type Props = {
    filters: ApplicationFilterState
    onChange: (patch: Partial<ApplicationFilterState>) => void
    genderOptions: string[]
    ageGroupOptions: string[]
    hubOptions: string[]
    showHub: boolean
    onAnalytics: () => void
    onExport: () => void
    exporting: boolean
}

export const ApplicationFilters: React.FC<Props> = ({
    filters,
    onChange,
    genderOptions,
    ageGroupOptions,
    hubOptions,
    showHub,
    onAnalytics,
    onExport,
    exporting
}) => {
    const hasAdvanced = genderOptions.length > 0 || ageGroupOptions.length > 0 || (showHub && hubOptions.length > 0)
    const advancedCount =
        Number(filters.gender !== 'all') + Number(filters.ageGroup !== 'all') + Number(showHub && filters.hub !== 'all')

    const panel = (
        <FilterPanel
            canReset={advancedCount > 0}
            onReset={() => onChange({ gender: 'all', ageGroup: 'all', hub: 'all' })}
        >
            <ChoiceFilter
                id='apx-gender'
                label='Gender'
                allLabel='All genders'
                value={filters.gender}
                values={genderOptions}
                onChange={gender => onChange({ gender })}
            />
            <ChoiceFilter
                id='apx-age'
                label='Age group'
                allLabel='All age groups'
                value={filters.ageGroup}
                values={ageGroupOptions}
                onChange={ageGroup => onChange({ ageGroup })}
            />
            {showHub && (
                <ChoiceFilter
                    id='apx-hub'
                    label='Hub'
                    allLabel='All hubs'
                    value={filters.hub}
                    values={hubOptions}
                    onChange={hub => onChange({ hub })}
                />
            )}
        </FilterPanel>
    )

    return (
        <DashboardFilterBar>
            <div className='ws-toolbar'>
                <Input
                    className='ws-toolbar-search'
                    placeholder='Search by name or email'
                    prefix={<SearchOutlined />}
                    value={filters.search}
                    onChange={e => onChange({ search: e.target.value })}
                    allowClear
                    aria-label='Search applications by name or email'
                />

                <Segmented
                    className='ws-toolbar-status'
                    block
                    value={filters.status}
                    onChange={status => onChange({ status: status as ApplicationFilterState['status'] })}
                    options={[
                        { label: 'All', value: 'all' },
                        { label: 'Pending', value: 'pending' },
                        { label: 'Accepted', value: 'accepted' },
                        { label: 'Rejected', value: 'rejected' }
                    ]}
                />

                {hasAdvanced && (
                    <Popover content={panel} trigger='click' placement='bottomLeft' title='Filters'>
                        <Badge className='ws-toolbar-button' count={advancedCount} size='small' offset={[-6, 4]}>
                            <Button block icon={<FilterOutlined />}>
                                Filters
                            </Button>
                        </Badge>
                    </Popover>
                )}

                <Button className='ws-toolbar-button' icon={<PieChartOutlined />} onClick={onAnalytics}>
                    Analytics
                </Button>
                <Button
                    className='ws-toolbar-button'
                    icon={<DownloadOutlined />}
                    onClick={onExport}
                    loading={exporting}
                >
                    Export Excel
                </Button>
            </div>
        </DashboardFilterBar>
    )
}
