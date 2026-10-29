import React from 'react'
import './choice-cards.css'

export type ChoiceCard<T extends string> = { value: T; label: string; detail?: string; icon?: React.ReactNode }

/**
 * A set of options shown as cards, one tap to choose, every option visible
 * with a line of explanation. Works as a controlled Form.Item child.
 */
export function ChoiceCards<T extends string>({
    options,
    value,
    onChange,
    label,
    columns,
    compact
}: {
    options: ChoiceCard<T>[]
    value?: T
    onChange?: (value: T) => void
    /** Accessible name of the group. */
    label: string
    /** Cards per row on wider screens (defaults to the number of options, max 3). */
    columns?: number
    /** Icon beside the label, tighter padding: for dialogs where height matters. */
    compact?: boolean
}) {
    const cols = columns || Math.min(options.length, 3)
    return (
        <div className={`qc-cards${compact ? ' is-compact' : ''}`} role='radiogroup' aria-label={label} style={{ ['--qc-cols' as any]: cols }}>
            {options.map(o => (
                <button
                    key={o.value}
                    type='button'
                    role='radio'
                    aria-checked={value === o.value}
                    className={`qc-card${value === o.value ? ' is-selected' : ''}`}
                    onClick={() => onChange?.(o.value)}
                >
                    {o.icon && <span className='qc-icon' aria-hidden='true'>{o.icon}</span>}
                    <span className='qc-label'>{o.label}</span>
                    {o.detail && <span className='qc-detail'>{o.detail}</span>}
                </button>
            ))}
        </div>
    )
}
