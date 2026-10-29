import React, { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Button, Empty } from 'antd'
import { ApartmentOutlined, ArrowRightOutlined, WarningOutlined, ExperimentOutlined, PlayCircleOutlined } from '@ant-design/icons'
import type { ProcessModel } from '@/services/digitalTwin/processTwin'
import { summariseWaits, WAIT_TARGET_DAYS, type WaitSummary } from '@/services/digitalTwin/twinTargets'
import { processGroups } from './ProcessMap'
import { TwinScene, type SceneStation } from './TwinScene'

/** The teams an intervention passes through, in flow order. The MOV is created when the facilitator completes the intervention, and starts with the SME's signature. */
const TEAMS: Array<{ key: string; name: string; unit: string; who: string; groups: Array<[string, string]> }> = [
    { key: 'delivery', name: 'Delivery', unit: 'interventions', who: 'Facilitators and SMEs', groups: [['response', 'Booking'], ['delivery', 'Support delivered'], ['confirmation', 'SME confirms']] },
    { key: 'prep', name: 'SME signature', unit: 'MOVs', who: 'SMEs', groups: [['prepare', 'SME signs the MOV']] },
    { key: 'hod', name: 'Head of dept. review', unit: 'MOVs', who: 'Heads of department', groups: [['hod', 'Head of dept. approves']] },
    { key: 'cc', name: 'Centre coordinator', unit: 'MOVs', who: 'Centre coordinators', groups: [['cc', 'Centre confirms work']] },
    { key: 'me', name: 'M&E quality check', unit: 'MOVs', who: 'M&E', groups: [['me', 'M&E quality check']] }
]
type Part = { id: string; label: string; count: number; past: number; dates: Array<number | null>; target: number }
type Team = { key: string; name: string; unit: string; who: string; parts: Part[]; count: number; past: number; wait: WaitSummary; level: Level; target: number }

type Level = 'idle' | 'ok' | 'late' | 'slow'
const plural = (n: number, one: string, many = one + 's') => `${n.toLocaleString('en-ZA')} ${n === 1 ? one : many}`
const EXCEPTION_VERB: Record<string, string> = { 'accept-overdue': 'has not answered the invitation', cancelled: 'has been cancelled', 'participant-declined': 'was declined by the SME', 'participant-rejected': 'had its completion rejected', 'needs-reassignment': 'needs a new facilitator', queried: 'has a query open', rejected: 'was rejected' }
const R = 92, CIRC = 2 * Math.PI * R, ALERT_SECONDS = 5

/** One intervention that needs a look now; "Look" opens its details. */
type Alert = { key: string; tone: 'hot' | 'warn'; title: string; detail: string; itemKey: string }

