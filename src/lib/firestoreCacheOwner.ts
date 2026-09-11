/**
 * Tracks which account the on-disk Firestore cache belongs to.
 *
 * Firestore's persistent cache is one IndexedDB database per origin, and
 * security rules are *not* evaluated against it -- a document that reached the
 * cache under one account is readable by whoever is signed in next. Auth here is
 * per-tab (see src/firebase.ts), so "whoever is signed in next" can be a
 * different person on a shared machine, or another tab entirely.
 *
 * These helpers record the owning uid so src/lib/firestoreCache.ts can wipe the
 * cache before a different account ever reads from it.
 *
 * Deliberately free of Firebase imports: src/firebase.ts consults the per-tab
 * flag while deciding which cache to initialise, and must not import a module
 * that imports it back.
 */

/** Shared across tabs on purpose -- the cache it guards is shared too. */
const OWNER_KEY = 'lph-firestore-cache-owner'

/** Per-tab. Set when this tab has to fall back to a memory-only cache. */
const DISABLED_KEY = 'lph-firestore-cache-disabled'

// Storage throws outright in some private-browsing modes, so every access is
// guarded and a failure degrades to "no cache ownership recorded".
const read = (storage: Storage, key: string): string | null => {
    try {
        return storage.getItem(key)
    } catch {
        return null
    }
}

const write = (storage: Storage, key: string, value: string | null) => {
    try {
        if (value === null) storage.removeItem(key)
        else storage.setItem(key, value)
    } catch {
        /* nothing to do -- the guard degrades to memory-only behaviour */
    }
}

export const getCacheOwner = (): string | null =>
    typeof window === 'undefined' ? null : read(window.localStorage, OWNER_KEY)

export const setCacheOwner = (uid: string): void => {
    if (typeof window !== 'undefined') write(window.localStorage, OWNER_KEY, uid)
}

export const clearCacheOwner = (): void => {
    if (typeof window !== 'undefined') write(window.localStorage, OWNER_KEY, null)
}

/**
 * True when this tab must not use the on-disk cache -- another tab is signed in
 * as someone else and is holding the shared cache open, so it cannot be wiped.
 */
export const isCacheDisabledForTab = (): boolean =>
    typeof window !== 'undefined' && read(window.sessionStorage, DISABLED_KEY) === 'true'

export const disableCacheForTab = (): void => {
    if (typeof window !== 'undefined') write(window.sessionStorage, DISABLED_KEY, 'true')
}

