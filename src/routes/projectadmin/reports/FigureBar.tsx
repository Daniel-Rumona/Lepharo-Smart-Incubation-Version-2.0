import React from 'react'
import { Tooltip } from 'antd'
import './departmentSnapshot.css'
import './complianceSnapshot.css'

/* Stacked figure bars shared by the Compliance and Engagement tabs. */

export const lower = (label: string) => label.charAt(0).toLowerCase() + label.slice(1)

export const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0)

export type Status = { key: string; label: string; tone: string }

/** One key for every bar in a card. */
export const Legend: React.FC<{ statuses: Status[] }> = ({ statuses }) => (
    <div className="cs-legend">
        {statuses.map(s => (
            <span key={s.key}>
                <i className={`cs-key is-${s.tone}`} aria-hidden="true" />
                {s.label}
            </span>
        ))}
    </div>
)

/**
 * A stacked bar with every count written on it. Non-zero segments keep a
 * minimum width so their number always fits; the legend sits once per card.
 */
export const FigureBar: React.FC<{
    title: string
    total: number
    statuses: Status[]
    /** A row from the model; only the statuses' keys are read. */
    counts: object
    note?: React.ReactNode
}> = ({ title, total, statuses, counts: row, note }) => {
    const counts = row as Record<string, number>
    const shown = statuses.filter(s => (counts[s.key] || 0) > 0)
    const lead = statuses[0]
    const summary = statuses.map(s => `${counts[s.key] || 0} ${lower(s.label)}`).join(', ')
    return (
        <div className="cs-row" role="listitem">
            <div className="cs-row-head">
                <span className="cs-row-title" title={title}>{title}</span>
                <span className="cs-row-total">
                    <strong>{pct(counts[lead.key] || 0, total)}%</strong> {lower(lead.label)}
                    <span className="cs-of"> · of {total}</span>
                    {note}
                </span>
            </div>
            <Tooltip title={statuses.map(s => `${s.label}: ${counts[s.key] || 0}`).join(' · ')}>
                <span className="cs-bar" role="img" aria-label={`${title}: ${summary}, of ${total}`}>
                    {shown.map(s => (
                        <i key={s.key} className={`cs-seg is-${s.tone}`} style={{ flexGrow: counts[s.key] }}>
                            {counts[s.key]}
                        </i>
                    ))}
                </span>
            </Tooltip>
        </div>
    )
}
