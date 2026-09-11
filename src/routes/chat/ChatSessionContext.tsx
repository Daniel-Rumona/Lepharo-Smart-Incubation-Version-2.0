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
import { auth } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { askAssistant, type ChartSpec } from '@/services/aiAssistantService'

export type ChatMessage = {
    id: string
    sender: 'user' | 'assistant'
    content: string
    chart?: ChartSpec | null
    timestamp: string
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

type ChatSessionValue = ChatState & {
    unreadCount: number
    startMessage: (rawContent: string) => boolean
    clearUnread: () => void
}

export const MAX_MESSAGE_LENGTH = 4000
const MAX_MESSAGES = 100
const SESSION_STORAGE_KEY = 'smart-incubation-chat-session'

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
        default:
            return state
    }
}

const ChatSessionContext = createContext<ChatSessionValue | null>(null)

const timestamp = () => new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit'
})

export const ChatSessionProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
    const { user } = useFullIdentity()
    const location = useLocation()
    const [state, dispatch] = useReducer(chatReducer, initialState)
    const [unreadCount, setUnreadCount] = useState(0)
    const stateRef = useRef(state)
    const locationRef = useRef(location.pathname)
    const sessionIdRef = useRef(sessionStorage.getItem(SESSION_STORAGE_KEY) || '')
    const abortControllerRef = useRef<AbortController | null>(null)
    const messageIdRef = useRef(1)
    const runningRef = useRef(false)

    locationRef.current = location.pathname

    useEffect(() => {
        stateRef.current = state
    }, [state])

    useEffect(() => {
        if (location.pathname === '/chat') setUnreadCount(0)
    }, [location.pathname])

    useEffect(() => () => abortControllerRef.current?.abort(), [])

    const clearUnread = useCallback(() => setUnreadCount(0), [])

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
            sessionStorage.setItem(SESSION_STORAGE_KEY, result.sessionId)
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
    }, [runAssistant])

    const value = useMemo<ChatSessionValue>(() => ({
        ...state,
        unreadCount,
        startMessage,
        clearUnread
    }), [state, unreadCount, startMessage, clearUnread])

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
