import React, { useEffect, useState } from 'react'
import { Button, Grid, Spin } from 'antd'
import { CheckCircleOutlined, FileTextOutlined } from '@ant-design/icons'
import { Navigate, useNavigate } from 'react-router-dom'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { SmeWaitingProvider, useSmeWaiting } from '@/components/incubatee/SmeWaiting'
import { PlanWalkthrough, writePlanReviewLater } from '@/components/incubatee/PendingDevPlanPrompt'
import { DevPlanDept, confirmDepartmentBySme } from '@/services/devPlanConfirmationService'
import { ThemeToggle } from '@/components/layout/theme-toggle'
import { PoweredByQuantilytix } from '@/components/brand/PoweredByQuantilytix'
import '../whatsapp-consent/whatsapp-consent.css'
import '@/components/incubatee/waitingPrompt.css'
import './plan-review.css'

const { useBreakpoint } = Grid

const DASHBOARD_PATH = '/incubatee'

/**
 * Shown straight after sign-in, before the dashboard, when departments have
 * completed their part of the SME's development plan and wait on the SME's
 * confirmation. One department per step, listing what it added. With nothing
 * waiting it moves straight on to the dashboard.
 */
const PlanReview: React.FC = () => {
    const screens = useBreakpoint()
    const navigate = useNavigate()
    const { user, loading: identityLoading } = useFullIdentity()
    const waiting = useSmeWaiting()

    // Steps are fixed when the page first has them, so confirming one never
    // reshuffles the rest; departments that become pending are appended.
    const [stepIds, setStepIds] = useState<string[] | null>(null)
    const [current, setCurrent] = useState(0)
    const [confirmingId, setConfirmingId] = useState<string | null>(null)
    const [finalizing, setFinalizing] = useState(false)

    useEffect(() => {
        if (waiting.plansLoading) return
        setStepIds(prev => {
            if (!prev) return waiting.plans.map(d => d.id)
            const extra = waiting.plans.filter(d => !prev.includes(d.id)).map(d => d.id)
            return extra.length ? [...prev, ...extra] : prev
        })
    }, [waiting.plansLoading, waiting.plans])

    const carryOn = () => navigate(DASHBOARD_PATH, { replace: true })
    const later = () => {
        writePlanReviewLater(String(user?.uid || user?.email || ''))
        carryOn()
    }

    // Signed out (an old link or the back button): nothing to load here.
    if (!identityLoading && !user?.email) return <Navigate to='/login' replace />
    if (!stepIds) {
        return (
            <div className='wc pr-loading'>
                <Spin size='large' />
            </div>
        )
    }
    if (!stepIds.length) return <Navigate to={DASHBOARD_PATH} replace />

    const pendingIds = new Set(waiting.plans.map(d => d.id))
    const stepDepts = stepIds
        .map(id => waiting.planDepartments.find(d => d.id === id))
        .filter(Boolean) as DevPlanDept[]
    const allConfirmed = !waiting.plans.length && !confirmingId && !finalizing
    // Confirming every department shown here only completes the plan when no
    // other department is still preparing its part; the plan says which.
    const planFinalised = !!waiting.plan?.finalConfirmation
    const confirmedNames = stepDepts.map(d => d.name)
    const confirmedLabel = confirmedNames.length === 1
        ? confirmedNames[0]
        : `${confirmedNames.slice(0, -1).join(', ')} and ${confirmedNames[confirmedNames.length - 1]}`

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
            const next = stepDepts.findIndex(d => d.id !== dept.id && pendingIds.has(d.id))
            if (next >= 0) setCurrent(next)
        } finally {
            setConfirmingId(null)
        }
    }

    const firstName = String(user?.name || user?.displayName || '').trim().split(/\s+/)[0]

    return (
        <div className='wc'>
            <div className='wc-bg' aria-hidden='true'>
                <span className='wc-glow wc-glow-a' />
                <span className='wc-glow wc-glow-b' />
            </div>

            <header className='wc-top'>
                <img className='wc-logo' src='/assets/images/lepharo.png' alt='Lepharo' />
                <ThemeToggle />
            </header>

            <main className='wc-main'>
                <section className={`wc-card pr-card${allConfirmed ? ' pr-done' : ''}`} aria-labelledby='pr-title'>
                    <span className='pr-badge' aria-hidden='true'>
                        {allConfirmed ? <CheckCircleOutlined /> : <FileTextOutlined />}
                    </span>
                    <h1 id='pr-title' className='wc-title'>
                        {allConfirmed
                            ? planFinalised
                                ? 'Your development plan is confirmed'
                                : 'Thank you for confirming'
                            : `${firstName ? `Welcome back, ${firstName}. ` : ''}Your development plan is ready`}
                    </h1>
                    <p className='pr-lead'>
                        {allConfirmed
                            ? planFinalised
                                ? 'Every department has its part confirmed. They can now start delivering what they planned with you.'
                                : `${confirmedLabel} can now start delivering what ${confirmedNames.length === 1 ? 'it' : 'they'} planned with you. Other departments may still be preparing their part of your plan; you will be asked to confirm each one when it is ready.`
                            : stepDepts.length === 1
                                ? 'A department has added items to your development plan. Review them and confirm.'
                                : `${stepDepts.length} departments have added items to your development plan. Review each one and confirm.`}
                    </p>

                    {!allConfirmed && stepDepts.length > 0 && (
                        <PlanWalkthrough
                            isMobile={!screens.md}
                            departments={stepDepts}
                            current={Math.min(current, stepDepts.length - 1)}
                            onStepChange={setCurrent}
                            pendingIds={pendingIds}
                            interventions={waiting.plan?.interventions || []}
                            catalogByDeptId={waiting.catalogByDeptId}
                            confirmingId={confirmingId}
                            finalizing={finalizing}
                            onConfirm={confirmDepartment}
                            onOpenFullPlan={() => navigate('/incubatee/roadmap', { replace: true })}
                        />
                    )}

                    <div className='pr-actions'>
                        {allConfirmed ? (
                            <Button type='primary' size='large' block onClick={carryOn}>
                                Continue to dashboard
                            </Button>
                        ) : (
                            <Button type='text' onClick={later} disabled={!!confirmingId || finalizing}>
                                I'll do this later
                            </Button>
                        )}
                    </div>
                </section>
            </main>

            <footer className='wc-foot'>
                <span>© {new Date().getFullYear()} Lepharo Smart Incubation</span>
                <PoweredByQuantilytix />
            </footer>
        </div>
    )
}

const PlanReviewPage: React.FC = () => (
    <SmeWaitingProvider enabled>
        <PlanReview />
    </SmeWaitingProvider>
)

export default PlanReviewPage
