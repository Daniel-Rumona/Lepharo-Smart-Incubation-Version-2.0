import React, { useEffect, useMemo, useState } from 'react'
import { App, Button, Dropdown, Empty, Progress, Segmented, Tag, type MenuProps } from 'antd'
import {
    ArrowLeftOutlined,
    BarChartOutlined,
    CheckCircleOutlined,
    ClockCircleOutlined,
    DeleteOutlined,
    FilePdfOutlined,
    MoreOutlined,
    StopOutlined,
    SyncOutlined,
    TeamOutlined,
    UserAddOutlined
} from '@ant-design/icons'
import { motion, useReducedMotion } from 'framer-motion'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { EntityAvatar } from '@/components/workspace'
import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/firebase'
import { normalizeExportDesign, type SurveyExportDesign } from '@/lib/surveyExportDesign'
import {
    downloadSurveyPdf,
    downloadSurveyPdfZip,
    surveyPdfFileName,
    type SurveyPdfInput
} from '@/services/surveyTemplatePdf'
import SurveyResponseViewer from '../response/viewer'
import {
    SENT_STATUS_META,
    countAnswers,
    formatDay,
    responseRate,
    sentStatusOf,
    summarizeQuestions,
    type QuestionSummary,
    type SentSurvey,
    type SurveyRecipient
} from './surveyData'

type DetailTab = 'insights' | 'recipients'

type Props = {
    survey: SentSurvey
    /** The survey belongs to this login's department. */
    canManage: boolean
    /** Adds SMEs to this survey; absent once it has closed. */
    onAddSmes?: () => void
    /**
     * Present when the template's questions changed since sending and some
     * SMEs haven't submitted: they get the new questions, drafts kept.
     */
    questionUpdate?: { waiting: number; submitted: number; onUpdate: () => Promise<void> }
    onDelete: () => Promise<void>
    onCloseNow: () => Promise<void>
}

const Bars: React.FC<{ rows: { label: string; count: number }[]; total: number }> = ({ rows, total }) => (
    <>
        {rows.map(row => {
            const share = total ? Math.round((row.count / total) * 100) : 0
            return (
                <div key={row.label} className='svp-bar'>
                    <span className='svp-bar-label' title={row.label}>
                        {row.label}
                    </span>
                    <span className='svp-bar-track' aria-hidden='true'>
                        <span className='svp-bar-fill' style={{ width: `${share}%` }} />
                    </span>
                    <span className='svp-bar-value'>
                        {row.count} · {share}%
                    </span>
                </div>
            )
        })}
    </>
)

const QuestionCard: React.FC<{ summary: QuestionSummary; responded: number }> = ({ summary, responded }) => (
    <section className='svp-question'>
        <div className='svp-question-head'>
            <h4 className='svp-question-title'>{summary.field.label}</h4>
            <span
                className='svp-question-count'
                title={summary.asked < responded ? `Added after ${responded - summary.asked} SMEs submitted` : undefined}
            >
                {summary.answered}/{summary.asked}
            </span>
        </div>
        {summary.kind === 'choice' && <Bars rows={summary.rows} total={summary.answered} />}
        {summary.kind === 'rating' && (
            <>
                <div className='svp-rating-average'>{summary.answered ? summary.average.toFixed(1) : '–'} ★</div>
                <Bars rows={summary.rows} total={summary.answered} />
            </>
        )}
        {summary.kind === 'text' &&
            (summary.samples.length ? (
                <ul className='svp-samples'>
                    {summary.samples.map((sample, i) => (
                        <li key={i}>{sample}</li>
                    ))}
                </ul>
            ) : (
                <span className='ws-muted'>No answers yet</span>
            ))}
        {summary.kind === 'file' && (
            <span className='ws-muted'>
                {summary.answered} file{summary.answered === 1 ? '' : 's'}
            </span>
        )}
    </section>
)

const recipientState = (recipient: SurveyRecipient) =>
    recipient.completed
        ? { label: `Submitted${recipient.submittedAt ? ` ${formatDay(recipient.submittedAt)}` : ''}`, color: 'success' }
        : countAnswers(recipient.answersDraft)
            ? { label: 'In progress', color: 'processing' }
            : { label: 'Not started', color: 'default' }

