import React, { useEffect, useMemo, useState } from 'react'
import {
    Card,
    Tabs,
    Table,
    Typography,
    Space,
    Tag,
    Button,
    Select,
    Modal,
    Input,
    message,
    Popconfirm,
    Statistic,
    Row,
    Col,
    Alert
} from 'antd'
import { Helmet } from 'react-helmet'
import { getAuth, onAuthStateChanged } from 'firebase/auth'
import { db, auth as clientAuth } from '@/firebase'
import {
    collection,
    onSnapshot,
    query,
    orderBy,
    limit,
    getDocs,
    where,
    deleteDoc,
    doc
} from 'firebase/firestore'
import { httpsCallable, getFunctions } from 'firebase/functions'
import {
    CheckCircleOutlined,
    DatabaseOutlined,
    FileSearchOutlined,
    ToolOutlined
} from '@ant-design/icons'
import { MotionCard } from '@/components/dashboards/metrics/Header'

const { Title, Text } = Typography

// Collections in scope
const KNOWN_COLLECTIONS = [
    'applications',
    'participants',
    'interventions',
    'consultants',
    'users',
    'tasks',
    'events',
    'resources',
    'assignedInterventions',
    'loginEvents'
]

function useIdToken() {
    const [token, setToken] = useState<string | null>(null)
    useEffect(() => {
        const auth = getAuth()
        return onAuthStateChanged(auth, async u => {
            if (u) setToken(await u.getIdToken())
            else setToken(null)
        })
    }, [])
    return token
}

const DashboardTab: React.FC = () => {
    const [recent, setRecent] = useState<any[]>([])
    const [count, setCount] = useState(0)

    useEffect(() => {
        const q = query(
            collection(db, 'loginEvents'),
            orderBy('ts', 'desc'),
            limit(20)
        )
        const unsub = onSnapshot(q, snap => {
            const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }))
            setRecent(rows)
        })
            // rough count (could be optimized with a counter)
            ; (async () => {
                const snap = await getDocs(collection(db, 'loginEvents'))
                setCount(snap.size)
            })()
        return () => unsub()
    }, [])

    const columns = [
        { title: 'Email', dataIndex: 'email' },
        { title: 'User', dataIndex: 'uid' },
        { title: 'User Agent', dataIndex: 'userAgent', ellipsis: true },
        {
            title: 'When',
            dataIndex: 'ts',
            render: (v: any) => (v?.toDate ? v.toDate().toLocaleString() : '—')
        }
    ]

    return (
        <Space direction='vertical' size='large' style={{ width: '100%' }}>
            <Row gutter={16}>
                <Col span={6}>
                    <Card>
                        <Statistic title='Login Events' value={count} />
                    </Card>
                </Col>
            </Row>
            <Card title='Recent Logins'>
                <Table
                    rowKey='id'
                    dataSource={recent}
                    columns={columns}
                    pagination={false}
                />
            </Card>
        </Space>
    )
}

// --- Replace your CollectionsTab with this version ---
const PAGE_SIZE = 25

// Define friendly columns per collection (fallbacks will auto-generate)
const COLLECTION_COLUMN_MAP: Record<
    string,
    {
        key: string
        title: string
        dataIndex?: string
        render?: (v: any, r: any) => React.ReactNode
    }[]
