import dayjs from 'dayjs'
import { Badge, Button, Space, Tag, Typography, Upload, message } from 'antd'
import {
    BankOutlined, ClockCircleOutlined, DeleteOutlined, FileTextOutlined, TeamOutlined,
    UploadOutlined, UserOutlined
} from '@ant-design/icons'
import type {
    Proposal, ProposalActor, ProposalContributor, ProposalDocument, ProposalOwnerType, ProposalStatus
} from '@/types/proposal'

/**
 * Formatting, status rules and small pieces shared by the proposal pipeline's
 * list, detail panel and modals.
 */

const { Text } = Typography

export const money = (value: number) =>
    new Intl.NumberFormat('en-ZA', {
        style: 'currency', currency: 'ZAR', maximumFractionDigits: 0
    }).format(Number(value || 0))

/** "R 4,5M": for tiles on phones, where the full amount wraps. */
export const moneyCompact = (value: number) =>
    new Intl.NumberFormat('en-ZA', {
        style: 'currency', currency: 'ZAR', notation: 'compact', maximumFractionDigits: 1
    }).format(Number(value || 0))

export const dateLabel =(value: any) => {
    if (!value) return 'Not recorded'
    const date = value?.toDate?.() || value
    return dayjs(date).isValid() ? dayjs(date).format('DD MMM YYYY, HH:mm') : 'Not recorded'
}

export const datePickerValue = (value: Proposal['proposedDate']) => {
    if (!value) return null
    const resolved = typeof (value as any)?.toDate === 'function'
        ? (value as any).toDate()
        : value
    return dayjs(resolved)
}

export const dayLabel = (value: Proposal['proposedDate']) => {
    const date = datePickerValue(value)
    return date?.isValid() ? date.format('DD MMM YYYY') : 'Not set'
}

/** Statuses where the proposal has not gone to the client yet. */
export const PREPARATION_STATUSES: ProposalStatus[] = ['Draft', 'In preparation']

/**
 * How close the submission deadline is, while the proposal is still being
 * prepared; once submitted the deadline no longer needs attention.
 */
export const deadlineState = (proposal: Proposal): { tone: 'overdue' | 'soon' | 'later'; text: string } | null => {
    const deadline = datePickerValue(proposal.submissionDeadline)
    if (!deadline?.isValid() || !PREPARATION_STATUSES.includes(proposal.status)) return null
    const days = deadline.startOf('day').diff(dayjs().startOf('day'), 'day')
    if (days < 0) return { tone: 'overdue', text: `${-days} day${days === -1 ? '' : 's'} overdue` }
    if (days === 0) return { tone: 'soon', text: 'Due today' }
    if (days <= 7) return { tone: 'soon', text: `Due in ${days} day${days === 1 ? '' : 's'}` }
    return { tone: 'later', text: `Due ${deadline.format('DD MMM YYYY')}` }
}

/** The deadline line under a status: amber when close, red when missed, quiet otherwise. */
export const DeadlineHint = ({ proposal }: { proposal: Proposal }) => {
    const state = deadlineState(proposal)
    if (!state) return null
    return <span className={`proposal-deadline-hint${state.tone === 'later' ? '' : ` proposal-deadline-${state.tone}`}`}>
        {state.tone !== 'later' && <ClockCircleOutlined />} {state.text}
    </span>
}

export const DeadlineCell = ({ proposal }: { proposal: Proposal }) => {
    const state = deadlineState(proposal)
    if (!proposal.submissionDeadline) return <Text type='secondary'>Not set</Text>
    return <div className='proposal-deadline-cell'>
        <span>{dayLabel(proposal.submissionDeadline)}</span>
        {state && state.tone !== 'later' &&
            <Tag color={state.tone === 'overdue' ? 'red' : 'orange'}>{state.text}</Tag>}
    </div>
}

export const statusColor: Record<ProposalStatus, string> = {
    Draft: 'default',
    'In preparation': 'cyan',
    Submitted: 'blue',
    'Under review': 'purple',
    Accepted: 'green',
    'SLA signed': 'green',
    'Awaiting order number': 'orange',
    'Implementation planning': 'gold',
    'Ready for activation': 'lime',
    Active: 'success',
    Rejected: 'red',
    Archived: 'default'
}

export const actorFromIdentity = (identity: any): ProposalActor | null => {
    if (!identity?.id) return null
    const branch = identity.assignedBranch
    return {
        id: identity.id,
        name: identity.name || identity.fullName || identity.email || 'Smart Inc user',
        email: identity.email || null,
        role: identity.role || null,
        branchId: typeof branch === 'string'
            ? branch
            : branch?.id || identity.branchId || null
    }
}

const STATUS_TRANSITIONS: Record<ProposalStatus, ProposalStatus[]> = {
    Draft: ['In preparation', 'Submitted', 'Archived'],
    'In preparation': ['Draft', 'Submitted', 'Archived'],
    Submitted: ['Under review', 'Accepted', 'Rejected', 'Archived'],
    'Under review': ['In preparation', 'Accepted', 'Rejected', 'Archived'],
    Accepted: ['SLA signed', 'Rejected', 'Archived'],
    'SLA signed': ['Awaiting order number', 'Implementation planning', 'Archived'],
    'Awaiting order number': ['Implementation planning', 'Archived'],
    'Implementation planning': ['Ready for activation', 'Archived'],
    'Ready for activation': ['Active', 'Implementation planning', 'Archived'],
    Active: ['Archived'],
    Rejected: ['In preparation', 'Archived'],
    Archived: ['Draft']
}

export const nextStatuses = (current: ProposalStatus) => STATUS_TRANSITIONS[current]

