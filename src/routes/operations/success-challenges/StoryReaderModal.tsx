import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button, Image, Modal, Segmented, Tag, Tooltip, theme } from 'antd'
import {
    ArrowLeftOutlined,
    ArrowRightOutlined,
    BookOutlined,
    CalendarOutlined,
    CloseOutlined,
    LeftOutlined,
    RightOutlined,
    FilePdfOutlined,
    HeartOutlined,
    MessageOutlined,
    PauseCircleOutlined,
    PlayCircleOutlined,
    RedoOutlined,
    RocketOutlined,
    TeamOutlined,
    TrophyOutlined,
    BankOutlined,
    NumberOutlined
} from '@ant-design/icons'
import { AnimatePresence, motion } from 'framer-motion'

type Attachment = { name: string; url: string; type?: string }

export type StoryReaderStory = {
    title?: string
    smeName?: string
    storyKind?: string
    eventNature?: string | null
    source?: string
    eventTitle?: string
    departmentName?: string
    interventionTitle?: string
    attachments?: Attachment[]
}

type Props = {
    story: StoryReaderStory | null
    sections: Array<[string, string]>
    cover: string
    subtitle: string
    onClose: () => void
    /** Defaults suit success stories; challenges override them. */
    modalTitle?: string
    tags?: React.ReactNode
    outcomeLabels?: string[]
    celebrate?: boolean
    finaleHeading?: string
    galleryHeading?: string
}

type Slide =
    | { kind: 'intro' }
    | { kind: 'section'; label: string; value: string; index: number }
    | { kind: 'gallery' }
    | { kind: 'finale' }

const sectionIcon = (label: string) => {
    const key = label.toLowerCase()
    if (key.includes('achievement') || key.includes('benefits')) return <TrophyOutlined />
    if (key.includes('journey') || key.includes('supported')) return <RocketOutlined />
    if (key.includes('contribution')) return <HeartOutlined />
    if (key.includes('comment') || key.includes('testimonial')) return <MessageOutlined />
    if (key.includes('number') || key.includes('attendance')) return <NumberOutlined />
    if (key.includes('participants') || key.includes('attendees')) return <TeamOutlined />
    if (key.includes('event')) return <CalendarOutlined />
    if (key.includes('background')) return <BankOutlined />
    return <BookOutlined />
}

const DEFAULT_OUTCOMES = ['Achievement', 'Benefits and long-term outcomes']

/** Reading time for a slide, so longer passages stay on screen longer. */
const TYPE_TICK_MS = 22

/** Characters revealed per tick, scaled so long passages still finish typing in a few seconds. */
const typingStep = (length: number) => Math.max(1, Math.ceil(length / 260))
const typingDuration = (length: number) => Math.ceil(length / typingStep(length)) * TYPE_TICK_MS

const slideDuration = (slide: Slide) => {
    if (slide.kind === 'section') return typingDuration(slide.value.length) + Math.min(9000, Math.max(3500, slide.value.length * 22))
    if (slide.kind === 'gallery') return 6000
    return 5000
}

/** Reveals text as if it is being typed live. Reserves the final height so nothing jumps. */
const Typewriter: React.FC<{ text: string; className?: string }> = ({ text, className }) => {
    const reduced = typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const [count, setCount] = useState(reduced ? text.length : 0)

    useEffect(() => {
        if (reduced) return
        setCount(0)
        const step = typingStep(text.length)
        const timer = window.setInterval(() => {
            setCount(value => {
                const next = Math.min(text.length, value + step)
                if (next >= text.length) window.clearInterval(timer)
                return next
            })
        }, TYPE_TICK_MS)
        return () => window.clearInterval(timer)
    }, [reduced, text])

    return (
        <p className={className} aria-label={text} style={{ position: 'relative' }}>
            <span aria-hidden='true' style={{ visibility: 'hidden' }}>{text}</span>
            <span aria-hidden='true' style={{ position: 'absolute', inset: 0 }}>
                {text.slice(0, count)}
                {count < text.length && <span className='story-caret' />}
            </span>
        </p>
    )
}

const FILES_PER_PAGE = 5

