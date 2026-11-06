import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Empty, Modal, Select, Space, Table, Tabs, Tag, Typography } from 'antd'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '@/firebase'
import { MobileCardList } from '@/components/shared/MobileCardList'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useDepartmentRoles } from '@/services/departmentRoles'
import { clusterColor, clusterLabel } from './CompetenciesModal'
import type { CompactItem, Competency, ItemSource } from './ipm'

const { Text } = Typography

type LibraryTab = 'qualityObjectives' | 'kpis' | 'competencies'

type QoRow = {
    key: string
    departmentId: string
    objectiveNumber?: number
    kpaName: string
    objectiveText: string
    kpi: string
    target?: string
    weighting?: number
    source: ItemSource
}

type KpiRow = {
    key: string
    departmentIds: string[]
    label: string
    description?: string
    unit?: string
    source: ItemSource
}

const sourceKey = (source?: ItemSource) => (source ? `${source.type}:${source.id}:${source.subId || ''}` : '')
const newItemId = () => `item_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

/**
 * Cascade: pick KPAs and KPIs from the department's Quality Objectives and the
 * organisational KPIs, and competencies from HR's library.
 */
export const LibraryImportModal: React.FC<{
    open: boolean
    onClose: () => void
    onAdd: (items: CompactItem[]) => void
    existing: CompactItem[]
    departmentId?: string | null
    competencies: Competency[]
}> = ({ open, onClose, onAdd, existing, departmentId, competencies }) => {
    const { nameOf } = useDepartmentRoles()
    const isMobile = useIsMobile()
    const [tab, setTab] = useState<LibraryTab>('qualityObjectives')
    const [loading, setLoading] = useState(false)
    const [qoRows, setQoRows] = useState<QoRow[]>([])
    const [kpiRows, setKpiRows] = useState<KpiRow[]>([])
    const [qoError, setQoError] = useState(false)
    const [department, setDepartment] = useState<string | undefined>(departmentId || undefined)
    const [selected, setSelected] = useState<Record<LibraryTab, React.Key[]>>({ qualityObjectives: [], kpis: [], competencies: [] })

    useEffect(() => {
        if (!open) return
        setDepartment(departmentId || undefined)
        setSelected({ qualityObjectives: [], kpis: [], competencies: [] })
        setLoading(true)
        setQoError(false)
        Promise.all([
            getDocs(collection(db, 'qualityObjectives')).catch(error => {
                console.warn('[IPM] quality objectives unavailable', error)
                setQoError(true)
                return null
            }),
            getDocs(collection(db, 'kpiDefinitions')).catch(() => null)
        ])
            .then(([qoSnap, kpiSnap]) => {
                setQoRows(
                    (qoSnap?.docs || []).flatMap(d => {
                        const qo: any = d.data()
                        if (qo.isActive === false) return []
                        const base = {
                            departmentId: String(qo.departmentId || ''),
                            objectiveNumber: qo.objectiveNumber,
                            kpaName: qo.kpaName || qo.objectiveText || 'Objective',
                            objectiveText: qo.objectiveText || ''
                        }
                        const label = qo.objectiveNumber ? `Quality objective ${qo.objectiveNumber}` : 'Quality objective'
                        const kpis: any[] = Array.isArray(qo.kpis) && qo.kpis.length ? qo.kpis : [null]
                        return kpis.map((kpi, index) => {
                            const subId = kpi?.id || String(index)
                            return {
                                ...base,
                                key: `${d.id}:${subId}`,
                                kpi: kpi?.description || qo.objectiveText || '',
                                target: kpi?.targetValue || '',
                                weighting: Number(kpi?.weighting || 0),
                                source: { type: 'qualityObjective' as const, id: d.id, subId, label }
                            }
                        })
                    })
                )
                setKpiRows(
                    (kpiSnap?.docs || [])
                        .map(d => {
                            const k: any = d.data()
                            return {
                                key: d.id,
                                active: k.active !== false,
                                departmentIds: [...new Set([k.leadDepartmentId, ...(k.contributorDepartmentIds || [])].filter(Boolean).map(String))],
                                label: k.kpiLabel || 'KPI',
                                description: k.description || '',
                                unit: k.unit,
                                source: { type: 'kpi' as const, id: d.id, label: 'Organisational KPI' }
                            }
                        })
                        .filter(k => k.active)
                )
            })
            .finally(() => setLoading(false))
    }, [open, departmentId])

    const taken = useMemo(() => new Set(existing.map(item => sourceKey(item.source)).filter(Boolean)), [existing])

    const departmentOptions = useMemo(() => {
        const ids = new Set([...qoRows.map(r => r.departmentId), ...kpiRows.flatMap(r => r.departmentIds)].filter(Boolean))
        return [...ids].map(id => ({ value: id, label: nameOf(id) })).sort((a, b) => a.label.localeCompare(b.label))
    }, [qoRows, kpiRows, nameOf])

    const qoVisible = qoRows.filter(r => !department || r.departmentId === department)
    const kpiVisible = kpiRows.filter(r => !department || r.departmentIds.includes(department))

    const count = selected.qualityObjectives.length + selected.kpis.length + selected.competencies.length

    const add = () => {
        const items: CompactItem[] = [
            ...qoRows
                .filter(r => selected.qualityObjectives.includes(r.key))
                .map(r => ({
                    id: newItemId(),
                    section: 'strategic' as const,
                    kpa: r.kpaName,
                    kpi: r.kpi,
                    target: r.target,
                    weight: r.weighting || 0,
                    source: r.source
                })),
            ...kpiRows
                .filter(r => selected.kpis.includes(r.key))
                .map(r => ({
                    id: newItemId(),
                    section: 'strategic' as const,
                    kpa: r.label,
                    kpi: r.description,
                    standard: r.unit === 'ZAR' ? ('cost' as const) : ('quantity' as const),
                    weight: 0,
                    source: r.source
                })),
            ...competencies
                .filter(c => selected.competencies.includes(c.id))
                .map(c => ({
                    id: newItemId(),
                    section: 'competencies' as const,
                    kpa: c.name,
                    kpi: c.description || '',
                    cluster: c.cluster,
                    requiredLevel: 3,
                    weight: 0,
                    source: { type: 'competency' as const, id: c.id, label: clusterLabel(c.cluster) }
                }))
        ]
        onAdd(items)
    }

    const selection = (key: LibraryTab, sourceOf: (row: any) => ItemSource) => ({
        selectedRowKeys: selected[key],
        onChange: (keys: React.Key[]) => setSelected(s => ({ ...s, [key]: keys })),
        getCheckboxProps: (row: any) => ({ disabled: taken.has(sourceKey(sourceOf(row))) })
    })

    const departmentPicker = (
        <Select
            allowClear
            placeholder='All departments'
            value={department}
            onChange={setDepartment}
            options={departmentOptions}
            style={{ width: isMobile ? '100%' : 260 }}
        />
    )

    // Phones: cards with checkboxes. Items already in the compact show as added and cannot be ticked.
    const takenKeys = (rows: { key: string; source: ItemSource }[]) =>
        new Set(rows.filter(r => taken.has(sourceKey(r.source))).map(r => r.key))
    const cardSelection = (key: LibraryTab, blocked: Set<string>) => ({
        selectedKeys: selected[key],
        onSelectionChange: (keys: React.Key[]) =>
            setSelected(s => ({ ...s, [key]: keys.filter(k => !blocked.has(String(k))) }))
    })
    const addedTag = <Tag style={{ borderRadius: 999, margin: 0 }}>Added</Tag>
    const qoTaken = takenKeys(qoRows)
    const kpiTaken = takenKeys(kpiRows)
    const competencyTaken = new Set(competencies.filter(c => taken.has(sourceKey({ type: 'competency', id: c.id }))).map(c => c.id))

    return (
        <Modal
            open={open}
            onCancel={onClose}
            onOk={add}
            okText={count ? `Add ${count} item${count === 1 ? '' : 's'}` : 'Add'}
            okButtonProps={{ disabled: !count }}
            width={980}
            destroyOnClose
            title='Add from library'
        >
            <Tabs
                activeKey={tab}
                onChange={key => setTab(key as LibraryTab)}
                tabBarExtraContent={tab === 'competencies' || isMobile ? null : departmentPicker}
                items={[
                    {
                        key: 'qualityObjectives',
                        label: `Quality objectives${selected.qualityObjectives.length ? ` (${selected.qualityObjectives.length})` : ''}`,
                        children: (
                            <>
                                <Text type='secondary' style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
                                    Each KPI becomes a Strategic KPA item with its target and weighting.
                                </Text>
                                {qoError ? (
                                    <Alert type='warning' showIcon style={{ marginBottom: 8 }} message='You do not have access to quality objectives.' />
                                ) : null}
                                {isMobile ? <div style={{ marginBottom: 12 }}>{departmentPicker}</div> : null}
                                {isMobile ? (
                                    <MobileCardList
                                        data={qoVisible}
                                        loading={loading}
                                        getKey={r => r.key}
                                        emptyText='No quality objectives for this department.'
                                        {...cardSelection('qualityObjectives', qoTaken)}
                                        renderCard={(r: QoRow) => ({
                                            title: r.kpaName,
                                            subtitle: [r.objectiveNumber ? `Objective ${r.objectiveNumber}` : '', nameOf(r.departmentId)].filter(Boolean).join(' · '),
                                            badge: qoTaken.has(r.key) ? addedTag : r.weighting ? <Tag style={{ margin: 0 }}>{r.weighting}%</Tag> : undefined,
                                            fields: [
                                                { label: 'KPI', value: r.kpi || '—' },
                                                { label: 'Target', value: r.target || '—' }
                                            ]
                                        })}
                                    />
                                ) : (
                                <Table
                                    rowKey='key'
                                    size='small'
                                    loading={loading}
                                    dataSource={qoVisible}
                                    rowSelection={selection('qualityObjectives', r => r.source)}
                                    pagination={{ pageSize: 8, hideOnSinglePage: true }}
                                    locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='No quality objectives for this department.' /> }}
                                    columns={[
                                        {
                                            title: 'KPA',
                                            key: 'kpa',
                                            render: (_: any, r: QoRow) => (
                                                <Space direction='vertical' size={0}>
                                                    <Text strong>{r.kpaName}</Text>
                                                    <Text type='secondary' style={{ fontSize: 12 }}>
                                                        {[r.objectiveNumber ? `Objective ${r.objectiveNumber}` : '', nameOf(r.departmentId)].filter(Boolean).join(' · ')}
                                                    </Text>
                                                </Space>
                                            )
                                        },
                                        { title: 'KPI', dataIndex: 'kpi', key: 'kpi' },
                                        { title: 'Target', dataIndex: 'target', key: 'target', render: (v: string) => v || '—' },
                                        { title: 'Weight', dataIndex: 'weighting', key: 'weighting', width: 80, render: (v: number) => (v ? `${v}%` : '—') }
                                    ]}
                                />
                                )}
                            </>
                        )
                    },
                    {
                        key: 'kpis',
                        label: `Organisational KPIs${selected.kpis.length ? ` (${selected.kpis.length})` : ''}`,
                        children: isMobile ? (
                            <>
                                <div style={{ marginBottom: 12 }}>{departmentPicker}</div>
                                <MobileCardList
                                    data={kpiVisible}
                                    loading={loading}
                                    getKey={r => r.key}
                                    emptyText='No KPIs for this department.'
                                    {...cardSelection('kpis', kpiTaken)}
                                    renderCard={(r: KpiRow) => ({
                                        title: r.label,
                                        subtitle: r.description || undefined,
                                        badge: kpiTaken.has(r.key) ? addedTag : r.unit ? <Tag style={{ margin: 0 }}>{r.unit}</Tag> : undefined,
                                        fields: [{ label: 'Departments', value: r.departmentIds.map(id => nameOf(id)).join(', ') || '—' }]
                                    })}
                                />
                            </>
                        ) : (
                            <Table
                                rowKey='key'
                                size='small'
                                loading={loading}
                                dataSource={kpiVisible}
                                rowSelection={selection('kpis', r => r.source)}
                                pagination={{ pageSize: 8, hideOnSinglePage: true }}
                                locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='No KPIs for this department.' /> }}
                                columns={[
                                    {
                                        title: 'KPI',
                                        key: 'label',
                                        render: (_: any, r: KpiRow) => (
                                            <Space direction='vertical' size={0}>
                                                <Text strong>{r.label}</Text>
                                                {r.description ? <Text type='secondary' style={{ fontSize: 12 }}>{r.description}</Text> : null}
                                            </Space>
                                        )
                                    },
                                    { title: 'Unit', dataIndex: 'unit', key: 'unit', width: 100, render: (v: string) => v || '—' },
                                    {
                                        title: 'Departments',
                                        key: 'departments',
                                        render: (_: any, r: KpiRow) => r.departmentIds.map(id => nameOf(id)).join(', ') || '—'
                                    }
                                ]}
                            />
                        )
                    },
                    {
                        key: 'competencies',
                        label: `Competencies${selected.competencies.length ? ` (${selected.competencies.length})` : ''}`,
                        children: isMobile ? (
                            <MobileCardList
                                data={competencies}
                                getKey={c => c.id}
                                emptyText='The competency library is empty. HR adds competencies from the performance settings.'
                                {...cardSelection('competencies', competencyTaken)}
                                renderCard={(c: Competency) => ({
                                    title: c.name,
                                    subtitle: c.description || undefined,
                                    badge: competencyTaken.has(c.id) ? (
                                        addedTag
                                    ) : (
                                        <Tag color={clusterColor(c.cluster)} style={{ borderRadius: 999, margin: 0 }}>
                                            {clusterLabel(c.cluster)}
                                        </Tag>
                                    )
                                })}
                            />
                        ) : (
                            <Table
                                rowKey='id'
                                size='small'
                                dataSource={competencies}
                                rowSelection={selection('competencies', (c: Competency) => ({ type: 'competency', id: c.id }))}
                                pagination={{ pageSize: 8, hideOnSinglePage: true }}
                                locale={{
                                    emptyText: (
                                        <Empty
                                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                                            description='The competency library is empty. HR adds competencies from the performance settings.'
                                        />
                                    )
                                }}
                                columns={[
                                    {
                                        title: 'Competency',
                                        key: 'name',
                                        render: (_: any, c: Competency) => (
                                            <Space direction='vertical' size={0}>
                                                <Text strong>{c.name}</Text>
                                                {c.description ? <Text type='secondary' style={{ fontSize: 12 }}>{c.description}</Text> : null}
                                            </Space>
                                        )
                                    },
                                    {
                                        title: 'Cluster',
                                        key: 'cluster',
                                        width: 130,
                                        render: (_: any, c: Competency) => (
                                            <Tag color={clusterColor(c.cluster)} style={{ borderRadius: 999 }}>
                                                {clusterLabel(c.cluster)}
                                            </Tag>
                                        )
                                    }
                                ]}
                            />
                        )
                    }
                ]}
            />
        </Modal>
    )
}
