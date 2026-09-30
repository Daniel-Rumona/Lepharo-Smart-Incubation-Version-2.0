import React, {
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useReducer,
    useRef,
    useState
} from 'react'
import { message as AntdMessage } from 'antd'
import { useLocation } from 'react-router-dom'
import { collection, getDocs, orderBy, query, where } from 'firebase/firestore'
import { auth, db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { askAssistant, type ChartSpec } from '@/services/aiAssistantService'

export type ChatMessage = {
    id: string
    sender: 'user' | 'assistant'
    content: string
    chart?: ChartSpec | null
    timestamp: string
}

export type ChatSessionSummary = {
    id: string
    title: string
    updatedAtLabel: string
    messageCount: number
}

type ChatState = {
    messages: ChatMessage[]
    isTyping: boolean
    error: string | null
}

type ChatAction =
    | { type: 'ADD_MESSAGE'; payload: ChatMessage }
    | { type: 'SET_TYPING'; payload: boolean }
    | { type: 'SET_ERROR'; payload: string | null }
    | { type: 'LOAD_MESSAGES'; payload: ChatMessage[] }
    | { type: 'RESET' }

type ChatSessionValue = ChatState & {
    unreadCount: number
    startMessage: (rawContent: string) => boolean
    clearUnread: () => void
    startNewChat: () => void
    todaysSessions: ChatSessionSummary[]
    activeSessionId: string
    /** True only until the one-time "resume today's last conversation" check
     * on mount finishes — chat.tsx gates its loading spinner on this so a
     * returning user's messages don't pop in after an already-visible empty
     * screen. Separate from historyLoading, which covers the history modal's
     * own (non-blocking) fetches. */
    isResuming: boolean
    historyLoading: boolean
    refreshHistory: () => Promise<void>
    switchToSession: (sessionId: string) => Promise<void>
}

export const MAX_MESSAGE_LENGTH = 4000
const MAX_MESSAGES = 100

const initialState: ChatState = {
    messages: [],
    isTyping: false,
    error: null
}

const chatReducer = (state: ChatState, action: ChatAction): ChatState => {
    switch (action.type) {
        case 'ADD_MESSAGE': {
            const messages = [...state.messages, action.payload]
            return {
                ...state,
                messages: messages.length > MAX_MESSAGES
                    ? messages.slice(-MAX_MESSAGES)
                    : messages,
                error: null
            }
        }
        case 'SET_TYPING':
            return { ...state, isTyping: action.payload }
        case 'SET_ERROR':
            return { ...state, error: action.payload, isTyping: false }
        case 'LOAD_MESSAGES':
            return { messages: action.payload, isTyping: false, error: null }
        case 'RESET':
            return initialState
        default:
            return state
    }
}

const ChatSessionContext = createContext<ChatSessionValue | null>(null)

const timestamp = (date?: Date) => (date || new Date()).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
})

