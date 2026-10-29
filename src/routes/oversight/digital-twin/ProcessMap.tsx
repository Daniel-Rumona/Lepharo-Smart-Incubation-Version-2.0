import React from 'react'
import { Badge, Empty, Typography } from 'antd'
import { ArrowRightOutlined, CheckCircleOutlined, FileProtectOutlined, RocketOutlined } from '@ant-design/icons'
import { overdueAcceptance } from '@/services/digitalTwin/twinTargets'
import type { ProcessModel, TwinItem } from '@/services/digitalTwin/processTwin'

export type ProcessGroup = { id: string; label: string; lane: string; items: TwinItem[]; hint: string }
export function processGroups(model: ProcessModel, clock?: number): ProcessGroup[] {
    const group = (id: string, label: string, lane: string, stages: string[], hint: string): ProcessGroup => ({ id, label, lane, items: model.lanes.find(l => l.key === lane)!.stages.filter(s => stages.includes(s.key)).flatMap(s => s.items), hint })
    return [
        group('response', 'Appointment response', 'delivery', ['assigned', 'awaiting-participant-acceptance'], 'SME / facilitator'),
        group('delivery', 'Deliver support', 'delivery', ['in-delivery'], 'Facilitator'),
        group('confirmation', 'Confirm completion', 'delivery', ['awaiting-participant-confirmation'], 'SME'),
        group('completed', 'Delivery completed', 'delivery', ['completed'], 'Confirmed assignments'),
        group('prepare', 'SME signs the MOV', 'evidence', ['awaiting_smme'], 'SME'),
        group('hod', 'HOD approval', 'evidence', ['awaiting_hod'], 'Head of department'),
        group('cc', 'Centre coordination', 'evidence', ['hod_approved', 'in_pack'], 'Pack preparation / CC'),
        group('me', 'M&E validation', 'evidence', ['cc_confirmed'], 'Monitoring & evaluation'),
        group('validated', 'Evidence validated', 'evidence', ['me_validated', 'invoice_redeemable'], 'Validated / redeemable'),
        ...model.lanes[2].stages.map(s => group(`outcome-${s.key}`, s.label, 'outcomes', [s.key], 'Follow-up reports')),
        ...['needs-reassignment', 'participant-declined', 'participant-rejected', 'cancelled'].map(key => group(key, model.lanes[0].stages.find(s => s.key === key)!.label, 'delivery', [key], 'Exception')),
        ...['queried', 'rejected'].map(key => group(key, model.lanes[1].stages.find(s => s.key === key)!.label, 'evidence', [key], 'Evidence exception')),
        // Only when the time is known: invitations the SME has left unanswered too long.
        ...(clock === undefined ? [] : [{ id: 'accept-overdue', label: 'Invitation not answered', lane: 'delivery', items: overdueAcceptance(model.lanes[0].stages.flatMap(s => s.items), clock), hint: 'Exception' } as ProcessGroup])
    ]
}
export function ProcessMap({ model, clock, onSelect }: { model: ProcessModel; clock: number; onSelect: (id: string) => void }) {
    const groups = processGroups(model)
    const nodes = (ids: string[]) => ids.map((id, index) => { const group = groups.find(g => g.id === id)!; const ages = group.items.filter(i => i.owner !== 'None' && i.enteredAt !== null && i.enteredAt <= clock).map(i => Math.floor((clock - i.enteredAt!) / 86400000)); return <button className={`twin-process-node ${group.items.length ? 'occupied' : ''}`} key={id} onClick={() => onSelect(id)} aria-label={`${group.label}: ${group.items.length} records`}><div className="twin-node-top"><span className="twin-step">{index + 1}</span><ArrowRightOutlined /></div><span className="twin-process-label">{group.label}</span><strong>{group.items.length}</strong><small>{ages.length ? `Oldest recorded wait ${Math.max(...ages)}d` : group.hint}</small></button> })
    const exceptions = groups.filter(g => g.hint.includes('xception'))
    const outcomes = groups.filter(g => g.lane === 'outcomes')
    const totalOutcomes = model.followUps.length
    const totalExceptions = exceptions.reduce((sum, g) => sum + g.items.length, 0)
    const bars = (rows: ProcessGroup[], total: number) => <div className="twin-summary-bars">{rows.filter(g => g.items.length > 0).map(g => <button className="twin-summary-bar" key={g.id} onClick={() => onSelect(g.id)} aria-label={g.label + ': ' + g.items.length + ' records'}><span className="twin-summary-label">{g.label}</span><span className="twin-summary-track" aria-hidden="true"><span className={g.lane === 'outcomes' ? g.id : 'exception-fill'} style={{ width: (g.items.length / Math.max(1, total) * 100) + '%' }} /></span><strong>{g.items.length}</strong></button>)}</div>
    return <section className="twin-workspace" aria-label="Intervention process map">
        {!model.items.length ? <Empty description="No intervention records match this scope." /> : <>
            <div className="twin-flow-section delivery"><div className="twin-flow-heading"><div><RocketOutlined /><strong>Service delivery</strong><span>{model.assignments.length} assignments</span></div><span className="twin-muted">From response to confirmed completion</span></div><p className="twin-section-explainer">Where is each intervention now? Counts are assignments, so one SME can appear more than once. Open a stage to see the next responsible person.</p><div className="twin-process-row delivery-row">{nodes(['response', 'delivery', 'confirmation', 'completed'])}</div></div>
            <div className="twin-flow-section evidence"><div className="twin-flow-heading"><div><FileProtectOutlined /><strong>Evidence & assurance</strong><span>{model.movs.length} individual MOVs</span></div><span className="twin-muted">A separate approval path</span></div><p className="twin-section-explainer">Has the proof of delivery been approved? MOV means means of verification. HOD is the head of department; M&E is monitoring and evaluation.</p><div className="twin-process-row evidence-row">{nodes(['prepare', 'hod', 'cc', 'me', 'validated'])}</div></div>
            <div className="twin-summary-grid">
                <div className="twin-outcomes-section"><div className="twin-flow-heading"><div><CheckCircleOutlined /><strong>What changed for SMEs?</strong><span>{totalOutcomes} follow-ups</span></div></div><p className="twin-section-explainer">Each bar shows a share of follow-up reports, not unique SMEs or proven business growth.</p>{totalOutcomes ? bars(outcomes, totalOutcomes) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No follow-up reports" />}</div>
                <div className="twin-exceptions"><div className="twin-flow-heading"><div><Badge status="warning" /><strong>Exceptions</strong><span>{totalExceptions} records</span></div></div><p className="twin-section-explainer">Each bar shows a share of exception records. Delivery assignments and evidence records are counted separately.</p>{totalExceptions ? bars(exceptions, totalExceptions) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No exceptions in this scope" />}</div>
            </div>
            <Typography.Paragraph className="twin-footnote">Each number counts records currently in that stage. Select a stage to see the SMEs, their status and who needs to act; choose View details for appointments and evidence. Delivery, evidence and follow-ups are counted separately.</Typography.Paragraph>
        </>}
    </section>
}