> = {
    applications: [
        { key: 'id', title: 'ID', dataIndex: 'id' },
        {
            key: 'applicant',
            title: 'Applicant',
            render: (_: any, r: any) => r?.applicantName || r?.name || '—'
        },
        { key: 'email', title: 'Email', dataIndex: 'email' },
        { key: 'status', title: 'Status', dataIndex: 'status' }
    ],
    participants: [
        { key: 'id', title: 'ID', dataIndex: 'id' },
        {
            key: 'name',
            title: 'Name',
            render: (_: any, r: any) => r?.displayName || r?.name || '—'
        },
        { key: 'email', title: 'Email', dataIndex: 'email' },
        { key: 'group', title: 'Group', dataIndex: 'group' }
    ],
    interventions: [
        { key: 'id', title: 'ID', dataIndex: 'id' },
        { key: 'title', title: 'Title', dataIndex: 'title' },
        { key: 'areaOfSupport', title: 'Area', dataIndex: 'areaOfSupport' },
        { key: 'status', title: 'Status', dataIndex: 'status' }
    ],
    consultants: [
        { key: 'id', title: 'ID', dataIndex: 'id' },
        {
            key: 'name',
            title: 'Name',
            render: (_: any, r: any) => r?.displayName || r?.name || '—'
        },
        { key: 'email', title: 'Email', dataIndex: 'email' },
        { key: 'specialty', title: 'Specialty', dataIndex: 'specialty' }
    ],
    users: [
        { key: 'id', title: 'ID', dataIndex: 'id' },
        {
            key: 'name',
            title: 'Name',
            render: (_: any, r: any) => r?.displayName || r?.name || '—'
        },
        { key: 'email', title: 'Email', dataIndex: 'email' },
        { key: 'role', title: 'Role', dataIndex: 'role' }
    ],
    tasks: [
        { key: 'id', title: 'ID', dataIndex: 'id' },
        { key: 'title', title: 'Title', dataIndex: 'title' },
        {
            key: 'assignee',
            title: 'Assignee',
            render: (_: any, r: any) => r?.assigneeEmail || r?.assigneeName || '—'
        },
        { key: 'status', title: 'Status', dataIndex: 'status' }
    ],
    events: [
        { key: 'id', title: 'ID', dataIndex: 'id' },
        { key: 'title', title: 'Title', dataIndex: 'title' },
        {
            key: 'date',
            title: 'Date',
            render: (_: any, r: any) =>
                r?.date?.toDate ? r.date.toDate().toLocaleString() : r?.date || '—'
        },
        { key: 'location', title: 'Location', dataIndex: 'location' }
    ],
    resources: [
        { key: 'id', title: 'ID', dataIndex: 'id' },
        { key: 'name', title: 'Name', dataIndex: 'name' },
        { key: 'type', title: 'Type', dataIndex: 'type' },
        { key: 'status', title: 'Status', dataIndex: 'status' }
    ],
    assignedInterventions: [
        { key: 'id', title: 'ID', dataIndex: 'id' },
        {
            key: 'interventionId',
            title: 'Intervention',
            dataIndex: 'interventionId'
        },
        {
            key: 'participantEmail',
            title: 'Participant',
            dataIndex: 'participantEmail'
        },
        {
            key: 'consultantEmail',
            title: 'Consultant',
            dataIndex: 'consultantEmail'
        },
        { key: 'status', title: 'Status', dataIndex: 'status' }
    ],
    loginEvents: [
        { key: 'id', title: 'ID', dataIndex: 'id' },
        { key: 'email', title: 'Email', dataIndex: 'email' },
        { key: 'uid', title: 'UID', dataIndex: 'uid' },
        {
            key: 'ts',
            title: 'When',
            render: (_: any, r: any) =>
                r?.ts?.toDate ? r.ts.toDate().toLocaleString() : '—'
        }
    ]
}

function buildColumnsForCollection(
    collectionName: string,
    onView: (rec: any) => void,
    onDelete: (rec: any) => void
) {
    const base = COLLECTION_COLUMN_MAP[collectionName] || [
        { key: 'id', title: 'ID', dataIndex: 'id' }
    ]

    // Add a few auto columns from remaining fields as a helpful preview
    const previewCols: {
        title: string
        key: string
        render: (v: any, r: any) => React.ReactNode
    }[] = []
    // We'll fill these at runtime by peeking at first row, handled in component.

    const actionsCol = {
        title: 'Actions',
        key: '__actions',
        fixed: 'right' as const,
        width: 160,
        render: (_: any, rec: any) => (
            <Space>
                <Button size='small' onClick={() => onView(rec)}>
                    View
                </Button>
                <Popconfirm
                    title='Delete this document?'
                    onConfirm={() => onDelete(rec)}
                >
                    <Button size='small' danger>
                        Delete
                    </Button>
                </Popconfirm>
            </Space>
        )
    }

    return { base, previewCols, actionsCol }
}

