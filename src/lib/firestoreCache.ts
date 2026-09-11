import { signOut } from 'firebase/auth'
import { clearIndexedDbPersistence, terminate } from 'firebase/firestore'

import { auth, db } from '@/firebase'
import { showSignOutScreen, signOutScreenSettled } from '@/components/auth/signOutScreen'
import { clearActivity } from '@/utils/idleSession'
import { clearCacheOwner, getCacheOwner, isCacheDisabledForTab } from './firestoreCacheOwner'

/**
 * True when the on-disk Firestore cache holds another account's documents.
 *
 * Read-only on purpose. Clearing the cache is reconcileFirestoreCache()'s job
 * (src/lib/firestoreCacheBoot.ts), which runs before first render and can do it
 * without terminating the Firestore client. Doing it here, mid-session, would
 * mean terminate() and a forced reload.
 */
export function cacheBelongsToAnotherAccount(uid: string): boolean {
    if (isCacheDisabledForTab()) return false
    const owner = getCacheOwner()
    return owner !== null && owner !== uid
}

/**
 * The one way out of the app. Every sign-out path goes through here.
 *
 * The sign-out screen goes up first, and it matters: signing out re-renders the
 * whole tree with no user, and screens built for a signed-in user flash their
 * error state on the way past. The full-page navigation that follows is what
 * clears in-memory state left over from this user -- necessary now that a
 * different account can sign in without the tab ever closing -- but it is slow
 * enough for that flash to be visible, which is what the screen covers.
 */
export async function signOutApp(redirectTo = '/login'): Promise<void> {
    showSignOutScreen()
    try {
        await signOut(auth)

        // Hand the cache back unowned. Leaving it owned means the next sign-in by
        // a different person is detected mid-session, where clearing requires
        // terminate() and therefore a reload -- which lands back on the login
        // screen and reads as having to sign in twice. Clearing here instead
        // costs a returning user a cold cache, which is cheap now that sessions
        // last a fortnight and signing out is a deliberate, uncommon act.
        await terminate(db)
        await clearIndexedDbPersistence(db)
        clearCacheOwner()
    } catch (error) {
        // Another tab may hold the cache open. The ownership record then stays
        // put, and reconcileFirestoreCache() sorts it out on the next load.
        console.warn('Could not clear the Firestore cache on sign-out', error)
    } finally {
        clearActivity()
        // Everything above has already happened -- the user is signed out and the
        // cache is gone. This only holds the navigation back so the farewell
        // animation finishes its pass instead of being cut off mid-sweep.
        await signOutScreenSettled()
        window.location.assign(redirectTo)
    }
}
