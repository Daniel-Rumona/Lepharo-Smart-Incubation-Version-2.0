import React from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import {
    ArrowLeftOutlined,
    CompassOutlined,
    DisconnectOutlined,
    HomeOutlined,
    QuestionOutlined,
    SearchOutlined
} from '@ant-design/icons'
import { useLocation, useNavigate } from 'react-router-dom'
import { Helmet } from 'react-helmet'
import { ThemeToggle } from '@/components/layout/theme-toggle'
// Shared with the landing page: the orbit animation, accent variables
// and dark-mode treatment all come from here so the two stay one design.
import '../landing/LandingPage.css'
import './NotFound.css'

const orbitIcons = [
    <SearchOutlined key='search' />,
    <QuestionOutlined key='question' />,
    <DisconnectOutlined key='broken' />
]

const rise = (delay: number) => ({
    initial: { opacity: 0, y: 22 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.6, ease: 'easeOut' as const, delay }
})

export default function NotFoundPage() {
    const navigate = useNavigate()
    const { pathname } = useLocation()
    const reduceMotion = useReducedMotion()

    const goBack = () => (window.history.length > 1 ? navigate(-1) : navigate('/'))

    return (
        <div className='landing-page nf-page'>
            <Helmet>
                <title>Page not found | Smart Incubation Platform</title>
            </Helmet>

            <div className='nf-theme'>
                <ThemeToggle compact />
            </div>

            <main className='nf-main'>
                <motion.div className='nf-left' {...rise(0)}>
                <div className='nf-stage'>
                    <span className='nf-ring nf-ring-1' />
                    <span className='nf-ring nf-ring-2' />

                    <div className='orbit-field' aria-hidden='true'>
                        <div className='orbit-center'>
                            <CompassOutlined />
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
                </div>
                </motion.div>

                <div className='nf-right'>
                <motion.h1
                    className={`nf-code${reduceMotion ? '' : ' is-floating'}`}
                    aria-label='Error 404'
                    {...rise(0.12)}
                >
                    404
                </motion.h1>

                <motion.div {...rise(0.22)}>
                    <h2 className='nf-title'>Page not found</h2>
                    <p className='nf-text'>
                        The page you are looking for does not exist or has moved.
                    </p>
                    <span className='nf-path' title={pathname}>
                        {pathname}
                    </span>
                </motion.div>

                <motion.div className='nf-actions' {...rise(0.32)}>
                    <button type='button' className='nf-btn is-primary' onClick={() => navigate('/')}>
                        <HomeOutlined /> Go Home
                    </button>
                    <button type='button' className='nf-btn' onClick={goBack}>
                        <ArrowLeftOutlined /> Go Back
                    </button>
                </motion.div>
                </div>
            </main>

            <span className='nf-brand'>
                <img src='/assets/images/QuantilytixO.png' alt='Quantilytix' />
            </span>
        </div>
    )
}
