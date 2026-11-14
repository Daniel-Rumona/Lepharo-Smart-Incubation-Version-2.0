import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db, functions } from '@/firebase'
import { sastDate, type Brief } from '../../functions/src/dailyBriefLogic'

// Daily digest (functions/src/dailyBrief.ts): one morning brief instead of the scheduled
// reminder emails. The brief is stored per person per day; digest mode is a setting on
// the person's own users/ record.

export type { Brief }

/** Today's stored brief, if the morning run made one. */
export async function getTodaysBrief(uid: string): Promise<Brief | null> {
    const snapshot = await getDoc(doc(db, 'dailyBriefs', `${uid}__${sastDate()}`))
    return snapshot.exists() ? (snapshot.data() as Brief) : null
}

/** Builds the brief now from what is waiting (nothing is emailed or cleared). */
export async function buildMyBrief(): Promise<Brief> {
    const { data } = await httpsCallable<Record<string, never>, Brief>(functions, 'buildMyDailyBrief')({})
    return data
}

export async function setDailyDigest(uid: string, enabled: boolean) {
    await setDoc(doc(db, 'users', uid), { dailyDigest: { enabled, updatedAt: serverTimestamp() } }, { merge: true })
}
