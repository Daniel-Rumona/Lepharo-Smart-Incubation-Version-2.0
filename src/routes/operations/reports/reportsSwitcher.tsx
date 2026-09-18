import React, { useEffect, useState } from 'react'
import { Result } from 'antd'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { db } from '@/firebase'
import { doc, getDoc } from 'firebase/firestore'

import MonitoringReports from './monitoring'
import HRMReportsPage from './hrm'
import { StakeholderEngagementAnalytics } from './stakeholder'
import ReportingDashboard from './universal/ReportingDashboard'
import ROMSegmentedReportsPage from './rom'
import { LoadingOverlay } from '@/components/shared/LoadingOverlay'

const normalize = (str?: string) =>
    (str || '').toLowerCase().replace(/\s+/g, ' ').trim()

async function resolveEffectiveDepartmentName(args: {
    departmentId?: string
    departmentName?: string
}): Promise<string> {
    const { departmentId, departmentName } = args

    if (departmentId) {
        const deptSnap = await getDoc(doc(db, 'departments', departmentId))
        if (deptSnap.exists()) {
            const dept = deptSnap.data() as any
            const parentId = dept.parentDepartmentId

            if (parentId) {
                const parentSnap = await getDoc(doc(db, 'departments', parentId))
                if (parentSnap.exists()) {
                    const parent = parentSnap.data() as any
                    return String(parent.name || parent.departmentName || '')
                }
            }

            return String(dept.name || dept.departmentName || departmentName || '')
        }
    }

    return departmentName || ''
}

export const ReportSwitcher: React.FC = () => {
    const { user, loading } = useFullIdentity()
    const [resolving, setResolving] = useState(true)
    const [effectiveDept, setEffectiveDept] = useState('')

    useEffect(() => {
        let mounted = true

        const run = async () => {
            if (loading) return

            if (!user) {
                if (mounted) {
                    setEffectiveDept('')
                    setResolving(false)
                }
                return
            }

            setResolving(true)

            try {
                const resolved = await resolveEffectiveDepartmentName({
                    departmentId: (user as any)?.departmentId,
                    departmentName: (user as any)?.departmentName
                })

                if (mounted) setEffectiveDept(resolved)
                console.info('[ReportSwitcher] Effective department:', resolved)
            } catch (e) {
                console.warn('[ReportSwitcher] Failed to resolve department', e)
                if (mounted) setEffectiveDept((user as any)?.departmentName || '')
            } finally {
                if (mounted) setResolving(false)
            }
        }

        run()
        return () => {
            mounted = false
        }
    }, [loading, user?.departmentId, user?.departmentName])

    if (loading || resolving) {
        return <LoadingOverlay tip='Preparing reports' />
    }

    if (!user) {
        return <Result status='warning' title='User not found or not authenticated.' />
    }

    const dept = normalize(effectiveDept)

    switch (dept) {
        case normalize('HRM (Human Resources Management)'):
            return <HRMReportsPage />

        case normalize('M&E (Monitoring and Evaluation)'):
            return <MonitoringReports />

        case normalize('ROM (Recruitment, Onboarding and Maintenance)'):
            return <ROMSegmentedReportsPage />

        case normalize('Stakeholder Engagement'):
            return <StakeholderEngagementAnalytics />

        case normalize('Legal Advisory Services'):
        case normalize('HSE (Health, Safety & Environment) and Labour Compliance'):
        case normalize('Marketing and Communication'):
        case normalize('PDS (Personal Development Services)'):
            return <ReportingDashboard />

        default:
            return <ReportingDashboard />
    }
}

export default ReportSwitcher
