import React from 'react'
import { App, Button, Empty, Popconfirm, Tag, Tooltip } from 'antd'
import { DeleteOutlined, EditOutlined, InboxOutlined, RollbackOutlined, SendOutlined, UserAddOutlined } from '@ant-design/icons'
import { motion, useReducedMotion } from 'framer-motion'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { EntityAvatar } from '@/components/workspace'
import {
    formatDay,
    questionCount,
    sendSummaryText,
    templateStatusOf,
    type SurveyTemplate,
    type TemplateSendSummary
} from './surveyData'

const TYPE_LABEL: Record<string, string> = {
    text: 'Short answer',
    textarea: 'Long answer',
    number: 'Number',
    email: 'Email',
    select: 'Dropdown',
    radio: 'One choice',
    checkbox: 'Several choices',
    date: 'Date',
    file: 'File upload',
    rating: 'Rating'
}

type Props = {
    template: SurveyTemplate
    onEdit: () => void
    onSend: () => void
    /** A draft: makes it ready to send (nothing is sent), then opens Send. */
    onMakeReadyAndSend: () => Promise<void>
    /** Own department's template (shared ones: admins only). */
    canManage: boolean
    /** Sent at least once, so it can be archived but not deleted. */
    hasBeenSent: boolean
    /** How often it was sent and how those sends went. */
    sendSummary?: TemplateSendSummary
    /**
     * Sent before: whether its questions changed since the latest round. A new
     * round only makes sense with new questions; otherwise people join that
     * round (onAddRecipients, absent once it has closed).
     */
    resend?: { changed: boolean; lastSent: string; onAddRecipients?: () => void }
    onDelete: () => Promise<void>
    onArchive: (archived: boolean) => Promise<void>
}

