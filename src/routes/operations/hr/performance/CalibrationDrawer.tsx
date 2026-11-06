import React, { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Drawer, Empty, Input, InputNumber, Modal, Segmented, Select, Space, Table, Tag, Tooltip, Typography, message } from 'antd'
import { CheckCircleFilled, SafetyOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from '@/firebase'
import { MobileCardList } from '@/components/shared/MobileCardList'
import { useIsMobile } from '@/hooks/useIsMobile'
import {
    PHASES,
    REVIEW_STAGES,
    phaseScore,
    ratingColor,
    ratingLabel,
    reviewDocId,
    reviewStage,
    type PerformanceCycle,
    type PhaseKey,
    type ReviewRecord,
    type ReviewStage
} from './ipm'

const { Text } = Typography

export type CalibrationRow = {
    key: string
    employeeUid: string
    name: string
    department?: string
    departmentId?: string | null
    lineManagerName?: string
    scores: Partial<Record<PhaseKey, number | null>>
    records: Partial<Record<PhaseKey, ReviewRecord>>
}

const BANDS = ['Exceptional', 'More than Satisfactory', 'Satisfactory', 'Unsatisfactory', 'Very Unsatisfactory'] as const

const stageLabel = (stage: ReviewStage) =>
    stage === 'disputed'
        ? 'Disputed'
        : stage === 'validated'
          ? 'Validated'
          : stage === 'calibration'
            ? 'Ready to calibrate'
            : stage === 'validation'
              ? 'Awaiting CEO'
              : REVIEW_STAGES.find(s => s.key === stage)?.label || stage

const stageColor = (stage: ReviewStage) =>
    stage === 'validated' ? 'green' : stage === 'disputed' ? 'red' : stage === 'calibration' || stage === 'validation' ? 'blue' : 'default'

/**
 * Mid-year and year-end calibration: HR reviews results across centres,
 * departments and levels so ratings are fair and consistent, adjusting with a
 * recorded reason; the CEO then validates them, which locks the review.
 */
export const CalibrationDrawer: React.FC<{
    open: boolean
    onClose: () => void
    cycle: PerformanceCycle | null
    rows: CalibrationRow[]
    isCeo: boolean
    departments: { value: string; label: string }[]
    user: { id: string; name: string }
    onSaved: () => void
}> = ({ open, onClose, cycle, rows, isCeo, departments, user, onSaved }) => {
    const isMobile = useIsMobile()
    const [phase, setPhase] = useState<PhaseKey>('midYear')
    const [department, setDepartment] = useState<string>()
    const [edits, setEdits] = useState<Record<string, { score?: number | null; reason?: string }>>({})
    const [busy, setBusy] = useState<string | null>(null)

    useEffect(() => {
        if (open) setEdits({})
    }, [open, phase])

    const visible = useMemo(
        () =>
            rows
                .filter(row => !department || row.departmentId === department)
                .map(row => {
                    const record = row.records[phase] || null
                    const original = row.scores[phase] ?? null
                    return { ...row, record, original, stage: reviewStage(record), current: phaseScore(original, record) }
                })
                .sort((a, b) => String(a.department || '').localeCompare(String(b.department || '')) || a.name.localeCompare(b.name)),
        [rows, department, phase]
    )

    const distribution = (scores: (number | null)[]) =>
        BANDS.map(band => ({ band, count: scores.filter(score => score !== null && ratingLabel(score) === band).length }))
    const before = distribution(visible.map(r => r.original))
    const after = distribution(visible.map(r => r.current))
    const readyToValidate = visible.filter(r => r.stage === 'validation')

    const write = async (row: (typeof visible)[number], patch: Record<string, unknown>, success: string) => {
        if (!cycle) return
        setBusy(row.key)
        try {
            await setDoc(doc(db, 'performanceReviews', reviewDocId(cycle.id, row.employeeUid, phase)), { ...patch, updatedAt: serverTimestamp() }, { merge: true })
            message.success(success)
            onSaved()
        } catch (error) {
            console.error(error)
            message.error('Could not save.')
        } finally {
            setBusy(null)
        }
    }

    const calibrate = (row: (typeof visible)[number]) => {
        const edit = edits[row.key] || {}
        const score = edit.score ?? row.current
        if (typeof score !== 'number') return
        const changed = row.original === null || Math.abs(score - row.original) > 0.001
        const reason = (edit.reason ?? row.record?.calibration?.reason ?? '').trim()
        if (changed && !reason) {
            message.warning('Give a reason for changing the rating.')
            return
        }
        write(
            row,
            {
                calibration: {
                    score: Math.round(score * 100) / 100,
                    originalScore: row.original,
                    reason: changed ? reason : reason || 'Confirmed without change',
                    by: user.id,
                    byName: user.name,
                    at: new Date().toISOString()
                }
            },
            changed ? 'Calibrated rating saved.' : 'Rating confirmed.'
        )
    }

    const validate = (row: (typeof visible)[number]) =>
        write(row, { validation: { by: user.id, byName: user.name, at: new Date().toISOString() } }, 'Rating validated.')

    const validateAll = () =>
        Modal.confirm({
            title: `Validate ${readyToValidate.length} rating${readyToValidate.length === 1 ? '' : 's'}?`,
            content: 'Validation finalises the calibrated ratings shown and locks the reviews.',
            okText: 'Validate all',
            onOk: async () => {
                for (const row of readyToValidate) await validate(row)
            }
        })

    const editable = (row: (typeof visible)[number]) => row.stage === 'calibration' || row.stage === 'validation'

    const scoreInput = (row: (typeof visible)[number]) => (
        <InputNumber
            min={1}
            max={5}
            step={0.05}
            style={{ width: 110 }}
            disabled={!editable(row)}
            value={edits[row.key]?.score ?? row.current ?? undefined}
            onChange={value => setEdits(e => ({ ...e, [row.key]: { ...e[row.key], score: value } }))}
        />
    )

    const reasonInput = (row: (typeof visible)[number]) => (
        <Input
            placeholder='Reason (needed when changing)'
            disabled={!editable(row)}
            value={edits[row.key]?.reason ?? row.record?.calibration?.reason ?? ''}
            onChange={e => setEdits(x => ({ ...x, [row.key]: { ...x[row.key], reason: e.target.value } }))}
        />
    )

    const rowActions = (row: (typeof visible)[number]) => {
        if (row.stage === 'validated') {
            return (
                <Tooltip title={`${row.record?.validation?.byName || 'CEO'}, ${dayjs(row.record?.validation?.at).format('D MMM YYYY')}`}>
                    <Tag color='green' icon={<CheckCircleFilled />} style={{ margin: 0 }}>
                        Validated
                    </Tag>
                </Tooltip>
            )
        }
        return (
            <Space size={6} wrap>
                <Tooltip title={editable(row) ? '' : 'Both the employee and line manager must sign the review first.'}>
                    <Button size='small' onClick={() => calibrate(row)} disabled={!editable(row)} loading={busy === row.key}>
                        {row.record?.calibration ? 'Update' : 'Calibrate'}
                    </Button>
                </Tooltip>
                {isCeo ? (
                    <Tooltip title={row.stage === 'validation' ? '' : 'Calibrate the rating first.'}>
                        <Button size='small' type='primary' onClick={() => validate(row)} disabled={row.stage !== 'validation'} loading={busy === row.key}>
                            Validate
                        </Button>
                    </Tooltip>
                ) : null}
            </Space>
        )
    }

    const scoreText = (value: number | null) =>
        value === null ? <Text type='secondary'>—</Text> : <Tag color={ratingColor(value)} style={{ margin: 0 }}>{value.toFixed(2)}</Tag>

    return (
        <Drawer
            open={open}
            onClose={onClose}
            width={isMobile ? '100%' : 1100}
            destroyOnClose
            title={
                <Space>
                    <SafetyOutlined />
                    {`Calibration${cycle ? ` · ${cycle.label}` : ''}`}
                </Space>
            }
            extra={
                isCeo && readyToValidate.length ? (
                    <Button type='primary' onClick={validateAll}>
                        {isMobile ? `Validate (${readyToValidate.length})` : `Validate all calibrated (${readyToValidate.length})`}
                    </Button>
                ) : null
            }
        >
            <Space direction='vertical' size={14} style={{ width: '100%' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    <Segmented
                        value={phase}
                        onChange={value => setPhase(value as PhaseKey)}
                        options={PHASES.map(p => ({ value: p.key, label: p.label }))}
                        block={isMobile}
                        style={isMobile ? { width: '100%' } : undefined}
                    />
                    <Select
                        allowClear
                        placeholder='All departments'
                        value={department}
                        onChange={setDepartment}
                        options={departments}
                        style={{ width: isMobile ? '100%' : 240 }}
                    />
                </div>

                <Alert
                    type='info'
                    showIcon
                    message='Review results across departments and levels for fair, consistent ratings'
                    description={
                        <Space direction='vertical' size={2}>
                            <Text style={{ fontSize: 12 }}>
                                Before: {before.map(b => `${b.band} ${b.count}`).join(' · ')}
                            </Text>
                            <Text style={{ fontSize: 12 }}>
                                After: {after.map(b => `${b.band} ${b.count}`).join(' · ')}
                            </Text>
                        </Space>
                    }
                />

                {isMobile ? (
                    <MobileCardList
                        data={visible}
                        getKey={row => row.key}
                        emptyText='No compacts in this cycle yet.'
                        renderCard={row => ({
                            title: row.name,
                            subtitle: [row.department, row.lineManagerName ? `Manager: ${row.lineManagerName}` : ''].filter(Boolean).join(' · ') || undefined,
                            badge: (
                                <Tag color={stageColor(row.stage)} style={{ margin: 0 }}>
                                    {stageLabel(row.stage)}
                                </Tag>
                            ),
                            fields: [
                                { label: 'Final', value: scoreText(row.original) },
                                { label: 'Calibrated', value: scoreInput(row) }
                            ],
                            note: editable(row) ? reasonInput(row) : row.record?.calibration?.reason || undefined,
                            actions: [<React.Fragment key='actions'>{rowActions(row)}</React.Fragment>]
                        })}
                    />
                ) : (
                    <Table
                        rowKey='key'
                        size='small'
                        dataSource={visible}
                        pagination={{ pageSize: 12, hideOnSinglePage: true }}
                        locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='No compacts in this cycle yet.' /> }}
                        columns={[
                            {
                                title: 'Employee',
                                key: 'name',
                                render: (_: unknown, row: (typeof visible)[number]) => (
                                    <Space direction='vertical' size={0}>
                                        <Text strong>{row.name}</Text>
                                        <Text type='secondary' style={{ fontSize: 12 }}>
                                            {[row.department, row.lineManagerName ? `Manager: ${row.lineManagerName}` : ''].filter(Boolean).join(' · ')}
                                        </Text>
                                    </Space>
                                )
                            },
                            {
                                title: 'Stage',
                                key: 'stage',
                                width: 150,
                                render: (_: unknown, row: (typeof visible)[number]) => (
                                    <Tag color={stageColor(row.stage)} style={{ margin: 0 }}>
                                        {stageLabel(row.stage)}
                                    </Tag>
                                )
                            },
                            { title: 'Final', key: 'final', width: 90, render: (_: unknown, row: (typeof visible)[number]) => scoreText(row.original) },
                            { title: 'Calibrated', key: 'calibrated', width: 130, render: (_: unknown, row: (typeof visible)[number]) => scoreInput(row) },
                            { title: 'Reason', key: 'reason', render: (_: unknown, row: (typeof visible)[number]) => reasonInput(row) },
                            { title: '', key: 'actions', width: 190, align: 'right' as const, render: (_: unknown, row: (typeof visible)[number]) => rowActions(row) }
                        ]}
                    />
                )}
            </Space>
        </Drawer>
    )
}
