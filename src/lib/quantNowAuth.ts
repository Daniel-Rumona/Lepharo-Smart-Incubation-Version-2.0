import { httpsCallable } from 'firebase/functions'
import { functions } from '@/firebase'

/**
 * QuantNow finance-admin sign-in. The email and password stay in Secret Manager
 * behind the getQuantNowFinanceToken function; the browser only gets the token.
 */
export type QuantNowLogin = {
    token: string
    user: { user_id?: string; email?: string; name?: string } | null
}

let pending: Promise<QuantNowLogin> | null = null

export const loginToQuantNow = (): Promise<QuantNowLogin> => {
    // Several finance widgets mount together; share one sign-in between them.
    if (!pending) {
        pending = httpsCallable<void, QuantNowLogin>(functions, 'getQuantNowFinanceToken')()
            .then(result => {
                if (!result.data?.token) throw new Error('Finance API did not return an access token.')
                return result.data
            })
            .finally(() => {
                pending = null
            })
    }
    return pending
}
