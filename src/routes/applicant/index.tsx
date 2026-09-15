import React, { useEffect, useMemo, useState } from 'react'
import {
    Typography,
    Row,
    Col,
    Spin,
    Button,
    message,
    Modal,
    Space,
    Tag,
    Empty
} from 'antd'
import {
    FileTextOutlined,
    AppstoreOutlined,
    CalendarOutlined,
    InfoCircleOutlined,
    FieldTimeOutlined,
    EnvironmentOutlined
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { db } from '@/firebase'
import { collection, getDocs, query, where } from 'firebase/firestore'
import dayjs from 'dayjs'
import { auth } from 'firebase'
import { Helmet } from 'react-helmet'
import { DashboardHeaderCard, MotionCard } from '@/components/dashboards/metrics/Header'
import {
    guideTarget,
    usePageGuides,
    type PageGuideRegistration
} from '@/components/guide-me'

const { Title, Paragraph, Text } = Typography

const eligibilityLabels = {
    minAge: (label: any) => `Minimum age: ${label}`,
    maxAge: (label: any) => `Maximum age: ${label}`,
    gender: (label: any) =>
        `Allowed gender(s): ${Array.isArray(label) ? label.join(', ') : label}`,
    sector: (label: any) =>
        `Sector(s): ${Array.isArray(label) ? label.join(', ') : label}`,
    province: (label: any) =>
        `Province(s): ${Array.isArray(label) ? label.join(', ') : label}`,
    beeLevel: (label: any) =>
        `Allowed BEE Level(s): ${Array.isArray(label) ? label.join(', ') : label}`,
    minYearsOfTrading: (label: any) => `Min years of trading: ${label}`,
    youthOwnedPercent: (label: any) => `Min youth ownership: ${label}%`,
    femaleOwnedPercent: (label: any) => `Min female ownership: ${label}%`,
    blackOwnedPercent: (label: any) => `Min black ownership: ${label}%`,
    custom: (label: any) => <span style={{ fontStyle: 'italic' }}>{label}</span>
}

function renderEligibilityCriteria(criteria: any) {
    if (!criteria || Object.keys(criteria).length === 0) {
        return <li>Open to all (no restrictions)</li>
    }
    return Object.entries(criteria).map(([key, value]) => (
        <li key={key}>
            {(eligibilityLabels as any)[key]
                ? (eligibilityLabels as any)[key](value)
                : `${key}: ${value}`}
        </li>
    ))
}

function checkEligibility(participant: any, criteria: any = {}) {
    if (!criteria || Object.keys(criteria).length === 0) return null
    if (criteria.minAge && participant.age < criteria.minAge)
        return `Minimum age is ${criteria.minAge}`
    if (criteria.maxAge && participant.age > criteria.maxAge)
        return `Maximum age is ${criteria.maxAge}`
    if (
        criteria.gender &&
        criteria.gender.length &&
        !criteria.gender.includes(participant.gender)
    )
        return `Eligible gender(s): ${criteria.gender.join(', ')}`
    if (
        criteria.sector &&
        criteria.sector.length &&
        !criteria.sector.includes(participant.sector)
    )
        return `Sector must be one of: ${criteria.sector.join(', ')}`
    if (
        criteria.province &&
        criteria.province.length &&
        !criteria.province.includes(participant.province)
    )
        return `Province must be one of: ${criteria.province.join(', ')}`
    if (
        criteria.beeLevel &&
        criteria.beeLevel.length &&
        !criteria.beeLevel.includes(participant.beeLevel)
    )
        return `Allowed BEE Levels: ${criteria.beeLevel.join(', ')}`
    if (
        criteria.minYearsOfTrading &&
        participant.yearsOfTrading < criteria.minYearsOfTrading
    )
        return `At least ${criteria.minYearsOfTrading} year(s) of trading required`
    if (
        criteria.youthOwnedPercent !== undefined &&
        +participant.youthOwnedPercent < +criteria.youthOwnedPercent
    )
        return `At least ${criteria.youthOwnedPercent}% youth ownership required`
    if (
        criteria.blackOwnedPercent !== undefined &&
        +participant.blackOwnedPercent < +criteria.blackOwnedPercent
    )
        return `At least ${criteria.blackOwnedPercent}% black ownership required`
    if (
        criteria.femaleOwnedPercent !== undefined &&
        +participant.femaleOwnedPercent < +criteria.femaleOwnedPercent
    )
        return `At least ${criteria.femaleOwnedPercent}% female ownership required`
    return null
}

type AppStatus =
    | 'submitted'
    | 'in_review'
    | 'approved'
    | 'rejected'
    | 'queried'
    | 'resubmission_requested'
    | 'needs_resubmission'
    | string

// if existing app is in one of these states, allow resubmission (no blocking toast)
const RESUBMIT_ALLOWED: AppStatus[] = [
    'rejected',
    'queried',
    'resubmission_requested',
    'needs_resubmission'
]

// Programs don't store a duration field — derive a human-readable span from start/end dates
function formatProgramDuration(start: dayjs.Dayjs | null, end: dayjs.Dayjs | null): string | null {
    if (!start || !end) return null
    const days = end.diff(start, 'day')
    if (days <= 0) return null
    const months = Math.round(days / 30)
    if (months >= 1) return `${months} month${months === 1 ? '' : 's'}`
    const weeks = Math.max(1, Math.round(days / 7))
    return `${weeks} week${weeks === 1 ? '' : 's'}`
}

const ApplicantLandingPage = () => {
    const [allPrograms, setAllPrograms] = useState<any[]>([])
    const [programModalVisible, setProgramModalVisible] = useState(false)
    const [activeProgram, setActiveProgram] = useState<any>(null)

    const [loading, setLoading] = useState(false)

    const navigate = useNavigate()

    const guideRegistration = useMemo<PageGuideRegistration>(
        () => ({
            pageId: 'applicant-dashboard',
            pageTitle: 'Programs & Apply',
            guides: [
                {
                    id: 'apply-walkthrough',
                    title: 'How to apply to a program',
                    description:
                        'Browse the open programs and submit an application to one.',
                    kind: 'task',
                    steps: [
                        {
                            element: guideTarget('nav-apply'),
                            popover: {
                                title: 'Submit Application',
                                description:
                                    'Begin a new application here. On mobile, open the menu from the top-left icon.',
                                side: 'bottom',
                                align: 'start'
                            }
                        },
                        {
                            element: guideTarget('apply-btn-first'),
                            popover: {
                                title: 'Start your application',
                                description:
                                    'Click "Apply" on a program to begin. If your profile isn’t complete, you’ll be redirected to finish it first.',
                                side: 'top',
                                align: 'start'
                            },
                            waitForElement: 5000,
                            skipMissingElement: true
                        }
                    ]
                }
            ]
        }),
        []
    )

    usePageGuides(guideRegistration)


    const fetchPrograms = async () => {
        setLoading(true)
        try {
            const ref = collection(db, 'programs')
            let qy: any

            qy = query(
                ref,
                where('status', 'in', ['Active', 'Planned', 'active', 'planned'])
            )


            const snapshot = await getDocs(qy)
            const data = snapshot.docs.map(doc => {
                const raw = doc.data() as any
                return {
                    id: doc.id,
                    ...raw,
                    startDate: raw.startDate?.toDate?.() ?? (raw.startDate ? new Date(raw.startDate) : undefined),
                    endDate: raw.endDate?.toDate?.() ?? (raw.endDate ? new Date(raw.endDate) : undefined)
                }
            })

            setAllPrograms(data)
        } catch (err) {
            message.error('Failed to load programs.')
            console.error(err)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchPrograms()
    }, [])

    const openProgramModal = async (program: any) => {
        try {
            const user = auth.currentUser
            if (!user?.email) {
                message.error('You must be logged in to apply.')
                return
            }

            // Find participant by current user email
            const qPart = query(
                collection(db, 'participants'),
                where('email', '==', user.email)
            )
            const snapshot = await getDocs(qPart)

            if (snapshot.empty) {
                message.warning('Please complete your profile before applying.')
                navigate('/applicant/profile')
                return
            }

            const participantDoc = snapshot.docs[0]
            const participant = participantDoc.data()
            const participantId = participantDoc.id

            if (!participant.setup) {
                message.warning('Please finish your profile setup before registering.')
                navigate('/applicant/profile')
                return
            }

            // Check for existing application for this program
            const existingAppSnap = await getDocs(
                query(
                    collection(db, 'applications'),
                    where('participantId', '==', participantId),
                    where('programId', '==', program.id)
                )
            )

            // If there’s an existing application:
            if (!existingAppSnap.empty) {
                // choose the most recent (if multiple)
                const docs = existingAppSnap.docs
                const sorted = docs.sort((a, b) => {
                    const ac = (a.data() as any)?.createdAt?.toMillis?.() ?? 0
                    const bc = (b.data() as any)?.createdAt?.toMillis?.() ?? 0
                    return bc - ac
                })
                const top = sorted[0]
                const existingId = top.id
                const status = (top.data() as any)?.status as AppStatus

                // If flagged for resubmission → go straight to onboarding as resubmission
                if (status && RESUBMIT_ALLOWED.includes(status)) {
                    const params = new URLSearchParams({
                        id: program.id,
                        program: program.name,
                        resubmit: '1',
                        applicationId: existingId
                    }).toString()
                    navigate(`/registration/onboarding?${params}`)
                    return
                }

                // Otherwise keep the original protective message
                message.info('You’ve already applied to this program.')
                return
            }

            // New application flow → eligibility only; then open modal with “Start Application”
            const eligibilityMessage = checkEligibility(
                participant,
                program.eligibilityCriteria
            )
            if (eligibilityMessage) {
                Modal.warning({
                    centered: true,
                    title: 'Not Eligible',
                    content: (
                        <div>
                            <b>You do not meet this program’s eligibility:</b>
                            <div style={{ marginTop: 8 }}>{eligibilityMessage}</div>
                        </div>
                    )
                })
                return
            }

            setActiveProgram(program)
            setProgramModalVisible(true)
        } catch (error) {
            console.error('❌ Failed to verify profile/setup/application:', error)
            message.error('Could not verify your eligibility.')
        }
    }

    const startApplication = () => {
        if (!activeProgram) return
        const params = new URLSearchParams({
            id: activeProgram.id,
            program: activeProgram.name
        }).toString()
        navigate(`/registration/onboarding?${params}`)
    }

    const renderProgramCard = (program: any, idx: number) => {
        const start = program.startDate && dayjs(program.startDate).isValid() ? dayjs(program.startDate) : null
        const end = program.endDate && dayjs(program.endDate).isValid() ? dayjs(program.endDate) : null
        const now = dayjs()

        let dateRangeLabel = 'Dates TBC'
        let dateColor: string = 'default'
        if (start && end) {
            dateRangeLabel = `${start.format('MMM YYYY')} – ${end.format('MMM YYYY')}`
            if (now.isBefore(start)) dateColor = 'green'
            else if (now.isAfter(end)) dateColor = 'default'
            else dateColor = 'blue'
        } else if (start) {
            dateRangeLabel = now.isBefore(start)
                ? `Starts ${start.format('MMM YYYY')}`
                : `Started ${start.format('MMM YYYY')}`
            dateColor = now.isBefore(start) ? 'green' : 'blue'
        }

        const durationLabel = formatProgramDuration(start, end)
        const hubLabel = program.assignedBranch?.name || program.hub

        return (
            <Col xs={24} sm={12} md={8} lg={6} key={program.id}>
                <MotionCard
                    actions={[
                        <span
                            key='apply'
                            data-guide={idx === 0 ? 'apply-btn-first' : undefined}
                            style={{ display: 'block', padding: '0 12px' }}
                        >
                            <Button
                                type='primary'
                                block
                                icon={<FileTextOutlined />}
                                onClick={() => openProgramModal(program)}
                            >
                                Apply
                            </Button>
                        </span>
                    ]}
                >
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
                        <div
                            style={{
                                width: 36,
                                height: 36,
                                borderRadius: 10,
                                background: '#eef4ff',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                color: '#1677ff',
                                flexShrink: 0,
                                fontSize: 16
                            }}
                        >
                            <AppstoreOutlined />
                        </div>
                        <Title level={5} style={{ margin: 0 }} ellipsis={{ rows: 2 }}>
                            {program.name}
                        </Title>
                    </div>

                    {program.description && (
                        <Paragraph
                            type='secondary'
                            style={{ fontSize: 13, marginBottom: 12 }}
                            ellipsis={{ rows: 2 }}
                        >
                            {program.description}
                        </Paragraph>
                    )}

                    <Space size={[6, 6]} wrap>
                        <Tag color={dateColor} icon={<CalendarOutlined />} style={{ borderRadius: 999 }}>
                            {dateRangeLabel}
                        </Tag>
                        {durationLabel && (
                            <Tag icon={<FieldTimeOutlined />} style={{ borderRadius: 999 }}>
                                {durationLabel}
                            </Tag>
                        )}
                        {hubLabel && (
                            <Tag icon={<EnvironmentOutlined />} style={{ borderRadius: 999 }}>
                                {hubLabel}
                            </Tag>
                        )}
                    </Space>
                </MotionCard>
            </Col>
        )
    }


    return (
        <>
            <Helmet>
                <title>Programs Dashboard | Smart Incubation Platform</title>
                <meta
                    name='description'
                    content='Explore active programs available to your SME.'
                />
            </Helmet>

            <div
                style={{
                    padding: 24,
                    background: '#fff',
                    minHeight: '100vh',
                    boxSizing: 'border-box'
                }}
            >
                {loading ? (
                    <div style={{ padding: '48px 0', textAlign: 'center' }}>
                        <Spin size='large' />
                    </div>
                ) : allPrograms.length > 0 ? (
                    <Row gutter={[16, 16]}>
                        {allPrograms.map((p, idx) => renderProgramCard(p, idx))}
                    </Row>
                ) : (
                    <Empty
                        description='No programs are currently open. Check back soon.'
                        style={{ padding: '48px 0' }}
                    />
                )}
            </div>

            <Modal
                open={programModalVisible}
                title={
                    <Space>
                        <FileTextOutlined style={{ color: '#1677ff' }} />
                        <span>{activeProgram?.name}</span>
                    </Space>
                }
                onCancel={() => {
                    setProgramModalVisible(false)
                    setActiveProgram(null)
                }}
                onOk={startApplication}
                okText='Start Application'
                destroyOnClose
                centered
            >
                {activeProgram?.description && (
                    <Paragraph type='secondary' style={{ marginBottom: 16 }}>
                        {activeProgram.description}
                    </Paragraph>
                )}
                <div
                    style={{
                        background: '#fafafa',
                        border: '1px solid #f0f0f0',
                        borderRadius: 12,
                        padding: 16
                    }}
                >
                    <Space align='center' size={8} style={{ marginBottom: 10 }}>
                        <InfoCircleOutlined style={{ color: '#1677ff' }} />
                        <Text strong>Eligibility Criteria</Text>
                    </Space>
                    <ul style={{ margin: 0, paddingLeft: 20 }}>
                        {renderEligibilityCriteria(activeProgram?.eligibilityCriteria)}
                    </ul>
                </div>
            </Modal>
        </>
    )
}

export default ApplicantLandingPage
