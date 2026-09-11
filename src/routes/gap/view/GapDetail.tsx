import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
    Alert,
    Button,
    Card,
    Col,
    Empty,
    Grid,
    Input,
    Row,
    Space,
    Switch,
    Tag,
    Tooltip,
    Typography,
    message,
    theme
} from 'antd'
import {
    Timestamp,
    collection,
    doc,
    getDoc,
    getDocs,
    limit,
    query,
    updateDoc,
    where
} from 'firebase/firestore'
import dayjs from 'dayjs'
import { db } from '@/firebase'
import {
    ArrowLeftOutlined,
    DownloadOutlined,
    FileTextOutlined,
    PartitionOutlined,
    ThunderboltOutlined
} from '@ant-design/icons'
import { exportGapDocx } from '@/utils/gapDocx'
import { applyKpiDeltas } from '@/lib/kpis'
import GapExportForm from '@/components/gap'
import {
    AnswerState,
    QA,
    SECTION_ADAPTERS,
    SECTION_ORDER,
    SectionKey,
    SectionStats,
    getAnswerStates,
    getOwnedSectionsForDept,
    getSectionStats,
    yes
} from '../sections'
import GapConfirmModal from './GapConfirmModal'
import GapMappingModal from './GapMappingModal'
import { MotionCard } from '@/components/dashboards/metrics/Header'

const { useBreakpoint } = Grid
const { Text } = Typography

const DEPT_ROM = 'ROM (Recruitment, Onboarding and Maintenance)'

const downloadFile = (url: string, filename = 'gap-analysis.pdf') => {
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.target = '_blank'
    a.rel = 'noopener noreferrer'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
}

async function fetchSignatureUrlForEmail(email?: string) {
    if (!email) return ''
    const snap = await getDocs(
        query(collection(db, 'users'), where('email', '==', email), limit(1))
    )
    return !snap.empty ? ((snap.docs[0].data() as any)?.signatureURL || '') : ''
}

export function getGapStatus(r: any): 'Confirmed' | 'Pending' {
    if (!r) return 'Pending'

    if (r?.manuallyCreated) {
        const raw = r?.gapAgreement?.raw
        if (!raw) return 'Pending'
        if (raw?.status === 'confirmed') return 'Confirmed'
        if (raw?.romReview?.status === 'Confirmed') return 'Confirmed'
        if (raw?.romReview?.confirmedAt) return 'Confirmed'
        if (raw?.verifiedAt) return 'Confirmed'
        if (raw?.acceptedAt) return 'Confirmed'
        return 'Pending'
    }

    if (r?.confirmationStatus === 'Confirmed') return 'Confirmed'
    if (r?.romReview?.status === 'Confirmed') return 'Confirmed'
    if (r?.romReview?.confirmedAt) return 'Confirmed'
    return 'Pending'
}

const safeFileName = (s: string) => String(s || 'SMME').trim().replace(/[^\w-]+/g, '_')

/** ===== Gap strip: one square per question, green / red / grey, click to jump ===== */
const GapStrip: React.FC<{
    states: AnswerState[]
    onPick: (index: number) => void
    activeIndex?: number | null
    height?: number
}> = ({ states, onPick, activeIndex, height = 26 }) => {
    const { token } = theme.useToken()

    const colorFor = (s: AnswerState) =>
        s === 'yes' ? token.colorSuccess : s === 'no' ? token.colorError : token.colorFill

    if (!states.length) return null

    return (
        <div
            role='list'
            style={{
                display: 'grid',
                // Segments stretch to fill the row, so the strip reads as one bar.
                // The cap keeps a 2-question section from rendering as two huge slabs.
                gridTemplateColumns: `repeat(${states.length}, minmax(0, 1fr))`,
                maxWidth: states.length * 64 + (states.length - 1) * 4,
                gap: 4
            }}
        >
            {states.map((s, i) => {
                const label = s === 'yes' ? 'Yes' : s === 'no' ? 'No' : 'Unanswered'
                const active = activeIndex === i
                return (
                    <Tooltip key={i} title={`Q${i + 1} — ${label}`}>
                        <button
                            type='button'
                            role='listitem'
                            aria-label={`Jump to question ${i + 1}, ${label}`}
                            onClick={() => onPick(i)}
                            style={{
                                width: '100%',
                                height,
                                padding: 0,
                                border: `1px solid ${active ? token.colorPrimary : token.colorBorderSecondary}`,
                                outline: active ? `2px solid ${token.colorPrimary}` : 'none',
                                outlineOffset: 1,
                                borderRadius: 4,
                                background: colorFor(s),
                                cursor: 'pointer',
                                lineHeight: 0
                            }}
                        />
                    </Tooltip>
                )
            })}
        </div>
    )
}

