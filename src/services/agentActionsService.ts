import { httpsCallable } from 'firebase/functions'
import { functions } from '@/firebase'
import type { AgentProposalDraft } from '@/services/aiAssistantService'

/** What the server checked and will do, shown on the confirm card. */
export type AgentProposalPreview = {
    proposalId: string
    kind: AgentProposalDraft['kind']
    headline: string
    lines: string[]
    skipped: string[]
    handoff: boolean
}

export type AgentProposalResult =
    | { ok: true; preview: AgentProposalPreview }
    | { ok: false; reason: string }

export type AgentConfirmResult = {
    ok: boolean
    message: string
    handoff: { kind: string; state: Record<string, unknown> } | null
}

const propose = httpsCallable<Record<string, unknown>, any>(functions, 'agentProposeAction')
const confirm = httpsCallable<Record<string, unknown>, any>(functions, 'agentConfirmAction')
const cancel = httpsCallable<Record<string, unknown>, any>(functions, 'agentCancelAction')

/** Asks the server to check a drafted change. Nothing is written yet. */
export async function proposeAgentAction(
    draft: AgentProposalDraft,
    sessionId?: string
): Promise<AgentProposalResult> {
    const { data } = await propose({ kind: draft.kind, params: draft.params, sessionId: sessionId || null })
    if (!data?.ok) return { ok: false, reason: String(data?.reason || 'That change could not be prepared.') }
    return {
        ok: true,
        preview: {
            proposalId: String(data.proposalId),
            kind: data.kind,
            headline: String(data.headline || ''),
            lines: Array.isArray(data.lines) ? data.lines.map(String) : [],
            skipped: Array.isArray(data.skipped) ? data.skipped.map(String) : [],
            handoff: !!data.handoff
        }
    }
}

export async function confirmAgentAction(proposalId: string): Promise<AgentConfirmResult> {
    const { data } = await confirm({ proposalId })
    return {
        ok: !!data?.ok,
        message: String(data?.message || (data?.ok ? 'Done.' : 'That could not be done.')),
        handoff: data?.handoff && typeof data.handoff === 'object' ? data.handoff : null
    }
}

export async function cancelAgentAction(proposalId: string): Promise<void> {
    await cancel({ proposalId })
}
