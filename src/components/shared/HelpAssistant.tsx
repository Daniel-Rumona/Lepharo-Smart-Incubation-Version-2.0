// src/components/shared/HelpAssistant.tsx
import React, { useRef, useState, useEffect } from 'react'
import {
    FloatButton,
    Drawer,
    Input,
    Button,
    Space,
    Tag,
    Typography,
    Divider
} from 'antd'
import { QuestionCircleOutlined, SendOutlined } from '@ant-design/icons'
import { useLocation, useNavigate } from 'react-router-dom'
import { useFullIdentity } from '@/hooks/src/useFullIdentity'

const { Text, Paragraph } = Typography

const ASSIST_ENDPOINT = 'https://yoursdvniel-bonganichat.hf.space/assist'
const CHAT_ENDPOINT = 'https://yoursdvniel-bonganichat.hf.space/chat'

type IntentKey =
    | 'where_apply'
    | 'track_application'
    | 'inquiries'
    | 'profile_setup'
    | 'contact_support'

type ServerReply = {
    reply?: string
    navigate?: {
        to: string
        tour?: string | null
        ts?: number
        delayMs?: number
        replace?: boolean
    } | null
    // NOTE: `handoff` is optional server-side; we don’t rely on it being present.
    handoff?: {
        open?: boolean
        botText?: string
        followups?: IntentKey[]
        displayImmediately?: boolean
    } | null
    error?: string
    llm?: boolean
}

const DEFAULT_SUGGEST: IntentKey[] = [
    'where_apply',
    'track_application',
    'inquiries',
    'profile_setup'
]

const delay = (ms: number) => new Promise(res => setTimeout(res, ms))

const withTour = (to: string, tourKey?: string | null) => {
    const ts = `ts=${Date.now()}`
    if (!tourKey) return `${to}${to.includes('?') ? '&' : '?'}${ts}`
    const sep = to.includes('?') ? '&' : '?'
    return `${to}${sep}tour=${tourKey}&${ts}`
}

