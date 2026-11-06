// The pages the signed-in user can reach from their own navigation. The layout
// publishes its role-filtered menu here, and the assistant sends it with every
// request: the AI backend may only send the user to a route copied verbatim
// from this list (see ai-backend `_sanitize_show_me`).
export type NavDestination = {
    route: string
    label: string
    section: string | null
}

let destinations: NavDestination[] = []

export const setNavDestinations = (next: NavDestination[]) => {
    const seen = new Set<string>()
    destinations = next.filter(item => {
        if (!item.route || seen.has(item.route) || item.route === '/chat') return false
        seen.add(item.route)
        return true
    })
}

export const getNavDestinations = (): NavDestination[] => destinations
