import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { onAuthStateChanged, signOut } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from '@/firebase'
import { cacheBelongsToAnotherAccount } from '@/lib/firestoreCache'
import { firestoreCacheReady } from '@/lib/firestoreCacheBoot'
import { clearActivity, isSessionStale } from '@/utils/idleSession'

export type AppIdentity = Record<string, any> & {
    id: string
    uid: string
    email: string
    name: string
    role: string
}

type IdentityContextValue = {
    user: AppIdentity | null
    actor: AppIdentity | null
    loading: boolean
    canViewAs: boolean
    isViewingAs: boolean
    viewedUser: AppIdentity | null
    startViewingAs: (profile: AppIdentity) => void
    stopViewingAs: () => void
}

const VIEW_AS_STORAGE_KEY = 'developerViewAsUser'
const VIEW_AS_ROLES = new Set(['admin', 'system_admin'])
const IdentityContext = createContext<IdentityContextValue | null>(null)

const normalizeRole = (value: unknown) =>
    String(value || '').trim().toLowerCase().replace(/\s+/g, '_')

const makeIdentity = (
    uid: string,
    authEmail: string | null | undefined,
    displayName: string | null | undefined,
    profile: Record<string, any>
): AppIdentity => ({
    ...profile,
    id: uid,
    uid,
    email: String(profile.email || authEmail || '').trim(),
    name: String(profile.name || profile.fullName || displayName || 'Unknown User'),
    role: normalizeRole(profile.role || 'guest'),
    phone: profile.phone || ''
})

const readStoredView = (): AppIdentity | null => {
    try {
        const raw = sessionStorage.getItem(VIEW_AS_STORAGE_KEY)
        return raw ? JSON.parse(raw) as AppIdentity : null
    } catch {
        sessionStorage.removeItem(VIEW_AS_STORAGE_KEY)
        return null
    }
}

export const IdentityProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
    const [actor, setActor] = useState<AppIdentity | null>(null)
    const [viewedUser, setViewedUser] = useState<AppIdentity | null>(null)
    const [loading, setLoading] = useState(true)

    useEffect(() => onAuthStateChanged(auth, async currentUser => {
        setLoading(true)
        if (!currentUser) {
            setActor(null)
            setViewedUser(null)
            sessionStorage.removeItem(VIEW_AS_STORAGE_KEY)
            setLoading(false)
            return
        }

        // Sessions now survive the app being closed, so the app may be opening
        // onto one that has sat untouched for weeks. Catch that here, before any
        // data loads -- the in-app idle timer cannot, because it died with the
        // tab that set it.
        if (isSessionStale()) {
            clearActivity()
            await signOut(auth)
            return
        }

        // Backstop for an account change that happens without a page load -- one
        // user signing out and another in while the tab stays up. The clearing
        // itself belongs to the boot reconciliation, which can do it
        // without terminating the client; all this does is get us back there.
        //
        // Reloading the current URL, never a fixed path: sending people to "/"
        // drops them on the public landing page and makes them sign in twice.
        if (cacheBelongsToAnotherAccount(currentUser.uid)) {
            window.location.reload()
            return
        }

        // The cache reconciliation has to finish before anything reads Firestore,
        // because clearing it is only possible while the client is still idle.
        // Waiting here rather than before first paint keeps the app rendering
        // immediately while still ordering these two correctly.
        await firestoreCacheReady()

        try {
            const snapshot = await getDoc(doc(db, 'users', currentUser.uid))
            const profile = snapshot.exists() ? snapshot.data() : {}
            const realIdentity = makeIdentity(
                currentUser.uid,
                currentUser.email,
                currentUser.displayName,
                profile
            )
            setActor(realIdentity)
            if (VIEW_AS_ROLES.has(realIdentity.role)) {
                setViewedUser(readStoredView())
            } else {
                setViewedUser(null)
                sessionStorage.removeItem(VIEW_AS_STORAGE_KEY)
            }
        } catch (error) {
            console.error('[IdentityProvider] Failed to load signed-in identity:', error)
            setActor(null)
            setViewedUser(null)
        } finally {
            setLoading(false)
        }
    }), [])

    const canViewAs = !!actor && VIEW_AS_ROLES.has(actor.role)
    const startViewingAs = useCallback((profile: AppIdentity) => {
        if (!canViewAs) return
        const normalized = makeIdentity(String(profile.uid || profile.id), profile.email, profile.name, profile)
        sessionStorage.setItem(VIEW_AS_STORAGE_KEY, JSON.stringify(normalized))
        setViewedUser(normalized)
    }, [canViewAs])
    const stopViewingAs = useCallback(() => {
        sessionStorage.removeItem(VIEW_AS_STORAGE_KEY)
        setViewedUser(null)
    }, [])

    const value = useMemo<IdentityContextValue>(() => ({
        user: viewedUser || actor,
        actor,
        loading,
        canViewAs,
        isViewingAs: !!viewedUser,
        viewedUser,
        startViewingAs,
        stopViewingAs
    }), [actor, canViewAs, loading, startViewingAs, stopViewingAs, viewedUser])

    return <IdentityContext.Provider value={value}>{children}</IdentityContext.Provider>
}

export const useIdentity = () => {
    const value = useContext(IdentityContext)
    if (!value) throw new Error('useIdentity must be used inside IdentityProvider')
    return value
}
