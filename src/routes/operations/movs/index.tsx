import React, { useEffect, useMemo, useState } from 'react'
import { Badge, Button, DatePicker, Drawer, Empty, Grid, Input, Popover, Segmented } from 'antd'
import { FilterOutlined, SearchOutlined, SendOutlined } from '@ant-design/icons'
import { Helmet } from 'react-helmet'
import { useSearchParams } from 'react-router-dom'
import dayjs, { Dayjs } from 'dayjs'
import { motion, useReducedMotion } from 'framer-motion'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { DashboardFilterBar, MotionCard } from '@/components/dashboards/metrics/Header'
import { ChoiceFilter, FilterPanel } from '@/components/workspace'
import { usePageGuides } from '@/components/guide-me'
import {
    PACK_STAGE_META,
    monthLabel,
    packInvoice,
    packItems,
    packStage,
    resolveMovCompletionDate,
    resolveMovDueMonth,
    safeToDate,
    type Mov,
    type MovStatus,
    type Pack,
    type PackStage
} from './movData'
import { useMovWorkspace } from './useMovWorkspace'
import { MovList, type MovSort } from './MovList'
import { MovDetail } from './MovDetail'
import { PackDetail, PackList } from './PackViews'
import { SubmitMonthModal } from './SubmitMonthModal'
import { MOV_GUIDES } from './movGuides'
import { ROLE_CONFIG, type MovRole } from './roles'
import './movs.css'

const { useBreakpoint } = Grid
const { RangePicker } = DatePicker

type View = 'movs' | 'packs'
type MovFilter = MovStatus | 'all'
type PackFilter = PackStage | 'all'

const MOV_SEGMENTS: { value: MovFilter; label: string; tone: string }[] = [
    { value: 'disputed', label: 'Disputes', tone: 'danger' },
    { value: 'review', label: 'To review', tone: 'info' },
    { value: 'queried', label: 'Queried', tone: 'warning' },
    { value: 'approved', label: 'Approved', tone: 'success' },
    { value: 'all', label: 'All', tone: 'neutral' }
]
const PACK_SEGMENTS: { value: PackFilter; label: string; tone: string }[] = [
    { value: 'all', label: 'All', tone: 'neutral' },
    { value: 'cc', label: PACK_STAGE_META.cc.label, tone: 'info' },
    { value: 'me', label: PACK_STAGE_META.me.label, tone: 'warning' },
    { value: 'verified', label: PACK_STAGE_META.verified.label, tone: 'success' }
]

const clean = (v: unknown) => String(v ?? '').trim()

/** The HOD's guided tours point at the HOD's controls. */
const HodGuides = () => {
    usePageGuides(MOV_GUIDES)
    return null
}

/**
 * The one MOV workspace, for every role (see roles.ts). The same list beside
 * a detail panel, status strip, search and filters; the role decides what's
 * listed and what can be done:
 *   facilitator  their MOVs: add evidence, answer queries
 *   hod          review each MOV beside its confirmation sheet (approve, query,
 *                decide disputes), submit a month's approved MOVs as a pack
 *   cc / me      the programme's monthly packs: query, confirm (CC) or check and validate (M&E)
 */
