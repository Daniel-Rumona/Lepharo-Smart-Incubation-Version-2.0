// DPConfirmationOverlay.tsx
import React, { useEffect, useState } from 'react'
import { Card, Result, Button } from 'antd'
import { useNavigate } from 'react-router-dom'
import { onAuthStateChanged } from 'firebase/auth'
import {
    collection,
    getDocs,
    query,
    where,
    doc,
    getDoc
} from 'firebase/firestore'
import { db, auth } from '@/firebase'
import { LoadingOverlay } from '@/components/shared/LoadingOverlay'

type AppRow = {
    id: string
    participantId?: string
    beneficiaryName?: string
    participantName?: string
    programName?: string
}

type GapDoc = {
    participantId: string
    romReview?: { status?: string }
}

type PlanDoc = {
    participantId: string
    createdAt?: any
    finalConfirmation?: boolean
}

// -------- helpers (copied from DiagnosticPlanBuilder) --------
const toMillis = (v: any): number => {
    if (!v) return 0
    if (typeof v === 'number') return v
    if (v instanceof Date) return v.getTime()
    if (typeof v?.toMillis === 'function') return v.toMillis()
    if (typeof v?.seconds === 'number') return v.seconds * 1000
    return 0
}

function chunk<T>(arr: T[], size = 10): T[][] {
    const out: T[][] = []
    const step = Math.max(1, Math.floor(size))
    for (let i = 0; i < arr.length; i += step) out.push(arr.slice(i, i + step))
    return out
}

// ------------------------------------------------------------

interface DPConfirmationOverlayProps {
    children: React.ReactNode
}

/**
 * Overlay that:
 *  - Finds all eligible participants for the current user's company
 *    (accepted application + GAP romReview.status === 'confirmed')
 *  - Checks diagnosticPlans.finalConfirmation per participant
 *  - If ANY are not finalised, blocks the page with a Result
 *    and a "Go To Plans" button → /operations/plan
 */
const DPConfirmationOverlay: React.FC<DPConfirmationOverlayProps> = ({
    children
}) => {
    const navigate = useNavigate()

    const [checking, setChecking] = useState<boolean>(true)
    const [allConfirmed, setAllConfirmed] = useState<boolean>(false)
    const [stats, setStats] = useState<{
        total: number
        finalised: number
        pending: number
    }>({
        total: 0,
        finalised: 0,
        pending: 0
    })

    // 1) Core check: are all DPs finalised?
    useEffect(() => {
        const runCheck = async () => {

            setChecking(true)
            try {
                // 1.1 Accepted applications for this company
                const appsSnap = await getDocs(
                    query(
                        collection(db, 'applications'),
                        where('applicationStatus', '==', 'accepted'),
                    )
                )

                const apps: AppRow[] = appsSnap.docs.map(d => ({
                    id: d.id,
                    ...(d.data() as any)
                }))

                const base = apps
                    .filter(a => !!a.participantId)
                    .map(a => ({
                        appId: a.id,
                        participantId: String(a.participantId),
                        beneficiaryName: a.beneficiaryName || a.participantName || '',
                        programName: a.programName || ''
                    }))

                if (!base.length) {
                    setStats({ total: 0, finalised: 0, pending: 0 })
                    // no eligible participants -> nothing to block
                    setAllConfirmed(true)
                    return
                }

                // 1.2 Filter by GAP with romReview.status === 'confirmed'
                const pidChunks = chunk(
                    base.map(b => b.participantId),
                    10
                )
                const romConfirmed = new Set<string>()

                for (const ids of pidChunks) {
                    if (!ids.length) continue
                    const gapSnap = await getDocs(
                        query(
                            collection(db, 'gapAnalysis'),
                            where('participantId', 'in', ids)
                        )
                    )
                    gapSnap.docs.forEach(docSnap => {
                        const g = docSnap.data() as GapDoc
                        const st = String(g?.romReview?.status || '').toLowerCase()
                        if (st === 'confirmed') {
                            romConfirmed.add(String(g.participantId))
                        }
                    })
                }

                const eligible = base.filter(b => romConfirmed.has(b.participantId))
                if (!eligible.length) {
                    setStats({ total: 0, finalised: 0, pending: 0 })
                    setAllConfirmed(true)
                    return
                }

                // 1.3 For eligible participants, look at diagnosticPlans.finalConfirmation
                const latestByPid = new Map<
                    string,
                    { createdAt: number; finalConfirmed: boolean }
                >()

                for (const ids of chunk(
                    eligible.map(e => e.participantId),
                    10
                )) {
                    if (!ids.length) continue
                    const plansSnap = await getDocs(
                        query(
                            collection(db, 'diagnosticPlans'),
                            where('participantId', 'in', ids)
                        )
                    )
                    plansSnap.docs.forEach(docSnap => {
                        const data = docSnap.data() as PlanDoc
                        const pid = String(data.participantId)
                        const created = toMillis(data.createdAt)
                        const final = data.finalConfirmation === true
                        const prev = latestByPid.get(pid)
                        if (!prev || created > prev.createdAt) {
                            latestByPid.set(pid, {
                                createdAt: created,
                                finalConfirmed: final
                            })
                        }
                    })
                }

                const total = eligible.length
                const finalised = eligible.filter(
                    e => latestByPid.get(e.participantId)?.finalConfirmed
                ).length
                const pending = total - finalised

                setStats({ total, finalised, pending })
                setAllConfirmed(total > 0 && pending === 0)
            } catch (err) {
                console.error('DPConfirmationOverlay: check failed', err)
                // On error, don't hard-block the page
                setAllConfirmed(true)
            } finally {
                setChecking(false)
            }
        }

        runCheck()
    }, [])

    // 2) Render: children + optional blocking overlay
    return (
        <>
            {children}

            {checking && (
                <LoadingOverlay tip='Checking Developmental Plans status…' />
            )}

            {!checking && !allConfirmed && (
                <div
                    style={{
                        position: 'fixed',
                        inset: 0,
                        background: 'rgba(0,0,0,0.45)',
                        zIndex: 9999,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: 16
                    }}
                >
                    <Card
                        style={{
                            maxWidth: 520,
                            width: '100%',
                            borderRadius: 16,
                            boxShadow: '0 16px 40px rgba(0,0,0,0.35)'
                        }}
                    >
                        <Result
                            status='warning'
                            title='Developmental Plans still pending'
                            subTitle={
                                stats.total > 0
                                    ? `There are ${stats.pending} out of ${stats.total} eligible Developmental Plans that are not yet finalised. Please complete and confirm all DPs before proceeding.`
                                    : 'Some Developmental Plans are not yet finalised. Please complete and confirm them before proceeding.'
                            }
                            extra={[
                                <Button
                                    type='primary'
                                    key='go'
                                    onClick={() => navigate('/operations/plan')}
                                >
                                    Go To Plans
                                </Button>
                            ]}
                        />
                    </Card>
                </div>
            )}
        </>
    )
}

export default DPConfirmationOverlay