const CollectionsTab: React.FC = () => {
    const [selected, setSelected] = useState<string>('applications')
    const [rows, setRows] = useState<any[]>([])
    const [loading, setLoading] = useState(false)
    const [viewing, setViewing] = useState<any | null>(null)

    // pagination state (cursor-based)
    const [page, setPage] = useState(1)
    const [cursors, setCursors] = useState<any[]>([]) // store last docs per page
    const [total, setTotal] = useState<number | undefined>(undefined)

    // search
    const [qText, setQText] = useState('')

    // derive columns
    const [dynamicColumns, setDynamicColumns] = useState<any[]>([])

    const loadPage = async (direction: 'init' | 'next' | 'prev' = 'init') => {
        setLoading(true)
        try {
            let qRef = query(
                collection(db, selected),
                orderBy('__name__'),
                limit(PAGE_SIZE)
            )

            if (direction === 'next' && cursors[page - 1]) {
                // use last doc of current page as startAfter
                const startAfter = cursors[page - 1]
                // @ts-ignore
                qRef = query(
                    collection(db, selected),
                    orderBy('__name__'),
                    limit(PAGE_SIZE),
                    (window as any).firebaseStartAfter?.(startAfter) || ({} as any)
                )
            }
            if (direction === 'prev' && page > 2 && cursors[page - 3]) {
                // go back to the page before previous' last doc
                const before = cursors[page - 3]
                // @ts-ignore
                qRef = query(
                    collection(db, selected),
                    orderBy('__name__'),
                    limit(PAGE_SIZE),
                    (window as any).firebaseStartAfter?.(before) || ({} as any)
                )
            }

            // Because we can't import startAfter dynamically here, we implement a small helper:
            // Firestore SDK needs 'startAfter' symbol; we can emulate by building query with getDocs and then slicing.
            // Simpler approach: always fetch first N and compute total approximately once.
            const snap = await getDocs(qRef as any)
            const docs = snap.docs.map(d => ({
                id: d.id,
                ...d.data(),
                __ref: d.ref,
                __snap: d
            }))

            setRows(docs)

            // total (approx) — optional: run a full count once per collection
            if (total === undefined) {
                const whole = await getDocs(collection(db, selected))
                setTotal(whole.size)
            }

            // keep cursor (last doc of this page)
            const last = snap.docs[snap.docs.length - 1]
            if (direction === 'init') {
                setCursors(last ? [last] : [])
                setPage(1)
            } else if (direction === 'next') {
                setCursors(prev => {
                    const copy = [...prev]
                    copy[page] = last
                    return copy
                })
                setPage(p => p + 1)
            } else if (direction === 'prev') {
                setPage(p => Math.max(1, p - 1))
            }

            // build dynamic preview columns by peeking into first row
            if (docs.length) {
                const first = docs[0]
                const exclude = new Set(['id', '__ref', '__snap'])
                const keys = Object.keys(first)
                    .filter(k => !exclude.has(k))
                    .slice(0, 3)
                setDynamicColumns(
                    keys.map(k => ({
                        title: k,
                        dataIndex: k,
                        key: `dyn_${k}`,
                        ellipsis: true,
                        render: (v: any) =>
                            typeof v === 'object' ? JSON.stringify(v) : String(v ?? '—')
                    }))
                )
            } else {
                setDynamicColumns([])
            }
        } catch (e: any) {
            message.error(e.message)
        } finally {
            setLoading(false)
        }
    }

    // initial + on collection change
    useEffect(() => {
        setTotal(undefined)
        setCursors([])
        setPage(1)
        loadPage('init')
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selected])

    const onDelete = async (rec: any) => {
        try {
            await deleteDoc(rec.__ref || doc(collection(db, selected), rec.id))
            message.success('Deleted')
            // refresh current page
            loadPage('init')
        } catch (e: any) {
            message.error(e.message)
        }
    }

    const { base, actionsCol } = useMemo(
        () => buildColumnsForCollection(selected, rec => setViewing(rec), onDelete),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [selected]
    )

    const columns = useMemo(() => {
        // merge: base -> dynamic preview -> actions
        const merged = [
            ...base.map(c => ({
                ...c,
                dataIndex: c.dataIndex ?? undefined,
                render:
                    c.render ??
                    ((v: any) =>
                        typeof v === 'object' ? JSON.stringify(v) : String(v ?? '—'))
            })),
            ...dynamicColumns,
            actionsCol
        ]
        return merged as any[]
    }, [base, dynamicColumns, actionsCol])

    // client-side search across stringified row
    const filteredRows = useMemo(() => {
        const q = qText.trim().toLowerCase()
        if (!q) return rows
        return rows.filter(r => JSON.stringify(r).toLowerCase().includes(q))
    }, [rows, qText])

    return (
        <Space direction='vertical' style={{ width: '100%' }} size='large'>
            <Space wrap>
                <Text strong>Select collection:</Text>
                <Select
                    style={{ minWidth: 280 }}
                    value={selected}
                    onChange={setSelected}
                    options={KNOWN_COLLECTIONS.map(c => ({ value: c, label: c }))}
                />
                <Input.Search
                    allowClear
                    placeholder='Search in results…'
                    value={qText}
                    onChange={e => setQText(e.target.value)}
                    style={{ width: 320 }}
                />
                <Button onClick={() => loadPage('init')}>Refresh</Button>
            </Space>

            <Card
                title={`Collection: ${selected}`}
                extra={
                    <Space>
                        <span>
                            Page {page} {total !== undefined ? `• ~${total} docs` : ''}
                        </span>
                        <Button onClick={() => loadPage('prev')} disabled={page <= 1}>
                            Prev
                        </Button>
                        <Button
                            onClick={() => loadPage('next')}
                            disabled={rows.length < PAGE_SIZE}
                        >
                            Next
                        </Button>
                    </Space>
                }
            >
                <Table
                    rowKey='id'
                    loading={loading}
                    dataSource={filteredRows}
                    columns={columns}
                    scroll={{ x: true }}
                    pagination={false}
                />
            </Card>

            <Modal
                open={!!viewing}
                onCancel={() => setViewing(null)}
                onOk={() => setViewing(null)}
                title='Document'
                okText='Close'
                cancelButtonProps={{ style: { display: 'none' } }}
                width={720}
            >
                <pre style={{ whiteSpace: 'pre-wrap' }}>
                    {viewing ? JSON.stringify(viewing, null, 2) : ''}
                </pre>
            </Modal>
        </Space>
    )
}