/** A sent survey: progress, answers question by question, and who has responded. */
export const SentSurveyDetail: React.FC<Props> = ({
    survey,
    canManage,
    onAddSmes,
    questionUpdate,
    onDelete,
    onCloseNow
}) => {
    const [tab, setTab] = useState<DetailTab>('insights')
    const [openRecipientId, setOpenRecipientId] = useState<string | null>(null)
    const reduceMotion = useReducedMotion()
    const { modal, message } = App.useApp()

    useEffect(() => {
        setTab('insights')
        setOpenRecipientId(null)
    }, [survey.id])

    // The template's print design; responses print on it.
    const [design, setDesign] = useState<SurveyExportDesign | null>(null)
    const [exporting, setExporting] = useState(false)
    useEffect(() => {
        setDesign(null)
        if (!survey.templateId) return
        let active = true
        getDoc(doc(db, 'formTemplates', survey.templateId))
            .then(snap => {
                if (active) setDesign(normalizeExportDesign(snap.data()?.exportDesign) || null)
            })
            .catch(error => console.warn('Could not load the print design', error))
        return () => {
            active = false
        }
    }, [survey.templateId])

    const pdfInputFor = (recipient: SurveyRecipient): SurveyPdfInput => ({
        title: survey.title,
        description: survey.description,
        fields: (recipient.questions || recipient.fields || []).map((q: any) => ({
            ...q,
            label: String(q.label || q.question || q.questionText || '')
        })),
        design,
        answers: recipient.answers || {},
        respondent: [recipient.participantName, recipient.companyName].filter(Boolean).join(' · '),
        signer: { name: recipient.participantName, date: formatDay(recipient.submittedAt) }
    })

    const pdfNameFor = (recipient: SurveyRecipient) =>
        surveyPdfFileName(design?.headerTitle || survey.title, recipient.companyName || recipient.participantName)

    const downloadOne = (recipient: SurveyRecipient) => {
        try {
            downloadSurveyPdf(pdfInputFor(recipient), pdfNameFor(recipient))
        } catch (error) {
            console.error(error)
            message.error('Could not create the PDF.')
        }
    }

    const downloadAll = async () => {
        const done = survey.recipients.filter(r => r.completed)
        if (!done.length) return
        setExporting(true)
        try {
            await downloadSurveyPdfZip(
                done.map(recipient => ({ input: pdfInputFor(recipient), fileName: pdfNameFor(recipient) })),
                `${design?.headerTitle || survey.title} - responses.zip`
            )
        } catch (error) {
            console.error(error)
            message.error('Could not create the PDFs.')
        } finally {
            setExporting(false)
        }
    }

    const status = sentStatusOf(survey)
    const rate = responseRate(survey)
    const summaries = useMemo(() => summarizeQuestions(survey.recipients), [survey.recipients])

    // Nobody has answered: delete outright. Answers in: close, keeping them.
    const canDelete = canManage && survey.loaded && survey.completed === 0
    const canClose = canManage && survey.completed > 0 && status === 'pending'

    const confirmDelete = () =>
        modal.confirm({
            title: 'Delete this survey?',
            content: `Nobody has submitted yet. It disappears for all ${survey.total} SME${survey.total === 1 ? '' : 's'}, along with any drafts. This can't be undone.`,
            okText: 'Delete',
            okButtonProps: { danger: true },
            onOk: onDelete
        })

    const confirmClose = () =>
        modal.confirm({
            title: 'Close this survey now?',
            content: 'SMEs can no longer answer. Every answer so far is kept.',
            okText: 'Close survey',
            onOk: onCloseNow
        })

    const confirmQuestionUpdate = () =>
        questionUpdate &&
        modal.confirm({
            title: 'Update the questions?',
            content: `${questionUpdate.waiting} SME${questionUpdate.waiting === 1 ? '' : 's'} who haven't submitted get the template's current questions, keeping anything they've typed.${questionUpdate.submitted
                ? ` ${questionUpdate.submitted} who already submitted keep the questions they answered.`
                : ''
                }`,
            okText: 'Update questions',
            onOk: questionUpdate.onUpdate
        })

    const secondaryActions = [
        survey.completed > 0 && {
            key: 'pdfs',
            icon: <FilePdfOutlined />,
            label: exporting ? 'Preparing PDFs…' : `Download responses (${survey.completed} PDF${survey.completed === 1 ? '' : 's'})`,
            onClick: downloadAll
        },
        questionUpdate && { key: 'questions', icon: <SyncOutlined />, label: 'Update questions', onClick: confirmQuestionUpdate },
        canClose && { key: 'close', icon: <StopOutlined />, label: 'Close now', onClick: confirmClose },
        canDelete && { key: 'delete', icon: <DeleteOutlined />, label: 'Delete', danger: true, onClick: confirmDelete }
    ].filter(Boolean) as { key: string; icon: React.ReactNode; label: string; danger?: boolean; onClick: () => void }[]
    // A single action is its own button; a "More" menu only when there are several.
    const lone = secondaryActions.length === 1 ? secondaryActions[0] : null
    const moreItems: MenuProps['items'] = lone ? [] : secondaryActions

    const recipients = useMemo(
        () =>
            [...survey.recipients].sort(
                (a, b) => Number(a.completed) - Number(b.completed) || a.companyName.localeCompare(b.companyName)
            ),
        [survey.recipients]
    )
    const openRecipient = survey.recipients.find(r => r.id === openRecipientId) || null

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
                <motion.header key={`head-${survey.id}`} className='ws-detail-head' {...enter()}>
                    <EntityAvatar name={survey.title} size={52} />
                    <div className='ws-detail-identity'>
                        <h2 className='ws-detail-name'>{survey.title}</h2>
                        <div className='ws-detail-sub'>
                            {[
                                survey.sentAt && `Sent ${formatDay(survey.sentAt)}`,
                                survey.dueDate && `Due ${formatDay(survey.dueDate)}`
                            ]
                                .filter(Boolean)
                                .join(' · ')}
                        </div>
                        <div className='ws-detail-tags'>
                            <Tag color={SENT_STATUS_META[status].color}>{SENT_STATUS_META[status].label}</Tag>
                        </div>
                    </div>
                    {(onAddSmes || secondaryActions.length > 0) && (
                        <div className='ws-detail-actions'>
                            {lone && (
                                <Button icon={lone.icon} danger={lone.danger} onClick={lone.onClick}>
                                    {lone.label}
                                </Button>
                            )}
                            {!!moreItems?.length && (
                                <Dropdown menu={{ items: moreItems }} trigger={['click']} placement='bottomRight'>
                                    <Button icon={<MoreOutlined />}>More</Button>
                                </Dropdown>
                            )}
                            {onAddSmes && (
                                <Button type='primary' icon={<UserAddOutlined />} onClick={onAddSmes}>
                                    Add SMEs
                                </Button>
                            )}
                        </div>
                    )}
                </motion.header>

                <div className='ws-detail-tabs'>
                    {/* Progress and the tab switch share one row; they stack on narrow panes. */}
                    <motion.div key={`progress-${survey.id}`} className='svp-progress-row' {...enter(0.05)}>
                        <div className='svp-progress'>
                            <Progress type='circle' percent={rate} size={44} />
                            <div className='svp-progress-stats'>
                                <span>
                                    <span className='svp-stat-value'>{survey.completed}</span>
                                    <span className='svp-stat-label'>Responded</span>
                                </span>
                                <span>
                                    <span className='svp-stat-value'>{survey.total - survey.completed}</span>
                                    <span className='svp-stat-label'>Awaiting</span>
                                </span>
                            </div>
                        </div>
                        <Segmented
                            className='svp-tab-switch'
                            value={tab}
                        onChange={value => {
                            setTab(value as DetailTab)
                            setOpenRecipientId(null)
                        }}
                        options={[
                            { value: 'insights', label: 'Insights', icon: <BarChartOutlined /> },
                            { value: 'recipients', label: `Recipients (${survey.total})`, icon: <TeamOutlined /> }
                        ]}
                        />
                    </motion.div>
                    <div className='ws-detail-pane'>
                        <motion.div key={`${survey.id}-${tab}-${openRecipientId || ''}`} {...enter(0.08)}>
                            {tab === 'insights' &&
                                (survey.completed === 0 ? (
                                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='No responses yet' />
                                ) : (
                                    <div className='svp-questions'>
                                        {summaries.map(summary => (
                                            <QuestionCard
                                                key={summary.field.id}
                                                summary={summary}
                                                responded={survey.completed}
                                            />
                                        ))}
                                    </div>
                                ))}

                            {tab === 'recipients' &&
                                (openRecipient ? (
                                    <>
                                        <Button
                                            className='svp-back'
                                            type='text'
                                            icon={<ArrowLeftOutlined />}
                                            onClick={() => setOpenRecipientId(null)}
                                        >
                                            {openRecipient.companyName}
                                        </Button>
                                        <Button
                                            icon={<FilePdfOutlined />}
                                            style={{ float: 'right' }}
                                            onClick={() => downloadOne(openRecipient)}
                                        >
                                            Download PDF
                                        </Button>
                                        <SurveyResponseViewer
                                            questions={openRecipient.questions || openRecipient.fields || []}
                                            answers={openRecipient.answers || {}}
                                            showTOC
                                        />
                                    </>
                                ) : recipients.length ? (
                                    <div className='svp-recipient-list' role='list' aria-label='Recipients'>
                                        {recipients.map(recipient => {
                                            const state = recipientState(recipient)
                                            return (
                                                <button
                                                    key={recipient.id}
                                                    type='button'
                                                    role='listitem'
                                                    className='ws-row'
                                                    disabled={!recipient.completed}
                                                    title={recipient.completed ? 'Open response' : undefined}
                                                    onClick={() => setOpenRecipientId(recipient.id)}
                                                >
                                                    <EntityAvatar name={recipient.companyName} size={32} />
                                                    <div className='ws-row-main'>
                                                        <div className='ws-row-name'>{recipient.companyName}</div>
                                                        <div className='ws-row-meta'>
                                                            {[recipient.participantName, recipient.email]
                                                                .filter(Boolean)
                                                                .join(' · ')}
                                                        </div>
                                                    </div>
                                                    <div className='ws-row-side'>
                                                        <Tag
                                                            color={state.color}
                                                            bordered={false}
                                                            icon={
                                                                recipient.completed ? (
                                                                    <CheckCircleOutlined />
                                                                ) : (
                                                                    <ClockCircleOutlined />
                                                                )
                                                            }
                                                        >
                                                            {state.label}
                                                        </Tag>
                                                    </div>
                                                </button>
                                            )
                                        })}
                                    </div>
                                ) : (
                                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='Nobody was sent this survey' />
                                ))}
                        </motion.div>
                    </div>
                </div>
            </MotionCard>
        </div>
    )
}
