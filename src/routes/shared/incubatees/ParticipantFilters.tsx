import React from 'react'
import { Badge, Button, Dropdown, Input, Popover, Segmented } from 'antd'
import { DownOutlined, DownloadOutlined, FileExcelOutlined, FilterOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons'
import { DashboardFilterBar } from '@/components/dashboards/metrics/Header'
import { ChoiceFilter, FilterPanel } from '@/components/workspace'
import type { ChoiceDef, ParticipantFilterState } from './participantFilterDefs'

export { DEFAULT_PARTICIPANT_FILTERS, type ParticipantFilterState } from './participantFilterDefs'

type Props = {
    filters: ParticipantFilterState
    onChange: (patch: Partial<ParticipantFilterState>) => void
    /** The filters worth showing for the SMEs in view (see buildChoices). */
    choices: ChoiceDef[]
    /** Add SME: shown to onboarding departments; disabled without a single active programme. */
    canAdd: boolean
    addDisabled: boolean
    onAdd: () => void
    /** Import a branch's Excel list into the programme (same people as Add SME). */
    onImport: () => void
    onExport: () => void
}

/** Search, status segments, additional filters and actions. Dates come from the topbar. */
export const ParticipantFilters: React.FC<Props> = ({
    filters,
    onChange,
    choices,
    canAdd,
    addDisabled,
    onAdd,
    onImport,
    onExport
}) => {
    const advancedChoices = choices.filter(choice => choice.key !== 'incubationStatus')
    const statusChoices = choices.find(choice => choice.key === 'incubationStatus')?.values || ['Active', 'Inactive', 'Dormant', 'Potential Exit']
    const advancedCount = advancedChoices.filter(c => filters[c.key] !== 'all').length

    const panel = (
        <FilterPanel
            canReset={advancedCount > 0}
            onReset={() => onChange(Object.fromEntries(advancedChoices.map(c => [c.key, 'all'])))}
        >
            {advancedChoices.length === 0 && <span>No additional filters are available for these SMEs.</span>}
            {advancedChoices.map(c => (
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
            <div className='ws-toolbar ptx-toolbar' data-guide='sme-overview-filters'>
                <Input
                    className='ws-toolbar-search'
                    placeholder='Search by company, number or email'
                    prefix={<SearchOutlined />}
                    value={filters.search}
                    onChange={e => onChange({ search: e.target.value })}
                    allowClear
                    aria-label='Search SMEs by company, registration or SMME number, or email'
                />

                <Segmented
                    className='ws-toolbar-status ptx-statuses'
                    aria-label='SME status'
                    value={filters.incubationStatus}
                    onChange={value => onChange({ incubationStatus: String(value) })}
                    options={[{ label: 'All', value: 'all' }, ...statusChoices.map(status => ({ label: status, value: status }))]}
                />

                <Popover content={panel} trigger='click' placement='bottomLeft' title='Filters'>
                        <Badge className='ptx-filter-button' count={advancedCount} size='small' offset={[-6, 4]}>
                            <Button icon={<FilterOutlined />}>
                                Filters
                            </Button>
                        </Badge>
                </Popover>


                {canAdd && (
                    <Dropdown
                        trigger={['click']}
                        disabled={addDisabled}
                        menu={{
                            items: [
                                { key: 'manual', icon: <PlusOutlined />, label: 'Add manually' },
                                { key: 'import', icon: <FileExcelOutlined />, label: 'Import from Excel' }
                            ],
                            onClick: ({ key }) => (key === 'import' ? onImport() : onAdd())
                        }}
                    >
                        <Button
                            data-guide='sme-add-action'
                            className='ws-toolbar-button'
                            type='primary'
                            icon={<PlusOutlined />}
                            disabled={addDisabled}
                        >
                            Add SME <DownOutlined />
                        </Button>
                    </Dropdown>
                )}
                <Button data-guide='sme-export-all' className='ws-toolbar-button' icon={<DownloadOutlined />} onClick={onExport}>
                    Export SMEs
                </Button>
            </div>
        </DashboardFilterBar>
    )
}
