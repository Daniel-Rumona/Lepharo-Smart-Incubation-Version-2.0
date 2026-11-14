import React from 'react'
import { Badge, Button, DatePicker, Input, Popover, Segmented, Select, Switch, Tooltip } from 'antd'
import { AppstoreOutlined, FilterOutlined, PlusOutlined, SearchOutlined, UnorderedListOutlined } from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import { DashboardFilterBar } from '@/components/dashboards/metrics/Header'
import { ChoiceCards, FilterPanel } from '@/components/workspace'
import { PRIORITY_META, PRIORITY_ORDER, STATUS_META, STATUS_ORDER, type Priority, type Status } from './taskTypes'

export type StatusFilter = 'all' | Status | 'overdue' | 'done_month'
export type TaskView = 'list' | 'board'

export type TaskFilterState = {
    search: string
    status: StatusFilter
    departmentId: string
    assigneeId: string
    priority: 'all' | Priority
    /** Due-date range, whole days. */
    due: [Dayjs, Dayjs] | null
}

export const DEFAULT_FILTERS: TaskFilterState = {
    search: '',
    status: 'all',
    departmentId: 'all',
    assigneeId: 'all',
    priority: 'all',
    due: null
}

type Option = { value: string; label: string }

type Props = {
    filters: TaskFilterState
    onChange: (patch: Partial<TaskFilterState>) => void
    view: TaskView
    onViewChange: (view: TaskView) => void
    showArchived: boolean
    onShowArchivedChange: (value: boolean) => void
    departmentOptions: Option[]
    /** Non-main staff: their department, locked. */
    lockedDepartment?: Option
    assigneeOptions: Option[]
    canCreate: boolean
    /** Why New task is unavailable (e.g. no programme picked in the header). */
    createDisabledReason?: string
    onCreate: () => void
}

/** Search, status, filters, view and archive switches, and New task. */
export const TaskToolbar: React.FC<Props> = ({
    filters,
    onChange,
    view,
    onViewChange,
    showArchived,
    onShowArchivedChange,
    departmentOptions,
    lockedDepartment,
    assigneeOptions,
    canCreate,
    createDisabledReason,
    onCreate
}) => {
    const advancedCount =
        Number(!lockedDepartment && filters.departmentId !== 'all') +
        Number(filters.assigneeId !== 'all') +
        Number(filters.priority !== 'all') +
        Number(!!filters.due)

    const select = (id: string, label: string, allLabel: string, value: string, options: Option[], key: keyof TaskFilterState, locked?: Option) => (
        <div>
            <label className='ws-filter-label' htmlFor={id}>
                {label}
            </label>
            <Select
                id={id}
                style={{ width: '100%' }}
                value={locked ? locked.value : value}
                disabled={!!locked}
                onChange={v => onChange({ [key]: v } as Partial<TaskFilterState>)}
                options={locked ? [locked] : [{ value: 'all', label: allLabel }, ...options]}
                showSearch
                optionFilterProp='label'
            />
        </div>
    )

    const panel = (
        <FilterPanel
            canReset={advancedCount > 0}
            onReset={() =>
                // A locked department stays as it is.
                onChange({ departmentId: 'all', assigneeId: 'all', priority: 'all', due: null })
            }
        >
            {select('tw-department', 'Department', 'All departments', filters.departmentId, departmentOptions, 'departmentId', lockedDepartment)}
            {select('tw-assignee', 'Assignee', 'Anyone', filters.assigneeId, assigneeOptions, 'assigneeId')}
            <div>
                <span className='ws-filter-label' id='tw-priority-label'>
                    Priority
                </span>
                {/* Click the chosen card again for any priority. */}
                <ChoiceCards<Priority>
                    id='tw-priority'
                    label='Priority'
                    allowClear
                    value={filters.priority === 'all' ? null : filters.priority}
                    options={PRIORITY_ORDER.map(p => ({ value: p, label: PRIORITY_META[p].label }))}
                    onChange={v => onChange({ priority: v || 'all' })}
                />
            </div>
            <div>
                <label className='ws-filter-label' htmlFor='tw-due'>
                    Due between
                </label>
                <DatePicker.RangePicker
                    id='tw-due'
                    style={{ width: '100%' }}
                    format='D MMM YYYY'
                    value={filters.due}
                    onChange={v => onChange({ due: v && v[0] && v[1] ? [v[0], v[1]] : null })}
                />
            </div>
        </FilterPanel>
    )

    return (
        <DashboardFilterBar>
            <div className='ws-toolbar'>
                <Input
                    className='ws-toolbar-search'
                    placeholder='Search tasks or people'
                    prefix={<SearchOutlined />}
                    value={filters.search}
                    onChange={e => onChange({ search: e.target.value })}
                    allowClear
                    aria-label='Search tasks by title, description or assignee'
                />
                <Segmented
                    className='ws-toolbar-status'
                    block
                    value={filters.status}
                    onChange={v => onChange({ status: v as StatusFilter })}
                    options={[
                        { label: 'All', value: 'all' },
                        ...STATUS_ORDER.map(s => ({ label: STATUS_META[s].label, value: s }))
                    ]}
                />
                <Popover content={panel} trigger='click' placement='bottomLeft' title='Filters'>
                    <Badge className='ws-toolbar-button' count={advancedCount} size='small' offset={[-6, 4]}>
                        <Button block icon={<FilterOutlined />}>
                            Filters
                        </Button>
                    </Badge>
                </Popover>
                <Segmented
                    className='tw-view'
                    value={view}
                    onChange={v => onViewChange(v as TaskView)}
                    options={[
                        { value: 'list', label: 'List', icon: <UnorderedListOutlined /> },
                        { value: 'board', label: 'Board', icon: <AppstoreOutlined /> }
                    ]}
                />
                <label className='tw-archived-toggle'>
                    <Switch size='small' checked={showArchived} onChange={onShowArchivedChange} />
                    Archived
                </label>
                {canCreate && (
                    <Tooltip title={createDisabledReason}>
                        <Button
                            className='ws-toolbar-button'
                            type='primary'
                            icon={<PlusOutlined />}
                            onClick={onCreate}
                            disabled={!!createDisabledReason}
                        >
                            New task
                        </Button>
                    </Tooltip>
                )}
            </div>
        </DashboardFilterBar>
    )
}