export const HelpAssistant: React.FC = () => {
    const navigate = useNavigate()
    const location = useLocation()
    const { user } = useFullIdentity()

    // Resolve identity safely
    const role = (user as any)?.role || 'incubatee'
    const userId = (user as any)?.uid || (user as any)?.id || ''
    const email = (user as any)?.email || ''
    const departmentId =
        (user as any)?.departmentId || (user as any)?.department_id
    const departmentName =
        (user as any)?.departmentName || (user as any)?.department_name

    const [open, setOpen] = useState(false)
    const [input, setInput] = useState('')
    const [msgs, setMsgs] = useState<
        { id: string; from: 'user' | 'bot'; text: string }[]
    >([
        {
            id: 'welcome',
            from: 'bot',
            text: 'Hi! How can I help? Try a quick question below or ask me in your own words.'
        }
    ])
    const [suggest, setSuggest] = useState<IntentKey[]>(DEFAULT_SUGGEST)
    const [isTyping, setIsTyping] = useState(false)
    const [isSending, setIsSending] = useState(false) // debounce send

    const listRef = useRef<HTMLDivElement>(null)
    const hasUserSpoken = useRef(false)

    // rejuvenate quick actions when the drawer closes
    useEffect(() => {
        if (!open) {
            const t = setTimeout(() => {
                setSuggest(DEFAULT_SUGGEST)
                hasUserSpoken.current = false
            }, 220)
            return () => clearTimeout(t)
        }
    }, [open])

    // show a message bubble
    const send = (text: string, from: 'user' | 'bot' = 'bot') => {
        setMsgs(m => [...m, { id: `${Date.now()}-${Math.random()}`, from, text }])
        requestAnimationFrame(() => {
            listRef.current?.scrollTo({ top: 9e9, behavior: 'smooth' })
        })
    }

    const closeDrawer = () => setOpen(false)

    // route with a small “see message” delay
    const routeWithMessage = async ({
        msg,
        to,
        tourKey,
        delayMs = 900,
        replace
    }: {
        msg?: string
        to: string
        tourKey?: string | null
        delayMs?: number
        replace?: boolean
    }) => {
        if (msg) send(msg)
        await delay(delayMs ?? 900)
        closeDrawer()

        const finalUrl = withTour(to, tourKey ?? undefined)
        const targetPath = finalUrl.split('?')[0]
        const onTarget = location.pathname === targetPath

        await delay(50)

        if (onTarget) {
            navigate(finalUrl, { replace: true })
            if (tourKey) {
                setTimeout(() => {
                    window.dispatchEvent(
                        new CustomEvent('sme:start-tour', { detail: { key: tourKey } })
                    )
                }, 150)
            }
        } else {
            navigate(finalUrl, { replace: !!replace })
        }
    }

    // POST helper
    async function postJSON<T>(url: string, body: unknown): Promise<T> {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return (await res.json()) as T
    }

    // Fast intent detection & routing
    const askAssist = async (q: string) => {
        return postJSON<ServerReply>(ASSIST_ENDPOINT, {
            role,
            message: q,
            userId,
            path: location.pathname
        })
    }

    // Rich answer with Firestore grounding
    const askChat = async (q: string) => {
        return postJSON<{ reply?: string }>(CHAT_ENDPOINT, {
            role,
            message: q,
            userId,
            userContext: {
                role,
                uid: userId,
                email,
                departmentId,
                departmentName
            }
        })
    }

    // Orchestrate the ask flow
    const askServer = async (q: string) => {
        setIsTyping(true)
        try {
            // 1) ask /assist (fast)
            const assist = await askAssist(q)

            // If /assist produced an immediate reply, show it
            if (assist.reply) send(assist.reply, 'bot')

            // If /assist instructed a navigation/tour, do it and exit
            if (assist.navigate?.to) {
                setIsTyping(false)
                await routeWithMessage({
                    msg: '', // already showed assist.reply
                    to: assist.navigate.to,
                    tourKey: assist.navigate.tour ?? undefined,
                    delayMs: assist.navigate.delayMs ?? 900,
                    replace: assist.navigate.replace
                })
                return
            }

            // If assist already produced an LLM-style answer, skip /chat to avoid doubles
            if (assist.llm) return

            // 2) No nav — ask /chat for a fuller grounded answer
            const chat = await askChat(q)
            if (chat?.reply) send(chat.reply, 'bot')
        } catch (e) {
            // Fallback: minimal prompt
            send(
                "I couldn't reach the assistant right now. Try one of the quick options below.",
                'bot'
            )
            setSuggest(DEFAULT_SUGGEST)
        } finally {
            setIsTyping(false)
        }
    }

    const onAsk = async () => {
        const q = input.trim()
        if (!q || isSending) return
        setInput('')
        setIsSending(true)

        if (!hasUserSpoken.current) {
            hasUserSpoken.current = true
            setSuggest([]) // hide all quick actions after first interaction
        }

        send(q, 'user')
        await askServer(q)

        setIsSending(false)
    }

    // Labels for quick actions
    const labelMap: Record<IntentKey, string> = {
        where_apply: 'Where do I apply?',
        track_application: 'Track my application',
        inquiries: 'Inquiries',
        profile_setup: 'Why am I redirected to profile?',
        contact_support: 'Contact support'
    }

    return (
        <>
            <style>{`
        @keyframes bounce {
          0%, 80%, 100% { transform: translateY(0); opacity: .6; }
          40% { transform: translateY(-5px); opacity: 1; }
        }
        .typing-bubble {
          display: inline-flex;
          gap: 4px;
          align-items: center;
          padding: 8px 12px;
          background: #f5f5f5;
          border-radius: 12px;
        }
        .typing-dot {
          width: 6px; height: 6px; border-radius: 50%;
          background: #999;
          animation: bounce 1.4s infinite ease-in-out both;
        }
        .typing-dot:nth-child(1) { animation-delay: -0.32s; }
        .typing-dot:nth-child(2) { animation-delay: -0.16s; }
        .typing-dot:nth-child(3) { animation-delay: 0; }
      `}</style>

            <FloatButton
                type='primary'
                icon={<QuestionCircleOutlined />}
                tooltip='Help'
                style={{ right: 24, bottom: 24, zIndex: 1000 }}
                onClick={() => setOpen(true)}
            />

            <Drawer
                title='Need a hand?'
                placement='right'
                width={Math.min(
                    420,
                    typeof window !== 'undefined' ? window.innerWidth * 0.95 : 420
                )}
                onClose={() => setOpen(false)}
                open={open}
                styles={{ body: { padding: 0 } }}
            >
                <div
                    style={{ display: 'flex', flexDirection: 'column', height: '100%' }}
                >
                    {/* Messages */}
                    <div
                        ref={listRef}
                        style={{
                            flex: 1,
                            overflow: 'auto',
                            padding: 16,
                            gap: 8,
                            display: 'flex',
                            flexDirection: 'column'
                        }}
                    >
                        {msgs.map(m => (
                            <div
                                key={m.id}
                                style={{
                                    alignSelf: m.from === 'user' ? 'flex-end' : 'flex-start',
                                    background: m.from === 'user' ? '#1677ff' : '#f5f5f5',
                                    color: m.from === 'user' ? '#fff' : '#333',
                                    padding: '8px 12px',
                                    borderRadius: 12,
                                    maxWidth: '85%'
                                }}
                            >
                                <Text style={{ color: 'inherit' }}>{m.text}</Text>
                            </div>
                        ))}

                        {/* Typing indicator */}
                        {isTyping && (
                            <div
                                className='typing-bubble'
                                style={{ alignSelf: 'flex-start' }}
                            >
                                <span className='typing-dot' />
                                <span className='typing-dot' />
                                <span className='typing-dot' />
                            </div>
                        )}
                    </div>

                    {/* Quick suggestions (hidden after first user input; restored on close) */}
                    {!!suggest.length && (
                        <div style={{ padding: '8px 16px' }}>
                            <Divider style={{ margin: '8px 0' }} />
                            <Space wrap>
                                {DEFAULT_SUGGEST.filter(k => suggest.includes(k)).map(key => (
                                    <Tag
                                        key={key}
                                        color='blue'
                                        style={{
                                            cursor: 'pointer',
                                            padding: '6px 10px',
                                            borderRadius: 9999
                                        }}
                                        onClick={() => {
                                            if (!hasUserSpoken.current) {
                                                hasUserSpoken.current = true
                                                setSuggest([])
                                            }
                                            const q = labelMap[key]
                                            send(q, 'user')
                                            askServer(q)
                                        }}
                                    >
                                        {labelMap[key]}
                                    </Tag>
                                ))}
                            </Space>
                        </div>
                    )}

                    {/* Input row */}
                    <div style={{ padding: 12, borderTop: '1px solid #f0f0f0' }}>
                        <Space.Compact style={{ width: '100%' }}>
                            <Input
                                placeholder="Ask a question… e.g., 'How do I apply?'"
                                value={input}
                                onChange={e => setInput(e.target.value)}
                                onPressEnter={onAsk}
                                disabled={isTyping || isSending}
                            />
                            <Button
                                type='primary'
                                icon={<SendOutlined />}
                                onClick={onAsk}
                                disabled={isTyping || isSending}
                                loading={isSending}
                            >
                                Ask
                            </Button>
                        </Space.Compact>
                        <Paragraph type='secondary' style={{ marginTop: 6, fontSize: 12 }}>
                            Tip: Try “Where do I apply?”, “Track my application”, “Inquiries”,
                            or “Why am I redirected to profile?”
                        </Paragraph>
                    </div>
                </div>
            </Drawer>
        </>
    )
}
