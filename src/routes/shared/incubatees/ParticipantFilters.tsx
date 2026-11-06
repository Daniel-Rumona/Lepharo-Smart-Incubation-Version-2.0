import React from 'react'
import { Badge, Button, DatePicker, Dropdown, Input, Popover, Space } from 'antd'
import { DownOutlined, DownloadOutlined, EyeInvisibleOutlined, FileExcelOutlined, FilterOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons'
import dayjs, { type Dayjs } from 'dayjs'
import { DashboardFilterBar } from '@/components/dashboards/metrics/Header'
import { ChoiceFilter, FilterPanel } from '@/components/workspace'
import type { ChoiceDef, ParticipantFilterState } from './participantFilterDefs'

const { RangePicker } = DatePicker

export { DEFAULT_PARTICIPANT_FILTERS, type ParticipantFilterState } from './participantFilterDefs'

type Props = {
    filters: ParticipantFilterState
    onChange: (patch: Partial<ParticipantFilterState>) => void
    /** The filters worth showing for the SMEs in view (see buildChoices). */
    choices: ChoiceDef[]
    reportingRange: [Dayjs, Dayjs]
    onReportingRangeChange: (range: [Dayjs, Dayjs]) => void
    /** Add SME: shown to onboarding departments; disabled without a single active programme. */
    canAdd: boolean
    addDisabled: boolean
    onAdd: () => void
    /** Import a branch's Excel list into the programme (same people as Add SME). */
    onImport: () => void
    /** Internal (Quantilytix) users only. */
    canAddDummy: boolean
    onAddDummy: () => void
    onExport: () => void
}

/**
 * One row that spans the bar: search, a Filters popover (gender, group, sector,
 * province, branch, hub, B-BBEE level, ownership, GAP status — whichever
 * would narrow the list),
 * the reporting period that drives the performance charts, then the actions.
 * Wraps instead of scrolling sideways.
 */
export const ParticipantFilters: React.FC<Props> = ({
    filters,
    onChange,
    choices,
    reportingRange,
    onReportingRangeChange,
    canAdd,
    addDisabled,
    onAdd,
    onImport,
    canAddDummy,
    onAddDummy,
    onExport
}) => {
    const advancedCount = choices.filter(c => filters[c.key] !== 'all').length

    const panel = (
        <FilterPanel
            canReset={advancedCount > 0}
            onReset={() => onChange(Object.fromEntries(choices.map(c => [c.key, 'all'])))}
        >
            {choices.map(c => (
                <ChoiceFilter
                    key={c.key}
                    id={`ptx-${c.key}`}
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
            <div className='ws-toolbar' data-guide='sme-overview-filters'>
                <Input
                    className='ws-toolbar-search'
                    placeholder='Search by company, number or email'
                    prefix={<SearchOutlined />}
                    value={filters.search}
                    onChange={e => onChange({ search: e.target.value })}
                    allowClear
                    aria-label='Search SMEs by company, registration or SMME number, or email'
                />

                {choices.length > 0 && (
                    <Popover content={panel} trigger='click' placement='bottomLeft' title='Filters'>
                        <Badge className='ws-toolbar-button' count={advancedCount} size='small' offset={[-6, 4]}>
                            <Button block icon={<FilterOutlined />}>
                                Filters
                            </Button>
                        </Badge>
                    </Popover>
                )}

                <RangePicker
                    className='ws-toolbar-period'
                    picker='month'
                    allowClear={false}
                    value={reportingRange}
                    placeholder={['From', 'To']}
                    aria-label='Reporting period'
                    disabledDate={current => !!current && current.isAfter(dayjs().endOf('month'))}
                    onChange={dates => {
                        if (dates?.[0] && dates?.[1]) {
                            onReportingRangeChange([dates[0].startOf('month'), dates[1].endOf('month')])
                        }
                    }}
                />

                {canAdd && (
                    <Space.Compact className='ws-toolbar-button'>
                        <Button data-guide='sme-add-action' type='primary' icon={<PlusOutlined />} disabled={addDisabled} onClick={onAdd}>
                            Add SME
                        </Button>
                        <Dropdown
                            trigger={['click']}
                            disabled={addDisabled}
                            menu={{
                                items: [{ key: 'import', icon: <FileExcelOutlined />, label: 'Import from Excel…' }],
                                onClick: onImport
                            }}
                        >
                            <Button type='primary' icon={<DownOutlined />} disabled={addDisabled} aria-label='More ways to add SMEs' />
                        </Dropdown>
                    </Space.Compact>
                )}
                {canAddDummy && (
                    <Button
                        className='ws-toolbar-button'
                        icon={<EyeInvisibleOutlined />}
                        disabled={addDisabled}
                        onClick={onAddDummy}
                    >
                        Dummy
                    </Button>
                )}
                <Button data-guide='sme-export-all' className='ws-toolbar-button' icon={<DownloadOutlined />} onClick={onExport}>
                    Export SMEs
                </Button>
            </div>
        </DashboardFilterBar>
    )
}