/** ===== Tri-colour proportion bar used in the section rail ===== */
const MiniBar: React.FC<{ stats: SectionStats }> = ({ stats }) => {
    const { token } = theme.useToken()
    const total = stats.total || 1

    const seg = (count: number, color: string) =>
        count > 0 ? <div style={{ flex: count / total, background: color }} /> : null

    return (
        <div
            style={{
                display: 'flex',
                height: 4,
                borderRadius: 2,
                overflow: 'hidden',
                opacity: 0.8,
                background: token.colorFillQuaternary
            }}
        >
            {seg(stats.yes, token.colorSuccess)}
            {seg(stats.no, token.colorError)}
            {seg(stats.blank, token.colorFill)}
        </div>
    )
}

export type GapDetailProps = {
    /** gapAnalysis doc id, or the complianceDocuments doc id when appId is supplied */
    gapId?: string | null
    /** applications/{appId}/complianceDocuments/{gapId} — required to reload a manual GAP */
    appId?: string | null
    /** Already-loaded record; skips the fetch entirely */
    manualRecord?: any | null

    isROM: boolean
    allowedSections?: SectionKey[] | 'ALL'

    romName?: string
    romEmail?: string

    /** Viewer's department, used to decide whether they can build a plan */
    viewerDepartmentName?: string

    /**
     * 'page' assumes the route supplies its own back control.
     * 'embedded' renders a Close button in the toolbar so the modal footer can stay empty.
     */
    mode?: 'page' | 'embedded'
    onBack?: () => void

    /** Lets a host list patch its own row without refetching */
    onConfirmed?: (gapId: string, update: Record<string, any>) => void
}

