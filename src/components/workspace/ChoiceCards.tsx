import React, { useRef } from 'react'

export type ChoiceCardOption<T extends string> = {
    value: T
    label: string
    icon?: React.ReactNode
}

/**
 * A short list of options (four or fewer) as a row of selectable cards: every
 * choice visible, one click to pick. Works as a form control (value/onChange)
 * and as a radio group for the keyboard (arrow keys move the choice).
 */
export function ChoiceCards<T extends string>({
    value,
    options,
    onChange,
    label,
    allowClear = false,
    id
}: {
    value?: T | null
    options: ChoiceCardOption<T>[]
    onChange?: (value: T | null) => void
    /** Accessible name for the group, e.g. "Priority". */
    label: string
    /** Clicking the chosen card again clears it (for filters with an "any" state). */
    allowClear?: boolean
    id?: string
}) {
    const refs = useRef<Array<HTMLButtonElement | null>>([])
    const index = options.findIndex(o => o.value === value)

    const pick = (next: T) => onChange?.(allowClear && next === value ? null : next)

    const onKeyDown = (event: React.KeyboardEvent, i: number) => {
        const step = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0
        if (!step) return
        event.preventDefault()
        const next = (i + step + options.length) % options.length
        refs.current[next]?.focus()
        onChange?.(options[next].value)
    }

    return (
        <div
            id={id}
            className='ws-choice-cards'
            role='radiogroup'
            aria-label={label}
            style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
        >
            {options.map((option, i) => {
                const selected = option.value === value
                return (
                    <button
                        key={option.value}
                        ref={el => {
                            refs.current[i] = el
                        }}
                        type='button'
                        role='radio'
                        aria-checked={selected}
                        // One tab stop for the group: the chosen card, or the first.
                        tabIndex={selected || (index < 0 && i === 0) ? 0 : -1}
                        className={`ws-choice-card${selected ? ' is-selected' : ''}`}
                        onClick={() => pick(option.value)}
                        onKeyDown={event => onKeyDown(event, i)}
                    >
                        {option.icon}
                        <span>{option.label}</span>
                    </button>
                )
            })}
        </div>
    )
}
