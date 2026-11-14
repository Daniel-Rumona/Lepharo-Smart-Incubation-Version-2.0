import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Alert, Button, Col, Drawer, Empty, Input, Row, Segmented, Select, Spin, message } from 'antd'
import {
    CheckCircleFilled, ClockCircleOutlined, GlobalOutlined, PlusOutlined, SearchOutlined, TrophyOutlined
} from '@ant-design/icons'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useIsMobile } from '@/hooks/useIsMobile'
import { branchService } from '@/services/branchService'
import { departmentService } from '@/services/departmentService'
import { listProposalContributors, listenToProposals } from '@/services/proposalService'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { MetricTile } from '@/components/dashboards/metrics/MetricTile'
import { PROPOSAL_STAGE_GROUPS } from '@/types/proposal'
import type { Proposal, ProposalContributor, ProposalReference, ProposalStatus } from '@/types/proposal'
import { ProposalDetail } from './ProposalDetail'
import { ProposalFormModal } from './ProposalFormModal'
import { ProposalList, type ProposalSort } from './ProposalList'
import { ProposalActivationModal, ProposalStatusModal } from './ProposalModals'
import {
    PREPARATION_STATUSES, actorFromIdentity, datePickerValue, deadlineState, money, moneyCompact
} from './proposalUi'
import './proposal-pipeline.css'

// Not yet decided by the client; and accepted at any stage from then on.
const OPEN_STATUSES: ProposalStatus[] = ['Draft', 'In preparation', 'Submitted', 'Under review']
const WON_STATUSES: ProposalStatus[] = [
    'Accepted', 'SLA signed', 'Awaiting order number', 'Implementation planning', 'Ready for activation', 'Active'
]

// Shorter stage names so every segment fits on one line.
const STAGE_SHORT_LABELS: Record<string, string> = { 'Under review': 'Review' }

const millis = (value: any) =>
    value?.toMillis?.() || value?.toDate?.()?.getTime?.() || (value ? new Date(value).getTime() : 0)

// Deadline sort: proposals still being prepared come first by deadline; the
// rest, and those without one, follow by most recent update.
const deadlineRank = (proposal: Proposal) => {
    const deadline = datePickerValue(proposal.submissionDeadline)
    return PREPARATION_STATUSES.includes(proposal.status) && deadline?.isValid()
        ? deadline.valueOf()
        : Number.MAX_SAFE_INTEGER
}

const SORTERS: Record<ProposalSort, (a: Proposal, b: Proposal) => number> = {
    updated: (a, b) => millis(b.updatedAt || b.createdAt) - millis(a.updatedAt || a.createdAt),
    deadline: (a, b) => deadlineRank(a) - deadlineRank(b) || SORTERS.updated(a, b),
    value: (a, b) => Number(b.estimatedValue || 0) - Number(a.estimatedValue || 0)
}