const GapDetail: React.FC<GapDetailProps> = ({
    gapId,
    appId,
    manualRecord,
    isROM,
    allowedSections,
    romName,
    romEmail,
    viewerDepartmentName,
    mode = 'embedded',
    onBack,
    onConfirmed
}) => {
    const navigate = useNavigate()
    const screens = useBreakpoint()
    const isMobile = !screens.md
    const { token } = theme.useToken()

    const [loading, setLoading] = useState(false)
    const [gap, setGap] = useState<any | null>(null)
    const [smmeSignatureUrl, setSmmeSignatureUrl] = useState('')

    const [activeSection, setActiveSection] = useState<SectionKey>('finance')
    const [search, setSearch] = useState('')
    const [gapsOnly, setGapsOnly] = useState(false)

    const [confirmOpen, setConfirmOpen] = useState(false)
    const [exportFormOpen, setExportFormOpen] = useState(false)
    const [mappingOpen, setMappingOpen] = useState(false)
    const [downloading, setDownloading] = useState(false)

    /** Question index requested by the gap strip, pending a scroll */
    const [pendingJump, setPendingJump] = useState<number | null>(null)
    const [highlighted, setHighlighted] = useState<number | null>(null)
    const rowRefs = useRef<Record<number, HTMLDivElement | null>>({})

    const isManualGap = !!gap?.manuallyCreated || !!manualRecord?.manuallyCreated
    const status = getGapStatus(gap)

    const visibleSections: SectionKey[] = useMemo(() => {
        if (isROM || allowedSections === 'ALL') return SECTION_ORDER
        if (Array.isArray(allowedSections)) return allowedSections
        return []
    }, [isROM, allowedSections])

    useEffect(() => {
        if (!visibleSections.length) return
        if (!visibleSections.includes(activeSection)) setActiveSection(visibleSections[0])
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visibleSections.join('|')])

    /** ===== Load ===== */
    useEffect(() => {
        let cancelled = false

        const run = async () => {
            setLoading(true)
            try {
                // Caller handed us the record already
                if (manualRecord) {
                    if (cancelled) return
                    setGap(manualRecord)
                    const email =
                        manualRecord?.company?.email || manualRecord?.signatures?.smmeEmail || ''
                    const url = await fetchSignatureUrlForEmail(email)
                    if (!cancelled) setSmmeSignatureUrl(url)
                    return
                }

                if (!gapId) {
                    if (!cancelled) {
                        setGap(null)
                        setSmmeSignatureUrl('')
                    }
                    return
                }

                // Manual GAPs live under the application, not in gapAnalysis
                if (appId) {
                    const snap = await getDoc(
                        doc(db, 'applications', appId, 'complianceDocuments', gapId)
                    )
                    if (!snap.exists()) {
                        if (!cancelled) {
                            setGap(null)
                            message.error('GAP document not found for this application.')
                        }
                        return
                    }
                    const raw = { id: snap.id, ...(snap.data() as any) }
                    const appSnap = await getDoc(doc(db, 'applications', appId))
                    const app = appSnap.exists() ? (appSnap.data() as any) : {}

                    const record = {
                        id: raw.id,
                        appId,
                        participantId: app?.participantId || '',
                        manuallyCreated: true,
                        company: {
                            name: app?.beneficiaryName || app?.participantName || '',
                            region: app?.region || app?.province || '',
                            email: app?.email || app?.applicantEmail || '',
                            dateOfEngagement: app?.dateOfEngagement || app?.createdAt || null
                        },
                        gapAgreement: {
                            pdfUrl: raw.signedFileURL || raw.pdfUrl || raw.fileUrl || raw.url || null,
                            signedFileURL: raw.signedFileURL || null,
                            acceptedAt:
                                raw.acceptedAt || raw.verifiedAt || raw.uploadedAt || raw.createdAt || null,
                            raw
                        }
                    }

                    if (cancelled) return
                    setGap(record)
                    const url = await fetchSignatureUrlForEmail(record.company.email)
                    if (!cancelled) setSmmeSignatureUrl(url)
                    return
                }

                const snap = await getDoc(doc(db, 'gapAnalysis', gapId))
                if (!snap.exists()) {
                    if (!cancelled) {
                        setGap(null)
                        message.error('GAP Analysis document not found.')
                    }
                    return
                }

                const record = { id: gapId, ...(snap.data() as any) }
                if (cancelled) return
                setGap(record)

                const email = record?.company?.email || record?.signatures?.smmeEmail || ''
                const url = await fetchSignatureUrlForEmail(email)
                if (!cancelled) setSmmeSignatureUrl(url)
            } catch (e) {
                console.error('GapDetail load failed', e)
                if (!cancelled) setGap(null)
            } finally {
                if (!cancelled) setLoading(false)
            }
        }

        run()
        return () => {
            cancelled = true
        }
    }, [gapId, appId, manualRecord])

    /** ===== Derived ===== */
    const allStats = useMemo(() => {
        if (!gap || isManualGap) return [] as SectionStats[]
        return visibleSections.map(sec => getSectionStats(gap, sec))
    }, [gap, isManualGap, visibleSections])

    const activeStats = useMemo(
        () => allStats.find(s => s.key === activeSection) || null,
        [allStats, activeSection]
    )

    /**
     * Restricted departments usually see a single section, so the rail would be a
     * list of one. Drop it and give the questions the full width instead.
     */
    const showRail = visibleSections.length > 1

    /**
     * Mapping needs structured answers and at least one section the viewer owns.
     * The backend re-checks the department, so this only hides a button that
     * would have been refused anyway.
     */
    const canMap = !isManualGap && visibleSections.length > 0 && !!gap?.id

    /**
     * Only a department that actually delivers a section can build a plan from
     * this GAP — the builder is scoped to the viewer's own catalogue, so it
     * would be empty for ROM and M&E.
     */
    const participantId = String(gap?.participantId || '').trim()
    const canBuildPlan =
        !isManualGap &&
        !!participantId &&
        status === 'Confirmed' &&
        getOwnedSectionsForDept(viewerDepartmentName).length > 0

    const activeStates = useMemo(
        () => (gap && !isManualGap ? getAnswerStates(gap, activeSection) : []),
        [gap, isManualGap, activeSection]
    )

    const rows = useMemo(() => {
        if (!gap || isManualGap) return []
        const def = SECTION_ADAPTERS[activeSection]
        const qas: QA[] = def.getQA(gap)

        return def.qText.map((question, i) => ({
            index: i,
            number: i + 1,
            question,
            answer: qas?.[i]?.answer || '',
            comment: qas?.[i]?.comment || '',
            state: activeStates[i] || ('blank' as AnswerState)
        }))
    }, [gap, isManualGap, activeSection, activeStates])

    const filteredRows = useMemo(() => {
        let list = rows
        if (gapsOnly) list = list.filter(r => r.state !== 'yes')

        const q = search.trim().toLowerCase()
        if (q) {
            list = list.filter(r =>
                `${r.question} ${r.answer} ${r.comment}`.toLowerCase().includes(q)
            )
        }
        return list
    }, [rows, gapsOnly, search])

    /** Clicking a strip square clears filters, then scrolls once the row is back in the DOM */
    const jumpToQuestion = useCallback((index: number) => {
        setGapsOnly(false)
        setSearch('')
        setPendingJump(index)
    }, [])

    useEffect(() => {
        if (pendingJump == null) return
        const el = rowRefs.current[pendingJump]
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' })
            setHighlighted(pendingJump)
        }
        setPendingJump(null)
    }, [pendingJump, filteredRows])

    useEffect(() => {
        if (highlighted == null) return
        const t = window.setTimeout(() => setHighlighted(null), 2400)
        return () => window.clearTimeout(t)
    }, [highlighted])

    // Reset the reading position when the section changes
    useEffect(() => {
        setSearch('')
        setGapsOnly(false)
        rowRefs.current = {}
    }, [activeSection])

    /** ===== Actions ===== */
    const applyConfirmation = async (payload: {
        comment: string
        romSignatureUrl: string
        romDigitalSignature: string
    }) => {
        if (!isROM) {
            message.error('You do not have ROM permissions to confirm.')
            return
        }
        if (!romEmail) {
            message.error('Cannot confirm: ROM email not found.')
            return
        }
        if (!gap?.id) {
            message.error('No GAP selected.')
            return
        }
        if (isManualGap) {
            message.warning('Manual GAPs are confirmed via the compliance workflow.')
            return
        }

        const update = {
            confirmationStatus: 'Confirmed',
            romReview: {
                reviewerEmail: romEmail,
                reviewerName: romName || '',
                comment: payload.comment || '',
                confirmedAt: Timestamp.now(),
                romSignatureUrl: payload.romSignatureUrl || '',
                romDigitalSignature: payload.romDigitalSignature || '',
                status: 'Confirmed'
            }
        }

        await updateDoc(doc(db, 'gapAnalysis', gap.id), update as any)

        // KPI credit for the ROM team — best effort, never blocks the confirmation
        try {
            const participantId: string =
                gap?.company?.participantId ||
                gap?.participantId ||
                gap?.company?.participantID ||
                ''

            let programId = gap?.programId || ''
            if (participantId && !programId) {
                const appsSnap = await getDocs(
                    query(
                        collection(db, 'applications'),
                        where('participantId', '==', participantId),
                        limit(1)
                    )
                )
                if (!appsSnap.empty) {
                    const app = appsSnap.docs[0].data() as any
                    programId = app.programId || app.program?.id || ''
                }
            }

            const now = new Date()
            const quarterKey = `${now.getFullYear()}-Q${Math.floor(now.getMonth() / 3) + 1}`

            await applyKpiDeltas(
                {
                    participantId,
                    programId: programId || 'unknown',
                    areaOfSupport: DEPT_ROM,
                    quarter: quarterKey
                },
                { gap_analysis_completed: { mode: 'increment', value: 1 } }
            )
        } catch (e) {
            console.warn('ROM KPI update (GAP confirm) failed:', e)
        }

        setGap((prev: any) => (prev ? { ...prev, ...update } : prev))
        onConfirmed?.(gap.id, update)
        setConfirmOpen(false)
        message.success('GAP confirmed and ROM signatures appended.')
    }

    const handleDownload = async () => {
        if (!gap) return
        setDownloading(true)
        try {
            if (isManualGap) {
                const agreement = gap?.gapAgreement || {}
                const url = agreement.signedFileURL || agreement.pdfUrl || agreement.url
                if (!url) {
                    message.warning('No downloadable GAP document is available.')
                    return
                }
                downloadFile(url, `GAP_${safeFileName(gap?.company?.name)}.pdf`)
                return
            }

            const standardSnapshot = await getDoc(doc(db, 'qmsStandards', 'gap-analysis'))
            const standard = standardSnapshot.exists() ? (standardSnapshot.data() as any) : null
            const hasCompleteHeader = Boolean(
                standard?.formNo && standard?.revisionNo && standard?.effectiveDate
            )

            await exportGapDocx(gap, {
                overrides: {
                    smmeSigUrl: smmeSignatureUrl || gap?.signatures?.smmeSignatureUrl || '',
                    romSigUrl: gap?.romReview?.romSignatureUrl || ''
                },
                ...(hasCompleteHeader
                    ? {
                        headerMeta: {
                            formNo: standard.formNo,
                            revisionNo: standard.revisionNo,
                            effectiveDate: dayjs(standard.effectiveDate).format('D MMMM YYYY'),
                            centerTitle: standard.centerTitle || 'SMME GAP ANALYSIS - RUSTERNBERG',
                            onboardingComments: standard.onboardingComments || ''
                        }
                    }
                    : {}),
                filenameBase: `${String(gap?.company?.name || 'SMME').trim()}-GAP-Analysis`
            })
            message.success('GAP document downloaded.')
        } catch (error) {
            console.error('Failed to download GAP document.', error)
            message.error('The GAP document could not be downloaded.')
        } finally {
            setDownloading(false)
        }
    }

    /** ===== Render ===== */
    if (loading) {
        return <Card loading style={{ minHeight: 280 }} />
    }

    if (!gap) {
        return (
            <Alert
                type='warning'
                showIcon
                message='GAP record unavailable'
                description='This GAP Analysis could not be loaded. It may have been removed, or you may not have access to it.'
            />
        )
    }

    const engagementDate =
        gap?.company?.dateOfEngagement ||
        gap?.submittedAt ||
        gap?.gapAgreement?.acceptedAt ||
        null

    const smmeName =
        gap?.company?.name ||
        gap?.signatures?.smmeNameSurname ||
        gap?.gapAgreement?.raw?.smmeNameSurname ||
        '—'

    const fmt = (v: any, pattern = 'YYYY-MM-DD') => {
        if (!v) return '—'
        const d = v?.toDate?.() ?? (v?.seconds ? new Date(v.seconds * 1000) : v)
        const parsed = dayjs(d)
        return parsed.isValid() ? parsed.format(pattern) : '—'
    }

    return (
        <Space direction='vertical' size={12} style={{ width: '100%' }}>
            {/* ===== Top bar ===== */}
            <div
                style={{
                    position: 'sticky',
                    top: 0,
                    zIndex: 20,
                    alignItems: 'center',
                    gap: 12,
                    // Equal side tracks put the title at the true centre of the bar,
                    // rather than centred in whatever space the buttons leave over.
                    ...(isMobile
                        ? { display: 'flex', flexWrap: 'wrap' as const }
                        : { display: 'grid', gridTemplateColumns: '1fr auto 1fr' }),
                    padding: isMobile ? '10px 12px' : '12px 16px',
                    background: token.colorBgContainer,
                    border: `1px solid ${token.colorBorderSecondary}`,
                    borderRadius: 20,
                    boxShadow: token.boxShadowTertiary
                }}
            >
                {/* Always rendered so the grid keeps three tracks and the title stays centred */}
                <div style={{ justifySelf: 'start' }}>
                    {onBack && (
                        <Button shape='round' icon={<ArrowLeftOutlined />} onClick={onBack}>
                            {mode === 'page' ? 'Back' : 'Close'}
                        </Button>
                    )}
                </div>

                <div
                    style={{
                        flex: '1 1 240px',
                        minWidth: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        textAlign: 'center',
                        gap: 10,
                        flexWrap: 'wrap'
                    }}
                >
                    <Text strong style={{ fontSize: 16, whiteSpace: 'nowrap' }}>
                        GAP Analysis
                    </Text>
                    <span style={{ color: token.colorSplit }}>|</span>
                    <Text
                        style={{
                            fontSize: 15,
                            color: token.colorTextSecondary,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            maxWidth: '100%'
                        }}
                        title={smmeName}
                    >
                        {smmeName}
                    </Text>
                    <Tag
                        color={status === 'Confirmed' ? 'success' : 'warning'}
                        style={{ marginInlineEnd: 0, borderRadius: 999 }}
                    >
                        {status}
                    </Tag>
                    {isManualGap && <Tag style={{ marginInlineEnd: 0, borderRadius: 999 }}>Manual</Tag>}
                </div>

                <Space wrap size={8} style={{ justifySelf: 'end', whiteSpace: 'nowrap' }}>
                    {canBuildPlan && (
                        <Tooltip title='Build this participant’s diagnostic plan for your department'>
                            <Button
                                shape='round'
                                icon={<PartitionOutlined />}
                                onClick={() =>
                                    navigate(
                                        `/operations/diagnostic-plan?participantId=${encodeURIComponent(participantId)}`
                                    )
                                }
                            >
                                Build plan
                            </Button>
                        </Tooltip>
                    )}

                    {canMap && (
                        <Tooltip title='AI-map these gaps to interventions your department offers'>
                            <Button
                                shape='round'
                                icon={<ThunderboltOutlined />}
                                onClick={() => setMappingOpen(true)}
                            >
                                Mapping
                            </Button>
                        </Tooltip>
                    )}

                    {isROM && !isManualGap && (
                        <Tooltip title='Export with the QMS document header'>
                            <Button
                                shape='round'
                                icon={<FileTextOutlined />}
                                onClick={() => setExportFormOpen(true)}
                            >
                                Export
                            </Button>
                        </Tooltip>
                    )}

                    <Button
                        shape='round'
                        icon={<DownloadOutlined />}
                        loading={downloading}
                        onClick={handleDownload}
                    >
                        Download GAP
                    </Button>

                    {isROM && !isManualGap && status === 'Pending' && (
                        <Button shape='round' type='primary' onClick={() => setConfirmOpen(true)}>
                            Confirm GAP
                        </Button>
                    )}
                </Space>
            </div>

            {/* ===== Meta strip ===== */}
            <MotionCard size='small' styles={{ body: { padding: isMobile ? 12 : 16 } }}>
                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns: isMobile
                            ? '1fr'
                            : 'repeat(auto-fit, minmax(180px, 1fr))',
                        gap: isMobile ? 12 : 20,
                        alignItems: 'start'
                    }}
                >
                    <MetaItem label='Region' value={gap?.company?.region} />
                    <MetaItem label='Email' value={gap?.company?.email} />
                    <MetaItem label='Contact' value={gap?.company?.contact} />
                    <MetaItem label='Engagement date' value={fmt(engagementDate)} />
                    <MetaItem
                        label='SMME signature'
                        value={
                            smmeSignatureUrl || gap?.signatures?.smmeSignatureUrl ? (
                                <img
                                    src={smmeSignatureUrl || gap?.signatures?.smmeSignatureUrl}
                                    alt='SMME Signature'
                                    style={{
                                        maxWidth: 160,
                                        maxHeight: 56,
                                        objectFit: 'contain',
                                        display: 'block'
                                    }}
                                />
                            ) : (
                                '—'
                            )
                        }
                    />
                    {gap?.romReview?.confirmedAt && (
                        <MetaItem
                            label='Confirmed by'
                            value={
                                <>
                                    {gap?.romReview?.reviewerName ||
                                        gap?.romReview?.reviewerEmail ||
                                        '—'}
                                    <div style={{ fontSize: 12, color: token.colorTextTertiary }}>
                                        {fmt(gap?.romReview?.confirmedAt, 'YYYY-MM-DD HH:mm')}
                                    </div>
                                </>
                            }
                        />
                    )}
                </div>

                {gap?.romReview?.comment ? (
                    <div
                        style={{
                            marginTop: 14,
                            paddingTop: 12,
                            borderTop: `1px solid ${token.colorBorderSecondary}`
                        }}
                    >
                        <div
                            style={{
                                fontSize: 12,
                                color: token.colorTextTertiary,
                                textTransform: 'uppercase',
                                letterSpacing: 0.4,
                                marginBottom: 4
                            }}
                        >
                            ROM review comment
                        </div>
                        <div style={{ whiteSpace: 'pre-wrap' }}>{gap.romReview.comment}</div>
                    </div>
                ) : null}
            </MotionCard>

            {/* ===== Body ===== */}
            {
                isManualGap ? (
                    <ManualGapDocument gap={gap} isMobile={isMobile} />
                ) : visibleSections.length === 0 ? (
                    <Alert
                        type='warning'
                        showIcon
                        message='No section available'
                        description='Your department access does not match any GAP section on this record. Contact ROM if this is unexpected.'
                    />
                ) : (
                    <Row gutter={[12, 12]} align='top'>
                        {/* Section rail — pointless when there is nothing to switch between */}
                        {showRail && (
                            <Col xs={24} md={8} lg={7} xl={6}>
                                <Card
                                    size='small'
                                    title='Sections'
                                    styles={{ body: { padding: 8 } }}
                                >
                                    <div
                                        style={
                                            isMobile
                                                ? { display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }
                                                : { display: 'flex', flexDirection: 'column', gap: 4 }
                                        }
                                    >
                                        {allStats.map(s => {
                                            const active = s.key === activeSection

                                            // A reviewer scans for gaps, so lead with those.
                                            const summary =
                                                s.no > 0
                                                    ? { text: `${s.no} gap${s.no > 1 ? 's' : ''}`, color: token.colorError }
                                                    : s.blank > 0
                                                        ? { text: `${s.blank} blank`, color: token.colorTextTertiary }
                                                        : { text: 'Clear', color: token.colorSuccess }

                                            return (
                                                <button
                                                    key={s.key}
                                                    type='button'
                                                    onClick={() => setActiveSection(s.key)}
                                                    aria-current={active}
                                                    title={`${s.yes} Yes · ${s.no} No · ${s.blank} unanswered`}
                                                    style={{
                                                        textAlign: 'left',
                                                        cursor: 'pointer',
                                                        border: 'none',
                                                        borderLeft: `3px solid ${active ? token.colorPrimary : 'transparent'}`,
                                                        background: active
                                                            ? token.controlItemBgActive
                                                            : 'transparent',
                                                        borderRadius: token.borderRadius,
                                                        padding: '8px 10px',
                                                        minWidth: isMobile ? 190 : undefined,
                                                        flex: isMobile ? '0 0 auto' : undefined
                                                    }}
                                                >
                                                    <div
                                                        style={{
                                                            display: 'flex',
                                                            alignItems: 'baseline',
                                                            justifyContent: 'space-between',
                                                            gap: 8,
                                                            marginBottom: 6
                                                        }}
                                                    >
                                                        <span
                                                            style={{
                                                                fontWeight: active ? 600 : 400,
                                                                color: active
                                                                    ? token.colorText
                                                                    : token.colorTextSecondary,
                                                                minWidth: 0,
                                                                overflow: 'hidden',
                                                                textOverflow: 'ellipsis',
                                                                whiteSpace: 'nowrap'
                                                            }}
                                                        >
                                                            {s.title}
                                                        </span>
                                                        <span
                                                            style={{
                                                                flex: '0 0 auto',
                                                                fontSize: 12,
                                                                color: summary.color
                                                            }}
                                                        >
                                                            {summary.text}
                                                        </span>
                                                    </div>
                                                    <MiniBar stats={s} />
                                                </button>
                                            )
                                        })}
                                    </div>
                                </Card>
                            </Col>
                        )}

                        {/* Questions */}
                        <Col
                            xs={24}
                            md={showRail ? 16 : 24}
                            lg={showRail ? 17 : 24}
                            xl={showRail ? 18 : 24}
                        >
                            <MotionCard
                                size='small'
                                styles={{ body: { padding: isMobile ? 12 : 16 } }}
                                title={SECTION_ADAPTERS[activeSection].title}
                                extra={
                                    activeStats ? (
                                        <Text type='secondary' style={{ fontSize: 12 }}>
                                            {activeStats.yesPct == null
                                                ? 'Not answered'
                                                : `${activeStats.yesPct}% Yes`}
                                        </Text>
                                    ) : null
                                }
                                filterBar={
                                    <Row gutter={[8, 8]} align='middle'>
                                        <Col xs={24} sm={14}>
                                            <Input.Search
                                                allowClear
                                                placeholder='Search questions, answers, comments'
                                                value={search}
                                                onChange={e => setSearch(e.target.value)}
                                            />
                                        </Col>
                                        <Col xs={24} sm={10} style={{ textAlign: isMobile ? 'left' : 'right' }}>
                                            <Space>
                                                <Switch
                                                    size='small'
                                                    checked={gapsOnly}
                                                    onChange={setGapsOnly}
                                                    id='gaps-only'
                                                />
                                                <label htmlFor='gaps-only' style={{ cursor: 'pointer' }}>
                                                    Show gaps only
                                                </label>
                                            </Space>
                                        </Col>
                                    </Row>
                                }
                            >
                                <Space direction='vertical' size={12} style={{ width: '100%' }}>
                                    <div>
                                        <GapStrip
                                            states={activeStates}
                                            onPick={jumpToQuestion}
                                            activeIndex={highlighted}
                                            height={isMobile ? 30 : 26}
                                        />
                                        <div
                                            style={{
                                                marginTop: 8,
                                                fontSize: 12,
                                                color: token.colorTextSecondary
                                            }}
                                        >
                                            <Space size={12} wrap>
                                                <LegendDot color={token.colorSuccess} label='Yes' />
                                                <LegendDot color={token.colorError} label='No' />
                                                <LegendDot color={token.colorFill} label='Unanswered' />
                                                <span>Click a square to jump to that question.</span>
                                            </Space>
                                        </div>
                                    </div>

                                    {filteredRows.length === 0 ? (
                                        <Empty
                                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                                            description={
                                                gapsOnly
                                                    ? 'No gaps in this section — every question answered Yes.'
                                                    : 'No questions match your search.'
                                            }
                                        />
                                    ) : (
                                        <div>
                                            {filteredRows.map(r => {
                                                const isHit = highlighted === r.index
                                                return (
                                                    <div
                                                        key={r.index}
                                                        ref={el => {
                                                            rowRefs.current[r.index] = el
                                                        }}
                                                        style={{
                                                            display: 'flex',
                                                            gap: 12,
                                                            padding: '10px 8px',
                                                            borderTop: `1px solid ${token.colorBorderSecondary}`,
                                                            // controlItemBgActive is nearly invisible on the
                                                            // dark palette, so ring the row in the primary colour
                                                            background: isHit
                                                                ? token.colorPrimaryBg
                                                                : 'transparent',
                                                            outline: isHit
                                                                ? `2px solid ${token.colorPrimary}`
                                                                : 'none',
                                                            outlineOffset: -2,
                                                            borderRadius: isHit ? token.borderRadius : 0,
                                                            transition: 'background 300ms ease, outline-color 300ms ease'
                                                        }}
                                                    >
                                                        <div
                                                            style={{
                                                                flex: '0 0 auto',
                                                                width: 4,
                                                                borderRadius: 2,
                                                                background:
                                                                    r.state === 'yes'
                                                                        ? token.colorSuccess
                                                                        : r.state === 'no'
                                                                            ? token.colorError
                                                                            : token.colorFill
                                                            }}
                                                        />
                                                        <div
                                                            style={{
                                                                flex: '0 0 auto',
                                                                width: 24,
                                                                color: token.colorTextTertiary,
                                                                fontVariantNumeric: 'tabular-nums'
                                                            }}
                                                        >
                                                            {r.number}
                                                        </div>
                                                        <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                                                            <div style={{ color: token.colorText }}>
                                                                {r.question}
                                                            </div>
                                                            {r.comment ? (
                                                                <div
                                                                    style={{
                                                                        marginTop: 4,
                                                                        fontSize: 12,
                                                                        color: token.colorTextSecondary,
                                                                        whiteSpace: 'pre-wrap'
                                                                    }}
                                                                >
                                                                    {r.comment}
                                                                </div>
                                                            ) : null}
                                                        </div>
                                                        <div style={{ flex: '0 0 auto' }}>
                                                            {r.answer ? (
                                                                <Tag color={yes(r.answer) ? 'green' : 'red'}>
                                                                    {r.answer}
                                                                </Tag>
                                                            ) : (
                                                                <Tag>—</Tag>
                                                            )}
                                                        </div>
                                                    </div>
                                                )
                                            })}
                                        </div>
                                    )}
                                </Space>
                            </MotionCard>
                        </Col>
                    </Row>
                )
            }

            <GapConfirmModal
                open={confirmOpen}
                onCancel={() => setConfirmOpen(false)}
                onConfirm={applyConfirmation}
                romName={romName}
                romEmail={romEmail}
                isMobile={isMobile}
            />

            <GapMappingModal
                open={mappingOpen}
                onClose={() => setMappingOpen(false)}
                gapId={gap?.id}
                companyName={gap?.company?.name}
                sections={visibleSections}
            />

            <GapExportForm
                open={exportFormOpen}
                onClose={() => setExportFormOpen(false)}
                isROM={isROM}
                romName={romName || ''}
                romEmail={romEmail || ''}
                selectedGap={gap}
                smmeSignatureUrl={smmeSignatureUrl}
            />
        </Space >
    )
}

