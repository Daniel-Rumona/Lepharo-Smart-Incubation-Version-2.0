import { doc, getDoc } from 'firebase/firestore'
import { db } from '@/firebase'
import type { Signature } from './ipm'

/** The signed-in user's signature for a sign-off, with their saved signature image if they have one. */
export async function signatureFor(user: { id: string; name: string }): Promise<Signature> {
    const profile = await getDoc(doc(db, 'users', user.id)).catch(() => null)
    return { uid: user.id, name: user.name, at: new Date().toISOString(), signatureURL: profile?.data()?.signatureURL || null }
}

/** Firestore rejects undefined; drop it everywhere. */
export const clean = <T,>(value: T): T => JSON.parse(JSON.stringify(value))

export const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
