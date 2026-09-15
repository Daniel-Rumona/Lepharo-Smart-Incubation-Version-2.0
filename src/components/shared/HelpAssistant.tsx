// src/components/shared/HelpAssistant.tsx
import React, { useEffect, useRef, useState } from 'react'
import {
    FloatButton,
    Modal,
    Input,
    Button,
    Space,
    Tag,
    Typography,
    Divider,
    theme
} from 'antd'
import {
    ArrowUpOutlined,
    CompassOutlined,
    QuestionCircleOutlined,
    SendOutlined
} from '@ant-design/icons'
import { useLocation, useNavigate } from 'react-router-dom'
import { useFullIdentity } from '@/hooks/src/useFullIdentity'
import { askAssistant } from '@/services/aiAssistantService'
import {
    ASSISTANT_GUIDE_CATALOG,
    useGuide,
    type CatalogGuide
} from '@/components/guide-me'

const { Text } = Typography

type ChatMessage = {
    id: string
    from: 'user' | 'bot'
    text: string
    guide?: CatalogGuide | null
}

const delay = (ms: number) =>
    new Promise(resolve => setTimeout(resolve, ms))

export const HelpAssistant: React.FC = () => {
    const navigate = useNavigate()
    const { token } = theme.useToken()
    const location = useLocation()
    const { user } = useFullIdentity()
    const { startGuideOnPage } = useGuide()

    const role =
        (user as any)?.role || 'incubatee'

    const userId =
        (user as any)?.uid ||
        (user as any)?.id ||
        ''

    const email =
        (user as any)?.email || ''

    const participantId =
        (user as any)?.participantId

    const [open, setOpen] = useState(false)
    const [input, setInput] = useState('')

    const [msgs, setMsgs] = useState<ChatMessage[]>([
        {
            id: 'welcome',
            from: 'bot',
            text: 'Hi, how can I help?'
        }
    ])

    const [showSuggest, setShowSuggest] = useState(true)

    const [isTyping, setIsTyping] =
        useState(false)

    const [isSending, setIsSending] =
        useState(false)

    const listRef = useRef<HTMLDivElement>(null)
    const hasUserSpoken = useRef(false)
    const sessionIdRef = useRef<string | undefined>(undefined)

    useEffect(() => {
        if (!open) {
            const timeout = window.setTimeout(() => {
                setShowSuggest(true)
                hasUserSpoken.current = false
            }, 220)

            return () =>
                window.clearTimeout(timeout)
        }
    }, [open])

    const send = (
        text: string,
        from: 'user' | 'bot' = 'bot',
        guide?: CatalogGuide | null
    ) => {
        setMsgs(current => [
            ...current,
            {
                id: `${Date.now()}-${Math.random()}`,
                from,
                text,
                guide
            }
        ])

        requestAnimationFrame(() => {
            listRef.current?.scrollTo({
                top: 999999,
                behavior: 'smooth'
            })
        })
    }

    const closeModal = () => {
        setOpen(false)
    }

    const goToGuide = async (guide: CatalogGuide) => {
        closeModal()

        await delay(150)

        navigate(guide.route)
        startGuideOnPage(guide.pageId, guide.guideId)
    }

    const askServer = async (question: string) => {
        setIsTyping(true)

        try {
            const history = msgs
                .filter(message => message.text)
                .slice(-10)
                .map(message => ({
                    role: (message.from === 'user'
                        ? 'user'
                        : 'assistant') as 'user' | 'assistant',
                    content: message.text
                }))

            const result = await askAssistant({
                message: question,
                route: location.pathname,
                user: {
                    uid: userId,
                    email,
                    role,
                    participantId
                },
                pageContext: {
                    availableGuides: ASSISTANT_GUIDE_CATALOG
                },
                history,
                sessionId: sessionIdRef.current
            })

            sessionIdRef.current = result.sessionId

            send(result.answer, 'bot', result.guide)
        } catch (error) {
            console.error(
                'Help assistant error:',
                error
            )

            send(
                error instanceof Error && error.message
                    ? error.message
                    : "I couldn't reach the assistant right now. Please try again in a moment.",
                'bot'
            )
        } finally {
            setIsTyping(false)
        }
    }

    const onAsk = async () => {
        const question = input.trim()

        if (
            !question ||
            isSending ||
            isTyping
        ) {
            return
        }

        setInput('')
        setIsSending(true)

        if (!hasUserSpoken.current) {
            hasUserSpoken.current = true
            setShowSuggest(false)
        }

        send(question, 'user')

        await askServer(question)

        setIsSending(false)
    }

    const handleQuickOption = async (
        guide: CatalogGuide
    ) => {
        if (
            isTyping ||
            isSending
        ) {
            return
        }

        if (!hasUserSpoken.current) {
            hasUserSpoken.current = true
            setShowSuggest(false)
        }

        send(guide.title, 'user')

        setIsSending(true)
        await askServer(guide.title)
        setIsSending(false)
    }

    return (
        <>
            <style>{`
                @keyframes helpTypingBounce {
                    0%, 80%, 100% {
                        transform: translateY(0);
                        opacity: 0.6;
                    }

                    40% {
                        transform: translateY(-5px);
                        opacity: 1;
                    }
                }

                .help-typing-bubble {
                    display: inline-flex;
                    gap: 4px;
                    align-items: center;
                    padding: 8px 12px;
                    background: #f5f5f5;
                    border-radius: 12px;
                }

                .help-typing-dot {
                    width: 6px;
                    height: 6px;
                    border-radius: 50%;
                    background: #999;
                    animation:
                        helpTypingBounce
                        1.4s
                        infinite
                        ease-in-out
                        both;
                }

                .help-typing-dot:nth-child(1) {
                    animation-delay: -0.32s;
                }

                .help-typing-dot:nth-child(2) {
                    animation-delay: -0.16s;
                }

                .help-typing-dot:nth-child(3) {
                    animation-delay: 0;
                }
            `}</style>

            <FloatButton
                type="primary"
                icon={
                    <QuestionCircleOutlined />
                }
                tooltip="Help"
                style={{
                    right: 24,
                    bottom: 24,
                    zIndex: 1000
                }}
                onClick={() =>
                    setOpen(true)
                }
            />

            <Modal
                title="Need a hand?"
                open={open}
                onCancel={closeModal}
                footer={null}
                centered
                width={520}
                destroyOnHidden
                styles={{
                    header: {
                        textAlign: 'center',
                        marginBottom: 0,
                        background: token.colorBgElevated
                    },
                    body: {
                        paddingTop: 12,
                        background: token.colorBgElevated
                    },
                    content: {
                        borderRadius: 18,
                        overflow: 'hidden',
                        background: token.colorBgElevated,
                        border: `1px solid ${token.colorBorderSecondary}`,
                        boxShadow: token.boxShadowSecondary
                    }
                }}
            >
                <div
                    style={{
                        display: 'flex',
                        flexDirection: 'column',
                        height: 420,
                        maxHeight: '70vh'
                    }}
                >
                    <div
                        ref={listRef}
                        style={{
                            flex: 1,
                            minHeight: 0,
                            overflowY: 'auto',
                            padding: '6px 2px 12px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 8
                        }}
                    >
                        {msgs.map(message => {
                            const isUser = message.from === 'user'

                            return (
                                <div
                                    key={message.id}
                                    style={{
                                        display: 'flex',
                                        flexDirection: 'column',
                                        alignItems: isUser
                                            ? 'flex-end'
                                            : 'flex-start',
                                        gap: 6,
                                        maxWidth: '82%',
                                        alignSelf: isUser
                                            ? 'flex-end'
                                            : 'flex-start'
                                    }}
                                >
                                    <div
                                        style={{
                                            background: isUser
                                                ? token.colorPrimary
                                                : token.colorFillTertiary,
                                            color: isUser
                                                ? token.colorTextLightSolid
                                                : token.colorText,
                                            padding: '9px 12px',
                                            borderRadius: isUser
                                                ? '14px 14px 4px 14px'
                                                : '14px 14px 14px 4px',
                                            border: isUser
                                                ? 'none'
                                                : `1px solid ${token.colorBorderSecondary}`
                                        }}
                                    >
                                        <Text
                                            style={{
                                                color: 'inherit'
                                            }}
                                        >
                                            {message.text}
                                        </Text>
                                    </div>

                                    {message.guide && (
                                        <Button
                                            size="small"
                                            icon={<CompassOutlined />}
                                            onClick={() =>
                                                goToGuide(message.guide!)
                                            }
                                            style={{
                                                borderRadius: 999,
                                                border: `1px solid ${token.colorPrimaryBorder}`,
                                                background: token.colorPrimaryBg,
                                                color: token.colorPrimaryText
                                            }}
                                        >
                                            Guide Me
                                        </Button>
                                    )}
                                </div>
                            )
                        })}

                        {isTyping && (
                            <div
                                className="help-typing-bubble"
                                style={{
                                    alignSelf: 'flex-start',
                                    background:
                                        token.colorFillTertiary,
                                    border: `1px solid ${token.colorBorderSecondary}`
                                }}
                            >
                                <span
                                    className="help-typing-dot"
                                    style={{
                                        background:
                                            token.colorTextSecondary
                                    }}
                                />
                                <span
                                    className="help-typing-dot"
                                    style={{
                                        background:
                                            token.colorTextSecondary
                                    }}
                                />
                                <span
                                    className="help-typing-dot"
                                    style={{
                                        background:
                                            token.colorTextSecondary
                                    }}
                                />
                            </div>
                        )}
                    </div>

                    {showSuggest && (
                        <div
                            style={{
                                textAlign: 'center'
                            }}
                        >
                            <Divider
                                style={{
                                    margin: '8px 0 10px',
                                    borderColor:
                                        token.colorBorderSecondary
                                }}
                            />

                            <Space
                                wrap
                                size={[6, 6]}
                                style={{
                                    justifyContent: 'center',
                                    width: '100%'
                                }}
                            >
                                {ASSISTANT_GUIDE_CATALOG.map(guide => (
                                    <Tag
                                        key={guide.guideId}
                                        onClick={() =>
                                            handleQuickOption(guide)
                                        }
                                        style={{
                                            cursor:
                                                isTyping || isSending
                                                    ? 'default'
                                                    : 'pointer',
                                            padding: '5px 11px',
                                            borderRadius: 999,
                                            marginInlineEnd: 0,
                                            background:
                                                token.colorPrimaryBg,
                                            border: `1px solid ${token.colorPrimaryBorder}`,
                                            color:
                                                token.colorPrimaryText
                                        }}
                                    >
                                        {guide.title}
                                    </Tag>
                                ))}
                            </Space>
                        </div>
                    )}

                    <div
                        style={{
                            paddingTop: 12,
                            marginTop: 10,
                            borderTop: `1px solid ${token.colorBorderSecondary}`
                        }}
                    >
                        <Input
                            placeholder="Ask a question"
                            value={input}
                            onChange={event =>
                                setInput(event.target.value)
                            }
                            onPressEnter={onAsk}
                            disabled={
                                isTyping || isSending
                            }
                            size="large"
                            suffix={
                                <Button
                                    type="primary"
                                    shape="circle"
                                    size="small"
                                    icon={<ArrowUpOutlined />}
                                    onClick={onAsk}
                                    disabled={
                                        !input.trim() ||
                                        isTyping ||
                                        isSending
                                    }
                                    loading={isSending}
                                    aria-label="Send question"
                                    style={{
                                        flexShrink: 0
                                    }}
                                />
                            }
                            styles={{
                                input: {
                                    paddingRight: 6
                                }
                            }}
                            style={{
                                borderRadius: 999,
                                background:
                                    token.colorBgContainer,
                                borderColor:
                                    token.colorBorder,
                                paddingInline: 14
                            }}
                        />
                    </div>
                </div>
            </Modal>
        </>
    )
}
