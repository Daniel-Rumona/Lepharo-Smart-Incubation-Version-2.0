import React, { useEffect, useRef, useState } from 'react'
import { Avatar, Button, Form, Input, Select, Spin, Typography, message } from 'antd'
import { ArrowLeftOutlined, ArrowRightOutlined, CalendarOutlined, CheckCircleFilled, UserOutlined } from '@ant-design/icons'
import type { Dayjs } from 'dayjs'
import ResponsiveSheet from '@/components/common/ResponsiveSheet'
import AppointmentDateTimeFields from '@/components/appointments/AppointmentDateTimeFields'
import { assignmentDateLabel } from '@/lib/appointmentAssignments'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import {
    coverageWordCount,
    departmentNeedsPlannedTopics,
    loadSchedulableSmes,
    submitCoordinatorAppointment,
    type AppointmentFormValues,
    type SchedulableSme
} from '@/services/coordinatorSchedulingService'
import SmeCardPicker from './SmeCardPicker'
import './schedule-flow.css'

const { Text, Title } = Typography

export type BookedSummary = {
    title: string
    smeName: string
    companyName: string
    startsAt: Dayjs
    endsAt: Dayjs
}

type Props = {
    open: boolean
    onClose: () => void
    /** SME/company name the user already mentioned — pre-fills the picker search. */
    smeHint?: string | null
    onBooked: (summary: BookedSummary) => void
}

type FormShape = AppointmentFormValues & { assignmentId?: string }

const DELIVERY_OPTIONS = [
    { value: 'in_person', label: 'In person' },
    { value: 'virtual', label: 'Virtual' },
    { value: 'telephonically', label: 'Telephonic' }
]

// Below this many interventions, cards are quicker to scan than a dropdown.
const CARD_LIMIT = 6

// Fields on the first (intervention) step; everything else is the second.
const FIRST_STEP_FIELDS = ['assignmentId', 'sessionTitle', 'plannedTopics', 'plannedCoverage']

type Assignment = SchedulableSme['assignments'][number]

const interventionTitle = (item: Assignment) => String(item.interventionTitle || item.title || 'Intervention')

const interventionMeta = (item: Assignment) => [
    `Assigned ${assignmentDateLabel(item)}`,
    item.cycleKey ? `Cycle ${item.cycleKey}` : ''
].filter(Boolean).join(' · ')

const interventionLabel = (item: Assignment) => [
    interventionTitle(item),
    item.subInterventionTitle,
    interventionMeta(item)
].filter(Boolean).join(' · ')

const InterventionCards: React.FC<{
    assignments: Assignment[]
    value?: string
    onChange?: (value: string) => void
}> = ({ assignments, value, onChange }) => (
    <div className='schedule-flow-interventions' role='radiogroup' aria-label='Intervention'>
        {assignments.map(item => {
            const active = item.id === value
            return (
                <button
                    key={item.id}
                    type='button'
                    role='radio'
                    aria-checked={active}
                    className={`schedule-flow-intervention ${active ? 'schedule-flow-intervention-active' : ''}`}
                    onClick={() => onChange?.(item.id)}
                >
                    <span className='schedule-flow-intervention-body'>
                        <span className='schedule-flow-intervention-title'>{interventionTitle(item)}</span>
                        {item.subInterventionTitle && (
                            <span className='schedule-flow-intervention-sub'>{item.subInterventionTitle}</span>
                        )}
                        <span className='schedule-flow-intervention-meta'>{interventionMeta(item)}</span>
                    </span>
                    {active && <CheckCircleFilled className='schedule-flow-intervention-check' />}
                </button>
            )
        })}
    </div>
)

