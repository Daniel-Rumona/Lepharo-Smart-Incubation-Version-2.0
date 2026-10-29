import React from 'react'
import { Alert, Button, DatePicker, Input, InputNumber, Segmented, Select, Tooltip } from 'antd'
import {
    CalendarOutlined,
    CheckCircleOutlined,
    EditOutlined,
    FileTextOutlined,
    LineChartOutlined,
    NumberOutlined,
    ProjectOutlined,
    TeamOutlined
} from '@ant-design/icons'
import { nextTargetPeriodStart, type CountMode, type KPI, type SourceType } from './kpiModel'
import {
    CALC_LABELS,
    METRIC_FIELDS,
    SOURCE_LABELS,
    calcOptionsFor,
    deriveUnit,
    interventionBelongsToDepartment,
    interventionLabel,
    periodStarted,
    programLabel,
    relevantDepartments,
    summarise,
    toPeriodStart,
    type Calc,
    type DraftContext,
    type KpiDraft,
    type PartMode,
    type RatioDraft
} from './kpiDraft'
import { KpiConditions } from './KpiConditions'
import { DepartmentMultiSelect, DepartmentSelect } from './DepartmentSelect'

export const BUILDER_STEPS = ['Basics', 'Measurement', 'Target'] as const

type Props = {
    draft: KpiDraft
    onChange: (patch: Partial<KpiDraft>) => void
    step: number
    ctx: DraftContext
    isNew: boolean
    editing?: KPI | null
    /** Problems on this step, shown once the user has tried to continue. */
    errors: string[]
    onManageTargets?: () => void
}

/** A labelled field with optional help underneath. */
const Field: React.FC<{ label: string; hint?: React.ReactNode; children: React.ReactNode; htmlFor?: string }> = ({ label, hint, children, htmlFor }) => (
    <div className='kb-field'>
        <label className='kb-label' htmlFor={htmlFor}>{label}</label>
        {children}
        {hint && <div className='kb-hint'>{hint}</div>}
    </div>
)

const METRIC_SHORT: Record<string, string> = { monthlyRevenue: 'Monthly revenue', jobsCreated: 'Jobs created', jobsSustained: 'Jobs sustained' }

/** One side of a percentage: what is counted or measured, and which records. */
const RatioPart: React.FC<{
    title: string
    sourceType: SourceType
    part: RatioDraft
    onChange: (part: RatioDraft) => void
}> = ({ title, sourceType, part, onChange }) => {
    const valueModes = sourceType === 'metrics'
    return (
        <div className='kb-ratio-part'>
            <div className='kb-ratio-title'>{title}</div>
            {valueModes && (
                <Segmented
                    block
                    value={part.mode}
                    onChange={mode => onChange({ ...part, mode: mode as PartMode, field: mode === 'count_records' ? null : part.field || METRIC_FIELDS[0]?.key || null })}
                    options={[
                        { value: 'count_records', label: 'Count' },
                        { value: 'sum_field', label: 'Total' },
                        { value: 'avg_field', label: 'Average' }
                    ]}
                />
            )}
            {part.mode !== 'count_records' && (
                <Select
                    style={{ width: '100%', marginTop: 8 }}
                    value={part.field || undefined}
                    placeholder='Which value'
                    onChange={field => onChange({ ...part, field })}
                    options={METRIC_FIELDS.map(f => ({ value: f.key, label: METRIC_SHORT[f.key] || f.label }))}
                />
            )}
            <div className='kb-sub-label'>Only records where… (optional)</div>
            <KpiConditions sourceType={sourceType} value={part.filters} onChange={filters => onChange({ ...part, filters })} />
        </div>
    )
}

