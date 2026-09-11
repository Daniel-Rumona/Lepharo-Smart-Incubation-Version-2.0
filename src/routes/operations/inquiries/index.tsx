import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
    Row,
    Col,
    Table,
    Tag,
    Button,
    Space,
    Card,
    Modal,
    Form,
    Input,
    Select,
    Typography,
    Statistic,
    Tooltip,
    DatePicker,
    message,
    Empty,
    Spin,
    Alert
} from 'antd'
import {
    MessageOutlined,
    ClockCircleOutlined,
    CheckCircleOutlined,
    CloseCircleOutlined,
    EyeOutlined,
    FilterOutlined,
    SendOutlined,
    ReloadOutlined
} from '@ant-design/icons'
import type { ColumnsType } from 'antd/es/table'
import dayjs, { Dayjs } from 'dayjs'

// Firebase
import { db } from '@/firebase'
import {
    collection,
    onSnapshot,
    orderBy,
    query,
    where,
    Timestamp,
    documentId,
    getDocs,
    updateDoc,
    doc,
    Unsubscribe,
    limit
} from 'firebase/firestore'

// Project hooks/components
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { DashboardHeaderCard, MotionCard } from '@/components/dashboards/metrics/Header'

type ReqStatus = 'pending' | 'approved' | 'rejected'

type DevPlanEditRequest = {
    programId?: string | null
    participantId?: string | null

    // “Who raised it”
    requesterUid?: string | null
    requesterName?: string | null
    requesterEmail?: string | null
    requesterDeptId?: string | null
    requesterDeptName?: string | null

    // “Who it targets / who must act”
    targetDeptId?: string | null
    targetDeptName?: string | null

    // inquiry body
    reason?: string | null

    status?: ReqStatus

    createdAt?: Timestamp | null
    updatedAt?: Timestamp | null

    // response fields (used by M&E before, we reuse it for Operations response)
    meRespondedAt?: Timestamp | null
    meRespondedBy?: string | null
    meRespondedByName?: string | null
    meResponseReason?: string | null

    // denorm (optional if your UI already stores these)
    participantName?: string | null
    programName?: string | null
}

type RowItem = DevPlanEditRequest & { id: string }

const { Title, Text } = Typography

const safe = (v: any, fallback = '—') => {
    const s = String(v ?? '').trim()
    return s || fallback
}

const tsToDayjs = (v: any): Dayjs | null => {
    try {
        if (v?.toDate && typeof v.toDate === 'function') return dayjs(v.toDate())
        return null
    } catch {
        return null
    }
}

function chunk<T>(arr: T[], size: number) {
    const out: T[][] = []
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
    return out
}

async function loadNameMap(
    colName: 'participants' | 'programs',
    ids: string[],
    fieldCandidates: string[]
): Promise<Map<string, string>> {
    const map = new Map<string, string>()
    const clean = Array.from(new Set(ids.filter(Boolean)))

    for (const group of chunk(clean, 10)) {
        const q = query(collection(db, colName), where(documentId(), 'in', group))
        const snap = await getDocs(q)
        snap.docs.forEach(d => {
            const data: any = d.data()
            const name =
                fieldCandidates.map(f => String(data?.[f] ?? '').trim()).find(x => !!x) || ''
            if (name) map.set(d.id, name)
        })
    }
    return map
}

const statusTag = (s?: string | null) => {
    const v = String(s || '').toLowerCase()
    if (v === 'approved') return <Tag color="green">Approved</Tag>
    if (v === 'rejected') return <Tag color="red">Rejected</Tag>
    return <Tag color="gold">Pending</Tag>
}

const findDiagnosticPlanDocId = async (programId: string, participantId: string) => {
    // “one plan per participant per program” -> take the latest just in case old duplicates exist
    const qy = query(
        collection(db, 'diagnosticPlans'),
        where('programId', '==', programId),
        where('participantId', '==', participantId),
        orderBy('createdAt', 'desc'),
        limit(1)
    )

    const snap = await getDocs(qy)
    if (snap.empty) return null
    return snap.docs[0].id
}

