import React, { useEffect, useState, Suspense } from 'react'
import { useColorMode } from '@/contexts/ThemeContext'
import { Layout, Avatar, message, Button, Tooltip, theme } from 'antd'
import {
    AppstoreOutlined,
    BarChartOutlined,
    UserOutlined,
    FileTextOutlined,
    LogoutOutlined
} from '@ant-design/icons'
import { useNavigate, useLocation, Outlet } from 'react-router-dom'
import { useWindowSize } from 'react-use'
import { db } from '@/firebase'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
import { useFullIdentity } from '@/hooks/src/useFullIdentity'
import { HelpAssistant } from './shared/HelpAssistant'
import { ViewAsControls } from '@/components/view-as/ViewAsControls'
import { ThemeToggle } from '@/components/layout/theme-toggle'
import { GuideLauncher } from '@/components/guide-me'
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

const PROFILE_ROUTE = '/applicant/profile'

const ApplicantLayout: React.FC = () => {
    const navigate = useNavigate()
    const location = useLocation()

    // Same breakpoints the staff workspace shell uses.
    const { width } = useWindowSize()
    const isMobile = width < 768
    const isCompactHeader = width < 1180

    const [logoUrl, setLogoUrl] = useState<string | null>(null)
    const [displayName, setDisplayName] = useState<string>('')
    const { user, loading: identityLoading } = useFullIdentity()

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

    // --------- participant subscription (guarded by identityLoading) ----------
    // Only reads what the header shows: the participant photo and their name.
    // Editing both lives on the profile page — this listens so a photo uploaded
    // there appears in the header without a reload.
    useEffect(() => {
        if (identityLoading) return
        if (!user?.email) return // not signed in

        const q = query(
            collection(db, 'participants'),
            where('email', '==', user.email)
        )

        const unsubscribe = onSnapshot(
            q,
            snapshot => {
                if (!snapshot.empty) {
                    const data = snapshot.docs[0].data() as any
                    setLogoUrl((data.logoUrl as string) || (user as any).photoURL || null)
                    setDisplayName(
                        (data.name as string) ||
                        (data.participantName as string) ||
                        (user as any).displayName ||
                        ''
                    )
                } else {
                    setLogoUrl((user as any).photoURL || null)
                    setDisplayName((user as any).displayName || '')
                }
            },
            err => {
                console.error(err)
                message.error('Failed to load profile.')
            }
        )

        return () => unsubscribe()
    }, [identityLoading, user?.email])

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
                            <GuideLauncher
                                label={isCompactHeader ? '' : 'Guide'}
                                buttonProps={{
                                    type: 'text',
                                    shape: 'round',
                                    style: {
                                        height: 32,
                                        paddingInline: isCompactHeader ? 10 : 14,
                                        flex: '0 0 auto'
                                    },
                                    'aria-label': 'Guide'
                                }}
                            />
                            <ViewAsControls compact={isCompactHeader} />
                            <ThemeToggle compact={isCompactHeader} />

                            <Tooltip title={displayName ? `${displayName} — my profile` : 'My profile'}>
                                <Avatar
                                    className='workspace-current-user-avatar'
                                    size='default'
                                    src={logoUrl || undefined}
                                    icon={!logoUrl ? <UserOutlined /> : undefined}
                                    onClick={() => navigate(PROFILE_ROUTE)}
                                    style={{ cursor: 'pointer', fontWeight: 700, flex: '0 0 auto' }}
                                />
                            </Tooltip>

                            <Tooltip title='Log out'>
                                <Button
                                    type='text'
                                    danger
                                    shape='circle'
                                    className='workspace-logout-button'
                                    icon={<LogoutOutlined />}
                                    onClick={handleLogout}
                                    aria-label='Log out'
                                />
                            </Tooltip>
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
