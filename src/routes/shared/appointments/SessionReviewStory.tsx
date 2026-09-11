import React, { useEffect, useState } from 'react'
import { Avatar, Typography } from 'antd'
import {
    CalendarOutlined,
    CheckCircleOutlined,
    EnvironmentOutlined,
    LaptopOutlined,
    PhoneOutlined,
    RocketOutlined,
    TeamOutlined,
    TrophyOutlined,
    UserOutlined,
    VideoCameraOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { motion } from 'framer-motion'

import StoryViewer, { type StorySlide } from '@/components/story-viewer'
import type { CoverageReviewPhoto } from '@/lib/coveragePhotos'
import CoverageStoryCarousel from './CoverageStoryCarousel'
import CoverageTopicsStory, { COVERAGE_TOPICS_PER_PAGE } from './CoverageTopicsStory'

const { Title, Text } = Typography

const SlideIcon: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div
        style={{
            width: 60,
            height: 60,
            borderRadius: '50%',
            background: 'rgba(255,255,255,0.18)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 26,
            marginBottom: 14
        }}
    >
        {children}
    </div>
)

const AVATAR_COLORS = ['#f56a00', '#7265e6', '#ffbf00', '#00a2ae', '#eb2f96', '#52c41a', '#1677ff', '#fa541c']

const AttendeeAvatars: React.FC<{ count: number }> = ({ count }) => {
    if (count <= 0) return null
    // Cap the DOM node count for pathological values; realistic attendance counts render exactly.
    const shown = Math.min(count, 200)
    return (
        <Avatar.Group max={{ count: 6, style: { color: '#fff', backgroundColor: 'rgba(255,255,255,0.35)' } }}>
            {Array.from({ length: shown }).map((_, i) => (
                <Avatar key={i} icon={<UserOutlined />} style={{ backgroundColor: AVATAR_COLORS[i % AVATAR_COLORS.length] }} />
            ))}
        </Avatar.Group>
    )
}

const getDeliveryIcon = (name: string) => {
    const n = name.toLowerCase()
    if (n.includes('virtual') || n.includes('online') || n.includes('remote')) return <VideoCameraOutlined />
    if (n.includes('hybrid')) return <LaptopOutlined />
    if (n.includes('telephon') || n.includes('call')) return <PhoneOutlined />
    return <EnvironmentOutlined />
}

const useCountUp = (target: number, duration = 1100) => {
    const [value, setValue] = useState(0)
    useEffect(() => {
        let raf: number
        const start = performance.now()
        const tick = (now: number) => {
            const t = Math.min(1, (now - start) / duration)
            const eased = 1 - Math.pow(1 - t, 3)
            setValue(Math.round(target * eased))
            if (t < 1) raf = requestAnimationFrame(tick)
        }
        raf = requestAnimationFrame(tick)
        return () => cancelAnimationFrame(raf)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [target])
    return value
}

const BigStat: React.FC<{ label: string; value: number; suffix?: string }> = ({ label, value, suffix }) => {
    const shown = useCountUp(value)
    return (
        <div>
            <div style={{ fontSize: 64, fontWeight: 800, lineHeight: 1.1 }}>
                {shown}
                {suffix}
            </div>
            <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 16 }}>{label}</Text>
        </div>
    )
}

interface StoryReviewData {
    sessions: number
    held: number
    invited: number
    attended: number
    attendanceRate: number
    deliveryCounts: { name: string; y: number }[]
    coveredItems: { topic: string; count: number }[]
    photos?: CoverageReviewPhoto[]
}

interface UpcomingAppointment {
    date: string
    title: string
    branchName: string
}

interface SessionReviewStoryProps {
    rangeLabel: string
    reviewData: StoryReviewData
    upcoming?: UpcomingAppointment[]
    onExit: () => void
}

const buildUpcomingSlide = (upcoming: UpcomingAppointment[]): StorySlide => ({
    key: 'upcoming',
    duration: 4600 + upcoming.length * 500,
    background: 'linear-gradient(160deg,#8b5cf6,#3730a3)',
    render: () => (
        <div style={{ width: '100%', maxWidth: 460, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <SlideIcon>
                <RocketOutlined />
            </SlideIcon>
            <Title level={4} style={{ color: '#fff', marginBottom: 20 }}>
                Coming up next
            </Title>
            <motion.div
                initial='hidden'
                animate='show'
                variants={{ hidden: {}, show: { transition: { staggerChildren: 0.15 } } }}
                style={{ display: 'flex', flexDirection: 'column', gap: 10, width: '100%' }}
            >
                {upcoming.map(item => (
                    <motion.div
                        key={`${item.date}-${item.title}`}
                        variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}
                        style={{
                            background: 'rgba(255,255,255,0.14)',
                            border: '1px solid rgba(255,255,255,0.3)',
                            borderRadius: 10,
                            padding: '8px 14px',
                            textAlign: 'left',
                            display: 'flex',
                            justifyContent: 'space-between',
                            gap: 12
                        }}
                    >
                        <div>
                            <Text style={{ color: '#fff', display: 'block' }}>{item.title}</Text>
                            {item.branchName && (
                                <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }}>{item.branchName}</Text>
                            )}
                        </div>
                        <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 13, whiteSpace: 'nowrap' }}>
                            {dayjs(item.date).format('MMM D')}
                        </Text>
                    </motion.div>
                ))}
            </motion.div>
        </div>
    )
})

