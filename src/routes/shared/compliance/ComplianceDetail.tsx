import React from 'react'
import { Empty, Tag, Tooltip } from 'antd'
import { FileProtectOutlined, FileTextOutlined, RobotOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { motion, useReducedMotion } from 'framer-motion'
import { EntityAvatar } from '@/components/workspace'
import { MotionCard } from '@/components/dashboards/metrics/Header'
import { IconChip } from '@/components/dashboards/metrics/MetricTile'
import {
    BUCKET_META,
    currentAiReview,
    viewHeadline,
    type ComplianceBucket,
    type ComplianceView,
    type RequirementEntry
} from './complianceWorkspace'
import './compliance.css'

const SECTION_ORDER: ComplianceBucket[] = ['action', 'review', 'expiring', 'valid']

const REQUIRED_AT_APPLICATION_HINT =
    'The SME must provide this when they apply, before they can be considered for onboarding.'

const formatDate = (value: any) => {
    if (!value) return ''
    const raw = typeof value?.toDate === 'function'
        ? value.toDate()
        : typeof value?.seconds === 'number'
            ? new Date(value.seconds * 1000)
            : value
    const parsed = dayjs(raw)
    return parsed.isValid() ? parsed.format('D MMM YYYY') : ''
}

/** The facts under a document's title: expiry, who uploaded it, and the latest review note. */
const documentFacts = (entry: RequirementEntry) => {
    const document = entry.document || {}
    const facts: string[] = []
    if (entry.expiryText && entry.expiryText !== '—') {
        const months = entry.expiryText.match(/^(\d+) mo$/)?.[1]
        facts.push(
            entry.expiresAt
                ? `${entry.state === 'expired' ? 'Expired' : 'Expires'} ${dayjs(entry.expiresAt).format('D MMM YYYY')}`
                : months
                    ? `Valid for ${months} month${months === '1' ? '' : 's'} from issue`
                    : entry.expiryText
        )
    }
    const uploaded = formatDate(document.uploadedAt)
    if (uploaded) {
        const verb = entry.kind === 'agreement' ? 'Signed' : 'Uploaded'
        facts.push(document.uploadedBy ? `${verb} ${uploaded} by ${document.uploadedBy}` : `${verb} ${uploaded}`)
    }
    const verified = formatDate(document.lastVerifiedAt)
    if (verified && entry.state === 'valid') {
        facts.push(document.lastVerifiedBy ? `Verified ${verified} by ${document.lastVerifiedBy}` : `Verified ${verified}`)
    }
    return facts
}

const AI_LABELS: Record<string, string> = {
    valid: 'AI suggests: valid',
    invalid: 'AI suggests: not the required document',
    expired: 'AI suggests: expired',
    unclear: 'AI could not check this file'
}

/** The AI's suggestion for the current file, with what it read from it. */
const AiSuggestion: React.FC<{ document: any }> = ({ document }) => {
    const review = currentAiReview(document)
    if (!review) return null
    const read = [
        review.extracted.issueDate && `issued ${dayjs(review.extracted.issueDate).format('D MMM YYYY')}`,
        review.expiresOn
            ? `expires ${dayjs(review.expiresOn).format('D MMM YYYY')}`
            : review.extracted.expiryDate && `expires ${dayjs(review.extracted.expiryDate).format('D MMM YYYY')}`,
        review.extracted.holderName,
        review.extracted.registrationNumber && `reg. ${review.extracted.registrationNumber}`
    ].filter(Boolean)
    const tone = review.recommendation === 'valid'
        ? 'is-success'
        : review.recommendation === 'unclear'
            ? ''
            : 'is-warning'
    return (
        <div className={`cmp-doc-note cmp-ai ${tone}`}>
            <div className='cmp-ai-head'>
                <RobotOutlined aria-hidden='true' />
                <strong>{AI_LABELS[review.recommendation] || AI_LABELS.unclear}</strong>
                <span className='cmp-ai-confidence'>{review.confidence} confidence</span>
            </div>
            {review.reason && <div>{review.reason}</div>}
            {read.length > 0 && <div className='cmp-ai-read'>Read from the file: {read.join(' · ')}</div>}
        </div>
    )
}

/** The query reason or, failing that, the latest history note. */
const documentNote = (entry: RequirementEntry) => {
    const document = entry.document || {}
    if (['queried', 'invalid', 'rejected'].includes(entry.state) && document.queryReason) {
        return { text: document.queryReason as string, tone: 'is-warning' }
    }
    // The AI suggestion block already says what the AI found.
    if (currentAiReview(document)) return null
    const history = Array.isArray(document.statusHistory) ? document.statusHistory : []
    const latest = history[history.length - 1]
    const text = latest?.note || latest?.reason
    return text ? { text: `${latest.by ? `${latest.by}: ` : ''}${text}`, tone: '' } : null
}

type Props = {
    view: ComplianceView
    entries: RequirementEntry[]
    /** Upload and reminder buttons for this SME. */
    headerActions?: React.ReactNode
    /** The review buttons for one requirement (view, upload, verify, sign…). */
    renderActions: (entry: RequirementEntry) => React.ReactNode
    /** Department-specific tags, such as the MOA state for ROM. */
    extraTags?: React.ReactNode
}

/**
 * One SME's documents, grouped by who acts next: what the SME still owes,
 * what staff have to review, what expires soon and what is in order.
 */
export const ComplianceDetail: React.FC<Props> = ({ view, entries, headerActions, renderActions, extraTags }) => {
    const reduceMotion = useReducedMotion()
    const headline = viewHeadline(view)
    const percent = view.required ? Math.round((view.covered / view.required) * 100) : 0
    const enter = (delay = 0) =>
        reduceMotion
            ? {}
            : {
                initial: { opacity: 0, y: 8 },
                animate: { opacity: 1, y: 0 },
                transition: { duration: 0.26, ease: 'easeOut' as const, delay }
            }

    return (
        <div className='ws-detail' data-guide='manage-compliance-content'>
            <MotionCard>
                <motion.header key={`head-${view.participantId}`} className='ws-detail-head' {...enter()}>
                    <EntityAvatar name={view.name} size={52} />
                    <div className='ws-detail-identity'>
                        <h2 className='ws-detail-name'>{view.name}</h2>
                        <div className='ws-detail-sub'>
                            {[view.programName, view.branchName, view.gapGroup, view.email]
                                .filter(value => value && value !== '—')
                                .join(' · ')}
                        </div>
                        <div className='ws-detail-tags'>
                            <Tag color={headline.color}>{headline.label}</Tag>
                            {extraTags}
                        </div>
                    </div>
                    {headerActions && <div className='ws-detail-actions'>{headerActions}</div>}
                </motion.header>

                {view.required > 0 && (
                    <motion.div key={`coverage-${view.participantId}`} className='cmp-summary' {...enter(0.04)}>
                        <div className='cmp-summary-figure'>
                            {view.covered}
                            <small>/{view.required}</small>
                        </div>
                        <div className='cmp-summary-text'>
                            <div className='cmp-summary-label'>Documents in order</div>
                            <div className='cmp-coverage-track is-large'>
                                <span style={{ width: `${percent}%` }} />
                            </div>
                        </div>
                        <div className='cmp-summary-counts'>
                            {SECTION_ORDER.filter(bucket => bucket !== 'valid' && view.counts[bucket] > 0).map(bucket => (
                                <span key={bucket} className={`cmp-count qtx-tone-${BUCKET_META[bucket].tone}`}>
                                    {view.counts[bucket]} {BUCKET_META[bucket].countLabel}
                                </span>
                            ))}
                        </div>
                    </motion.div>
                )}

                <div className='ws-detail-tabs'>
                    <div className='ws-detail-pane'>
                        <motion.div key={`docs-${view.participantId}`} className='ws-detail-body' {...enter(0.08)}>
                            {entries.length === 0 ? (
                                <Empty
                                    className='ws-detail-empty'
                                    description='No documents are configured for this SME in your scope.'
                                />
                            ) : (
                                SECTION_ORDER.map(bucket => {
                                    const items = entries.filter(entry => entry.bucket === bucket)
                                    if (!items.length) return null
                                    return (
                                        <section key={bucket}>
                                            <h3 className='ws-section-title'>
                                                {BUCKET_META[bucket].title} · {items.length}
                                            </h3>
                                            <div className='cmp-docs'>
                                                {items.map(entry => {
                                                    const facts = documentFacts(entry)
                                                    const note = documentNote(entry)
                                                    return (
                                                        <article key={entry.key} className='cmp-doc'>
                                                            <IconChip
                                                                size={36}
                                                                radius={10}
                                                                tone={BUCKET_META[bucket].tone}
                                                                icon={
                                                                    entry.kind === 'agreement'
                                                                        ? <FileProtectOutlined />
                                                                        : <FileTextOutlined />
                                                                }
                                                            />
                                                            <div className='cmp-doc-main'>
                                                                <div className='cmp-doc-head'>
                                                                    <span className='cmp-doc-title'>{entry.title}</span>
                                                                    <Tag color={entry.color} bordered={false}>
                                                                        {entry.label}
                                                                    </Tag>
                                                                    {entry.requirement?.requiredAtApplication === true && (
                                                                        <Tooltip title={REQUIRED_AT_APPLICATION_HINT}>
                                                                            <Tag className='cmp-doc-required' bordered={false}>
                                                                                Required at application
                                                                            </Tag>
                                                                        </Tooltip>
                                                                    )}
                                                                </div>
                                                                {facts.length > 0 && (
                                                                    <div className='cmp-doc-facts'>{facts.join(' · ')}</div>
                                                                )}
                                                                {note && (
                                                                    <div className={`cmp-doc-note ${note.tone}`}>{note.text}</div>
                                                                )}
                                                                <AiSuggestion document={entry.document} />
                                                            </div>
                                                            <div className='cmp-doc-actions'>{renderActions(entry)}</div>
                                                        </article>
                                                    )
                                                })}
                                            </div>
                                        </section>
                                    )
                                })
                            )}
                        </motion.div>
                    </div>
                </div>
            </MotionCard>
        </div>
    )
}
