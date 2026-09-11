import { useEffect, useMemo, useState } from 'react'

export type ActiveProgramValue = string | 'all'

export function useActiveProgramId() {
  const [programId, setProgramId] = useState<ActiveProgramValue>(() => {
    if (typeof window === 'undefined') return 'all'
    const current = (window as any).__ACTIVE_PROGRAM_ID__ as
      | ActiveProgramValue
      | undefined
    return current ?? 'all'
  })

  useEffect(() => {
    if (typeof window === 'undefined') return

    const current = (window as any).__ACTIVE_PROGRAM_ID__ as
      | ActiveProgramValue
      | undefined

    setProgramId(current ?? 'all')

    const onChange = (e: Event) => {
      const ce = e as CustomEvent<{ programId?: ActiveProgramValue }>
      setProgramId(ce.detail?.programId ?? 'all')
    }

    window.addEventListener('program-filter-changed', onChange)

    return () => {
      window.removeEventListener('program-filter-changed', onChange)
    }
  }, [])

  const isAllPrograms = programId === 'all'

  const activeProgramId = useMemo(() => {
    return isAllPrograms ? undefined : programId
  }, [isAllPrograms, programId])

  return {
    // NEW SYSTEM
    programId,          // string | 'all'
    isAllPrograms,      // boolean

    // LEGACY SUPPORT
    activeProgramId,    // string | undefined

    // CRITICAL: allows old usage to still work
    value: activeProgramId
  }
}