/** Paged document list so a long set of PDFs never overflows the slide or modal. */
const FileList: React.FC<{ files: Attachment[] }> = ({ files }) => {
    const [page, setPage] = useState(1)
    const visible = files.slice((page - 1) * FILES_PER_PAGE, page * FILES_PER_PAGE)
    const pages = Math.ceil(files.length / FILES_PER_PAGE)
    return (
        <div className={pages > 1 ? 'story-media-files story-media-files-paged' : 'story-media-files'}>
            {visible.map(file => <Button key={file.url} className='story-file-btn' href={file.url} target='_blank' icon={<FilePdfOutlined />} title={file.name}><span>{file.name}</span></Button>)}
            {pages > 1 && (
                <div className='story-pager' role='navigation' aria-label='Document pages'>
                    <Button className='story-pager-btn' shape='circle' icon={<LeftOutlined />} disabled={page === 1} onClick={() => setPage(page - 1)} aria-label='Previous documents' />
                    <div className='story-pager-center'>
                        <span className='story-pager-dots'>
                            {Array.from({ length: pages }, (_, index) => (
                                <button key={index} type='button' aria-label={`Page ${index + 1}`} aria-current={page === index + 1} className={page === index + 1 ? 'story-pager-dot story-pager-dot-active' : 'story-pager-dot'} onClick={() => setPage(index + 1)} />
                            ))}
                        </span>
                        <span className='story-pager-count'>{(page - 1) * FILES_PER_PAGE + 1}-{Math.min(page * FILES_PER_PAGE, files.length)} of {files.length}</span>
                    </div>
                    <Button className='story-pager-btn' shape='circle' icon={<RightOutlined />} disabled={page === pages} onClick={() => setPage(page + 1)} aria-label='Next documents' />
                </div>
            )}
        </div>
    )
}

const CONFETTI_COLORS = ['#1677ff', '#13c2c2', '#722ed1', '#fadb14', '#fa8c16', '#eb2f96', '#52c41a']

/** Lightweight canvas confetti, no dependency. */
const Confetti: React.FC = () => {
    const ref = useRef<HTMLCanvasElement>(null)

    useEffect(() => {
        const canvas = ref.current
        const ctx = canvas?.getContext('2d')
        if (!canvas || !ctx) return
        const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
        if (reduced) return
        const { width, height } = canvas.getBoundingClientRect()
        canvas.width = width
        canvas.height = height
        const pieces = Array.from({ length: 140 }, (_, i) => {
            const fromLeft = i % 2 === 0
            const angle = (fromLeft ? -60 : -120) * (Math.PI / 180) + (Math.random() - 0.5) * 0.9
            const speed = 9 + Math.random() * 9
            return {
                x: fromLeft ? 0 : width,
                y: height * 0.85,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                size: 6 + Math.random() * 6,
                rot: Math.random() * Math.PI,
                vr: (Math.random() - 0.5) * 0.3,
                color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
                round: Math.random() > 0.6
            }
        })
        let frame = 0
        let raf = 0
        const tick = () => {
            frame += 1
            ctx.clearRect(0, 0, width, height)
            pieces.forEach(p => {
                p.vy += 0.28
                p.vx *= 0.992
                p.x += p.vx
                p.y += p.vy
                p.rot += p.vr
                ctx.save()
                ctx.translate(p.x, p.y)
                ctx.rotate(p.rot)
                ctx.globalAlpha = Math.max(0, 1 - frame / 220)
                ctx.fillStyle = p.color
                if (p.round) {
                    ctx.beginPath()
                    ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2)
                    ctx.fill()
                } else {
                    ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.6)
                }
                ctx.restore()
            })
            if (frame < 220) raf = requestAnimationFrame(tick)
            else ctx.clearRect(0, 0, width, height)
        }
        raf = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(raf)
    }, [])

    return <canvas ref={ref} className='story-confetti' aria-hidden='true' />
}

