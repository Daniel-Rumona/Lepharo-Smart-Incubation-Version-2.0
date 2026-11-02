import { httpsCallable } from 'firebase/functions'
import { functions } from '@/firebase'

/**
 * Links the signed-in SME's login to its participant record, both ways
 * (docs/sme-identity-migration-plan.md). With no participantId the server finds
 * the SME's own record and links it only if exactly one matches. Answers the
 * linked participantId, or null. Never throws: linking is repaired on a later
 * sign-in, so a failure here must not block the SME.
 */
export async function linkMySmeAccount(participantId?: string): Promise<string | null> {
    try {
        const result = await httpsCallable(functions, 'linkMySmeAccount')(participantId ? { participantId } : {})
        return ((result.data as { participantId?: string | null })?.participantId) || null
    } catch (error) {
        console.warn('[smeIdentity] could not link the SME login:', error)
        return null
    }
}
