import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Col, DatePicker, Drawer, Dropdown, Empty, Input, InputNumber, Progress, Row, Select, Tag, Tooltip, message } from 'antd'
import {
    CheckCircleOutlined,
    DeleteOutlined,
    DollarOutlined,
    FileDoneOutlined,
    MoreOutlined,
    PlusOutlined,
    SaveOutlined,
    WarningOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { motion, useReducedMotion } from 'framer-motion'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { MetricTile } from '@/components/dashboards/metrics/MetricTile'
import { useIsMobile } from '@/hooks/useIsMobile'
import {
    contractTotals,
    formatRand,
    isMilestoneOverdue,
    listContracts,
    newMilestoneId,
    saveContractMilestones,
    setContractStatus,
    type ContractMilestone,
    type ContractStatus,
    type MilestoneStatus,
    type SupplyContract
} from '@/services/marketLinkage'

const CONTRACT_STATUS: Record<ContractStatus, { label: string; color: string }> = {
    active: { label: 'Active', color: 'processing' },
    completed: { label: 'Completed', color: 'success' },
    terminated: { label: 'Terminated', color: 'default' }
}

const MILESTONE_STATUS: Record<MilestoneStatus, { label: string; color: string }> = {
    pending: { label: 'Pending', color: 'default' },
    delivered: { label: 'Delivered', color: 'blue' },
    paid: { label: 'Paid', color: 'success' }
}

/** One contract: milestones are edited in place and saved together. */
const ContractDetail: React.FC<{ contract: SupplyContract; onChanged: () => Promise<unknown> }> = ({ contract: c, onChanged }) => {
    const [rows, setRows] = useState<ContractMilestone[]>(c.milestones)
    const [saving, setSaving] = useState(false)

    useEffect(() => setRows(c.milestones), [c.id, c.milestones])

    const dirty = JSON.stringify(rows) !== JSON.stringify(c.milestones)
    const totals = contractTotals({ value: c.value, milestones: rows })
    const overdue = rows.filter(isMilestoneOverdue).length
    const patch = (id: string, p: Partial<ContractMilestone>) => setRows(prev => prev.map(r => (r.id === id ? { ...r, ...p } : r)))

    const save = async () => {
        if (totals.scheduled > c.value) {
            message.error('The milestones add up to more than the contract value.')
            return
        }
        setSaving(true)
        try {
            await saveContractMilestones(c.id, rows.filter(r => r.title.trim()))
            message.success('Milestones saved.')
            await onChanged()
        } catch (e) {
            console.error('[market-linkage] milestones failed', e)
            message.error('Could not save the milestones.')
        } finally {
            setSaving(false)
        }
    }

    const changeStatus = async (status: ContractStatus) => {
        await setContractStatus(c.id, status)
        message.success(`Contract marked ${CONTRACT_STATUS[status].label.toLowerCase()}.`)
        await onChanged()
    }

    return (
        <div className='ws-detail'>
            <MotionCard>
                <header className='ws-detail-head mlx-head'>
                    <div className='ws-detail-identity'>
                        <h2 className='ws-detail-name'>{c.participantName}</h2>
                        <div className='ws-detail-sub'>{[c.title, c.buyer].filter(Boolean).join(' · ')}</div>
                        <div className='ws-detail-tags'>
                            <Tag color={CONTRACT_STATUS[c.status].color} bordered={false}>{CONTRACT_STATUS[c.status].label}</Tag>
                            <Tag bordered={false}>{formatRand(c.value)}</Tag>
                            {c.startDate && <Tag bordered={false}>{dayjs(c.startDate).format('D MMM YYYY')} – {c.endDate ? dayjs(c.endDate).format('D MMM YYYY') : 'open'}</Tag>}
                            {overdue > 0 && <Tag color='error' bordered={false} icon={<WarningOutlined />}>{overdue} overdue</Tag>}
                        </div>
                    </div>
                    <div className='mlx-head-actions'>
                        <Button type='primary' icon={<SaveOutlined />} disabled={!dirty} loading={saving} onClick={save}>Save</Button>
                        <Dropdown
                            trigger={['click']}
                            menu={{
                                items: (['active', 'completed', 'terminated'] as ContractStatus[])
                                    .filter(s => s !== c.status)
                                    .map(s => ({ key: s, label: `Mark ${CONTRACT_STATUS[s].label.toLowerCase()}`, onClick: () => changeStatus(s) }))
                            }}
                        >
                            <Button shape='circle' icon={<MoreOutlined />} aria-label='More actions' />
                        </Dropdown>
                    </div>
                </header>

                <div className='ws-detail-tabs'>
                    <div className='ws-detail-pane'>
                        <div className='ws-detail-body'>
                            <section>
                                <h4 className='ws-section-title'>Progress</h4>
                                <dl className='ws-facts'>
                                    <div><dt>Delivered</dt><dd>{formatRand(totals.delivered)}</dd></div>
                                    <div><dt>Paid to the SME</dt><dd>{formatRand(totals.paid)}</dd></div>
                                    <div><dt>Not yet scheduled</dt><dd>{formatRand(totals.unscheduled)}</dd></div>
                                </dl>
                                <Tooltip title={`${formatRand(totals.paid)} paid, ${formatRand(totals.delivered - totals.paid)} delivered awaiting payment`}>
                                    <Progress
                                        style={{ marginTop: 8 }}
                                        percent={c.value ? Math.round((totals.delivered / c.value) * 100) : 0}
                                        success={{ percent: c.value ? Math.round((totals.paid / c.value) * 100) : 0 }}
                                    />
                                </Tooltip>
                            </section>

                            <section>
                                <h4 className='ws-section-title'>Milestones</h4>
                                {rows.length === 0 && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='No milestones yet' />}
                                <div className='mlx-milestone-rows'>
                                    {rows.map(r => (
                                        <div key={r.id} className={`mlx-milestone-edit${isMilestoneOverdue(r) ? ' is-overdue' : ''}`}>
                                            <Input value={r.title} placeholder='What is delivered' onChange={e => patch(r.id, { title: e.target.value })} />
                                            <DatePicker value={r.dueDate ? dayjs(r.dueDate) : null} format='D MMM YYYY' placeholder='Due' onChange={d => patch(r.id, { dueDate: d ? d.toDate() : null })} />
                                            <InputNumber value={r.amount} min={0} prefix='R' onChange={n => patch(r.id, { amount: Number(n) || 0 })} />
                                            <Select
                                                value={r.status}
                                                onChange={s => patch(r.id, { status: s })}
                                                options={(Object.keys(MILESTONE_STATUS) as MilestoneStatus[]).map(s => ({ value: s, label: MILESTONE_STATUS[s].label }))}
                                            />
                                            <Button type='text' icon={<DeleteOutlined />} aria-label='Remove milestone' onClick={() => setRows(prev => prev.filter(x => x.id !== r.id))} />
                                        </div>
                                    ))}
                                </div>
                                <Button
                                    type='dashed'
                                    block
                                    icon={<PlusOutlined />}
                                    style={{ marginTop: 8 }}
                                    onClick={() => setRows(prev => [...prev, { id: newMilestoneId(), title: '', dueDate: null, amount: 0, status: 'pending' }])}
                                >
                                    Add milestone
                                </Button>
                                {totals.scheduled > c.value && (
                                    <Alert style={{ marginTop: 8 }} type='error' showIcon message='The milestones add up to more than the contract value.' />
                                )}
                            </section>
                        </div>
                    </div>
                </div>
            </MotionCard>
        </div>
    )
}

/** Supply contracts won through market linkage, with delivery and payment progress. */
export const ContractsView: React.FC<{ programId: string }> = ({ programId }) => {
    const isMobile = useIsMobile()
    const reduceMotion = useReducedMotion()
    const [contracts, setContracts] = useState<SupplyContract[]>([])
    const [loading, setLoading] = useState(true)
    const [selectedId, setSelectedId] = useState<string>()
    const [drawerOpen, setDrawerOpen] = useState(false)

    const load = async () => {
        try {
            setContracts(await listContracts(programId))
        } catch (e) {
            console.error('[market-linkage] contracts failed', e)
            message.error('Could not load contracts.')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        setLoading(true)
        load()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [programId])

    useEffect(() => {
        if (isMobile) return
        if (!contracts.some(c => c.id === selectedId)) setSelectedId(contracts[0]?.id)
    }, [contracts, selectedId, isMobile])

    const totals = useMemo(() => {
        const sum = contracts.reduce(
            (acc, c) => {
                const t = contractTotals(c)
                return { value: acc.value + c.value, delivered: acc.delivered + t.delivered, paid: acc.paid + t.paid }
            },
            { value: 0, delivered: 0, paid: 0 }
        )
        return { ...sum, active: contracts.filter(c => c.status === 'active').length }
    }, [contracts])

    const selected = contracts.find(c => c.id === selectedId)
    const detail = selected ? <ContractDetail contract={selected} onChanged={load} /> : null
    const rise = (delay: number) =>
        reduceMotion ? {} : { initial: { opacity: 0, y: 10 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.3, ease: 'easeOut' as const, delay } }

    const tiles = [
        { title: 'Active contracts', value: totals.active, icon: <FileDoneOutlined />, tone: 'accent' as const },
        { title: 'Value awarded', value: formatRand(totals.value), icon: <DollarOutlined />, tone: 'success' as const },
        { title: 'Delivered', value: formatRand(totals.delivered), icon: <CheckCircleOutlined />, tone: 'info' as const },
        { title: 'Paid to SMEs', value: formatRand(totals.paid), icon: <DollarOutlined />, tone: 'warning' as const }
    ]

    return (
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

            <div className='ws-layout'>
                <MotionCard loading={loading} skeleton='list' skeletonRows={4}>
                    {contracts.length === 0 ? (
                        <Empty className='ws-list-empty' description='No contracts yet. Award a submitted bid to open one.' />
                    ) : (
                        <div className='ws-rows' role='listbox' aria-label='Contracts'>
                            {contracts.map(c => {
                                const t = contractTotals(c)
                                const overdue = c.milestones.filter(isMilestoneOverdue).length
                                return (
                                    <button
                                        key={c.id}
                                        type='button'
                                        role='option'
                                        aria-selected={c.id === selectedId}
                                        className={`ws-row${c.id === selectedId ? ' is-selected' : ''}`}
                                        onClick={() => {
                                            setSelectedId(c.id)
                                            if (isMobile) setDrawerOpen(true)
                                        }}
                                    >
                                        <div className='ws-row-main'>
                                            <div className='ws-row-name'>{c.participantName}</div>
                                            <div className='ws-row-meta'>{[c.title, formatRand(c.value)].join(' · ')}</div>
                                        </div>
                                        <div className='ws-row-side'>
                                            {overdue > 0 ? (
                                                <Tag color='error' bordered={false}>{overdue} overdue</Tag>
                                            ) : (
                                                <Tag color={CONTRACT_STATUS[c.status].color} bordered={false}>
                                                    {c.value ? `${Math.round((t.paid / c.value) * 100)}% paid` : CONTRACT_STATUS[c.status].label}
                                                </Tag>
                                            )}
                                        </div>
                                    </button>
                                )
                            })}
                        </div>
                    )}
                </MotionCard>

                {!isMobile && (
                    <div className='ws-detail-sticky'>
                        {detail || (
                            <MotionCard loading={loading} skeleton='text' skeletonRows={6}>
                                <Empty className='ws-detail-empty' description='Select a contract' />
                            </MotionCard>
                        )}
                    </div>
                )}
            </div>

            {isMobile && (
                <Drawer
                    className='ws-drawer'
                    rootClassName='modal-style-drawer mlx-sheet'
                    open={drawerOpen && !!selected}
                    onClose={() => setDrawerOpen(false)}
                    placement='bottom'
                    height='92dvh'
                    title='Contract'
                >
                    {detail}
                </Drawer>
            )}
        </>
    )
}
