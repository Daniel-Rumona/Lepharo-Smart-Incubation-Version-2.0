import React, { useEffect, useMemo, useState } from 'react'
import { Col, Drawer, Empty, Row, message } from 'antd'
import { CheckCircleOutlined, ClockCircleOutlined, CloseCircleOutlined, FileTextOutlined } from '@ant-design/icons'
import { Helmet } from 'react-helmet'
import { motion, useReducedMotion } from 'framer-motion'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { useIsMobile } from '@/hooks/useIsMobile'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { MetricTile, type MetricTone } from '@/components/dashboards/metrics/MetricTile'
import { isControlAccountEmail, displayName, type Application } from './applicationData'
import { hasApplicationScope, useApplications } from './useApplications'
import { ApplicationFilters, DEFAULT_FILTERS, type ApplicationFilterState } from './ApplicationFilters'
import { ApplicationList } from './ApplicationList'
import { ApplicationDetail } from './ApplicationDetail'
import { ApplicationsAnalytics } from './ApplicationsAnalytics'
import { exportApplicationsWorkbook } from './exportApplications'
import './applications.css'

const STAT_TILES: { key: ApplicationFilterState['status']; title: string; tone: MetricTone; icon: React.ReactNode }[] = [
    { key: 'all', title: 'Total applications', tone: 'accent', icon: <FileTextOutlined /> },
    { key: 'pending', title: 'Pending', tone: 'warning', icon: <ClockCircleOutlined /> },
    { key: 'accepted', title: 'Accepted', tone: 'success', icon: <CheckCircleOutlined /> },
    { key: 'rejected', title: 'Rejected', tone: 'danger', icon: <CloseCircleOutlined /> }
]

