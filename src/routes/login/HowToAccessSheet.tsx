import React from 'react'
import { Drawer, Modal } from 'antd'
import { CloseOutlined, YoutubeOutlined } from '@ant-design/icons'
import { useIsMobile } from '@/hooks/useIsMobile'
import './HowToAccessSheet.css'

const VIDEO_ID = 'AQl59BjWAt0'
const EMBED_URL = `https://www.youtube.com/embed/${VIDEO_ID}?rel=0&playsinline=1`
const WATCH_URL = `https://www.youtube.com/watch?v=${VIDEO_ID}`

const STEPS = [
    {
        title: 'Create an account',
        detail: 'Tap Sign up and register with your email, or continue with Google.'
    },
    {
        title: 'Complete your application',
        detail: 'After signing up you land in the applicant area, where you apply to the programme.'
    },
    {
        title: 'Follow its progress',
        detail: 'The application tracker shows where things stand until you are accepted.'
    },
    {
        title: 'Sign in',
        detail: 'Once accepted, sign in with the same email to reach your dashboard.'
    },
    {
        title: 'Locked out?',
        detail: 'Choose Forgot password on the sign-in screen and we will email you a reset link.'
    }
]

interface HowToAccessSheetProps {
    open: boolean
    onClose: () => void
}

const HowToAccessSheet: React.FC<HowToAccessSheetProps> = ({ open, onClose }) => {
    const mobile = useIsMobile()

    const content = (
        <div className={`howto ${mobile ? 'is-full' : 'is-modal'}`}>
            <header className='howto-head'>
                <div>
                    <h2 className='howto-title'>How to access</h2>
                    <p className='howto-lead'>Watch the walkthrough, or follow the steps.</p>
                </div>
                <button type='button' className='howto-close' aria-label='Close' onClick={onClose}>
                    <CloseOutlined />
                </button>
            </header>

            {/* Desktop: video and steps side by side, so nothing hides below the
                fold. Phones: the video stays pinned and only the steps scroll. */}
            <div className='howto-main'>
                <div className='howto-media'>
                    <div className='howto-video'>
                        <iframe
                            src={EMBED_URL}
                            title='How to access tutorial video'
                            allow='accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share'
                            allowFullScreen
                        />
                    </div>
                    <a
                        className='howto-yt'
                        href={WATCH_URL}
                        target='_blank'
                        rel='noopener noreferrer'
                    >
                        <YoutubeOutlined /> Open in YouTube
                    </a>
                </div>

                <div className='howto-scroll'>
                    <h3 className='howto-steps-title'>Quick steps</h3>
                    <ol className='howto-steps'>
                        {STEPS.map((step, index) => (
                            <li key={step.title}>
                                <span className='howto-step-num'>{index + 1}</span>
                                <span className='howto-step-text'>
                                    <strong>{step.title}</strong>
                                    <span>{step.detail}</span>
                                </span>
                            </li>
                        ))}
                    </ol>
                </div>
            </div>
        </div>
    )

    if (mobile) {
        return (
            <Drawer
                open={open}
                onClose={onClose}
                placement='bottom'
                height='100dvh'
                closable={false}
                destroyOnClose
                rootClassName='howto-root as-brand'
                classNames={{ wrapper: 'howto-wrapper', body: 'howto-body' }}
                styles={{ header: { display: 'none' } }}
                title='How to access'
            >
                {content}
            </Drawer>
        )
    }

    return (
        <Modal
            open={open}
            onCancel={onClose}
            footer={null}
            closable={false}
            centered
            width='min(1040px, 94vw)'
            destroyOnClose
            rootClassName='howto-root as-brand'
            className='howto-modal'
        >
            {content}
        </Modal>
    )
}

export default HowToAccessSheet
