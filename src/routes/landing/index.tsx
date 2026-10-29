import React, { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Helmet } from 'react-helmet'
import {
    ApartmentOutlined,
    AppstoreOutlined,
    ArrowRightOutlined,
    BarChartOutlined,
    BankOutlined,
    LineChartOutlined,
    PieChartOutlined,
    RocketOutlined,
    SearchOutlined,
    SolutionOutlined,
    TeamOutlined
} from '@ant-design/icons'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import './LandingPage.css'
import { ThemeToggle } from '@/components/layout/theme-toggle'
import { useIsMobile } from '@/hooks/useIsMobile'
import { PoweredByQuantilytix } from '@/components/brand/PoweredByQuantilytix'
import { TickMark } from '@/components/brand/TickMark'

// Perks and steps describe what each role's workspace actually contains
// (see the per-role menus in components/layout/index.tsx) — keep them in step
// with it rather than with marketing copy.
const roleSlides = [
    {
        key: 'sme',
        label: 'SMMEs',
        title: 'Startups | SMMEs | Cooperatives',
        image: '/assets/images/projects/1.jpg',
        icon: <RocketOutlined />,
        description: 'Your development plan and support, all in one place.',
        perks: [
            'Development plan & intervention tracker',
            'Appointments, calendar & notices',
            'Courses, library & compliance docs'
        ]
    },
    {
        key: 'incubate',
        label: 'Implementors',
        title: 'Incubation | ESD Implementors',
        image: '/assets/images/projects/4.jpg',
        icon: <TeamOutlined />,
        description: 'Run programmes from intake to impact reporting.',
        perks: [
            'Applications, onboarding & GAP analysis',
            'Intervention assignments & MOV checks',
            'KPIs, compliance & impact reports'
        ]
    },
    {
        key: 'investor',
        label: 'Funders',
        title: 'Investors | Funders | Capital Partners',
        image: '/assets/images/projects/5.jpg',
        icon: <BankOutlined />,
        description: 'See who your programmes reach and how they progress.',
        perks: [
            'Incubatees by sector & progress',
            'Applications submitted vs accepted',
            'Ownership, B-BBEE & locality insights'
        ]
    }
]

// "How it works", per role — follows whichever role the explorer has selected.
const stepsByRole: Record<string, { icon: React.ReactNode; title: string; text: string }[]> = {
    sme: [
        {
            icon: <SolutionOutlined />,
            title: 'Register & apply',
            text: 'Create a profile and apply to the programmes that fit your business.'
        },
        {
            icon: <AppstoreOutlined />,
            title: 'Get your plan',
            text: 'A GAP analysis shapes your developmental plan and the interventions assigned to you.'
        },
        {
            icon: <LineChartOutlined />,
            title: 'Track & grow',
            text: 'Follow your interventions, metrics and compliance, and share feedback as you go.'
        }
    ],
    incubate: [
        {
            icon: <SolutionOutlined />,
            title: 'Review applications',
            text: 'Screen applicants and onboard incubatees into your programmes.'
        },
        {
            icon: <ApartmentOutlined />,
            title: 'Plan & assign',
            text: 'Run GAP analyses, build development plans and assign interventions.'
        },
        {
            icon: <BarChartOutlined />,
            title: 'Verify & report',
            text: 'Check MOVs, track KPIs and compliance, and report on impact.'
        }
    ],
    investor: [
        {
            icon: <SearchOutlined />,
            title: 'Pick a programme',
            text: 'Open the programmes you fund from a single dashboard.'
        },
        {
            icon: <TeamOutlined />,
            title: 'Review incubatees',
            text: 'See who is supported, their sectors and interventions completed.'
        },
        {
            icon: <PieChartOutlined />,
            title: 'Analyse reach',
            text: 'Break down applications, ownership, B-BBEE and locality.'
        }
    ]
}

const HEADLINE = ['Smart', 'incubation,', 'from', 'application']
const HEADLINE_ACCENT = ['to', 'impact.']

const ROLE_INTERVAL = 6000
const EASE = [0.22, 1, 0.36, 1] as const

