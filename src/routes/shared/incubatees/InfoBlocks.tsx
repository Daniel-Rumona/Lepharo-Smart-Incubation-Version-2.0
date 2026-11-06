import React from 'react'
import { formatDateTime, isBlankValue } from './participantsData'

/**
 * Recruited → Onboarded as a horizontal timeline: a dot per step joined by a
 * rail, the label and date under each dot. A step that has happened is filled
 * in the accent, and so is the rail leading up to it.
 */
export const TimelineSteps: React.FC<{ steps: { label: string; value: any }[] }> = ({ steps }) => (
    <ol className='ptx-timeline' style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((step, index) => {
            const date = formatDateTime(step.value)
            const done = !isBlankValue(date)
            const nextDone = index < steps.length - 1 && !isBlankValue(formatDateTime(steps[index + 1].value))
            return (
                <li key={step.label} className={`ptx-timeline-step${done ? ' is-done' : ''}${nextDone ? ' is-next-done' : ''}`}>
                    <span className='ptx-timeline-dot' aria-hidden='true' />
                    <div className='ptx-timeline-label'>{step.label}</div>
                    <div className={`ptx-timeline-date${done ? '' : ' is-pending'}`}>{done ? date : 'Not yet recorded'}</div>
                </li>
            )
        })}
    </ol>
)
