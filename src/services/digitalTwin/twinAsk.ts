/**
 * Ask the twin: the facts a question is answered from, and the starter questions.
 * Pure (no app imports) so twinAsk.test.cjs can load it directly.
 */

export type AskItem = { owner: string; enteredAt: number | null }
export type AskGroup = { id: string; label: string; lane: string; hint: string; items: AskItem[] }

export type StageFact = {
    key: string
    label: string
    count: number
    oldestWaitDays: number | null
    overTwoWeeks: number
    whoActs: string[]
}

export type AskProjection = {
    weeks: number
    backlogToday: number
    backlogEnd: number
    scenarioBacklogEnd: number
    scenarioActive: boolean
    queuesToday: Record<string, number>
    queuesEnd: Record<string, number>
    scenarioQueuesEnd: Record<string, number>
}

export type TwinFacts = {
    scope: string
    stages: StageFact[]
    projection: AskProjection
    smesWaiting: number
}

/** The stages the scene draws, which an answer can highlight. */
export const SCENE_STAGES = ['delivery', 'hod', 'cc', 'me']
// The flow, in order; exceptions follow only when something is in them.
const FLOW = ['response', 'delivery', 'confirmation', 'prepare', 'hod', 'cc', 'me']
const DAY = 86400000

/** Every stage with work in it (and the main flow always), with how long things have waited and who must act. */
export function buildStageFacts(groups: AskGroup[], clock: number): StageFact[] {
    const fact = (group: AskGroup): StageFact => {
        const waiting = group.items.filter(item => item.owner !== 'None')
        const days = waiting
            .filter(item => item.enteredAt !== null && item.enteredAt <= clock)
            .map(item => Math.floor((clock - (item.enteredAt as number)) / DAY))
        const owners = new Map<string, number>()
        waiting.forEach(item => owners.set(item.owner, (owners.get(item.owner) || 0) + 1))
        return {
            key: group.id,
            label: group.label,
            count: group.items.length,
            oldestWaitDays: days.length ? Math.max(...days) : null,
            overTwoWeeks: days.filter(day => day > 14).length,
            whoActs: [...owners.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([owner]) => owner)
        }
    }
    const flow = FLOW.map(id => groups.find(group => group.id === id)).filter((group): group is AskGroup => !!group)
    const exceptions = groups.filter(group => /xception/.test(group.hint) && group.items.length > 0)
    return [...flow, ...exceptions].map(fact)
}

/** Three questions worth asking about this twin right now. */
export function starterQuestions(stages: StageFact[]): string[] {
    const scene = stages.filter(stage => SCENE_STAGES.includes(stage.key) && stage.count > 0)
    const questions: string[] = []
    const slowest = [...scene].sort((a, b) => (b.oldestWaitDays ?? -1) - (a.oldestWaitDays ?? -1))[0]
    if (slowest) questions.push(`Why are things waiting at ${slowest.label}?`)
    if (stages.some(stage => stage.overTwoWeeks > 0)) questions.push('What has waited more than two weeks?')
    else questions.push('Where is the most work waiting?')
    const busiest = [...scene].sort((a, b) => b.count - a.count)[0]
    const whatIf: Record<string, string> = {
        delivery: 'What if facilitators had 8 more hours a week?',
        hod: 'What if the head of department reviewed 3 days a week?',
        cc: 'What if we add 1 centre coordinator?',
        me: 'What if M&E had 8 more hours a week?'
    }
    questions.push(whatIf[busiest?.key || 'delivery'])
    return questions
}