const StoryReaderModal: React.FC<Props> = ({ story, sections, cover, subtitle, onClose, modalTitle = 'Success story', tags, outcomeLabels = DEFAULT_OUTCOMES, celebrate = true, finaleHeading, galleryHeading = 'Moments and evidence' }) => {
    const isOutcome = (label: string) => outcomeLabels.includes(label)
    const { token } = theme.useToken()
    const [mode, setMode] = useState<'read' | 'play'>('read')
    const [step, setStep] = useState(0)
    const [playing, setPlaying] = useState(true)
    const [direction, setDirection] = useState(1)
    const [confettiKey, setConfettiKey] = useState(0)

    const images = useMemo(() => (story?.attachments || []).filter(file => file.type?.startsWith('image/')), [story])
    const files = useMemo(() => (story?.attachments || []).filter(file => !file.type?.startsWith('image/')), [story])

    const slides = useMemo<Slide[]>(() => {
        if (!story) return []
        return [
            { kind: 'intro' },
            ...sections.map(([label, value], index) => ({ kind: 'section' as const, label, value, index })),
            ...(story.attachments?.length ? [{ kind: 'gallery' as const }] : []),
            { kind: 'finale' }
        ]
    }, [sections, story])

    const last = slides.length - 1
    const current = slides[step]

    // Reset whenever a different story is opened.
    useEffect(() => {
        setMode('read')
        setStep(0)
        setPlaying(true)
        setDirection(1)
    }, [story])

    const go = useCallback((next: number) => {
        setStep(prev => {
            const target = Math.max(0, Math.min(last, next))
            setDirection(target >= prev ? 1 : -1)
            return target
        })
    }, [last])

    // Autoplay: advance after a reading-time delay, stop on the finale.
    useEffect(() => {
        if (mode !== 'play' || !playing || !current || current.kind === 'finale') return
        const timer = window.setTimeout(() => go(step + 1), slideDuration(current))
        return () => window.clearTimeout(timer)
    }, [current, go, mode, playing, step])

    useEffect(() => {
        if (mode === 'play' && current?.kind === 'finale') setConfettiKey(key => key + 1)
    }, [current, mode])

    useEffect(() => {
        if (!story || mode !== 'play') return
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'ArrowRight') go(step + 1)
            if (event.key === 'ArrowLeft') go(step - 1)
            if (event.key === ' ') {
                event.preventDefault()
                setPlaying(value => !value)
            }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    }, [go, mode, step, story])

    const startPlay = () => {
        setStep(0)
        setDirection(1)
        setPlaying(true)
        setMode('play')
    }

    const cssVars = {
        '--sr-bg': token.colorBgContainer,
        '--sr-soft': token.colorFillAlter,
        '--sr-text': token.colorText,
        '--sr-muted': token.colorTextSecondary,
        '--sr-border': token.colorBorderSecondary,
        '--sr-accent': token.colorPrimary,
        '--sr-accent-bg': token.colorPrimaryBg,
        '--sr-accent-border': token.colorPrimaryBorder
    } as React.CSSProperties

    const isEvent = story?.storyKind === 'Event'

    const meta = story && (
        <div className='story-reader-meta'>
            {tags ?? <>
                <Tag color={isEvent ? 'purple' : 'blue'}>{story.storyKind || 'SMME'}</Tag>
                <Tag color={story.source === 'SME' ? 'cyan' : 'gold'}>{story.source || 'Department'} submitted</Tag>
                {story.eventNature && <Tag color='geekblue'>{story.eventNature}</Tag>}
                {story.departmentName && <Tag>{story.departmentName}</Tag>}
                {story.interventionTitle && <Tag>{story.interventionTitle}</Tag>}
            </>}
        </div>
    )

    const gallery = story && (
        <div className={images.length > 2 ? 'story-media story-media-stacked' : 'story-media'}>
            {!!images.length && <Image.PreviewGroup>
                <div className={images.length > 2 ? 'story-media-images story-media-images-row' : 'story-media-images'} style={{ '--cols': Math.min(images.length, 2) } as React.CSSProperties}>
                    {images.map(file => <Image key={file.url} src={file.url} alt={file.name} />)}
                </div>
            </Image.PreviewGroup>}
            {!!files.length && <FileList key={files.length} files={files} />}
        </div>
    )

    const renderReadMode = () => story && (
        <div className='story-read'>
            <motion.header className='story-hero' initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
                {cover && <div className='story-hero-cover'><Image src={cover} alt={`${story.title || story.smeName} cover`} /></div>}
                <div className='story-hero-copy'>
                    {meta}
                    <h2>{story.title || story.smeName}</h2>
                    {subtitle && <p>{subtitle}</p>}
                </div>
            </motion.header>
            <ol className='story-timeline'>
                {sections.map(([label, value], index) => (
                    <motion.li
                        key={label}
                        className={isOutcome(label) ? 'story-timeline-item story-timeline-outcome' : 'story-timeline-item'}
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.4, delay: 0.1 + index * 0.08 }}
                    >
                        <span className='story-timeline-dot'>{sectionIcon(label)}</span>
                        <div className='story-timeline-card'>
                            <h4>{label}</h4>
                            <p>{value}</p>
                        </div>
                    </motion.li>
                ))}
            </ol>
            {!!story.attachments?.length && <motion.section className='story-read-gallery' initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 + sections.length * 0.08 }}>
                <h4>Images and supporting files</h4>
                {gallery}
            </motion.section>}
        </div>
    )

    const renderSlide = (slide: Slide) => {
        if (!story) return null
        if (slide.kind === 'intro') return (
            <div className='story-slide story-slide-intro'>
                {cover && <div className='story-slide-cover'><img src={cover} alt='' /></div>}
                {meta}
                <h2>{story.title || story.smeName}</h2>
                {subtitle && <p className='story-slide-sub'>{subtitle}</p>}
            </div>
        )
        if (slide.kind === 'section') return (
            <div className={isOutcome(slide.label) ? 'story-slide story-slide-outcome' : 'story-slide'}>
                <span className='story-slide-icon'>{sectionIcon(slide.label)}</span>
                <span className='story-slide-step'>{slide.index + 1} of {sections.length}</span>
                <h3>{slide.label}</h3>
                <Typewriter key={slide.label} text={slide.value} className={slide.value.length > 420 ? 'story-slide-text story-slide-text-long' : 'story-slide-text'} />
            </div>
        )
        if (slide.kind === 'gallery') return (
            <div className='story-slide story-slide-gallery'>
                <h3>{galleryHeading}</h3>
                {gallery}
            </div>
        )
        return (
            <div className='story-slide story-slide-finale'>
                <motion.span className='story-slide-trophy' initial={{ scale: 0, rotate: -20 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 260, damping: 14 }}><TrophyOutlined /></motion.span>
                <h2>{finaleHeading ?? (isEvent ? 'What a success' : 'Success achieved')}</h2>
                <p className='story-slide-sub'>{story.title || story.smeName}</p>
                <div className='story-finale-actions'>
                    <Button icon={<RedoOutlined />} onClick={startPlay}>Replay</Button>
                    <Button type='primary' onClick={() => setMode('read')}>Back to full story</Button>
                </div>
            </div>
        )
    }

    const renderPlayMode = () => (
        <div className='story-play'>
            <div className='story-play-progress' role='progressbar' aria-valuemin={1} aria-valuemax={slides.length} aria-valuenow={step + 1}>
                {slides.map((slide, index) => (
                    <button key={index} type='button' aria-label={`Go to step ${index + 1}`} onClick={() => go(index)} className='story-play-bar'>
                        <span
                            key={index === step ? `${step}-${playing}` : index}
                            style={{
                                width: index < step ? '100%' : index === step && !playing ? '100%' : '0%',
                                animation: index === step && playing && current && current.kind !== 'finale' ? `story-bar-fill ${slideDuration(current)}ms linear forwards` : undefined
                            }}
                        />
                    </button>
                ))}
            </div>
            <div className='story-play-stage'>
                <AnimatePresence mode='wait' custom={direction}>
                    <motion.div
                        key={step}
                        custom={direction}
                        initial={{ opacity: 0, x: direction * 48 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: direction * -48 }}
                        transition={{ duration: 0.32, ease: 'easeOut' }}
                        className='story-play-motion'
                    >
                        {current && renderSlide(current)}
                    </motion.div>
                </AnimatePresence>
                {celebrate && current?.kind === 'finale' && <Confetti key={confettiKey} />}
            </div>
        </div>
    )

    return (
        <Modal
            open={!!story}
            onCancel={onClose}
            footer={null}
            width={mode === 'play' ? '100vw' : 940}
            centered
            destroyOnClose
            className={mode === 'play' ? 'story-reader-modal story-reader-fullscreen' : 'story-reader-modal'}
            closeIcon={<CloseOutlined />}
            title={<div className='story-reader-toolbar'>
                <span>{modalTitle}</span>
                {mode === 'play' && <div className='story-play-controls'>
                    <Button size='small' shape='circle' icon={<ArrowLeftOutlined />} disabled={step === 0} onClick={() => go(step - 1)} aria-label='Previous' />
                    <Tooltip title={playing ? 'Pause' : 'Play'}>
                        <Button size='small' shape='circle' type='primary' icon={playing ? <PauseCircleOutlined /> : <PlayCircleOutlined />} disabled={current?.kind === 'finale'} onClick={() => setPlaying(value => !value)} aria-label={playing ? 'Pause' : 'Play'} />
                    </Tooltip>
                    <Button size='small' shape='circle' icon={<ArrowRightOutlined />} disabled={step === last} onClick={() => go(step + 1)} aria-label='Next' />
                    <span className='story-play-count'>{step + 1} / {slides.length}</span>
                </div>}
                <Segmented
                    value={mode}
                    onChange={value => (value === 'play' ? startPlay() : setMode('read'))}
                    options={[{ value: 'read', label: 'Read', icon: <BookOutlined /> }, { value: 'play', label: 'Play', icon: <PlayCircleOutlined /> }]}
                />
            </div>}
        >
            <div className='story-reader-root' style={cssVars}>
                {mode === 'play' ? renderPlayMode() : renderReadMode()}
            </div>
        </Modal>
    )
}

export default StoryReaderModal
