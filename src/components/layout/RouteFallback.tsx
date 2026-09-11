import { Spin } from 'antd'

/**
 * Shown while a route's code chunk is fetched.
 *
 * Routes are code-split (see the lazy declarations in src/App.tsx), so there is
 * a brief gap on first visit to each screen. Deliberately plain: it must not
 * pull in anything heavy, or it would defeat the splitting it exists to cover.
 *
 * Rendered inside the layouts, around their <Outlet />, so the sidebar and
 * header stay put and only the content area waits.
 */
export const RouteFallback = () => (
    <div
        style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            // Tall enough to hold the content area open, so the surrounding
            // layout does not collapse and reflow when the chunk arrives.
            minHeight: 320,
            width: '100%',
        }}
    >
        <Spin size="large" />
    </div>
)

export default RouteFallback