const UsersTab: React.FC = () => {
    const token = useIdToken()
    const [rows, setRows] = useState<any[]>([])
    const [loading, setLoading] = useState(false)
    const [editingUser, setEditingUser] = useState<any>(null)
    const [newEmail, setNewEmail] = useState('')
    const [savingEmail, setSavingEmail] = useState(false)

    const fetchUsers = async () => {
        try {
            setLoading(true)
            const fn = httpsCallable(getFunctions(), 'listAuthUsers')
            const res: any = await fn({ pageSize: 1000 })
            setRows(res.data.users || [])
        } catch (e: any) {
            message.error(e.message)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        if (token) fetchUsers()
    }, [token])

    const saveEmail = async () => {
        if (!editingUser) return
        try {
            setSavingEmail(true)
            const fn = httpsCallable(getFunctions(), 'updateUserEmailCascade')
            const response: any = await fn({ uid: editingUser.uid, newEmail: newEmail.trim() })
            message.success(
                `Email updated in Auth and ${response.data?.updatedDocuments || 0} Firestore document(s).`
            )
            setEditingUser(null)
            await fetchUsers()
        } catch (error: any) {
            message.error(error?.message || 'Could not update the user email.')
        } finally {
            setSavingEmail(false)
        }
    }

    const columns = [
        { title: 'Email', dataIndex: 'email' },
        { title: 'Name', dataIndex: 'displayName' },
        { title: 'UID', dataIndex: 'uid' },
        { title: 'Created', dataIndex: 'creationTime' },
        { title: 'Last Sign-In', dataIndex: 'lastSignInTime' },
        {
            title: 'Disabled',
            dataIndex: 'disabled',
            render: (v: boolean) =>
                v ? <Tag color='red'>Yes</Tag> : <Tag color='green'>No</Tag>
        },
        {
            title: 'Actions',
            key: 'actions',
            render: (_: unknown, row: any) => (
                <Button
                    size='small'
                    onClick={() => {
                        setEditingUser(row)
                        setNewEmail(row.email || '')
                    }}
                >
                    Edit Email
                </Button>
            )
        }
    ]

    return (
        <Card
            title='Authentication Users'
            extra={<Button onClick={fetchUsers}>Refresh</Button>}
        >
            <Table
                rowKey='uid'
                loading={loading}
                dataSource={rows}
                columns={columns}
            />
            <Alert
                type='info'
                showIcon
                style={{ marginTop: 12 }}
                message='Sign-in times come from Firebase Auth metadata via Cloud Functions.'
            />
            <Modal
                open={!!editingUser}
                title='Change user email'
                okText='Update everywhere'
                confirmLoading={savingEmail}
                okButtonProps={{
                    disabled: !newEmail.trim() || newEmail.trim().toLowerCase() === String(editingUser?.email || '').toLowerCase()
                }}
                onOk={saveEmail}
                onCancel={() => setEditingUser(null)}
            >
                <Alert
                    type='warning'
                    showIcon
                    style={{ marginBottom: 16 }}
                    message='This changes the sign-in email and every matching value in Firestore.'
                />
                <Text type='secondary'>Current email</Text>
                <Input value={editingUser?.email || ''} disabled style={{ marginBottom: 12 }} />
                <Text type='secondary'>New email</Text>
                <Input
                    type='email'
                    autoFocus
                    value={newEmail}
                    onChange={event => setNewEmail(event.target.value)}
                    onPressEnter={saveEmail}
                />
            </Modal>
        </Card>
    )
}

