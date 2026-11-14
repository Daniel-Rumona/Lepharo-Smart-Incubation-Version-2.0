import React from 'react'
import { Button, Result } from 'antd'
import { useNavigate } from 'react-router-dom'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { PageSkeleton } from '@/components/shared/PageSkeleton'

const ADMIN_ROLES = new Set(['system_admin', 'admin', 'superadmin'])

/**
 * Whether this login may open the Surveys Portal and its builder: admins and
 * operations staff in any department, matching the operations menu
 * (buildMenuAccess in components/layout).
 */
export const useSurveysPortalAccess = () => {
    const { user, loading } = useFullIdentity()
    const role = String(user?.role || '')
    return {
        loading,
        allowed: ADMIN_ROLES.has(role) || role === 'operations'
    }
}

/** Renders the page only for logins whose menu reaches the Surveys Portal. */
export const SurveysAccessGuard: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const navigate = useNavigate()
    const { user } = useFullIdentity()
    const { loading, allowed } = useSurveysPortalAccess()

    if (loading) return <PageSkeleton variant='single' />

    if (!allowed) {
        return (
            <Result
                status='403'
                title="Surveys aren't part of your workspace"
                subTitle='The Surveys Portal is for department staff who run programme surveys.'
                extra={
                    <Button type='primary' onClick={() => navigate(`/${user?.role || ''}`)}>
                        Go to my dashboard
                    </Button>
                }
            />
        )
    }

    return <>{children}</>
}
