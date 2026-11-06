import React, { Suspense } from 'react'
import { useColorMode } from '@/contexts/ThemeContext'
import { Layout, theme } from 'antd'
import {
    AppstoreOutlined,
    BarChartOutlined,
    UserOutlined,
    FileTextOutlined
} from '@ant-design/icons'
import { useNavigate, useLocation, Outlet } from 'react-router-dom'
import { useWindowSize } from 'react-use'
import { HelpAssistant } from './shared/HelpAssistant'
import { ViewAsControls } from '@/components/view-as/ViewAsControls'
import { CurrentUser } from '@/components/layout/current-user'
import { NotificationBell } from '@/components/layout/notifications/NotificationBell'
import { signOutApp } from '@/lib/firestoreCache'

// The applicant portal shares the workspace shell styling with
// components/layout, so both halves of the product read as one system.
import '@/components/layout/layout.css'
import { RouteFallback } from '@/components/layout/RouteFallback'

const { Content } = Layout

type ApplicantDestination = {
    key: string
    route: string
    label: string
    icon: React.ReactNode
    guideTargetId: string
}

const APPLICANT_DESTINATIONS: ApplicantDestination[] = [
    {
        key: 'profile',
        route: '/applicant/profile',
        label: 'My Profile',
        icon: <UserOutlined />,
        guideTargetId: 'nav-profile'
    },
    {
        key: 'tracker',
        route: '/applicant/tracker',
        label: 'Tracker',
        icon: <AppstoreOutlined />,
        guideTargetId: 'nav-tracker'
    },
    {
        key: 'applications',
        route: '/applicant',
        label: 'Applications',
        icon: <BarChartOutlined />,
        guideTargetId: 'nav-apply'
    },
    {
        key: 'inquiries',
        route: '/applicant/inquiries',
        label: 'Inquiries',
        icon: <FileTextOutlined />,
        guideTargetId: 'nav-inquiries'
    }
]

const ApplicantLayout: React.FC = () => {
    const navigate = useNavigate()
    const location = useLocation()

    // Same breakpoints the staff workspace shell uses.
    const { width } = useWindowSize()
    const isMobile = width < 768
    const isCompactHeader = width < 1180

    // The inquiry wizard runs as its own full-bleed page on mobile (not a
    // modal) — it owns its own back button, title and step progress, so the
    // shell's topbar and bottom nav would just be redundant chrome eating
    // into the same screen a multi-step form badly needs.
    const isImmersiveMobilePage =
        isMobile && location.pathname === '/applicant/submit-inquiry'

    const selectedKey = location.pathname.includes('/tracker')
        ? 'tracker'
        : location.pathname.includes('/profile')
            ? 'profile'
            : location.pathname.includes('/inquiries')
                ? 'inquiries'
                : 'applications'

    const activeSegment =
        APPLICANT_DESTINATIONS.find(d => d.key === selectedKey)?.route || '/applicant'

    const handleLogout = async () => {
        // Clears the cached Firestore documents too, and hard-navigates, so nothing
        // of this account is left behind for the next person on the machine.
        await signOutApp('/')
    }

    const { token } = theme.useToken()
    const { isDark } = useColorMode()
    // Light mode keeps the literal #fff; on dark the page plane comes from the
    // theme token. Same split as components/layout.
    const pageBg = isDark ? token.colorBgLayout : '#fff'

    return (
        <Layout
            className='workspace-shell'
            // The shell owns the viewport height so pages can just flex to fill
            // it — same as components/layout.
            style={{ minHeight: '100vh', background: pageBg }}
        >
            {!isImmersiveMobilePage && (
                <div className='workspace-header-wrap'>
                    <header
                        className={`workspace-topbar ${isMobile
                            ? 'workspace-topbar-mobile workspace-topbar-nonav'
                            : ''
                            }`}
                    >
                        <button
                            type='button'
                            className='workspace-brand'
                            onClick={() => navigate('/applicant')}
                            aria-label='Go to applications'
                        >
                            <img src='/assets/images/lepharo.png' alt='Lepharo' />
                        </button>

                        {/* On mobile this moves to the bottom bar below. */}
                        {!isMobile && (
                            <div
                                className='workspace-primary-nav'
                                aria-label='Primary navigation'
                                role='tablist'
                            >
                                {APPLICANT_DESTINATIONS.map(destination => (
                                    <button
                                        key={destination.route}
                                        type='button'
                                        role='tab'
                                        data-guide={destination.guideTargetId}
                                        aria-selected={activeSegment === destination.route}
                                        className={`workspace-primary-segment ${activeSegment === destination.route
                                            ? 'workspace-primary-segment-active'
                                            : ''
                                            }`}
                                        onClick={() => navigate(destination.route)}
                                    >
                                        <span className='workspace-segment-icon'>
                                            {destination.icon}
                                        </span>
                                        <span>{destination.label}</span>
                                    </button>
                                ))}
                            </div>
                        )}

                        <div className='workspace-topbar-actions'>
                            {/* Same actions as the workspace top bar: the guide,
                                appearance and log out live in the account menu. */}
                            <ViewAsControls compact={isCompactHeader} />
                            <NotificationBell />
                            <CurrentUser onLogout={handleLogout} />
                        </div>
                    </header>
                </div>
            )}

            <Content
                style={{
                    background: pageBg,
                    flex: '1 1 auto',
                    minHeight: 0,
                    // Clears the fixed bottom nav so the last row of a page is
                    // never trapped underneath it. Not needed when that nav
                    // is itself hidden for the immersive inquiry page.
                    paddingBottom: isMobile && !isImmersiveMobilePage
                        ? 'calc(84px + env(safe-area-inset-bottom))'
                        : 0,
                    display: 'flex',
                    flexDirection: 'column'
                }}
            >
                <div
                    style={{
                        background: pageBg,
                        flex: '1 1 auto',
                        minHeight: 0,
                        width: '100%',

                        // Important: lets the routed page itself stretch.
                        display: 'flex',
                        flexDirection: 'column',

                        boxShadow: 'none'
                    }}
                >
                    <Suspense fallback={<RouteFallback />}>
                        <Outlet />
                    </Suspense>
                </div>
            </Content>

            {/* ---- Mobile bottom navigation ---- */}
            {isMobile && !isImmersiveMobilePage && (
                <nav className='workspace-bottom-nav' aria-label='Primary navigation'>
                    {APPLICANT_DESTINATIONS.map(destination => {
                        const isActive = activeSegment === destination.route

                        return (
                            <button
                                key={destination.route}
                                type='button'
                                data-guide={destination.guideTargetId}
                                aria-current={isActive ? 'page' : undefined}
                                aria-label={destination.label}
                                className={`workspace-bottom-nav-item ${isActive ? 'workspace-bottom-nav-item-active' : ''
                                    }`}
                                onClick={() => navigate(destination.route)}
                            >
                                <span className='workspace-bottom-nav-icon'>
                                    {destination.icon}
                                </span>
                                <span className='workspace-bottom-nav-label'>
                                    {destination.label}
                                </span>
                            </button>
                        )
                    })}
                </nav>
            )}

            {/* The wizard already has its own bottom action bar — the FAB
                would float right on top of it with nowhere clear to sit. */}
            {!isImmersiveMobilePage && <HelpAssistant />}
        </Layout>
    )
}

export default ApplicantLayout
