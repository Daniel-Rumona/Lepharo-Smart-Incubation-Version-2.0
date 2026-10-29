import React from 'react'

export type OwnershipItem = { label: string; value?: number | null }

const pct = (v: unknown) => {
    const n = Number(v)
    return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0
}

/**
 * Stat cards for ownership shares: the figure first, its label, and a slim bar
 * in the accent. 0% (or not provided) is muted rather than an empty-looking bar.
 */
export const OwnershipCards: React.FC<{ items: OwnershipItem[] }> = ({ items }) => (
    <div className='ws-ownership'>
        {items.map(({ label, value }) => {
            const known = value !== undefined && value !== null && String(value) !== ''
            const v = pct(value)
            return (
                <div key={label} className={`ws-ownership-item${v ? '' : ' is-zero'}`}>
                    <div className='ws-ownership-value'>
                        {known ? v : '—'}
                        {known && <small>%</small>}
                    </div>
                    <div className='ws-ownership-label'>{label}</div>
                    <div
                        className='ws-ownership-track'
                        role='progressbar'
                        aria-label={label}
                        aria-valuenow={v}
                        aria-valuemin={0}
                        aria-valuemax={100}
                    >
                        <span style={{ width: `${v}%` }} />
                    </div>
                </div>
            )
        })}
    </div>
)
