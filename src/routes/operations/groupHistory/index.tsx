import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
    Alert,
    Button,
    Col,
    Descriptions,
    Empty,
    Input,
    Modal,
    Progress,
    Row,
    Segmented,
    Select,
    Skeleton,
    Space,
    Table,
    Tag,
    Typography,
    message
} from 'antd'
import {
    CheckCircleOutlined,
    ClockCircleOutlined,
    HistoryOutlined,
    MailOutlined,
    ProfileOutlined,
    SearchOutlined,
    TeamOutlined,
    TrophyOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import {
    collection,
    doc,
    getDoc,
    getDocs,
    limit,
    onSnapshot,
    query,
    where
} from 'firebase/firestore'
import { Helmet } from 'react-helmet'
import { db } from '@/firebase'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import {
    buildGroupRequirements,
    evaluateGroupEligibility,
    groupLabel,
    confirmSmeGroupMovement,
    isMonitoringAndEvaluationDepartment,
    isRomDepartment,
    notifyMeGroupMovementBatch,
    notifyRomSmeReady,
    requestSmeGroupMovement,
    resolveApplicationGroup,
    returnSmeGroupMovement,
    sendGroupDetailsReminder,
    type GroupEligibility,
    type GroupEvidence,
    type GroupHistoryEntry,
    type GroupIntervention,
    type GroupProgressionRules,
    type GroupRequirement,
    type IncubationGroup,
    type PendingGroupMovement
} from '@/services/groupLifecycleService'
import {
    canonicalAgreementId,
    complianceStatusLabel
} from '@/services/complianceResolver'

const { Text } = Typography

type SmeGroupRow = {
    key: string
    applicationId: string
    participantId?: string
    name: string
    email?: string
    stage?: string
    programName?: string
    group: IncubationGroup
    history: GroupHistoryEntry[]
    evidence: GroupEvidence[]
    interventions: GroupIntervention[]
    graduationApproved?: boolean
    lastReminderAt?: Date | null
    pendingMovement?: PendingGroupMovement | null
}

const GROUPS: IncubationGroup[] = ['A', 'B', 'C', 'Graduated']
const groupColors: Record<IncubationGroup, string> = {
    A: 'red', B: 'gold', C: 'blue', Graduated: 'green'
}

const complianceStatusColor = (status: string) => {
    if (['valid', 'signed'].includes(status)) return 'green'
    if (status === 'expiring-soon') return 'orange'
    if (status === 'pending') return 'blue'
    return 'red'
}

const outstandingReminderItems = (eligibility: GroupEligibility) => {
    const detailed = eligibility.requirements?.filter(item => !item.met) || []
    return detailed.length
        ? detailed.map(item =>
            `${item.title} — ${complianceStatusLabel(item.status)}: ${item.reason}`
        )
        : eligibility.missing
}

const toDate = (value: any): Date | null => {
    if (!value) return null
    if (typeof value?.toDate === 'function') return value.toDate()
    if (value instanceof Date) return value
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
}

const formatDateTime = (value: any, fallback = 'Not recorded') => {
    const date = toDate(value)
    return date ? dayjs(date).format('DD MMM YYYY HH:mm') : fallback
}

const getName = (application: any, participant: any) =>
    participant?.beneficiaryName || participant?.name || application?.beneficiaryName ||
    application?.businessName || application?.participantName || application?.email || 'Unnamed SME'

const getEmail = (application: any, participant: any) =>
    participant?.email || application?.email || application?.contactEmail || application?.ownerEmail

async function resolveParticipant(application: any) {
    const participantId = application.participantId || application.participantDocId || application.incubateeId
    if (participantId) {
        const snapshot = await getDoc(doc(db, 'participants', participantId))
        if (snapshot.exists()) return { id: snapshot.id, data: snapshot.data() }
    }
    const email = application.email || application.contactEmail
    if (!email) return null
    const snapshot = await getDocs(query(
        collection(db, 'participants'),

        where('email', '==', email),
        limit(1)
    ))
    return snapshot.empty ? null : { id: snapshot.docs[0].id, data: snapshot.docs[0].data() }
}

const evidenceSlug = (item: any, fallback = '') =>
    String(item?.slug || item?.presetId || item?.preset || item?.key || item?.type || item?.documentName || item?.title || fallback)
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')

const looksLikeAgreementEvidence = (item: any) => {
    const rawType = String(item?.kind || item?.type || '').toLowerCase()
    const text = String(`${item?.agreementId || ''} ${item?.documentName || ''} ${item?.title || ''} ${item?.type || ''}`).toLowerCase()
    return rawType === 'agreement' || !!item?.agreementId ||
        text.includes('agreement') || text.includes('contract') ||
        text.includes('memorandum of agreement') || text.includes('gap analysis') ||
        text.includes('gap-analysis') || text.trim() === 'moa'
}

async function loadEvidence(application: any, participant: any = {}): Promise<GroupEvidence[]> {
    const flatSources = [
        ...(Array.isArray(participant.complianceDocuments) ? participant.complianceDocuments : []),
        ...(Array.isArray(application.complianceDocuments) ? application.complianceDocuments : [])
    ]
    const flat = flatSources.map((item: any, index: number): GroupEvidence => {
        const agreement = looksLikeAgreementEvidence(item)
        const slug = evidenceSlug(item, `flat-${index}`)
        return {
            id: item.id || item.slug || item.presetId || item.key || slug || `flat-${index}`,
            title: item.title || item.documentName || item.name || item.type || slug || '',
            slug,
            presetId: item.presetId || item.preset,
            documentName: item.documentName || item.title || item.type,
            kind: agreement ? 'agreement' : 'upload',
            status: item.verificationStatus ?? item.status ?? item.verified ?? item.approved ?? (agreement ? 'valid' : undefined),
            signed: item.signed === true || item.participantSigned === true || item.smmeSigned === true,
            expiryDate: item.expiryDate,
            raw: item
        }
    })

    const [uploadsSnapshot, agreementsSnapshot] = await Promise.all([
        getDocs(collection(db, 'applications', application.id, 'complianceDocuments')),
        getDocs(collection(db, 'applications', application.id, 'agreements'))
    ])
    const uploads: GroupEvidence[] = uploadsSnapshot.docs.map(snapshot => {
        const item = snapshot.data() as any
        return {
            id: snapshot.id,
            title: item.title || item.documentName || item.name || item.type || snapshot.id,
            slug: evidenceSlug(item, snapshot.id),
            presetId: item.presetId || item.preset,
            documentName: item.documentName || item.title || item.type,
            kind: looksLikeAgreementEvidence(item) ? 'agreement' : 'upload',
            status: item.verificationStatus ?? item.status ?? item.verified ?? item.approved,
            expiryDate: item.expiryDate,
            raw: item
        }
    })
    const agreements: GroupEvidence[] = agreementsSnapshot.docs.map(snapshot => {
        const item = snapshot.data() as any
        return {
            id: snapshot.id,
            slug: evidenceSlug({ ...item, slug: snapshot.id }, snapshot.id),
            title: item.title || snapshot.id,
            documentName: item.title || snapshot.id,
            kind: 'agreement',
            status: 'valid',
            signed: item.signed === true || item.smmeSigned === true || item.participantSigned === true,
            raw: { ...item, slug: snapshot.id }
        }
    })
    Object.entries({ ...(participant.signedAgreements || {}), ...(application.signedAgreements || {}) }).forEach(([slug, raw]: [string, any]) => {
        agreements.push({
            id: slug,
            slug: evidenceSlug({ ...(raw || {}), slug }, slug),
            title: raw?.title || slug,
            documentName: raw?.title || slug,
            kind: 'agreement',
            status: 'valid',
            signed: raw === true || raw?.signed === true || raw?.smmeSigned === true || raw?.participantSigned === true,
            raw: raw === true ? { slug, signed: true } : { ...(raw || {}), slug }
        })
    })
    if (application.gapAnalysisStatus === 'Completed' || application.gapSubmittedAt) {
        agreements.push({
            id: 'gap-analysis',
            agreementId: 'gap-analysis',
            slug: 'gap-analysis',
            title: 'Gap Analysis',
            documentName: 'Gap Analysis',
            kind: 'agreement',
            status: 'valid',
            signed: true,
            raw: { agreementId: 'gap-analysis', signed: true }
        })
    }

    const canonical = new Map<string, GroupEvidence>()
        ;[...flat, ...uploads, ...agreements].forEach(item => {
            const kind = item.kind === 'agreement' ? 'agreement' : 'upload'
            const id = kind === 'agreement'
                ? canonicalAgreementId(item.agreementId || item.slug || item.id || item.title)
                : evidenceSlug(item, item.id)
            if (id) canonical.set(`${kind}:${id}`, item)
        })
    return Array.from(canonical.values())
}

async function loadInterventions(participantId: string | undefined, applicationId: string, programId: string) {
    const lookupField = participantId ? 'participantId' : 'applicationId'
    const lookupValue = participantId || applicationId
    const snapshot = await getDocs(query(
        collection(db, 'assignedInterventions'),
        where(lookupField, '==', lookupValue)
    ))
    return snapshot.docs
        .map(item => ({ id: item.id, ...(item.data() as any) }))
        .filter((item: any) => !item.programId || item.programId === programId)
        .map((item: any): GroupIntervention => ({
            id: item.id,
            title: item.interventionTitle,
            status: item.assignmentStatus,
            smeName: item.beneficiaryName || item.participantName || item.smeName || item.smmeName,
            facilitatorName: item.assigneeName || item.facilitatorName || item.assignedToName,
            departmentName: item.departmentName || item.areaOfSupport,
            participantAcceptanceStatus: item.participantAcceptanceStatus,
            assigneeAcceptanceStatus: item.assigneeAcceptanceStatus,
            participantCompletionStatus: item.participantCompletionStatus,
            assigneeCompletionStatus: item.assigneeCompletionStatus,
            movStatus: item.movStatus,
            movApproved: item.movApproved === true || String(item.movStatus || '').toLowerCase() === 'approved',
            departmentConfirmed: item.departmentConfirmed,
            proofValidated: item.proofValidated
        }))
}

export default function GroupMovementTimeline() {
    const { user } = useFullIdentity()
    const { activeProgramId } = useActiveProgramId()
    const [rows, setRows] = useState<SmeGroupRow[]>([])
    const [requirements, setRequirements] = useState<GroupRequirement[]>([])
    const [rules, setRules] = useState<GroupProgressionRules>({})
    const [loading, setLoading] = useState(false)
    const [busyKey, setBusyKey] = useState<string | null>(null)
    const [filterGroup, setFilterGroup] = useState<'all' | 'pending' | IncubationGroup>('all')
    const [filterStage, setFilterStage] = useState('all')
    const [searchText, setSearchText] = useState('')
    const [detailRow, setDetailRow] = useState<SmeGroupRow | null>(null)
    const [historyRow, setHistoryRow] = useState<SmeGroupRow | null>(null)
    const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([])

    useEffect(() => {
        setLoading(true)

        let disposed = false
        getDoc(doc(db, 'programs', activeProgramId)).then(snapshot => {
            if (disposed || !snapshot.exists()) return
            const program = snapshot.data() as any
            setRequirements(buildGroupRequirements(program.programRequirements || []))
            setRules(program.groupProgressionRules || {})
        }).catch(error => console.error('Unable to load group progression rules', error))

        const unsubscribe = onSnapshot(query(
            collection(db, 'applications'),

            where('programId', '==', activeProgramId),
            where('applicationStatus', 'in', ['accepted', 'Accepted'])
        ), async snapshot => {
            try {
                const loaded = await Promise.all(snapshot.docs.map(async applicationSnapshot => {
                    const application = { id: applicationSnapshot.id, ...(applicationSnapshot.data() as any) }
                    const participant = await resolveParticipant(application)
                    const participantData = participant?.data || {}
                    const [evidence, interventions] = await Promise.all([
                        loadEvidence(application, participantData),
                        loadInterventions(participant?.id, application.id, activeProgramId)
                    ])
                    return {
                        key: application.id,
                        applicationId: application.id,
                        participantId: participant?.id,
                        name: getName(application, participantData),
                        email: getEmail(application, participantData),
                        stage: participantData.stage || participantData.phase || application.stage || application.phase,
                        programName: application.programName || application.program || application.incubationProgram,
                        group: resolveApplicationGroup(application, participantData),
                        history: (Array.isArray(application.groupHistory) ? application.groupHistory : participantData.groupHistory) || [],
                        evidence,
                        interventions,
                        graduationApproved: application.graduationApproved === true,
                        lastReminderAt: toDate(application.groupReminder?.lastSentAt),
                        pendingMovement: application.pendingGroupMovement || null
                    } as SmeGroupRow
                }))
                if (!disposed) setRows(loaded)
            } catch (error) {
                console.error(error)
                message.error('Failed to load group progression data.')
                if (!disposed) setRows([])
            } finally {
                if (!disposed) setLoading(false)
            }
        }, error => {
            console.error(error)
            message.error('Failed to load accepted SMEs for the active program.')
            setLoading(false)
        })
        return () => {
            disposed = true
            unsubscribe()
        }
    }, [activeProgramId])

    const eligibilityFor = useCallback((row: SmeGroupRow): GroupEligibility =>
        evaluateGroupEligibility({
            current: row.group,
            requirements,
            evidence: row.evidence,
            interventions: row.interventions,
            rules,
            graduationApproved: row.graduationApproved
        }), [requirements, rules])

    const departmentName = String((user as any)?.departmentName || (user as any)?.department || '')
    const isROM = isRomDepartment(departmentName)
    const isME = isMonitoringAndEvaluationDepartment(departmentName)

    useEffect(() => {
        if (loading) return
        rows.forEach(row => {
            const eligibility = eligibilityFor(row)
            if (!eligibility.eligible || !eligibility.target || row.pendingMovement) return
            void notifyRomSmeReady({
                applicationId: row.applicationId,
                smeName: row.name,
                programName: row.programName,
                current: row.group,
                target: eligibility.target,
                requirementsMet: eligibility.met
            })
        })
    }, [eligibilityFor, loading, rows])

    const stages = useMemo(() => Array.from(new Set(rows.map(row => row.stage).filter(Boolean))) as string[], [rows])
    const filteredRows = useMemo(() => {
        const keyword = searchText.trim().toLowerCase()
        return rows.filter(row => {
            const matchesGroup = filterGroup === 'all' ||
                (filterGroup === 'pending' ? !!row.pendingMovement : row.group === filterGroup)
            const matchesStage = filterStage === 'all' || row.stage === filterStage
            const matchesSearch = !keyword || [
                row.name,
                row.email,
                row.programName,
                row.stage,
                row.group
            ].some(value => String(value || '').toLowerCase().includes(keyword))
            return matchesGroup && matchesStage && matchesSearch
        })
    }, [rows, filterGroup, filterStage, searchText])

    const metrics = useMemo(() => ({
        total: rows.length,
        pending: rows.filter(row => row.pendingMovement).length,
        eligible: rows.filter(row => {
            const eligibility = eligibilityFor(row)
            return eligibility.eligible && !!eligibility.target && !row.pendingMovement
        }).length,
        graduated: rows.filter(row => row.group === 'Graduated').length
    }), [eligibilityFor, rows])

    const sendReminder = useCallback(async (row: SmeGroupRow) => {
        const eligibility = eligibilityFor(row)
        if (!eligibility.target) return
        if (!row.email) {
            message.error('Add an email address to the SME application before sending a reminder.')
            return
        }
        setBusyKey(`reminder:${row.key}`)
        try {
            await sendGroupDetailsReminder({
                applicationId: row.applicationId,
                participantId: row.participantId,
                email: row.email,
                name: row.name,
                programName: row.programName,
                current: row.group,
                target: eligibility.target,
                missing: outstandingReminderItems(eligibility),
                sentBy: user?.email || (user as any)?.name
            })
            message.success(`Details reminder emailed to ${row.name}.`)
        } catch (error: any) {
            message.error(error?.message || 'The reminder email could not be sent.')
        } finally {
            setBusyKey(null)
        }
    }, [eligibilityFor, user])

    const requestMovement = useCallback(async (row: SmeGroupRow) => {
        const eligibility = eligibilityFor(row)
        if (!eligibility.eligible || !eligibility.target) return
        setBusyKey(`promote:${row.key}`)
        try {
            const result = await requestSmeGroupMovement({
                applicationId: row.applicationId,
                participantId: row.participantId,
                current: row.group,
                target: eligibility.target,
                actor: {
                    id: (user as any)?.uid || (user as any)?.id,
                    name: (user as any)?.name || user?.displayName || user?.email || 'Operations',
                    email: user?.email,
                    departmentName
                },
                reason: eligibility.summary,
                requirementsMet: eligibility.met,
                smeName: row.name,
                programName: row.programName
            })
            if (result.notificationError || !result.notificationSent) {
                message.warning(`Movement submitted, but the M&E notification email was not delivered. M&E can still see it in the pending queue.`)
            } else {
                message.success(`${row.name}'s movement was submitted and emailed to M&E.`)
            }
        } catch (error: any) {
            message.error(error?.message || 'The group movement request could not be submitted.')
        } finally {
            setBusyKey(null)
        }
    }, [departmentName, eligibilityFor, user])

    const confirmMovement = useCallback(async (row: SmeGroupRow) => {
        if (!row.pendingMovement) return
        if (!eligibilityFor(row).eligible) {
            message.error('This SME no longer meets the progression requirements. Return the request to ROM for review.')
            return
        }
        setBusyKey(`confirm:${row.key}`)
        try {
            const nextEligibility = evaluateGroupEligibility({
                current: row.pendingMovement.to,
                requirements,
                evidence: row.evidence,
                interventions: row.interventions,
                rules,
                graduationApproved: false
            })
            const result = await confirmSmeGroupMovement({
                applicationId: row.applicationId,
                participantId: row.participantId,
                request: row.pendingMovement,
                actor: {
                    id: (user as any)?.uid || (user as any)?.id,
                    name: (user as any)?.name || user?.email || 'M&E',
                    email: user?.email,
                    departmentName
                },
                smeName: row.name,
                smeEmail: row.email,
                programName: row.programName,
                nextRequirements: nextEligibility.missing
            })
            if (!row.email) {
                message.warning(`Movement confirmed, but ${row.name} has no email address for the congratulations message.`)
            } else if (result.notificationError || !result.notificationSent) {
                message.warning('Movement confirmed, but the SME congratulations email was not delivered.')
            } else {
                message.success(`Movement confirmed and ${row.name} was emailed the next-stage requirements.`)
            }
        } catch (error: any) {
            message.error(error?.message || 'The movement could not be confirmed.')
        } finally {
            setBusyKey(null)
        }
    }, [departmentName, eligibilityFor, requirements, rules, user])

    const returnMovement = useCallback(async (row: SmeGroupRow) => {
        if (!row.pendingMovement) return
        setBusyKey(`return:${row.key}`)
        try {
            await returnSmeGroupMovement({
                applicationId: row.applicationId,
                request: row.pendingMovement,
                actor: {
                    id: (user as any)?.uid || (user as any)?.id,
                    name: (user as any)?.name || user?.email || 'M&E',
                    email: user?.email,
                    departmentName
                }
            })
            message.success(`The movement request for ${row.name} was returned to ROM.`)
        } catch (error: any) {
            message.error(error?.message || 'The movement request could not be returned.')
        } finally {
            setBusyKey(null)
        }
    }, [departmentName, user])

    const remindAll = async () => {
        const targets = filteredRows.filter(row => {
            const eligibility = eligibilityFor(row)
            const reminderIsRecent = !!row.lastReminderAt &&
                Date.now() - row.lastReminderAt.getTime() < 24 * 60 * 60 * 1000
            return !!row.email && !!eligibility.target && !eligibility.eligible &&
                eligibility.missing.length > 0 && !reminderIsRecent
        })
        if (!targets.length) {
            message.info('No SMEs in this view need a details reminder.')
            return
        }
        setBusyKey('reminder:all')
        let sent = 0
        for (const row of targets) {
            try {
                const eligibility = eligibilityFor(row)
                await sendGroupDetailsReminder({
                    applicationId: row.applicationId,
                    participantId: row.participantId,
                    email: row.email!,
                    name: row.name,
                    programName: row.programName,
                    current: row.group,
                    target: eligibility.target!,
                    missing: outstandingReminderItems(eligibility),
                    sentBy: user?.email || (user as any)?.name
                })
                sent += 1
            } catch (error) {
                console.error(`Failed group reminder for ${row.name}`, error)
            }
        }
        setBusyKey(null)
        sent === targets.length
            ? message.success(`${sent} reminder email${sent === 1 ? '' : 's'} sent.`)
            : message.warning(`${sent} of ${targets.length} reminder emails sent.`)
    }

    const submitSelectedToME = async () => {
        const targets = filteredRows.filter(row =>
            selectedRowKeys.includes(row.key) &&
            !row.pendingMovement &&
            eligibilityFor(row).eligible &&
            !!eligibilityFor(row).target
        )
        if (!targets.length) {
            message.info('Select at least one eligible SME.')
            return
        }
        setBusyKey('bulk:submit')
        const batchId = `group-movement-${Date.now()}`
        const submitted: Array<{
            applicationId: string
            requestId: string
            smeName: string
            current: IncubationGroup
            target: IncubationGroup
        }> = []
        const failed: string[] = []
        for (const row of targets) {
            try {
                const eligibility = eligibilityFor(row)
                const result = await requestSmeGroupMovement({
                    applicationId: row.applicationId,
                    participantId: row.participantId,
                    current: row.group,
                    target: eligibility.target!,
                    actor: {
                        id: (user as any)?.uid || (user as any)?.id,
                        name: (user as any)?.name || user?.displayName || user?.email || 'Operations',
                        email: user?.email,
                        departmentName
                    },
                    reason: eligibility.summary,
                    requirementsMet: eligibility.met,
                    smeName: row.name,
                    programName: row.programName,
                    batchId,
                    suppressNotification: true
                })
                submitted.push({
                    applicationId: row.applicationId,
                    requestId: result.request.id,
                    smeName: row.name,
                    current: row.group,
                    target: eligibility.target!
                })
            } catch (error: any) {
                failed.push(`${row.name}: ${error?.message || 'submission failed'}`)
            }
        }
        let emailFailed = false
        if (submitted.length) {
            try {
                await notifyMeGroupMovementBatch({
                    batchId,
                    programName: targets[0]?.programName,
                    submittedBy: (user as any)?.name || user?.email || 'ROM',
                    movements: submitted
                })
            } catch (error) {
                console.error('Bulk M&E notification failed', error)
                emailFailed = true
            }
        }
        setBusyKey(null)
        setSelectedRowKeys([])
        if (failed.length) {
            message.warning(`${submitted.length} submitted; ${failed.length} failed. ${failed.join(' | ')}`)
        } else if (emailFailed) {
            message.warning(`${submitted.length} submitted, but the M&E summary email was not delivered. The requests remain visible here.`)
        } else {
            message.success(`${submitted.length} movement request${submitted.length === 1 ? '' : 's'} submitted to M&E.`)
        }
    }

    const confirmSelectedMovements = async () => {
        const targets = filteredRows.filter(row =>
            selectedRowKeys.includes(row.key) && !!row.pendingMovement
        )
        if (!targets.length) {
            message.info('Select at least one pending movement.')
            return
        }
        setBusyKey('bulk:confirm')
        let confirmed = 0
        const failed: string[] = []
        for (const row of targets) {
            try {
                const eligibility = eligibilityFor(row)
                if (!eligibility.eligible) {
                    throw new Error('progression requirements are no longer met')
                }
                const nextEligibility = evaluateGroupEligibility({
                    current: row.pendingMovement!.to,
                    requirements,
                    evidence: row.evidence,
                    interventions: row.interventions,
                    rules,
                    graduationApproved: false
                })
                await confirmSmeGroupMovement({
                    applicationId: row.applicationId,
                    participantId: row.participantId,
                    request: row.pendingMovement!,
                    actor: {
                        id: (user as any)?.uid || (user as any)?.id,
                        name: (user as any)?.name || user?.email || 'M&E',
                        email: user?.email,
                        departmentName
                    },
                    smeName: row.name,
                    smeEmail: row.email,
                    programName: row.programName,
                    nextRequirements: nextEligibility.missing
                })
                confirmed += 1
            } catch (error: any) {
                failed.push(`${row.name}: ${error?.message || 'confirmation failed'}`)
            }
        }
        setBusyKey(null)
        setSelectedRowKeys([])
        failed.length
            ? message.warning(`${confirmed} confirmed; ${failed.length} failed. ${failed.join(' | ')}`)
            : message.success(`${confirmed} movement${confirmed === 1 ? '' : 's'} confirmed.`)
    }

    const columns = [
        {
            title: 'SME', key: 'name', width: 250,
            render: (_: unknown, row: SmeGroupRow) => <div style={{ minWidth: 0 }}>
                <Text strong ellipsis style={{ maxWidth: 220, display: 'block' }}>
                    <ProfileOutlined style={{ marginRight: 6 }} />{row.name}
                </Text>
                <Text type='secondary' ellipsis style={{ maxWidth: 220, display: 'block', fontSize: 12 }}>
                    {row.email || 'No email address'}
                </Text>
            </div>
        },
        { title: 'Stage', dataIndex: 'stage', key: 'stage', width: 140, render: (value: string) => value ? <Tag color='purple'>{value}</Tag> : '—' },
        { title: 'Current group', dataIndex: 'group', key: 'group', width: 140, render: (group: IncubationGroup) => <Tag color={groupColors[group]}>{groupLabel(group)}</Tag> },
        {
            title: 'Progress', key: 'progress', width: 300,
            render: (_: unknown, row: SmeGroupRow) => {
                const eligibility = eligibilityFor(row)
                return <div>
                    <Progress percent={eligibility.progress} size='small' status={eligibility.eligible ? 'success' : 'active'} />
                    <Text type='secondary'>{eligibility.summary}</Text>
                    {!eligibility.eligible && eligibility.missing.length ? <div style={{ marginTop: 6 }}>
                        <Space direction='vertical' size={2}>
                            {(eligibility.requirements?.filter(item => !item.met).slice(0, 2) ||
                                eligibility.missing.slice(0, 2).map(item => ({
                                    id: item,
                                    title: item,
                                    status: 'missing'
                                }))).map(item => <Space key={item.id} size={6} wrap>
                                    <Text type='secondary' style={{ fontSize: 12 }}>{item.title}</Text>
                                    <Tag color={complianceStatusColor(item.status)} style={{ marginInlineEnd: 0 }}>
                                        {complianceStatusLabel(item.status)}
                                    </Tag>
                                </Space>)}
                            {eligibility.missing.length > 2
                                ? <Text type='secondary' style={{ fontSize: 12 }}>+{eligibility.missing.length - 2} more</Text>
                                : null}
                        </Space>
                    </div> : null}
                </div>
            }
        },
        {
            title: 'Action', key: 'action', width: 390,
            render: (_: unknown, row: SmeGroupRow) => {
                const eligibility = eligibilityFor(row)
                return <Space wrap size={6}>
                    {row.pendingMovement ? <Tag color='processing'>Awaiting M&E confirmation</Tag> : null}
                    {isROM && !row.pendingMovement && eligibility.eligible && eligibility.target ? <Button
                        type='primary'
                        loading={busyKey === `promote:${row.key}`}
                        disabled={!!busyKey}
                        onClick={() => Modal.confirm({
                            title: `Submit ${row.name}'s movement to ${groupLabel(eligibility.target!)}?`,
                            content: 'ROM will submit this movement for M&E confirmation. The SME remains in the current group until M&E confirms it.',
                            okText: 'Submit to M&E',
                            onOk: () => requestMovement(row)
                        })}
                    >Submit {groupLabel(eligibility.target)}</Button> : null}
                    {isME && row.pendingMovement ? <Button
                        type='primary'
                        loading={busyKey === `confirm:${row.key}`}
                        disabled={!!busyKey}
                        onClick={() => Modal.confirm({
                            title: `Confirm movement to ${groupLabel(row.pendingMovement!.to)}?`,
                            content: `ROM submitted this request on ${formatDateTime(row.pendingMovement!.requestedAt)}. Confirmation changes the SME's group in both the application and participant record.`,
                            okText: 'Confirm movement',
                            onOk: () => confirmMovement(row)
                        })}
                    >Confirm movement</Button> : null}
                    {isME && row.pendingMovement ? <Button
                        danger
                        loading={busyKey === `return:${row.key}`}
                        disabled={!!busyKey}
                        onClick={() => Modal.confirm({
                            title: 'Return this request to ROM?',
                            content: 'The SME stays in its current group and ROM can review and resubmit the movement.',
                            okText: 'Return to ROM',
                            okButtonProps: { danger: true },
                            onOk: () => returnMovement(row)
                        })}
                    >Return to ROM</Button> : null}
                    {isROM && !row.pendingMovement && !eligibility.eligible && eligibility.target && eligibility.missing.length ? <Button
                        shape='round'
                        icon={<MailOutlined />}
                        loading={busyKey === `reminder:${row.key}`}
                        disabled={!!busyKey || !row.email}
                        onClick={() => sendReminder(row)}
                    >Remind SME</Button> : null}
                    <Button shape='round' type='default' onClick={() => setDetailRow(row)}>Details</Button>
                    <Button shape='round' type='dashed' icon={<HistoryOutlined />} onClick={() => setHistoryRow(row)}>History</Button>
                </Space>
            }
        }
    ]

    return <div style={{ minHeight: '100vh', padding: 24 }}>
        <Helmet><title>Groups | Smart Incubator</title></Helmet>
        {loading ? <MotionCard>
            <Skeleton active title={{ width: '32%' }} paragraph={{ rows: 10 }} />
        </MotionCard> : <>
            <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
                <Col xs={24} sm={12} xl={6}>
                    <MotionCard.Metric
                        icon={<TeamOutlined style={{ color: '#1677ff' }} />}
                        iconBg='rgba(22,119,255,0.12)'
                        title='Total SMEs'
                        value={metrics.total}
                        subtitle={`${filteredRows.length} in current view`}
                    />
                </Col>
                <Col xs={24} sm={12} xl={6}>
                    <MotionCard.Metric
                        icon={<CheckCircleOutlined style={{ color: '#52c41a' }} />}
                        iconBg='rgba(82,196,26,0.14)'
                        title='Ready for ROM'
                        value={metrics.eligible}
                        subtitle='Eligible, not yet submitted'
                    />
                </Col>
                <Col xs={24} sm={12} xl={6}>
                    <MotionCard.Metric
                        icon={<ClockCircleOutlined style={{ color: '#faad14' }} />}
                        iconBg='rgba(250,173,20,0.16)'
                        title='Pending M&E'
                        value={metrics.pending}
                        subtitle='Submitted by ROM'
                    />
                </Col>
                <Col xs={24} sm={12} xl={6}>
                    <MotionCard.Metric
                        icon={<TrophyOutlined style={{ color: '#13c2c2' }} />}
                        iconBg='rgba(19,194,194,0.14)'
                        title='Graduated'
                        value={metrics.graduated}
                        subtitle='Completed incubation'
                    />
                </Col>
            </Row>

            {!isROM && !isME && <Alert
                type='info' showIcon style={{ marginBottom: 16 }}
                message='Group movements are read-only for your department'
                description='ROM submits eligible movements and M&E confirms or returns them.'
            />}

            {!requirements.length && <Alert
                type='warning' showIcon style={{ marginBottom: 16 }}
                message='Group A progression is not configured for this program'
                description='Add program requirements before moving SMEs from Group A. The system will not infer or fabricate a compliance pack.'
            />}

            <MotionCard
                filterBar={
                    <Row gutter={12} align='middle' wrap={false} style={{ minWidth: 1180 }}>
                        <Col flex='1 1 320px'>
                            <Segmented value={filterGroup} onChange={value => setFilterGroup(value as any)} options={[
                                { label: 'All', value: 'all' },
                                ...(isME ? [{ label: `Pending M&E (${metrics.pending})`, value: 'pending' }] : []),
                                ...GROUPS.map(group => ({ label: groupLabel(group), value: group }))
                            ]} />
                        </Col>
                        <Col flex='1 1 220px'>
                            <Input
                                allowClear
                                prefix={<SearchOutlined />}
                                placeholder='Search SMEs by name or email'
                                value={searchText}
                                onChange={event => setSearchText(event.target.value)}
                            />
                        </Col>
                        <Col flex='0 1 160px'>
                            <Select value={filterStage} onChange={setFilterStage} style={{ width: '100%' }} options={[
                                { label: 'All stages', value: 'all' }, ...stages.map(stage => ({ label: stage, value: stage }))
                            ]} />
                        </Col>
                        <Col flex='none'>
                            <Space wrap={false} size={8}>
                                {isROM && <Button
                                    shape='round'
                                    icon={<MailOutlined />
                                    }
                                    loading={busyKey === 'reminder:all'}
                                    disabled={!!busyKey}
                                    onClick={() => Modal.confirm({
                                        title: 'Email all pending SMEs in this view?',
                                        content: 'Each SME receives only the details they still need for their next group. SMEs reminded in the last 24 hours are skipped.',
                                        okText: 'Send reminders',
                                        onOk: remindAll
                                    })}>Remind all pending</Button>}
                                {isROM && <Button
                                    type='primary'
                                    loading={busyKey === 'bulk:submit'}
                                    disabled={!!busyKey || !selectedRowKeys.length}
                                    onClick={() => Modal.confirm({
                                        title: `Submit ${selectedRowKeys.length} selected SME${selectedRowKeys.length === 1 ? '' : 's'} to M&E?`,
                                        content: 'Only eligible selections will be submitted. M&E receives one summary email and the SMEs remain in their current groups until confirmation.',
                                        okText: 'Submit selected',
                                        onOk: submitSelectedToME
                                    })}
                                >Submit selected to M&E</Button>}
                                {isME && <Button
                                    type='primary'
                                    loading={busyKey === 'bulk:confirm'}
                                    disabled={!!busyKey || !selectedRowKeys.length}
                                    onClick={() => Modal.confirm({
                                        title: `Confirm ${selectedRowKeys.length} selected movement${selectedRowKeys.length === 1 ? '' : 's'}?`,
                                        content: 'Eligibility is checked again before each promotion. Confirmed SMEs are updated in both application and participant records.',
                                        okText: 'Confirm selected',
                                        onOk: confirmSelectedMovements
                                    })}
                                >Confirm selected</Button>}
                            </Space>
                        </Col>
                    </Row>
                }>
                <Table
                    columns={columns as any}
                    dataSource={filteredRows}
                    rowKey='key'
                    pagination={{ pageSize: 10 }}
                    rowSelection={isROM || isME ? {
                        selectedRowKeys,
                        onChange: setSelectedRowKeys,
                        getCheckboxProps: (row: SmeGroupRow) => {
                            return {
                                disabled: isROM
                                    ? row.group === 'Graduated'
                                    : !row.pendingMovement
                            }
                        }
                    } : undefined}
                /></MotionCard>
        </>}

        <Modal width={900} open={!!detailRow} onCancel={() => setDetailRow(null)} footer={null} title={detailRow ? `${detailRow.name}: group progression` : ''}>
            {detailRow && (() => {
                const eligibility = eligibilityFor(detailRow)
                return <Space direction='vertical' style={{ width: '100%' }} size='middle'>
                    <Descriptions size='small' column={1} bordered>
                        <Descriptions.Item label='Current'>{groupLabel(detailRow.group)}</Descriptions.Item>
                        <Descriptions.Item label='Next'>{eligibility.target ? groupLabel(eligibility.target) : 'Incubation complete'}</Descriptions.Item>
                        <Descriptions.Item label='Last reminder'>{detailRow.lastReminderAt ? formatDateTime(detailRow.lastReminderAt) : 'Never'}</Descriptions.Item>
                        <Descriptions.Item label='Movement approval'>{detailRow.pendingMovement
                            ? `Awaiting M&E confirmation — submitted by ${detailRow.pendingMovement.requestedBy}`
                            : 'No movement awaiting confirmation'}</Descriptions.Item>
                    </Descriptions>
                    <Progress percent={eligibility.progress} status={eligibility.eligible ? 'success' : 'active'} />
                    {eligibility.requirements?.length ? <Table
                        size='small'
                        pagination={false}
                        rowKey='id'
                        dataSource={eligibility.requirements}
                        columns={[
                            {
                                title: 'Requirement',
                                dataIndex: 'title',
                                key: 'title'
                            },
                            {
                                title: 'Status',
                                dataIndex: 'status',
                                key: 'status',
                                width: 150,
                                render: (status: string) => <Tag color={complianceStatusColor(status)}>
                                    {complianceStatusLabel(status)}
                                </Tag>
                            },
                            {
                                title: 'Why',
                                dataIndex: 'reason',
                                key: 'reason',
                                render: (reason: string) => <Text>{reason}</Text>
                            }
                        ]}
                        scroll={{ x: 680 }}
                    /> : <>
                        {eligibility.met.length ? <Alert type='success' showIcon message='Completed' description={<ul>{eligibility.met.map(item => <li key={item}>{item}</li>)}</ul>} /> : null}
                        {eligibility.missing.length ? <Alert type='warning' showIcon message='Details or actions still needed' description={<ul>{eligibility.missing.map(item => <li key={item}>{item}</li>)}</ul>} /> : null}
                    </>}
                </Space>
            })()}
        </Modal>

        <Modal open={!!historyRow} onCancel={() => setHistoryRow(null)} footer={null} title={historyRow ? `${historyRow.name}: movement history` : ''}>
            {historyRow && historyRow.history.length ? <Space direction='vertical' style={{ width: '100%' }}>
                {[...historyRow.history].reverse().map((entry, index) => <MotionCard key={`${entry.date}-${index}`}>
                    <Text strong>{entry.from ? groupLabel(entry.from) : 'Joined'} → {groupLabel(entry.to)}</Text>
                    <div><Text type='secondary'>{formatDateTime(entry.date)} · {entry.by}</Text></div>
                    <div>{entry.reason}</div>
                </MotionCard>)}
            </Space> : <Empty description='No recorded group movements yet' />}
        </Modal>
    </div>
}
