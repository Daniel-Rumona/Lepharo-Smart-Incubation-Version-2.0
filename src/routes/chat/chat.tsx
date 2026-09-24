import React, {
    useEffect,
    useLayoutEffect,
    useMemo,
    useRef,
    useState
} from 'react'
import {
    Avatar,
    Button,
    Grid,
    Input,
    Spin,
    Typography
} from 'antd'
import { ArrowLeftOutlined, AudioOutlined, OpenAIOutlined, SendOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { ChartSpecRenderer } from '@/components/ai/ChartSpecRenderer'
import { ConversationMode } from '@/routes/chat/ConversationMode'
import {
    MAX_MESSAGE_LENGTH,
    useChatSession
} from '@/routes/chat/ChatSessionContext'

const { useBreakpoint } = Grid

const { Text } = Typography
const { TextArea } = Input


// HR staff manage people, not the programme delivery pipeline — they never
// have interventions/appointments/MOVs of their own, so both roleBasedTopics
// and roleBasedQuestions special-case this department instead of falling
// through to the generic intervention-centric copy every other department gets.
const HR_DEPARTMENT_PATTERN = /(human resources|hrm|\bhr\b)/

const roleBasedTopics = (user: Record<string, any> | null): string[] => {
    const role = normaliseIdentityValue(user?.role)
    const department = normaliseIdentityValue(
        user?.departmentName || user?.department || user?.effectiveDepartment
    )

    if (role === 'incubatee') return ['My progress', 'Interventions', 'Appointments', 'Compliance']
    if ((role === 'coordinator' || role === 'operations') && HR_DEPARTMENT_PATTERN.test(department)) {
        return ['Clock-ins', 'Leave', 'KPI targets', 'Team']
    }
    if (role === 'coordinator') return ['Assigned work', 'Interventions', 'Appointments', 'MOVs']
    if (role === 'operations' && /(monitoring|evaluation|m&e)/.test(department)) {
        return ['Interventions', 'MOVs', 'Compliance', 'Participant progress']
    }
    if (role === 'operations') return ['Interventions', 'Appointments', 'Programme progress', 'Requests']
    if (role === 'projectadmin' || role === 'project admin') {
        return ['Participant progress', 'Interventions', 'MOVs', 'Programme performance']
    }
    if (role === 'funder' || role === 'director') {
        return ['Programme performance', 'Interventions', 'Compliance', 'Impact']
    }
    return ['Interventions', 'MOVs', 'Compliance', 'Appointments']
}

const useRotatingTypewriter = (words: string[]) => {
    const [wordIndex, setWordIndex] = useState(0)
    const [visibleText, setVisibleText] = useState('')
    const [isDeleting, setIsDeleting] = useState(false)

    useEffect(() => {
        if (!words.length) return
        const word = words[wordIndex % words.length]
        const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

        if (prefersReducedMotion) {
            setVisibleText(word)
            return
        }

        const isComplete = visibleText === word
        const isEmpty = visibleText.length === 0
        const delay = isDeleting ? 45 : isComplete ? 1350 : 82

        const timer = window.setTimeout(() => {
            if (!isDeleting && isComplete) {
                setIsDeleting(true)
                return
            }
            if (isDeleting && isEmpty) {
                setIsDeleting(false)
                setWordIndex(current => (current + 1) % words.length)
                return
            }
            setVisibleText(
                isDeleting
                    ? word.slice(0, Math.max(0, visibleText.length - 1))
                    : word.slice(0, visibleText.length + 1)
            )
        }, delay)

        return () => window.clearTimeout(timer)
    }, [isDeleting, visibleText, wordIndex, words])

    return visibleText
}

const normaliseIdentityValue = (value: unknown) =>
    String(value || '')
        .trim()
        .toLowerCase()
        .replace(/[\s_-]+/g, ' ')

const roleBasedQuestions = (user: Record<string, any> | null): string[] => {
    const role = normaliseIdentityValue(user?.role)
    const department = normaliseIdentityValue(
        user?.departmentName || user?.department || user?.effectiveDepartment
    )

    if (role === 'incubatee') {
        return [
            'Summarise my progress',
            'Which interventions are assigned to me?',
            'What compliance items do I still need to complete?',
            'Show my upcoming appointments'
        ]
    }

    if (role === 'applicant') {
        return [
            'What is the status of my application?',
            'Which programmes can I apply for?',
            'Show my submitted inquiries',
            'Is my business profile complete?'
        ]
    }

    if (role === 'coordinator') {
        if (/(monitoring|evaluation|m&e)/.test(department)) {
            return [
                'Which of my assigned interventions are overdue?',
                'Summarise my completed interventions',
                'Show intervention progress for my assigned participants',
                'Show my upcoming appointments'
            ]
        }

        if (/(health|safety|hse)/.test(department)) {
            return [
                'Show my active HSE interventions',
                'Which of my assigned interventions are overdue?',
                'Show my upcoming appointments',
                'Which assigned participants still have incomplete HSE work?'
            ]
        }

        if (/(finance|financial|account)/.test(department)) {
            return [
                'Show my active finance interventions',
                'Which of my assigned interventions are overdue?',
                'Show my upcoming appointments',
                'Summarise my completed interventions'
            ]
        }

        if (HR_DEPARTMENT_PATTERN.test(department)) {
            return [
                'Show my leave requests',
                'Have I taken any leave this month?',
                'How many hours have I clocked this week?',
                'Show my recent clock-in history'
            ]
        }

        return [
            'Summarise my assigned intervention workload',
            'Which of my assigned interventions are overdue?',
            'Show my upcoming appointments',
            'Summarise progress for my assigned participants'
        ]
    }

    if (role === 'operations') {
        if (HR_DEPARTMENT_PATTERN.test(department)) {
            return [
                "Who's currently on leave?",
                'Show outstanding leave requests',
                'Show clock-in activity for my department',
                'What are our KPI targets this period?'
            ]
        }

        if (/(monitoring|evaluation|m&e)/.test(department)) {
            return [
                'Which participant compliance items are outstanding?',
                'Which MOVs are still outstanding?',
                'Summarise completed interventions for the selected programme',
                'Show intervention progress by participant'
            ]
        }

        if (/(health|safety|hse)/.test(department)) {
            return [
                'How many HSE interventions are active?',
                'Which HSE interventions are overdue?',
                'Show upcoming HSE appointments',
                'Summarise completed HSE interventions'
            ]
        }

        if (/(finance|financial|account)/.test(department)) {
            return [
                'How many finance interventions are active?',
                'Which finance interventions are overdue?',
                'Show upcoming finance appointments',
                'Summarise completed finance interventions'
            ]
        }

        return [
            'How many interventions are active?',
            'Show upcoming appointments',
            'Which compliance items are outstanding?',
            'Summarise progress for the selected programme'
        ]
    }

    if (role === 'projectadmin' || role === 'project admin') {
        return [
            'Summarise participant progress in the selected programme',
            'How many interventions are currently active?',
            'Show upcoming appointments for the selected programme',
            'Which compliance items or MOVs are outstanding?'
        ]
    }

    if (role === 'funder') {
        return [
            'Summarise progress in the selected programme',
            'How many interventions have been completed?',
            'Which compliance items are outstanding?',
            'Show upcoming programme appointments'
        ]
    }

    if (role === 'receptionist') {
        return [
            'Show my submitted inquiries',
            'Which programmes are currently active?',
            'Show upcoming appointments for my centre',
            'Summarise activity in the selected programme'
        ]
    }

    if (role === 'director') {
        return [
            'Brief me on what happened today',
            'Summarise participant progress across the organisation',
            'Which compliance items and MOVs are outstanding?',
            'How many interventions are currently active?'
        ]
    }

    if (['admin', 'system admin'].includes(role)) {
        return [
            'Summarise participant progress across the organisation',
            'How many interventions are currently active?',
            'Which compliance items and MOVs are outstanding?',
            'Show upcoming appointments'
        ]
    }

    return [
        'Summarise the data I am allowed to see',
        'Show my upcoming appointments',
        'Which interventions can I view?',
        'What requires my attention?'
    ]
}

const TypingIndicator = () => (
    <div className='chat-typing' aria-live='polite' aria-label='D is typing'>
        <span />
        <span />
        <span />
    </div>
)

const Chat: React.FC = () => {
    const { user, loading: identityLoading } = useFullIdentity()
    const { messages, isTyping, error, startMessage } = useChatSession()
    const state = { messages, isTyping, error }
    const [input, setInput] = useState('')
    const [conversationMode, setConversationMode] = useState(false)
    const navigate = useNavigate()
    const screens = useBreakpoint()
    const isMobile = !screens.md
    const messagesRef = useRef<HTMLDivElement | null>(null)
    const messageRefs = useRef<Record<string, HTMLDivElement | null>>({})
    const suggestedQuestions = useMemo(
        () => roleBasedQuestions(user),
        [
            user?.role,
            user?.departmentName,
            user?.department,
            user?.effectiveDepartment
        ]
    )
    const rotatingTopics = useMemo(
        () => roleBasedTopics(user),
        [user?.role, user?.departmentName, user?.department, user?.effectiveDepartment]
    )
    const typedTopic = useRotatingTypewriter(rotatingTopics)
    const firstName = String(user?.name || user?.displayName || '')
        .trim()
        .split(/\s+/)[0] || 'there'
    const hasConversation = state.messages.length > 0

    // Docking the composer reliably needs .chat-page pinned to the exact
    // viewport region below whatever chrome the shared layout shell
    // (src/components/layout/index.tsx) is currently showing above it —
    // inheriting that height via CSS (percentage height, then flex-grow)
    // repeatedly failed to actually fill the screen in this app's layout,
    // so instead we measure the real shared topbar and pin directly to the
    // viewport, independent of any ancestor's own sizing.
    const [topOffset, setTopOffset] = useState(0)

    useLayoutEffect(() => {
        const headerEl = document.querySelector('.workspace-header-wrap')

        const measure = () => {
            setTopOffset(headerEl ? headerEl.getBoundingClientRect().height : 0)
        }

        measure()

        if (!headerEl || typeof ResizeObserver === 'undefined') {
            window.addEventListener('resize', measure)
            return () => window.removeEventListener('resize', measure)
        }

        const observer = new ResizeObserver(measure)
        observer.observe(headerEl)
        window.addEventListener('resize', measure)

        return () => {
            observer.disconnect()
            window.removeEventListener('resize', measure)
        }
    }, [isMobile])

    useEffect(() => {
        const element = messagesRef.current
        if (element) element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' })
    }, [state.messages, state.isTyping])

    const submitMessage = (content: string) => {
        if (startMessage(content)) setInput('')
    }

    const onSubmit = () => submitMessage(input)

    const renderComposer = (docked = false) => (
        <div className={`chat-composer-panel ${docked ? 'chat-composer-panel-docked' : ''}`}>
            <div className='chat-input-wrap'>
                <button
                    type='button'
                    className='chat-voice-button'
                    aria-label='Start conversation mode'
                    onClick={() => setConversationMode(true)}
                >
                    <AudioOutlined />
                </button>
                <TextArea
                    value={input}
                    onChange={event => setInput(event.target.value)}
                    onPressEnter={event => {
                        if (!event.shiftKey) {
                            event.preventDefault()
                            onSubmit()
                        }
                    }}
                    placeholder='Ask a question about your data…'
                    autoSize={{ minRows: 1, maxRows: 5 }}
                    bordered={false}
                    disabled={state.isTyping || !user}
                    maxLength={MAX_MESSAGE_LENGTH}
                    aria-label='Message'
                />
                <Button
                    type='primary'
                    shape='circle'
                    size='middle'
                    icon={<SendOutlined />}
                    onClick={onSubmit}
                    loading={state.isTyping}
                    disabled={!input.trim() || !user}
                    aria-label='Send message'
                    className='chat-send-button'
                />
            </div>
            <div className='chat-composer-meta'>
                <Text type={state.error ? 'danger' : 'secondary'}>
                    {state.error || 'Enter to send · Shift + Enter for a new line'}
                </Text>
                <Text type='secondary'>
                    {input.length}/{MAX_MESSAGE_LENGTH}
                </Text>
            </div>
        </div>
    )

    if (identityLoading) {
        return (
            <div className='chat-loading'>
                <Spin size='large' />
            </div>
        )
    }

    return (
        <div
            className='chat-page'
            style={{ '--chat-top-offset': `${topOffset}px` } as React.CSSProperties}
        >
            <style>{`
        .chat-page {
          /* Pinned straight to the viewport below the real (measured, not
             guessed) height of the shared layout's top bar — see the
             useLayoutEffect above. Inheriting height from the ancestor
             chain (percentage height, then flex-grow) repeatedly failed to
             actually fill the screen in this app's layout, on both mobile
             and desktop, so this sidesteps that chain entirely. --chat-top-
             offset is 0 on immersive mobile chat, where the shared top bar
             is hidden and .chat-mobile-header takes its place instead. */
          position: fixed;
          top: var(--chat-top-offset, 0px);
          left: 0;
          right: 0;
          bottom: 0;
          box-sizing: border-box;
          padding: 0;
          background: var(--app-surface);
          overflow: hidden;
          z-index: 10;
        }
        .chat-shell {
          width: 100%;
          height: 100%;
          position: relative;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          background: var(--app-surface);
        }
        .chat-messages {
          flex: 1 1 auto;
          min-height: 0;
          overflow-y: auto;
          overscroll-behavior: contain;
          touch-action: pan-y;
          -webkit-overflow-scrolling: touch;
          padding: 28px clamp(40px, 6vw, 112px) 116px;
          scrollbar-gutter: stable;
        }
        .chat-messages-empty {
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          padding-block: 22px;
        }
        .chat-empty-state {
          width: min(860px, 100%);
          margin: auto;
          display: flex;
          flex-direction: column;
          align-items: center;
          text-align: center;
        }
        .chat-empty-icon {
          width: 46px;
          height: 46px;
          display: grid;
          place-items: center;
          margin-bottom: 15px;
          border: 1px solid color-mix(in srgb, var(--app-accent) 20%, var(--app-surface));
          border-radius: 15px;
          color: var(--app-accent);
          background: var(--app-accent-soft);
          font-size: 21px;
          box-shadow: 0 8px 24px color-mix(in srgb, var(--app-accent) 9%, transparent);
        }
        .chat-empty-title {
          margin: 0;
          color: var(--app-text);
          font-size: clamp(24px, 3vw, 38px);
          font-weight: 650;
          letter-spacing: -.035em;
          line-height: 1.15;
        }
        .chat-typewriter-line {
          min-height: 43px;
          margin-top: 7px;
          color: var(--app-accent);
          font-size: clamp(22px, 2.7vw, 34px);
          font-weight: 650;
          letter-spacing: -.025em;
        }
        .chat-typewriter-cursor {
          display: inline-block;
          width: 2px;
          height: .9em;
          margin-left: 3px;
          vertical-align: -.08em;
          background: currentColor;
          animation: chatCursorBlink .85s steps(1) infinite;
        }
        @keyframes chatCursorBlink { 50% { opacity: 0; } }
        .chat-suggestions {
          width: min(760px, 100%);
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 8px;
          margin-top: 17px;
        }
        .chat-suggestion {
          min-width: 0;
          min-height: 42px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          padding: 9px 12px;
          border: 1px solid var(--app-border);
          border-radius: 12px;
          color: var(--app-text);
          background: var(--app-surface);
          font: inherit;
          font-size: 12px;
          font-weight: 550;
          text-align: left;
          cursor: pointer;
          transition: transform .16s ease, border-color .16s ease, color .16s ease, background .16s ease, box-shadow .16s ease;
        }
        .chat-suggestion-arrow {
          flex: 0 0 auto;
          color: var(--app-text-subtle);
          transition: transform .16s ease, color .16s ease;
        }
        .chat-suggestion:hover,
        .chat-suggestion:focus-visible {
          border-color: var(--app-accent);
          color: var(--app-accent);
          background: var(--app-accent-soft);
          box-shadow: 0 8px 20px color-mix(in srgb, var(--app-accent) 15%, transparent);
          transform: translateY(-2px);
          outline: none;
        }
        .chat-suggestion:hover .chat-suggestion-arrow,
        .chat-suggestion:focus-visible .chat-suggestion-arrow {
          color: var(--app-accent);
          transform: translateX(3px);
        }
        .chat-mobile-header {
          flex: 0 0 auto;
          display: grid;
          grid-template-columns: 34px 1fr 34px;
          align-items: center;
          gap: 10px;
          height: 52px;
          padding: 0 14px;
          border-bottom: 1px solid var(--app-border);
          background: var(--app-surface);
        }
        .chat-mobile-header-spacer {
          width: 34px;
          height: 34px;
        }
        .chat-back-button {
          display: grid;
          place-items: center;
          width: 34px;
          height: 34px;
          padding: 0;
          border: 0;
          border-radius: 10px;
          color: var(--app-text);
          background: transparent;
          font-size: 16px;
          cursor: pointer;
          transition: background .16s ease;
        }
        .chat-back-button:hover,
        .chat-back-button:focus-visible {
          background: var(--app-accent-soft);
          color: var(--app-accent);
          outline: none;
        }
        .chat-mobile-header-title {
          color: var(--app-text);
          font-size: 15px;
          font-weight: 600;
          text-align: center;
        }
        .chat-marker-rail {
          position: absolute;
          left: 8px;
          top: 56px;
          bottom: 88px;
          width: 34px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 13px;
          pointer-events: none;
        }
        .chat-marker-rail::before {
          content: '';
          position: absolute;
          display: none;
        }
        .chat-marker {
          position: relative;
          z-index: 1;
          width: 10px;
          height: 3px;
          padding: 0;
          border: 0;
          border-radius: 1px;
          background: color-mix(in srgb, var(--app-text) 55%, var(--app-surface));
          cursor: pointer;
          pointer-events: auto;
          transition: width .18s ease, height .18s ease, background .18s ease, box-shadow .18s ease;
        }
        .chat-marker:hover, .chat-marker:focus-visible {
          width: 30px;
          height: 4px;
          background: color-mix(in srgb, var(--app-text) 35%, var(--app-surface));
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--app-text) 12%, transparent);
          outline: none;
        }
        .chat-marker-tooltip {
          position: absolute;
          left: 42px;
          top: 50%;
          transform: translateY(-50%);
          display: none;
          width: min(480px, calc(100vw - 90px));
          max-height: 180px;
          overflow: hidden;
          padding: 14px 16px;
          border-radius: 12px;
          color: #f8fafc;
          background: #172033;
          border: 1px solid rgba(255,255,255,.12);
          box-shadow: 0 14px 34px rgba(0,0,0,.32);
          font-size: 12px;
          line-height: 1.35;
          white-space: normal;
          text-align: left;
          z-index: 5;
          pointer-events: none;
        }
        .chat-marker-tooltip::before {
          content: '';
          position: absolute;
          left: -5px;
          top: 50%;
          width: 9px;
          height: 9px;
          background: #172033;
          border-left: 1px solid rgba(255,255,255,.12);
          border-bottom: 1px solid rgba(255,255,255,.12);
          transform: translateY(-50%) rotate(45deg);
        }
        .chat-marker-question {
          display: block;
          margin-bottom: 6px;
          color: #fff;
          font-size: 13px;
          font-weight: 700;
          line-height: 1.35;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .chat-marker-answer {
          display: -webkit-box;
          color: #a1a1aa;
          -webkit-line-clamp: 4;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
        .chat-marker:hover .chat-marker-tooltip, .chat-marker:focus-visible .chat-marker-tooltip { display: block; }
        .chat-row {
          display: flex;
          align-items: flex-start;
          gap: 9px;
          margin-bottom: 18px;
        }
        .chat-row-user { justify-content: flex-end; }
        .chat-column {
          display: flex;
          flex-direction: column;
          gap: 10px;
          max-width: min(82%, 980px);
          min-width: 0;
        }
        .chat-bubble {
          max-width: 100%;
          padding: 12px 16px;
          border-radius: 18px;
          overflow-wrap: anywhere;
        }
        .chat-bubble-assistant {
          color: var(--app-text);
          background: var(--app-surface-sunken);
          border-top-left-radius: 5px;
        }
        .chat-bubble-user {
          color: #fff;
          background: var(--app-accent);
          border-top-right-radius: 5px;
        }
        .chat-bubble p:last-child,
        .chat-bubble ul:last-child,
        .chat-bubble ol:last-child { margin-bottom: 0; }
        .chat-chart-card {
          width: 100%;
          min-width: min(320px, 100%);
          padding: 10px 12px 4px;
          border: 1px solid var(--app-border);
          border-radius: 14px;
          background: var(--app-surface);
          box-shadow: var(--app-shadow);
        }
        .chat-time {
          display: block;
          margin-top: 6px;
          font-size: 11px;
          opacity: .62;
        }
        .chat-typing {
          display: inline-flex;
          gap: 5px;
          padding: 13px 16px;
          border-radius: 16px;
          border-top-left-radius: 5px;
          background: var(--app-surface-sunken);
        }
        .chat-typing span {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: var(--app-text-subtle);
          animation: chatPulse 1.2s infinite ease-in-out;
        }
        .chat-typing span:nth-child(2) { animation-delay: .15s; }
        .chat-typing span:nth-child(3) { animation-delay: .3s; }
        @keyframes chatPulse {
          0%, 60%, 100% { transform: translateY(0); opacity: .4; }
          30% { transform: translateY(-4px); opacity: 1; }
        }
        .chat-composer {
          position: absolute;
          left: 0;
          right: 0;
          bottom: 0;
          z-index: 2;
          padding: 18px clamp(18px, 6vw, 112px) 0;
          background: linear-gradient(
            to bottom,
            transparent,
            var(--app-surface) 20px,
            var(--app-surface) 100%
          );
        }
        .chat-composer-panel {
          width: min(920px, 100%);
          margin-inline: auto;
        }
        .chat-composer-panel-docked { margin-bottom: 10px; }
        .chat-empty-composer {
          width: min(760px, 100%);
          margin-top: 18px;
        }
        .chat-input-wrap {
          display: flex;
          align-items: center;
          gap: 8px;
          min-height: 48px;
          padding: 5px 6px;
          border: 1px solid var(--app-border-strong);
          border-radius: 18px;
          background: var(--app-surface);
          box-shadow: var(--app-shadow);
          transition: border-color .2s, box-shadow .2s;
        }
        .chat-input-wrap:focus-within {
          border-color: var(--app-accent);
          box-shadow: 0 0 0 3px color-mix(in srgb, var(--app-accent) 15%, transparent);
        }
        .chat-input-wrap textarea {
          min-height: 24px !important;
          padding: 1px 0 !important;
          line-height: 24px !important;
          box-shadow: none !important;
          resize: none !important;
        }
        .chat-voice-button {
          flex: 0 0 36px;
          display: grid;
          place-items: center;
          width: 36px;
          height: 36px;
          padding: 0;
          border: 0;
          border-radius: 50%;
          color: var(--app-text-subtle);
          background: transparent;
          font-size: 16px;
          cursor: pointer;
          transition: background .16s ease, color .16s ease;
        }
        .chat-voice-button:hover,
        .chat-voice-button:focus-visible {
          color: var(--app-accent);
          background: var(--app-accent-soft);
          outline: none;
        }
        .chat-send-button {
          width: 36px !important;
          min-width: 36px !important;
          height: 36px !important;
          flex: 0 0 36px;
        }
        .chat-composer-meta {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          margin-top: 6px;
        }
        .chat-composer-meta .ant-typography {
          margin: 0;
          font-size: 11px;
        }
        .chat-composer-meta .ant-typography:last-child { white-space: nowrap; }
        .chat-loading {
          height: 100%;
          display: grid;
          place-items: center;
        }
        @media (max-width: 767px) {
          /* The hover-to-preview marker rail doesn't translate to touch —
             hide it and reclaim the left gutter it was reserving. */
          .chat-marker-rail { display: none; }
          .chat-messages { padding: 18px 12px 108px 12px; }
          .chat-messages-empty { padding: 18px 14px; }
          .chat-empty-title { font-size: 25px; }
          .chat-typewriter-line { min-height: 34px; font-size: 23px; }
          .chat-suggestions { grid-template-columns: minmax(0, 1fr); }
          .chat-column { max-width: 90%; }
          .chat-composer { padding: 14px 12px 0; }
          .chat-input-wrap { border-radius: 16px; }
        }
      `}</style>

            <section className='chat-shell' aria-label='Smart Incubation assistant'>
                {isMobile && (
                    <header className='chat-mobile-header'>
                        <button
                            type='button'
                            className='chat-back-button'
                            aria-label='Back to dashboard'
                            onClick={() => navigate(-1)}
                        >
                            <ArrowLeftOutlined />
                        </button>
                        <span className='chat-mobile-header-title'>QxAgent</span>
                        <span className='chat-mobile-header-spacer' aria-hidden='true' />
                    </header>
                )}
                <nav className='chat-marker-rail' aria-label='Conversation messages'>
                    {state.messages.filter(item => item.sender === 'user').map(item => {
                        const messageIndex = state.messages.indexOf(item)
                        const answer = state.messages[messageIndex + 1]?.sender === 'assistant'
                            ? state.messages[messageIndex + 1]
                            : null
                        return (
                            <button
                                className='chat-marker'
                                key={`marker-${item.id}`}
                                type='button'
                                aria-label={`Jump to: ${item.content}`}
                                onClick={() => messageRefs.current[item.id]?.scrollIntoView({ behavior: 'smooth', block: 'center' })}
                            >
                                <span className='chat-marker-tooltip'>
                                    <span className='chat-marker-question'>{item.content}</span>
                                    {answer && <span className='chat-marker-answer'>{answer.content}</span>}
                                </span>
                            </button>
                        )
                    })}
                </nav>
                <div
                    className={`chat-messages ${!hasConversation ? 'chat-messages-empty' : ''}`}
                    ref={messagesRef}
                >
                    {!hasConversation ? (
                        <div className='chat-empty-state'>
                            <div className='chat-empty-icon' aria-hidden='true'>
                                <OpenAIOutlined />
                            </div>
                            <h1 className='chat-empty-title'>
                                Welcome {firstName}, what are we working on today?
                            </h1>
                            <div className='chat-typewriter-line' aria-live='polite'>
                                <span>{typedTopic}</span>
                                <span className='chat-typewriter-cursor' aria-hidden='true' />
                            </div>

                            <div className='chat-suggestions' aria-label='Suggested questions'>
                                {suggestedQuestions.map(question => (
                                    <button
                                        key={question}
                                        type='button'
                                        className='chat-suggestion'
                                        onClick={() => submitMessage(question)}
                                    >
                                        <span>{question}</span>
                                        <span className='chat-suggestion-arrow' aria-hidden='true'>→</span>
                                    </button>
                                ))}
                            </div>

                            <div className='chat-empty-composer'>
                                {renderComposer()}
                            </div>
                        </div>
                    ) : (
                        <>
                            {state.messages.map(item => (
                                <div
                                    className={`chat-row ${item.sender === 'user' ? 'chat-row-user' : ''}`}
                                    key={item.id}
                                    ref={element => { messageRefs.current[item.id] = element }}
                                >
                                    {item.sender === 'assistant' && (
                                        <Avatar
                                            size={30}
                                            icon={<OpenAIOutlined />}
                                            style={{ background: 'var(--app-accent)', flexShrink: 0 }}
                                        />
                                    )}
                                    <div className='chat-column'>
                                        <div className={`chat-bubble chat-bubble-${item.sender}`}>
                                            {item.sender === 'assistant' ? (
                                                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                                                    {item.content}
                                                </ReactMarkdown>
                                            ) : (
                                                <span style={{ whiteSpace: 'pre-wrap' }}>{item.content}</span>
                                            )}
                                            <span className='chat-time'>{item.timestamp}</span>
                                        </div>
                                        {item.chart && (
                                            <ChartSpecRenderer chart={item.chart} className='chat-chart-card' />
                                        )}
                                    </div>
                                </div>
                            ))}

                            {state.isTyping && (
                                <div className='chat-row'>
                                    <Avatar
                                        size={30}
                                        icon={<OpenAIOutlined />}
                                        style={{ background: 'var(--app-accent)' }}
                                    />
                                    <TypingIndicator />
                                </div>
                            )}
                        </>
                    )}
                </div>

                {hasConversation && (
                    <footer className='chat-composer'>
                        {renderComposer(true)}
                    </footer>
                )}

                {conversationMode && (
                    <ConversationMode onClose={() => setConversationMode(false)} />
                )}
            </section>
        </div>
    )
}

export default Chat