export default function ProposalPipeline() {
    const { user, actor: signedInActor, loading: identityLoading } = useFullIdentity()
    // Writes are attributed to the signed-in person; what the page lists follows
    // the viewed user, so "view as" shows what that person would see.
    const actor = useMemo(() => actorFromIdentity(signedInActor), [signedInActor])
    const viewer = useMemo(() => actorFromIdentity(user), [user])
    const isIncubatee = ['incubatee', 'training_sme'].includes(viewer?.role?.trim().toLowerCase() || '')
    const isMobile = useIsMobile()
    const [proposals, setProposals] = useState<Proposal[]>([])
    const [branches, setBranches] = useState<ProposalReference[]>([])
    const [departments, setDepartments] = useState<ProposalReference[]>([])
    const [people, setPeople] = useState<ProposalContributor[]>([])
    const [loading, setLoading] = useState(true)
    const [referenceWarning, setReferenceWarning] = useState('')
    const [selectedId, setSelectedId] = useState<string>()
    const [drawerOpen, setDrawerOpen] = useState(false)
    const [formOpen, setFormOpen] = useState(false)
    const [editingProposal, setEditingProposal] = useState<Proposal | null>(null)
    const [statusProposal, setStatusProposal] = useState<Proposal | null>(null)
    const [activationOpen, setActivationOpen] = useState(false)
    const [search, setSearch] = useState('')
    const [statusFilter, setStatusFilter] = useState<string>('All')
    const [sort, setSort] = useState<ProposalSort>('updated')

    useEffect(() => {
        if (!viewer || isIncubatee) {
            setProposals([])
            setLoading(false)
            return
        }
        setLoading(true)
        return listenToProposals(
            viewer,
            records => {
                setProposals(records)
                setLoading(false)
            },
            error => {
                console.error('[ProposalPipeline] Failed to load proposals', error)
                message.error('Could not load the proposal pipeline.')
                setLoading(false)
            }
        )
    }, [viewer, isIncubatee])

    useEffect(() => {
        if (!viewer || isIncubatee) return
        Promise.all([
            branchService.getAllBranches(),
            departmentService.getAllDepartments(),
            listProposalContributors()
        ]).then(([branchRecords, departmentRecords, contributorRecords]) => {
            setBranches(branchRecords.map(branch => ({
                id: branch.id,
                name: branch.name,
                province: branch.location?.province || null
            })))
            setDepartments(departmentRecords.map(department => ({
                id: department.id, name: department.name
            })))
            setPeople(contributorRecords)
        }).catch(error => {
            console.error('[ProposalPipeline] Reference data load failed', error)
            setReferenceWarning('Centres or departments could not be loaded. Existing proposals remain available.')
        })
    }, [viewer, isIncubatee])

    // Archived proposals are kept out of the metrics, stages and "All", and are
    // listed only under the Archived filter so they can be restored.
    const liveProposals = useMemo(() => proposals.filter(item => !item.isArchived), [proposals])

    const visibleProposals = useMemo(() => {
        const queryText = search.trim().toLowerCase()
        const stage = PROPOSAL_STAGE_GROUPS.find(group => group.label === statusFilter)
        const source = statusFilter === 'Archived' ? proposals.filter(item => item.isArchived) : liveProposals
        return source.filter(proposal => {
            const matchesQuery = !queryText ||
                `${proposal.proposalNumber} ${proposal.title} ${proposal.clientName} ${proposal.owner.name}`
                    .toLowerCase().includes(queryText)
            const stageMatches = ['All', 'Archived'].includes(statusFilter) ||
                (stage ? stage.statuses.includes(proposal.status) : proposal.status === statusFilter)
            return matchesQuery && stageMatches
        }).sort(SORTERS[sort])
    }, [proposals, liveProposals, search, statusFilter, sort])

    // Four numbers the stage filter can't show: what is still open, what was
    // won, how often decided proposals are won, and which deadlines are close.
    const metrics = useMemo(() => {
        const sum = (items: Proposal[]) => items.reduce((total, item) => total + Number(item.estimatedValue || 0), 0)
        const open = liveProposals.filter(item => OPEN_STATUSES.includes(item.status))
        const won = liveProposals.filter(item => WON_STATUSES.includes(item.status))
        const rejected = liveProposals.filter(item => item.status === 'Rejected').length
        const atRisk = liveProposals
            .map(deadlineState)
            .filter(state => state && state.tone !== 'later')
        return {
            openValue: sum(open),
            openCount: open.length,
            wonValue: sum(won),
            wonCount: won.length,
            decided: won.length + rejected,
            winRate: won.length + rejected ? Math.round((won.length / (won.length + rejected)) * 100) : null,
            atRisk: atRisk.length,
            overdue: atRisk.filter(state => state?.tone === 'overdue').length
        }
    }, [liveProposals])

    // Stage segments carry their counts; closed proposals sit in their own dropdown.
    const stageOptions = useMemo(() => [
        { label: `All ${liveProposals.length}`, value: 'All' },
        ...PROPOSAL_STAGE_GROUPS.map(group => ({
            label: `${STAGE_SHORT_LABELS[group.label] || group.label} ${
                liveProposals.filter(item => group.statuses.includes(item.status)).length}`,
            value: group.label
        }))
    ], [liveProposals])

    const closedOptions = useMemo(() => [
        { label: `Rejected (${liveProposals.filter(item => item.status === 'Rejected').length})`, value: 'Rejected' },
        { label: `Archived (${proposals.filter(item => item.isArchived).length})`, value: 'Archived' }
    ], [proposals, liveProposals])

    const isClosedFilter = ['Rejected', 'Archived'].includes(statusFilter)

    // The at-risk tile lists the proposals still in preparation, soonest deadline first.
    const showDeadlinesAtRisk = () => {
        setStatusFilter('Draft')
        setSearch('')
        setSort('deadline')
    }

    // The selected proposal always comes from the live list, so edits, uploads
    // and status moves show in the detail panel as soon as they are saved.
    const selected = proposals.find(item => item.id === selectedId) || null

    const select = (proposal: Proposal) => {
        setSelectedId(proposal.id)
        if (isMobile) setDrawerOpen(true)
    }

    // A proposal just created is selected, but only reaches the list once the
    // live listener delivers it; until then the selection is held for it.
    const [awaitingId, setAwaitingId] = useState<string>()

    const showSaved = (proposalId: string) => {
        if (!proposals.some(item => item.id === proposalId)) {
            setSearch('')
            setStatusFilter('All')
            setAwaitingId(proposalId)
        }
        setSelectedId(proposalId)
        if (isMobile) setDrawerOpen(true)
    }

    // On larger screens something is always selected: the first visible
    // proposal, whenever the current one is filtered out.
    useEffect(() => {
        if (awaitingId) {
            if (proposals.some(item => item.id === awaitingId)) setAwaitingId(undefined)
            return
        }
        if (isMobile) return
        if (!visibleProposals.some(item => item.id === selectedId)) setSelectedId(visibleProposals[0]?.id)
    }, [visibleProposals, proposals, selectedId, isMobile, awaitingId])

    // Notification links (bell, email, WhatsApp) open one proposal: /proposals?proposal=<id>.
    const [searchParams, setSearchParams] = useSearchParams()
    const linkedProposalId = searchParams.get('proposal')
    useEffect(() => {
        if (!linkedProposalId || loading) return
        const linked = proposals.find(item => item.id === linkedProposalId)
        if (linked) {
            setStatusFilter(linked.isArchived ? 'Archived' : 'All')
            setSearch('')
            select(linked)
        } else {
            message.info('That proposal is no longer in your pipeline.')
        }
        setSearchParams(params => {
            params.delete('proposal')
            return params
        }, { replace: true })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [linkedProposalId, loading, proposals])

    const openCreate = () => {
        setEditingProposal(null)
        setFormOpen(true)
    }

    const openEdit = (proposal: Proposal) => {
        setEditingProposal(proposal)
        setFormOpen(true)
    }

    if (identityLoading) {
        return <div className='proposal-page'><Spin spinning><div style={{ minHeight: 240 }} /></Spin></div>
    }

    if (isIncubatee) {
        return <div className='proposal-page'><Alert type='error' showIcon
            message='Access restricted'
            description='The proposals pipeline is not available to the incubatee role.' /></div>
    }

    if (!actor) {
        return <div className='proposal-page'><Alert type='warning' showIcon
            message='Organisation profile required'
            description='Your user profile must be loaded before proposals can be loaded or created.' /></div>
    }

    const detail = selected
        ? <ProposalDetail proposal={selected} actor={actor}
            onEdit={() => openEdit(selected)}
            onStatus={() => setStatusProposal(selected)}
            onActivation={() => setActivationOpen(true)} />
        : null

    return (
        <div className='proposal-page'>
            {referenceWarning && <Alert closable type='warning' showIcon
                message={referenceWarning} onClose={() => setReferenceWarning('')}
                style={{ marginBottom: 16 }} />}

            <Row gutter={[16, 16]} className='proposal-stat-row'>
                <Col xs={12} xl={6}>
                    <MetricTile
                        title='Open pipeline' mobileTitle='Open' value={(isMobile ? moneyCompact : money)(metrics.openValue)}
                        subtitle={`${metrics.openCount} proposal${metrics.openCount === 1 ? '' : 's'} not yet decided`}
                        icon={<GlobalOutlined />} tone='accent' compact={isMobile} />
                </Col>
                <Col xs={12} xl={6}>
                    <MetricTile
                        title='Won value' mobileTitle='Won' value={(isMobile ? moneyCompact : money)(metrics.wonValue)}
                        subtitle={`${metrics.wonCount} accepted`}
                        icon={<TrophyOutlined />} tone='success' compact={isMobile} />
                </Col>
                <Col xs={12} xl={6}>
                    <MetricTile
                        title='Win rate' value={metrics.winRate === null ? '–' : `${metrics.winRate}%`}
                        subtitle={metrics.decided
                            ? `Of ${metrics.decided} decided by the client`
                            : 'No client decisions yet'}
                        icon={<CheckCircleFilled />} tone='info' compact={isMobile} />
                </Col>
                <Col xs={12} xl={6}>
                    <MetricTile
                        title='Deadlines at risk' mobileTitle='At risk' value={metrics.atRisk}
                        subtitle={metrics.overdue
                            ? `${metrics.overdue} overdue · due within 7 days`
                            : 'Due within 7 days'}
                        icon={<ClockCircleOutlined />}
                        tone={metrics.overdue ? 'danger' : metrics.atRisk ? 'warning' : 'neutral'}
                        compact={isMobile}
                        onClick={metrics.atRisk ? showDeadlinesAtRisk : undefined}
                        clickable={metrics.atRisk > 0} />
                </Col>
            </Row>

            <div className='ws-toolbar proposal-toolbar'>
                <Input allowClear prefix={<SearchOutlined />} placeholder='Search by title, number, client or owner'
                    value={search} onChange={event => setSearch(event.target.value)}
                    className='ws-toolbar-search' />
                <Segmented className='ws-toolbar-status proposal-stage-filter' block
                    aria-label='Filter by stage'
                    value={isClosedFilter ? '' : statusFilter}
                    onChange={value => setStatusFilter(String(value))}
                    options={stageOptions} />
                <Select className='proposal-closed-filter' placeholder='Closed' allowClear
                    aria-label='Show rejected or archived proposals'
                    value={isClosedFilter ? statusFilter : undefined}
                    onChange={value => setStatusFilter(value || 'All')}
                    options={closedOptions} />
                <Button type='primary' icon={<PlusOutlined />} onClick={openCreate}
                    className='ws-toolbar-button'>Submit proposal</Button>
            </div>

            <div className='ws-layout'>
                <ProposalList
                    proposals={visibleProposals}
                    loading={loading}
                    selectedId={selectedId}
                    onSelect={select}
                    sort={sort}
                    onSortChange={setSort}
                    resetKey={`${search}|${statusFilter}`}
                    emptyAction={liveProposals.length || statusFilter === 'Archived' ? undefined : openCreate} />

                {!isMobile && (
                    <div className='ws-detail-sticky'>
                        {detail || (
                            <MotionCard loading={loading} skeleton='text' skeletonRows={8}>
                                <Empty className='ws-detail-empty'
                                    description={liveProposals.length
                                        ? 'Select a proposal to see its details'
                                        : 'No proposals yet'} />
                            </MotionCard>
                        )}
                    </div>
                )}
            </div>

            {isMobile && (
                <Drawer className='ws-drawer' placement='right' width='100%'
                    open={drawerOpen && Boolean(selected)} onClose={() => setDrawerOpen(false)}
                    title={selected ? selected.proposalNumber : 'Proposal'}>
                    {detail}
                </Drawer>
            )}

            <ProposalFormModal open={formOpen} proposal={editingProposal} actor={actor}
                branches={branches} departments={departments} people={people}
                onClose={() => setFormOpen(false)} onSaved={showSaved} />

            <ProposalStatusModal proposal={statusProposal} actor={actor}
                onClose={() => setStatusProposal(null)} />

            <ProposalActivationModal proposal={selected} open={activationOpen}
                onClose={() => setActivationOpen(false)} />
        </div>
    )
}
