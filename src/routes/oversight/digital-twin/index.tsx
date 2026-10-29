import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Avatar, Button, Card, Collapse, List, Modal, Empty, Input, Result, Segmented, Select, Space, Spin, Table, Tag, Typography } from 'antd'
import { ArrowLeftOutlined, ArrowRightOutlined, CalendarOutlined, CheckCircleOutlined, ExperimentOutlined, FundProjectionScreenOutlined, LoginOutlined, PlayCircleOutlined } from '@ant-design/icons'
import { doc, getDoc } from 'firebase/firestore'
import { useSearchParams } from 'react-router-dom'
import { Helmet } from 'react-helmet'
import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import { useDepartmentRoles } from '@/services/departmentRoles'
import { buildProcessTwin, millis, twinAccess, type TwinItem, type TwinRow } from '@/services/digitalTwin/processTwin'
import { useProcessTwin } from './useProcessTwin'
import { processGroups } from './ProcessMap'
import { JourneyMap } from './JourneyMap'
import { InterventionDetail, RemindFooter } from './InterventionDetail'
import { AttentionSummary } from './AttentionSummary'
import { TwinOverview } from './TwinOverview'
import { HistoryPlayback } from './HistoryPlayback'
import { ScenarioPanel } from './ScenarioPanel'
import { ScenarioProvider } from './ScenarioState'
import { usePageGuides, type PageGuideRegistration } from '@/components/guide-me'
import { buildTwinGuides } from './twinGuides'
import './process-twin.css'

