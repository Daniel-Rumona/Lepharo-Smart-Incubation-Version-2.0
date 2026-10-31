import React, { useEffect, useMemo, useState } from 'react'
import {
    Alert,
    Button,
    Card,
    Col,
    DatePicker,
    Drawer,
    Image,
    Input,
    InputNumber,
    Modal,
    Progress,
    Row,
    Select,
    Space,
    Tabs,
    Tag,
    Tooltip,
    Typography,
    message,
    theme
} from 'antd'
import {
    CheckCircleFilled,
    DeleteOutlined,
    EditOutlined,
    FilePdfOutlined,
    PlusOutlined,
    SaveOutlined,
    UnorderedListOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore'
import { db } from '@/firebase'
import { useIsMobile } from '@/hooks/useIsMobile'
import { EditableRows } from './EditableRows'
import { clean, newId, signatureFor } from './signature'
import { LibraryImportModal } from './LibraryImportModal'
import { ReviewPanel } from './ReviewPanel'
import { clusterColor, clusterLabel } from './CompetenciesModal'
import { downloadCompactPdf } from './compactPdf'
import {
    COMPACT_STATUS_META,
    PDP_STATUSES,
    PDP_TYPES,
    PHASES,
    RECALIBRATION_NOT_REASONS,
    RECALIBRATION_REASONS,
    RATING_SCALE,
    SECTIONS,
    STANDARDS,
    agreementKey,
    balanceWeights,
    compactDocId,
    compactStatus,
    headlineScore,
    ratingColor,
    ratingLabel,
    weightProblems,
    weightedScore,
    type CompactContent,
    type CompactItem,
    type CompactRevision,
    type ReviewRecord,
    type Competency,
    type ItemRating,
    type PdpGoal,
    type PerformanceCycle,
    type PhaseKey,
    type SectionKey,
    type Signature,
    type Signoff,
    type SignoffRole
} from './ipm'

const { Text, Title } = Typography

export type CompactEmployee = {
    id: string
    authUid?: string
    name?: string
    email?: string
    department?: string
    departmentId?: string | null
    position?: string
    lineManagerId?: string | null
}

/** 'manage': the line manager or HR. 'self': the employee's own compact. */
export type CompactMode = 'manage' | 'self'

const ratingOptions = RATING_SCALE.map(r => ({ value: r.value, label: `${r.value} · ${r.label}` }))
const proficiencyOptions = [1, 2, 3, 4, 5].map(value => ({ value, label: `Level ${value}` }))

const SIGNOFF_ROLES: { role: SignoffRole; label: string; help: string }[] = [
    { role: 'manager', label: 'Line manager', help: 'Agrees the targets, weights and standards.' },
    { role: 'employee', label: 'Employee', help: 'Agrees to deliver on the compact.' },
    { role: 'hr', label: 'HR compliance', help: 'Confirms the compact follows the IPM process.' }
]

export const CompactDrawer: React.FC<{
    open: boolean
    onClose: () => void
    mode: CompactMode
    employee: CompactEmployee | null
    lineManagerName?: string
    cycle: PerformanceCycle | null
    initial: CompactContent
    initialSignoff?: Signoff
    exists: boolean
    isLegacySeed?: boolean
    existingCreatedAt?: unknown
    attendanceSignals?: string[]
    competencies: Competency[]
    /** The signed-in user is this employee's line manager. */
    canSignAsManager: boolean
    /** The signed-in user is HR (or the CEO) and may record the compliance check. */
    canCheckAsHr: boolean
    /** This employee's review records for the cycle, by phase. */
    reviewRecords?: Partial<Record<PhaseKey, ReviewRecord>>
    user: { id: string; name: string; role: string }
    onSaved: () => void
}> = ({
    open,
    onClose,
    mode,
    employee,
    lineManagerName,
    cycle,
    initial,
    initialSignoff,
    exists,
    isLegacySeed,
    existingCreatedAt,
    attendanceSignals,
    competencies,
    canSignAsManager,
    canCheckAsHr,
    reviewRecords = {},
    user,
    onSaved
}) => {
    const { token } = theme.useToken()
    const isMobile = useIsMobile()
    const [content, setContent] = useState<CompactContent>(initial)
    const [signoff, setSignoff] = useState<Signoff>({})
    const [unlocked, setUnlocked] = useState(false)
    const [tab, setTab] = useState<string>('compact')
    const [saving, setSaving] = useState(false)
    const [libraryOpen, setLibraryOpen] = useState(false)
    const [recalibrateOpen, setRecalibrateOpen] = useState(false)
    const [recalibrateReason, setRecalibrateReason] = useState<CompactRevision['reason'] | undefined>()
    const [recalibrateNote, setRecalibrateNote] = useState('')

    useEffect(() => {
        if (!open) return
        setUnlocked(false)
        setTab('compact')
    }, [open])

    useEffect(() => {
        if (!open) return
        setContent(clean({ ...initial, pdp: initial.pdp || [] }))
        setSignoff(clean(initialSignoff || {}))
    }, [open, initial, initialSignoff])

    const initialKey = useMemo(() => agreementKey(initial), [initial])
    const changedSinceSigning = agreementKey(content) !== initialKey
    const anySigned = !!(signoff.manager || signoff.employee)
    const status = compactStatus(signoff)

    const isManage = mode === 'manage'
    const canEditCompact = isManage && (!anySigned || unlocked)
    const canEditPdp = true

    const problems = useMemo(() => weightProblems(content.sectionWeights, content.items), [content])
    const sectionTotal = SECTIONS.reduce((sum, s) => sum + Number(content.sectionWeights[s.key] || 0), 0)
    const scores = useMemo(
        () =>
            Object.fromEntries(
                PHASES.map(p => [p.key, weightedScore(content.sectionWeights, content.items, content.reviews[p.key]?.ratings)])
            ) as Record<PhaseKey, ReturnType<typeof weightedScore>>,
        [content]
    )

    const employeeUid = employee ? employee.authUid || employee.id : ''
    const docRef = cycle && employeeUid ? doc(db, 'employeePerformanceCompacts', compactDocId(cycle.id, employeeUid)) : null

    // ---- Editing helpers ----
    const setSectionWeight = (key: SectionKey, weight: number) =>
        setContent(c => ({ ...c, sectionWeights: { ...c.sectionWeights, [key]: weight } }))

    const updateItem = (id: string, patch: Partial<CompactItem>) =>
        setContent(c => ({ ...c, items: c.items.map(item => (item.id === id ? { ...item, ...patch } : item)) }))

    const addItem = (section: SectionKey) =>
        setContent(c => {
            const used = c.items.filter(item => item.section === section).reduce((sum, item) => sum + Number(item.weight || 0), 0)
            return { ...c, items: [...c.items, { id: newId('item'), section, kpa: '', kpi: '', weight: Math.max(100 - used, 0) }] }
        })

    const removeItem = (id: string) => setContent(c => ({ ...c, items: c.items.filter(item => item.id !== id) }))

    const balanceSection = (section: SectionKey) =>
        setContent(c => {
            const balanced = new Map(balanceWeights(c.items.filter(item => item.section === section)).map(item => [item.id, item]))
            return { ...c, items: c.items.map(item => balanced.get(item.id) || item) }
        })

    const addFromLibrary = (items: CompactItem[]) => {
        setContent(c => ({ ...c, items: [...c.items, ...items] }))
        setLibraryOpen(false)
        message.success(`${items.length} item${items.length === 1 ? '' : 's'} added. Check the weights add up to 100%.`)
    }

    const updateRating = (phase: PhaseKey, itemId: string, patch: Partial<ItemRating>) =>
        setContent(c => {
            const review = c.reviews[phase] || { ratings: {} }
            return {
                ...c,
                reviews: {
                    ...c.reviews,
                    [phase]: { ...review, ratings: { ...review.ratings, [itemId]: { ...review.ratings[itemId], ...patch } } }
                }
            }
        })

    const updateOverall = (phase: PhaseKey, patch: { overallSelfComment?: string; overallManagerComment?: string }) =>
        setContent(c => ({ ...c, reviews: { ...c.reviews, [phase]: { ratings: {}, ...c.reviews[phase], ...patch } } }))

    const updateGoal = (id: string, patch: Partial<PdpGoal>) =>
        setContent(c => ({ ...c, pdp: (c.pdp || []).map(goal => (goal.id === id ? { ...goal, ...patch } : goal)) }))

    const addGoal = () =>
        setContent(c => ({
            ...c,
            pdp: [...(c.pdp || []), { id: newId('goal'), need: '', action: '', type: 'training', status: 'planned' }]
        }))

    const removeGoal = (id: string) => setContent(c => ({ ...c, pdp: (c.pdp || []).filter(goal => goal.id !== id) }))

    // ---- Saving and signing ----

    /** Manager or HR: write the whole compact. Editing what was agreed withdraws the signatures. */
    const saveCompact = async (addSignature?: { role: SignoffRole; signature: Signature }, revision?: CompactRevision) => {
        if (!employee || !cycle || !docRef) return false
        if (problems.length) {
            setTab('compact')
            message.warning('Fix the weights before saving: they must add up to 100%.')
            return false
        }
        const kept: Signoff = changedSinceSigning ? {} : signoff
        const nextSignoff: Signoff = addSignature ? { ...kept, [addSignature.role]: addSignature.signature } : kept
        const reviews = Object.fromEntries(
            PHASES.filter(p => content.reviews[p.key]).map(p => [p.key, { ...content.reviews[p.key], score: scores[p.key].score }])
        )
        const headline = headlineScore(reviews)
        const record = clean({
            cycleId: cycle.id,
            financialYear: cycle.label,
            employeeId: employee.id,
            employeeAuthUid: employeeUid,
            employeeName: employee.name || '',
            employeeEmail: employee.email || '',
            department: employee.department || null,
            departmentId: employee.departmentId || null,
            position: employee.position || null,
            lineManagerId: employee.lineManagerId || null,
            sectionWeights: content.sectionWeights,
            items: content.items,
            reviews,
            pdp: content.pdp || [],
            revisions: revision ? [...(initial.revisions || []), revision] : initial.revisions || [],
            signoff: nextSignoff,
            status: compactStatus(nextSignoff),
            finalRating: headline.score,
            phase: headline.phase || 'midYear',
            reviewerId: user.id,
            reviewerName: user.name,
            reviewerRole: user.role,
            attendanceEvidence: attendanceSignals || null
        })
        setSaving(true)
        try {
            await setDoc(docRef, { ...record, createdAt: existingCreatedAt || serverTimestamp(), updatedAt: serverTimestamp() })
            message.success(
                addSignature
                    ? 'Compact signed.'
                    : changedSinceSigning && anySigned
                      ? 'Compact saved. The changes withdrew the earlier signatures.'
                      : 'Compact saved.'
            )
            onSaved()
            return true
        } catch (error) {
            console.error(error)
            message.error('Could not save the compact.')
            return false
        } finally {
            setSaving(false)
        }
    }

    const confirmSave = () => {
        if (anySigned && changedSinceSigning) {
            setRecalibrateReason(undefined)
            setRecalibrateNote('')
            setRecalibrateOpen(true)
            return
        }
        saveCompact()
    }

    const saveRecalibration = async () => {
        if (!recalibrateReason) {
            message.warning('Choose why the goals are being adjusted.')
            return
        }
        const ok = await saveCompact(undefined, {
            at: new Date().toISOString(),
            by: user.id,
            byName: user.name,
            reason: recalibrateReason,
            note: recalibrateNote.trim()
        })
        if (ok) setRecalibrateOpen(false)
    }

    /** Employee: their development plan only. */
    const saveOwnPdp = async () => {
        if (!docRef) return
        setSaving(true)
        try {
            await updateDoc(docRef, { pdp: clean(content.pdp || []), updatedAt: serverTimestamp() })
            message.success('Development plan saved.')
            onSaved()
        } catch (error) {
            console.error(error)
            message.error('Could not save your development plan.')
        } finally {
            setSaving(false)
        }
    }

    const sign = async (role: SignoffRole) => {
        const signature = await signatureFor(user)
        if (role === 'employee') {
            if (!docRef) return
            setSaving(true)
            try {
                await updateDoc(docRef, {
                    'signoff.employee': clean(signature),
                    status: signoff.manager ? 'agreed' : 'awaiting-manager',
                    updatedAt: serverTimestamp()
                })
                message.success('You signed your compact.')
                onSaved()
            } catch (error) {
                console.error(error)
                message.error('Could not sign the compact.')
            } finally {
                setSaving(false)
            }
            return
        }
        await saveCompact({ role, signature })
    }

    const signOrConfirm = (role: SignoffRole) => {
        const label = SIGNOFF_ROLES.find(r => r.role === role)!.label.toLowerCase()
        Modal.confirm({
            title: `Sign as ${label}?`,
            content:
                role === 'hr'
                    ? 'This records that the compact was checked for compliance with the IPM process.'
                    : role === 'employee'
                      ? 'By signing you agree to the targets, weights and standards in this compact.'
                      : 'This saves the compact and signs it as agreed. The employee then signs.',
            okText: 'Sign',
            onOk: () => sign(role)
        })
    }

    const downloadPdf = () => {
        if (!employee || !cycle) return
        downloadCompactPdf({
            cycle,
            employee: { name: employee.name || '', position: employee.position, department: employee.department },
            lineManagerName,
            content,
            signoff,
            scores: { midYear: scores.midYear.score, yearEnd: scores.yearEnd.score }
        }).catch(error => {
            console.error(error)
            message.error('Could not build the PDF.')
        })
    }

    // ---- Rendering ----
    const sectionItems = (key: SectionKey) => content.items.filter(item => item.section === key)

    const signoffCard = (
        <Card
            size='small'
            title='Agreement'
            extra={
                <Tag color={COMPACT_STATUS_META[status].color} style={{ borderRadius: 999, margin: 0 }}>
                    {COMPACT_STATUS_META[status].label}
                </Tag>
            }
        >
            <Row gutter={[12, 12]}>
                {SIGNOFF_ROLES.map(({ role, label, help }) => {
                    const signature = signoff[role]
                    const canSign =
                        !signature &&
                        ((role === 'manager' && isManage && canSignAsManager) ||
                            (role === 'employee' && mode === 'self' && exists) ||
                            (role === 'hr' && isManage && canCheckAsHr && !!signoff.manager && !!signoff.employee))
                    return (
                        <Col xs={24} md={8} key={role}>
                            <div
                                style={{
                                    border: `1px solid ${token.colorBorderSecondary}`,
                                    borderRadius: 12,
                                    padding: 12,
                                    height: '100%'
                                }}
                            >
                                <Text type='secondary' style={{ fontSize: 12 }}>{label}</Text>
                                {signature ? (
                                    <Space direction='vertical' size={2} style={{ display: 'flex', marginTop: 4 }}>
                                        {signature.signatureURL ? (
                                            <Image src={signature.signatureURL} height={36} preview={false} alt='Signature' fallback='' />
                                        ) : null}
                                        <Space size={6}>
                                            <CheckCircleFilled style={{ color: token.colorSuccess }} />
                                            <Text strong>{signature.name}</Text>
                                        </Space>
                                        <Text type='secondary' style={{ fontSize: 12 }}>{dayjs(signature.at).format('D MMM YYYY, HH:mm')}</Text>
                                    </Space>
                                ) : (
                                    <Space direction='vertical' size={6} style={{ display: 'flex', marginTop: 4 }}>
                                        <Text type='secondary' style={{ fontSize: 12 }}>{help}</Text>
                                        {canSign ? (
                                            <Button type='primary' size='small' onClick={() => signOrConfirm(role)} loading={saving}>
                                                Sign
                                            </Button>
                                        ) : (
                                            <Text type='secondary' style={{ fontSize: 12 }}>Not signed</Text>
                                        )}
                                    </Space>
                                )}
                            </div>
                        </Col>
                    )
                })}
            </Row>
            {isManage && anySigned && !unlocked ? (
                <Alert
                    type='info'
                    showIcon
                    style={{ marginTop: 12 }}
                    message='The compact is locked while it is signed.'
                    action={
                        <Button size='small' icon={<EditOutlined />} onClick={() => setUnlocked(true)}>
                            Change compact
                        </Button>
                    }
                />
            ) : null}
            {isManage && unlocked && changedSinceSigning ? (
                <Alert type='warning' showIcon style={{ marginTop: 12 }} message='Saving these changes withdraws the signatures.' />
            ) : null}
            {mode === 'self' && !exists ? (
                <Alert type='info' showIcon style={{ marginTop: 12 }} message='Your line manager has not started your compact yet.' />
            ) : null}
        </Card>
    )

    const itemColumns = (section: SectionKey) => {
        const kpaColumn = {
            title: section === 'competencies' ? 'Competency' : 'KPA and KPI',
            key: 'kpa',
            width: 340,
            render: (_: any, item: CompactItem) => (
                <Space direction='vertical' size={6} style={{ width: '100%' }}>
                    {item.source ? (
                        <Tag style={{ borderRadius: 999, margin: 0 }} color={item.cluster ? clusterColor(item.cluster) : 'geekblue'}>
                            {item.cluster ? clusterLabel(item.cluster) : item.source.label || 'Linked'}
                        </Tag>
                    ) : null}
                    <Input
                        placeholder={section === 'competencies' ? 'Competency' : 'Key performance area'}
                        value={item.kpa}
                        disabled={!canEditCompact}
                        status={item.kpa.trim() ? undefined : 'error'}
                        onChange={e => updateItem(item.id, { kpa: e.target.value })}
                    />
                    <Input.TextArea
                        placeholder={section === 'competencies' ? 'Expected behaviours' : 'Indicator: how achievement is measured'}
                        autoSize={{ minRows: 1, maxRows: 4 }}
                        value={item.kpi}
                        disabled={!canEditCompact}
                        onChange={e => updateItem(item.id, { kpi: e.target.value })}
                    />
                </Space>
            )
        }
        const weightColumn = {
            title: 'Weight',
            key: 'weight',
            width: 110,
            render: (_: any, item: CompactItem) => (
                <InputNumber
                    min={0}
                    max={100}
                    value={item.weight}
                    addonAfter='%'
                    disabled={!canEditCompact}
                    onChange={value => updateItem(item.id, { weight: Number(value || 0) })}
                />
            )
        }
        const removeColumn = {
            title: '',
            key: 'remove',
            width: 48,
            render: (_: any, item: CompactItem) =>
                canEditCompact ? (
                    <Tooltip title='Remove item'>
                        <Button type='text' danger icon={<DeleteOutlined />} onClick={() => removeItem(item.id)} />
                    </Tooltip>
                ) : null
        }
        if (section === 'competencies') {
            return [
                kpaColumn,
                {
                    title: 'Cluster',
                    key: 'cluster',
                    width: 150,
                    render: (_: any, item: CompactItem) => (
                        <Select
                            placeholder='Cluster'
                            style={{ width: '100%' }}
                            value={item.cluster}
                            disabled={!canEditCompact}
                            options={['leadership', 'behavioural', 'functional'].map(value => ({ value, label: clusterLabel(value as any) }))}
                            onChange={value => updateItem(item.id, { cluster: value })}
                        />
                    )
                },
                {
                    title: 'Required proficiency',
                    key: 'requiredLevel',
                    width: 170,
                    render: (_: any, item: CompactItem) => (
                        <Select
                            placeholder='Level'
                            style={{ width: '100%' }}
                            value={item.requiredLevel}
                            disabled={!canEditCompact}
                            options={proficiencyOptions}
                            onChange={value => updateItem(item.id, { requiredLevel: value })}
                        />
                    )
                },
                weightColumn,
                removeColumn
            ]
        }
        return [
            kpaColumn,
            {
                title: 'Standard',
                key: 'standard',
                width: 150,
                render: (_: any, item: CompactItem) => (
                    <Select
                        allowClear
                        placeholder='Measure'
                        style={{ width: '100%' }}
                        value={item.standard}
                        disabled={!canEditCompact}
                        options={STANDARDS}
                        onChange={value => updateItem(item.id, { standard: value })}
                    />
                )
            },
            {
                title: 'Target',
                key: 'target',
                render: (_: any, item: CompactItem) => (
                    <Input.TextArea
                        placeholder='e.g. 95% by 31 Dec'
                        autoSize={{ minRows: 1, maxRows: 3 }}
                        value={item.target}
                        disabled={!canEditCompact}
                        onChange={e => updateItem(item.id, { target: e.target.value })}
                    />
                )
            },
            {
                title: 'Evidence',
                key: 'evidence',
                render: (_: any, item: CompactItem) => (
                    <Input.TextArea
                        placeholder='Source of evidence'
                        autoSize={{ minRows: 1, maxRows: 3 }}
                        value={item.evidence}
                        disabled={!canEditCompact}
                        onChange={e => updateItem(item.id, { evidence: e.target.value })}
                    />
                )
            },
            weightColumn,
            removeColumn
        ]
    }

    const compactTab = (
        <Space direction='vertical' size={16} style={{ width: '100%' }}>
            {signoffCard}

            {isLegacySeed ? (
                <Alert
                    type='info'
                    showIcon
                    message='Started from this employee’s earlier compact'
                    description='Ratings saved before cycles existed have been carried over. Saving stores them as this cycle’s compact.'
                />
            ) : null}

            <Card
                size='small'
                title='Section weights'
                extra={
                    <Space>
                        {canEditCompact ? (
                            <Button size='small' icon={<UnorderedListOutlined />} onClick={() => setLibraryOpen(true)}>
                                Add from library
                            </Button>
                        ) : null}
                        <Tag color={sectionTotal === 100 ? 'green' : 'red'} style={{ margin: 0 }}>
                            {sectionTotal}% of 100%
                        </Tag>
                    </Space>
                }
            >
                <Row gutter={[12, 12]}>
                    {SECTIONS.map(section => (
                        <Col xs={12} md={6} key={section.key}>
                            <Text type='secondary' style={{ fontSize: 12 }}>{section.label}</Text>
                            <InputNumber
                                min={0}
                                max={100}
                                value={content.sectionWeights[section.key]}
                                disabled={!canEditCompact}
                                onChange={value => setSectionWeight(section.key, Number(value || 0))}
                                addonAfter='%'
                                style={{ width: '100%' }}
                            />
                        </Col>
                    ))}
                </Row>
                <div style={{ display: 'flex', height: 6, borderRadius: 999, overflow: 'hidden', marginTop: 12, background: token.colorFillSecondary }}>
                    {SECTIONS.filter(s => content.sectionWeights[s.key] > 0).map((s, i) => (
                        <div
                            key={s.key}
                            style={{
                                width: `${Math.min(content.sectionWeights[s.key], 100)}%`,
                                background: [token.colorPrimary, token.colorInfo, token.colorWarning, token.colorSuccess][i % 4]
                            }}
                        />
                    ))}
                </div>
            </Card>

            {SECTIONS.map(section => {
                const items = sectionItems(section.key)
                const weight = content.sectionWeights[section.key]
                const itemTotal = items.reduce((sum, item) => sum + Number(item.weight || 0), 0)
                if (!weight && !items.length) {
                    return canEditCompact ? (
                        <Button key={section.key} type='dashed' block icon={<PlusOutlined />} onClick={() => addItem(section.key)}>
                            Add {section.label.toLowerCase()}
                        </Button>
                    ) : null
                }
                return (
                    <Card
                        key={section.key}
                        size='small'
                        title={
                            <Space direction='vertical' size={0} style={{ padding: '6px 0' }}>
                                <Space>
                                    <Text strong>{section.label}</Text>
                                    <Tag style={{ borderRadius: 999 }}>{weight}% of compact</Tag>
                                </Space>
                                <Text type='secondary' style={{ fontSize: 12, fontWeight: 400 }}>{section.description}</Text>
                            </Space>
                        }
                        extra={
                            <Space>
                                {canEditCompact && items.length > 0 && itemTotal !== 100 ? (
                                    <Button size='small' type='link' onClick={() => balanceSection(section.key)}>
                                        Balance
                                    </Button>
                                ) : null}
                                <Tag color={itemTotal === 100 ? 'green' : 'red'} style={{ margin: 0 }}>Items {itemTotal}%</Tag>
                            </Space>
                        }
                    >
                        <EditableRows
                            rows={items}
                            isMobile={isMobile}
                            scrollX={900}
                            emptyText='No items yet'
                            columns={itemColumns(section.key)}
                        />
                        {canEditCompact ? (
                            <Button type='link' icon={<PlusOutlined />} style={{ paddingLeft: 0, marginTop: 8 }} onClick={() => addItem(section.key)}>
                                Add item
                            </Button>
                        ) : null}
                    </Card>
                )
            })}
        </Space>
    )

    const sectionLabel = (item: CompactItem) => SECTIONS.find(s => s.key === item.section)?.label || ''

    const reviewTab = (phase: PhaseKey) => (
        <ReviewPanel
            phase={phase}
            phaseLabel={PHASES.find(p => p.key === phase)!.label}
            mode={mode}
            items={content.items.filter(item => Number(content.sectionWeights[item.section] || 0) > 0)}
            sectionLabel={sectionLabel}
            review={content.reviews[phase] || { ratings: {} }}
            result={scores[phase]}
            weightsValid={!problems.length}
            record={reviewRecords[phase] || null}
            employee={employee}
            cycle={cycle}
            user={user}
            isLineManager={canSignAsManager}
            isOverseer={canCheckAsHr}
            onRating={(itemId, patch) => updateRating(phase, itemId, patch)}
            onOverall={patch => updateOverall(phase, patch)}
            saveCompact={() => saveCompact()}
            onChanged={onSaved}
        />
    )

    const competencyItems = content.items.filter(item => item.section === 'competencies')
    const pdpTab = (
        <Space direction='vertical' size={16} style={{ width: '100%' }}>
            <Alert
                type='info'
                showIcon
                message='Personal development plan'
                description='A living, non-binding plan the employee owns: development needs (often competency gaps), how they will be closed, the support needed, and how useful it turned out to be. It stays open after the compact is signed.'
            />
            <EditableRows
                rows={content.pdp || []}
                isMobile={isMobile}
                scrollX={1100}
                emptyText='No development goals yet'
                columns={[
                    {
                        title: 'Development need',
                        key: 'need',
                        width: 260,
                        render: (_: any, goal: PdpGoal) => (
                            <Space direction='vertical' size={6} style={{ width: '100%' }}>
                                <Input
                                    placeholder='Knowledge, skill or competency gap'
                                    value={goal.need}
                                    disabled={!canEditPdp}
                                    onChange={e => updateGoal(goal.id, { need: e.target.value })}
                                />
                                {competencyItems.length ? (
                                    <Select
                                        allowClear
                                        size='small'
                                        placeholder='Linked competency'
                                        value={goal.competencyItemId}
                                        disabled={!canEditPdp}
                                        options={competencyItems.map(item => ({ value: item.id, label: item.kpa }))}
                                        onChange={value => updateGoal(goal.id, { competencyItemId: value })}
                                    />
                                ) : null}
                            </Space>
                        )
                    },
                    {
                        title: 'Action',
                        key: 'action',
                        width: 240,
                        render: (_: any, goal: PdpGoal) => (
                            <Space direction='vertical' size={6} style={{ width: '100%' }}>
                                <Select
                                    value={goal.type}
                                    disabled={!canEditPdp}
                                    options={PDP_TYPES}
                                    onChange={value => updateGoal(goal.id, { type: value })}
                                />
                                <Input.TextArea
                                    placeholder='What will be done'
                                    autoSize={{ minRows: 1, maxRows: 4 }}
                                    value={goal.action}
                                    disabled={!canEditPdp}
                                    onChange={e => updateGoal(goal.id, { action: e.target.value })}
                                />
                            </Space>
                        )
                    },
                    {
                        title: 'Support and resources',
                        key: 'support',
                        render: (_: any, goal: PdpGoal) => (
                            <Input.TextArea
                                placeholder='Budget, time off, mentor'
                                autoSize={{ minRows: 1, maxRows: 4 }}
                                value={goal.support}
                                disabled={!canEditPdp}
                                onChange={e => updateGoal(goal.id, { support: e.target.value })}
                            />
                        )
                    },
                    {
                        title: 'Due',
                        key: 'dueDate',
                        width: 150,
                        render: (_: any, goal: PdpGoal) => (
                            <DatePicker
                                value={goal.dueDate ? dayjs(goal.dueDate) : null}
                                disabled={!canEditPdp}
                                format='D MMM YYYY'
                                onChange={value => updateGoal(goal.id, { dueDate: value ? value.format('YYYY-MM-DD') : undefined })}
                            />
                        )
                    },
                    {
                        title: 'Progress',
                        key: 'status',
                        width: 170,
                        render: (_: any, goal: PdpGoal) => (
                            <Space direction='vertical' size={6} style={{ width: '100%' }}>
                                <Select
                                    value={goal.status}
                                    disabled={!canEditPdp}
                                    options={PDP_STATUSES.map(s => ({ value: s.value, label: s.label }))}
                                    onChange={value => updateGoal(goal.id, { status: value })}
                                />
                                {goal.status === 'done' ? (
                                    <Select
                                        allowClear
                                        size='small'
                                        placeholder='How useful was it?'
                                        value={goal.effectiveness ?? undefined}
                                        disabled={!canEditPdp}
                                        options={RATING_SCALE.map(r => ({ value: r.value, label: `${r.value} of 5` }))}
                                        onChange={value => updateGoal(goal.id, { effectiveness: value ?? null })}
                                    />
                                ) : null}
                            </Space>
                        )
                    },
                    {
                        title: '',
                        key: 'remove',
                        width: 48,
                        render: (_: any, goal: PdpGoal) =>
                            canEditPdp ? (
                                <Tooltip title='Remove goal'>
                                    <Button type='text' danger icon={<DeleteOutlined />} onClick={() => removeGoal(goal.id)} />
                                </Tooltip>
                            ) : null
                    }
                ]}
            />
            {canEditPdp ? (
                <Button type='dashed' block icon={<PlusOutlined />} onClick={addGoal}>
                    Add development goal
                </Button>
            ) : null}
        </Space>
    )

    const phaseLabel = (phase: PhaseKey) => {
        const result = scores[phase]
        const label = PHASES.find(p => p.key === phase)!.label
        return result.score !== null ? `${label} · ${result.score.toFixed(1)}` : label
    }

    const pdpCount = (content.pdp || []).length

    return (
        <Drawer
            open={open}
            onClose={onClose}
            width={isMobile ? '100%' : 1180}
            destroyOnClose
            title={
                <Space direction='vertical' size={0}>
                    <Text strong>{mode === 'self' ? 'My performance compact' : employee?.name || 'Employee'}</Text>
                    <Text type='secondary' style={{ fontSize: 12, fontWeight: 400 }}>
                        {[
                            cycle?.label,
                            employee?.position,
                            employee?.department,
                            lineManagerName ? `Line manager: ${lineManagerName}` : ''
                        ]
                            .filter(Boolean)
                            .join(' · ')}
                    </Text>
                </Space>
            }
            extra={
                <Space>
                    <Tooltip title='Download as PDF'>
                        <Button icon={<FilePdfOutlined />} onClick={downloadPdf} disabled={!exists && mode === 'self'}>
                            PDF
                        </Button>
                    </Tooltip>
                    {isManage ? (
                        <Button type='primary' icon={<SaveOutlined />} loading={saving} onClick={confirmSave}>
                            Save
                        </Button>
                    ) : exists ? (
                        <Button type='primary' icon={<SaveOutlined />} loading={saving} onClick={saveOwnPdp}>
                            Save plan
                        </Button>
                    ) : null}
                </Space>
            }
        >
            {isManage && attendanceSignals?.length ? (
                <Alert
                    type='info'
                    showIcon
                    style={{ marginBottom: 16 }}
                    message='Attendance over the last 30 days (supporting evidence only)'
                    description={attendanceSignals.join(' · ')}
                />
            ) : null}

            {isManage && problems.length ? (
                <Alert
                    type='warning'
                    showIcon
                    style={{ marginBottom: 16 }}
                    message='Weights must add up to 100% before the compact can be saved, signed or scored'
                    description={
                        <ul style={{ margin: 0, paddingLeft: 18 }}>
                            {problems.map(problem => (
                                <li key={problem}>{problem}</li>
                            ))}
                        </ul>
                    }
                />
            ) : null}

            <Tabs
                activeKey={tab}
                onChange={setTab}
                items={[
                    { key: 'compact', label: 'Compact', children: compactTab },
                    { key: 'pdp', label: pdpCount ? `Development plan · ${pdpCount}` : 'Development plan', children: pdpTab },
                    ...PHASES.map(p => ({ key: p.key, label: phaseLabel(p.key), children: reviewTab(p.key) }))
                ]}
            />

            <Modal
                open={recalibrateOpen}
                onCancel={() => setRecalibrateOpen(false)}
                onOk={saveRecalibration}
                okText='Save and withdraw signatures'
                confirmLoading={saving}
                title='Adjust the agreed goals?'
                destroyOnClose
            >
                <Space direction='vertical' size={12} style={{ width: '100%' }}>
                    <Text type='secondary'>
                        The compact was signed. Changing its goals withdraws the signatures, and both parties sign again. Record why.
                    </Text>
                    <Select
                        placeholder='Reason for adjusting'
                        style={{ width: '100%' }}
                        value={recalibrateReason}
                        options={RECALIBRATION_REASONS.map(r => ({ value: r.value, label: r.label }))}
                        onChange={setRecalibrateReason}
                    />
                    <Input.TextArea
                        placeholder='What changed'
                        autoSize={{ minRows: 2, maxRows: 5 }}
                        value={recalibrateNote}
                        onChange={e => setRecalibrateNote(e.target.value)}
                    />
                    <Alert
                        type='warning'
                        showIcon
                        message='Not valid reasons to adjust goals'
                        description={
                            <ul style={{ margin: 0, paddingLeft: 18 }}>
                                {RECALIBRATION_NOT_REASONS.map(reason => (
                                    <li key={reason}>{reason}</li>
                                ))}
                            </ul>
                        }
                    />
                </Space>
            </Modal>

            <LibraryImportModal
                open={libraryOpen}
                onClose={() => setLibraryOpen(false)}
                onAdd={addFromLibrary}
                existing={content.items}
                departmentId={employee?.departmentId}
                competencies={competencies}
            />
        </Drawer>
    )
}
