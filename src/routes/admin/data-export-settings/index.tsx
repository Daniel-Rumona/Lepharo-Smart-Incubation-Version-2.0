import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Col, Drawer, Empty, Input, Modal, Pagination, Row, Segmented, Spin, Switch, Tag, message } from 'antd'
import {
    CheckCircleOutlined,
    ClearOutlined,
    ClockCircleOutlined,
    DatabaseOutlined,
    SaveOutlined,
    SearchOutlined,
    SortAscendingOutlined,
    StopOutlined,
    TeamOutlined,
    TrophyOutlined,
    UndoOutlined
} from '@ant-design/icons'
import { Helmet } from 'react-helmet'
import { motion, useReducedMotion } from 'framer-motion'
import dayjs from 'dayjs'
import relativeTime from 'dayjs/plugin/relativeTime'
import { collection, doc, getDocs, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useIsMobile } from '@/hooks/useIsMobile'
import { DATASETS } from '@/routes/data-export/datasets'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { MetricTile, type MetricTone } from '@/components/dashboards/metrics/MetricTile'
import { EntityAvatar, SortSelect, type SortOption } from '@/components/workspace'
import './data-export-settings.css'

dayjs.extend(relativeTime)

/*
 * Which datasets each department may preview and export (dataExportSettings/{departmentId}),
 * in the Applications / Participants review layout: figures, toolbar, department list, and
 * the selected department's datasets beside it (a drawer on phones).
 */

type Department = { id: string; name: string; isActive?: boolean }
type Setting = { allowed: string[]; updatedAt: Date | null; updatedByName: string }
type StatusFilter = 'all' | 'with' | 'none'
type Sort = 'name' | 'most' | 'least' | 'recent'
type DatasetView = 'all' | 'allowed' | 'blocked'

const PAGE_SIZE = 12
const ALL_KEYS = DATASETS.map(d => d.key)
const GROUPS = Array.from(new Set(DATASETS.map(d => d.group)))

const SORT_OPTIONS: SortOption<Sort>[] = [
    { value: 'name', label: 'Name A–Z', icon: <SortAscendingOutlined /> },
    { value: 'most', label: 'Most access', icon: <TrophyOutlined /> },
    { value: 'least', label: 'Least access', icon: <StopOutlined /> },
    { value: 'recent', label: 'Recently changed', icon: <ClockCircleOutlined /> }
]

/** Only datasets that still exist count; old keys left in a saved list are ignored. */
const validKeys = (keys: string[]) => keys.filter(k => ALL_KEYS.includes(k))

/** The order of checked items must not affect whether Save is enabled. */
const sameSelection = (a: string[], b: string[]) => a.length === b.length && a.every(key => b.includes(key))