const ScheduleAppointmentFlow: React.FC<Props> = ({ open, onClose, smeHint, onBooked }) => {
    const { user } = useFullIdentity()
    const { activeProgramId } = useActiveProgramId()
    const [form] = Form.useForm<FormShape>()

    const [loading, setLoading] = useState(false)
    const [saving, setSaving] = useState(false)
    const [smes, setSmes] = useState<SchedulableSme[]>([])
    const [selected, setSelected] = useState<SchedulableSme | null>(null)
    const [needsTopics, setNeedsTopics] = useState(false)
    const [onLogistics, setOnLogistics] = useState(false)
    const topicsCache = useRef<Map<string, boolean>>(new Map())

    const deliveryMethod = Form.useWatch('deliveryMethod', form)

    useEffect(() => {
        if (!open) return
        let cancelled = false
        setSelected(null)
        setOnLogistics(false)
        setLoading(true)
        loadSchedulableSmes({ user, activeProgramId })
            .then(result => { if (!cancelled) setSmes(result) })
            .catch(error => {
                console.error(error)
                if (!cancelled) {
                    setSmes([])
                    message.error('Could not load your SMEs. Please try again.')
                }
            })
            .finally(() => { if (!cancelled) setLoading(false) })
        return () => { cancelled = true }
        // user identity + programme define the schedulable set; reload each time the flow opens.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, user?.uid, user?.email, activeProgramId])

    const refreshTopics = async (assignmentId: string | undefined) => {
        const assignment = selected?.assignments.find(item => item.id === assignmentId)
        const departmentId = String(assignment?.departmentId || user?.departmentId || '')
        if (!departmentId) { setNeedsTopics(false); return }
        const cached = topicsCache.current.get(departmentId)
        if (cached !== undefined) { setNeedsTopics(cached); return }
        const needs = await departmentNeedsPlannedTopics(departmentId)
        topicsCache.current.set(departmentId, needs)
        setNeedsTopics(needs)
    }

    const chooseSme = (sme: SchedulableSme) => {
        setSelected(sme)
        setOnLogistics(false)
        const onlyAssignment = sme.assignments.length === 1 ? sme.assignments[0].id : undefined
        const assignment = sme.assignments.find(item => item.id === onlyAssignment)
        const departmentId = String(assignment?.departmentId || user?.departmentId || '')
        const cached = departmentId ? topicsCache.current.get(departmentId) : false
        setNeedsTopics(Boolean(cached))
        if (departmentId && cached === undefined) {
            void departmentNeedsPlannedTopics(departmentId).then(needs => {
                topicsCache.current.set(departmentId, needs)
                setNeedsTopics(needs)
            })
        }
    }

    const handleFinish = async (values: FormShape) => {
        if (!selected || saving) return
        const assignment = selected.assignments.find(item => item.id === values.assignmentId)
        if (!assignment) {
            message.warning('Pick the intervention this appointment is for.')
            return
        }

        setSaving(true)
        try {
            const result = await submitCoordinatorAppointment({
                sme: selected,
                assignment,
                values,
                needsPlannedTopics: needsTopics,
                fallbackDepartmentId: String(user?.departmentId || '')
            })
            if (!result.ok) {
                message.error(result.error)
                return
            }
            message.success('Appointment scheduled.')
            onBooked(result.summary)
            onClose()
        } finally {
            setSaving(false)
        }
    }

    const goToLogistics = async () => {
        try {
            await form.validateFields(FIRST_STEP_FIELDS)
            setOnLogistics(true)
        } catch {
            // Field errors are shown inline.
        }
    }

    const footer = selected ? (
        <div className='schedule-flow-footer'>
            <Button
                size='large'
                icon={<ArrowLeftOutlined />}
                onClick={() => (onLogistics ? setOnLogistics(false) : setSelected(null))}
                disabled={saving}
            >
                Back
            </Button>
            {onLogistics ? (
                <Button type='primary' size='large' icon={<CalendarOutlined />} loading={saving} onClick={() => form.submit()}>
                    Schedule appointment
                </Button>
            ) : (
                <Button type='primary' size='large' icon={<ArrowRightOutlined />} iconPosition='end' onClick={() => void goToLogistics()}>
                    Next
                </Button>
            )}
        </div>
    ) : null

    return (
        <ResponsiveSheet
            open={open}
            onClose={onClose}
            title={selected ? 'Appointment details' : 'Who is the appointment with?'}
            footer={footer}
        >
            {loading ? (
                <div style={{ display: 'grid', placeItems: 'center', padding: '48px 0' }}>
                    <Spin />
                </div>
            ) : !selected ? (
                <SmeCardPicker
                    key={smeHint || 'no-hint'}
                    smes={smes}
                    initialQuery={smeHint || ''}
                    onSelect={chooseSme}
                />
            ) : (
                <Form<FormShape>
                    key={selected.participantId}
                    form={form}
                    layout='vertical'
                    requiredMark={false}
                    preserve={false}
                    initialValues={{
                        assignmentId: selected.assignments.length === 1 ? selected.assignments[0].id : undefined
                    }}
                    onFinish={handleFinish}
                >
                    <div className='schedule-flow-sme-chip'>
                        <Avatar
                            size={40}
                            src={selected.photoUrl || undefined}
                            icon={!selected.photoUrl ? <UserOutlined /> : undefined}
                        />
                        <div style={{ minWidth: 0 }}>
                            <Title level={5} style={{ overflowWrap: 'anywhere' }}>
                                {selected.companyName || selected.name}
                            </Title>
                            {selected.companyName && <Text type='secondary'>{selected.name}</Text>}
                        </div>
                    </div>

                    {/* Both steps stay mounted (hidden, not removed) so the
                        first step's values survive with preserve={false}. */}
                    <div hidden={onLogistics}>
                        <Form.Item
                            name='assignmentId'
                            label='Intervention'
                            rules={[{ required: true, message: 'Pick the intervention this is for.' }]}
                        >
                            {selected.assignments.length < CARD_LIMIT ? (
                                <InterventionCards
                                    assignments={selected.assignments}
                                    onChange={value => void refreshTopics(value)}
                                />
                            ) : (
                                <Select
                                    placeholder='Select intervention'
                                    onChange={value => void refreshTopics(value)}
                                    options={selected.assignments.map(item => ({
                                        value: item.id,
                                        label: interventionLabel(item)
                                    }))}
                                />
                            )}
                        </Form.Item>

                        <Form.Item
                            name='sessionTitle'
                            label='Session title'
                            rules={[{ required: true, whitespace: true, message: 'Please add a session title.' }]}
                        >
                            <Input placeholder='e.g. Financial management check-in' />
                        </Form.Item>

                        {needsTopics && (
                            <Form.Item
                                name='plannedTopics'
                                label='Planned topics'
                                rules={[{ required: true, message: 'Please add at least one topic.' }]}
                                extra='Type each topic and press Enter.'
                            >
                                <Select mode='tags' open={false} tokenSeparators={[',']} placeholder='e.g. Introduction to budgeting' />
                            </Form.Item>
                        )}

                        <Form.Item
                            name='plannedCoverage'
                            label='Planned coverage'
                            rules={[
                                { required: true, whitespace: true, message: 'Please describe what will be covered.' },
                                {
                                    validator: async (_, value) => {
                                        if (coverageWordCount(value) <= 5) throw new Error('Enter more than 5 words.')
                                    }
                                }
                            ]}
                            extra='More than 5 words. Describe the work, support or outcome planned for this session.'
                        >
                            <Input.TextArea rows={3} placeholder='What will this session cover?' />
                        </Form.Item>
                    </div>

                    <div hidden={!onLogistics}>

                        <Form.Item
                            name='deliveryMethod'
                            label='Delivery method'
                            rules={[{ required: true, message: 'Please select a delivery method.' }]}
                        >
                            <Select
                                placeholder='Select delivery method'
                                options={DELIVERY_OPTIONS}
                                onChange={value => {
                                    form.setFieldsValue({
                                        location: value === 'in_person' ? 'At Center' : undefined,
                                        meetingLink: undefined
                                    })
                                }}
                            />
                        </Form.Item>

                        <AppointmentDateTimeFields form={form as any} />

                        {deliveryMethod === 'virtual' && (
                            <Form.Item
                                name='meetingLink'
                                label='Meeting link'
                                rules={[{ required: true, message: 'Please provide a meeting link.' }]}
                            >
                                <Input placeholder='Paste meeting link here' />
                            </Form.Item>
                        )}

                        {deliveryMethod === 'in_person' && (
                            <Form.Item
                                name='location'
                                label='Location'
                                rules={[{ required: true, whitespace: true, message: 'Please provide the location.' }]}
                            >
                                <Input placeholder='At Center' />
                            </Form.Item>
                        )}
                    </div>
                </Form>
            )}
        </ResponsiveSheet>
    )
}

export default ScheduleAppointmentFlow
