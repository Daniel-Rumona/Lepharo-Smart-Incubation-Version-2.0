import React from 'react'
import './setup-segmented.css'

export type SetupSegmentOption<T extends string> = {
    value: T
    label: string
    icon?: React.ReactNode
}

type Props<T extends string> = {
    options: SetupSegmentOption<T>[]
    value: T
    onChange: (value: T) => void
    /** Stretch to the full row, with the segments sharing the width equally. */
    fullWidth?: boolean
}

/**
 * Pill segmented control that reuses the top navigation's styles
 * (`workspace-primary-*` in layout/layout.css) so the two always look alike.
 * Segments never shrink, so labels are shown in full; the strip scrolls
 * sideways instead if it ever runs out of room.
 */
export function SetupSegmented<T extends string>({ options, value, onChange, fullWidth }: Props<T>) {
    return (
        <div className={`workspace-primary-nav setup-segmented ${fullWidth ? 'setup-segmented-full' : ''}`} role='tablist'>
            {options.map(option => {
                const active = option.value === value
                return (
                    <button
                        key={option.value}
                        type='button'
                        role='tab'
                        aria-selected={active}
                        className={`workspace-primary-segment ${active ? 'workspace-primary-segment-active' : ''}`}
                        onClick={() => onChange(option.value)}
                    >
                        {option.icon ? <span className='workspace-segment-icon'>{option.icon}</span> : null}
                        <span>{option.label}</span>
                    </button>
                )
            })}
        </div>
    )
}

export default SetupSegmented
