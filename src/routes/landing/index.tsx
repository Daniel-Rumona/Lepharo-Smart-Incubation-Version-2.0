import React from 'react'
import { Carousel } from 'antd'
import { useNavigate } from 'react-router-dom'
import { Helmet } from 'react-helmet'
import {
    RocketOutlined,
    TeamOutlined,
    UserAddOutlined,
    CheckCircleFilled
} from '@ant-design/icons'
import { motion } from 'framer-motion'
import './LandingPage.css'
import { ThemeToggle } from '@/components/layout/theme-toggle'

const roleSlides = [
    {
        key: 'sme',
        title: 'Startups | SMMEs | Cooperatives',
        image: '/assets/images/projects/1.jpg',
        description: 'Support and opportunities for small and medium enterprises.',
        perks: ['AI-matched funding opportunities', 'Smart mentorship scheduling']
    },
    {
        key: 'incubate',
        title: 'Incubation | ESD Implementors',
        image: '/assets/images/projects/4.jpg',
        description: 'Tools and resources for incubation program implementors.',
        perks: ['Automated progress tracking', 'AI-based mentee matching']
    },
    {
        key: 'investor',
        title: 'Investors | Funders | Capital Partners',
        image: '/assets/images/projects/5.jpg',
        description: 'Discover and support high-potential incubatees and programs.',
        perks: ['Curated incubatee pipelines', 'Portfolio performance tracking']
    }
]

const orbitIcons = [
    <RocketOutlined key='sme' />,
    <TeamOutlined key='incubate' />,
    <UserAddOutlined key='investor' />
]

const fadeUp = {
    initial: { opacity: 0, y: 24 },
    animate: {
        opacity: 1,
        y: 0,
        transition: { duration: 0.7, ease: 'easeOut' }
    }
}

const LandingPageContent = () => {
    const navigate = useNavigate()

    return (
        <div className='landing-page'>
            <Helmet>
                <title>Lepharo Smart Incubation</title>
                <meta
                    name='description'
                    content='Lepharo Smart Incubation Platform — tailored tools, programs, and resources for SMMEs, incubator and investors.'
                />
            </Helmet>

            <motion.svg
                className='landing-blob blob-a'
                viewBox='0 0 400 400'
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 1.4 }}
            >
                <path
                    fill='url(#blobGradA)'
                    d='M326.9,309Q298,378,218.5,374.5Q139,371,81,312.5Q23,254,56.5,172Q90,90,180.5,63.5Q271,37,322.5,118.5Q374,200,326.9,309Z'
                />
                <defs>
                    <linearGradient id='blobGradA' x1='0' y1='0' x2='1' y2='1'>
                        <stop offset='0%' stopColor='#f5532e' />
                        <stop offset='100%' stopColor='#ff8a65' />
                    </linearGradient>
                </defs>
            </motion.svg>
            <motion.svg
                className='landing-blob blob-b'
                viewBox='0 0 400 400'
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 1.4, delay: 0.2 }}
            >
                <path
                    fill='url(#blobGradB)'
                    d='M343,294.5Q302,389,199.5,371Q97,353,71.5,226.5Q46,100,154,72.5Q262,45,315,122.5Q368,200,343,294.5Z'
                />
                <defs>
                    <linearGradient id='blobGradB' x1='0' y1='0' x2='1' y2='1'>
                        <stop offset='0%' stopColor='#c9a6ff' />
                        <stop offset='100%' stopColor='#7c3aed' />
                    </linearGradient>
                </defs>
            </motion.svg>

            {/* Floating pill top bar */}
            <motion.header
                className='landing-topbar'
                initial={{ opacity: 0, y: -16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, ease: 'easeOut' }}
            >
                <div className='topbar-brand'>
                    <img src='/assets/images/lepharo.png' alt='Lepharo' />
                </div>
                <nav className='topbar-actions'>
                    <ThemeToggle />
                    <button
                        type='button'
                        className='topbar-link'
                        onClick={() => navigate('/registration')}
                    >
                        Sign Up
                    </button>
                    <span className='topbar-divider'>|</span>
                    <button
                        type='button'
                        className='topbar-btn-primary'
                        onClick={() => navigate('/login')}
                    >
                        Login
                    </button>
                </nav>
            </motion.header>

            <main className='landing-main'>
                {/* Left: animated visual */}
                <motion.div
                    className='landing-left'
                    variants={fadeUp}
                    initial='initial'
                    animate='animate'
                >
                    <h1 className='landing-title'>
                        Welcome to the Smart Incubation Platform
                    </h1>
                    <p className='landing-intro'>
                        One platform, tailored tools for every role in the incubation
                        journey.
                    </p>

                    <div className='orbit-field' aria-hidden='true'>
                        <div className='orbit-center'>
                            <RocketOutlined />
                        </div>
                        {orbitIcons.map((icon, index) => (
                            <div
                                key={index}
                                className='orbit-ring'
                                style={{ animationDelay: `${-(index * (20 / orbitIcons.length))}s` }}
                            >
                                <div className='orbit-holder'>
                                    <div
                                        className='orbit-icon-inner'
                                        style={{
                                            animationDelay: `${-(index * (20 / orbitIcons.length))}s`
                                        }}
                                    >
                                        {icon}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </motion.div>

                {/* Right: role carousel */}
                <motion.div
                    className='landing-right'
                    variants={fadeUp}
                    initial='initial'
                    animate='animate'
                    transition={{ delay: 0.15 }}
                >
                    <div className='role-carousel-wrap'>
                        <div className='role-carousel-label'>What you get, by role</div>
                        <Carousel autoplay autoplaySpeed={3800} dots>
                            {roleSlides.map(role => (
                                <div key={role.key}>
                                    <div className='role-slide'>
                                        <img
                                            src={role.image}
                                            alt={role.title}
                                            className='role-slide-img'
                                        />
                                        <div className='role-slide-title'>{role.title}</div>
                                        <p className='role-slide-desc'>{role.description}</p>
                                        <ul className='role-perks'>
                                            {role.perks.map(perk => (
                                                <li key={perk}>
                                                    <CheckCircleFilled className='perk-dot' />
                                                    {perk}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                </div>
                            ))}
                        </Carousel>
                    </div>
                </motion.div>
            </main>

            <img
                src='/assets/images/QuantilytixO.png'
                alt='Quantilytix Logo'
                className='landing-logo'
            />
        </div>
    )
}

const LandingPage = LandingPageContent

export default LandingPage