const SessionReviewStory: React.FC<SessionReviewStoryProps> = ({ rangeLabel, reviewData, upcoming = [], onExit }) => {
    const { sessions, held, invited, attended, attendanceRate, deliveryCounts, coveredItems } = reviewData

    if (sessions === 0) {
        const emptySlides: StorySlide[] = [
            {
                key: 'empty',
                background: 'linear-gradient(160deg,#4b5563,#1f2937)',
                render: () => (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <SlideIcon>
                            <CalendarOutlined />
                        </SlideIcon>
                        <Title level={3} style={{ color: '#fff' }}>
                            {rangeLabel}
                        </Title>
                        <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 16 }}>
                            No sessions were recorded in this period.
                        </Text>
                    </div>
                )
            }
        ]

        if (upcoming.length) emptySlides.push(buildUpcomingSlide(upcoming))

        return <StoryViewer onExit={onExit} slides={emptySlides} />
    }

    const maxDelivery = Math.max(1, ...deliveryCounts.map(d => d.y))

    const slides: StorySlide[] = [
        {
            key: 'intro',
            duration: 3200,
            background: 'linear-gradient(160deg,#6366f1,#312e81)',
            render: () => (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <SlideIcon>
                        <CalendarOutlined />
                    </SlideIcon>
                    <Text style={{ color: 'rgba(255,255,255,0.75)', fontSize: 14, letterSpacing: 1, textTransform: 'uppercase' }}>
                        Session Review
                    </Text>
                    <Title level={2} style={{ color: '#fff', marginTop: 8 }}>
                        {rangeLabel}
                    </Title>
                    <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 16 }}>Here's how it went.</Text>
                </div>
            )
        },
        {
            key: 'held',
            duration: 4200,
            background: 'linear-gradient(160deg,#0ea5e9,#0c4a6e)',
            render: () => (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    <SlideIcon>
                        <CheckCircleOutlined />
                    </SlideIcon>
                    <BigStat label={`sessions held out of ${sessions} planned`} value={held} />
                </div>
            )
        },
        {
            key: 'attendance',
            duration: 4800,
            background: 'linear-gradient(160deg,#22c55e,#14532d)',
            render: () => (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 20, alignItems: 'center' }}>
                    <SlideIcon>
                        <TeamOutlined />
                    </SlideIcon>
                    <BigStat label='attendance rate' value={attendanceRate} suffix='%' />
                    <AttendeeAvatars count={attended} />
                    <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 16 }}>
                        {attended} attended out of {invited} invited
                    </Text>
                </div>
            )
        }
    ]

    if (deliveryCounts.length) {
        slides.push({
            key: 'delivery',
            duration: 4800,
            background: 'linear-gradient(160deg,#f97316,#7c2d12)',
            render: () => (
                <div style={{ width: '100%', maxWidth: 420 }}>
                    <Title level={4} style={{ color: '#fff', marginBottom: 20 }}>
                        How sessions were delivered
                    </Title>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                        {deliveryCounts.map((d, i) => (
                            <div key={d.name} style={{ textAlign: 'left' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                                    <Text style={{ color: '#fff' }}>
                                        <span style={{ marginRight: 8 }}>{getDeliveryIcon(d.name)}</span>
                                        {d.name}
                                    </Text>
                                    <Text style={{ color: '#fff' }}>{d.y}</Text>
                                </div>
                                <div style={{ height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.25)', overflow: 'hidden' }}>
                                    <motion.div
                                        initial={{ width: 0 }}
                                        animate={{ width: `${(d.y / maxDelivery) * 100}%` }}
                                        transition={{ duration: 0.6, delay: i * 0.12, ease: 'easeOut' }}
                                        style={{ height: '100%', background: '#fff' }}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )
        })
    }

    // Topics and photos are separate story pages, each with its own navigation.
    slides.push({
        key: 'coverage-topics',
        interactive: true,
        pauseOnEnter: coveredItems.length > COVERAGE_TOPICS_PER_PAGE,
        duration: 10000,
        background: 'linear-gradient(160deg,#ec4899,#831843)',
        render: () => <CoverageTopicsStory topics={coveredItems} />
    })

    slides.push({
        key: 'coverage-photos',
        interactive: true,
        pauseOnEnter: Boolean(reviewData.photos?.length),
        duration: 10000,
        background: 'linear-gradient(160deg,#ec4899,#831843)',
        render: () => (
            <div style={{ width: '100%', maxWidth: 640, height: 340, textAlign: 'left' }}>
                <Title level={4} style={{ color: '#fff', margin: '0 0 16px' }}>Coverage photos</Title>
                <CoverageStoryCarousel photos={reviewData.photos || []} />
            </div>
        )
    })

    if (upcoming.length) {
        slides.push(buildUpcomingSlide(upcoming))
    }

    slides.push({
        key: 'outro',
        duration: 5000,
        background: 'linear-gradient(160deg,#14b8a6,#134e4a)',
        render: () => (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                <SlideIcon>
                    <TrophyOutlined />
                </SlideIcon>
                <Title level={3} style={{ color: '#fff' }}>
                    That's a wrap
                </Title>
                <Text style={{ color: 'rgba(255,255,255,0.85)', fontSize: 16 }}>
                    {held}/{sessions} sessions held · {attendanceRate}% attendance
                    {coveredItems.length ? ` · ${coveredItems.length} topics covered` : ''}
                </Text>
            </div>
        )
    })

    return <StoryViewer slides={slides} onExit={onExit} />
}

export default SessionReviewStory