// Local-calendar-day key, not UTC — "retain conversation for the day" means
// the day as the person sees it, and resets for them at their own midnight.
const todayKey = () => {
    const now = new Date()
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const d = String(now.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
}

const fetchTodaysSessions = async (uid: string): Promise<ChatSessionSummary[]> => {
    const snapshot = await getDocs(
        query(
            collection(db, 'chatSessions'),
            where('userId', '==', uid),
            where('dateKey', '==', todayKey()),
            orderBy('updatedAt', 'desc')
        )
    )
    return snapshot.docs.map(item => {
        const data = item.data() as Record<string, any>
        const updatedAt = data.updatedAt?.toDate ? data.updatedAt.toDate() as Date : null
        return {
            id: item.id,
            title: String(data.title || 'New conversation').trim() || 'New conversation',
            updatedAtLabel: updatedAt ? timestamp(updatedAt) : '',
            messageCount: Number(data.messageCount || 0)
        }
    })
}

const fetchSessionMessages = async (sessionId: string): Promise<ChatMessage[]> => {
    const snapshot = await getDocs(
        query(collection(db, 'chatSessions', sessionId, 'messages'), orderBy('createdAt', 'asc'))
    )
    return snapshot.docs.map(item => {
        const data = item.data() as Record<string, any>
        const createdAt = data.createdAt?.toDate ? data.createdAt.toDate() as Date : null
        return {
            id: item.id,
            sender: data.sender === 'assistant' ? 'assistant' : 'user',
            content: String(data.content || ''),
            chart: data.chart || null,
            timestamp: createdAt ? timestamp(createdAt) : ''
        }
    })
}

export const ChatSessionProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
    const { user } = useFullIdentity()
    const location = useLocation()
    const [state, dispatch] = useReducer(chatReducer, initialState)
    const [unreadCount, setUnreadCount] = useState(0)
    const [todaysSessions, setTodaysSessions] = useState<ChatSessionSummary[]>([])
    const [activeSessionId, setActiveSessionId] = useState('')
    const [isResuming, setIsResuming] = useState(true)
    const [historyLoading, setHistoryLoading] = useState(false)
    const stateRef = useRef(state)
    const locationRef = useRef(location.pathname)
    const sessionIdRef = useRef('')
    const abortControllerRef = useRef<AbortController | null>(null)
    const messageIdRef = useRef(1)
    const runningRef = useRef(false)
    const resumedRef = useRef(false)

    locationRef.current = location.pathname

    useEffect(() => {
        stateRef.current = state
    }, [state])

    useEffect(() => {
        if (location.pathname === '/chat') setUnreadCount(0)
    }, [location.pathname])

    useEffect(() => () => abortControllerRef.current?.abort(), [])

    const clearUnread = useCallback(() => setUnreadCount(0), [])

    const refreshHistory = useCallback(async () => {
        const uid = user?.uid || user?.id
        if (!uid) return
        setHistoryLoading(true)
        try {
            const sessions = await fetchTodaysSessions(uid)
            setTodaysSessions(sessions)
        } catch {
            // History is a convenience layer over data that's already safely
            // persisted server-side — a failed read here shouldn't be a hard error.
        } finally {
            setHistoryLoading(false)
        }
    }, [user?.uid, user?.id])

    // Always start chat at the last conversation: once, per sign-in, pick up
    // today's most recently updated session (if any) instead of an empty
    // screen. A previous day's conversation is never auto-resumed — it stays
    // reachable only as history (and forever, server-side, for training).
    useEffect(() => {
        const uid = user?.uid || user?.id
        if (!uid || resumedRef.current) return
        resumedRef.current = true

        void (async () => {
            try {
                const sessions = await fetchTodaysSessions(uid)
                setTodaysSessions(sessions)
                const mostRecent = sessions[0]
                if (mostRecent) {
                    const messages = await fetchSessionMessages(mostRecent.id)
                    sessionIdRef.current = mostRecent.id
                    setActiveSessionId(mostRecent.id)
                    dispatch({ type: 'LOAD_MESSAGES', payload: messages })
                }
            } catch {
                // Fall back silently to a fresh, empty chat.
            } finally {
                setIsResuming(false)
            }
        })()
    }, [user?.uid, user?.id])

    const switchToSession = useCallback(async (sessionId: string) => {
        if (sessionId === sessionIdRef.current) return
        setHistoryLoading(true)
        try {
            const messages = await fetchSessionMessages(sessionId)
            sessionIdRef.current = sessionId
            setActiveSessionId(sessionId)
            dispatch({ type: 'LOAD_MESSAGES', payload: messages })
        } catch {
            AntdMessage.error('Could not load that conversation.')
        } finally {
            setHistoryLoading(false)
        }
    }, [])

    const startNewChat = useCallback(() => {
        abortControllerRef.current?.abort()
        runningRef.current = false
        sessionIdRef.current = ''
        setActiveSessionId('')
        dispatch({ type: 'RESET' })
    }, [])

    const runAssistant = useCallback(async (
        content: string,
        previousMessages: ChatMessage[],
        requestRoute: string
    ) => {
        const firebaseUser = auth.currentUser
        if (!firebaseUser) throw new Error('Please sign in again to use the assistant.')

        const controller = new AbortController()
        abortControllerRef.current = controller
        const activeProgramId =
            (window as any).__ACTIVE_PROGRAM_ID__ ||
            window.localStorage.getItem('activeProgramId') ||
            null

        const result = await askAssistant({
            message: content,
            route: requestRoute,
            user: {
                uid: user?.uid || user?.id || null,
                email: user?.email || null,
                role: user?.role || null,
                participantId: user?.participantId || null,
                consultantId: user?.consultantId || null,
                departmentId: user?.departmentId || null,
                programId: activeProgramId
            },
            pageContext: { activeProgramId },
            sessionId: sessionIdRef.current || undefined,
            history: previousMessages.slice(-10).map(item => ({
                role: item.sender === 'assistant' ? ('assistant' as const) : ('user' as const),
                content: item.content
            })),
            signal: controller.signal
        })

        if (result.sessionId) {
            sessionIdRef.current = result.sessionId
            setActiveSessionId(result.sessionId)
        }

        return result
    }, [user])

    const startMessage = useCallback((rawContent: string) => {
        const content = rawContent.trim()
        if (!content || runningRef.current) return false
        if (content.length > MAX_MESSAGE_LENGTH) {
            const error = `Messages are limited to ${MAX_MESSAGE_LENGTH.toLocaleString()} characters.`
            dispatch({ type: 'SET_ERROR', payload: error })
            AntdMessage.error(error)
            return false
        }

        const previousMessages = stateRef.current.messages
        const requestRoute = locationRef.current
        runningRef.current = true
        dispatch({
            type: 'ADD_MESSAGE',
            payload: {
                id: `user-${Date.now()}-${messageIdRef.current++}`,
                sender: 'user',
                content,
                timestamp: timestamp()
            }
        })
        dispatch({ type: 'SET_TYPING', payload: true })

        void runAssistant(content, previousMessages, requestRoute)
            .then(({ answer, chart }) => {
                dispatch({
                    type: 'ADD_MESSAGE',
                    payload: {
                        id: `assistant-${Date.now()}-${messageIdRef.current++}`,
                        sender: 'assistant',
                        content: answer,
                        chart,
                        timestamp: timestamp()
                    }
                })
                if (locationRef.current !== '/chat') {
                    setUnreadCount(current => current + 1)
                }
                void refreshHistory()
            })
            .catch(error => {
                if (error instanceof DOMException && error.name === 'AbortError') return
                const text = error instanceof Error
                    ? error.message
                    : 'The assistant is unavailable right now.'
                dispatch({ type: 'SET_ERROR', payload: text })
                AntdMessage.error(text)
            })
            .finally(() => {
                runningRef.current = false
                abortControllerRef.current = null
                dispatch({ type: 'SET_TYPING', payload: false })
            })

        return true
    }, [runAssistant, refreshHistory])

    const value = useMemo<ChatSessionValue>(() => ({
        ...state,
        unreadCount,
        startMessage,
        clearUnread,
        startNewChat,
        todaysSessions,
        activeSessionId,
        isResuming,
        historyLoading,
        refreshHistory,
        switchToSession
    }), [
        state,
        unreadCount,
        startMessage,
        clearUnread,
        startNewChat,
        todaysSessions,
        activeSessionId,
        isResuming,
        historyLoading,
        refreshHistory,
        switchToSession
    ])

    return (
        <ChatSessionContext.Provider value={value}>
            {children}
        </ChatSessionContext.Provider>
    )
}

export const useChatSession = () => {
    const context = useContext(ChatSessionContext)
    if (!context) throw new Error('useChatSession must be used within ChatSessionProvider')
    return context
}
