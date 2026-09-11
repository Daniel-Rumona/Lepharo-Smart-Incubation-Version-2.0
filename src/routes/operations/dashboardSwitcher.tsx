// src/routes/dashboard/DashboardSwitcher.tsx
import React, { useEffect, useMemo, useState } from 'react'
import { Result } from 'antd'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { db } from '@/firebase'
import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore'

import LegalDashboard from '@/components/dashboards/legal/legalDashboard'
import OperationsDashboard from './OperationsDashboard'
import TrainingDashboard from '@/components/dashboards/training'
import ROMDashboard from '@/components/dashboards/rom/romDashboard'
import WellnessDashboard from '@/components/dashboards/wellness'
import MarketingDashboard from '@/components/dashboards/marketing'
import FinanceDashboard from '@/components/dashboards/finance'
import InhouseFinanceDashboard from './inhouse/FinanceDashboard'
import MarketLinkagesDashboard from '@/components/dashboards/linkage'
import HSEDashboard from '@/components/dashboards/hse'
import PDSDashboard from '@/components/dashboards/pds'
import HRDashboard from '@/components/dashboards/hrm'
import StakeholderEngagementDashboard from '@/components/dashboards/stakeholder'
import { LoadingOverlay } from '@/components/shared/LoadingOverlay'

const LEGAL_DEPT_NAME = 'Legal Advisory Services'
const TRAINING_DEPT_NAME = 'Training Academy'
const STAKEHOLDER_DEPT_NAME = 'Stakeholder Engagement'
const ROM_DEPT_NAME = 'ROM (Recruitment, Onboarding and Maintenance)'
const PDS_DEPT_NAME = 'PDS (Personal Development Services)'
const WELLNESS_DEPT_NAME = 'Wellness Services'
const MARKETING_DEPT_NAME = 'Marketing and Communication'
const LINKAGES_DEPT_NAME = 'Market Linkages'
const FINANCIAL_DEPT_NAME = 'Financial Compliance'
const INHOUSE_DEPT_NAME = 'IHF (InHouse Finance)'
const HSE_DEPT_NAME = 'HSE (Health, Safety & Environment) and Labour Compliance'
const HRM_DEPT_NAME = 'HRM (Human Resources Management)'

const normalize = (str?: string) =>
    String(str ?? '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim()

/**
 * Resolves the "effective" department name for routing dashboards:
 * - If user is in a subdepartment (parentDepartmentId exists) => use parent department name
 * - If user is in a parent department => use its own canonical name
 * - Ignore isMain (used elsewhere)
 */
async function resolveEffectiveDepartmentName(args: {
    userDepartmentId?: string
    userDepartmentName?: string
}): Promise<string | null> {
    const userDepartmentId = args.userDepartmentId || ''
    const userDepartmentName = args.userDepartmentName || ''

    // 1) Preferred: resolve by departmentId
    if (userDepartmentId) {
        const deptSnap = await getDoc(doc(db, 'departments', userDepartmentId))
        if (deptSnap.exists()) {
            const dept = deptSnap.data() as any
            const parentId = dept.parentDepartmentId ? String(dept.parentDepartmentId) : null

            if (parentId) {
                const parentSnap = await getDoc(doc(db, 'departments', parentId))
                if (parentSnap.exists()) {
                    const parent = parentSnap.data() as any
                    return String(parent.name || parent.departmentName || '') || null
                }
            }

            return String(dept.name || dept.departmentName || userDepartmentName || '') || null
        }
    }

    // 2) Fallback: resolve by departmentName
    if (userDepartmentName) {
        const qDept = query(
            collection(db, 'departments'),
            where('name', '==', userDepartmentName),
            limit(1)
        )
        const snap = await getDocs(qDept)
        const d = snap.docs[0]
        if (d) {
            const dept = d.data() as any
            const parentId = dept.parentDepartmentId ? String(dept.parentDepartmentId) : null

            if (parentId) {
                const parentSnap = await getDoc(doc(db, 'departments', parentId))
                if (parentSnap.exists()) {
                    const parent = parentSnap.data() as any
                    return String(parent.name || parent.departmentName || '') || null
                }
            }

            return String(dept.name || userDepartmentName || '') || null
        }
    }

    // 3) Absolute last fallback
    return userDepartmentName || null
}

export const DashboardSwitcher: React.FC = () => {
    const { user, loading } = useFullIdentity()
    const [resolvingDept, setResolvingDept] = useState(true)
    const [effectiveDeptName, setEffectiveDeptName] = useState<string>('')

    useEffect(() => {
        let mounted = true

        const run = async () => {
            if (!user) {
                if (mounted) {
                    setEffectiveDeptName('')
                    setResolvingDept(false)
                }
                return
            }

            setResolvingDept(true)
            try {
                const resolved = await resolveEffectiveDepartmentName({
                    userDepartmentId: (user as any)?.departmentId,
                    userDepartmentName: (user as any)?.departmentName
                })

                if (mounted) setEffectiveDeptName(resolved || '')
            } catch (e) {
                console.warn('Failed to resolve effective department for dashboard routing', e)
                if (mounted) setEffectiveDeptName((user as any)?.departmentName || '')
            } finally {
                if (mounted) setResolvingDept(false)
            }
        }

        run()
        return () => {
            mounted = false
        }
    }, [user])

    const normalizedDept = useMemo(() => normalize(effectiveDeptName), [effectiveDeptName])

    if (loading || resolvingDept) {
        return (
            <div style={{ minHeight: '100vh' }}>
                <LoadingOverlay tip='Getting your dashboard ready' />
            </div>
        )
    }

    if (!user) {
        return <Result status='warning' title='User not found or not authenticated.' />
    }

    if (normalizedDept === normalize(LEGAL_DEPT_NAME)) return <LegalDashboard />
    if (normalizedDept === normalize(TRAINING_DEPT_NAME)) return <TrainingDashboard />
    if (normalizedDept === normalize(STAKEHOLDER_DEPT_NAME)) return <StakeholderEngagementDashboard />
    if (normalizedDept === normalize(ROM_DEPT_NAME)) return <ROMDashboard />
    if (normalizedDept === normalize(PDS_DEPT_NAME)) return <PDSDashboard />
    if (normalizedDept === normalize(WELLNESS_DEPT_NAME)) return <WellnessDashboard />
    if (normalizedDept === normalize(MARKETING_DEPT_NAME)) return <MarketingDashboard />
    if (normalizedDept === normalize(FINANCIAL_DEPT_NAME)) return <FinanceDashboard />
    if (normalizedDept === normalize(INHOUSE_DEPT_NAME)) return <InhouseFinanceDashboard />
    if (normalizedDept === normalize(LINKAGES_DEPT_NAME)) return <MarketLinkagesDashboard />
    if (normalizedDept === normalize(HSE_DEPT_NAME)) return <HSEDashboard />
    if (normalizedDept === normalize(HRM_DEPT_NAME)) return <HRDashboard />

    return <OperationsDashboard />
}

export default DashboardSwitcher
