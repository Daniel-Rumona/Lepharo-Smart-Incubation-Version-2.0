import React from 'react'
import { Badge, Button, Input, Popover, Segmented } from 'antd'
import { FilterOutlined, MailOutlined, SearchOutlined } from '@ant-design/icons'
import { DashboardFilterBar } from '@/components/dashboards/metrics/Header'
import { useIsMobile } from '@/hooks/useIsMobile'
import { ChoiceFilter, FilterPanel } from '@/components/workspace'
import { groupLabel, type IncubationGroup } from '@/services/groupLifecycleService'
import { GROUPS } from './groupData'

export type GroupSort = 'progress' | 'name' | 'group'

export type GroupFilterState = {
    search: string
    group: 'all' | IncubationGroup
    /** A MOVEMENT_META label, or 'all'. */
    movement: string
    stage: string
    sort: GroupSort
}

export const DEFAULT_GROUP_FILTERS: GroupFilterState = {
    search: '',
    group: 'all',
    movement: 'all',
    stage: 'all',
    sort: 'progress'
}

type Props = {
    filters: GroupFilterState
    onChange: (patch: Partial<GroupFilterState>) => void
    movementOptions: string[]
    stageOptions: string[]
    /** ROM only: email every SME in view that still owes details. */
    onRemindAll?: () => void
    reminding: boolean
    busy: boolean
}

/** Search, the group switch, a Filters popover (movement state, stage) and ROM's bulk reminder. */
export const GroupFilters: React.FC<Props> = ({
    filters,
    onChange,
    movementOptions,
    stageOptions,
    onRemindAll,
    reminding,
    busy
}) => {
    // Phones get the bare letters: five "Group X" segments don't fit.
    const isMobile = useIsMobile()
    const advancedCount = Number(filters.movement !== 'all') + Number(filters.stage !== 'all')
    const hasAdvanced = movementOptions.length > 0 || stageOptions.length > 0

    const panel = (
        <FilterPanel
            canReset={advancedCount > 0}
            onReset={() => onChange({ movement: 'all', stage: 'all' })}
        >
            <ChoiceFilter
                id='gpx-movement'
                label='Movement'
                allLabel='Any movement state'
                value={filters.movement}
                values={movementOptions}
                onChange={movement => onChange({ movement })}
            />
            <ChoiceFilter
                id='gpx-stage'
                label='Stage'
                allLabel='All stages'
                value={filters.stage}
                values={stageOptions}
                onChange={stage => onChange({ stage })}
            />
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
                    aria-label='Search SMEs by name or email'
                />

                <Segmented
                    className='ws-toolbar-status'
                    block
                    value={filters.group}
                    onChange={group => onChange({ group: group as GroupFilterState['group'] })}
                    options={[
                        { label: 'All', value: 'all' },
                        ...GROUPS.map(group => ({ label: isMobile && group !== 'Graduated' ? group : groupLabel(group), value: group }))
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

                {onRemindAll && (
                    <Button
                        className='ws-toolbar-button'
                        icon={<MailOutlined />}
                        loading={reminding}
                        disabled={busy}
                        onClick={onRemindAll}
                    >
                        Remind all pending
                    </Button>
                )}
            </div>
        </DashboardFilterBar>
    )
}