const OperationsInquiriesPage: React.FC = () => {
    const { user } = useFullIdentity()

    const role = String((user as any)?.role || '').toLowerCase()
    const myDeptId = (user as any)?.departmentId || null
    const myDeptName = (user as any)?.departmentName || null
    const myName = (user as any)?.name || (user as any)?.email || 'Operations'
    const myUid = (user as any)?.uid || null

    const isOps = role === 'operations'
    const canSeeAll = new Set(['director', 'admin', 'superadmin', 'projectadmin']).has(role)

    // filters
    const [statusFilter, setStatusFilter] = useState<ReqStatus | 'all'>('all')
    const [searchText, setSearchText] = useState('')
    const [dateFrom, setDateFrom] = useState<Dayjs | null>(dayjs().subtract(60, 'day'))
    const [dateTo, setDateTo] = useState<Dayjs | null>(dayjs())

    // data
    const [loading, setLoading] = useState(false)
    const [rows, setRows] = useState<RowItem[]>([])
    const [enriching, setEnriching] = useState(false)

    // modal
    const [open, setOpen] = useState(false)
    const [active, setActive] = useState<RowItem | null>(null)
    const [saving, setSaving] = useState(false)
    const [form] = Form.useForm()

    const unsubRef = useRef<Unsubscribe | null>(null)

    const shouldInclude = useCallback(
        (r: RowItem) => {

            // Ops: see what targets their dept (preferred), else fall back to dept-linked docs.
            if (isOps && !canSeeAll) {
                const t = String(r.targetDeptId || '').trim()
                const d = String(r.requesterDeptId || '').trim()
                const alt = String((r as any).departmentId || '').trim() // fallback if older docs used departmentId

                if (myDeptId) {
                    return t === myDeptId || alt === myDeptId || d === myDeptId
                }

                // If operations user has no deptId (bad config), still show nothing-sensitive:
                // show only if targetDeptName matches their deptName.
                if (myDeptName) {
                    const tn = String(r.targetDeptName || '').toLowerCase()
                    const mn = String(myDeptName || '').toLowerCase()
                    return tn && mn && tn.includes(mn)
                }
                return false
            }

            // Non-ops / admins: show all (within company)
            return true
        },
        [isOps, canSeeAll, myDeptId, myDeptName]
    )


    const fetchRealtime = useCallback(() => {
        if (unsubRef.current) {
            unsubRef.current()
            unsubRef.current = null
        }

        setLoading(true)

        // Query broadly, filter client-side for dept targeting (because OR conditions are messy in Firestore).
        // If you later standardize fields, we can tighten this to server-side filters.
        const base = collection(db, 'devPlanEditRequests')
        const qy = query(base, orderBy('createdAt', 'desc'))

        unsubRef.current = onSnapshot(
            qy,
            snap => {
                const list: RowItem[] = []
                snap.forEach(d => list.push({ id: d.id, ...(d.data() as any) }))
                setRows(list.filter(shouldInclude))
                setLoading(false)
            },
            err => {
                message.error(err?.message || 'Failed to load inquiries.')
                setLoading(false)
            }
        )
    }, [shouldInclude])

    useEffect(() => {
        fetchRealtime()
        return () => {
            if (unsubRef.current) unsubRef.current()
        }
    }, [fetchRealtime])

    // Enrich missing participantName/programName if only IDs exist (best-effort)
    useEffect(() => {
        const run = async () => {
            const needP = rows
                .filter(r => !String(r.participantName || '').trim() && String(r.participantId || '').trim())
                .map(r => String(r.participantId))
            const needProg = rows
                .filter(r => !String(r.programName || '').trim() && String(r.programId || '').trim())
                .map(r => String(r.programId))

            const pIds = Array.from(new Set(needP))
            const progIds = Array.from(new Set(needProg))

            if (!pIds.length && !progIds.length) return

            setEnriching(true)
            try {
                const [pMap, progMap] = await Promise.all([
                    pIds.length ? loadNameMap('participants', pIds, ['beneficiaryName', 'participantName', 'name']) : Promise.resolve(new Map()),
                    progIds.length ? loadNameMap('programs', progIds, ['name', 'programName']) : Promise.resolve(new Map())
                ])

                // apply to local rows (no writes)
                setRows(prev =>
                    prev.map(r => {
                        const pn = String(r.participantName || '').trim()
                        const gn = String(r.programName || '').trim()
                        return {
                            ...r,
                            participantName: pn || (r.participantId ? pMap.get(String(r.participantId)) || null : r.participantName || null),
                            programName: gn || (r.programId ? progMap.get(String(r.programId)) || null : r.programName || null)
                        }
                    })
                )
            } catch {
                // ignore
            } finally {
                setEnriching(false)
            }
        }

        run()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [rows.length])

    const filtered = useMemo(() => {
        const q = searchText.trim().toLowerCase()

        return rows
            .filter(r => {
                const s = String(r.status || 'pending').toLowerCase() as ReqStatus
                if (statusFilter !== 'all' && s !== statusFilter) return false

                const created = tsToDayjs(r.createdAt)
                if (dateFrom && created && created.isBefore(dateFrom.startOf('day'))) return false
                if (dateTo && created && created.isAfter(dateTo.endOf('day'))) return false

                if (!q) return true
                const hay = [
                    r.id,
                    r.participantName,
                    r.programName,
                    r.requesterName,
                    r.requesterDeptName,
                    r.targetDeptName,
                    r.reason,
                    r.meResponseReason
                ]
                    .map(x => String(x || '').toLowerCase())
                    .join(' | ')
                return hay.includes(q)
            })
            .map(r => ({
                ...r,
                status: (String(r.status || 'pending').toLowerCase() as ReqStatus) || 'pending'
            }))
    }, [rows, statusFilter, searchText, dateFrom, dateTo])

    const metrics = useMemo(() => {
        const all = filtered.length
        const pending = filtered.filter(r => String(r.status || 'pending') === 'pending').length
        const approved = filtered.filter(r => String(r.status || '') === 'approved').length
        const rejected = filtered.filter(r => String(r.status || '') === 'rejected').length
        return { all, pending, approved, rejected }
    }, [filtered])

    const columns: ColumnsType<RowItem> = [
        {
            title: 'Date',
            dataIndex: 'createdAt',
            key: 'createdAt',
            width: 140,
            render: v => {
                const d = tsToDayjs(v)
                return d ? (
                    <div>
                        <div style={{ fontWeight: 600 }}>{d.format('DD MMM YYYY')}</div>
                        <div style={{ fontSize: 12, color: '#888' }}>{d.format('HH:mm')}</div>
                    </div>
                ) : (
                    '—'
                )
            }
        },
        {
            title: 'SME',
            key: 'participant',
            render: (_, r) => (
                <div>
                    <div style={{ fontWeight: 600 }}>{safe(r.participantName, 'Unknown SME')}</div>
                    <div style={{ fontSize: 12, color: '#888' }}>{safe(r.programName, 'Program')}</div>
                </div>
            )
        },
        {
            title: 'From',
            key: 'from',
            width: 220,
            render: (_, r) => (
                <div>
                    <div style={{ fontWeight: 600 }}>{safe(r.requesterDeptName, 'Department')}</div>
                    <div style={{ fontSize: 12, color: '#888' }}>{safe(r.requesterName, 'Requester')}</div>
                </div>
            )
        },
        {
            title: 'Status',
            dataIndex: 'status',
            key: 'status',
            width: 120,
            render: s => statusTag(String(s || 'pending'))
        },
        {
            title: 'Actions',
            key: 'actions',
            width: 160,
            render: (_, r) => (
                <Space>
                    <Button
                        icon={<EyeOutlined />}
                        onClick={() => {
                            setActive(r)
                            setOpen(true)
                            form.setFieldsValue({
                                decision: String(r.status || 'pending'),
                                responseReason: r.meResponseReason || ''
                            })
                        }}
                    >
                        View
                    </Button>
                </Space>
            )
        }
    ]

    const canRespond = useMemo(() => {
        if (!active) return false
        const s = String(active.status || 'pending').toLowerCase()
        return s === 'pending'
    }, [active])

    const onSubmitResponse = async () => {
        if (!active) return

        try {
            const vals = await form.validateFields()
            const decision = String(vals.decision || '').toLowerCase()
            if (decision !== 'approved' && decision !== 'rejected') {
                message.error('Select Approved or Rejected.')
                return
            }

            const responseReason = String(vals.responseReason || '').trim() || null

            setSaving(true)

            // 1) Update the request doc
            await updateDoc(doc(db, 'devPlanEditRequests', active.id), {
                status: decision,
                meRespondedAt: Timestamp.now(),
                meRespondedBy: myUid || null,
                meRespondedByName: myName || null,
                meResponseReason: responseReason,
                updatedAt: Timestamp.now()
            })

            // 2) If approved, unlock the plan for editing
            if (decision === 'approved') {
                const pid = String(active.participantId || '').trim()
                const progId = String(active.programId || '').trim()

                if (!pid || !progId) {
                    throw new Error('Request is missing participantId/programId, cannot unlock plan.')
                }

                const planDocId = await findDiagnosticPlanDocId(progId, pid)
                if (!planDocId) {
                    throw new Error('No diagnostic plan found to unlock for this participant/program.')
                }

                await updateDoc(doc(db, 'diagnosticPlans', planDocId), {
                    devPlanEdit: {
                        unlocked: true,
                        requestId: active.id,
                        unlockedAt: Timestamp.now(),
                        unlockedByUid: myUid || null,
                        unlockedByName: myName || null,
                        unlockedReason: responseReason
                    },
                    devPlanEditUnlocked: true, // optional convenience boolean
                    devPlanEditRequestId: active.id, // optional convenience
                    updatedAt: Timestamp.now()
                })
            }

            message.success(`Request ${decision}.`)
            setOpen(false)
            setActive(null)
            form.resetFields()
        } catch (e: any) {
            if (e?.errorFields) return
            message.error(e?.message || 'Failed to submit response.')
        } finally {
            setSaving(false)
        }
    }


    return (
        <div style={{ padding: 16, minHeight: '100vh' }}>
            <Row gutter={[16, 16]} style={{ marginTop: 12 }}>
                <Col xs={24} md={6}>
                    <MotionCard>

                        <Statistic
                            title={
                                <Space>
                                    <MessageOutlined />
                                    <span>Total</span>
                                </Space>
                            }
                            value={metrics.all}
                        />

                    </MotionCard>
                </Col>

                <Col xs={24} md={6}>
                    <MotionCard>
                        <Statistic
                            title={
                                <Space>
                                    <ClockCircleOutlined />
                                    <span>Pending</span>
                                </Space>
                            }
                            value={metrics.pending}
                        />
                    </MotionCard>
                </Col>

                <Col xs={24} md={6}>
                    <MotionCard>
                        <Statistic
                            title={
                                <Space>
                                    <CheckCircleOutlined />
                                    <span>Approved</span>
                                </Space>
                            }
                            value={metrics.approved}
                        />
                    </MotionCard>
                </Col>

                <Col xs={24} md={6}>
                    <MotionCard>
                        <Statistic
                            title={
                                <Space>
                                    <CloseCircleOutlined />
                                    <span>Rejected</span>
                                </Space>
                            }
                            value={metrics.rejected}
                        />
                    </MotionCard>
                </Col>
            </Row>

            <MotionCard
                style={{ marginTop: 16 }}
                title={
                    <Space>
                        <FilterOutlined />
                        Filters
                    </Space>
                }
                extra={
                    <Button icon={<ReloadOutlined />} onClick={fetchRealtime}>
                        Refresh
                    </Button>
                }
            >
                <Row gutter={[12, 12]}>
                    <Col xs={24} md={6}>
                        <Select
                            value={statusFilter}
                            onChange={v => setStatusFilter(v)}
                            style={{ width: '100%' }}
                            options={[
                                { value: 'all', label: 'All statuses' },
                                { value: 'pending', label: 'Pending' },
                                { value: 'approved', label: 'Approved' },
                                { value: 'rejected', label: 'Rejected' }
                            ]}
                        />
                    </Col>

                    <Col xs={24} md={10}>
                        <Input
                            placeholder="Search SME, program, requester, reason..."
                            value={searchText}
                            onChange={e => setSearchText(e.target.value)}
                            allowClear
                        />
                    </Col>

                    <Col xs={12} md={4}>
                        <DatePicker
                            value={dateFrom}
                            onChange={d => setDateFrom(d)}
                            style={{ width: '100%' }}
                            placeholder="From"
                        />
                    </Col>

                    <Col xs={12} md={4}>
                        <DatePicker
                            value={dateTo}
                            onChange={d => setDateTo(d)}
                            style={{ width: '100%' }}
                            placeholder="To"
                        />
                    </Col>
                </Row>
            </MotionCard>

            <MotionCard style={{ marginTop: 16 }} bordered={false}>
                {loading ? (
                    <div style={{ padding: 24, textAlign: 'center' }}>
                        <Spin />
                    </div>
                ) : !filtered.length ? (
                    <Empty description="No inquiries found for your filters." />
                ) : (
                    <>
                        {enriching && (
                            <div style={{ marginBottom: 10 }}>
                                <Text type="secondary">Loading names…</Text>
                            </div>
                        )}
                        <Table
                            rowKey="id"
                            columns={columns}
                            dataSource={filtered}
                            pagination={{ pageSize: 10, showSizeChanger: true }}
                        />
                    </>
                )}
            </MotionCard>

            <Modal
                open={open}
                onCancel={() => {
                    setOpen(false)
                    setActive(null)
                    form.resetFields()
                }}
                title="Inquiry / Query"
                width={720}
                footer={
                    active ? (
                        <Space>
                            <Button
                                onClick={() => {
                                    setOpen(false)
                                    setActive(null)
                                    form.resetFields()
                                }}
                            >
                                Close
                            </Button>

                            {canRespond ? (
                                <Tooltip title="Submit your decision and response">
                                    <Button type="primary" icon={<SendOutlined />} loading={saving} onClick={onSubmitResponse}>
                                        Submit Response
                                    </Button>
                                </Tooltip>
                            ) : (
                                <Tag color="blue">Already Responded</Tag>
                            )}
                        </Space>
                    ) : null
                }
            >
                {!active ? null : (
                    <div>
                        <Row gutter={[12, 12]}>
                            <Col xs={24} md={12}>
                                <Card size="small" bordered>
                                    <Text type="secondary">SME</Text>
                                    <div style={{ fontWeight: 700, marginTop: 4 }}>
                                        {safe(active.participantName, 'Unknown SME')}
                                    </div>
                                    <div style={{ fontSize: 12, color: '#888' }}>
                                        {safe(active.programName, 'Program')}
                                    </div>
                                </Card>
                            </Col>

                            <Col xs={24} md={12}>
                                <Card size="small" bordered>
                                    <Text type="secondary">Status</Text>
                                    <div style={{ marginTop: 6 }}>{statusTag(active.status)}</div>
                                    <div style={{ fontSize: 12, color: '#888', marginTop: 6 }}>
                                        Created: {safe(tsToDayjs(active.createdAt)?.format('DD MMM YYYY HH:mm'), '—')}
                                    </div>
                                </Card>
                            </Col>
                        </Row>

                        <Card size="small" bordered style={{ marginTop: 12 }}>
                            <Title level={5} style={{ margin: 0 }}>
                                Details
                            </Title>
                            <div style={{ marginTop: 10 }}>
                                <Text type="secondary">From</Text>
                                <div style={{ fontWeight: 600 }}>
                                    {safe(active.requesterDeptName, 'Department')} • {safe(active.requesterName, 'Requester')}
                                </div>
                            </div>

                            <div style={{ marginTop: 10 }}>
                                <Text type="secondary">Inquiry / Reason</Text>
                                <div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>
                                    {safe(active.reason, '')}
                                </div>
                            </div>

                            {String(active.status || 'pending').toLowerCase() !== 'pending' && (
                                <div style={{ marginTop: 14 }}>
                                    <Text type="secondary">Response</Text>
                                    <div style={{ marginTop: 4, whiteSpace: 'pre-wrap' }}>
                                        {safe(active.meResponseReason, 'No response text provided.')}
                                    </div>
                                    <div style={{ fontSize: 12, color: '#888', marginTop: 6 }}>
                                        By: {safe(active.meRespondedByName, '—')} • At:{' '}
                                        {safe(tsToDayjs(active.meRespondedAt)?.format('DD MMM YYYY HH:mm'), '—')}
                                    </div>
                                </div>
                            )}
                        </Card>

                        <Card size="small" bordered style={{ marginTop: 12 }}>
                            <Title level={5} style={{ margin: 0 }}>
                                Respond
                            </Title>

                            <Form form={form} layout="vertical" style={{ marginTop: 10 }}>
                                <Row gutter={[12, 12]}>
                                    <Col xs={24} md={10}>
                                        <Form.Item
                                            name="decision"
                                            label="Decision"
                                            rules={[{ required: true, message: 'Select Approved or Rejected.' }]}
                                        >
                                            <Select
                                                disabled={!canRespond}
                                                options={[
                                                    { value: 'approved', label: 'Approve' },
                                                    { value: 'rejected', label: 'Reject' }
                                                ]}
                                            />
                                        </Form.Item>
                                    </Col>

                                    <Col xs={24} md={14}>
                                        <Form.Item
                                            name="responseReason"
                                            label="Response / Notes"
                                            rules={[
                                                {
                                                    required: true,
                                                    message: 'Write a response (reason/notes).'
                                                }
                                            ]}
                                        >
                                            <Input.TextArea
                                                disabled={!canRespond}
                                                rows={4}
                                                placeholder="Explain the decision or provide guidance..."
                                            />
                                        </Form.Item>
                                    </Col>
                                </Row>
                            </Form>

                            {!myDeptId && isOps && !canSeeAll && (
                                <Alert
                                    style={{ marginTop: 8 }}
                                    type="warning"
                                    showIcon
                                    message="Your user account has no departmentId. This page filters by department; please fix the user's department assignment in /users."
                                />
                            )}
                        </Card>
                    </div>
                )}
            </Modal>
        </div>
    )
}

export default OperationsInquiriesPage
