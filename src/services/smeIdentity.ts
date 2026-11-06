import { httpsCallable } from 'firebase/functions'
import { collection, doc, getDoc, getDocs, query, where } from 'firebase/firestore'
import { db, functions } from '@/firebase'

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

/** What identifies an SME: its login, and the participant record linked to it. */
export type SmeRef = {
    uid?: string | null
    participantId?: string | null
    /** Only for SMEs not linked yet; removed with the email fallback in Phase 4. */
    email?: string | null
}

const clean = (value: unknown) => String(value ?? '').trim()

/**
 * The SME's participant id: users.participantId (set by the server when the
 * login is linked). Until Phase 4, a login not linked yet falls back to the
 * participant carrying its email.
 */
export async function resolveSmeParticipantId(sme?: SmeRef | null): Promise<string | null> {
    const linked = clean(sme?.participantId)
    if (linked) return linked

    const email = clean(sme?.email).toLowerCase()
    if (!email) return null
    const byEmail = await getDocs(query(collection(db, 'participants'), where('email', '==', email))).catch(() => null)
    if (byEmail?.docs[0]) return byEmail.docs[0].id
    // Older records keep the casing they were typed with.
    if (clean(sme?.email) !== email) {
        const asTyped = await getDocs(query(collection(db, 'participants'), where('email', '==', clean(sme?.email)))).catch(() => null)
        if (asTyped?.docs[0]) return asTyped.docs[0].id
    }
    return null
}

/** The SME's participant record, or null. */
export async function getSmeParticipant(sme?: SmeRef | null): Promise<({ id: string } & Record<string, any>) | null> {
    const participantId = await resolveSmeParticipantId(sme)
    if (!participantId) return null
    const snap = await getDoc(doc(db, 'participants', participantId)).catch(() => null)
    return snap?.exists() ? { id: snap.id, ...(snap.data() as any) } : null
}
