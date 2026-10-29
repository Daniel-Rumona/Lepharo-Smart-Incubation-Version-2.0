import { useEffect, useState } from 'react'

// md breakpoint (768px), the same cut-off the auth screens already use.
const MOBILE_QUERY = '(max-width: 767px)'

/** True below 768px. Reads the media query synchronously so the first render is already right. */
export const useIsMobile = (): boolean => {
    const [mobile, setMobile] = useState(
        () => typeof window !== 'undefined' && window.matchMedia(MOBILE_QUERY).matches
    )

    useEffect(() => {
        const query = window.matchMedia(MOBILE_QUERY)
        const sync = () => setMobile(query.matches)
        sync()
        query.addEventListener('change', sync)
        return () => query.removeEventListener('change', sync)
    }, [])

    return mobile
}

export default useIsMobile