const IntegrityTab: React.FC = () => {
    const [loading, setLoading] = useState(false)
    const [result, setResult] = useState<any>(null)
    const [errorMessage, setErrorMessage] = useState('')
    const [search, setSearch] = useState('')
    const [movFilter, setMovFilter] = useState<'all' | 'linked' | 'missing'>('all')
    const [progressFilter, setProgressFilter] = useState<'all' | 'started' | 'completed'>('all')

    const friendlyIntegrityError = (error: any) => {
        const code = String(error?.code || '').toLowerCase()
        const detail = String(error?.message || '').toLowerCase()
        if (code.includes('unauthenticated')) return 'Your session has expired. Sign in again, then rerun the integrity check.'
        if (code.includes('permission-denied')) return 'Your account is not authorized to run system repairs. Ask the platform administrator to grant access.'
        if (code.includes('not-found') || detail.includes('404') || detail.includes('cors')) return 'The integrity service is not available on the server yet. Deploy the repairMissingInterventionRecords Cloud Function, then try again.'
        if (code.includes('unavailable') || code.includes('deadline') || detail.includes('failed to fetch') || detail.includes('network')) return 'The integrity service could not be reached. Check your connection and try again in a moment.'
        if (code.includes('resource-exhausted')) return 'The check returned too much data in one request. Repair the current batch, then run the check again.'
        return 'We could not complete the integrity check. No records were changed. Please try again or review the Cloud Function logs.'
    }

    const run = async (commit: boolean) => {
        try {
            setLoading(true)
            setErrorMessage('')
            const fn = httpsCallable(getFunctions(), 'repairMissingInterventionRecords')
            const response: any = await fn({ commit, limit: 2000 })
            setResult(response.data)
            if (commit) message.success(`Repaired ${response.data?.repairedCount || 0} intervention record(s).`)
        } catch (error: any) {
            const friendly = friendlyIntegrityError(error)
            setErrorMessage(friendly)
            message.error(friendly)
        } finally {
            setLoading(false)
        }
    }

    const filteredRows = useMemo(() => {
        const term = search.trim().toLowerCase()
        return (result?.preview || []).filter((row: any) => {
            const matchesSearch = !term || [
                row.assignedInterventionId,
                row.beneficiaryName,
                row.interventionTitle,
                row.interventionId
            ].some(value => String(value || '').toLowerCase().includes(term))
            const matchesMov = movFilter === 'all' || (movFilter === 'linked' ? !!row.movDocumentId : !row.movDocumentId)
            const progress = Number(row.progress || 0)
            const matchesProgress = progressFilter === 'all' || (progressFilter === 'completed' ? progress >= 100 : progress > 0 && progress < 100)
            return matchesSearch && matchesMov && matchesProgress
        })
    }, [result, search, movFilter, progressFilter])

    const sunkenPanelStyle: React.CSSProperties = {
        padding: 16,
        borderRadius: 12,
        background: '#f5f7fb',
        border: '1px solid #d9e2f0',
        boxShadow: 'inset 0 2px 8px rgba(15, 23, 42, 0.06)'
    }

    const columns = [
        { title: 'Assignment', dataIndex: 'assignedInterventionId', ellipsis: true },
        { title: 'SME', dataIndex: 'beneficiaryName' },
        { title: 'Intervention', dataIndex: 'interventionTitle' },
        { title: 'Progress', dataIndex: 'progress', render: (value: number) => `${value || 0}%` },
        { title: 'MOV', dataIndex: 'movDocumentId', render: (value: string) => value ? <Tag color='blue'>Linked</Tag> : <Tag>None</Tag> }
    ]

    return (
        <Space direction='vertical' size='large' style={{ width: '100%' }}>

            {errorMessage && <Alert type='error' showIcon closable onClose={() => setErrorMessage('')} message='Integrity check could not run' description={errorMessage} />}
            <div style={sunkenPanelStyle}>
                <Space wrap>
                    <Button icon={<FileSearchOutlined />} loading={loading} onClick={() => run(false)}>Run integrity check</Button>
                    <Popconfirm
                        title='Repair all records shown in the latest check?'
                        description='Existing intervention records will not be overwritten.'
                        onConfirm={() => run(true)}
                        disabled={!result?.missingCount}
                    >
                        <Button icon={<ToolOutlined />} type='primary' loading={loading} disabled={!result?.missingCount}>Repair missing records</Button>
                    </Popconfirm>
                </Space>
            </div>
            {result && (
                <>
                    <Row gutter={[16, 16]}>
                        <Col xs={24} md={12} xl={6}><MotionCard><MotionCard.Metric icon={<FileSearchOutlined />} title='Assignments scanned' value={result.scannedAssignments || 0} subtitle='Assignments checked for activity' /></MotionCard></Col>
                        <Col xs={24} md={12} xl={6}><MotionCard><MotionCard.Metric icon={<DatabaseOutlined />} iconBg='rgba(22,119,255,.12)' title='Existing records' value={result.existingInterventionRecords || 0} subtitle='Operational intervention records' /></MotionCard></Col>
                        <Col xs={24} md={12} xl={6}><MotionCard><MotionCard.Metric icon={<ToolOutlined />} iconBg='rgba(250,173,20,.15)' title='Missing records' value={result.missingCount || 0} subtitle='Assignments requiring repair' /></MotionCard></Col>
                        <Col xs={24} md={12} xl={6}><MotionCard><MotionCard.Metric icon={<CheckCircleOutlined />} iconBg='rgba(82,196,26,.15)' title='Repaired' value={result.repairedCount || 0} subtitle='Records restored in this run' /></MotionCard></Col>
                    </Row>
                    {result.limited && <Alert type='warning' showIcon message='Result limit reached. Run the check again after repair.' />}
                    <MotionCard
                        title='Assignments requiring attention'
                        filterBar={
                            <Space wrap>
                                <Input.Search allowClear placeholder='Search SME, intervention or assignment' value={search} onChange={event => setSearch(event.target.value)} style={{ width: 320 }} />
                                <Select value={movFilter} onChange={setMovFilter} style={{ width: 170 }} options={[{ value: 'all', label: 'All MOV states' }, { value: 'linked', label: 'MOV linked' }, { value: 'missing', label: 'No MOV' }]} />
                                <Select value={progressFilter} onChange={setProgressFilter} style={{ width: 180 }} options={[{ value: 'all', label: 'All progress' }, { value: 'started', label: 'In progress' }, { value: 'completed', label: '100% completed' }]} />
                                <Tag color='blue'>{filteredRows.length} shown</Tag>
                            </Space>
                        }
                    >
                        <Table rowKey='assignedInterventionId' dataSource={filteredRows} columns={columns} pagination={{ pageSize: 20, showSizeChanger: true }} />
                    </MotionCard>
                </>
            )}
        </Space>
    )
}

