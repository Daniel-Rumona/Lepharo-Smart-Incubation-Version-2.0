import React, { useState } from 'react'
import { Alert, Result, Spin } from 'antd'
import { Navigate, Route, Routes, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import ReportsHubPage from './ReportsHubPage'
import CreateReportModal from './CreateReportModal'
import TemplatesManagementPage from './TemplatesManagementPage'
import TemplateEditorPage from './TemplateEditorPage'
import ContributorAssignmentsPage from './ContributorAssignmentsPage'
import ReportWorkspacePage from './ReportWorkspacePage'
import ReportPreviewPage from './ReportPreviewPage'
import { useReportCurrentUser } from './useReportCurrentUser'
import './reportPhaseTwo.css'

const COLLABORATIVE_REPORTS_BASE_PATH = '/operations/reports/collaborative'

const CollaborativeReportsModule: React.FC = () => {
    const navigate = useNavigate()
    const { user, loading, error } = useReportCurrentUser()
    const [createOpen, setCreateOpen] = useState(false)
    const [createFlow, setCreateFlow] = useState<'choose' | 'template' | 'upload'>('choose')
    const [preferredTemplateId, setPreferredTemplateId] = useState<string | undefined>()

    if (loading) return <div style={{ padding: 48, textAlign: 'center' }}><Spin size="large" /></div>
    if (error) return <Alert type="error" showIcon message="Could not load collaborative reports" description={error} />
    if (!user) return <Result status="403" title="Sign in required" subTitle="You need an authenticated account to access collaborative reports." />

    const openCreate = (flow: 'choose' | 'template' | 'upload' = 'choose', templateId?: string) => {
        setCreateFlow(flow)
        setPreferredTemplateId(templateId)
        setCreateOpen(true)
    }

    const Hub = () => user.canAccessReportsHub ? (
        <ReportsHubPage
            user={user}
            onCreate={() => openCreate('choose')}
            onManageTemplates={() => navigate(`${COLLABORATIVE_REPORTS_BASE_PATH}/templates`)}
            onMyContributions={() => navigate(`${COLLABORATIVE_REPORTS_BASE_PATH}/contributions`)}
            onOpenReport={reportId => navigate(`${COLLABORATIVE_REPORTS_BASE_PATH}/reports/${reportId}`)}
        />
    ) : <Navigate to="contributions" replace />

    const Templates = () => user.canManageTemplates ? (
        <TemplatesManagementPage
            user={user}
            onBack={() => navigate(COLLABORATIVE_REPORTS_BASE_PATH)}
            onUploadTemplate={() => openCreate('upload')}
            onConfigureTemplate={templateId => navigate(`${COLLABORATIVE_REPORTS_BASE_PATH}/templates/${templateId}`)}
            onCreateFromTemplate={templateId => openCreate('template', templateId)}
        />
    ) : <Result status="403" title="Template management is restricted" />

    const TemplateEditorRoute = () => {
        const { templateId } = useParams()
        if (!user.canManageTemplates) return <Result status="403" title="Template management is restricted" />
        if (!templateId) return <Navigate to={`${COLLABORATIVE_REPORTS_BASE_PATH}/templates`} replace />
        return <TemplateEditorPage user={user} templateId={templateId} onBack={() => navigate(`${COLLABORATIVE_REPORTS_BASE_PATH}/templates`)} />
    }

    const Contributions = () => (
        <ContributorAssignmentsPage
            user={user}
            onBack={user.canAccessReportsHub ? () => navigate(COLLABORATIVE_REPORTS_BASE_PATH) : undefined}
            onOpenContribution={(reportId, blockId) => navigate(`${COLLABORATIVE_REPORTS_BASE_PATH}/reports/${reportId}?contributor=1&block=${blockId}`)}
        />
    )

    const WorkspaceRoute = () => {
        const { reportId } = useParams()
        const [params] = useSearchParams()
        if (!reportId) return <Navigate to={COLLABORATIVE_REPORTS_BASE_PATH} replace />

        const forceContributorOnly = params.get('contributor') === '1'
        const blockId = params.get('block') || undefined

        return (
            <ReportWorkspacePage
                user={user}
                reportId={reportId}
                forceContributorOnly={forceContributorOnly}
                initialBlockId={blockId}
                onBack={() => navigate(forceContributorOnly || !user.canAccessReportsHub ? `${COLLABORATIVE_REPORTS_BASE_PATH}/contributions` : COLLABORATIVE_REPORTS_BASE_PATH)}
                onPreview={() => navigate(`${COLLABORATIVE_REPORTS_BASE_PATH}/reports/${reportId}/preview`)}
            />
        )
    }

    const PreviewRoute = () => {
        const { reportId } = useParams()
        if (!reportId) return <Navigate to={COLLABORATIVE_REPORTS_BASE_PATH} replace />
        return <ReportPreviewPage user={user} reportId={reportId} onBack={() => navigate(`${COLLABORATIVE_REPORTS_BASE_PATH}/reports/${reportId}`)} />
    }

    return (
        <div
            className="report-phase-two"
            style={{ padding: 16 }}
        >
            <Routes>
                <Route
                    index
                    element={<Hub />}
                />

                <Route
                    path="contributions"
                    element={<Contributions />}
                />

                <Route
                    path="templates"
                    element={<Templates />}
                />

                <Route
                    path="templates/:templateId"
                    element={<TemplateEditorRoute />}
                />

                <Route
                    path="reports/:reportId"
                    element={<WorkspaceRoute />}
                />

                <Route
                    path="reports/:reportId/preview"
                    element={<PreviewRoute />}
                />
            </Routes>

            {user.canAccessReportsHub ? (
                <CreateReportModal
                    open={createOpen}
                    user={user}
                    initialFlow={createFlow}
                    preferredTemplateId={preferredTemplateId}
                    onClose={() => setCreateOpen(false)}
                    onReportCreated={reportId =>
                        navigate(`${COLLABORATIVE_REPORTS_BASE_PATH}/reports/${reportId}`)
                    }
                    onTemplateCreated={templateId =>
                        navigate(`${COLLABORATIVE_REPORTS_BASE_PATH}/templates/${templateId}`)
                    }
                />
            ) : null}
        </div>
    )
}

export default CollaborativeReportsModule