// Statuses a new proposal may start in; anything later goes through the status flow.
const CREATE_STATUSES: ProposalStatus[] = ['Draft', 'In preparation', 'Submitted']

// The edit form may keep the current status or make one allowed move, so
// editing never skips the pipeline.
export const formStatuses = (current?: ProposalStatus) =>
    current ? [current, ...STATUS_TRANSITIONS[current]] : CREATE_STATUSES

// The forward move for the "Advance" action. Each target is also an allowed
// transition above; Rejected proposals re-open into preparation and archived
// ones are restored as drafts.
export const ADVANCE_TO: Partial<Record<ProposalStatus, ProposalStatus>> = {
    Archived: 'Draft',
    Draft: 'In preparation',
    'In preparation': 'Submitted',
    Submitted: 'Under review',
    'Under review': 'Accepted',
    Accepted: 'SLA signed',
    'SLA signed': 'Awaiting order number',
    'Awaiting order number': 'Implementation planning',
    'Implementation planning': 'Ready for activation',
    'Ready for activation': 'Active',
    Rejected: 'In preparation'
}

export const advanceLabel = (status: ProposalStatus) =>
    status === 'Rejected' ? 'Reopen' : status === 'Archived' ? 'Restore' : ADVANCE_TO[status] ? 'Advance' : 'Update status'

// Activation steps completed for a status, which is also the step in progress.
// Anything before acceptance has none; Active has all five.
export const ACTIVATION_STEP_COUNT = 5
const ACTIVATION_STEPS_DONE: Partial<Record<ProposalStatus, number>> = {
    Accepted: 1,
    'SLA signed': 2,
    'Awaiting order number': 2,
    'Implementation planning': 3,
    'Ready for activation': 4,
    Active: 5
}
export const activationStep = (status: ProposalStatus) => ACTIVATION_STEPS_DONE[status] || 0

export const contributorKey = (person: ProposalContributor) => person.id || person.email || person.name

export const ownerIcon = (type?: ProposalOwnerType) =>
    type === 'Department' ? <TeamOutlined /> : type === 'Centre' ? <BankOutlined /> : <UserOutlined />

const PROPOSAL_DOCUMENT_CATEGORIES = [
    { key: 'Proposal', description: 'The proposal or bid document itself' },
    { key: 'Financial', description: 'Budgets, quotations and pricing schedules' },
    { key: 'Compliance', description: 'Registration, tax and regulatory certificates' },
    { key: 'Agreement', description: 'SLAs, contracts and signed agreements' },
    { key: 'Evidence', description: 'Any other supporting evidence' }
]

const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024

export type PendingDocument = { category: string; file: File }

/**
 * Documents grouped by category, used both when creating/editing a proposal
 * (pending files, uploaded on save) and in the detail panel (uploaded now).
 * Documents saved under a category outside the list, such as older
 * "Supporting document" uploads, appear in an "Other" group.
 */
export const DocumentCategoryRows = ({
    documents = [],
    pendingFiles = [],
    onAdd,
    onRemovePending,
    renderDocumentActions
}: {
    documents?: ProposalDocument[]
    pendingFiles?: PendingDocument[]
    onAdd: (category: string, file: File) => void
    onRemovePending?: (pending: PendingDocument) => void
    renderDocumentActions: (document: ProposalDocument) => React.ReactNode
}) => {
    const knownCategories = PROPOSAL_DOCUMENT_CATEGORIES.map(category => category.key)
    const otherDocuments = documents.filter(document => !knownCategories.includes(document.category))
    const rows = [
        ...PROPOSAL_DOCUMENT_CATEGORIES.map(category => ({
            ...category,
            canUpload: true,
            documents: documents.filter(document => document.category === category.key)
        })),
        ...(otherDocuments.length
            ? [{ key: 'Other', description: 'Earlier uploads without a category', canUpload: false, documents: otherDocuments }]
            : [])
    ]

    return <div className='proposal-document-rows'>
        {rows.map(row => {
            const pending = pendingFiles.filter(item => item.category === row.key)
            const count = row.documents.length + pending.length
            return <div className='proposal-document-row' key={row.key}>
                <div className='proposal-document-row-head'>
                    <span className='proposal-document-row-icon'><FileTextOutlined /></span>
                    <span className='proposal-document-row-copy'>
                        <strong>{row.key}{count > 0 && <Badge count={count} size='small' className='proposal-document-count' />}</strong>
                        <small>{row.description}</small>
                    </span>
                    {row.canUpload && <Upload multiple showUploadList={false}
                        beforeUpload={file => {
                            if (file.size > MAX_DOCUMENT_BYTES) {
                                message.error(`${file.name} is larger than the 25 MB limit.`)
                                return Upload.LIST_IGNORE
                            }
                            onAdd(row.key, file as File)
                            return false
                        }}>
                        <Button size='small' icon={<UploadOutlined />}>Add</Button>
                    </Upload>}
                </div>
                {count > 0 && <ul className='proposal-document-files'>
                    {row.documents.map(document => <li key={document.id}>
                        <span className='proposal-document-file-name' title={document.name}>{document.name}</span>
                        <span className='proposal-document-file-meta'>{dateLabel(document.uploadedAt)}</span>
                        <Space size={4}>{renderDocumentActions(document)}</Space>
                    </li>)}
                    {pending.map(item => <li key={`${item.file.name}-${item.file.size}`}>
                        <span className='proposal-document-file-name' title={item.file.name}>{item.file.name}</span>
                        <Tag color='gold'>Uploads on save</Tag>
                        {onRemovePending && <Button size='small' type='text' danger icon={<DeleteOutlined />}
                            aria-label={`Remove ${item.file.name}`} onClick={() => onRemovePending(item)} />}
                    </li>)}
                </ul>}
            </div>
        })}
    </div>
}
