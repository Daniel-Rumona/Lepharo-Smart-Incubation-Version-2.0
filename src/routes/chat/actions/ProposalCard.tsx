import { useEffect, useState } from 'react'
import { Button, Card, Space, Spin, Typography } from 'antd'
import { CheckCircleFilled, CloseCircleFilled, ThunderboltOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import type { AgentProposalDraft } from '@/services/aiAssistantService'
import {
    cancelAgentAction,
    confirmAgentAction,
    proposeAgentAction,
    type AgentProposalPreview
} from '@/services/agentActionsService'
import { getNavDestinations } from '@/components/guide-me/navDestinations'

const { Text } = Typography

type CardState =
    | { phase: 'checking' }
    | { phase: 'ready'; preview: AgentProposalPreview }
    | { phase: 'confirming'; preview: AgentProposalPreview }
    | { phase: 'done'; preview: AgentProposalPreview; message: string }
    | { phase: 'failed'; preview?: AgentProposalPreview; message: string }
    | { phase: 'cancelled'; preview: AgentProposalPreview }

// Kept outside React so leaving the chat and coming back neither re-proposes the
// change nor offers a confirm button for something already done.
const cardStates = new Map<string, CardState>()

const MAX_LINES = 8

const assignmentsRoute = () =>
    getNavDestinations().find(item => /\/assignments$/.test(item.route))?.route || '/operations/assignments'

type Props = {
    messageId: string
    draft: AgentProposalDraft
    sessionId?: string
    /** Adds the outcome to the conversation. */
    onOutcome: (text: string) => void
}

export default function ProposalCard({ messageId, draft, sessionId, onOutcome }: Props) {
    const navigate = useNavigate()
    const [state, setLocalState] = useState<CardState>(() => cardStates.get(messageId) || { phase: 'checking' })
    const [showAll, setShowAll] = useState(false)

    const setState = (next: CardState) => {
        cardStates.set(messageId, next)
        setLocalState(next)
    }

    useEffect(() => {
        if (cardStates.has(messageId)) return
        cardStates.set(messageId, { phase: 'checking' })
        proposeAgentAction(draft, sessionId)
            .then(result => {
                if (result.ok) setState({ phase: 'ready', preview: result.preview })
                else setState({ phase: 'failed', message: result.reason })
            })
            .catch(() => setState({ phase: 'failed', message: 'I could not check that change right now. Please try again.' }))
    }, [messageId])

    const onConfirm = async (preview: AgentProposalPreview) => {
        setState({ phase: 'confirming', preview })
        try {
            const result = await confirmAgentAction(preview.proposalId)
            if (!result.ok) {
                setState({ phase: 'failed', preview, message: result.message })
                return
            }
            setState({ phase: 'done', preview, message: result.message })
            if (result.handoff?.kind === 'assign_intervention') {
                navigate(assignmentsRoute(), { state: { agentPrefill: result.handoff.state } })
                return
            }
            onOutcome(result.message)
        } catch {
            setState({ phase: 'failed', preview, message: 'That could not be done right now. Nothing was changed.' })
        }
    }

    const onCancel = (preview: AgentProposalPreview) => {
        setState({ phase: 'cancelled', preview })
        void cancelAgentAction(preview.proposalId).catch(() => undefined)
    }

    if (state.phase === 'checking') {
        return (
            <Card size='small' className='chat-proposal-card'>
                <Space><Spin size='small' /> <Text type='secondary'>Checking what this would change…</Text></Space>
            </Card>
        )
    }

    const preview = 'preview' in state ? state.preview : undefined
    const lines = preview?.lines || []
    const visible = showAll ? lines : lines.slice(0, MAX_LINES)

    return (
        <Card size='small' className='chat-proposal-card'>
            <Space direction='vertical' size={6} style={{ width: '100%' }}>
                {preview && (
                    <Text strong>
                        <ThunderboltOutlined style={{ color: 'var(--app-accent)', marginRight: 6 }} />
                        {preview.headline}
                    </Text>
                )}
                {visible.length > 0 && (
                    <ul style={{ margin: 0, paddingLeft: 20 }}>
                        {visible.map((line, index) => <li key={index}><Text>{line}</Text></li>)}
                    </ul>
                )}
                {lines.length > MAX_LINES && !showAll && (
                    <Button type='link' size='small' style={{ padding: 0 }} onClick={() => setShowAll(true)}>
                        Show all {lines.length}
                    </Button>
                )}
                {preview && preview.skipped.length > 0 && (
                    <Text type='secondary' style={{ fontSize: 12 }}>
                        Left out: {preview.skipped.join('; ')}
                    </Text>
                )}

                {(state.phase === 'ready' || state.phase === 'confirming') && (
                    <Space wrap>
                        <Button
                            type='primary'
                            shape='round'
                            loading={state.phase === 'confirming'}
                            onClick={() => onConfirm(state.preview)}
                        >
                            {state.preview.handoff ? 'Open the form' : 'Confirm'}
                        </Button>
                        <Button
                            shape='round'
                            disabled={state.phase === 'confirming'}
                            onClick={() => onCancel(state.preview)}
                        >
                            Cancel
                        </Button>
                    </Space>
                )}
                {state.phase === 'done' && (
                    <Text type='success'><CheckCircleFilled /> {state.message}</Text>
                )}
                {state.phase === 'failed' && (
                    <Text type='danger'><CloseCircleFilled /> {state.message}</Text>
                )}
                {state.phase === 'cancelled' && (
                    <Text type='secondary'>Cancelled. Nothing was changed.</Text>
                )}
            </Space>
        </Card>
    )
}