export const MovWorkspacePage: React.FC<{ role?: MovRole }> = ({ role = 'hod' }) => {
    const cfg = ROLE_CONFIG[role]
    const { user } = useFullIdentity()
    const { activeProgramId } = useActiveProgramId()
    const isPhone = !useBreakpoint().md
    const reduceMotion = useReducedMotion()
    const isHOD = role === 'hod' && clean((user as any)?.role).toLowerCase() === 'operations'
    const hasDepartment = !!clean((user as any)?.departmentId)

    const ws = useMovWorkspace(user as any, activeProgramId, role)

    const [view, setView] = useState<View>(cfg.views[0])
    const [search, setSearch] = useState('')
    const [status, setStatus] = useState<MovFilter>(cfg.firstMovStatus)
    const [packDepartment, setPackDepartment] = useState('all')
    const [facilitator, setFacilitator] = useState('all')
    const [dueMonth, setDueMonth] = useState('all')
    const [ended, setEnded] = useState<[Dayjs, Dayjs] | null>(null)
    const [sort, setSort] = useState<MovSort>('ended')
    const [packFilter, setPackFilter] = useState<PackFilter>(cfg.firstPackStage)
    const [packSearch, setPackSearch] = useState('')
    const [packYear, setPackYear] = useState('all')
    const [packInvoiceFilter, setPackInvoiceFilter] = useState('all')
    const [packQueries, setPackQueries] = useState('all')
    const [selectedMovId, setSelectedMovId] = useState<string | null>(null)
    const [selectedPackId, setSelectedPackId] = useState<string | null>(null)
    const [detailOpen, setDetailOpen] = useState(false)
    const [submitOpen, setSubmitOpen] = useState(false)
    // After a decision: the list order it was made in, so the next MOV can open.
    const [advanceFrom, setAdvanceFrom] = useState<{ ids: string[]; id: string } | null>(null)

    // ---- MOVs: filters, counts, order ----
    const matchesOthers = (m: Mov) => {
        const q = search.trim().toLowerCase()
        if (q && ![m.smmeCompanyName, m.smmeName, m.interventionTitle, m.facilitatorName].some(v => clean(v).toLowerCase().includes(q))) return false
        if (facilitator !== 'all' && clean(m.facilitatorName) !== facilitator) return false
        if (dueMonth !== 'all' && monthLabel(resolveMovDueMonth(m), 'MMM YYYY') !== dueMonth) return false
        if (ended) {
            const d = resolveMovCompletionDate(m)
            if (!d || dayjs(d).isBefore(ended[0].startOf('day')) || dayjs(d).isAfter(ended[1].endOf('day'))) return false
        }
        return true
    }
    const base = useMemo(() => ws.movs.filter(matchesOthers), [ws.movs, search, facilitator, dueMonth, ended]) // eslint-disable-line react-hooks/exhaustive-deps
    const counts = useMemo(() => {
        const c: Record<MovFilter, number> = { review: 0, queried: 0, approved: 0, disputed: 0, all: base.length }
        base.forEach(m => { c[ws.statusOf(m)] += 1 })
        return c
    }, [base, ws.statusOf])
    // A facilitator with nothing to answer starts on everything instead of an empty list.
    const [startedOn, setStartedOn] = useState(false)
    useEffect(() => {
        if (startedOn || !ws.loadedOnce) return
        setStartedOn(true)
        if (role === 'facilitator' && counts.queried === 0) setStatus('all')
    }, [ws.loadedOnce]) // eslint-disable-line react-hooks/exhaustive-deps
    const rows = useMemo(() => {
        const list = status === 'all' ? base : base.filter(m => ws.statusOf(m) === status)
        const time = (d: Date | null) => d?.getTime() || 0
        return [...list].sort((a, b) =>
            sort === 'company'
                ? clean(a.smmeCompanyName).localeCompare(clean(b.smmeCompanyName))
                : sort === 'due'
                    ? time(safeToDate(a.dueDate)) - time(safeToDate(b.dueDate))
                    : time(resolveMovCompletionDate(b)) - time(resolveMovCompletionDate(a))
        )
    }, [base, status, sort, ws.statusOf])

    const facilitators = useMemo(() => Array.from(new Set(ws.movs.map(m => clean(m.facilitatorName)).filter(Boolean))).sort(), [ws.movs])
    const dueMonths = useMemo(() => {
        const keys = Array.from(new Set(ws.movs.map(resolveMovDueMonth).filter(Boolean) as string[])).sort().reverse()
        return keys.map(k => monthLabel(k, 'MMM YYYY'))
    }, [ws.movs])
    const activeFilters = [facilitator !== 'all', dueMonth !== 'all', !!ended].filter(Boolean).length

    // Keep a selection: the next MOV after a decision, else the first one.
    useEffect(() => {
        if (advanceFrom) {
            const at = advanceFrom.ids.indexOf(advanceFrom.id)
            const order = [...advanceFrom.ids.slice(at + 1), ...advanceFrom.ids.slice(0, Math.max(at, 0))]
            const next = order.find(id => rows.some(r => r.id === id))
            setSelectedMovId(next || rows[0]?.id || null)
            if (!next && isPhone) setDetailOpen(false)
            setAdvanceFrom(null)
            return
        }
        if (!rows.length) setSelectedMovId(null)
        else if (!selectedMovId || !rows.some(r => r.id === selectedMovId)) setSelectedMovId(rows[0].id)
    }, [rows]) // eslint-disable-line react-hooks/exhaustive-deps

    const selectedMov = rows.find(r => r.id === selectedMovId) || null

    // Deep link from a notification: ?mov=<id> opens that MOV, whatever the filters.
    const [searchParams, setSearchParams] = useSearchParams()
    const linkedMovId = searchParams.get('mov')
    useEffect(() => {
        if (!linkedMovId || !ws.loadedOnce) return
        const target = ws.movs.find(m => m.id === linkedMovId)
        if (target) {
            setView('movs')
            setSearch('')
            setFacilitator('all')
            setDueMonth('all')
            setEnded(null)
            setStatus(ws.statusOf(target))
            setSelectedMovId(target.id)
            if (isPhone) setDetailOpen(true)
        }
        setSearchParams({}, { replace: true })
    }, [linkedMovId, ws.loadedOnce, ws.movs]) // eslint-disable-line react-hooks/exhaustive-deps

    // ---- packs ----
    // Search matches the month or an SME in the pack ("which pack did Iklwa's MOV go into?").
    const invoiceOf = (p: Pack) => (packInvoice(p) ? 'Attached' : 'Missing')
    const queriesOf = (p: Pack) => (ws.packQueryIndex[p.id]?.open ? 'Open' : 'None')
    const yearOf = (p: Pack) => String(p.month || '').slice(0, 4)
    const packBase = useMemo(() => {
        const q = packSearch.trim().toLowerCase()
        return ws.packs.filter(p =>
            (!q || [monthLabel(p.month), p.month, p.hodName, p.department, ...packItems(p).map(m => m.smmeCompanyName)].some(v => clean(v).toLowerCase().includes(q))) &&
            (packYear === 'all' || yearOf(p) === packYear) &&
            (packDepartment === 'all' || clean(p.department) === packDepartment) &&
            (packInvoiceFilter === 'all' || invoiceOf(p) === packInvoiceFilter) &&
            (packQueries === 'all' || queriesOf(p) === packQueries)
        )
    }, [ws.packs, ws.packQueryIndex, packSearch, packYear, packDepartment, packInvoiceFilter, packQueries]) // eslint-disable-line react-hooks/exhaustive-deps
    const packCounts = useMemo(() => {
        const c: Record<PackFilter, number> = { all: packBase.length, cc: 0, me: 0, verified: 0 }
        packBase.forEach(p => { c[packStage(p)] += 1 })
        return c
    }, [packBase])
    const packRows = useMemo(() => (packFilter === 'all' ? packBase : packBase.filter(p => packStage(p) === packFilter)), [packBase, packFilter])
    // A filter only shows when it has two or more options among these packs.
    const optionsOf = (f: (p: Pack) => string, order?: string[]) => {
        const values = Array.from(new Set(ws.packs.map(f).filter(Boolean)))
        if (values.length < 2) return []
        return order ? order.filter(v => values.includes(v)) : values.sort().reverse()
    }
    const packYears = optionsOf(yearOf)
    // The CC and M&E see every department's packs.
    const packDepartments = role === 'cc' || role === 'me' ? optionsOf(p => clean(p.department)).sort() : []
    const packInvoiceOptions = optionsOf(invoiceOf, ['Attached', 'Missing'])
    const packQueryOptions = optionsOf(queriesOf, ['Open', 'None'])
    const packFilterChoices = packYears.length + packDepartments.length + packInvoiceOptions.length + packQueryOptions.length
    const activePackFilters = [packYear !== 'all', packDepartment !== 'all', packInvoiceFilter !== 'all', packQueries !== 'all'].filter(Boolean).length
    useEffect(() => {
        if (!packRows.length) setSelectedPackId(null)
        else if (!selectedPackId || !packRows.some(p => p.id === selectedPackId)) setSelectedPackId(packRows[0].id)
    }, [packRows]) // eslint-disable-line react-hooks/exhaustive-deps
    const selectedPack = packRows.find(p => p.id === selectedPackId) || null

    const rise = (delay: number) =>
        reduceMotion ? {} : { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.3, ease: 'easeOut' as const, delay } }

    const loading = !ws.loadedOnce || (ws.loading && !ws.movs.length)

    const segments = <T extends string>(items: { value: T; label: string; tone: string }[], countsOf: Record<T, number>) =>
        items.map(s => ({
            value: s.value,
            label: (
                <span className='mv-seg'>
                    {s.label}
                    {!loading && <span className={`mv-seg-count qtx-tone-${s.tone}`}>{countsOf[s.value]}</span>}
                </span>
            )
        }))

    const filterPanel = (
        <FilterPanel
            canReset={activeFilters > 0}
            onReset={() => {
                setFacilitator('all')
                setDueMonth('all')
                setEnded(null)
            }}
        >
            {role !== 'facilitator' && <ChoiceFilter id='mv-facilitator' label='Facilitator' allLabel='All facilitators' value={facilitator} values={facilitators} onChange={setFacilitator} />}
            <ChoiceFilter id='mv-due' label='Due month' allLabel='Any month' value={dueMonth} values={dueMonths} onChange={setDueMonth} />
            <div>
                <label className='ws-filter-label' htmlFor='mv-ended'>Confirmed by SME</label>
                <RangePicker id='mv-ended' style={{ width: '100%' }} value={ended} onChange={v => setEnded(v?.[0] && v?.[1] ? [v[0], v[1]] : null)} format='D MMM YYYY' />
            </div>
        </FilterPanel>
    )

    const packFilterPanel = (
        <FilterPanel
            canReset={activePackFilters > 0}
            onReset={() => {
                setPackYear('all')
                setPackDepartment('all')
                setPackInvoiceFilter('all')
                setPackQueries('all')
            }}
        >
            <ChoiceFilter id='mv-pack-department' label='Department' allLabel='All departments' value={packDepartment} values={packDepartments} onChange={setPackDepartment} />
            <ChoiceFilter id='mv-pack-year' label='Year' allLabel='Any year' value={packYear} values={packYears} onChange={setPackYear} />
            <ChoiceFilter id='mv-pack-invoice' label='Invoice' allLabel='Any' value={packInvoiceFilter} values={packInvoiceOptions} onChange={setPackInvoiceFilter} />
            <ChoiceFilter id='mv-pack-queries' label='Open queries' allLabel='Any' value={packQueries} values={packQueryOptions} onChange={setPackQueries} />
        </FilterPanel>
    )

    const detail = view === 'movs'
        ? selectedMov && (
            <MovDetail
                mov={selectedMov}
                ws={ws}
                canApprove={isHOD}
                currentUid={(user as any)?.uid}
                activeProgramId={activeProgramId}
                onDecided={id => setAdvanceFrom({ ids: rows.map(r => r.id), id })}
                onReselect={id => {
                    setStatus('review')
                    setSelectedMovId(id)
                }}
            />
        )
        : selectedPack && <PackDetail pack={selectedPack} ws={ws} canEdit={isHOD && hasDepartment} currentUid={(user as any)?.uid} activeProgramId={activeProgramId} />

    const emptyMovs = status === cfg.firstMovStatus && !search && !activeFilters ? cfg.emptyMovs : 'No MOVs match these filters.'
    const segmentLabel = <T extends string>(labels: Partial<Record<string, string>>, s: { value: T; label: string; tone: string }) => ({ ...s, label: labels[s.value] || s.label })

    return (
        <div className='ws-page'>
            <Helmet>
                <title>MOVs | Smart Incubation</title>
            </Helmet>

            <motion.div {...rise(0)}>
                <DashboardFilterBar>
                    <div className='ws-toolbar' data-guide='mov-filter-bar'>
                        {/* Status first: what's waiting is the first thing to see; search and filters narrow it below. */}
                        {view === 'movs' ? (
                            <Segmented
                                className='ws-toolbar-status mv-status-strip'
                                block
                                value={status}
                                onChange={v => setStatus(v as MovFilter)}
                                // Disputes only appear when the HOD has one to decide.
                                options={segments(MOV_SEGMENTS.filter(s => s.value !== 'disputed' || counts.disputed > 0 || status === 'disputed').map(s => segmentLabel(cfg.movLabels, s)), counts)}
                                aria-label='Filter by status'
                            />
                        ) : (
                            <Segmented className='ws-toolbar-status mv-status-strip' block value={packFilter} onChange={v => setPackFilter(v as PackFilter)} options={segments(PACK_SEGMENTS.map(s => segmentLabel(cfg.packLabels, s)), packCounts)} aria-label='Filter by stage' />
                        )}
                        {cfg.views.length > 1 && <div data-guide='mov-view-switch' className='mv-view'>
                            <Segmented
                                value={view}
                                onChange={v => setView(v as View)}
                                options={[
                                    { label: 'MOVs', value: 'movs' },
                                    { label: <span data-guide='consolidated-movs-option'>Monthly packs</span>, value: 'packs' }
                                ]}
                                aria-label='View'
                            />
                        </div>}
                        {view === 'movs' ? (
                            <>
                                <Input
                                    className='ws-toolbar-search'
                                    allowClear
                                    prefix={<SearchOutlined />}
                                    placeholder={role === 'facilitator' ? 'Search SME or intervention' : 'Search SME, intervention or facilitator'}
                                    value={search}
                                    onChange={e => setSearch(e.target.value)}
                                    aria-label='Search MOVs'
                                />
                                <Popover content={filterPanel} trigger='click' placement='bottomLeft' title='Filters'>
                                    <Badge className='ws-toolbar-button' count={activeFilters} size='small' offset={[-6, 4]}>
                                        <Button block icon={<FilterOutlined />}>Filters</Button>
                                    </Badge>
                                </Popover>
                            </>
                        ) : (
                            <>
                                <Input
                                    className='ws-toolbar-search'
                                    allowClear
                                    prefix={<SearchOutlined />}
                                    placeholder={role === 'cc' || role === 'me' ? 'Search department, month or SME' : 'Search month or SME'}
                                    value={packSearch}
                                    onChange={e => setPackSearch(e.target.value)}
                                    aria-label='Search monthly packs'
                                />
                                {packFilterChoices > 0 && (
                                    <Popover content={packFilterPanel} trigger='click' placement='bottomLeft' title='Filters'>
                                        <Badge className='ws-toolbar-button' count={activePackFilters} size='small' offset={[-6, 4]}>
                                            <Button block icon={<FilterOutlined />}>Filters</Button>
                                        </Badge>
                                    </Popover>
                                )}
                            </>
                        )}
                        {isHOD && hasDepartment && (
                            <Button data-guide='submit-movs-action' className='ws-toolbar-button' type='primary' icon={<SendOutlined />} onClick={() => setSubmitOpen(true)}>
                                Submit a month
                            </Button>
                        )}
                    </div>
                </DashboardFilterBar>
            </motion.div>

            <div className='ws-layout'>
                {view === 'movs' ? (
                    <MovList
                        rows={rows}
                        loading={loading}
                        selectedId={selectedMov?.id || null}
                        onSelect={m => {
                            setSelectedMovId(m.id)
                            if (isPhone) setDetailOpen(true)
                        }}
                        sort={sort}
                        onSortChange={setSort}
                        queryIndex={ws.queryIndex}
                        packMonthOf={m => {
                            const packId = ws.packIndex.movToPack[m.id]
                            return packId ? ws.packs.find(p => p.id === packId)?.month || null : null
                        }}
                        lateTarget={m => (role === 'hod' && ws.isLate(m) ? ws.packMonthFor(m) : null)}
                        statusOf={ws.statusOf}
                        role={role}
                        resetKey={`${status}|${search}|${facilitator}|${dueMonth}|${ended?.map(d => d.valueOf()).join('-') || ''}`}
                        emptyText={emptyMovs}
                    />
                ) : (
                    <PackList
                        packs={packRows}
                        loading={loading}
                        selectedId={selectedPack?.id || null}
                        onSelect={(p: Pack) => {
                            setSelectedPackId(p.id)
                            if (isPhone) setDetailOpen(true)
                        }}
                        queryIndex={ws.packQueryIndex}
                        role={role}
                        emptyText={!activeProgramId && role !== 'hod' ? 'Choose a programme to see its monthly packs.' : !ws.packs.length ? cfg.emptyPacks : 'No packs match these filters.'}
                    />
                )}

                {!isPhone && (
                    <div className='ws-detail-sticky'>
                        {loading ? (
                            <MotionCard loading skeleton='text' skeletonRows={10}>{null}</MotionCard>
                        ) : detail || (
                            <MotionCard>
                                <Empty className='ws-detail-empty' description={view === 'movs' ? emptyMovs : 'Select a month to see its pack.'} />
                            </MotionCard>
                        )}
                    </div>
                )}
            </div>

            {isPhone && (
                <Drawer
                    className='ws-drawer ws-sheet'
                    open={detailOpen && !!detail}
                    onClose={() => setDetailOpen(false)}
                    placement='bottom'
                    height='92vh'
                    title={view === 'movs' ? selectedMov?.smmeCompanyName || 'MOV' : selectedPack ? `${monthLabel(selectedPack.month)} pack` : 'Pack'}
                >
                    {detail}
                </Drawer>
            )}

            {isHOD && <HodGuides />}
            {isHOD && <SubmitMonthModal open={submitOpen} onClose={() => setSubmitOpen(false)} ws={ws} hasDepartment={hasDepartment} />}
        </div>
    )
}

/** The HOD's MOVs (route /operations/movs). */
const MOVApprovalsForm: React.FC = () => <MovWorkspacePage role='hod' />

export default MOVApprovalsForm
