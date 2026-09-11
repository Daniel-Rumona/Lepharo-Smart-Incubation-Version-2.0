import React, { useEffect, useMemo, useState } from 'react'
import {
    Alert,
    Button,
    Col,
    Collapse,
    Descriptions,
    Progress,
    Row,
    Skeleton,
    Space,
    Tag,
    Typography,
    message
} from 'antd'
import { CheckCircleOutlined, ClockCircleOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { useNavigate } from 'react-router-dom'
import {
    collection,
    doc,
    getDoc,
    getDocs,
    limit,
    query,
    where
} from 'firebase/firestore'
import { db } from '@/firebase'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import {
    evaluateGroupEligibility,
    groupLabel,
    resolveApplicationGroup,
    type GroupEligibility,
    type GroupEvidence,
    type GroupHistoryEntry,
    type GroupIntervention,
    type GroupRequirement,
    type IncubationGroup
} from '@/services/groupLifecycleService'
import { isIncubateeAgreementSigned, mergeAgreementSources } from '@/utils/agreementStatus'
import {
    canonicalAgreementId,
    complianceStatusLabel,
    resolveComplianceRequirements
} from '@/services/complianceResolver'

const { Text, Title } = Typography

const statusColor = (status: string) => {
    if (['valid', 'signed'].includes(status)) return 'green'
    if (status === 'expiring-soon') return 'orange'
    if (status === 'pending') return 'blue'
    return 'red'
}

const toDate = (value: any): Date | null => {
    if (!value) return null
    if (typeof value?.toDate === 'function') return value.toDate()
    if (value instanceof Date) return value
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed
}

async function loadEvidence(application: any): Promise<GroupEvidence[]> {
    const flat: GroupEvidence[] = Array.isArray(application.complianceDocuments)
        ? application.complianceDocuments.map((item: any, index: number) => ({
            id: item.agreementId || item.presetId || item.id || `flat-${index}`,
            agreementId: item.agreementId,
            title: item.title || item.documentName || item.name || item.type || '',
            presetId: item.presetId,
            documentName: item.documentName || item.title || item.type,
            kind: item.agreementId ? 'agreement' : 'upload',
            status: item.verificationStatus ?? item.status ?? item.verified ?? item.approved,
            signed: item.signed === true,
            expiryDate: item.expiryDate,
            raw: item
        }))
        : []
    const [uploadsSnapshot, agreementsSnapshot] = await Promise.all([
        getDocs(collection(db, 'applications', application.id, 'complianceDocuments')),
        getDocs(collection(db, 'applications', application.id, 'agreements'))
    ])
    const uploads: GroupEvidence[] = uploadsSnapshot.docs.map(snapshot => {
        const item = snapshot.data() as any
        return {
            id: snapshot.id,
            title: item.title || item.documentName || item.name || item.type || snapshot.id,
            presetId: item.presetId,
            documentName: item.documentName || item.title || item.type,
            kind: 'upload',
            status: item.verificationStatus ?? item.status ?? item.verified ?? item.approved,
            expiryDate: item.expiryDate,
            raw: item
        }
    })
    const storedAgreements: Record<string, any> = {}
    agreementsSnapshot.docs.forEach(snapshot => { storedAgreements[snapshot.id] = snapshot.data() })
    const mergedAgreements = mergeAgreementSources(storedAgreements, application.signedAgreements)
    const agreements: GroupEvidence[] = Object.entries(mergedAgreements).map(([key, item]: [string, any]) => {
        const slug = canonicalAgreementId(key)
        return {
            id: slug,
            agreementId: slug,
            title: item.title || slug,
            kind: 'agreement',
            signed: isIncubateeAgreementSigned(item, slug),
            raw: item
        }
    })
    if (application.gapAnalysisStatus === 'Completed' || application.gapSubmittedAt) {
        const gapEvidence = agreements.find(item => item.agreementId === 'gap-analysis')
        if (gapEvidence) {
            gapEvidence.signed = true
            gapEvidence.raw = { ...(gapEvidence.raw || {}), agreementId: 'gap-analysis', signed: true }
        } else {
            agreements.push({
                id: 'gap-analysis',
                agreementId: 'gap-analysis',
                title: 'gap-analysis',
                kind: 'agreement',
                signed: true,
                raw: { agreementId: 'gap-analysis', signed: true }
            })
        }
    }
    return [...flat, ...uploads, ...agreements]
}

export default function GroupProgressForm() {
    const { user } = useFullIdentity()
    const navigate = useNavigate()
    const [loading, setLoading] = useState(true)
    const [application, setApplication] = useState<any>(null)
    const [participant, setParticipant] = useState<any>(null)
    const [requirements, setRequirements] = useState<GroupRequirement[]>([])
    const [evidence, setEvidence] = useState<GroupEvidence[]>([])
    const [interventions, setInterventions] = useState<GroupIntervention[]>([])
    const [rules, setRules] = useState<any>({})

    useEffect(() => {
        if (!user?.email) {
            setLoading(false)
            return
        }
        let disposed = false
        ;(async () => {
            setLoading(true)
            try {
                const participantSnapshot = await getDocs(query(
                    collection(db, 'participants'),
                    where('email', '==', user.email),
                    limit(1)
                ))
                const participantRecord = participantSnapshot.empty
                    ? null
                    : { id: participantSnapshot.docs[0].id, ...(participantSnapshot.docs[0].data() as any) }

                let applicationSnapshot
                if (participantRecord?.id) {
                    applicationSnapshot = await getDocs(query(
                        collection(db, 'applications'),
                        where('participantId', '==', participantRecord.id),
                        limit(10)
                    ))
                }
                if (!applicationSnapshot || applicationSnapshot.empty) {
                    applicationSnapshot = await getDocs(query(
                        collection(db, 'applications'),
                        where('email', '==', user.email),
                        limit(10)
                    ))
                }
                const accepted = applicationSnapshot.docs.find(snapshot =>
                    ['accepted', 'active'].includes(String(snapshot.data().applicationStatus || '').toLowerCase())
                ) || applicationSnapshot.docs[0]
                if (!accepted) {
                    if (!disposed) {
                        setApplication(null)
                        setParticipant(participantRecord)
                    }
                    return
                }
                const applicationRecord = { id: accepted.id, ...(accepted.data() as any) }
                const programSnapshot = applicationRecord.programId
                    ? await getDoc(doc(db, 'programs', applicationRecord.programId))
                    : null
                const program = programSnapshot?.exists() ? programSnapshot.data() as any : {}

                const [loadedEvidence, interventionSnapshot, resolvedCompliance] = await Promise.all([
                    loadEvidence(applicationRecord),
                    participantRecord?.id
                        ? getDocs(query(collection(db, 'assignedInterventions'), where('participantId', '==', participantRecord.id)))
                        : getDocs(query(collection(db, 'assignedInterventions'), where('applicationId', '==', applicationRecord.id))),
                    applicationRecord.programId
                        ? resolveComplianceRequirements(applicationRecord.programId, { includeAllDepartments: true })
                        : Promise.resolve({ requirements: [], agreements: [] })
                ])
                const loadedInterventions: GroupIntervention[] = interventionSnapshot.docs
                    .map(snapshot => ({ id: snapshot.id, ...(snapshot.data() as any) }))
                    .filter((item: any) => !applicationRecord.programId || !item.programId || item.programId === applicationRecord.programId)
                    .map((item: any) => ({
                        id: item.id,
                        title: item.title || item.interventionName || item.name,
                        status: item.status,
                        movApproved: item.movApproved === true || String(item.movStatus || '').toLowerCase() === 'approved',
                        departmentConfirmed: item.departmentConfirmed,
                        proofValidated: item.proofValidated
                    }))
                if (!disposed) {
                    setApplication(applicationRecord)
                    setParticipant(participantRecord)
                    setRequirements(resolvedCompliance.requirements.map(requirement => ({
                        id: requirement.id,
                        title: requirement.title,
                        kind: requirement.kind,
                        agreementId: requirement.agreementId
                    })))
                    setRules(program.groupProgressionRules || {})
                    setEvidence(loadedEvidence)
                    setInterventions(loadedInterventions)
                }
            } catch (error) {
                console.error(error)
                message.error('Failed to load your group progression details.')
            } finally {
                if (!disposed) setLoading(false)
            }
        })()
        return () => { disposed = true }
    }, [user?.email])

    const group = useMemo<IncubationGroup>(() =>
        resolveApplicationGroup(application || {}, participant || {}), [application, participant])
    const eligibility = useMemo<GroupEligibility>(() => evaluateGroupEligibility({
        current: group,
        requirements,
        evidence,
        interventions,
        rules,
        graduationApproved: application?.graduationApproved === true
    }), [application?.graduationApproved, evidence, group, interventions, requirements, rules])

    const reminderDate = toDate(application?.groupReminder?.lastSentAt)
    const pendingMovement = application?.pendingGroupMovement
    const history: GroupHistoryEntry[] = Array.isArray(application?.groupHistory)
        ? application.groupHistory
        : Array.isArray(participant?.groupHistory) ? participant.groupHistory : []

    if (loading) return <MotionCard><Skeleton active /></MotionCard>
    if (!application) return <MotionCard>
        <Alert type='info' showIcon message='No active incubation application found' description='Your group becomes available after an application is accepted into a program.' />
    </MotionCard>

    return <MotionCard>
        <Row gutter={[16, 12]} align='middle' justify='space-between'>
            <Col><Title level={3} style={{ margin: 0 }}>Group progression</Title>
                <Text type='secondary'>A live view of what is complete and what you need to provide next.</Text>
            </Col>
            <Col><Tag color={group === 'Graduated' ? 'green' : 'blue'} style={{ fontSize: 16, padding: '6px 12px' }}>{groupLabel(group)}</Tag></Col>
        </Row>

        <Progress percent={eligibility.progress} status={eligibility.eligible ? 'success' : 'active'} strokeWidth={12} style={{ margin: '24px 0 12px' }} />
        <Alert
            type={eligibility.eligible ? 'success' : group === 'Graduated' ? 'success' : 'info'}
            showIcon
            message={eligibility.target ? `${groupLabel(eligibility.target)} readiness` : 'Incubation completed'}
            description={eligibility.summary}
            style={{ marginBottom: 16 }}
        />

        {pendingMovement?.status === 'pending_me_confirmation' && <Alert
            type='info'
            showIcon
            message={`ROM submitted your movement to ${groupLabel(pendingMovement.to)} for M&E confirmation`}
            description={`Submitted ${dayjs(pendingMovement.requestedAt).format('DD MMM YYYY [at] HH:mm')}. You remain in ${groupLabel(group)} until M&E completes its review.`}
            style={{ marginBottom: 16 }}
        />}

        {reminderDate && <Alert
            type='warning' showIcon icon={<ClockCircleOutlined />}
            message={`Operations requested outstanding details on ${dayjs(reminderDate).format('DD MMM YYYY [at] HH:mm')}`}
            description='Complete the items marked outstanding below. Your progress updates from the records reviewed by Operations and ROM.'
            style={{ marginBottom: 16 }}
        />}

        <Collapse defaultActiveKey={['outstanding', 'completed']} items={[
            {
                key: 'outstanding',
                label: `Outstanding (${eligibility.missing.length})`,
                children: eligibility.missing.length ? <Space direction='vertical' style={{ width: '100%' }}>
                    {(eligibility.requirements?.filter(item => !item.met) ||
                        eligibility.missing.map(item => ({ id: item, title: item, status: 'missing', met: false })))
                        .map(item => <Row key={item.id} justify='space-between' align='middle' gutter={8}>
                            <Col flex='auto'><Text>{item.title}</Text></Col>
                            <Col><Tag color={statusColor(item.status)}>{complianceStatusLabel(item.status)}</Tag></Col>
                        </Row>)}
                    {group === 'A' && <Button
                        block
                        type='primary'
                        style={{ marginTop: 12 }}
                        onClick={() => navigate('/incubatee/documents/compliance')}
                    >
                        Open compliance
                    </Button>}
                </Space> : <Alert type='success' showIcon message='Nothing outstanding' description={eligibility.target ? 'Operations can now review and confirm your movement.' : 'Your incubation journey is complete.'} />
            },
            {
                key: 'completed',
                label: `Completed (${eligibility.met.length})`,
                children: eligibility.met.length ? <Space direction='vertical' style={{ width: '100%' }}>
                    {(eligibility.requirements?.filter(item => item.met) ||
                        eligibility.met.map(item => ({ id: item, title: item, status: 'valid', met: true })))
                        .map(item => <Row key={item.id} justify='space-between' align='middle' gutter={8}>
                            <Col flex='auto'><Text><CheckCircleOutlined style={{ color: '#52c41a', marginRight: 8 }} />{item.title}</Text></Col>
                            <Col><Tag color={statusColor(item.status)}>{complianceStatusLabel(item.status)}</Tag></Col>
                        </Row>)}
                </Space> : <Text type='secondary'>No progression requirements have been verified yet.</Text>
            },
            {
                key: 'history',
                label: `Movement history (${history.length})`,
                children: history.length ? <Space direction='vertical' style={{ width: '100%' }}>
                    {[...history].reverse().map((entry, index) => <Descriptions key={`${entry.date}-${index}`} size='small' bordered column={1}>
                        <Descriptions.Item label='Movement'>{entry.from ? groupLabel(entry.from) : 'Joined'} → {groupLabel(entry.to)}</Descriptions.Item>
                        <Descriptions.Item label='Date'>{dayjs(entry.date).format('DD MMM YYYY HH:mm')}</Descriptions.Item>
                        <Descriptions.Item label='Confirmed by'>{entry.by}</Descriptions.Item>
                        <Descriptions.Item label='Reason'>{entry.reason}</Descriptions.Item>
                    </Descriptions>)}
                </Space> : <Text type='secondary'>No group movements have been recorded yet.</Text>
            }
        ]} />
    </MotionCard>
}
