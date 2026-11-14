import React, { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ArrowRightOutlined, ArrowUpOutlined, CloseOutlined, ExperimentOutlined, MessageOutlined } from '@ant-design/icons'
import { askTwin, type TwinAnswer } from '@/services/digitalTwin/twinAskApi'
import { SCENE_STAGES, starterQuestions, type StageFact, type TwinFacts } from '@/services/digitalTwin/twinAsk'
import { useScenario } from './ScenarioState'
import type { SceneProjection } from './TwinScene'

type Turn = { question: string; answer: TwinAnswer; applied?: string }

type Props = {
    projection: SceneProjection
    stages: StageFact[]
    scope: string
    smesWaiting: number
    /** Teams on the scene to light up while an answer is about them. */
    onHighlight: (keys: string[]) => void
    /** Opens a stage's records over the scene. */
    onOpenStage: (key: string) => void
}

/**
 * Ask the twin. Sits where the scene's summary sentence is: with nothing asked it shows that sentence; an answer
 * takes its place (with "Back to summary"), lights up the teams it is about, and can open their records or set the
 * dials. Only the latest exchange shows; earlier ones fold away.
 */
export function AskTheTwin({ projection, stages, scope, smesWaiting, onHighlight, onOpenStage }: Props) {
    const reduced = useReducedMotion()
    const { applyChange } = useScenario()
    const [text, setText] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [turns, setTurns] = useState<Turn[]>([])
    const [showEarlier, setShowEarlier] = useState(false)
    const abortRef = useRef<AbortController | null>(null)
    const latest = turns[turns.length - 1]

    useEffect(() => () => abortRef.current?.abort(), [])

    const ask = async (question: string) => {
        const q = question.trim()
        if (!q || busy) return
        abortRef.current?.abort()
        const controller = new AbortController()
        abortRef.current = controller
        setBusy(true)
        setError('')
        try {
            const { summary: _summary, ...numbers } = projection
            const facts: TwinFacts = { scope, stages, projection: numbers, smesWaiting }
            const answer = await askTwin(q, facts, turns.slice(-2).map(t => ({ question: t.question, answer: t.answer.answer })), controller.signal)
            setTurns(previous => [...previous, { question: q, answer }])
            setShowEarlier(false)
            onHighlight(answer.stages.filter(key => SCENE_STAGES.includes(key)))
            setText('')
        } catch (reason: any) {
            if (reason?.name !== 'AbortError') setError('The twin couldn’t answer that right now. Try asking it another way.')
        } finally {
            setBusy(false)
        }
    }

    const backToSummary = () => {
        setTurns([])
        setError('')
        onHighlight([])
    }

    const runAction = async () => {
        const action = latest?.answer.action
        if (!action) return
        if (action.kind === 'records') {
            onOpenStage(action.stage)
            return
        }
        setBusy(true)
        const intent = await applyChange(action.change)
        setBusy(false)
        const applied = intent.understood.length ? `Applied: ${intent.understood.join(' · ')}.` : 'The model could not read that change.'
        setTurns(previous => previous.map((turn, index) => (index === previous.length - 1 ? { ...turn, applied } : turn)))
    }

    const suggestions = starterQuestions(stages)

    return (
        <div className="tw-ask" data-guide="twin-ask">
            <AnimatePresence mode="wait" initial={false}>
                {latest ? (
                    <motion.div
                        key={`answer-${turns.length}`}
                        className="tw-answer"
                        role="status"
                        initial={reduced ? false : { opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={reduced ? undefined : { opacity: 0, y: -6 }}
                        transition={{ duration: 0.18 }}
                    >
                        <div className="tw-answer-q">
                            <MessageOutlined aria-hidden="true" />
                            <span>{latest.question}</span>
                            <button type="button" className="tw-link" onClick={backToSummary}>
                                <CloseOutlined aria-hidden="true" /> Back to summary
                            </button>
                        </div>
                        <p className="tw-answer-text">{latest.answer.answer}</p>
                        {latest.applied ? (
                            <p className="tw-answer-applied">{latest.applied} {projection.summary}</p>
                        ) : null}
                        {latest.answer.action && !latest.applied ? (
                            <button type="button" className="tw-action" onClick={runAction} disabled={busy}>
                                {latest.answer.action.kind === 'scenario' ? <ExperimentOutlined aria-hidden="true" /> : null}
                                {latest.answer.action.label}
                                {latest.answer.action.kind === 'records' ? <ArrowRightOutlined aria-hidden="true" /> : null}
                            </button>
                        ) : null}
                        {turns.length > 1 ? (
                            <div className="tw-earlier">
                                <button type="button" className="tw-link" onClick={() => setShowEarlier(open => !open)}>
                                    {showEarlier ? 'Hide' : 'Previous questions'} ({turns.length - 1})
                                </button>
                                {showEarlier ? (
                                    <ul>
                                        {turns.slice(0, -1).reverse().map((turn, index) => (
                                            <li key={index}><b>{turn.question}</b> {turn.answer.answer}</li>
                                        ))}
                                    </ul>
                                ) : null}
                            </div>
                        ) : null}
                    </motion.div>
                ) : (
                    <motion.p
                        key="summary"
                        className="ts-headline"
                        initial={reduced ? false : { opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={reduced ? undefined : { opacity: 0 }}
                        transition={{ duration: 0.15 }}
                    >
                        {projection.summary}
                    </motion.p>
                )}
            </AnimatePresence>

            <form className="sc-ask tw-ask-form" onSubmit={event => { event.preventDefault(); void ask(text) }}>
                <div className="sc-ask-field">
                    <MessageOutlined aria-hidden="true" />
                    <input
                        aria-label="Ask the twin"
                        value={text}
                        disabled={busy}
                        onChange={event => setText(event.target.value)}
                        placeholder="Ask the twin, e.g. why is HOD review the slowest?"
                        maxLength={400}
                    />
                    <button type="submit" className="sc-ask-send" aria-label="Ask" disabled={!text.trim() || busy}><ArrowUpOutlined /></button>
                </div>
                {busy ? <p className="sc-ask-note" role="status">The twin is looking at its numbers…</p> : null}
                {error ? <p className="sc-ask-note"><span className="warn">{error}</span></p> : null}
                {!latest && !busy ? (
                    <div className="tw-suggest" aria-label="Questions to ask">
                        {suggestions.map(question => (
                            <button key={question} type="button" onClick={() => void ask(question)}>{question}</button>
                        ))}
                    </div>
                ) : null}
            </form>
        </div>
    )
}

export default AskTheTwin
