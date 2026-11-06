import React, { useMemo, useState } from 'react'
import { Button, Empty, Segmented, Tooltip } from 'antd'
import { CloseOutlined } from '@ant-design/icons'
import './departmentSnapshot.css'

export type DepartmentSnapshotItem = {
    department: string
    /** Interventions in accepted application plans. */
    required: number
    /** Assignments in the period; active and completed are part of these. */
    assigned: number
    active: number
    completed: number
}

type SortKey = 'behind' | 'work' | 'name'

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0)

/** Per department: how much of the planned work is assigned, under way and done. */
const DepartmentSnapshot: React.FC<{
    items: DepartmentSnapshotItem[]
    selected: string | null
    onSelect: (department: string | null) => void
    /** Shown under the list for the selected department (its status chart). */
    detail?: React.ReactNode
}> = ({ items, selected, onSelect, detail }) => {
    const [sort, setSort] = useState<SortKey>('behind')

    const rows = useMemo(() => {
        const withStats = items
            .filter(item => item.required > 0 || item.assigned > 0)
            .map(item => {
                const notStarted = Math.max(item.assigned - item.active - item.completed, 0)
                const unassigned = Math.max(item.required - item.assigned, 0)
                const scale = Math.max(item.required, item.assigned, 1)
                return { ...item, notStarted, unassigned, scale, donePct: pct(item.completed, Math.max(item.required, item.assigned)) }
            })
        return withStats.sort((a, b) => {
            if (sort === 'name') return a.department.localeCompare(b.department)
            if (sort === 'work') return b.scale - a.scale || a.department.localeCompare(b.department)
            // Most behind: lowest share done, then most still unassigned.
            return a.donePct - b.donePct || b.unassigned - a.unassigned || a.department.localeCompare(b.department)
        })
    }, [items, sort])

    const totals = useMemo(
        () =>
            rows.reduce(
                (t, r) => ({
                    required: t.required + r.required,
                    assigned: t.assigned + r.assigned,
                    active: t.active + r.active,
                    completed: t.completed + r.completed,
                    unassigned: t.unassigned + r.unassigned
                }),
                { required: 0, assigned: 0, active: 0, completed: 0, unassigned: 0 }
            ),
        [rows]
    )

    if (!rows.length) return <Empty description="No planned or assigned interventions for these filters." />

    return (
        <div className="ds">
            <div className="ds-summary">
                <div className="ds-stat">
                    <span className="ds-stat-value">{totals.required}</span>
                    <span className="ds-stat-label">planned</span>
                </div>
                <div className="ds-stat">
                    <span className="ds-stat-value">{totals.assigned}</span>
                    <span className="ds-stat-label">assigned{totals.required ? ` · ${pct(totals.assigned, totals.required)}%` : ''}</span>
                </div>
                <div className="ds-stat">
                    <span className="ds-stat-value is-active">{totals.active}</span>
                    <span className="ds-stat-label">in progress</span>
                </div>
                <div className="ds-stat">
                    <span className="ds-stat-value is-done">{totals.completed}</span>
                    <span className="ds-stat-label">done{totals.required || totals.assigned ? ` · ${pct(totals.completed, Math.max(totals.required, totals.assigned))}%` : ''}</span>
                </div>
                {totals.unassigned > 0 ? (
                    <div className="ds-stat">
                        <span className="ds-stat-value is-gap">{totals.unassigned}</span>
                        <span className="ds-stat-label">not yet assigned</span>
                    </div>
                ) : null}
            </div>

            <div className="ds-toolbar">
                <div className="ds-legend" aria-hidden="true">
                    <span><i className="ds-key is-done" />Done</span>
                    <span><i className="ds-key is-active" />In progress</span>
                    <span><i className="ds-key is-assigned" />Assigned, not started</span>
                    <span><i className="ds-key is-gap" />Not yet assigned</span>
                </div>
                <Segmented
                    size="small"
                    value={sort}
                    onChange={v => setSort(v as SortKey)}
                    aria-label="Sort departments"
                    options={[
                        { value: 'behind', label: 'Most behind' },
                        { value: 'work', label: 'Most work' },
                        { value: 'name', label: 'A–Z' }
                    ]}
                />
            </div>

            <div className="ds-rows" role="listbox" aria-label="Departments">
                {rows.map(row => {
                    const isSelected = row.department === selected
                    const seg = (n: number) => `${(n / row.scale) * 100}%`
                    return (
                        <button
                            key={row.department}
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            className={`ds-row${isSelected ? ' is-selected' : ''}`}
                            onClick={() => onSelect(isSelected ? null : row.department)}
                        >
                            <span className="ds-name" title={row.department}>
                                {row.department}
                            </span>
                            <Tooltip
                                title={`${row.completed} done · ${row.active} in progress · ${row.notStarted} not started · ${row.unassigned} not yet assigned (of ${row.required} planned)`}
                            >
                                <span className="ds-bar" aria-hidden="true">
                                    {row.completed ? <i className="ds-seg is-done" style={{ width: seg(row.completed) }} /> : null}
                                    {row.active ? <i className="ds-seg is-active" style={{ width: seg(row.active) }} /> : null}
                                    {row.notStarted ? <i className="ds-seg is-assigned" style={{ width: seg(row.notStarted) }} /> : null}
                                    {row.unassigned ? <i className="ds-seg is-gap" style={{ width: seg(row.unassigned) }} /> : null}
                                </span>
                            </Tooltip>
                            <span className="ds-figures">
                                <strong>
                                    {row.completed} of {Math.max(row.required, row.assigned)}
                                </strong>{' '}
                                done
                                {row.required === 0 ? (
                                    <span className="ds-flag">Not in plans</span>
                                ) : row.unassigned > 0 ? (
                                    <span className="ds-flag is-gap">{row.unassigned} to assign</span>
                                ) : null}
                            </span>
                        </button>
                    )
                })}
            </div>

            {selected && detail ? (
                <div className="ds-detail">
                    <div className="ds-detail-head">
                        <strong>{selected}</strong>
                        <span className="ds-muted">Interventions by status. The activity chart below shows this department too.</span>
                        <Button size="small" type="text" icon={<CloseOutlined />} aria-label="Close department" onClick={() => onSelect(null)} />
                    </div>
                    {detail}
                </div>
            ) : (
                <div className="ds-muted ds-hint">Select a department to see its interventions by status.</div>
            )}
        </div>
    )
}

export default DepartmentSnapshot
