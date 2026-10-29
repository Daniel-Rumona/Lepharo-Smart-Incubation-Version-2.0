import React from 'react'
import { ConfigProvider } from 'antd'
import { ArrowLeftOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { ThemeToggle } from '@/components/layout/theme-toggle'
import { useAuthBrandTheme } from './authBrandTheme'
import { PoweredByQuantilytix } from '@/components/brand/PoweredByQuantilytix'
import { TickMark } from '@/components/brand/TickMark'
import './AuthShell.css'

/**
 * What the platform actually does, kept in step with the role menus in
 * components/layout/index.tsx — the same rule as the landing page's role card.
 */
const FEATURES = [
    {
        title: 'Development plans & interventions',
        text: 'Built from a GAP analysis and tracked through to completion.'
    },
    {
        title: 'Evidence in one place',
        text: 'MOVs, compliance documents and appointments, all on record.'
    },
    {
        title: 'Progress & impact reporting',
        text: 'KPIs and outcomes for every programme, ready to share.'
    }
]

/**
 * Desktop frame shared by sign-in and registration: top bar (back + colour
 * mode), the brand photo panel, the form column and the footer. Each page
 * supplies only its form, so the two stay visual twins — including the card
 * flip between them, which the pages drive inside `children`.
 *
 * A nested ConfigProvider puts the antd controls inside on the brand crimson,
 * the landing page's typeface and softer corners, so the form needs no inline
 * colours (which the global dark-mode layer would otherwise have to rewrite).
 */
export const AuthShell: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const navigate = useNavigate()
    const brandTheme = useAuthBrandTheme()

    return (
        <ConfigProvider theme={brandTheme}>
            <div className='as'>
                <div className='as-bg' aria-hidden='true'>
                    <span className='as-glow as-glow-a' />
                    <span className='as-glow as-glow-b' />
                </div>

                <header className='as-top'>
                    <button type='button' className='as-back' onClick={() => navigate('/')}>
                        <ArrowLeftOutlined />
                        Back to home
                    </button>
                    {/* The only colour-mode control reachable before sign-in. */}
                    <ThemeToggle />
                </header>

                <main className='as-main'>
                    <div className='as-card'>
                        <aside className='as-panel' aria-label='About the platform'>
                            <div className='as-panel-photo' aria-hidden='true' />
                            <img className='as-panel-logo' src='/assets/images/lepharo.png' alt='Lepharo' />
                            <div>
                                <ul className='as-panel-list'>
                                    {FEATURES.map(feature => (
                                        <li key={feature.title}>
                                            <span className='as-panel-check' aria-hidden='true'>
                                                <TickMark />
                                            </span>
                                            <div>
                                                <strong>{feature.title}</strong>
                                                <span>{feature.text}</span>
                                            </div>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </aside>

                        <section className='as-form'>{children}</section>
                    </div>
                </main>

                <footer className='as-foot'>
                    <span>© {new Date().getFullYear()} Lepharo Smart Incubation</span>
                    <PoweredByQuantilytix />
                </footer>
            </div>
        </ConfigProvider>
    )
}

export default AuthShell
