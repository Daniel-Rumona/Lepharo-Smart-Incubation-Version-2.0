import React, { useEffect, useMemo, useState } from 'react'
import { Button, Col, Drawer, Empty, Result, Row, Segmented, Spin, Tag, message } from 'antd'
import {
    CalendarOutlined,
    FileDoneOutlined,
    ClockCircleOutlined,
    PlusOutlined,
    SendOutlined,
    ShopOutlined,
    SortAscendingOutlined,
    TrophyOutlined
} from '@ant-design/icons'
import { SortSelect, type SortOption } from '@/components/workspace'
import { Helmet } from 'react-helmet'
import { motion, useReducedMotion } from 'framer-motion'
import dayjs from 'dayjs'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { useDepartmentRoles } from '@/services/departmentRoles'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { MetricTile } from '@/components/dashboards/metrics/MetricTile'
import { listOpportunities, type Opportunity } from '@/services/marketLinkage'
import { OpportunityDetail, closingLabel } from './OpportunityDetail'
import { OpportunityForm } from './OpportunityForm'
import { ContractsView } from './ContractsView'
import './market-linkage.css'

type OpportunitySort = 'closing' | 'newest' | 'eligible' | 'title'

const SORT_OPTIONS: SortOption<OpportunitySort>[] = [
    { value: 'closing', label: 'Closing soonest', icon: <CalendarOutlined /> },
    { value: 'newest', label: 'Newest first', icon: <ClockCircleOutlined /> },
    { value: 'eligible', label: 'Most eligible SMEs', icon: <TrophyOutlined /> },
    { value: 'title', label: 'Title A–Z', icon: <SortAscendingOutlined /> }
]

const time = (date: Date | null, missing: number) => (date ? date.getTime() : missing)

// Ties fall back to the title so the order is stable.
const SORTERS: Record<OpportunitySort, (a: Opportunity, b: Opportunity) => number> = {
    closing: (a, b) => time(a.closingDate, Infinity) - time(b.closingDate, Infinity) || a.title.localeCompare(b.title),
    newest: (a, b) => time(b.createdAt, 0) - time(a.createdAt, 0) || a.title.localeCompare(b.title),
    eligible: (a, b) => (b.matchSummary?.eligible ?? -1) - (a.matchSummary?.eligible ?? -1) || a.title.localeCompare(b.title),
    title: (a, b) => a.title.localeCompare(b.title)
}

/**
 * Market Linkages: capture opportunities (RFQs, tenders, corporate requests),
 * match them against every accepted SME's readiness passport, and invite the
 * ones that fit. Matching and invites run in Cloud Functions
 * (functions/src/marketLinkage.ts). For now only the Market Linkages
 * department may use it; the functions and firestore.rules enforce the same.
 */
const MarketLinkagePage: React.FC = () => {
    const { user } = useFullIdentity()
    const { hasRole, loading: rolesLoading } = useDepartmentRoles()
    const allowed = hasRole(String((user as any)?.departmentId || ''), 'marketLinkages')

    if (rolesLoading) return <div style={{ display: 'grid', placeItems: 'center', padding: 48 }}><Spin /></div>
    if (!allowed) {
        return (
            <Result
                status='403'
                title='Market Linkage is for the Market Linkages department'
                subTitle='Ask the Market Linkages team if you need an opportunity matched.'
            />
        )
    }
    return <MarketLinkageWorkspace />
}

