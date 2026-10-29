import type { DriveStep } from 'driver.js'
import { guideTarget, type AppGuide } from '@/components/guide-me'

export type TwinView = 'current' | 'history' | 'scenarios'

const step = (target: string | null, title: string, description: string, side: 'top' | 'bottom' | 'left' | 'right' = 'bottom'): DriveStep => ({
    ...(target ? { element: guideTarget(target) } : {}),
    popover: { title, description, side, align: 'start' }
})

/**
 * One guide per tab for the app-wide Guide Me launcher. Each guide switches the tab when it starts;
 * its first step has no target so the tab has rendered before the first highlight.
 */
export const buildTwinGuides = (setView: (view: TwinView) => void): AppGuide[] => [
    {
        id: 'twin-current-state',
        title: 'Current state: where work is stuck',
        description: 'Read the journey map, the verdict and who needs to act.',
        kind: 'page',
        order: 1,
        steps: () => {
            setView('current')
            return [
                step(null, 'What this tab shows', 'Today’s work, from live records. It follows the programme chosen in the universal filter. This is an early model of intervention delivery, not of an SME’s whole business. Demo data is labelled Synthetic.'),
                step('twin-verdict', 'Start with the verdict', 'This sentence names the step where most work is waiting, who it is waiting on and the longest known wait. Waits are measured from a recorded stage-entry date; records without one are not counted as zero.'),
                step('twin-track-delivery', 'Track 1: delivering support', 'Each circle counts interventions at that step, not unique SMEs, so one SME can appear more than once. Bigger and warmer means more is waiting. Select a circle to see who needs to act.', 'top'),
                step('twin-track-evidence', 'Track 2: approving the evidence', 'MOV means means of verification: proof that support took place. Each count is one piece of proof, even when reviewed in a monthly pack. Delivered support does not mean approved evidence.', 'top'),
                step('twin-outcomes', 'What the SMEs reported', 'Each coloured block is a share of follow-up reports. Achieved, partial and not achieved are reports, not proven business growth. Disputed means the facilitator and SME disagree; unknown has no usable result.', 'top'),
                step('twin-attention', 'Needs attention', 'Declined, cancelled, queried or rejected work that has left the normal path. These are counted separately from the two tracks.', 'top')
            ]
        }
    },
    {
        id: 'twin-history',
        title: 'History: replay recorded milestones',
        description: 'Watch assignments reach each step over time.',
        kind: 'page',
        order: 2,
        steps: () => {
            setView('history')
            return [
                step(null, 'What this tab shows', 'A replay of dated milestones taken from source records. It only shows what was recorded; gaps are not filled in. Demo milestones are synthetic, and this is not yet a permanent operational history.'),
                step('twin-history-controls', 'Play and restart', 'It opens on where things stand today. Play replays the recorded events in date order from the start; the timeline underneath lets you jump to any date.', 'left'),
                step('twin-history-summary', 'The date and headline', 'The sentence and date update as the replay moves. Drag the timeline underneath to jump to any date.'),
                step('twin-history-steps', 'Running totals, not queues', 'Each circle counts assignments that have reached that step by the date shown. It is a running total, not how many were waiting there that day.', 'top'),
                step('twin-history-routes', 'Three ways to attend', 'Sessions are attended in person, virtually or by telephone. They merge back into Support delivered. Routes can overlap because one assignment may be attended in more than one way.', 'top'),
            ]
        }
    },
    {
        id: 'twin-scenarios',
        title: 'Projection: test a change',
        description: 'Try more capacity, faster reviews or more SMEs and see the backlog projected, without touching real work.',
        kind: 'page',
        order: 3,
        steps: () => {
            setView('scenarios')
            return [
                step(null, 'What this window shows', 'The dials are the same ones on the scene. A simple queue model that compares what happens if nothing changes with a change you choose. Results are scenario estimates based on editable assumptions, not forecasts. Nothing is written to real records.'),
                step('twin-baseline', '1. The starting point', 'How many open interventions are being simulated, and when they were captured. Records that need a response, correction or evidence are left out, with reasons under the info button. Click this chip to refresh with the latest records. Whether new work keeps arriving, and the other assumptions, are under Settings next to it.', 'bottom'),
                step('twin-levers', '2. Choose what to change', 'Each dial is one lever: facilitator, coordinator or M&E hours, head-of-department review days, or new SMEs joining. Drag the slider or type a number. A highlighted dial differs from today, and it shows the same change on the scene. Reset clears them all.', 'bottom'),
                step('twin-describe', 'Or describe it in words', 'Type a change, for example “add 2 centre coordinators and 30 new SMEs over 12 weeks”. It reads hours, people, review days, new SMEs and how many weeks, sets the matching dials and says what it used. The assistant reads it when it is available, otherwise a simple built-in reader does; either way, anything it cannot use is listed, never guessed.', 'bottom'),
                step('twin-goal', 'Or set a goal', 'Pick the date you want everything cleared by and press Suggest a change. The tool finds a team-capacity change that does it in this model, and Apply these puts it into the dials.', 'bottom'),
                step('twin-run', 'Results update as you go', 'There is no Run button: the chart recalculates whenever you change a dial or a setting.', 'bottom'),
                step('twin-results', 'Read the result', 'The chart shows open interventions day by day, if nothing changes against your change, stacked by team. More delivery capacity can simply move the bottleneck downstream.', 'top')
            ]
        }
    }
]