export function TwinOverview({ model, clock, onInspect, onNavigate }: { model: ProcessModel; clock: number; onInspect: (itemKey: string) => void; onNavigate: (view: 'current' | 'history' | 'scenarios') => void }) {
    const [alertAt, setAlertAt] = useState(0), [paused, setPaused] = useState(false)
    const reduced = useReducedMotion()
    const view = useMemo(() => {
        const groups = processGroups(model, clock)
        const teams: Team[] = TEAMS.map(t => {
            const parts = t.groups.map(([id, label]) => {
                const group = groups.find(g => g.id === id)
                const waiting = (group?.items || []).filter(i => i.owner !== 'None')
                const target = WAIT_TARGET_DAYS[id] ?? 7
                return { id, label, count: waiting.length, past: summariseWaits(waiting.map(i => i.enteredAt), clock, target).pastTarget, dates: waiting.map(i => i.enteredAt), target }
            })
            const count = parts.reduce((n, p) => n + p.count, 0), past = parts.reduce((n, p) => n + p.past, 0)
            const lead = [...parts].sort((a, b) => b.count - a.count)[0]
            const wait = summariseWaits(parts.flatMap(p => p.dates), clock, lead.target)
            const level: Level = count === 0 ? 'idle' : wait.median !== null && wait.median > lead.target ? 'slow' : past > 0 ? 'late' : 'ok'
            return { key: t.key, name: t.name, unit: t.unit, who: t.who, parts, count, past, wait, level, target: lead.target }
        })
        const exceptionGroups = groups.filter(g => g.hint.includes('xception'))
        const attentionCount = exceptionGroups.reduce((n, g) => n + g.items.length, 0)
        const attention: Team = { key: 'attention', name: 'Needs attention', unit: 'records', who: '', parts: exceptionGroups.map(g => ({ id: g.id, label: g.label, count: g.items.length, past: 0, dates: [], target: 0 })), count: attentionCount, past: 0, wait: summariseWaits([], clock, 7), level: attentionCount ? 'late' : 'idle', target: 0 }
        const open = teams.reduce((n, t) => n + t.count, 0), past = teams.reduce((n, t) => n + t.past, 0)
        // Who each waiting Delivery record is waiting on, straight from the record's own owner.
        const deliveryOwners: Record<string, number> = {}
        for (const p of teams[0].parts) for (const it of groups.find(g => g.id === p.id)?.items || []) if (it.owner !== 'None') deliveryOwners[it.owner] = (deliveryOwners[it.owner] || 0) + 1
        // Confirming completion is what signs the MOV, so an intervention waiting to be confirmed and its MOV waiting for the signature are one thing: count it once.
        const smeWork = new Set<string>()
        for (const id of ['confirmation', 'prepare']) for (const it of groups.find(g => g.id === id)?.items || []) if (it.owner !== 'None') smeWork.add(it.assignmentId || it.key)
        // Delivery counts interventions; every other flow circle counts MOVs.
        const delivering = teams[0].count
        // The intervention to look at first in each team that is running slow (the one waiting longest), then the oldest in the biggest groups that left the normal path.
        const days = (at: number | null) => at === null ? null : Math.max(0, Math.floor((clock - at) / 86400000))
        const oldest = <T extends { enteredAt: number | null }>(items: T[]) => [...items].sort((a, b) => (a.enteredAt ?? Infinity) - (b.enteredAt ?? Infinity))[0]
        const alerts: Alert[] = []
        teams.filter(t => t.level === 'slow').sort((a, b) => b.past - a.past).forEach(t => {
            const waiting = t.parts.flatMap(p => (groups.find(g => g.id === p.id)?.items || []).filter(i => i.owner !== 'None')), item = oldest(waiting)
            if (item) { const d = days(item.enteredAt); alerts.push({ key: 'team-' + t.key, tone: 'hot', title: item.participant, detail: d === null ? `${item.title} is waiting at ${t.name}` : `${item.title} has waited ${d} days at ${t.name}`, itemKey: item.key }) }
        })
        groups.filter(g => g.hint.includes('xception') && g.items.length).sort((a, b) => b.items.length - a.items.length).slice(0, 2).forEach(g => {
            const item = oldest(g.items)
            alerts.push({ key: 'group-' + g.id, tone: 'warn', title: item.participant, detail: `${item.title} ${EXCEPTION_VERB[g.id] || `is ${g.label.toLowerCase()}`}${g.items.length > 1 ? ` · ${g.items.length} like this` : ''}`, itemKey: item.key })
        })
        // For the hover on each pile: how many records are waiting today and the few that have waited longest.
        const peek: Record<string, { total: number; lines: string[] }> = {}
        const describe = (items: Array<{ participant: string; title: string; enteredAt: number | null }>) => [...items].sort((a, b) => (a.enteredAt ?? Infinity) - (b.enteredAt ?? Infinity)).slice(0, 3).map(i => { const d = days(i.enteredAt); return `${i.participant} · ${i.title}${d === null ? '' : ` · ${d} days`}` })
        for (const t of teams) { const waiting = t.parts.flatMap(p => (groups.find(g => g.id === p.id)?.items || []).filter(i => i.owner !== 'None')); peek[t.key] = { total: t.count, lines: describe(waiting) } }
        peek.attention = { total: attentionCount, lines: describe(exceptionGroups.flatMap(g => g.items)) }
        return { teams, attention, open, past, health: open ? Math.round((open - past) / open * 100) : null, delivering, alerts, peek, deliveryOwners, smeCount: smeWork.size }
    }, [model, clock])
    const alertCount = view.alerts.length
    useEffect(() => { if (alertAt >= alertCount) setAlertAt(0) }, [alertAt, alertCount])
    useEffect(() => {
        if (alertCount < 2 || paused) return
        const timer = window.setInterval(() => setAlertAt(i => (i + 1) % alertCount), ALERT_SECONDS * 1000)
        return () => window.clearInterval(timer)
    }, [alertCount, paused, alertAt])

    if (!model.items.length) return <Empty description="No intervention records match this scope." />
    const { teams, attention, alerts, peek, deliveryOwners, smeCount } = view
    const circles = [...teams, attention]
    const alert = alerts[Math.min(alertAt, alerts.length - 1)]

    const station = (t: Team): SceneStation => ({ key: t.key, name: t.name, unit: t.unit, count: t.count, late: t.past, note: t.count === 0 ? 'nothing waiting' : t.key === 'attention' ? 'off the normal path' : t.wait.median === null ? 'wait unknown' : `typically ${t.wait.median}d` })

    const alertBlock = <div className="ov-alert-slot" data-guide="twin-alerts" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
        {alert ? <div className={`ov-alert ${alert.tone}`} role="status" aria-label="Needs a look now">
            <WarningOutlined aria-hidden="true" />
            <AnimatePresence mode="wait" initial={false}>
                <motion.div key={alert.key} className="ov-alert-text" initial={reduced ? false : { opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={reduced ? undefined : { opacity: 0, y: -6 }} transition={{ duration: .2 }}>
                    <strong title={alert.title}>{alert.title}</strong><span title={alert.detail}>{alert.detail}</span>
                </motion.div>
            </AnimatePresence>
            <Button size="small" shape="circle" aria-label="Look at this intervention" title="Look at this intervention" icon={<ArrowRightOutlined />} onClick={() => { onInspect(alert.itemKey) }} />
        </div> : <div className="ov-alert calm" role="status"><span className="ov-alert-text"><strong>Nothing needs immediate attention.</strong></span></div>}
    </div>

    const nav = <nav className="ov-actions" aria-label="Open a view" data-guide="twin-views">
        <Button shape="round" icon={<PlayCircleOutlined />} onClick={() => { onNavigate('history') }}>History</Button>
        <Button shape="round" icon={<ApartmentOutlined />} onClick={() => { onNavigate('current') }}>Current state</Button>
        <Button shape="round" icon={<ExperimentOutlined />} onClick={() => { onNavigate('scenarios') }}>Projection</Button>
    </nav>

    return <section className="ov" aria-label="Intervention overview">
        <TwinScene nav={nav} notice={alertBlock} deliveryRecords={teams[0].count} deliveryOwners={deliveryOwners} smes={{ count: smeCount }} outside={[station(attention)]} peek={peek} onSeeAll={() => { onNavigate('current') }} />
    </section>
}
