import React from 'react'
import { Select } from 'antd'
import { SwapOutlined } from '@ant-design/icons'

export type SortOption<T extends string> = { value: T; label: string; icon: React.ReactNode }

/**
 * Full-width sort control for the top of a list: the grey segmented track,
 * a quiet "Sort by" prefix and the current choice in the accent.
 */
export function SortSelect<T extends string>({
    value,
    options,
    onChange,
    label = 'Sort'
}: {
    value: T
    options: SortOption<T>[]
    onChange: (value: T) => void
    /** Accessible name, e.g. "Sort applications". */
    label?: string
}) {
    return (
        <Select
            className='ws-sort'
            popupClassName='ws-sort-popup'
            variant='borderless'
            value={value}
            onChange={onChange}
            aria-label={label}
            prefix={
                <span className='ws-sort-prefix'>
                    <SwapOutlined rotate={90} aria-hidden='true' />
                    Sort by
                </span>
            }
            options={options.map(o => ({
                value: o.value,
                label: (
                    <span className='ws-sort-option'>
                        {o.icon}
                        {o.label}
                    </span>
                )
            }))}
        />
    )
}