const MetaItem: React.FC<{ label: string; value?: React.ReactNode }> = ({ label, value }) => {
    const { token } = theme.useToken()
    return (
        <div style={{ minWidth: 0 }}>
            <div
                style={{
                    fontSize: 12,
                    color: token.colorTextTertiary,
                    textTransform: 'uppercase',
                    letterSpacing: 0.4,
                    marginBottom: 4
                }}
            >
                {label}
            </div>
            <div style={{ color: token.colorText, wordBreak: 'break-word' }}>
                {value == null || value === '' ? '—' : value}
            </div>
        </div>
    )
}

const LegendDot: React.FC<{ color: string; label: string }> = ({ color, label }) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
        <span
            style={{
                width: 10,
                height: 10,
                borderRadius: 3,
                background: color,
                display: 'inline-block'
            }}
        />
        {label}
    </span>
)

const ManualGapDocument: React.FC<{ gap: any; isMobile: boolean }> = ({ gap, isMobile }) => {
    const agreement = gap?.gapAgreement || {}
    const url = agreement.signedFileURL || agreement.pdfUrl

    if (!url) {
        return (
            <Alert
                type='warning'
                showIcon
                message='No document found'
                description='No GAP document has been uploaded for this record. Please contact ROM if this is unexpected.'
            />
        )
    }

    const signedAt =
        agreement.acceptedAt || agreement?.raw?.verifiedAt || agreement?.raw?.acceptedAt || null

    return (
        <Card
            size='small'
            title='GAP Analysis Document'
            extra={
                signedAt ? (
                    <Text type='secondary' style={{ fontSize: 12 }}>
                        Signed{' '}
                        {dayjs(
                            signedAt?.toDate?.() ??
                            (signedAt?.seconds ? new Date(signedAt.seconds * 1000) : signedAt)
                        ).format('YYYY-MM-DD HH:mm')}
                    </Text>
                ) : null
            }
            styles={{ body: { padding: isMobile ? 12 : 16 } }}
        >
            <Space direction='vertical' size={10} style={{ width: '100%' }}>
                <div
                    style={{
                        border: '1px solid #d9d9d9',
                        borderRadius: 8,
                        overflow: 'hidden',
                        height: isMobile ? 420 : 640
                    }}
                >
                    <iframe
                        src={url}
                        style={{ width: '100%', height: '100%', border: 'none' }}
                        title='GAP Analysis Document'
                    />
                </div>

                <Space wrap>
                    <Button onClick={() => window.open(url, '_blank', 'noopener,noreferrer')}>
                        Open in new tab
                    </Button>
                    <Button
                        onClick={() => downloadFile(url, `GAP_${safeFileName(gap?.company?.name)}.pdf`)}
                    >
                        Download
                    </Button>
                </Space>
            </Space>
        </Card>
    )
}

export default GapDetail
