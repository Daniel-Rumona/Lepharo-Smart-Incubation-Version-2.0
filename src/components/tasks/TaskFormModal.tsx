import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Col, DatePicker, Form, Input, Modal, Row, Select } from 'antd'
import { FlagOutlined } from '@ant-design/icons'
import { ChoiceCards } from '@/components/workspace'
import dayjs, { type Dayjs } from 'dayjs'
import { createTask, updateTask, useTaskRunner, type TaskInput } from './taskActions'
import { fetchInterventionTitle, fetchInterventionsForDept, type InterventionOption } from './useTaskData'
import {
    PRIORITY_META,
    PRIORITY_ORDER,
    STATUS_META,
    STATUS_ORDER,
    asDayjs,
    type Assignable,
    type Department,
    type Priority,
    type Status,
    type Task
} from './taskTypes'

type Props = {
    open: boolean
    /** The task being edited; null creates a new one. */
    task: Task | null
    onClose: () => void
    departments: Department[]
    assignables: Assignable[]
    assignablesLoading: boolean
    /** Non-main staff: the only department they can use. */
    lockedDepartmentId: string | null
    /** The programme picked in the header; new tasks belong to it. */
    activeProgramId?: string
    /** Pre-fills a new task's department (the department filter). */
    defaultDepartmentId?: string
    myUid: string
}

type FormValues = {
    title: string
    description: string
    departmentId?: string
    assignees: string[]
    priority: Priority
    status: Status
    startAt?: Dayjs | null
    dueAt?: Dayjs
    interventionId?: string | null
}

/** Finds the assignable a stored assignee id refers to (user id, or an older coordinator doc id). */
const matchAssignable = (assignables: Assignable[], id: string) =>
    assignables.find(a => a.userId === id || a.keys.includes(id))

/** Fields on the first step, validated before moving on. */
const DETAIL_FIELDS: (keyof FormValues)[] = ['title', 'description', 'priority', 'status', 'startAt', 'dueAt']

/**
 * Create or edit a task in two short steps: the task itself, then who does it.
 * The programme is the one picked in the header (or the task's own when editing).
 */