const DangerZoneTab: React.FC = () => {
    const [emailOrUid, setEmailOrUid] = useState('')
    const [open, setOpen] = useState(false)
    const [loading, setLoading] = useState(false)

    const runCascade = async () => {
        try {
            setLoading(true)
            const fn = httpsCallable(getFunctions(), 'deleteUserCascade')
            const isUid = emailOrUid.length > 0 && !emailOrUid.includes('@')
            const res: any = await fn(
                isUid
                    ? { uid: emailOrUid, confirm: true }
                    : { email: emailOrUid, confirm: true }
            )
            message.success(`Deleted user ${res.data?.email || emailOrUid}`)
            setOpen(false)
        } catch (e: any) {
            message.error(e.message)
        } finally {
            setLoading(false)
        }
    }

    return (
        <Card
            title='Danger Zone: Cascade Delete User'
            style={{ borderColor: '#ff4d4f' }}
        >
            <Space direction='vertical' size='large' style={{ width: 520 }}>
                <Alert
                    type='warning'
                    showIcon
                    message='This will delete the Auth user and sweep Firestore collections for matching email/uid fields.'
                />
                <Input
                    placeholder='Enter email or uid'
                    value={emailOrUid}
                    onChange={e => setEmailOrUid(e.target.value)}
                />
                <Button danger disabled={!emailOrUid} onClick={() => setOpen(true)}>
                    Cascade Delete
                </Button>
            </Space>
            <Modal
                open={open}
                onCancel={() => setOpen(false)}
                confirmLoading={loading}
                onOk={runCascade}
                okText='Yes, delete'
                okButtonProps={{ danger: true }}
                title='Confirm Cascade Delete'
            >
                <p>This action is irreversible. Proceed?</p>
            </Modal>
        </Card>
    )
}

const AdminConsole: React.FC = () => {
    return (
        <div style={{ padding: 24, minHeight: '100vh' }}>
            <Helmet>
                <title>Programmer Admin Console</title>
            </Helmet>

            <IntegrityTab />
        </div>
    )
}

export default AdminConsole
