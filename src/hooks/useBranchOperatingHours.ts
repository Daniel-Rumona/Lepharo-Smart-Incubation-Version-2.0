import { useEffect, useState } from 'react'
import { doc, onSnapshot } from 'firebase/firestore'
import { db } from '@/firebase'
import { getUserBranchId } from '@/services/attendanceCenters'
import { BranchOperatingHours, defaultOperatingHours, validateOperatingHours } from '@/utils/branchOperatingHours'

const defaults = defaultOperatingHours()

// Resolve hours independently of GPS/attendance-center configuration and programme filters.
export const useBranchOperatingHours = (user: any, identityLoading: boolean) => {
  const branchId = getUserBranchId(user)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{
    branchId: string; hours: BranchOperatingHours; name: string; configured: boolean; error: string | null
  } | null>(null)

  useEffect(() => {
    setState(null)
    if (identityLoading || !user?.uid || !branchId) return
    return onSnapshot(doc(db, 'branches', branchId), snapshot => {
      try {
        if (!snapshot.exists()) throw new Error('Your assigned branch could not be found.')
        const branch = snapshot.data()
        const hours = branch.operatingHours ?? defaults
        validateOperatingHours(hours)
        setState({ branchId, hours, name: branch.name || '', configured: !!branch.operatingHours, error: null })
      } catch (error) {
        setState({ branchId, hours: defaults, name: '', configured: false,
          error: error instanceof Error ? error.message : 'Invalid branch operating hours.' })
      }
    }, () => setState({ branchId, hours: defaults, name: '', configured: false,
      error: 'Could not load branch operating hours. Retry before recording attendance.' }))
  }, [branchId, user?.uid, identityLoading, attempt])

  const current = state?.branchId === branchId ? state : null
  return {
    branchId,
    hours: current?.hours || defaults,
    branchName: current?.name || '',
    configured: current?.configured || false,
    loading: identityLoading || (!!user?.uid && !!branchId && !current),
    error: current?.error || null,
    retry: () => setAttempt(value => value + 1)
  }
}
