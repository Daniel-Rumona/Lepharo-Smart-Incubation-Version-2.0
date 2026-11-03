import { httpsCallable } from 'firebase/functions'
import { signInWithCustomToken, type User } from 'firebase/auth'
import { auth, functions } from '@/firebase'

/**
 * SME sign-in with a phone number and a WhatsApp code (functions/src/phoneLogin.ts,
 * docs/sme-identity-migration-plan.md Phase 5). The server answers the same whether
 * or not a code went out, so screens say "if this number is registered".
 */

export type CodePurpose = 'login' | 'register' | 'change'

/** The callable's own message, which is written for the person signing in. */
export const phoneLoginError = (error: any) =>
    String(error?.message || '').replace(/^FirebaseError:\s*/, '').trim() ||
    'Something went wrong. Please try again.'

export async function requestPhoneCode(phone: string, purpose: CodePurpose): Promise<{ expiresInSeconds: number }> {
    const result = await httpsCallable(functions, 'requestSmeLoginCode')({ phone, purpose })
    return result.data as { expiresInSeconds: number }
}

/** Signs in the SME whose number this is. */
export async function signInWithPhoneCode(phone: string, code: string): Promise<User> {
    const result = await httpsCallable(functions, 'verifySmeLoginCode')({ phone, code })
    const { token } = result.data as { token: string }
    return (await signInWithCustomToken(auth, token)).user
}

/** Creates a phone-only SME account and signs it in. */
export async function registerWithPhoneCode(phone: string, code: string, name: string): Promise<User> {
    const result = await httpsCallable(functions, 'registerSmeByPhone')({ phone, code, name })
    const { token } = result.data as { token: string }
    return (await signInWithCustomToken(auth, token)).user
}

/** Staff: a login for an SME record whose contact signs in by phone. */
export async function createSmeLoginByPhone(participantId: string, phone: string, name?: string) {
    const result = await httpsCallable(functions, 'createSmeLoginByPhone')({ participantId, phone, name })
    return result.data as { uid: string; linked: boolean }
}

/** The signed-in SME moves its phone sign-in to a new number. */
export async function changeMyLoginPhone(phone: string, code: string) {
    const result = await httpsCallable(functions, 'changeMyLoginPhone')({ phone, code })
    return result.data as { ok: boolean; phone: string }
}
