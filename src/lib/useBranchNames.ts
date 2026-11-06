import { useEffect, useState } from 'react'
import { collection, getDocs } from 'firebase/firestore'
import { db } from '@/firebase'

// Branch id → name. Internal purchase requests only store the requesting
// branch's id (`requestedFrom`), so screens use this to show its name.
export const useBranchNames = () => {
  const [names, setNames] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false
    getDocs(collection(db, 'branches'))
      .then(snap => {
        if (cancelled) return
        setNames(
          Object.fromEntries(
            snap.docs.map(d => [d.id, String(d.data().name || '').trim()]).filter(([, n]) => n)
          )
        )
      })
      .catch(error => console.error('Failed to load branch names:', error))
    return () => {
      cancelled = true
    }
  }, [])

  return names
}
