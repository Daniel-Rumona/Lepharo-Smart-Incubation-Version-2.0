import React, { useEffect, useState } from 'react'
import { Alert, Button, Empty, Segmented, Skeleton, Tag } from 'antd'
import {
    DownloadOutlined,
    EnvironmentOutlined,
    FileTextOutlined,
    GlobalOutlined,
    IdcardOutlined,
    MailOutlined,
    ExclamationCircleOutlined,
    ExportOutlined,
    PhoneOutlined,
    SendOutlined,
    UserOutlined
} from '@ant-design/icons'
import { motion, useReducedMotion } from 'framer-motion'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { ApplicantAvatar } from './ApplicantAvatar'
import { ContactList, ContactRow, OwnershipCards, contactActions } from '@/components/workspace'
import {
    STATUS_META,
    displayName,
    extractProfileQA,
    loadParticipant,
    mergeParticipant,
    recommendationColor,
    scoreTone,
    type Application,
    type ParticipantDetails,
    type ProgramQuestionMap
} from './applicationData'
import { DecisionActions, DecisionNote } from './DecisionBar'

type DetailTab = 'applicant' | 'answers' | 'documents'

type Props = {
    app: Application
    questionMap?: ProgramQuestionMap
    onChanged: (id: string) => Promise<unknown>
}

const fileNameOf = (d: { fileName?: string; url: string }) => {
    if (d.fileName) return d.fileName
    try {
        return decodeURIComponent(new URL(d.url).pathname.split('/').pop() || 'file')
    } catch {
        return 'file'
    }
}

const Fact: React.FC<{ label: string; value?: React.ReactNode }> = ({ label, value }) => (
    <div>
        <dt>{label}</dt>
        <dd>{value || <span className='ws-muted'>—</span>}</dd>
    </div>
)