/** A template: its questions as the SME will meet them, with Edit and Send. */
export const TemplateDetail: React.FC<Props> = ({
    template,
    onEdit,
    onSend,
    onMakeReadyAndSend,
    canManage,
    hasBeenSent,
    sendSummary,
    resend,
    onDelete,
    onArchive
}) => {
    const reduceMotion = useReducedMotion()
    const { modal } = App.useApp()
    const count = questionCount(template.fields)
    const isReady = template.status === 'published'

    // Send always works: a draft is made ready first, with a plain explanation,
    // instead of a disabled button that sends people to the builder.
    const send = () => {
        if (isReady) return onSend()
        modal.confirm({
            title: 'Make this survey ready to send?',
            content:
                "It's a draft, so it can't be sent yet. Making it ready doesn't send it to anyone: next you choose who gets it.",
            okText: 'Make ready and choose recipients',
            cancelText: 'Not now',
            onOk: onMakeReadyAndSend
        })
    }
    let number = 0

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
                <motion.header key={`head-${template.id}`} className='ws-detail-head' {...enter()}>
                    <EntityAvatar name={template.title} size={52} />
                    <div className='ws-detail-identity'>
                        <h2 className='ws-detail-name'>{template.title}</h2>
                        <div className='ws-detail-sub'>
                            {[
                                `${count} question${count === 1 ? '' : 's'}`,
                                sendSummaryText(sendSummary),
                                formatDay(template.updatedAt) && `Updated ${formatDay(template.updatedAt)}`
                            ]
                                .filter(Boolean)
                                .join(' · ')}
                        </div>
                        <div className='ws-detail-tags'>
                            {!template.archived ? (
                                <Tag color={templateStatusOf(template, sendSummary).color}>
                                    {templateStatusOf(template, sendSummary).label}
                                </Tag>
                            ) : null}
                            {!template.department && <Tag>Shared</Tag>}
                            {template.archived && <Tag color='warning'>Archived</Tag>}
                        </div>
                    </div>
                    <div className='ws-detail-actions'>
                        <Button icon={<EditOutlined />} onClick={onEdit}>
                            Edit
                        </Button>
                        {canManage &&
                            (template.archived ? (
                                <Button icon={<RollbackOutlined />} onClick={() => onArchive(false)}>
                                    Restore
                                </Button>
                            ) : hasBeenSent ? (
                                <Popconfirm
                                    title='Archive this template?'
                                    description="It leaves the Templates list and can't be sent. Surveys already sent keep their answers."
                                    okText='Archive'
                                    onConfirm={() => onArchive(true)}
                                >
                                    <Button icon={<InboxOutlined />}>Archive</Button>
                                </Popconfirm>
                            ) : (
                                <Popconfirm
                                    title='Delete this template?'
                                    description="It has never been sent. This can't be undone."
                                    okText='Delete'
                                    okButtonProps={{ danger: true }}
                                    onConfirm={onDelete}
                                >
                                    <Button danger icon={<DeleteOutlined />}>
                                        Delete
                                    </Button>
                                </Popconfirm>
                            ))}
                        {template.archived ? null : !hasBeenSent || !resend || resend.changed ? (
                                <Tooltip
                                    title={
                                        hasBeenSent && resend?.changed
                                            ? `The questions changed since ${resend.lastSent}: this sends a new, separate round.`
                                            : undefined
                                    }
                                >
                                    <Button type='primary' icon={<SendOutlined />} onClick={send}>
                                        {hasBeenSent ? 'Send again' : 'Send'}
                                    </Button>
                                </Tooltip>
                            ) : resend.onAddRecipients ? (
                                <Tooltip
                                    title={`The questions are the same as the round sent ${resend.lastSent}, so new people join that round. Change the questions to send a new one.`}
                                >
                                    <Button type='primary' icon={<UserAddOutlined />} onClick={resend.onAddRecipients}>
                                        Add recipients
                                    </Button>
                                </Tooltip>
                            ) : (
                                <Tooltip
                                    title={`The questions haven't changed since the round sent ${resend.lastSent}, which has closed. Change the questions to send a new round.`}
                                >
                                    <Button type='primary' icon={<SendOutlined />} disabled>
                                        Send again
                                    </Button>
                                </Tooltip>
                            )}
                    </div>
                </motion.header>

                <div className='ws-detail-tabs'>
                    <div className='ws-detail-pane'>
                        <motion.div key={`body-${template.id}`} className='ws-detail-body' {...enter(0.06)}>
                            {!isReady && !template.archived && hasBeenSent ? (
                                <p className='ws-prose' style={{ opacity: 0.75 }}>
                                    This survey was sent before and is a draft again. Surveys already sent and their
                                    answers are unaffected. Click Send to make it ready and send it to more people.
                                </p>
                            ) : null}
                            {template.description && <p className='ws-prose'>{template.description}</p>}
                            {template.fields.length === 0 ? (
                                <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description='No questions yet' />
                            ) : (
                                <div className='svp-questions'>
                                    {template.fields.map(field => {
                                        if (field.type === 'heading') {
                                            return (
                                                <h4 key={field.id} className='ws-section-title'>
                                                    {field.label}
                                                </h4>
                                            )
                                        }
                                        number += 1
                                        return (
                                            <section key={field.id} className='svp-question'>
                                                <div className='svp-question-head'>
                                                    <h4 className='svp-question-title'>
                                                        {number}. {field.label}
                                                        {field.required ? ' *' : ''}
                                                    </h4>
                                                    <span className='svp-question-count'>
                                                        {TYPE_LABEL[field.type] || field.type}
                                                    </span>
                                                </div>
                                                {field.options?.length ? (
                                                    <div className='ws-detail-tags'>
                                                        {field.options.map(option => (
                                                            <Tag key={option} bordered={false}>
                                                                {option}
                                                            </Tag>
                                                        ))}
                                                    </div>
                                                ) : null}
                                            </section>
                                        )
                                    })}
                                </div>
                            )}
                        </motion.div>
                    </div>
                </div>
            </MotionCard>
        </div>
    )
}