export const TaskFormModal: React.FC<Props> = ({
    open,
    task,
    onClose,
    departments,
    assignables,
    assignablesLoading,
    lockedDepartmentId,
    activeProgramId,
    defaultDepartmentId,
    myUid
}) => {
    const [form] = Form.useForm<FormValues>()
    const { busy, run } = useTaskRunner()
    const programId = task?.programId || activeProgramId
    const departmentId = Form.useWatch('departmentId', form)
    const [step, setStep] = useState(0)

    const [interventions, setInterventions] = useState<InterventionOption[]>([])
    const [interventionsLoading, setInterventionsLoading] = useState(false)
    const [interventionsError, setInterventionsError] = useState(false)
    const [hint, setHint] = useState<string | null>(null)
    const [currentIntervention, setCurrentIntervention] = useState<InterventionOption | null>(null)
    const fetchId = useRef(0)

    // Fill the form each time it opens.
    useEffect(() => {
        if (!open) return
        setHint(null)
        setStep(0)
        form.resetFields()
        if (task) {
            form.setFieldsValue({
                title: task.title,
                description: task.description,
                departmentId: lockedDepartmentId || task.departmentId,
                assignees: (task.assignees || []).map(a => {
                    const id = String(a.userId)
                    return matchAssignable(assignables, id)?.userId || id
                }),
                priority: task.priority,
                status: task.status,
                startAt: asDayjs(task.startAt),
                dueAt: asDayjs(task.dueAt) || undefined,
                interventionId: task.interventionId || null
            })
            setCurrentIntervention(
                task.interventionId
                    ? { value: task.interventionId, label: task.interventionTitle || 'Loading…' }
                    : null
            )
            if (task.interventionId && !task.interventionTitle) {
                const id = task.interventionId
                fetchInterventionTitle(id).then(title =>
                    setCurrentIntervention(c => (c?.value === id ? { value: id, label: title || 'Intervention' } : c))
                )
            }
        } else {
            setCurrentIntervention(null)
            form.setFieldsValue({
                title: '',
                description: '',
                departmentId: lockedDepartmentId || defaultDepartmentId,
                assignees: [],
                priority: 'medium',
                status: 'todo',
                startAt: dayjs(),
                dueAt: dayjs().add(7, 'day'),
                interventionId: null
            })
        }
        // assignables are read for the initial mapping only.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, task?.id])

    // Interventions for the chosen department.
    useEffect(() => {
        if (!open || !departmentId) {
            setInterventions([])
            return
        }
        const id = ++fetchId.current
        setInterventionsLoading(true)
        setInterventionsError(false)
        fetchInterventionsForDept(departmentId)
            .then(options => id === fetchId.current && setInterventions(options))
            .catch(error => {
                console.error('[workroom] interventions load failed', error)
                if (id === fetchId.current) {
                    setInterventions([])
                    setInterventionsError(true)
                }
            })
            .finally(() => id === fetchId.current && setInterventionsLoading(false))
    }, [open, departmentId])

    const eligible = useMemo(
        () =>
            programId && departmentId
                ? assignables.filter(a => a.departmentId === departmentId && a.programIds.includes(programId))
                : [],
        [assignables, programId, departmentId]
    )

    const assigneeOptions = useMemo(() => {
        const options = eligible.map(a => ({
            value: a.userId,
            label: a.branchName ? `${a.name} · ${a.branchName}` : a.name
        }))
        // Keep current picks that are no longer eligible visible, so they can be removed.
        const picked: string[] = form.getFieldValue('assignees') || []
        picked
            .filter(id => !options.some(o => o.value === id))
            .forEach(id =>
                options.push({
                    value: id,
                    label: `${matchAssignable(assignables, id)?.name || 'Unknown coordinator'} (not in this department or programme)`
                })
            )
        return options
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [eligible, assignables, open])

    const interventionOptions = useMemo(() => {
        if (currentIntervention && !interventions.some(o => o.value === currentIntervention.value)) {
            return [currentIntervention, ...interventions]
        }
        return interventions
    }, [interventions, currentIntervention])

    const onValuesChange = (changed: Partial<FormValues>, all: FormValues) => {
        if (!('departmentId' in changed)) return
        const notes: string[] = []
        if ('departmentId' in changed && all.interventionId) {
            form.setFieldValue('interventionId', null)
            setCurrentIntervention(null)
            notes.push('The linked intervention was cleared because it belongs to the previous department.')
        }
        const stillEligible = (all.assignees || []).filter(id =>
            assignables.some(
                a =>
                    a.userId === id &&
                    a.departmentId === all.departmentId &&
                    !!programId &&
                    a.programIds.includes(programId)
            )
        )
        if (stillEligible.length !== (all.assignees || []).length) {
            form.setFieldValue('assignees', stillEligible)
            notes.push('Assignees outside the new department were removed.')
        }
        setHint(notes.length ? notes.join(' ') : null)
    }

    const submit = async () => {
        let values: FormValues
        try {
            values = await form.validateFields()
        } catch (error: any) {
            // Show the step that has the problem.
            const first = error?.errorFields?.[0]?.name?.[0]
            if (first && DETAIL_FIELDS.includes(first)) setStep(0)
            return
        }
        if (!programId) return
        const pickedIds = values.assignees || []
        const picked = pickedIds.map(id => eligible.find(a => a.userId === id))
        if (picked.some(a => !a)) {
            Modal.warning({
                title: 'Some assignees can’t be assigned',
                content: 'Remove the coordinators marked “not in this department or programme” before saving.'
            })
            return
        }
        const deptId = lockedDepartmentId || values.departmentId!
        const interventionId = values.interventionId || null
        const input: TaskInput = {
            title: values.title,
            description: values.description || '',
            programId,
            departmentId: deptId,
            priority: values.priority,
            status: values.status,
            startAt: values.startAt || null,
            dueAt: values.dueAt!,
            assignees: (picked as Assignable[]).map(a => ({
                userId: a.userId,
                branchId: a.branchId,
                departmentId: deptId
            })),
            interventionId,
            interventionTitle: interventionId
                ? interventionOptions.find(o => o.value === interventionId)?.label || null
                : null
        }
        const ok = await run(
            'save',
            () => (task ? updateTask(task, input) : createTask(input, myUid)),
            task ? 'Task updated' : 'Task created'
        )
        if (ok) onClose()
    }

    const departmentOptions = (lockedDepartmentId ? departments.filter(d => d.id === lockedDepartmentId) : departments)
        .map(d => ({ value: d.id, label: d.name }))
        .sort((a, b) => a.label.localeCompare(b.label))

    const noCoordinators = !!programId && !!departmentId && !assignablesLoading && eligible.length === 0

    const next = async () => {
        try {
            await form.validateFields(DETAIL_FIELDS)
            setStep(1)
        } catch {
            // The fields show their own messages.
        }
    }

    // Closing is the modal's X; the footer only moves through the form.
    const footer = [
        step === 1 && (
            <Button key='back' onClick={() => setStep(0)} disabled={!!busy}>
                Back
            </Button>
        ),
        step === 0 && (
            <Button key='next' type={task ? 'default' : 'primary'} onClick={next}>
                Next: assignment
            </Button>
        ),
        // Editing can save from either step; a new task saves once assigned.
        (step === 1 || !!task) && (
            <Button key='save' type='primary' loading={busy === 'save'} onClick={submit}>
                {task ? 'Save changes' : 'Create task'}
            </Button>
        )
    ].filter(Boolean)

    return (
        <Modal
            title={task ? 'Edit task' : 'New task'}
            open={open}
            onCancel={() => !busy && onClose()}
            footer={footer}
            width={640}
            destroyOnClose
            maskClosable={!busy}
        >
            <Form form={form} layout='vertical' onValuesChange={onValuesChange} requiredMark='optional'>
                {/* Both steps stay mounted (one hidden) so a save validates every field. */}
                <div hidden={step !== 0}>
                    <Form.Item name='title' label='Title' rules={[{ required: true, whitespace: true, message: 'Give the task a title' }]}>
                        <Input placeholder='e.g. Prepare the monthly progress report' maxLength={140} />
                    </Form.Item>
                    <Form.Item name='description' label='Description'>
                        <Input.TextArea rows={3} placeholder='What needs to be done?' />
                    </Form.Item>
                    <Form.Item name='priority' label='Priority' rules={[{ required: true, message: 'Choose a priority' }]}>
                        <ChoiceCards<Priority>
                            label='Priority'
                            options={PRIORITY_ORDER.map(p => ({
                                value: p,
                                label: PRIORITY_META[p].label,
                                icon: <FlagOutlined className={`tw-flag is-${p}`} />
                            }))}
                        />
                    </Form.Item>
                    <Form.Item name='status' label='Status' rules={[{ required: true, message: 'Choose a status' }]}>
                        <ChoiceCards<Status>
                            label='Status'
                            options={STATUS_ORDER.map(st => ({ value: st, label: STATUS_META[st].label }))}
                        />
                    </Form.Item>
                    <Row gutter={12}>
                        <Col xs={24} sm={12}>
                            <Form.Item name='startAt' label='Start date'>
                                <DatePicker style={{ width: '100%' }} format='D MMM YYYY' />
                            </Form.Item>
                        </Col>
                        <Col xs={24} sm={12}>
                            <Form.Item
                                name='dueAt'
                                label='Due date'
                                dependencies={['startAt']}
                                rules={[
                                    { required: true, message: 'Choose a due date' },
                                    ({ getFieldValue }) => ({
                                        validator: (_, value?: Dayjs) => {
                                            const start = getFieldValue('startAt') as Dayjs | null
                                            return value && start && value.isBefore(start, 'day')
                                                ? Promise.reject(new Error('The due date can’t be before the start date'))
                                                : Promise.resolve()
                                        }
                                    })
                                ]}
                            >
                                <DatePicker style={{ width: '100%' }} format='D MMM YYYY' />
                            </Form.Item>
                        </Col>
                    </Row>
                </div>

                <div hidden={step !== 1}>
                    <Form.Item
                        name='departmentId'
                        label='Department'
                        rules={[{ required: true, message: 'Choose a department' }]}
                        extra={lockedDepartmentId ? 'Tasks you create stay in your department.' : undefined}
                    >
                        <Select
                            placeholder='Choose a department'
                            showSearch
                            optionFilterProp='label'
                            disabled={!!lockedDepartmentId}
                            options={departmentOptions}
                        />
                    </Form.Item>

                    {hint && <Alert type='info' showIcon message={hint} style={{ marginBottom: 16 }} />}

                    <Form.Item
                        name='assignees'
                        label='Assign to'
                        rules={[{ required: true, type: 'array', min: 1, message: 'Assign at least one coordinator' }]}
                        help={
                            noCoordinators
                                ? 'No coordinators in this department for this programme'
                                : !departmentId
                                    ? 'Choose a department first'
                                    : undefined
                        }
                        validateStatus={noCoordinators ? 'warning' : undefined}
                    >
                        <Select
                            mode='multiple'
                            placeholder={noCoordinators ? 'Nobody can be assigned' : 'Choose coordinators'}
                            options={assigneeOptions}
                            optionFilterProp='label'
                            loading={assignablesLoading}
                            disabled={!departmentId}
                            notFoundContent={assignablesLoading ? 'Loading coordinators…' : 'No coordinators in this department for this programme'}
                        />
                    </Form.Item>

                    <Form.Item
                        name='interventionId'
                        label='Linked intervention'
                        help={interventionsError ? 'Couldn’t load interventions for this department.' : undefined}
                        validateStatus={interventionsError ? 'warning' : undefined}
                    >
                        <Select
                            allowClear
                            showSearch
                            optionFilterProp='label'
                            placeholder={departmentId ? 'None' : 'Choose a department first'}
                            disabled={!departmentId}
                            loading={interventionsLoading}
                            options={interventionOptions}
                            notFoundContent={interventionsLoading ? 'Loading…' : 'No interventions in this department'}
                            onChange={(value?: string | null) =>
                                setCurrentIntervention(value ? interventionOptions.find(o => o.value === value) || null : null)
                            }
                        />
                    </Form.Item>
                </div>
            </Form>
        </Modal>
    )
}
