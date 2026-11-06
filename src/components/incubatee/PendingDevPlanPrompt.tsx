import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Drawer, Empty, Grid, List, Modal, Space, Steps, Tag, Typography } from 'antd'
import {
    CalendarOutlined,
    CheckCircleOutlined,
    CheckOutlined,
    CloseOutlined,
    FileDoneOutlined,
    FileTextOutlined,
    FormOutlined,
    RightOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { useLocation, useNavigate } from 'react-router-dom'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { requestOpenAccountSettings } from '@/lib/accountSettings'
import { isCompulsoryIntervention } from '@/utils/compulsoryInterventions'
import { formatDeliveryMethod } from '@/services/appointmentService'
import { confirmAppointmentResponse } from '@/services/appointmentResponses'
import { DevPlanDept, belongsToDept, confirmDepartmentBySme } from '@/services/devPlanConfirmationService'
import DeclineAppointmentModal from '@/components/appointments/DeclineAppointmentModal'
import { SignatureStage, useSignaturePlayback } from '@/components/shared/SignatureAnimation'
import { useSmeWaiting } from './SmeWaiting'
import './waitingPrompt.css'

const { Text, Title } = Typography
const { useBreakpoint } = Grid

const DASHBOARD_PATH = '/incubatee'
const ROADMAP_PATH = '/incubatee/roadmap'
const dismissKey = (who: string) => `waitingPrompt.dismissed.${who}`

const readDismissed = (who: string) => {
    try {
        return window.sessionStorage.getItem(dismissKey(who)) === '1'
    } catch {
        return false
    }
}

const writeDismissed = (who: string) => {
    try {
        window.sessionStorage.setItem(dismissKey(who), '1')
    } catch { }
}

// "I'll do this later" on the sign-in plan review: for the rest of the session
// plans alone don't open this prompt (it still lists them alongside other items).
const planReviewLaterKey = (who: string) => `planReview.later.${who}`

const readPlanReviewLater = (who: string) => {
    try {
        return window.sessionStorage.getItem(planReviewLaterKey(who)) === '1'
    } catch {
        return false
    }
}

export const writePlanReviewLater = (who: string) => {
    try {
        window.sessionStorage.setItem(planReviewLaterKey(who), '1')
    } catch { }
}

const toDate = (val: any): Date | null => {
    if (!val) return null
    if (val instanceof Date) return val
    if (typeof val === 'string') {
        if (/^\d{2}:\d{2}$/.test(val)) return null
        const d = new Date(val)
        return isNaN(d.getTime()) ? null : d
    }
    if (typeof val?.toDate === 'function') return val.toDate()
    if (val?.seconds) return new Date(val.seconds * 1000)
    return null
}

const timeOf = (val: any) => {
    if (typeof val === 'string' && /^\d{2}:\d{2}$/.test(val)) return val
    const d = toDate(val)
    return d ? dayjs(d).format('HH:mm') : ''
}

const hasFoodMenu = (appt: any) =>
    appt?.deliveryMethod === 'in_person' &&
    appt?.foodMenuEnabled &&
    Array.isArray(appt?.foodMenu) &&
    appt.foodMenu.some((item: any) => item && item.id && (item.name || item.label))

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/**
 * Post-login "Waiting for you" prompt for incubatees, read from the same source
 * as the dashboard's Needs your attention list:
 *  - appointments to answer, with Confirm / Decline right here;
 *  - the development plan walkthrough, one department per step;
 *  - completed interventions, agreements and forms as counts that link to where
 *    they are reviewed (confirming a completion needs a signature and a review).
 * Shown once per browser session; "Not now" or closing hides it until the next.
 */
export const WaitingForYouPrompt: React.FC = () => {
    const screens = useBreakpoint()
    const isMobile = !screens.md
    const navigate = useNavigate()
    const location = useLocation()
    const { user } = useFullIdentity()
    const waiting = useSmeWaiting()

    const who = String(user?.uid || user?.email || '')
    const [dismissed, setDismissed] = useState(false)
    const [open, setOpen] = useState(false)

    // Plan walkthrough: steps are fixed when the prompt opens so they never
    // reshuffle under the user; departments that become pending are appended.
    const [stepIds, setStepIds] = useState<string[]>([])
    const [current, setCurrent] = useState(0)
    const [confirmingId, setConfirmingId] = useState<string | null>(null)
    const [finalizing, setFinalizing] = useState(false)

    const [answeringId, setAnsweringId] = useState<string | null>(null)
    const [decliningAppt, setDecliningAppt] = useState<any | null>(null)
    // The appointment being confirmed, whose signature is animated above the list.
    const [signingAppt, setSigningAppt] = useState<any | null>(null)
    const signaturePlayback = useSignaturePlayback()

    useEffect(() => {
        setDismissed(who ? readDismissed(who) : false)
    }, [who])

    const pendingPlanIds = useMemo(() => new Set(waiting.plans.map(d => d.id)), [waiting.plans])
    const onRoadmap = location.pathname.startsWith(ROADMAP_PATH)
    const onDashboard = location.pathname === DASHBOARD_PATH
    // Things answered right here; the rest are counts that link elsewhere.
    const quickCount = waiting.appointments.length + waiting.plans.length

    // Open once, when there is something worth interrupting for. On the dashboard,
    // counts alone don't (Needs your attention already lists them); on the roadmap,
    // plans alone don't (the full plan is on screen), nor once the SME put the
    // sign-in plan review off until later.
    useEffect(() => {
        if (dismissed || open || waiting.loading || !waiting.total) return
        const plansPutOff = onRoadmap || (!!who && readPlanReviewLater(who))
        const others = waiting.total - waiting.plans.length
        if (plansPutOff && !others) return
        if (onDashboard && !(plansPutOff ? waiting.appointments.length : quickCount)) return
        setStepIds(waiting.plans.map(d => d.id))
        setCurrent(0)
        setOpen(true)
    }, [dismissed, open, who, waiting.loading, waiting.total, waiting.plans, waiting.appointments.length, quickCount, onDashboard, onRoadmap])

    useEffect(() => {
        if (!open) return
        setStepIds(prev => {
            const extra = waiting.plans.filter(d => !prev.includes(d.id)).map(d => d.id)
            return extra.length ? [...prev, ...extra] : prev
        })
    }, [open, waiting.plans])

    const dismiss = () => {
        if (who) writeDismissed(who)
        setDismissed(true)
        setOpen(false)
    }

    // Everything answered: the prompt has done its job.
    useEffect(() => {
        if (open && !waiting.loading && waiting.total === 0 && !confirmingId && !finalizing && !answeringId) dismiss()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, waiting.loading, waiting.total, confirmingId, finalizing, answeringId])

    const goTo = (path: string, state?: Record<string, unknown>) => {
        dismiss()
        navigate(path, state ? { state } : undefined)
    }

    const needsSignature = (label: string) => {
        if (user?.signatureURL) return false
        Modal.confirm({
            title: 'Signature required',
            content: `Please add your signature in Account Settings before confirming ${label}.`,
            okText: 'Go to Account Settings',
            cancelText: 'Cancel',
            onOk: () => requestOpenAccountSettings()
        })
        return true
    }

    const confirmAppointment = async (appt: any) => {
        if (needsSignature('this appointment')) return
        // A meal and drink are chosen on the dashboard, where the menu lives.
        if (hasFoodMenu(appt)) {
            goTo(DASHBOARD_PATH, { waitingFoodMenuFor: appt.id })
            return
        }
        setAnsweringId(appt.id)
        signaturePlayback.start()
        setSigningAppt(appt)
        try {
            await confirmAppointmentResponse(appt)
            await signaturePlayback.finished()
        } catch (error) {
            console.error(error)
            Modal.error({ title: 'Could not confirm the appointment', content: 'Please try again.' })
        } finally {
            setSigningAppt(null)
            setAnsweringId(null)
        }
    }

    const stepDepts = stepIds
        .map(id => waiting.planDepartments.find(d => d.id === id))
        .filter(Boolean) as DevPlanDept[]

    const confirmDepartment = async (dept: DevPlanDept) => {
        if (!waiting.planId || !user?.email) return
        try {
            setConfirmingId(dept.id)
            const ok = await confirmDepartmentBySme({
                planId: waiting.planId,
                plan: waiting.plan,
                participantId: waiting.participantId,
                userEmail: user.email,
                dept,
                departments: waiting.planDepartments,
                catalogByDeptId: waiting.catalogByDeptId,
                onFinalizing: setFinalizing
            })
            if (!ok) return
            const next = stepDepts.findIndex(d => d.id !== dept.id && pendingPlanIds.has(d.id))
            if (next >= 0) setCurrent(next)
        } finally {
            setConfirmingId(null)
        }
    }

    if (!open) return null

    const counts = [
        waiting.completions.length
            ? {
                key: 'completions',
                icon: <CheckCircleOutlined />,
                label: plural(waiting.completions.length, 'completed intervention to confirm', 'completed interventions to confirm'),
                onClick: () => goTo(DASHBOARD_PATH, { waitingFocus: 'attention' })
            }
            : null,
        waiting.agreements.length
            ? {
                key: 'agreements',
                icon: <FileDoneOutlined />,
                label: plural(waiting.agreements.length, 'agreement to sign', 'agreements to sign'),
                // Lands on the Agreements tab, and opens the agreement when there is only one.
                onClick: () => goTo('/incubatee/compliance', {
                    view: 'agreements',
                    ...(waiting.agreements.length === 1 ? { openAgreement: waiting.agreements[0].agreementId } : {})
                })
            }
            : null,
        waiting.pendingForms.length
            ? {
                key: 'forms',
                icon: <FormOutlined />,
                label: plural(waiting.pendingForms.length, 'form to fill in', 'forms to fill in'),
                onClick: () => goTo(DASHBOARD_PATH, { waitingFocus: 'attention' })
            }
            : null
    ].filter(Boolean) as Array<{ key: string; icon: React.ReactNode; label: string; onClick: () => void }>

    const heading = (
        <div className='wfy-head'>
            <span className='wfy-title'>Waiting for you</span>
            <Text type='secondary' className='wfy-subtitle'>
                {waiting.total === 0
                    ? 'You are all caught up.'
                    : plural(waiting.total, 'thing needs', 'things need') + ' your attention.'}
            </Text>
        </div>
    )

    const body = (
        <div className='wfy-body'>
            {/* Outside the appointments list: the confirmed row leaves it as soon as it is saved. */}
            {signingAppt && user?.signatureURL ? (
                <section className='wfy-section'>
                    <SignatureStage
                        src={user.signatureURL}
                        animate
                        onComplete={signaturePlayback.complete}
                        caption={`Confirming ${signingAppt.interventionTitle || signingAppt.sessionTitle || 'appointment'}`}
                    />
                </section>
            ) : null}
            {waiting.appointments.length > 0 && (
                <section className='wfy-section'>
                    <h4 className='wfy-section-title'>
                        <CalendarOutlined /> Appointments to answer
                        <span className='wfy-count'>{waiting.appointments.length}</span>
                    </h4>
                    <ul className='wfy-list'>
                        {waiting.appointments.map(appt => {
                            const start = toDate(appt.startTime) || (appt.date ? toDate(appt.date) : null)
                            const when = [start ? dayjs(start).format('ddd D MMM') : '', timeOf(appt.startTime), formatDeliveryMethod(appt)]
                                .filter(Boolean)
                                .join(' · ')
                            return (
                                <li key={appt.id} className='wfy-row'>
                                    <div className='wfy-row-text'>
                                        <Text strong>{appt.interventionTitle || appt.sessionTitle || 'Appointment'}</Text>
                                        {when ? <Text type='secondary' className='wfy-row-sub'>{when}</Text> : null}
                                    </div>
                                    <Space size={6} wrap className='wfy-row-actions'>
                                        <Button
                                            danger
                                            icon={<CloseOutlined />}
                                            disabled={answeringId === appt.id}
                                            onClick={() => setDecliningAppt(appt)}
                                        >
                                            Decline
                                        </Button>
                                        <Button
                                            type='primary'
                                            icon={hasFoodMenu(appt) ? <RightOutlined /> : <CheckOutlined />}
                                            loading={answeringId === appt.id}
                                            onClick={() => confirmAppointment(appt)}
                                        >
                                            {hasFoodMenu(appt) ? 'Choose meal' : 'Confirm'}
                                        </Button>
                                    </Space>
                                </li>
                            )
                        })}
                    </ul>
                </section>
            )}

            {stepDepts.length > 0 && (
                <section className='wfy-section'>
                    <h4 className='wfy-section-title'>
                        <FileTextOutlined /> Confirm your developmental plan
                        <span className='wfy-count'>{waiting.plans.length}</span>
                    </h4>
                    <PlanWalkthrough
                        isMobile={isMobile}
                        departments={stepDepts}
                        current={Math.min(current, stepDepts.length - 1)}
                        onStepChange={setCurrent}
                        pendingIds={pendingPlanIds}
                        interventions={waiting.plan?.interventions || []}
                        catalogByDeptId={waiting.catalogByDeptId}
                        confirmingId={confirmingId}
                        finalizing={finalizing}
                        onConfirm={confirmDepartment}
                        onOpenFullPlan={() => goTo(ROADMAP_PATH)}
                    />
                </section>
            )}

            {counts.length > 0 && (
                <section className='wfy-section'>
                    <h4 className='wfy-section-title'>Also waiting</h4>
                    <ul className='wfy-list'>
                        {counts.map(item => (
                            <li key={item.key} className='wfy-row'>
                                <div className='wfy-row-text wfy-row-count'>
                                    {item.icon}
                                    <Text>{item.label}</Text>
                                </div>
                                <Button onClick={item.onClick}>Review</Button>
                            </li>
                        ))}
                    </ul>
                </section>
            )}
        </div>
    )

    const footer = (
        <div className='wfy-footer'>
            <Button onClick={dismiss}>Not now</Button>
        </div>
    )

    return (
        <>
            {isMobile ? (
                <Drawer
                    open
                    placement='bottom'
                    height='100%'
                    title={heading}
                    onClose={dismiss}
                    footer={footer}
                    styles={{ body: { padding: 16 } }}
                >
                    {body}
                </Drawer>
            ) : (
                <Modal
                    open
                    title={heading}
                    onCancel={dismiss}
                    footer={footer}
                    width={720}
                    maskClosable={false}
                    destroyOnClose
                    centered
                    // Header and Not now stay put; a long list scrolls in between.
                    styles={{ body: { maxHeight: 'calc(100vh - 220px)', overflowY: 'auto', paddingRight: 4 } }}
                >
                    {body}
                </Modal>
            )}
            <DeclineAppointmentModal appointment={decliningAppt} onClose={() => setDecliningAppt(null)} />
        </>
    )
}

type WalkthroughProps = {
    isMobile: boolean
    /** The walkthrough steps, one per department, in order. */
    departments: DevPlanDept[]
    current: number
    onStepChange: (index: number) => void
    /** Departments still waiting on the SME; any step not in here is confirmed. */
    pendingIds: Set<string>
    interventions: any[]
    catalogByDeptId: Record<string, any[]>
    confirmingId: string | null
    finalizing: boolean
    onConfirm: (dept: DevPlanDept) => void
    onOpenFullPlan: () => void
}

/** The development plan walkthrough: one department per step, review, then confirm. */
export const PlanWalkthrough: React.FC<WalkthroughProps> = ({
    isMobile,
    departments: stepDepts,
    current,
    onStepChange,
    pendingIds,
    interventions,
    catalogByDeptId,
    confirmingId,
    finalizing,
    onConfirm,
    onOpenFullPlan
}) => {
    const active = stepDepts[current]
    const activeConfirmed = !pendingIds.has(active.id)

    const ivs = (interventions as any[])
        .filter(iv => belongsToDept(iv, active))
        .map(iv => ({
            ...iv,
            title: iv?.title ?? iv?.interventionTitle ?? iv?.name ?? '-',
            departmentName: active.name,
            compulsory: isCompulsoryIntervention(iv, catalogByDeptId[active.id] || [])
        }))

    return (
        <Space direction='vertical' size={16} style={{ width: '100%' }}>
            {stepDepts.length > 1 && (
                <Steps
                    size='small'
                    type={isMobile ? 'inline' : 'default'}
                    current={current}
                    onChange={onStepChange}
                    items={stepDepts.map((d, i) => ({
                        title: d.name,
                        status: !pendingIds.has(d.id) ? 'finish' : i === current ? 'process' : 'wait'
                    }))}
                />
            )}

            <div>
                {stepDepts.length > 1 && (
                    <Text type='secondary' style={{ fontSize: 12 }}>
                        Department {current + 1} of {stepDepts.length}
                    </Text>
                )}
                <Title level={5} style={{ margin: 0 }}>{active.name}</Title>
                <Text type='secondary'>
                    This department has completed its part of your plan. Review what it will deliver, then confirm.
                </Text>
            </div>

            {ivs.length ? (
                <List
                    size='small'
                    bordered
                    dataSource={ivs}
                    rowKey={(r: any) => `${r?.id || ''}-${r.title}-${r.departmentId || ''}`}
                    renderItem={(iv: any) => (
                        <List.Item>
                            <Space direction='vertical' size={0} style={{ width: '100%' }}>
                                <Space wrap size={6}>
                                    <Text strong>{String(iv.title)}</Text>
                                    {iv.compulsory && <Tag color='blue'>Compulsory</Tag>}
                                </Space>
                                <Text type='secondary' style={{ fontSize: 12 }}>{String(iv.departmentName)}</Text>
                            </Space>
                        </List.Item>
                    )}
                />
            ) : (
                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='No interventions are attached to this department yet.' />
            )}

            {activeConfirmed ? (
                <Alert type='success' showIcon message={`You have confirmed ${active.name}.`} />
            ) : (
                <Text type='secondary' style={{ fontSize: 12 }}>
                    Confirming records your agreement with what this department will deliver.
                    To remove an item first, open the full plan.
                </Text>
            )}

            <div className='wfy-plan-actions'>
                <Button type='link' onClick={onOpenFullPlan} style={{ paddingInline: 0 }}>
                    Open full plan
                </Button>
                <Space size={8} wrap>
                    {stepDepts.length > 1 && (
                        <>
                            <Button disabled={current === 0} onClick={() => onStepChange(current - 1)}>Back</Button>
                            <Button disabled={current >= stepDepts.length - 1} onClick={() => onStepChange(current + 1)}>Next</Button>
                        </>
                    )}
                    <Button
                        type='primary'
                        icon={<CheckOutlined />}
                        onClick={() => onConfirm(active)}
                        disabled={activeConfirmed || finalizing}
                        loading={confirmingId === active.id || finalizing}
                    >
                        {/* On a phone the department is already named just above. */}
                        {isMobile ? 'Confirm Plan' : `Confirm ${active.name}`}
                    </Button>
                </Space>
            </div>
        </Space>
    )
}

export default WaitingForYouPrompt