const DataExportSettingsPage: React.FC = () => {
    const { user, loading: identityLoading } = useFullIdentity()
    const isMobile = useIsMobile()
    const reduceMotion = useReducedMotion()
    const isAdmin = String(user?.role || '').toLowerCase().replace(/\s+/g, '') === 'system_admin'

    const [departments, setDepartments] = useState<Department[]>([])
    const [settings, setSettings] = useState<Record<string, Setting>>({})
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)

    const [search, setSearch] = useState('')
    const [status, setStatus] = useState<StatusFilter>('all')
    const [sort, setSort] = useState<Sort>('name')
    const [page, setPage] = useState(1)
    const [selectedId, setSelectedId] = useState<string>()
    const [drawerOpen, setDrawerOpen] = useState(false)
    const [draft, setDraft] = useState<string[]>([])
    const [view, setView] = useState<DatasetView>('all')

    const rise = (delay: number) =>
        reduceMotion
            ? {}
            : { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.3, ease: 'easeOut' as const, delay } }

    // Every department's settings in one read, so the list can show each one's access.
    useEffect(() => {
        if (identityLoading) return
        if (!isAdmin) {
            setLoading(false)
            return
        }
        let cancelled = false
        Promise.all([getDocs(collection(db, 'departments')), getDocs(collection(db, 'dataExportSettings'))])
            .then(([deptSnap, settingSnap]) => {
                if (cancelled) return
                setDepartments(
                    deptSnap.docs
                        .map(d => ({ id: d.id, ...(d.data() as Omit<Department, 'id'>) }))
                        .filter(d => d.isActive !== false)
                        .map(d => ({ ...d, name: String(d.name || d.id) }))
                )
                setSettings(
                    Object.fromEntries(
                        settingSnap.docs.map(d => {
                            const data = d.data() as any
                            return [
                                d.id,
                                {
                                    allowed: Array.isArray(data.allowedDatasets) ? data.allowedDatasets.map(String) : [],
                                    updatedAt: data.updatedAt?.toDate?.() ?? null,
                                    updatedByName: String(data.updatedByName || '')
                                }
                            ]
                        })
                    )
                )
            })
            .catch(error => {
                if (cancelled) return
                console.error(error)
                message.error('Could not load export permissions.')
            })
            .finally(() => !cancelled && setLoading(false))
        return () => {
            cancelled = true
        }
    }, [identityLoading, isAdmin])

    const allowedOf = (id: string) => validKeys(settings[id]?.allowed || [])

    const counts = useMemo(() => {
        const withAccess = departments.filter(d => allowedOf(d.id).length > 0).length
        return { all: departments.length, with: withAccess, none: departments.length - withAccess }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [departments, settings])

    const visible = useMemo(() => {
        const term = search.trim().toLowerCase()
        const rows = departments.filter(d => {
            const n = allowedOf(d.id).length
            return (
                (!term || d.name.toLowerCase().includes(term)) &&
                (status === 'all' || (status === 'with' ? n > 0 : n === 0))
            )
        })
        const byName = (a: Department, b: Department) => a.name.localeCompare(b.name)
        return rows.sort((a, b) => {
            if (sort === 'most') return allowedOf(b.id).length - allowedOf(a.id).length || byName(a, b)
            if (sort === 'least') return allowedOf(a.id).length - allowedOf(b.id).length || byName(a, b)
            if (sort === 'recent')
                return (settings[b.id]?.updatedAt?.getTime() ?? 0) - (settings[a.id]?.updatedAt?.getTime() ?? 0) || byName(a, b)
            return byName(a, b)
        })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [departments, settings, search, status, sort])

    useEffect(() => setPage(1), [search, status, sort])

    const selected = departments.find(d => d.id === selectedId)
    const saved = selectedId ? allowedOf(selectedId) : []
    const dirty = !!selectedId && !sameSelection(draft, saved)

    const open = (id: string) => {
        setSelectedId(id)
        setDraft(allowedOf(id))
        setView('all')
        if (isMobile) setDrawerOpen(true)
    }

    // Desktop always shows a department: keep the selection while it's listed, otherwise take the first.
    useEffect(() => {
        if (isMobile || loading || dirty) return
        if (!visible.some(d => d.id === selectedId) && visible[0]) open(visible[0].id)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visible, selectedId, isMobile, loading])

    const choose = (id: string) => {
        if (id === selectedId) {
            if (isMobile) setDrawerOpen(true)
            return
        }
        if (!dirty) return open(id)
        Modal.confirm({
            title: 'Discard unsaved changes?',
            content: `Your changes to ${selected?.name || 'this department'} have not been saved.`,
            okText: 'Discard and switch',
            okButtonProps: { danger: true },
            cancelText: 'Stay here',
            onOk: () => open(id)
        })
    }

    const toggle = (keys: string[], on: boolean) =>
        setDraft(current => (on ? [...new Set([...current, ...keys])] : current.filter(k => !keys.includes(k))))

    const save = async () => {
        if (!selected || !dirty) return
        const allowed = [...draft]
        const updatedByName = user?.name || user?.email || 'System Admin'
        setSaving(true)
        try {
            await setDoc(
                doc(db, 'dataExportSettings', selected.id),
                { departmentName: selected.name, allowedDatasets: allowed, updatedAt: serverTimestamp(), updatedByName },
                { merge: true }
            )
            setSettings(current => ({ ...current, [selected.id]: { allowed, updatedAt: new Date(), updatedByName } }))
            message.success(`Export access saved for ${selected.name}.`)
        } catch (error) {
            console.error(error)
            message.error('Could not save export access.')
        } finally {
            setSaving(false)
        }
    }

    if (identityLoading || (loading && !isAdmin))
        return (
            <div className='ws-page' style={{ display: 'grid', placeItems: 'center', minHeight: 400 }}>
                <Spin size='large' />
            </div>
        )
    if (!isAdmin)
        return (
            <div className='ws-page'>
                <Alert type='error' showIcon message='Only the System Admin can manage Data Export permissions.' />
            </div>
        )

    const tiles: { key: string; title: string; mobileTitle?: string; value: number; tone: MetricTone; icon: React.ReactNode }[] = [
        { key: 'departments', title: 'Departments', value: counts.all, tone: 'accent', icon: <TeamOutlined /> },
        { key: 'with', title: 'With export access', mobileTitle: 'With access', value: counts.with, tone: 'success', icon: <CheckCircleOutlined /> },
        { key: 'none', title: 'No export access', mobileTitle: 'No access', value: counts.none, tone: 'warning', icon: <StopOutlined /> },
        { key: 'datasets', title: 'Datasets available', mobileTitle: 'Datasets', value: DATASETS.length, tone: 'info', icon: <DatabaseOutlined /> }
    ]

    const pageItems = visible.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
    const setting = selectedId ? settings[selectedId] : undefined
    const shownDatasets = DATASETS.filter(d =>
        view === 'all' ? true : view === 'allowed' ? draft.includes(d.key) : !draft.includes(d.key)
    )

    const detail = selected ? (
        <div className='ws-detail'>
            <MotionCard>
                <motion.header key={`head-${selected.id}`} className='ws-detail-head' {...rise(0)}>
                    <EntityAvatar name={selected.name} size={52} />
                    <div className='ws-detail-identity'>
                        <h2 className='ws-detail-name'>{selected.name}</h2>
                        <div className='ws-detail-sub'>
                            {setting?.updatedAt
                                ? `Changed ${dayjs(setting.updatedAt).fromNow()}${setting.updatedByName ? ` by ${setting.updatedByName}` : ''}`
                                : 'Export access has never been set'}
                        </div>
                        <div className='ws-detail-tags'>
                            <Tag color={draft.length ? 'success' : 'default'}>
                                {draft.length} of {DATASETS.length} datasets
                            </Tag>
                            {dirty && <Tag color='warning'>Unsaved changes</Tag>}
                        </div>
                    </div>
                    <div className='ws-detail-actions dxs-actions'>
                        <Button icon={<CheckCircleOutlined />} disabled={saving || draft.length === DATASETS.length} onClick={() => setDraft(ALL_KEYS)}>
                            Allow everything
                        </Button>
                        <Button icon={<ClearOutlined />} disabled={saving || draft.length === 0} onClick={() => setDraft([])}>
                            Clear all
                        </Button>
                        {dirty && (
                            <Button icon={<UndoOutlined />} disabled={saving} onClick={() => setDraft(saved)}>
                                Discard
                            </Button>
                        )}
                        <Button type='primary' icon={<SaveOutlined />} loading={saving} disabled={!dirty} onClick={() => void save()}>
                            Save
                        </Button>
                    </div>
                </motion.header>

                <div className='ws-detail-tabs'>
                    <Segmented
                        block
                        value={view}
                        onChange={v => setView(v as DatasetView)}
                        options={[
                            { value: 'all', label: `All (${DATASETS.length})`, icon: <DatabaseOutlined /> },
                            { value: 'allowed', label: `Allowed (${draft.length})`, icon: <CheckCircleOutlined /> },
                            { value: 'blocked', label: `Not allowed (${DATASETS.length - draft.length})`, icon: <StopOutlined /> }
                        ]}
                    />
                    <div className='ws-detail-pane'>
                        <motion.div key={`${selected.id}-${view}`} className='ws-detail-body' {...rise(0.06)}>
                            {shownDatasets.length === 0 ? (
                                <Empty
                                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                                    description={view === 'allowed' ? 'Nothing allowed yet' : 'Every dataset is allowed'}
                                />
                            ) : (
                                GROUPS.map(group => {
                                    const items = shownDatasets.filter(d => d.group === group)
                                    if (!items.length) return null
                                    const groupKeys = DATASETS.filter(d => d.group === group).map(d => d.key)
                                    const allowedInGroup = groupKeys.filter(k => draft.includes(k)).length
                                    const allOn = allowedInGroup === groupKeys.length
                                    return (
                                        <section key={group}>
                                            <div className='dxs-group-head'>
                                                <h4 className='ws-section-title'>
                                                    {group}
                                                    <span className='dxs-group-count'>
                                                        {allowedInGroup}/{groupKeys.length}
                                                    </span>
                                                </h4>
                                                {view === 'all' && (
                                                    <Button type='link' size='small' disabled={saving} onClick={() => toggle(groupKeys, !allOn)}>
                                                        {allOn ? 'Clear group' : 'Allow group'}
                                                    </Button>
                                                )}
                                            </div>
                                            <div className='ws-rows'>
                                                {items.map(d => {
                                                    const on = draft.includes(d.key)
                                                    return (
                                                        <label key={d.key} className={`ws-row is-static dxs-dataset${on ? ' is-on' : ''}`}>
                                                            <div className='ws-row-main'>
                                                                <div className='ws-row-name'>{d.label}</div>
                                                                <div className='dxs-dataset-desc'>{d.description}</div>
                                                            </div>
                                                            <Switch
                                                                checked={on}
                                                                disabled={saving}
                                                                onChange={value => toggle([d.key], value)}
                                                                aria-label={`Allow ${d.label}`}
                                                            />
                                                        </label>
                                                    )
                                                })}
                                            </div>
                                        </section>
                                    )
                                })
                            )}
                        </motion.div>
                    </div>
                </div>
            </MotionCard>
        </div>
    ) : null

    return (
        <div className='ws-page'>
            <Helmet>
                <title>Data Export Permissions | Smart Incubation</title>
            </Helmet>

            <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
                {tiles.map((t, i) => (
                    <Col key={t.key} xs={12} lg={6}>
                        <motion.div {...rise(i * 0.05)}>
                            <MetricTile
                                icon={t.icon}
                                tone={t.tone}
                                title={t.title}
                                mobileTitle={t.mobileTitle}
                                value={t.value}
                                loading={loading}
                                compact={isMobile}
                            />
                        </motion.div>
                    </Col>
                ))}
            </Row>

            <motion.div {...rise(0.22)}>
                <div className='ws-toolbar' style={{ marginBottom: 12 }}>
                    <Input
                        className='ws-toolbar-search'
                        allowClear
                        prefix={<SearchOutlined />}
                        placeholder='Search departments'
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
                    <Segmented
                        className='ws-toolbar-status'
                        block
                        value={status}
                        onChange={v => setStatus(v as StatusFilter)}
                        options={[
                            { value: 'all', label: `All (${counts.all})` },
                            { value: 'with', label: `With access (${counts.with})` },
                            { value: 'none', label: `No access (${counts.none})` }
                        ]}
                    />
                </div>
            </motion.div>

            <div className='ws-layout'>
                <div>
                    <MotionCard loading={loading} skeleton='list' skeletonRows={6}>
                        <SortSelect value={sort} options={SORT_OPTIONS} onChange={setSort} label='Sort departments' />
                        {visible.length === 0 ? (
                            <Empty className='ws-list-empty' description='No departments match' />
                        ) : (
                            <>
                                <div key={`${page}|${status}|${sort}|${search}`} className='ws-rows' role='listbox' aria-label='Departments'>
                                    {pageItems.map((d, index) => {
                                        const n = allowedOf(d.id).length
                                        const isSelected = d.id === selectedId
                                        const changed = settings[d.id]?.updatedAt
                                        return (
                                            <motion.button
                                                key={d.id}
                                                initial={reduceMotion ? false : { opacity: 0, y: 8 }}
                                                animate={{ opacity: 1, y: 0 }}
                                                transition={{ duration: 0.24, ease: 'easeOut', delay: Math.min(index * 0.035, 0.3) }}
                                                type='button'
                                                role='option'
                                                aria-selected={isSelected}
                                                className={`ws-row${isSelected ? ' is-selected' : ''}`}
                                                onClick={() => choose(d.id)}
                                            >
                                                <EntityAvatar name={d.name} size={36} />
                                                <div className='ws-row-main'>
                                                    <div className='ws-row-name'>{d.name}</div>
                                                    <div className='ws-row-meta'>
                                                        {changed ? `Changed ${dayjs(changed).fromNow()}` : 'Never set'}
                                                    </div>
                                                </div>
                                                <div className='ws-row-side'>
                                                    <Tag color={n ? 'success' : 'default'} bordered={false}>
                                                        {n} / {DATASETS.length}
                                                    </Tag>
                                                    {isSelected && dirty && (
                                                        <Tag color='warning' bordered={false}>
                                                            Unsaved
                                                        </Tag>
                                                    )}
                                                </div>
                                            </motion.button>
                                        )
                                    })}
                                </div>
                                {visible.length > PAGE_SIZE && (
                                    <div className='ws-pagination'>
                                        <Pagination
                                            size='small'
                                            current={page}
                                            pageSize={PAGE_SIZE}
                                            total={visible.length}
                                            onChange={setPage}
                                            showSizeChanger={false}
                                        />
                                    </div>
                                )}
                            </>
                        )}
                    </MotionCard>
                </div>

                {!isMobile && (
                    <div className='ws-detail-sticky'>
                        {detail || (
                            <MotionCard loading={loading} skeleton='text' skeletonRows={8}>
                                <Empty className='ws-detail-empty' description='Select a department to manage its export access' />
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
                    title={selected?.name || 'Department'}
                >
                    {detail}
                </Drawer>
            )}
        </div>
    )
}

export default DataExportSettingsPage