const LandingPageContent = () => {
    const navigate = useNavigate()
    const isMobile = useIsMobile()
    const reduceMotion = useReducedMotion()

    const [active, setActive] = useState(0)
    const [paused, setPaused] = useState(false)
    const [mediaBg, setMediaBg] = useState<Record<string, string>>({})
    const pageRef = useRef<HTMLDivElement>(null)

    // Auto-advance the role explorer; restarting on `active` means a manual pick
    // gets a full interval before the next switch. Not on phones: content that
    // swaps itself while you scroll past it reads as the page jumping.
    useEffect(() => {
        if (paused || reduceMotion || isMobile) return
        const id = window.setTimeout(
            () => setActive(i => (i + 1) % roleSlides.length),
            ROLE_INTERVAL
        )
        return () => window.clearTimeout(id)
    }, [active, paused, reduceMotion, isMobile])

    // The role illustrations don't share a background (one is cream, the rest
    // white). Showing them whole means letterboxing, so paint the frame with the
    // image's own corner colour and the bars disappear into it.
    const sampleMediaBg = useCallback((key: string, img: HTMLImageElement) => {
        try {
            const canvas = document.createElement('canvas')
            canvas.width = canvas.height = 1
            const ctx = canvas.getContext('2d')
            if (!ctx) return
            ctx.drawImage(img, 2, 2, 1, 1, 0, 0, 1, 1)
            const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data
            const color = `rgb(${r}, ${g}, ${b})`
            setMediaBg(prev => (prev[key] === color ? prev : { ...prev, [key]: color }))
        } catch {
            // Tainted canvas or decode failure: keep the default white frame.
        }
    }, [])

    // Cursor spotlight: written straight to CSS variables so it never re-renders.
    const onPointerMove = useCallback((e: React.PointerEvent) => {
        if (e.pointerType !== 'mouse' || !pageRef.current) return
        pageRef.current.style.setProperty('--lx-mx', `${e.clientX}px`)
        pageRef.current.style.setProperty('--lx-my', `${e.clientY}px`)
    }, [])

    // One page at every size: phones get the same content in a single column
    // (see the phone section of LandingPage.css) rather than a separate design.
    const role = roleSlides[active]
    const rise = (delay: number) => ({
        initial: reduceMotion ? false : { opacity: 0, y: 18 },
        animate: { opacity: 1, y: 0 },
        transition: { duration: 0.7, ease: EASE, delay }
    })

    return (
        <div className='lx' ref={pageRef} onPointerMove={onPointerMove}>
            <Helmet>
                <title>Lepharo Smart Incubation</title>
                <meta
                    name='description'
                    content='Lepharo Smart Incubation Platform — tailored tools, programs, and resources for SMMEs, incubator and investors.'
                />
            </Helmet>

            <div className='lx-bg' aria-hidden='true'>
                <span className='lx-aurora lx-aurora-a' />
                <span className='lx-aurora lx-aurora-b' />
                <span className='lx-spot' />
            </div>

            <motion.header className='lx-nav' {...rise(0)}>
                <a
                    className='lx-brand'
                    href='/'
                    onClick={e => {
                        e.preventDefault()
                        window.scrollTo({ top: 0, behavior: 'smooth' })
                    }}
                >
                    <img src='/assets/images/lepharo.png' alt='Lepharo' />
                    <span className='lx-brand-tag'>Smart Incubation</span>
                </a>
                <nav className='lx-nav-actions'>
                    <a className='lx-nav-link' href='#how'>
                        How it works
                    </a>
                    <ThemeToggle />
                    <button
                        type='button'
                        className='lx-btn lx-btn-ghost'
                        onClick={() => navigate('/login')}
                    >
                        Sign in
                    </button>
                    <button
                        type='button'
                        className='lx-btn lx-btn-primary lx-nav-cta'
                        onClick={() => navigate('/registration')}
                    >
                        Get started
                    </button>
                </nav>
            </motion.header>

            <main className='lx-hero'>
                <section className='lx-copy'>
                    <motion.span className='lx-eyebrow' {...rise(0.05)}>
                        <span className='lx-eyebrow-dot' />
                        One platform for the whole incubation journey
                    </motion.span>

                    <h1 className='lx-title'>
                        {[...HEADLINE, ...HEADLINE_ACCENT].map((word, i) => (
                            <motion.span
                                key={word + i}
                                className={
                                    i >= HEADLINE.length ? 'lx-word lx-word-accent' : 'lx-word'
                                }
                                initial={reduceMotion ? false : { opacity: 0, y: '0.5em', filter: 'blur(8px)' }}
                                animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
                                transition={{ duration: 0.8, ease: EASE, delay: 0.12 + i * 0.07 }}
                            >
                                {word}
                            </motion.span>
                        ))}
                    </h1>

                    <motion.p className='lx-lede' {...rise(0.55)}>
                        Development plans, interventions and progress tracking for SMMEs, implementors
                        and funders — each with tools built for their role.
                    </motion.p>

                    <motion.div className='lx-cta' {...rise(0.65)}>
                        <button
                            type='button'
                            className='lx-btn lx-btn-primary lx-btn-lg'
                            onClick={() => navigate('/registration')}
                        >
                            Get started
                            <ArrowRightOutlined className='lx-btn-arrow' />
                        </button>
                        <button
                            type='button'
                            className='lx-btn lx-btn-ghost lx-btn-lg'
                            onClick={() => navigate('/login')}
                        >
                            I already have an account
                        </button>
                    </motion.div>
                </section>

                <motion.section
                    className='lx-explorer'
                    aria-label='What you get, by role'
                    initial={reduceMotion ? false : { opacity: 0, y: 28, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    transition={{ duration: 0.9, ease: EASE, delay: 0.3 }}
                    onMouseEnter={() => setPaused(true)}
                    onMouseLeave={() => setPaused(false)}
                    onFocus={() => setPaused(true)}
                    onBlur={() => setPaused(false)}
                >
                    <div className='lx-explorer-label'>What you get, by role</div>

                    <div className='lx-tabs' role='tablist'>
                        {roleSlides.map((r, i) => (
                            <button
                                key={r.key}
                                type='button'
                                role='tab'
                                aria-selected={i === active}
                                className={i === active ? 'lx-tab is-active' : 'lx-tab'}
                                onClick={() => setActive(i)}
                            >
                                {i === active && (
                                    <motion.span
                                        layoutId='lx-tab-pill'
                                        className='lx-tab-pill'
                                        transition={{ type: 'spring', stiffness: 420, damping: 36 }}
                                    />
                                )}
                                <span className='lx-tab-icon'>{r.icon}</span>
                                <span className='lx-tab-label'>{r.label}</span>
                                {i === active && !reduceMotion && !isMobile && (
                                    <span
                                        key={`${active}-${paused}`}
                                        className={paused ? 'lx-tab-progress is-paused' : 'lx-tab-progress'}
                                        style={{ animationDuration: `${ROLE_INTERVAL}ms` }}
                                    />
                                )}
                            </button>
                        ))}
                    </div>

                    <div className='lx-role' role='tabpanel'>
                        <AnimatePresence mode='wait' initial={false}>
                            <motion.div
                                key={role.key}
                                className='lx-role-inner'
                                initial={{ opacity: 0, y: 14 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                                transition={{ duration: 0.35, ease: EASE }}
                            >
                                <div
                                    className='lx-role-media keep-light'
                                    style={mediaBg[role.key] ? { background: mediaBg[role.key] } : undefined}
                                >
                                    <motion.img
                                        src={role.image}
                                        alt=''
                                        onLoad={e => sampleMediaBg(role.key, e.currentTarget)}
                                        initial={{ scale: 1.08 }}
                                        animate={{ scale: 1 }}
                                        transition={{ duration: 1.2, ease: EASE }}
                                    />
                                </div>
                                <h2 className='lx-role-title'>{role.title}</h2>
                                <p className='lx-role-desc'>{role.description}</p>
                                <ul className='lx-perks'>
                                    {role.perks.map((perk, i) => (
                                        <motion.li
                                            key={perk}
                                            initial={{ opacity: 0, x: -8 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            transition={{ duration: 0.4, ease: EASE, delay: 0.12 + i * 0.08 }}
                                        >
                                            <span className='lx-perk-check'>
                                                <TickMark />
                                            </span>
                                            {perk}
                                        </motion.li>
                                    ))}
                                </ul>
                            </motion.div>
                        </AnimatePresence>
                    </div>
                </motion.section>
            </main>

            <motion.section
                className='lx-steps'
                id='how'
                aria-label='How it works'
                initial={reduceMotion ? false : { opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.4 }}
                transition={{ duration: 0.7, ease: EASE, delay: 0.2 }}
                onMouseEnter={() => setPaused(true)}
                onMouseLeave={() => setPaused(false)}
            >
                <div className='lx-steps-head'>
                    <h2 className='lx-steps-heading'>
                        How it works for{' '}
                        <AnimatePresence mode='wait' initial={false}>
                            <motion.span
                                key={role.key}
                                className='lx-steps-role'
                                initial={{ opacity: 0, y: 8 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -8 }}
                                transition={{ duration: 0.25, ease: EASE }}
                            >
                                {role.label}
                            </motion.span>
                        </AnimatePresence>
                    </h2>
                </div>

                <AnimatePresence mode='wait' initial={false}>
                    <motion.div
                        key={role.key}
                        className='lx-steps-grid'
                        initial='hidden'
                        animate='shown'
                        exit='gone'
                    >
                        {stepsByRole[role.key].map((step, i) => (
                            <motion.article
                                key={step.title}
                                className='lx-step'
                                variants={{
                                    hidden: { opacity: 0, y: 12 },
                                    shown: {
                                        opacity: 1,
                                        y: 0,
                                        transition: { duration: 0.45, ease: EASE, delay: i * 0.08 }
                                    },
                                    gone: { opacity: 0, y: -8, transition: { duration: 0.2 } }
                                }}
                            >
                                <span className='lx-step-icon'>
                                    {step.icon}
                                    <span className='lx-step-num'>{i + 1}</span>
                                </span>
                                <div>
                                    <h3 className='lx-step-title'>{step.title}</h3>
                                    <p className='lx-step-text'>{step.text}</p>
                                </div>
                            </motion.article>
                        ))}
                    </motion.div>
                </AnimatePresence>
            </motion.section>

            <footer className='lx-footer'>
                <span>© {new Date().getFullYear()} Lepharo Smart Incubation</span>
                <PoweredByQuantilytix />
            </footer>
        </div>
    )
}

const LandingPage = LandingPageContent

export default LandingPage