const MarketLinkageWorkspace: React.FC = () => {
    const { user } = useFullIdentity()
    const { programId } = useActiveProgramId()
    const isMobile = useIsMobile()
    const reduceMotion = useReducedMotion()
    const [opportunities, setOpportunities] = useState<Opportunity[]>([])
    const [loading, setLoading] = useState(true)
    const [statusFilter, setStatusFilter] = useState<'open' | 'closed'>('open')
    const [selectedId, setSelectedId] = useState<string>()
    const [drawerOpen, setDrawerOpen] = useState(false)
    const [form, setForm] = useState<{ open: boolean; editing: Opportunity | null }>({ open: false, editing: null })

    const load = async () => {
        try {
            setOpportunities(await listOpportunities(programId))
        } catch (e) {
            console.error('[market-linkage] load failed', e)
            message.error('Could not load opportunities.')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        setLoading(true)
        load()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [programId])

    const [sort, setSort] = useState<OpportunitySort>('closing')
    const [area, setArea] = useState<'opportunities' | 'contracts'>('opportunities')
    const visible = useMemo(
        () => opportunities.filter(o => o.status === statusFilter).sort(SORTERS[sort]),
        [opportunities, statusFilter, sort]
    )

    useEffect(() => {
        if (isMobile) return
        if (!visible.some(o => o.id === selectedId)) setSelectedId(visible[0]?.id)
    }, [visible, selectedId, isMobile])

    const selected = opportunities.find(o => o.id === selectedId)
    const open = opportunities.filter(o => o.status === 'open')
    const weekAhead = dayjs().add(7, 'day').endOf('day')
    const closingSoon = open.filter(o => o.closingDate && dayjs(o.closingDate).isBefore(weekAhead) && dayjs(o.closingDate).isAfter(dayjs().startOf('day'))).length
    const invited = opportunities.reduce((sum, o) => sum + o.invitedCount, 0)
    const eligible = open.reduce((sum, o) => sum + (o.matchSummary?.eligible || 0), 0)

    const rise = (delay: number) =>
        reduceMotion ? {} : { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.3, ease: 'easeOut' as const, delay } }

    const select = (o: Opportunity) => {
        setSelectedId(o.id)
        if (isMobile) setDrawerOpen(true)
    }

    const detail = selected ? (
        <OpportunityDetail opportunity={selected} onEdit={() => setForm({ open: true, editing: selected })} onChanged={load} />
    ) : null

    const tiles = [
        { title: 'Open opportunities', value: open.length, icon: <ShopOutlined />, tone: 'accent' as const },
        { title: 'Closing this week', value: closingSoon, icon: <ClockCircleOutlined />, tone: 'warning' as const },
        { title: 'Eligible matches', value: eligible, icon: <TrophyOutlined />, tone: 'success' as const },
        { title: 'SMEs invited', value: invited, icon: <SendOutlined />, tone: 'info' as const }
    ]

    return (
        <div className='ws-page'>
            <Helmet>
                <title>Market Linkage</title>
            </Helmet>

            <Segmented
                className='mlx-area'
                value={area}
                onChange={v => setArea(v as 'opportunities' | 'contracts')}
                options={[
                    { value: 'opportunities', label: 'Opportunities', icon: <ShopOutlined /> },
                    { value: 'contracts', label: 'Contracts', icon: <FileDoneOutlined /> }
                ]}
            />

            {area === 'contracts' ? (
                <ContractsView programId={programId} />
            ) : (
            <>
            <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
                {tiles.map((t, i) => (
                    <Col key={t.title} xs={12} lg={6}>
                        <motion.div {...rise(i * 0.05)}>
                            <MetricTile icon={t.icon} tone={t.tone} title={t.title} value={t.value} loading={loading} compact={isMobile} />
                        </motion.div>
                    </Col>
                ))}
            </Row>

            <motion.div className='mlx-bar' {...rise(0.2)}>
                <Segmented
                    value={statusFilter}
                    onChange={v => setStatusFilter(v as 'open' | 'closed')}
                    options={[
                        { value: 'open', label: `Open (${open.length})` },
                        { value: 'closed', label: `Closed (${opportunities.length - open.length})` }
                    ]}
                />
                <Button type='primary' icon={<PlusOutlined />} onClick={() => setForm({ open: true, editing: null })}>
                    New opportunity
                </Button>
            </motion.div>

            <div className='ws-layout'>
                <MotionCard loading={loading} skeleton='list' skeletonRows={5}>
                    <SortSelect value={sort} options={SORT_OPTIONS} onChange={setSort} label='Sort opportunities' />
                    {visible.length === 0 ? (
                        <Empty
                            className='ws-list-empty'
                            description={statusFilter === 'open' ? 'No open opportunities. Capture one from an RFQ or tender.' : 'No closed opportunities'}
                        />
                    ) : (
                        <div className='ws-rows' role='listbox' aria-label='Opportunities'>
                            {visible.map((o, index) => (
                                <motion.button
                                    key={o.id}
                                    initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.24, ease: 'easeOut', delay: Math.min(index * 0.035, 0.3) }}
                                    type='button'
                                    role='option'
                                    aria-selected={o.id === selectedId}
                                    className={`ws-row${o.id === selectedId ? ' is-selected' : ''}`}
                                    onClick={() => select(o)}
                                >
                                    <div className='ws-row-main'>
                                        <div className='ws-row-name'>{o.title}</div>
                                        <div className='ws-row-meta'>{[o.buyer, closingLabel(o.closingDate)].filter(Boolean).join(' · ')}</div>
                                    </div>
                                    <div className='ws-row-side'>
                                        {o.matchSummary ? (
                                            <Tag color={o.matchSummary.eligible ? 'success' : 'default'} bordered={false}>
                                                {o.matchSummary.eligible} eligible
                                            </Tag>
                                        ) : (
                                            <Tag bordered={false}>Not matched</Tag>
                                        )}
                                    </div>
                                </motion.button>
                            ))}
                        </div>
                    )}
                </MotionCard>

                {!isMobile && (
                    <div className='ws-detail-sticky'>
                        {detail || (
                            <MotionCard loading={loading} skeleton='text' skeletonRows={8}>
                                <Empty className='ws-detail-empty' description='Select an opportunity' />
                            </MotionCard>
                        )}
                    </div>
                )}
            </div>

            {isMobile && (
                // A bottom sheet, like the app's other phone drawers (ResponsiveSheet).
                <Drawer
                    className='ws-drawer'
                    rootClassName='modal-style-drawer mlx-sheet'
                    open={drawerOpen && !!selected}
                    onClose={() => setDrawerOpen(false)}
                    placement='bottom'
                    height='92dvh'
                    title='Opportunity'
                >
                    {detail}
                </Drawer>
            )}
            </>
            )}

            <OpportunityForm
                open={form.open}
                editing={form.editing}
                uid={String((user as any)?.uid || (user as any)?.id || '')}
                programId={programId === 'all' ? null : programId}
                onClose={() => setForm({ open: false, editing: null })}
                onSaved={async id => {
                    setForm({ open: false, editing: null })
                    setStatusFilter('open')
                    await load()
                    setSelectedId(id)
                }}
            />
        </div>
    )
}

export default MarketLinkagePage