export const KpiBuilder: React.FC<Props> = ({ draft: d, onChange, step, ctx, isNew, editing, errors, onManageTargets }) => {
    const summary = summarise(d, ctx, isNew)
    const collaborative = d.ownership === 'shared' && d.sharedKpiMode === 'collaborative'
    const programAvailable = !!ctx.activeProgramId && !ctx.isAllPrograms
    const unit = deriveUnit(d)

    /** Changing what is measured resets the parts that depended on it. */
    const chooseSource = (sourceType: SourceType) => {
        const calc: Calc = calcOptionsFor(sourceType)[0]
        onChange({
            sourceType,
            calc,
            field: sourceType === 'metrics' ? METRIC_FIELDS[0]?.key || null : null,
            filters: [],
            interventionIds: sourceType === 'interventions' ? d.interventionIds : [],
            numerator: { mode: 'count_records', field: null, filters: [] },
            denominator: { mode: 'count_records', field: null, filters: [] }
        })
    }

    const departmentsForInterventions = relevantDepartments(d, ctx)
    const interventionOptions = departmentsForInterventions.map(dep => ({
        label: dep.name,
        options: ctx.interventions
            .filter(iv => interventionBelongsToDepartment(iv, dep))
            .map(iv => ({ value: iv.id, label: interventionLabel(iv) }))
    })).filter(group => group.options.length)

    return (
        <div className='kb-body'>
            <div className='kb-main'>
                {errors.length > 0 && (
                    <Alert
                        className='kb-errors'
                        type='error'
                        showIcon
                        message={errors.length === 1 ? errors[0] : 'A few things to finish before continuing'}
                        description={errors.length > 1 ? <ul>{errors.map(e => <li key={e}>{e}</li>)}</ul> : undefined}
                    />
                )}

                {step === 0 && (
                    <>
                        <Field label='KPI name' htmlFor='kb-name'>
                            <Input
                                id='kb-name'
                                autoFocus
                                placeholder='e.g. Jobs created'
                                value={d.kpiLabel}
                                maxLength={120}
                                onChange={e => onChange({ kpiLabel: e.target.value })}
                            />
                        </Field>

                        <Field
                            label='Measured as'
                            hint={d.kpiKind === 'numeric' ? 'A count, amount or percentage against a target.' : 'Done or not done each period — no numeric target.'}
                        >
                            <Segmented
                                block
                                value={d.kpiKind}
                                onChange={kind => onChange({
                                    kpiKind: kind as KpiDraft['kpiKind'],
                                    // A deliverable can't be a collaborative outcome.
                                    ...(kind === 'qualitative' && d.sharedKpiMode === 'collaborative' ? { sharedKpiMode: 'allocated' as const } : {})
                                })}
                                options={[
                                    { value: 'numeric', label: 'A number', icon: <NumberOutlined /> },
                                    { value: 'qualitative', label: 'A deliverable', icon: <CheckCircleOutlined /> }
                                ]}
                            />
                        </Field>

                        {/* Only main departments choose ownership; everyone else's KPIs belong to their department. */}
                        {ctx.canControlContributors && (
                            <Field label='Owned by'>
                                <Segmented
                                    block
                                    value={d.ownership}
                                    onChange={ownership => onChange({ ownership: ownership as KpiDraft['ownership'] })}
                                    options={[
                                        { value: 'department', label: 'One department', icon: <ProjectOutlined /> },
                                        { value: 'shared', label: 'Shared', icon: <TeamOutlined /> }
                                    ]}
                                />
                            </Field>
                        )}

                        {d.ownership === 'department' && ctx.canControlContributors && (
                                <Field label='Department' htmlFor='kb-department'>
                                    <DepartmentSelect
                                        id='kb-department'
                                        departments={ctx.departments}
                                        value={d.departmentId}
                                        onChange={departmentId => onChange({ departmentId, interventionIds: [] })}
                                    />
                                </Field>
                        )}

                        {d.ownership === 'shared' && (
                            <div className='kb-group'>
                                <Field
                                    label='How departments work together'
                                    hint={d.sharedKpiMode === 'allocated'
                                        ? 'Each department owns a portion of the target.'
                                        : 'An outcome counts only when every department completes its required interventions.'}
                                >
                                    <Segmented
                                        block
                                        value={d.sharedKpiMode}
                                        onChange={mode => onChange({
                                            sharedKpiMode: mode as KpiDraft['sharedKpiMode'],
                                            // Collaborative outcomes are always counted from interventions.
                                            ...(mode === 'collaborative' ? { tracking: 'live' as const, sourceType: 'interventions' as const, calc: 'count' as const } : {})
                                        })}
                                        options={[
                                            { value: 'allocated', label: 'Allocated contribution' },
                                            { value: 'collaborative', label: 'Collaborative outcome', disabled: d.kpiKind === 'qualitative' }
                                        ]}
                                    />
                                </Field>
                                <Field label='Contributing departments' htmlFor='kb-contributors'>
                                    <DepartmentMultiSelect
                                        id='kb-contributors'
                                        departments={ctx.departments}
                                        value={d.contributorDepartmentIds}
                                        note={dep => (dep.id === d.leadDepartmentId ? 'Lead' : undefined)}
                                        onChange={ids => onChange({
                                            contributorDepartmentIds: ids,
                                            leadDepartmentId: d.leadDepartmentId && ids.includes(d.leadDepartmentId) ? d.leadDepartmentId : ids[0] || null
                                        })}
                                    />
                                </Field>
                                <Field label='Lead department' hint='Accountable for the shared result.' htmlFor='kb-lead'>
                                    <DepartmentSelect
                                        id='kb-lead'
                                        placeholder={d.contributorDepartmentIds.length ? 'Choose the lead' : 'Add contributing departments first'}
                                        disabled={!d.contributorDepartmentIds.length}
                                        departments={ctx.departments.filter(dep => d.contributorDepartmentIds.includes(dep.id))}
                                        value={d.leadDepartmentId}
                                        onChange={leadDepartmentId => onChange({ leadDepartmentId })}
                                    />
                                </Field>
                            </div>
                        )}

                        <Field
                            label='Applies to'
                            hint={programAvailable ? undefined : 'Select a single programme in the top bar to make a programme-only KPI.'}
                        >
                            <Segmented
                                block
                                value={d.scope}
                                onChange={scope => onChange({ scope: scope as KpiDraft['scope'] })}
                                options={[
                                    { value: 'program', label: programLabel(ctx), disabled: !programAvailable },
                                    { value: 'all', label: 'All programmes' }
                                ]}
                            />
                        </Field>
                    </>
                )}

                {step === 1 && d.kpiKind === 'qualitative' && (
                    <>
                        <Field label='Deliverable' hint='What has to be done each period.' htmlFor='kb-deliverable'>
                            <Input.TextArea
                                id='kb-deliverable'
                                autoFocus
                                autoSize={{ minRows: 3, maxRows: 6 }}
                                placeholder='e.g. Maintain a complete Group A database with compliance status'
                                value={d.deliverable}
                                onChange={e => onChange({ deliverable: e.target.value })}
                            />
                        </Field>
                        <Field label='How completion is verified' htmlFor='kb-indicator'>
                            <Input.TextArea
                                id='kb-indicator'
                                autoSize={{ minRows: 2, maxRows: 5 }}
                                placeholder='e.g. Updated database with complete MSME profiles'
                                value={d.measurementIndicator}
                                onChange={e => onChange({ measurementIndicator: e.target.value })}
                            />
                        </Field>
                        <Field label='Checked off'>
                            <Segmented
                                block
                                value={d.periodType}
                                onChange={periodType => onChange({ periodType: periodType as KpiDraft['periodType'] })}
                                options={[{ value: 'monthly', label: 'Every month' }, { value: 'quarterly', label: 'Every quarter' }]}
                            />
                        </Field>
                    </>
                )}

                {step === 1 && d.kpiKind === 'numeric' && (
                    <>
                        <Field
                            label='Tracked'
                            hint={collaborative
                                ? 'Collaborative outcomes are counted from each department’s interventions.'
                                : d.tracking === 'live'
                                    ? 'Calculated automatically from platform data.'
                                    : 'Someone records the actual each period; reminders go out when it’s due.'}
                        >
                            <Segmented
                                block
                                value={d.tracking}
                                onChange={tracking => onChange({ tracking: tracking as KpiDraft['tracking'] })}
                                options={[
                                    { value: 'live', label: 'From live data', icon: <LineChartOutlined /> },
                                    { value: 'manual', label: 'Recorded manually', icon: <EditOutlined />, disabled: collaborative }
                                ]}
                            />
                        </Field>

                        {d.tracking === 'manual' && (
                            <Field label='Unit'>
                                <Segmented
                                    block
                                    value={d.manualUnit}
                                    onChange={manualUnit => onChange({ manualUnit: manualUnit as KpiDraft['manualUnit'] })}
                                    options={[
                                        { value: 'count', label: 'Count' },
                                        { value: 'ZAR', label: 'Rand amount' },
                                        { value: 'percent', label: 'Percentage' }
                                    ]}
                                />
                            </Field>
                        )}

                        {d.tracking === 'live' && (
                            <>
                                <Field label='Measures'>
                                    <Segmented
                                        block
                                        value={d.sourceType || undefined}
                                        onChange={st => chooseSource(st as SourceType)}
                                        options={(Object.keys(SOURCE_LABELS) as SourceType[]).map(st => ({
                                            value: st,
                                            label: SOURCE_LABELS[st],
                                            disabled: collaborative && st !== 'interventions'
                                        }))}
                                    />
                                </Field>

                                {d.sourceType === 'interventions' && (
                                    <Field
                                        label={collaborative ? 'Required interventions' : 'Interventions'}
                                        hint={collaborative
                                            ? 'Choose at least one for every contributing department.'
                                            : departmentsForInterventions.length ? 'Grouped by the department that delivers them.' : 'Choose the owning department first (Basics).'}
                                        htmlFor='kb-interventions'
                                    >
                                        <Select
                                            id='kb-interventions'
                                            mode='multiple'
                                            showSearch
                                            optionFilterProp='label'
                                            placeholder='Choose interventions'
                                            value={d.interventionIds}
                                            onChange={interventionIds => onChange({ interventionIds })}
                                            options={interventionOptions}
                                            notFoundContent='No interventions for these departments'
                                        />
                                    </Field>
                                )}

                                {d.sourceType && (
                                    <Field label='Calculation'>
                                        <Segmented
                                            block
                                            value={d.calc || undefined}
                                            onChange={calc => onChange({
                                                calc: calc as Calc,
                                                ...(calc === 'total' || calc === 'average' ? { field: d.field || METRIC_FIELDS[0]?.key || null } : {})
                                            })}
                                            options={calcOptionsFor(d.sourceType).map(c => ({ value: c, label: CALC_LABELS[c] }))}
                                        />
                                    </Field>
                                )}

                                {/* An SME can only be accepted into one programme at a time, so for applications
                                    accepted applications and unique SMEs are the same number; only interventions,
                                    where one SME completes several, need the choice. */}
                                {d.calc === 'count' && d.sourceType === 'interventions' && (
                                    <Field label='Count'>
                                        <Segmented
                                            block
                                            value={d.countMode}
                                            onChange={countMode => onChange({ countMode: countMode as CountMode })}
                                            options={[
                                                { value: 'records', label: 'Completed interventions' },
                                                { value: 'distinct', label: 'Unique SMEs' }
                                            ]}
                                        />
                                    </Field>
                                )}

                                {(d.calc === 'total' || d.calc === 'average') && (
                                    <Field label='Business metric'>
                                        <Segmented
                                            block
                                            value={d.field || undefined}
                                            onChange={field => onChange({ field: String(field) })}
                                            options={METRIC_FIELDS.map(f => ({ value: f.key, label: METRIC_SHORT[f.key] || f.label }))}
                                        />
                                    </Field>
                                )}

                                {d.calc === 'percentage' && d.sourceType && (
                                    <Field label='Percentage' hint='Top group ÷ bottom group × 100.'>
                                        <div className='kb-ratio'>
                                            <RatioPart title='Top group' sourceType={d.sourceType} part={d.numerator} onChange={numerator => onChange({ numerator })} />
                                            <RatioPart title='Bottom group' sourceType={d.sourceType} part={d.denominator} onChange={denominator => onChange({ denominator })} />
                                        </div>
                                    </Field>
                                )}

                                {d.sourceType && d.calc && d.calc !== 'percentage' && (
                                    <Field label='Only include records where… (optional)' hint='e.g. Gender is Female, or Province is Gauteng. Leave empty to include everything.'>
                                        <KpiConditions sourceType={d.sourceType} value={d.filters} onChange={filters => onChange({ filters })} />
                                    </Field>
                                )}
                            </>
                        )}
                    </>
                )}

                {step === 2 && !isNew && (
                    <div className='kb-callout'>
                        <CalendarOutlined />
                        <div>
                            <strong>Targets have their own history</strong>
                            <p>Planned and revised targets are kept with an audit trail, so they’re managed separately from the KPI’s definition.</p>
                            {onManageTargets && editing?.kpiKind !== 'qualitative' && (
                                <Button onClick={onManageTargets} icon={<CalendarOutlined />}>Manage targets</Button>
                            )}
                        </div>
                    </div>
                )}

                {step === 2 && isNew && d.kpiKind === 'qualitative' && (
                    <div className='kb-callout'>
                        <CheckCircleOutlined />
                        <div>
                            <strong>No number to target</strong>
                            <p>This deliverable is checked off {d.periodType === 'quarterly' ? 'each quarter' : 'each month'} in the KPI tracker. Check the summary, then create it.</p>
                        </div>
                    </div>
                )}

                {step === 2 && isNew && d.kpiKind === 'numeric' && (
                    <>
                        <Field label='Target period'>
                            <Segmented
                                block
                                value={d.periodType}
                                onChange={periodType => onChange({
                                    periodType: periodType as KpiDraft['periodType'],
                                    periodKey: nextTargetPeriodStart(periodType as KpiDraft['periodType'])
                                })}
                                options={[{ value: 'monthly', label: 'Monthly' }, { value: 'quarterly', label: 'Quarterly' }]}
                            />
                        </Field>
                        <div className='kb-row'>
                            <Field
                                label={d.periodType === 'quarterly' ? 'First quarter' : 'First month'}
                                hint='Targets lock once their period starts.'
                                htmlFor='kb-period'
                            >
                                <DatePicker
                                    id='kb-period'
                                    style={{ width: '100%' }}
                                    picker={d.periodType === 'quarterly' ? 'quarter' : 'month'}
                                    value={d.periodKey}
                                    allowClear={false}
                                    disabledDate={current => !!current && periodStarted(d.periodType, current)}
                                    onChange={value => value && onChange({ periodKey: toPeriodStart(d.periodType, value) })}
                                />
                            </Field>
                            <Field
                                label='Target'
                                hint={d.tracking === 'manual' ? 'Reminders to record the actual go out each period.' : 'Plan later periods in Manage targets.'}
                                htmlFor='kb-target'
                            >
                                <InputNumber
                                    id='kb-target'
                                    style={{ width: '100%' }}
                                    min={0}
                                    max={unit === 'percent' ? 100 : undefined}
                                    precision={unit === 'count' ? 0 : 2}
                                    placeholder='Enter target'
                                    addonBefore={unit === 'ZAR' ? 'R' : undefined}
                                    addonAfter={unit === 'percent' ? '%' : undefined}
                                    value={d.target ?? undefined}
                                    onChange={value => onChange({ target: value == null ? null : Number(value) })}
                                />
                            </Field>
                        </div>
                    </>
                )}
            </div>

            <aside className='kb-summary' aria-live='polite' aria-label='KPI summary'>
                <div className='kb-summary-eyebrow'>
                    <FileTextOutlined /> Summary
                </div>
                <div className='kb-summary-title'>{summary.title}</div>
                <p className='kb-summary-sentence'>{summary.sentence}</p>
                <dl className='kb-summary-rows'>
                    {summary.rows.map(row => (
                        <div key={row.key} className={row.pending ? 'is-pending' : undefined}>
                            <dt>{row.label}</dt>
                            <dd>
                                {row.pending ? <Tooltip title='Fill this in to complete the KPI'>{row.value}</Tooltip> : row.value}
                            </dd>
                        </div>
                    ))}
                </dl>
            </aside>
        </div>
    )
}
