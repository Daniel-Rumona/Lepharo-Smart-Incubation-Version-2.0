import React from 'react'
import { Button, Empty, Popconfirm, Tag, Tooltip } from 'antd'
import { DeleteOutlined, EditOutlined, InboxOutlined, RollbackOutlined, SendOutlined } from '@ant-design/icons'
import { motion, useReducedMotion } from 'framer-motion'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { EntityAvatar } from '@/components/workspace'
import { formatDay, questionCount, type SurveyTemplate } from './surveyData'

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
    /** Own department's template (shared ones: admins only). */
    canManage: boolean
    /** Sent at least once, so it can be archived but not deleted. */
    hasBeenSent: boolean
    onDelete: () => Promise<void>
    onArchive: (archived: boolean) => Promise<void>
}

/** A template: its questions as the SME will meet them, with Edit and Send. */
export const TemplateDetail: React.FC<Props> = ({
    template,
    onEdit,
    onSend,
    canManage,
    hasBeenSent,
    onDelete,
    onArchive
}) => {
    const reduceMotion = useReducedMotion()
    const count = questionCount(template.fields)
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
                                formatDay(template.updatedAt) && `Updated ${formatDay(template.updatedAt)}`
                            ]
                                .filter(Boolean)
                                .join(' · ')}
                        </div>
                        <div className='ws-detail-tags'>
                            <Tag color={template.status === 'published' ? 'success' : 'default'}>
                                {template.status === 'published' ? 'Published' : 'Draft'}
                            </Tag>
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
                        {!template.archived && (
                            <Tooltip title={template.status === 'published' ? undefined : 'Publish it in the builder first'}>
                                <Button
                                    type='primary'
                                    icon={<SendOutlined />}
                                    disabled={template.status !== 'published'}
                                    onClick={onSend}
                                >
                                    Send
                                </Button>
                            </Tooltip>
                        )}
                    </div>
                </motion.header>

                <div className='ws-detail-tabs'>
                    <div className='ws-detail-pane'>
                        <motion.div key={`body-${template.id}`} className='ws-detail-body' {...enter(0.06)}>
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
