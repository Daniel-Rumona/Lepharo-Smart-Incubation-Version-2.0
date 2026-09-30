import { DashboardLoader } from './DashboardLoader'

/**
 * Shown while a route's code chunk is fetched.
 *
 * Routes are code-split (see the lazy declarations in src/App.tsx), so there is
 * a brief gap on first visit to each screen. Uses the same loader as the
 * dashboard switcher so the hand-off between them is visually seamless.
 *
 * Rendered inside the layouts, around their <Outlet />, so the sidebar and
 * header stay put and only the content area waits.
 */
export const RouteFallback = () => <DashboardLoader />

export default RouteFallback
