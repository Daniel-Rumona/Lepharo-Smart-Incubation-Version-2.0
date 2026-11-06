import React from 'react'
import { Badge, Button, Input, Popover } from 'antd'
import { FilterOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons'
import { DashboardFilterBar } from '@/components/dashboards/metrics/Header'
import { ChoiceFilter, FilterPanel } from '@/components/workspace'
import type { KpiChoiceDef, KpiFilterState } from './kpiRegisterDefs'

type Props = {
    filters: KpiFilterState
    onChange: (patch: Partial<KpiFilterState>) => void
    /** The filters worth showing for the KPIs in view (see buildKpiChoices). */
    choices: KpiChoiceDef[]
    onAdd: () => void
}

/** One row across the bar: search, a Filters popover, then Add KPI. Wraps on narrow screens. */
export const KpiToolbar: React.FC<Props> = ({ filters, onChange, choices, onAdd }) => {
    const activeCount = choices.filter(c => filters[c.key] !== 'all').length

    const panel = (
        <FilterPanel canReset={activeCount > 0} onReset={() => onChange(Object.fromEntries(choices.map(c => [c.key, 'all'])))}>
            {choices.map(c => (
                <ChoiceFilter
                    key={c.key}
                    id={`kpi-filter-${c.key}`}
                    label={c.label}
                    allLabel={c.allLabel}
                    value={filters[c.key]}
                    values={c.values}
                    onChange={value => onChange({ [c.key]: value })}
                />
            ))}
        </FilterPanel>
    )

    return (
        <DashboardFilterBar>
            <div className='ws-toolbar'>
                <Input
                    className='ws-toolbar-search'
                    placeholder='Search KPI name, department or source'
                    prefix={<SearchOutlined />}
                    value={filters.search}
                    onChange={e => onChange({ search: e.target.value })}
                    allowClear
                    aria-label='Search KPIs'
                />

                {choices.length > 0 && (
                    <Popover content={panel} trigger='click' placement='bottomLeft' title='Filters'>
                        <Badge className='ws-toolbar-button' count={activeCount} size='small' offset={[-6, 4]}>
                            <Button block icon={<FilterOutlined />}>
                                Filters
                            </Button>
                        </Badge>
                    </Popover>
                )}

                <Button className='ws-toolbar-button' type='primary' icon={<PlusOutlined />} onClick={onAdd}>
                    Add KPI
                </Button>
            </div>
        </DashboardFilterBar>
    )
}
