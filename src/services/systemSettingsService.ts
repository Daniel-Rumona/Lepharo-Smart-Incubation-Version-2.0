import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc
} from 'firebase/firestore'
import { db } from '@/firebase'

export const DEFAULT_PROGRAM_LIMIT = 3

const programSettingsRef = () =>
  doc(db, 'system_settings', 'programs')

export async function getProgramLimit(): Promise<number> {
  const snapshot = await getDoc(programSettingsRef())

  const value = Number(
    snapshot.data()?.programLimit
  )

  return Number.isInteger(value) && value > 0
    ? value
    : DEFAULT_PROGRAM_LIMIT
}

export async function saveProgramLimit(
  programLimit: number
) {
  await setDoc(
    programSettingsRef(),
    {
      type: 'programs',
      programLimit,
      updatedAt: serverTimestamp()
    },
    {
      merge: true
    }
  )
}
