import React, { useMemo } from 'react'
import { Button, Collapse, Tag } from 'antd'
import { ArrowRightOutlined } from '@ant-design/icons'
import type { TwinIssue } from '@/services/digitalTwin/processTwin'

const SHOWN = 25
const plural = (n: number, one: string, many = one + 's') => `${n.toLocaleString('en-ZA')} ${n === 1 ? one : many}`

/** The records the twin could not use, grouped by what is wrong so the same message is not repeated per record. */
export function AttentionSummary({ issues, unknownAge, missingByStage, onInspect }: { issues: TwinIssue[]; unknownAge: number; missingByStage: Array<{ id: string; label: string; missing: number }>; onInspect: (id: string) => void }) {
    const groups = useMemo(() => {
        const by = new Map<string, TwinIssue[]>()
        for (const issue of issues) by.set(issue.reason, [...(by.get(issue.reason) || []), issue])
        return [...by.entries()].sort((a, b) => b[1].length - a[1].length).map(([reason, rows]) => {
            const [title, note] = reason.split(';').map(part => part.trim())
            return { reason, title, note: note ? note.charAt(0).toUpperCase() + note.slice(1) : '', rows }
        })
    }, [issues])
    return <div className="att">
        <p className="att-lead">
            {issues.length > 0 && <><b>{plural(issues.length, 'record')}</b> could not be used and are left out of the counts. </>}
            {unknownAge > 0 && <><b>{plural(unknownAge, 'record')}</b> are counted but have no date for when they entered their stage, so their wait cannot be measured.</>}
        </p>
        {groups.length > 0 && <Collapse ghost className="att-groups" items={groups.map(g => ({
            key: g.reason,
            label: <span className="att-label"><b>{g.title}</b><Tag>{g.rows.length}</Tag>{g.note && <small>{g.note}</small>}</span>,
            children: <ul className="att-list">
                {g.rows.slice(0, SHOWN).map(r => <li key={r.collection + r.id}>{r.label || `${r.collection} · ${r.id}`}</li>)}
                {g.rows.length > SHOWN && <li className="att-more">and {g.rows.length - SHOWN} more</li>}
            </ul>
        }))} />}
        {missingByStage.length > 0 && <div className="att-stages">
            {missingByStage.map(g => <div key={g.id} className="att-stage"><span><b>{g.label}</b> · {plural(g.missing, 'record')} without a date</span><Button size="small" shape="round" onClick={() => onInspect(g.id)}>Inspect <ArrowRightOutlined /></Button></div>)}
        </div>}
    </div>
}
