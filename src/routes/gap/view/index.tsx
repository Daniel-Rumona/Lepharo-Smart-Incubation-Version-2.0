import React from 'react'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Alert, Button } from 'antd'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import GapDetail from './GapDetail'
import { getAllowedSectionsForDept } from '../sections'

/**
 * Full-page GAP Analysis detail — /operations/gap/:id
 *
 * Manual GAPs live in applications/{appId}/complianceDocuments/{id}, so the
 * application id travels in ?appId= to keep the URL shareable and refreshable.
 * Router state carries the already-loaded record as a fast path.
 */
const GAPAnalysisDetailView: React.FC = () => {
    const { id } = useParams()
    const [searchParams] = useSearchParams()
    const navigate = useNavigate()
    const location = useLocation()
    const { user } = useFullIdentity() as any

    const appId = searchParams.get('appId')
    const preloaded = (location.state as any)?.gapRecord || null

    const departmentName = String(user?.departmentName || '').trim()
    const allowedSections = getAllowedSectionsForDept(departmentName)
    const isROM = allowedSections === 'ALL'

    const goBack = () => {
        if (window.history.length > 1) navigate(-1)
        else navigate('/operations/gap')
    }

    if (!id) {
        return (
            <Alert
                type='error'
                showIcon
                message='Missing GAP id'
                description='This link does not point at a GAP Analysis record.'
                action={<Button onClick={() => navigate('/operations/gap')}>Back to list</Button>}
            />
        )
    }

    return (
        <div style={{ padding: '2px 24px 24px' }}>
            <GapDetail
                gapId={id}
                appId={appId}
                manualRecord={preloaded}
                isROM={isROM}
                allowedSections={allowedSections}
                romName={user?.name || ''}
                romEmail={user?.email || ''}
                viewerDepartmentName={departmentName}
                mode='page'
                onBack={goBack}
            />
        </div>
    )
}

export default GAPAnalysisDetailView
