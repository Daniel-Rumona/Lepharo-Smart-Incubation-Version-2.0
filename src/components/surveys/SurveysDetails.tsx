// src/components/surveys/SurveysDetails.tsx
import React, { useEffect, useMemo, useState } from 'react'
import { App, Col, Drawer, Empty, Row } from 'antd'
import {
    ClockCircleOutlined,
    FileTextOutlined,
    PercentageOutlined,
    SendOutlined
} from '@ant-design/icons'
import { motion, useReducedMotion } from 'framer-motion'
import { Helmet } from 'react-helmet'
import { useNavigate } from 'react-router-dom'

import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { useIsMobile } from '@/hooks/useIsMobile'
import { MotionCard } from '../dashboards/metrics/Header'
import { MetricTile } from '../dashboards/metrics/MetricTile'
import '@/components/workspace'
import './portal/surveys.css'
import {
    responseRate,
    questionsSignature,
    recipientFields,
    sentStatusOf,
    toDate,
    useSentSurveys,
    useSurveyTemplates,
    type SentSurvey,
    type SurveyTemplate,
    sendSummaries,
    currentQuestions,
    formatDay
} from './portal/surveyData'
import {
    DEFAULT_PORTAL_FILTERS,
    SurveyToolbar,
    type PortalFilters,
    type SentSort,
    type TemplateSort
} from './portal/SurveyToolbar'
import { SurveyList } from './portal/SurveyList'
import { SentSurveyDetail } from './portal/SentSurveyDetail'
import { TemplateDetail } from './portal/TemplateDetail'
import { SendSurveyModal } from './portal/SendSurveyModal'
import { SurveyAnalyticsModal } from './portal/SurveyAnalyticsModal'
import {
    SurveyActionBlocked,
    closeSentSurvey,
    deleteSentSurvey,
    deleteTemplate,
    makeTemplateReady,
    setTemplateArchived,
    updateSurveyQuestions
} from './portal/surveyActions'

// Matches isSuperAdmin() in firestore.rules, which alone may delete shared templates.
const SUPER_ADMIN_ROLES = new Set(['system_admin', 'superadmin'])

const BUILDER_PATH = '/operations/surveys/builder'

const time = (value: any) => toDate(value)?.getTime() ?? 0

const sentSorters: Record<SentSort, (a: SentSurvey, b: SentSurvey) => number> = {
    newest: (a, b) => time(b.sentAt) - time(a.sentAt),
    // Undated surveys last.
    due: (a, b) => (time(a.dueDate) || Infinity) - (time(b.dueDate) || Infinity),
    response: (a, b) => responseRate(a) - responseRate(b),
    title: (a, b) => a.title.localeCompare(b.title)
}

const templateSorters: Record<TemplateSort, (a: SurveyTemplate, b: SurveyTemplate) => number> = {
    updated: (a, b) => time(b.updatedAt) - time(a.updatedAt),
    title: (a, b) => a.title.localeCompare(b.title)
}

/**
 * Surveys Portal: tiles, one toolbar, the department's sent surveys or its
 * templates, and the selected one beside the list. On phones the detail opens
 * in a full-height drawer. The programme is the one picked in the header.
 */
