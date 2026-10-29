import React, { createContext, useContext, useMemo, useState } from 'react'
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
import type { ReportUserContext } from './types'
import '@/components/workspace'
import '@/routes/operations/movs/movs.css'
import './reportPhaseTwo.css'
import './reports.css'

const BASE = '/operations/reports/collaborative'

type CreateFlow = 'template' | 'upload'

type ReportsModuleContext = {
    user: ReportUserContext
    openCreate: (flow?: CreateFlow, templateId?: string) => void
}

const ModuleContext = createContext<ReportsModuleContext | null>(null)
const useModule = () => {
    const value = useContext(ModuleContext)
    if (!value) throw new Error('Collaborative report pages must render inside CollaborativeReportsModule.')
    return value
}

// Route pages are defined once, out here. Declared inside the module's render (as before),
// every state change — opening "New report" — remounted them: filters reset and live
// listeners restarted.

const HubRoute: React.FC = () => {
    const { user, openCreate } = useModule()
    const navigate = useNavigate()
    if (!user.canAccessReportsHub) return <Navigate to="contributions" replace />
    return (
        <ReportsHubPage
            user={user}
            onCreate={() => openCreate('template')}
            onManageTemplates={() => navigate(`${BASE}/templates`)}
            onMyContributions={() => navigate(`${BASE}/contributions`)}
            onOpenReport={reportId => navigate(`${BASE}/reports/${reportId}`)}
        />
    )
}

const TemplatesRoute: React.FC = () => {
    const { user, openCreate } = useModule()
    const navigate = useNavigate()
    if (!user.canManageTemplates) return <Result status="403" title="Only report owners manage templates" />
    return (
        <TemplatesManagementPage
            user={user}
            onBack={() => navigate(BASE)}
            onUploadTemplate={() => openCreate('upload')}
            onConfigureTemplate={templateId => navigate(`${BASE}/templates/${templateId}`)}
            onCreateFromTemplate={templateId => openCreate('template', templateId)}
        />
    )
}

const TemplateEditorRoute: React.FC = () => {
    const { user } = useModule()
    const navigate = useNavigate()
    const { templateId } = useParams()
    if (!user.canManageTemplates) return <Result status="403" title="Only report owners manage templates" />
    if (!templateId) return <Navigate to={`${BASE}/templates`} replace />
    return <TemplateEditorPage user={user} templateId={templateId} onBack={() => navigate(`${BASE}/templates`)} />
}

const ContributionsRoute: React.FC = () => {
    const { user } = useModule()
    const navigate = useNavigate()
    return (
        <ContributorAssignmentsPage
            user={user}
            onBack={user.canAccessReportsHub ? () => navigate(BASE) : undefined}
            onOpenContribution={(reportId, blockId) => navigate(`${BASE}/reports/${reportId}?contributor=1&block=${blockId}`)}
        />
    )
}

const WorkspaceRoute: React.FC = () => {
    const { user } = useModule()
    const navigate = useNavigate()
    const { reportId } = useParams()
    const [params] = useSearchParams()
    if (!reportId) return <Navigate to={BASE} replace />
    const forceContributorOnly = params.get('contributor') === '1'
    return (
        <ReportWorkspacePage
            key={reportId}
            user={user}
            reportId={reportId}
            forceContributorOnly={forceContributorOnly}
            initialBlockId={params.get('block') || undefined}
            onBack={() => navigate(forceContributorOnly || !user.canAccessReportsHub ? `${BASE}/contributions` : BASE)}
            onPreview={() => navigate(`${BASE}/reports/${reportId}/preview`)}
        />
    )
}

const PreviewRoute: React.FC = () => {
    const { user } = useModule()
    const navigate = useNavigate()
    const { reportId } = useParams()
    if (!reportId) return <Navigate to={BASE} replace />
    return <ReportPreviewPage user={user} reportId={reportId} onBack={() => navigate(`${BASE}/reports/${reportId}`)} />
}

const CollaborativeReportsModule: React.FC = () => {
    const navigate = useNavigate()
    const { user, loading, error } = useReportCurrentUser()
    const [createOpen, setCreateOpen] = useState(false)
    const [createFlow, setCreateFlow] = useState<CreateFlow>('template')
    const [preferredTemplateId, setPreferredTemplateId] = useState<string | undefined>()

    const context = useMemo<ReportsModuleContext | null>(
        () =>
            user
                ? {
                    user,
                    openCreate: (flow = 'template', templateId) => {
                        setCreateFlow(flow)
                        setPreferredTemplateId(templateId)
                        setCreateOpen(true)
                    }
                }
                : null,
        [user]
    )

    if (loading) return <div className="ws-page" style={{ padding: 48, textAlign: 'center' }}><Spin size="large" /></div>
    if (error) return <div className="ws-page"><Alert type="error" showIcon message="Couldn’t load reports" description={error} /></div>
    if (!user || !context) return <Result status="403" title="Sign in to see reports" />

    return (
        <ModuleContext.Provider value={context}>
            <div className="report-phase-two ws-page">
                <Routes>
                    <Route index element={<HubRoute />} />
                    <Route path="contributions" element={<ContributionsRoute />} />
                    <Route path="templates" element={<TemplatesRoute />} />
                    <Route path="templates/:templateId" element={<TemplateEditorRoute />} />
                    <Route path="reports/:reportId" element={<WorkspaceRoute />} />
                    <Route path="reports/:reportId/preview" element={<PreviewRoute />} />
                </Routes>

                {user.canAccessReportsHub ? (
                    <CreateReportModal
                        open={createOpen}
                        user={user}
                        initialFlow={createFlow}
                        preferredTemplateId={preferredTemplateId}
                        onClose={() => setCreateOpen(false)}
                        onReportCreated={reportId => navigate(`${BASE}/reports/${reportId}`)}
                        onTemplateCreated={templateId => navigate(`${BASE}/templates/${templateId}`)}
                    />
                ) : null}
            </div>
        </ModuleContext.Provider>
    )
}

export default CollaborativeReportsModule
