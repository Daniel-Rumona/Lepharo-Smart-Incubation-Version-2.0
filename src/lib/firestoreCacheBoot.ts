import { clearIndexedDbPersistence } from 'firebase/firestore'

import { auth, db } from '@/firebase'
import {
    disableCacheForTab,
    getCacheOwner,
    isCacheDisabledForTab,
    setCacheOwner,
} from './firestoreCacheOwner'

/**
 * Reconciles the on-disk Firestore cache with the signed-in account, before the
 * app renders.
 *
 * Timing is the whole point of doing this here. clearIndexedDbPersistence() may
 * only run before the Firestore client has issued its first operation, or after
 * terminate() -- and terminate() kills the client permanently, which forces a
 * page reload to recover. Running before first render means no operation has
 * happened yet, so the cache can be cleared in place: no terminate, no reload,
 * and no bounce through the landing page on the way in.
 *
 * Started from main.tsx but deliberately *not* awaited there: holding the first
 * render until Firebase has read its persisted session leaves a blank page for
 * as long as that takes. Rendering happens immediately and the app's first
 * Firestore read waits on this instead (IdentityContext), which is the ordering
 * that actually matters.
 *
 * Failures never block anything; the worst case is a tab that falls back to a
 * memory-only cache.
 */
async function run(): Promise<void> {
    // Already memory-only, so there is nothing on disk to reconcile.
    if (isCacheDisabledForTab()) return

    try {
        // Resolves once Firebase has restored (or ruled out) a persisted session.
        // Bounded because a hung auth layer must not leave a blank page behind.
        await Promise.race([
            auth.authStateReady(),
            new Promise<void>(resolve => setTimeout(resolve, 5000)),
        ])
    } catch {
        return
    }

    const uid = auth.currentUser?.uid
    if (!uid) return

    const owner = getCacheOwner()
    if (owner === uid) return

    if (owner === null) {
        setCacheOwner(uid)
        return
    }

    // A different account's documents are on disk. Firestore does not apply
    // security rules to the cache, so they have to go before this user reads
    // anything.
    try {
        await clearIndexedDbPersistence(db)
        setCacheOwner(uid)
    } catch (error) {
        // Another tab is holding the database open. We cannot clear their cache
        // and must not read it, so this tab drops to memory-only -- which is
        // decided in src/firebase.ts at import time, hence the reload. The flag
        // is checked at the top of this function, so the reload cannot loop.
        console.warn('Could not clear the Firestore cache; using a memory-only cache', error)
        disableCacheForTab()
        window.location.reload()
    }
}

let reconciliation: Promise<void> | null = null

/**
 * Kicks off the reconciliation. Idempotent, and returns the same promise every
 * time so callers cannot start a second pass.
 */
export function startFirestoreCacheReconciliation(): Promise<void> {
    reconciliation ??= run()
    return reconciliation
}

/**
 * Resolves once the cache has been reconciled with the signed-in account.
 *
 * Await this before the first Firestore read. Resolves immediately if the
 * reconciliation was never started, so nothing can deadlock on it.
 */
export function firestoreCacheReady(): Promise<void> {
    return reconciliation ?? Promise.resolve()
}
