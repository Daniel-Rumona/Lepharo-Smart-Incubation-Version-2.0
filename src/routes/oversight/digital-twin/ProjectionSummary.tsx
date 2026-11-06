import React, { useEffect, useState } from 'react'
import { ThunderboltOutlined } from '@ant-design/icons'
import { ruleSummary, type ProjectionFacts } from '@/services/digitalTwin/projectionSummary'
import { askProjectionSummary } from '@/services/digitalTwin/projectionSummaryApi'

const cache = new Map<string, string>()

/**
 * A short written comparison of the change with "if nothing changes". The built-in wording shows at once; the assistant's
 * wording replaces it when it arrives (only for a real change, after a short pause, and only if it used no number it was not given).
 */
export function ProjectionSummary({ facts }: { facts: ProjectionFacts }) {
    const key = JSON.stringify(facts), active = facts.changes.length > 0
    const [ai, setAi] = useState<{ key: string; text: string } | null>(null), [busy, setBusy] = useState(false)
    useEffect(() => {
        if (!active) { setBusy(false); return }
        const hit = cache.get(key)
        if (hit) { setAi({ key, text: hit }); return }
        const controller = new AbortController()
        setBusy(true)
        const timer = window.setTimeout(() => {
            askProjectionSummary(facts, controller.signal).then(text => { cache.set(key, text); setAi({ key, text }) }).catch(() => { /* the built-in wording stays */ }).finally(() => { if (!controller.signal.aborted) setBusy(false) })
        }, 800)
        return () => { window.clearTimeout(timer); controller.abort() }
    }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
    const fromAi = active && ai?.key === key
    return <aside className="ps-card" aria-label="What the change does" aria-live="polite">
        <header><ThunderboltOutlined aria-hidden="true" /><strong>What the change does</strong><span className={`ps-tag ${fromAi ? 'ai' : ''}`}>{fromAi ? 'Assistant' : 'Summary'}</span></header>
        <p>{fromAi ? ai!.text : ruleSummary(facts)}</p>
        {busy && !fromAi && <small>Asking the assistant to put it in words…</small>}
    </aside>
}
