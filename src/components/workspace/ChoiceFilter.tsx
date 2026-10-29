import React from 'react'
import { Button, Segmented, Select } from 'antd'

/** Up to this many values (plus "All") can show as a pill strip; longer lists stay a searchable dropdown. */
export const MAX_INLINE_CHOICES = 3

/** Inner width of the filter panel (.ws-filter-panel is 320px). */
const PANEL_WIDTH = 320

/**
 * Whether every label fits its segment without truncating: segments share the
 * panel width equally, and a label needs roughly 7.2px per character (12.5px
 * semibold) plus 24px of padding. "North West" or "Not completed" in a
 * four-way strip would be cut off, so those fall back to the dropdown.
 */
const labelsFit = (labels: string[]) => {
    const segment = (PANEL_WIDTH - 6 - 2 * (labels.length - 1)) / labels.length
    return Math.max(...labels.map(l => l.length)) * 7.2 + 24 <= segment
}

/**
 * A filter choice for a filter popover. Short lists with short labels (gender,
 * age group) are a one-click pill strip so every option is visible; long lists
 * or long labels (hubs, provinces) keep the dropdown. With nothing to choose between, it renders nothing rather than a
 * lone "All".
 */
export const ChoiceFilter: React.FC<{
    id: string
    label: string
    /** Label for the "all" choice in the dropdown form, e.g. "All hubs". */
    allLabel: string
    value: string
    values: string[]
    onChange: (value: string) => void
}> = ({ id, label, allLabel, value, values, onChange }) =>
    values.length === 0 ? null : (
        <div>
            <label className='ws-filter-label' id={`${id}-label`} htmlFor={id}>
                {label}
            </label>
            {values.length <= MAX_INLINE_CHOICES && labelsFit(['All', ...values]) ? (
                <Segmented
                    id={id}
                    aria-labelledby={`${id}-label`}
                    block
                    value={value}
                    onChange={v => onChange(String(v))}
                    options={[{ value: 'all', label: 'All' }, ...values.map(v => ({ value: v, label: v }))]}
                />
            ) : (
                <Select
                    id={id}
                    style={{ width: '100%' }}
                    value={value}
                    onChange={onChange}
                    options={[{ value: 'all', label: allLabel }, ...values.map(v => ({ value: v, label: v }))]}
                    showSearch
                    optionFilterProp='label'
                />
            )}
        </div>
    )

/** The popover body: choice filters plus a Reset link. */
export const FilterPanel: React.FC<{ children: React.ReactNode; canReset: boolean; onReset: () => void }> = ({
    children,
    canReset,
    onReset
}) => (
    <div className='ws-filter-panel'>
        {children}
        <div className='ws-filter-panel-footer'>
            <Button size='small' type='text' disabled={!canReset} onClick={onReset}>
                Reset
            </Button>
        </div>
    </div>
)