const { Title, Text, Paragraph } = Typography
const initials = (name: string) => name.replace(/\[DEMO\]/g, '').trim().split(/\s+/).slice(0, 2).map(word => word[0]).join('').toUpperCase()
const pretty = (value: string) => value.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
const dateLabel = (value: number | null) => value === null ? 'Stage date unavailable' : formatDate(new Date(value))
const formatDate = (value: any) => { const at = millis(value); return at === null ? 'Not recorded' : new Date(at).toLocaleString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' }) }

export default function ProcessTwinPage() {
    const { user, loading: identityLoading } = useFullIdentity()
    const reducedMotion = useReducedMotion()
    const [listPage, setListPage] = useState(1)
    const [direction, setDirection] = useState(1)
    const { roleOf, nameOf } = useDepartmentRoles()
    const departmentRole = roleOf((user as any)?.departmentId)
    const access = useMemo(() => twinAccess(user, departmentRole), [user, departmentRole])
    const { activeProgramId } = useActiveProgramId()
    const [params, setParams] = useSearchParams()
    const [programme, setProgramme] = useState<{ key: string; row: TwinRow | null; error: string }>({ key: '', row: null, error: '' })
    // The open tab lives in the URL so refresh, back and shared links return to it.
    type TwinView = 'overview' | 'current' | 'history' | 'scenarios'
    const rawView = params.get('view')
    const view: TwinView = rawView === 'current' || rawView === 'history' || rawView === 'scenarios' ? rawView : 'overview'
    const paramsRef = useRef(params), setParamsRef = useRef(setParams)
    paramsRef.current = params; setParamsRef.current = setParams
    const setView = useCallback((next: TwinView) => {
        const query = new URLSearchParams(paramsRef.current)
        if (next === 'overview') query.delete('view'); else query.set('view', next)
        setParamsRef.current(query, { replace: true })
    }, [])
    const [qualityOpen, setQualityOpen] = useState(false)
    const guideRegistration = useMemo<PageGuideRegistration>(() => ({ pageId: 'digital-twin', pageTitle: 'Intervention Twin', guides: buildTwinGuides(setView) }), [])
    usePageGuides(guideRegistration)
    const identityKey = [user?.uid, access.allowed, access.branchId, activeProgramId].join(':')
    const previousProgram = useRef(activeProgramId)
    useEffect(() => {
        const next = new URLSearchParams(params)
        next.delete('program'); next.delete('clock')
        if (previousProgram.current !== activeProgramId) { next.delete('branch'); next.delete('department'); previousProgram.current = activeProgramId }
        if (next.toString() !== params.toString()) setParams(next, { replace: true })
    }, [activeProgramId, params, setParams])
    useEffect(() => {
        let active = true
        setProgramme({ key: '', row: null, error: '' })
        if (!access.allowed || !activeProgramId) return
        getDoc(doc(db, 'programs', activeProgramId)).then(snapshot => {
            if (!active) return
            const row = snapshot.exists() ? { ...snapshot.data(), id: snapshot.id } as TwinRow : null
            const branchId = typeof row?.assignedBranch === 'string' ? row.assignedBranch : row?.assignedBranch?.id || row?.branchId
            if (!row || (access.centreOnly && branchId !== access.branchId)) setProgramme({ key: identityKey, row: null, error: 'The programme selected in the universal filter is outside your centre or no longer available.' })
            else setProgramme({ key: identityKey, row, error: '' })
        }).catch(() => { if (active) setProgramme({ key: identityKey, row: null, error: 'The selected programme could not be read. Check your access and connection.' }) })
        return () => { active = false }
    }, [identityKey, activeProgramId, access.allowed, access.centreOnly, access.branchId])
    const program = programme.key === identityKey ? programme.row : null
    const branch = access.centreOnly ? access.branchId : params.get('branch') || ''
    const department = params.get('department') || 'all'
    const data = useProcessTwin(program?.id || '', access.allowed && !!program, branch)
    const [clock, setClock] = useState(Date.now())
    useEffect(() => { const timer = window.setInterval(() => setClock(Date.now()), 60_000); return () => clearInterval(timer) }, [])
    const model = useMemo(() => buildProcessTwin(data.sources, { programId: program?.id || '', branchId: branch, department }, clock), [data.sources, program?.id, branch, department, clock])
    const [selected, setSelected] = useState<string | null>(null), [detailKey, setDetailKey] = useState<string | null>(null), [search, setSearch] = useState('')
    useEffect(() => { setSelected(null); setDetailKey(null); setSearch(''); setListPage(1) }, [activeProgramId, branch, department])
    const groups = useMemo(() => processGroups(model, clock), [model, clock])
    const stage = groups.find(g => g.id === selected)
    const detail = model.items.find(i => i.key === detailKey)
    const details = detail ? model.assignments.find(a => a.id === detail.assignmentId) : undefined
    const relatedAppointments = model.appointments.filter(a => a.assignedInterventionId === detail?.assignmentId)
    const relatedVisits = model.inquiries.filter(a => a.assignedInterventionId === detail?.assignmentId)
    const relatedAssessments = model.assessments.filter(a => a.assignedInterventionId === detail?.assignmentId)
    const pack = detail?.collection === 'movDocuments' ? model.packIndex.get(detail.id) : undefined
    const change = (name: string, value: string) => { const next = new URLSearchParams(params); if (value) next.set(name, value); else next.delete(name); if (name === 'branch') next.delete('department'); setParams(next, { replace: true }) }
    const departments = [...new Set(data.sources.assignedInterventions.filter(a => !branch || a.branchId === branch).map(a => String(a.departmentId || '')))].filter(Boolean).map(id => ({ value: id, label: nameOf(id) })).sort((a, b) => a.label.localeCompare(b.label))
    const branches = [...new Set(data.sources.assignedInterventions.map(a => String(a.branchId || '')))].filter(Boolean).map(id => ({ value: id, label: program?.assignedBranch?.id === id ? program.assignedBranch.name : data.sources.assignedInterventions.find(a => a.branchId === id)?.branchName || 'Centre (name unavailable)' }))
    const ready = !!program && !data.loading && !data.error
    const ageLabel = (item: TwinItem) => item.enteredAt === null ? 'Start date not recorded' : item.enteredAt > clock ? 'Future timestamp' : Math.floor((clock - item.enteredAt) / 86400000) + ' days'
    const inspect = (id: string) => { setDirection(1); setDetailKey('assignedInterventions/' + id) }
    const scopeText = [program?.name || program?.programName || 'Programme', branch ? (branches.find(b => b.value === branch)?.label || 'One centre') : 'All centres', department === 'all' ? 'All departments' : nameOf(department)].join('  ·  ')
    const scopeLabel = [program?.name || program?.programName || 'Programme', branch || 'All centres', department === 'all' ? department : nameOf(department)].join(' / ')
    if (identityLoading) return <Spin><div style={{ height: 120 }} /></Spin>
    if (!access.allowed) return <Result status="403" title="Intervention Twin is not available for this account" subTitle="Access requires a project admin with an assigned centre, ROM, M&E or system administrator." />
    return <div className="process-twin">
        <Helmet><title>Intervention Twin | Lepharo</title></Helmet>
        {!activeProgramId ? <Empty description="Choose one programme in the universal programme filter above to explore its twin." /> : <>
            {programme.key === identityKey && programme.error && <Alert type="error" showIcon message={programme.error} />}
            {programme.key !== identityKey && <Spin tip="Connecting programme"><div style={{ height: 120 }} /></Spin>}
            {data.error && <Alert type="error" showIcon message={data.error} />}
            {program && data.loading && !data.error && <Spin tip="Connecting process records"><div style={{ height: 120 }} /></Spin>}
            {ready && <>
                {view !== 'overview' && view !== 'scenarios' && <div className="twin-bar">
                    <Button shape="round" icon={<ArrowLeftOutlined />} onClick={() => setView('overview')}>Overview</Button>
                    <strong className="twin-bar-title">{{ current: 'Current state', history: 'History', scenarios: 'Scenarios' }[view]}</strong>
                    <div className="twin-status" aria-label="Data status">
                        <span className="twin-chip"><i className={data.cached ? 'cached' : ''} />{data.cached ? 'Cached, may be stale' : 'Live records'}</span>
                        {model.syntheticCount > 0 && <span className="twin-chip synthetic">Synthetic data</span>}
                        <span className="twin-chip plain">Updated {data.updatedAt ? new Date(data.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}</span>
                        {(model.issues.length > 0 || model.unknownAge > 0) && <button type="button" className="twin-chip warn" onClick={() => setQualityOpen(true)}>{model.issues.length + model.unknownAge} records need attention</button>}
                    </div>
                    <div className="twin-filters">
                        {!access.centreOnly && branches.length > 1 && <Select aria-label="Twin centre" value={branch} onChange={value => change('branch', value)} options={[{ value: '', label: 'All centres' }, ...branches]} />}
                        <Select aria-label="Twin department" value={department} onChange={value => change('department', value)} options={[{ value: 'all', label: 'All departments' }, ...departments]} />
                    </div>
                </div>}
                <div key={[identityKey, branch, department].join(':')}>
                    <ScenarioProvider model={model} scope={scopeLabel}>
                    <div hidden={view !== 'overview' && view !== 'scenarios'}><TwinOverview model={model} clock={clock} onInspect={key => { setSelected(null); setDirection(1); setDetailKey(key) }} onNavigate={setView} /></div>
                    <div hidden={view !== 'current'}><JourneyMap model={model} clock={clock} onSelect={id => { setSelected(id); setSearch(''); setListPage(1) }} />
                    </div>
                    <div hidden={view !== 'history'}><HistoryPlayback model={model} authored={data.sources.syntheticHistory} active={view === 'history'} /></div>
                    <Modal className="sc-settings-modal twin-projection-modal" open={view === 'scenarios'} onCancel={() => setView('overview')} footer={null} width={1180} centered destroyOnClose={false}
                        title={<div className="sc-modal-title"><div><strong>Projection</strong><span>Turn the dials and watch the backlog change. The dials are the same ones on the scene.</span></div></div>}>
                        <ScenarioPanel model={model} scope={scopeLabel} />
                    </Modal>
                    </ScenarioProvider>
                </div>
            </>}
        </>}
        <Modal title="Records that need attention" open={ready && qualityOpen} onCancel={() => setQualityOpen(false)} footer={null} width={720}>
            <AttentionSummary issues={model.issues} unknownAge={model.unknownAge} missingByStage={groups.map(g => ({ id: g.id, label: g.label, missing: g.items.filter(i => i.owner !== 'None' && i.enteredAt === null).length })).filter(g => g.missing > 0)} onInspect={id => { setQualityOpen(false); setSelected(id); setSearch(''); setListPage(1) }} />
        </Modal>
        <Modal title={detail ? 'Intervention details' : stage?.label || 'Stage records'} open={ready && (!!stage || !!detail)} onCancel={() => { setSelected(null); setDetailKey(null) }} width={detail ? 760 : 1040} footer={detail ? <RemindFooter item={detail} pack={pack} /> : null} className="twin-record-modal" styles={{ body: { overflow: 'hidden' } }}>
            <AnimatePresence initial={false} mode="wait" custom={direction}>
                <motion.div key={detail ? 'details' : 'list'} custom={direction} variants={{ enter: (d: number) => ({ opacity: 0, x: reducedMotion ? 0 : d * 28 }), visible: { opacity: 1, x: 0 }, leave: (d: number) => ({ opacity: 0, x: reducedMotion ? 0 : -d * 28 }) }} initial="enter" animate="visible" exit="leave" transition={{ duration: reducedMotion ? 0 : .18, ease: 'easeInOut' }} style={{ maxHeight: '70vh', overflowY: 'auto', overflowX: 'hidden' }} tabIndex={-1} onAnimationComplete={definition => { if (definition === 'visible') { const panel = document.querySelector<HTMLElement>('.twin-record-modal .twin-modal-panel'); panel?.focus({ preventScroll: true }) } }} className="twin-modal-panel">
                    {!detail ? <>
                        <Input.Search aria-label="Search stage records" placeholder="Find an SME or intervention" value={search} onChange={e => { setSearch(e.target.value); setListPage(1) }} allowClear style={{ marginBottom: 16 }} />
                        <List className="twin-record-list" split={false} dataSource={stage?.items.filter(i => (i.participant + ' ' + i.title).toLowerCase().includes(search.toLowerCase())) || []} pagination={{ pageSize: 8, current: listPage, onChange: setListPage, showSizeChanger: false }} locale={{ emptyText: 'No matching interventions' }} renderItem={i => <List.Item><article className="twin-record-card">
                            <div className="twin-record-person"><Avatar size={44}>{initials(i.participant)}</Avatar><div><Text strong>{i.participant}</Text><div className="twin-record-subtitle">{i.title}</div></div></div>
                            <Space wrap><Tag color="blue">{i.state}</Tag></Space>
                            <div className="twin-record-facts"><div><span>Who needs to act</span><strong>{i.owner === 'None' ? 'No pending action' : i.owner}</strong></div><div><span>Stage started</span><strong>{dateLabel(i.enteredAt)}</strong></div>{i.owner !== 'None' && i.enteredAt !== null && <div><span>Waiting time</span><strong>{ageLabel(i)}</strong></div>}</div>
                            <Button shape="circle" icon={<ArrowRightOutlined />} aria-label="View details" title="View details" onClick={() => { setDirection(1); setDetailKey(i.key) }} />
                        </article></List.Item>} />
                    </> : <>
                        {stage && <Button type="text" size="small" onClick={() => { setDirection(-1); setDetailKey(null) }} style={{ marginBottom: 6 }}>← Back to stage list</Button>}
                        <InterventionDetail item={detail} clock={clock} assignment={details} pack={pack} appointments={relatedAppointments} visits={relatedVisits} assessments={relatedAssessments} sessions={model.sessions} />
                    </>}
                </motion.div>
            </AnimatePresence>
        </Modal>
    </div>
}