const distinct = (apps: Application[], key: (a: Application) => string) =>
    Array.from(new Set(apps.map(key).map(v => v.trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b))

const sorters: Record<ApplicationFilterState['sort'], (a: Application, b: Application) => number> = {
    score: (a, b) => (b.aiScore ?? -Infinity) - (a.aiScore ?? -Infinity),
    newest: (a, b) => (b.submittedAt?.valueOf() ?? 0) - (a.submittedAt?.valueOf() ?? 0),
    name: (a, b) => displayName(a).localeCompare(displayName(b))
}

/**
 * Applications review: stats, one-line filters, a list of applications and
 * the selected one's detail with its decision footer. On phones the detail
 * opens in a full-height drawer.
 */
const ApplicationsPage: React.FC = () => {
    const { user } = useFullIdentity()
    const { activeProgramId, isAllPrograms } = useActiveProgramId()
    const isMobile = useIsMobile()
    const reduceMotion = useReducedMotion()
    /** Page entrance: tiles, then the filter bar, rise in one after another. */
    const rise = (delay: number) =>
        reduceMotion
            ? {}
            : {
                initial: { opacity: 0, y: 10 },
                animate: { opacity: 1, y: 0 },
                transition: { duration: 0.3, ease: 'easeOut' as const, delay }
            }

    const role = (user?.role || '').toLowerCase().replace(/\s+/g, '')
    const scope = {
        activeProgramId,
        isAllPrograms,
        isRestrictedRole: role === 'projectadmin' || role === 'projectmanager',
        isControlAccount: isControlAccountEmail(user?.email)
    }
    const { applications, loading, refreshOne, questionMaps } = useApplications(scope)

    const [filters, setFilters] = useState<ApplicationFilterState>(DEFAULT_FILTERS)
    const [selectedId, setSelectedId] = useState<string>()
    const [drawerOpen, setDrawerOpen] = useState(false)
    const [analyticsOpen, setAnalyticsOpen] = useState(false)
    const [exporting, setExporting] = useState(false)
    const patchFilters = (patch: Partial<ApplicationFilterState>) => setFilters(prev => ({ ...prev, ...patch }))

    const genderOptions = useMemo(() => distinct(applications, a => a.gender), [applications])
    const ageGroupOptions = useMemo(() => distinct(applications, a => a.ageGroup), [applications])
    const hubOptions = useMemo(() => distinct(applications, a => a.hub), [applications])
    // Hubs only matter for multi-branch programmes; more than one hub in the data is the signal.
    const showHub = hubOptions.length > 1

    // Everything except status: drives the tile counts, so they don't all collapse to the active status.
    const beforeStatus = useMemo(() => {
        const term = filters.search.trim().toLowerCase()
        return applications.filter(
            a =>
                (!term || displayName(a).toLowerCase().includes(term) || a.email.toLowerCase().includes(term)) &&
                (filters.gender === 'all' || a.gender === filters.gender) &&
                (filters.ageGroup === 'all' || a.ageGroup === filters.ageGroup) &&
                (!showHub || filters.hub === 'all' || a.hub === filters.hub)
        )
    }, [applications, filters.search, filters.gender, filters.ageGroup, filters.hub, showHub])

    const visible = useMemo(
        () =>
            beforeStatus
                .filter(a => filters.status === 'all' || a.applicationStatus === filters.status)
                .sort(sorters[filters.sort]),
        [beforeStatus, filters.status, filters.sort]
    )

    const counts = useMemo(() => {
        const c = { all: beforeStatus.length, pending: 0, accepted: 0, rejected: 0 }
        beforeStatus.forEach(a => c[a.applicationStatus]++)
        return c
    }, [beforeStatus])

    // Desktop always shows a detail: keep the selection while it's visible, otherwise take the first row.
    useEffect(() => {
        if (isMobile) return
        if (!visible.some(a => a.id === selectedId)) setSelectedId(visible[0]?.id)
    }, [visible, selectedId, isMobile])

    const selected = applications.find(a => a.id === selectedId)

    const select = (app: Application) => {
        setSelectedId(app.id)
        if (isMobile) setDrawerOpen(true)
    }

    const exportVisible = async () => {
        if (!visible.length) {
            message.warning('No applications to export with the current filters.')
            return
        }
        setExporting(true)
        try {
            await exportApplicationsWorkbook(visible)
        } catch (e) {
            console.error('[applications] export failed:', e)
            message.error('Could not export the applications. Please try again.')
        } finally {
            setExporting(false)
        }
    }

    if (!hasApplicationScope(scope)) {
        return (
            <div className='ws-page'>
                <Helmet>
                    <title>Applications</title>
                </Helmet>
                <MotionCard>
                    <Empty description='Select an active programme to view applications' />
                </MotionCard>
            </div>
        )
    }

    const detail = selected ? (
        <ApplicationDetail
            app={selected}
            questionMap={selected.programId ? questionMaps[String(selected.programId)] : undefined}
            onChanged={refreshOne}
        />
    ) : null

    return (
        <div className='ws-page'>
            <Helmet>
                <title>Applications</title>
            </Helmet>

            <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
                {STAT_TILES.map((t, i) => (
                    // Read-only summaries; status is filtered from the toolbar.
                    <Col key={t.key} xs={12} lg={6}>
                        <motion.div {...rise(i * 0.05)}>
                            <MetricTile
                                icon={t.icon}
                                tone={t.tone}
                                title={t.title}
                                mobileTitle={t.key === 'all' ? 'Total' : undefined}
                                value={counts[t.key]}
                                loading={loading}
                                compact={isMobile}
                            />
                        </motion.div>
                    </Col>
                ))}
            </Row>

            <motion.div {...rise(0.22)}>
                <ApplicationFilters
                    filters={filters}
                    onChange={patchFilters}
                    genderOptions={genderOptions}
                    ageGroupOptions={ageGroupOptions}
                    hubOptions={hubOptions}
                    showHub={showHub}
                    onAnalytics={() => setAnalyticsOpen(true)}
                    onExport={exportVisible}
                    exporting={exporting}
                />
            </motion.div>

            <div className='ws-layout'>
                <ApplicationList
                    applications={visible}
                    loading={loading}
                    selectedId={selectedId}
                    onSelect={select}
                    sort={filters.sort}
                    onSortChange={sort => patchFilters({ sort })}
                    resetKey={`${filters.search}|${filters.status}|${filters.gender}|${filters.ageGroup}|${filters.hub}`}
                />

                {!isMobile && (
                    <div className='ws-detail-sticky'>
                        {detail || (
                            <MotionCard loading={loading} skeleton='text' skeletonRows={8}>
                                <Empty
                                    className='ws-detail-empty'
                                    description={
                                        applications.length
                                            ? 'Select an application to review it'
                                            : 'No applications yet'
                                    }
                                />
                            </MotionCard>
                        )}
                    </div>
                )}
            </div>

            {isMobile && (
                <Drawer
                    className='ws-drawer'
                    open={drawerOpen && !!selected}
                    onClose={() => setDrawerOpen(false)}
                    placement='right'
                    width='100%'
                    title={selected ? displayName(selected) : 'Application'}
                >
                    {detail}
                </Drawer>
            )}

            <ApplicationsAnalytics
                open={analyticsOpen}
                onClose={() => setAnalyticsOpen(false)}
                applications={visible}
                showHub={showHub}
            />
        </div>
    )
}

export default ApplicationsPage
