import React from 'react'
import { WhatsAppOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { WhatsAppConsentCard } from '@/components/modals/WhatsAppConsentCard'
import { SNOOZE_KEY } from '@/services/whatsappConsentPrompt'
import { ThemeToggle } from '@/components/layout/theme-toggle'
import { PoweredByQuantilytix } from '@/components/brand/PoweredByQuantilytix'
import './whatsapp-consent.css'

/**
 * A single question for SMEs who signed up before WhatsApp updates existed.
 * Not the whole Welcome wizard: it appears once, at their next login, and goes
 * away as soon as they answer. "Decide later" hides it for the rest of the session.
 *
 * The SME is already signed in here, so the page follows their own colour mode
 * and accent (the app-level antd theme and the --app-* tokens), not the fixed
 * brand crimson of the sign-in screen.
 */
const WhatsAppConsentPage: React.FC = () => {
    const navigate = useNavigate()
    const { user } = useFullIdentity()

    // On to the plan review (then the dashboard), which is where the login
    // router sends an incubatee with nothing left to answer. Going back through /login instead
    // finds them already signed in and stops on its "Welcome back" pick-up
    // modal, which reads as having been signed out.
    const carryOn = () => navigate('/plan-review', { replace: true })

    return (
        <div className='wc'>
            <div className='wc-bg' aria-hidden='true'>
                <span className='wc-glow wc-glow-a' />
                <span className='wc-glow wc-glow-b' />
            </div>

            <header className='wc-top'>
                <img className='wc-logo' src='/assets/images/lepharo.png' alt='Lepharo' />
                <ThemeToggle />
            </header>

            <main className='wc-main'>
                <section className='wc-card' aria-labelledby='wc-title'>
                    <span className='wc-badge' aria-hidden='true'>
                        <WhatsAppOutlined />
                    </span>
                    <h1 id='wc-title' className='wc-title'>Updates on WhatsApp</h1>
                    {user?.uid ? (
                        <WhatsAppConsentCard
                            userId={user.uid}
                            initialNumber={String(user.phone || user.phoneNumber || '')}
                            source="login-prompt"
                            onAnswered={carryOn}
                            onLater={() => {
                                try { sessionStorage.setItem(SNOOZE_KEY, '1') } catch { /* private mode: asked again next time */ }
                                carryOn()
                            }}
                        />
                    ) : null}
                </section>
            </main>

            <footer className='wc-foot'>
                <span>© {new Date().getFullYear()} Lepharo Smart Incubation</span>
                <PoweredByQuantilytix />
            </footer>
        </div>
    )
}

export default WhatsAppConsentPage
