import { useId } from 'react'
import {
    NO_CHANGE_SCENARIO,
    scenarioLimits,
    type DigitalTwinRecord,
    type TwinScenario
} from '@twin/rules'

type Limits = ReturnType<typeof scenarioLimits>

function Lever({ label, hint, value, max, onChange, format }: {
    label: string
    hint: string
    value: number
    max: number
    onChange: (value: number) => void
    format?: (value: number) => string
}) {
    const id = useId()
    return (
        <div className='twin-lever'>
            <div className='twin-lever-head'>
                <label htmlFor={id}>{label}</label>
                <output htmlFor={id} className='twin-num'>{format ? format(value) : `${value} of ${max}`}</output>
            </div>
            <input
                id={id}
                type='range'
                min={0}
                max={max}
                step={1}
                value={value}
                onChange={event => onChange(Number(event.target.value))}
                style={{ ['--fill' as any]: `${max ? (value / max) * 100 : 0}%` }}
            />
            <div className='twin-bar-detail'>{hint}</div>
        </div>
    )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
    return (
        <label className='twin-toggle'>
            <input type='checkbox' checked={checked} onChange={event => onChange(event.target.checked)} />
            <span className='twin-toggle-track' aria-hidden><span /></span>
            {label}
        </label>
    )
}

/**
 * The what-if levers. Each one moves an input the twin rules already use, so
 * the chart, the horizon cards and the growth score show the rules' own answer.
 */
export function WhatIfControls({ record, scenario, onChange, horizonDays }: {
    record: DigitalTwinRecord
    scenario: TwinScenario
    onChange: (scenario: TwinScenario) => void
    horizonDays: number
}) {
    const limits: Limits = scenarioLimits(record)
    const set = (patch: Partial<TwinScenario>) => onChange({ ...scenario, ...patch })
    const serving = scenario.serviceInDays !== null

    const everything: TwinScenario = {
        serviceInDays: 7,
        documentsUploaded: limits.documentsUploaded,
        renewExpiring: limits.expiringDocuments > 0,
        documentsFixed: limits.documentsFixed,
        smeResponses: limits.smeResponses,
        departmentsFollowedUp: limits.departmentsFollowedUp,
        declinesResolved: limits.declinesResolved,
        interventionsCompleted: limits.interventionsCompleted,
        roadmapConfirmed: limits.roadmapConfirmed
    }

    return (
        <div className='twin-whatif'>
            <div className='twin-whatif-presets'>
                <span className='twin-next-label'>Try</span>
                <button className='twin-tab' onClick={() => set({ serviceInDays: 7 })}>Serve within a week</button>
                {limits.documentsUploaded + limits.documentsFixed > 0 && (
                    <button className='twin-tab' onClick={() => set({ documentsUploaded: limits.documentsUploaded, documentsFixed: limits.documentsFixed, renewExpiring: limits.expiringDocuments > 0 })}>
                        Sort out all documents
                    </button>
                )}
                <button className='twin-tab' onClick={() => onChange(everything)}>Everything on track</button>
                <button className='twin-tab' onClick={() => onChange(NO_CHANGE_SCENARIO)}>Reset</button>
            </div>

            <div className='twin-levers'>
                <div className='twin-lever'>
                    <div className='twin-lever-head'>
                        <Toggle label='Deliver a service' checked={serving} onChange={checked => set({ serviceInDays: checked ? 7 : null })} />
                        <output className='twin-num'>{serving ? (scenario.serviceInDays === 0 ? 'today' : `in ${scenario.serviceInDays} days`) : 'off'}</output>
                    </div>
                    <input
                        type='range'
                        aria-label='Days until the service is delivered'
                        min={0}
                        max={horizonDays}
                        step={1}
                        disabled={!serving}
                        value={scenario.serviceInDays ?? 7}
                        onChange={event => set({ serviceInDays: Number(event.target.value) })}
                        style={{ ['--fill' as any]: `${((scenario.serviceInDays ?? 0) / horizonDays) * 100}%` }}
                    />
                    <div className='twin-bar-detail'>Resets the days since last service on that day.</div>
                </div>

                {limits.documentsUploaded > 0 && (
                    <Lever label='Missing documents uploaded' hint='Uploaded and verified now.'
                        value={scenario.documentsUploaded} max={limits.documentsUploaded} onChange={value => set({ documentsUploaded: value })} />
                )}
                {limits.documentsFixed > 0 && (
                    <Lever label='Queried or rejected documents fixed' hint='Corrected and accepted now.'
                        value={scenario.documentsFixed} max={limits.documentsFixed} onChange={value => set({ documentsFixed: value })} />
                )}
                {limits.smeResponses > 0 && (
                    <Lever label='SME responds to pending items' hint='Accepts appointments or confirms completed work.'
                        value={scenario.smeResponses} max={limits.smeResponses} onChange={value => set({ smeResponses: value })} />
                )}
                {limits.departmentsFollowedUp > 0 && (
                    <Lever label='Departments followed up' hint='Plan confirmed and a service assigned.'
                        value={scenario.departmentsFollowedUp} max={limits.departmentsFollowedUp} onChange={value => set({ departmentsFollowedUp: value })} />
                )}
                {limits.declinesResolved > 0 && (
                    <Lever label='Declined interventions resolved' hint='Rescheduled and agreed with the SME.'
                        value={scenario.declinesResolved} max={limits.declinesResolved} onChange={value => set({ declinesResolved: value })} />
                )}
                {limits.interventionsCompleted > 0 && (
                    <Lever label='More interventions completed' hint='Moves the growth score, not needs attention.'
                        value={scenario.interventionsCompleted} max={limits.interventionsCompleted} onChange={value => set({ interventionsCompleted: value })} />
                )}
                {limits.roadmapConfirmed > 0 && (
                    <Lever label='More roadmap areas confirmed' hint='Moves the growth score.'
                        value={scenario.roadmapConfirmed} max={limits.roadmapConfirmed} onChange={value => set({ roadmapConfirmed: value })} />
                )}
                {limits.expiringDocuments > 0 && (
                    <div className='twin-lever'>
                        <Toggle
                            label={`Renew the ${limits.expiringDocuments} document${limits.expiringDocuments === 1 ? '' : 's'} expiring soon`}
                            checked={scenario.renewExpiring}
                            onChange={checked => set({ renewExpiring: checked })}
                        />
                        <div className='twin-bar-detail'>Renewed before the expiry date, so they never lapse.</div>
                    </div>
                )}
            </div>
        </div>
    )
}