const SurveysDetailsPage: React.FC = () => {
    const navigate = useNavigate()
    const { user } = useFullIdentity()
    const { activeProgramId } = useActiveProgramId()
    const isMobile = useIsMobile()
    const reduceMotion = useReducedMotion()
    const rise = (delay: number) =>
        reduceMotion
            ? {}
            : {
                initial: { opacity: 0, y: 10 },
                animate: { opacity: 1, y: 0 },
                transition: { duration: 0.3, ease: 'easeOut' as const, delay }
            }

    const departmentId = user?.departmentId ? String(user.departmentId) : null
    const programId = activeProgramId || null
    const { surveys, loading: sentLoading } = useSentSurveys(departmentId, programId)
    const { templates, loading: templatesLoading, reload: reloadTemplates } = useSurveyTemplates(departmentId, programId)
    const { message } = App.useApp()
    const isAdmin = SUPER_ADMIN_ROLES.has(String(user?.role || ''))

    const [filters, setFilters] = useState<PortalFilters>(DEFAULT_PORTAL_FILTERS)
    const patchFilters = (patch: Partial<PortalFilters>) =>
        setFilters(previous => ({
            ...previous,
            ...patch,
            // Categories differ between the two views.
            ...(patch.view && patch.view !== previous.view ? { search: '' } : {})
        }))
    const [selectedId, setSelectedId] = useState<string>()
    const [drawerOpen, setDrawerOpen] = useState(false)
    const [sendOpen, setSendOpen] = useState(false)
    const [analyticsOpen, setAnalyticsOpen] = useState(false)
    // Set when opened from a survey: the window starts on it.
    const [analyticsSurveyId, setAnalyticsSurveyId] = useState<string | null>(null)
    const openAnalytics = (surveyId: string | null = null) => {
        setAnalyticsSurveyId(surveyId)
        setAnalyticsOpen(true)
    }
    const [sendTemplateId, setSendTemplateId] = useState<string | null>(null)
    // Set when the Send window adds SMEs to an existing survey.
    const [addToSurveyId, setAddToSurveyId] = useState<string | null>(null)

    const isSent = filters.view === 'sent'
    const published = useMemo(() => templates.filter(t => t.status === 'published' && !t.archived), [templates])
    // Each template's sending history, for its status and "Sent 17 Nov · 32/35".
    const templateSends = useMemo(() => sendSummaries(surveys), [surveys])
    const sentTemplateIds = useMemo(
        () => new Set(surveys.map(s => s.templateId).filter((id): id is string => !!id)),
        [surveys]
    )

    const term = filters.search.trim().toLowerCase()

    const visibleSent = useMemo(
        () =>
            surveys
                .filter(
                    s =>
                        (!term || s.title.toLowerCase().includes(term)) &&
                        (filters.sentStatus === 'all' || sentStatusOf(s) === filters.sentStatus)
                )
                .sort(sentSorters[filters.sentSort]),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [surveys, term, filters.sentStatus, filters.sentSort]
    )

    const visibleTemplates = useMemo(
        () =>
            templates
                .filter(
                    t =>
                        (!term || t.title.toLowerCase().includes(term)) &&
                        // Archived templates show only under their own filter.
                        (filters.templateStatus === 'archived'
                            ? !!t.archived
                            : !t.archived &&
                            (filters.templateStatus === 'all' || t.status === filters.templateStatus))
                )
                .sort(templateSorters[filters.templateSort]),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [templates, term, filters.templateStatus, filters.templateSort]
    )

    const visibleIds = isSent ? visibleSent.map(s => s.id) : visibleTemplates.map(t => t.id)

    // Desktop always shows a detail: keep the selection while it's visible, otherwise take the first row.
    useEffect(() => {
        if (isMobile) return
        if (!selectedId || !visibleIds.includes(selectedId)) setSelectedId(visibleIds[0])
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visibleIds.join('|'), selectedId, isMobile])

    const selectedSurvey = isSent ? surveys.find(s => s.id === selectedId) : undefined
    const selectedTemplate = !isSent ? templates.find(t => t.id === selectedId) : undefined

    const select = (id: string) => {
        setSelectedId(id)
        if (isMobile) setDrawerOpen(true)
    }

    const openSend = (templateId?: string | null) => {
        setSendTemplateId(templateId || null)
        setAddToSurveyId(null)
        setSendOpen(true)
    }

    // A draft made ready from its Send button: open Send once the reloaded
    // list has it as ready (the Send window only offers ready templates).
    const [pendingSendId, setPendingSendId] = useState<string | null>(null)
    useEffect(() => {
        if (pendingSendId && published.some(t => t.id === pendingSendId)) {
            openSend(pendingSendId)
            setPendingSendId(null)
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pendingSendId, published])

    const openAddSmes = (surveyId: string) => {
        setSendTemplateId(null)
        setAddToSurveyId(surveyId)
        setSendOpen(true)
    }

    const tiles = useMemo(() => {
        const invited = surveys.reduce((sum, s) => sum + s.total, 0)
        const responded = surveys.reduce((sum, s) => sum + s.completed, 0)
        return [
            { key: 'sent', title: 'Surveys sent', value: surveys.length, tone: 'accent' as const, icon: <SendOutlined /> },
            {
                key: 'rate',
                title: 'Response rate',
                mobileTitle: 'Responses',
                value: `${invited ? Math.round((responded / invited) * 100) : 0}%`,
                tone: 'success' as const,
                icon: <PercentageOutlined />
            },
            {
                key: 'awaiting',
                title: 'Awaiting answers',
                mobileTitle: 'Awaiting',
                value: invited - responded,
                tone: 'warning' as const,
                icon: <ClockCircleOutlined />
            },
            {
                key: 'templates',
                title: 'Published templates',
                mobileTitle: 'Templates',
                value: published.length,
                tone: 'info' as const,
                icon: <FileTextOutlined />
            }
        ]
    }, [surveys, published.length])

    // Surveys belong to a department; without one there is nothing to list.
    if (user && !departmentId) {
        return (
            <div className='ws-page'>
                <Helmet>
                    <title>Surveys Portal</title>
                </Helmet>
                <MotionCard>
                    <Empty description='Your profile has no department, so there are no surveys to show.' />
                </MotionCard>
            </div>
        )
    }

    const loading = isSent ? sentLoading : templatesLoading
    // Own department's; a shared template (no department) is for admins.
    const canManageTemplate = (template: SurveyTemplate) =>
        template.department ? template.department === departmentId : isAdmin
    const canManageSurvey = (survey: SentSurvey) => survey.department === departmentId || isAdmin

    /** Runs an action; a blocked one explains why, anything else reports a failure. */
    const run = async (action: () => Promise<unknown>, done: string) => {
        try {
            await action()
            message.success(done)
        } catch (error) {
            if (error instanceof SurveyActionBlocked) {
                message.warning(error.message)
            } else {
                console.error(error)
                message.error('That didn’t work. Please try again.')
            }
        }
    }

    /**
     * When the survey's template now asks different questions from what the
     * SMEs still answering were sent, they can be given the new ones.
     */
    /**
     * A template sent before: did its questions change since the latest round?
     * Unchanged, a new round would repeat it, so people are added to that round
     * instead (while it's open). Undefined until that round's copies load.
     */
    const resendFor = (template: SurveyTemplate) => {
        const latest = surveys
            .filter(s => s.templateId === template.id)
            .sort((a, b) => (toDate(b.sentAt)?.getTime() || 0) - (toDate(a.sentAt)?.getTime() || 0))[0]
        if (!latest || !latest.loaded) return undefined
        const sentQuestions = currentQuestions(latest.recipients)
        const changed =
            !sentQuestions.length || questionsSignature(template.fields) !== questionsSignature(sentQuestions)
        const canAdd = canManageSurvey(latest) && sentStatusOf(latest) !== 'closed'
        return {
            changed,
            lastSent: latest.sentAt ? formatDay(latest.sentAt) : 'last time',
            onAddRecipients: canAdd
                ? () => {
                    // Show that round, so what was added is in view afterwards.
                    patchFilters({ view: 'sent' })
                    setSelectedId(latest.id)
                    openAddSmes(latest.id)
                }
                : undefined
        }
    }

    const questionUpdateFor = (survey: SentSurvey) => {
        const template = templates.find(t => t.id === survey.templateId)
        if (!template || !template.fields.length || !canManageSurvey(survey)) return undefined
        if (sentStatusOf(survey) === 'closed') return undefined
        const target = questionsSignature(template.fields)
        const waiting = survey.recipients.filter(r => !r.completed)
        if (!waiting.some(r => questionsSignature(recipientFields(r)) !== target)) return undefined
        return {
            waiting: waiting.length,
            submitted: survey.completed,
            onUpdate: () =>
                run(() => updateSurveyQuestions(survey.id, template.fields), 'Questions updated')
        }
    }

    const detail = selectedSurvey ? (
        <SentSurveyDetail
            survey={selectedSurvey}
            onAddSmes={
                canManageSurvey(selectedSurvey) && sentStatusOf(selectedSurvey) !== 'closed'
                    ? () => openAddSmes(selectedSurvey.id)
                    : undefined
            }
            questionUpdate={questionUpdateFor(selectedSurvey)}
            canManage={canManageSurvey(selectedSurvey)}
            onDelete={() => run(() => deleteSentSurvey(selectedSurvey.id), 'Survey deleted')}
            onCloseNow={() => run(() => closeSentSurvey(selectedSurvey.id), 'Survey closed')}
            onAnalytics={() => openAnalytics(selectedSurvey.id)}
        />
    ) : selectedTemplate ? (
        <TemplateDetail
            template={selectedTemplate}
            onEdit={() => navigate(`${BUILDER_PATH}/${encodeURIComponent(selectedTemplate.id)}`)}
            onSend={() => openSend(selectedTemplate.id)}
            onMakeReadyAndSend={async () => {
                try {
                    await makeTemplateReady(selectedTemplate.id)
                    message.success("Ready to send. Nothing has been sent yet: choose who gets it.")
                    setPendingSendId(selectedTemplate.id)
                    reloadTemplates()
                } catch (error) {
                    console.error(error)
                    message.error('Could not make the survey ready to send.')
                }
            }}
            canManage={canManageTemplate(selectedTemplate)}
            hasBeenSent={sentTemplateIds.has(selectedTemplate.id)}
            sendSummary={templateSends.get(selectedTemplate.id)}
            resend={resendFor(selectedTemplate)}
            onDelete={() =>
                run(async () => {
                    await deleteTemplate(selectedTemplate.id)
                    reloadTemplates()
                }, 'Template deleted')
            }
            onArchive={archived =>
                run(async () => {
                    await setTemplateArchived(selectedTemplate.id, archived)
                    reloadTemplates()
                }, archived ? 'Template archived' : 'Template restored')
            }
        />
    ) : null

    const emptyText = isSent
        ? surveys.length
            ? 'No surveys match these filters'
            : 'No surveys sent yet'
        : templates.length
            ? 'No templates match these filters'
            : 'No templates yet'

    return (
        <div className='ws-page'>
            <Helmet>
                <title>Surveys Portal</title>
            </Helmet>

            <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
                {tiles.map((tile, i) => (
                    <Col key={tile.key} xs={12} lg={6}>
                        <motion.div {...rise(i * 0.05)}>
                            <MetricTile
                                icon={tile.icon}
                                tone={tile.tone}
                                title={tile.title}
                                mobileTitle={tile.mobileTitle}
                                value={tile.value}
                                loading={tile.key === 'templates' ? templatesLoading : sentLoading}
                                compact={isMobile}
                            />
                        </motion.div>
                    </Col>
                ))}
            </Row>

            <motion.div {...rise(0.22)}>
                <SurveyToolbar
                    filters={filters}
                    onChange={patchFilters}
                    onSend={() => openSend()}
                    onAnalytics={() => openAnalytics()}
                    onCreate={() => navigate(BUILDER_PATH)}
                />
            </motion.div>

            <div className='ws-layout'>
                {isSent ? (
                    <SurveyList
                        view='sent'
                        surveys={visibleSent}
                        sort={filters.sentSort}
                        onSortChange={sentSort => patchFilters({ sentSort })}
                        loading={loading}
                        selectedId={selectedId}
                        onSelect={select}
                        resetKey={`${filters.search}|${filters.sentStatus}`}
                        emptyText={emptyText}
                    />
                ) : (
                    <SurveyList
                        view='templates'
                        templates={visibleTemplates}
                        sendSummaries={templateSends}
                        sort={filters.templateSort}
                        onSortChange={templateSort => patchFilters({ templateSort })}
                        loading={loading}
                        selectedId={selectedId}
                        onSelect={select}
                        resetKey={`${filters.search}|${filters.templateStatus}`}
                        emptyText={emptyText}
                    />
                )}

                {!isMobile && (
                    <div className='ws-detail-sticky'>
                        {detail || (
                            <MotionCard loading={loading} skeleton='text' skeletonRows={8}>
                                <Empty
                                    className='ws-detail-empty'
                                    description={isSent ? 'Select a survey to see its responses' : 'Select a template'}
                                />
                            </MotionCard>
                        )}
                    </div>
                )}
            </div>

            {isMobile && (
                <Drawer
                    className='ws-drawer'
                    open={drawerOpen && !!detail}
                    onClose={() => setDrawerOpen(false)}
                    placement='right'
                    width='100%'
                    title={selectedSurvey?.title || selectedTemplate?.title || 'Survey'}
                >
                    {detail}
                </Drawer>
            )}

            <SurveyAnalyticsModal
                open={analyticsOpen}
                onClose={() => setAnalyticsOpen(false)}
                surveys={surveys}
                initialSurveyId={analyticsSurveyId}
            />

            <SendSurveyModal
                open={sendOpen}
                onClose={() => setSendOpen(false)}
                templates={published}
                initialTemplateId={sendTemplateId}
                addTo={addToSurveyId ? surveys.find(s => s.id === addToSurveyId) || null : null}
                activeProgramId={programId}
                departmentId={departmentId}
                myUid={user?.uid}
                sentSurveys={surveys}
                onSent={sentFormId => {
                    setSendOpen(false)
                    setFilters(previous => ({ ...previous, view: 'sent', sentStatus: 'all', search: '' }))
                    setSelectedId(sentFormId)
                    if (isMobile) setDrawerOpen(true)
                }}
            />
        </div>
    )
}

export default SurveysDetailsPage
