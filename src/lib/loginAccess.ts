import { httpsCallable } from 'firebase/functions'
import type { User } from 'firebase/auth'
import { functions } from '@/firebase'

/**
 * Sign-in is limited to @quantilytix.co.za staff and the training list
 * (pilotSettings/recipients) while the pilot guard is on. The server decides
 * (functions/src/loginAccess.ts); staff emails are let through here too, so the
 * team is never locked out by a failed call.
 */
export const STAFF_EMAIL_DOMAIN = '@quantilytix.co.za'

export const LOGIN_DENIED_MESSAGE =
    'This platform is open to training participants only for now. If you were on the training, sign in with the email or phone number you registered with, or contact the programme team.'

export const LOGIN_CHECK_FAILED_MESSAGE =
    'We could not confirm your access just now. Check your connection and try again.'

export type LoginAccess = 'allowed' | 'denied' | 'unknown'

// One answer per login per tab, so page navigation does not call the server again.
const cacheKey = (uid: string) => `lph.loginAccess.${uid}`

export async function checkLoginAccess(user: Pick<User, 'uid' | 'email'>): Promise<LoginAccess> {
    if ((user.email || '').trim().toLowerCase().endsWith(STAFF_EMAIL_DOMAIN)) return 'allowed'
    try {
        if (sessionStorage.getItem(cacheKey(user.uid)) === 'allowed') return 'allowed'
    } catch {
        // Storage blocked: ask the server.
    }
    try {
        const { data } = await httpsCallable<unknown, { allowed?: boolean }>(functions, 'checkLoginAccess')()
        const access: LoginAccess = data?.allowed ? 'allowed' : 'denied'
        if (access === 'allowed') {
            try {
                sessionStorage.setItem(cacheKey(user.uid), 'allowed')
            } catch {
                // Asked again next time.
            }
        }
        return access
    } catch (error) {
        console.warn('Could not check sign-in access', error)
        return 'unknown'
    }
}
