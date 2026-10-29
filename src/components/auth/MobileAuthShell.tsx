import React from 'react'
import { ConfigProvider } from 'antd'
import { ArrowLeftOutlined } from '@ant-design/icons'
import { ThemeToggle } from '@/components/layout/theme-toggle'
import { PoweredByQuantilytix } from '@/components/brand/PoweredByQuantilytix'
import { useAuthBrandTheme } from './authBrandTheme'
import './MobileAuthShell.css'

interface MobileAuthShellProps {
    title: string
    subtitle: string
    onBack: () => void
    /** The form (and anything else between the heading and the footer). */
    children: React.ReactNode
    /** The line above the brand lockup, e.g. "Don't have an account? Sign up". */
    footer: React.ReactNode
}

/**
 * Phone chrome shared by sign-in and registration — the phone edition of
 * AuthShell: the same crimson-tinted photo as the desktop panel across the
 * top, with back and colour-mode controls floating on it, and the form on a
 * sheet that rises over the photo. Same warm palette, typeface and accent as
 * the landing page and the desktop screens.
 */
const MobileAuthShell: React.FC<MobileAuthShellProps> = ({
    title,
    subtitle,
    onBack,
    children,
    footer
}) => {
    const brandTheme = useAuthBrandTheme()

    return (
        <ConfigProvider theme={brandTheme}>
            <div className='ml-page'>
                <header className='ml-hero'>
                    <div className='ml-hero-photo' aria-hidden='true' />
                    <div className='ml-topbar'>
                        <button
                            type='button'
                            className='ml-circle'
                            aria-label='Back to home'
                            onClick={onBack}
                        >
                            <ArrowLeftOutlined />
                        </button>
                        <div className='ml-circle'>
                            <ThemeToggle compact />
                        </div>
                    </div>
                    <img className='ml-logo' src='/assets/images/lepharo.png' alt='Lepharo' />
                </header>

                <main className='ml-sheet'>
                    <h1 className='ml-title ml-rise'>{title}</h1>
                    <p className='ml-subtitle ml-rise' style={{ animationDelay: '50ms' }}>
                        {subtitle}
                    </p>

                    {children}

                    <footer className='ml-footer'>
                        <p>{footer}</p>
                        <PoweredByQuantilytix />
                    </footer>
                </main>
            </div>
        </ConfigProvider>
    )
}

export default MobileAuthShell