/** Linked participant record, loaded when an application is opened. */
const useParticipant = (app: Application) => {
    const [state, setState] = useState<{ id: string; details: ParticipantDetails | null; loading: boolean }>({
        id: '',
        details: null,
        loading: true
    })
    useEffect(() => {
        let cancelled = false
        setState({ id: app.id, details: null, loading: true })
        loadParticipant(app)
            .then(p => !cancelled && setState({ id: app.id, details: mergeParticipant(app, p), loading: false }))
            .catch(e => {
                console.error('[applications] participant lookup failed:', e)
                if (!cancelled) setState({ id: app.id, details: mergeParticipant(app, null), loading: false })
            })
        return () => {
            cancelled = true
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [app.id, app.participantId, app.email])
    return state.id === app.id ? state : { details: null, loading: true }
}

/**
 * Challenges are free text. Lines, bullets, numbered items or semicolons
 * become separate items; one paragraph is split into its sentences.
 */
const splitChallenges = (text: string): string[] => {
    const clean = (parts: string[]) =>
        parts.map(p => p.replace(/^\s*(?:[-*•–]|\d+[.)])\s*/, '').trim()).filter(Boolean)
    const t = text.trim()
    if (!t) return []
    const byLine = clean(t.split(/\r?\n+/))
    if (byLine.length > 1) return byLine
    const bySemicolon = clean(t.split(/;\s*/))
    if (bySemicolon.length > 1) return bySemicolon
    return clean(t.split(/(?<=[.!?])\s+(?=[A-Z0-9])/))
}

const ApplicantTab: React.FC<{ app: Application }> = ({ app }) => {
    const { details, loading } = useParticipant(app)
    const challenges = Array.isArray(app.challengeItems) && app.challengeItems.some(Boolean)
        ? app.challengeItems.map((c: unknown) => String(c ?? '').trim()).filter(Boolean)
        : splitChallenges(app.challenges)

    return (
        <div className='ws-detail-body'>
            <section>
                <h4 className='ws-section-title'>Profile</h4>
                <dl className='ws-facts'>
                    <Fact label='Gender' value={app.gender} />
                    <Fact label='Age group' value={app.ageGroup} />
                    <Fact label='Stage' value={app.stage} />
                    <Fact label='Hub' value={app.hub} />
                </dl>
            </section>

            <section>
                <h4 className='ws-section-title'>Contact</h4>
                {loading || !details ? (
                    <Skeleton active title={false} paragraph={{ rows: 3 }} />
                ) : (
                    <ContactList>
                        <ContactRow
                            icon={<MailOutlined />}
                            label='Email'
                            value={details.contact.email}
                            empty='No email on file'
                            action={contactActions.email(details.contact.email, <SendOutlined />)}
                            half
                        />
                        <ContactRow
                            icon={<PhoneOutlined />}
                            label='Phone'
                            value={details.contact.phone}
                            empty='No phone number on file'
                            copyLabel='Phone number'
                            action={contactActions.phone(details.contact.phone, <PhoneOutlined />)}
                            half
                        />
                        {details.contact.website && (
                            <ContactRow
                                icon={<GlobalOutlined />}
                                label='Website'
                                value={details.contact.website}
                                action={contactActions.website(details.contact.website, <ExportOutlined />)}
                            />
                        )}
                        <ContactRow
                            icon={<EnvironmentOutlined />}
                            label='Address'
                            value={details.fullAddress}
                            empty='No address on file'
                            action={contactActions.map(details.fullAddress, <ExportOutlined />)}
                        />
                    </ContactList>
                )}
            </section>

            {/* Ownership lives on the participant record; without one there is nothing to show. */}
            {details && Object.keys(details.raw).length > 0 && (
                <section>
                    <h4 className='ws-section-title'>Ownership</h4>
                    <OwnershipCards
                        items={[
                            { label: 'Black owned', value: details.ownership.black },
                            { label: 'Female owned', value: details.ownership.female },
                            { label: 'Youth owned', value: details.ownership.youth }
                        ]}
                    />
                </section>
            )}

            <section>
                <h4 className='ws-section-title'>Motivation</h4>
                <p className='ws-prose'>{app.motivation || <span className='ws-muted'>Not provided</span>}</p>
            </section>

            <section>
                <h4 className='ws-section-title'>Challenges</h4>
                {challenges.length ? (
                    <ul className='apx-challenges'>
                        {challenges.map((c, i) => (
                            <li key={i}>
                                <ExclamationCircleOutlined aria-hidden='true' />
                                <span>{c}</span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p className='ws-prose ws-muted'>Not provided</p>
                )}
            </section>
        </div>
    )
}

const AnswersTab: React.FC<{ app: Application; questionMap?: ProgramQuestionMap }> = ({ app, questionMap }) => {
    const qa = extractProfileQA(app, questionMap)
    if (!qa.length) return <Empty description='No onboarding answers stored for this application' />
    return (
        <div className='ws-detail-body'>
            {app.programId && questionMap && Object.keys(questionMap).length <= 1 && (
                <Alert
                    type='info'
                    showIcon
                    message="This programme's onboarding questions couldn't be loaded, so some questions show their ids."
                />
            )}
            <div className='apx-qa'>
                {qa.map((item, i) => (
                    <div key={i} className='apx-qa-item'>
                        <div className='apx-qa-q'>{item.question}</div>
                        <div className='apx-qa-a'>{item.answer || <span className='ws-muted'>No answer</span>}</div>
                    </div>
                ))}
            </div>
        </div>
    )
}

const DocumentsTab: React.FC<{ app: Application }> = ({ app }) => {
    const docs = [
        ...app.documents.map(d => ({ name: d.type || 'Document', file: fileNameOf(d), url: d.url })),
        ...(app.growthPlanDocUrl ? [{ name: 'Growth plan', file: 'growth_plan.pdf', url: app.growthPlanDocUrl }] : [])
    ]
    if (!docs.length) return <Empty description='No documents uploaded' />
    return (
        <div className='ws-detail-body'>
            {docs.map((d, i) => (
                <div key={i} className='apx-doc'>
                    <FileTextOutlined className='ws-muted' />
                    <div className='apx-doc-main'>
                        <div className='apx-doc-name'>{d.name}</div>
                        <div className='apx-doc-file'>{d.file}</div>
                    </div>
                    <Button
                        type='text'
                        icon={<DownloadOutlined />}
                        href={d.url}
                        target='_blank'
                        aria-label={`Open ${d.name}`}
                    />
                </div>
            ))}
        </div>
    )
}

export const ApplicationDetail: React.FC<Props> = ({ app, questionMap, onChanged }) => {
    const [tab, setTab] = useState<DetailTab>('applicant')
    const [expanded, setExpanded] = useState(false)

    useEffect(() => {
        setTab('applicant')
        setExpanded(false)
    }, [app.id])

    const answers = extractProfileQA(app, questionMap).length
    const documents = app.documents.length + (app.growthPlanDocUrl ? 1 : 0)
    const rejectionReason = app.decision?.reason || app.rejectionReason
    const justification = app.aiJustification
    const longJustification = justification.length > 220
    const reduceMotion = useReducedMotion()
    // Each newly opened application slides in; switching tabs cross-fades the pane.
    const enter = (delay = 0) =>
        reduceMotion
            ? {}
            : {
                initial: { opacity: 0, y: 8 },
                animate: { opacity: 1, y: 0 },
                transition: { duration: 0.26, ease: 'easeOut' as const, delay }
            }

    return (
        <div className='ws-detail'>
            <MotionCard>
                <motion.header key={`head-${app.id}`} className='ws-detail-head' {...enter()}>
                    <ApplicantAvatar app={app} size={52} />
                    <div className='ws-detail-identity'>
                        <h2 className='ws-detail-name'>{displayName(app)}</h2>
                        <div className='ws-detail-sub'>
                            {[app.email, app.submittedAt && `Submitted ${app.submittedAt.format('D MMM YYYY')}`]
                                .filter(Boolean)
                                .join(' · ')}
                        </div>
                        <div className='ws-detail-tags'>
                            <Tag color={STATUS_META[app.applicationStatus].color}>
                                {STATUS_META[app.applicationStatus].label}
                            </Tag>
                            <DecisionNote app={app} />
                            {app.hub && <Tag>{app.hub}</Tag>}
                        </div>
                    </div>
                    <DecisionActions app={app} onChanged={onChanged} />
                </motion.header>

                <motion.div key={`ai-${app.id}`} className='apx-ai' {...enter(0.06)}>
                    <div className={`apx-ai-score qtx-tone-${scoreTone(app.aiScore)}`} title='AI score'>
                        {app.aiScore ?? '–'}
                    </div>
                    <div className='apx-ai-label'>
                        AI assessment
                        <Tag color={recommendationColor(app.aiRecommendation)} bordered={false}>
                            {app.aiRecommendation}
                        </Tag>
                    </div>
                    <div>
                        <div className={`apx-ai-text${longJustification && !expanded ? ' is-clamped' : ''}`}>
                            {justification || <span className='ws-muted'>No justification provided.</span>}
                        </div>
                        {longJustification && (
                            <Button
                                type='link'
                                size='small'
                                style={{ paddingInline: 0 }}
                                onClick={() => setExpanded(v => !v)}
                            >
                                {expanded ? 'Show less' : 'Read more'}
                            </Button>
                        )}
                    </div>
                </motion.div>

                {app.applicationStatus === 'rejected' && (
                    <Alert
                        style={{ margin: '12px 20px 0' }}
                        type='error'
                        showIcon
                        message='Rejection reason'
                        description={rejectionReason || 'No reason was captured.'}
                    />
                )}

                <div className='ws-detail-tabs'>
                    <Segmented
                        block
                        value={tab}
                        onChange={v => setTab(v as DetailTab)}
                        options={[
                            { value: 'applicant', label: 'Applicant', icon: <UserOutlined /> },
                            {
                                value: 'answers',
                                label: `Answers${answers ? ` (${answers})` : ''}`,
                                icon: <IdcardOutlined />
                            },
                            {
                                value: 'documents',
                                label: `Documents${documents ? ` (${documents})` : ''}`,
                                icon: <FileTextOutlined />
                            }
                        ]}
                    />
                    <div className='ws-detail-pane'>
                        <motion.div key={`${app.id}-${tab}`} {...enter(0.1)}>
                            {tab === 'applicant' && <ApplicantTab app={app} />}
                            {tab === 'answers' && <AnswersTab app={app} questionMap={questionMap} />}
                            {tab === 'documents' && <DocumentsTab app={app} />}
                        </motion.div>
                    </div>
                </div>

            </MotionCard>
        </div>
    )
}
