import React from 'react'
import { Result } from 'antd'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useDepartmentRoles } from '@/services/departmentRoles'

import MonitoringReports from './monitoring'
import HRMReportsPage from './hrm'
import { StakeholderEngagementAnalytics } from './stakeholder'
import ReportingDashboard from './universal/ReportingDashboard'
import ROMSegmentedReportsPage from './rom'
import { DashboardLoader } from '@/components/layout/DashboardLoader'

export const ReportSwitcher: React.FC = () => {
    const { user, loading } = useFullIdentity()
    const { roleOf, loading: rolesLoading } = useDepartmentRoles()

    if (loading || rolesLoading) {
        return <DashboardLoader label='Preparing reports' />
    }

    if (!user) {
        return <Result status='warning' title='User not found or not authenticated.' />
    }

    switch (roleOf((user as any)?.departmentId)) {
        case 'hr':
            return <HRMReportsPage />

        case 'monitoring':
            return <MonitoringReports />

        case 'rom':
            return <ROMSegmentedReportsPage />

        case 'stakeholder':
            return <StakeholderEngagementAnalytics />

        default:
            return <ReportingDashboard />
    }
}

export default ReportSwitcher
