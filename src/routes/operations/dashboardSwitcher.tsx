// src/routes/dashboard/DashboardSwitcher.tsx
import React from 'react'
import { Result } from 'antd'
import { AnimatePresence, motion } from 'framer-motion'
import { DashboardLoader } from '@/components/layout/DashboardLoader'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { DepartmentRoleKey, useDepartmentRoles } from '@/services/departmentRoles'

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

const DASHBOARD_BY_ROLE: Partial<Record<DepartmentRoleKey, React.ComponentType>> = {
    legal: LegalDashboard,
    training: TrainingDashboard,
    stakeholder: StakeholderEngagementDashboard,
    rom: ROMDashboard,
    pds: PDSDashboard,
    wellness: WellnessDashboard,
    marketing: MarketingDashboard,
    financialCompliance: FinanceDashboard,
    inhouseFinance: InhouseFinanceDashboard,
    marketLinkages: MarketLinkagesDashboard,
    hse: HSEDashboard,
    hr: HRDashboard
}

export const DashboardSwitcher: React.FC = () => {
    const { user, loading } = useFullIdentity()
    const { roleOf, loading: rolesLoading } = useDepartmentRoles()

    const role = roleOf((user as any)?.departmentId)

    const isPending = loading || rolesLoading

    const renderDashboard = () => {
        const Dashboard = (role && DASHBOARD_BY_ROLE[role]) || OperationsDashboard
        return <Dashboard />
    }

    return (
        <AnimatePresence mode='wait'>
            {isPending ? (
                <motion.div
                    key='dashboard-loader'
                    initial={{ opacity: 1 }}
                    exit={{ opacity: 0, scale: 0.94, filter: 'blur(4px)' }}
                    transition={{ duration: 0.3, ease: 'easeIn' }}
                >
                    <DashboardLoader />
                </motion.div>
            ) : !user ? (
                <Result key='no-user' status='warning' title='User not found or not authenticated.' />
            ) : (
                <motion.div
                    key={`dashboard-${role || 'operations'}`}
                    initial={{ opacity: 0, y: 24, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                >
                    {renderDashboard()}
                </motion.div>
            )}
        </AnimatePresence>
    )
}

export default DashboardSwitcher
