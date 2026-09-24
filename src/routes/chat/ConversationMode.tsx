import React, { useEffect, useRef, useState } from 'react'
import { Avatar, Button, Input } from 'antd'
import { AudioMutedOutlined, AudioOutlined, CloseOutlined, OpenAIOutlined, SendOutlined } from '@ant-design/icons'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { MAX_MESSAGE_LENGTH, useChatSession } from '@/routes/chat/ChatSessionContext'
import { synthesizeSpeech } from '@/services/aiAssistantService'
import { VoiceOrb, type VoiceOrbMode } from '@/routes/chat/VoiceOrb'
import './conversation-mode.css'

const { TextArea } = Input

// Approximates how long ElevenLabs playback of a reply would take, so the
// orb's "speaking" phase has a believable duration until real audio drives
// it. ~2.5 words/sec is a conversational speech pace.
const estimateSpeakingMs = (text: string) => {
    const words = text.trim().split(/\s+/).filter(Boolean).length
    return Math.min(8000, Math.max(1500, (words / 2.5) * 1000))
}

// The Web Speech API has no lib.dom typings and is only exposed under a
// vendor prefix in Chromium — feature-detect and treat everything from it as
// `any` rather than pulling in a typings package for one narrow use.
const getSpeechRecognitionCtor = (): (new () => any) | null => {
    if (typeof window === 'undefined') return null
    return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null
}

const MIC_ERROR_MESSAGES: Record<string, string> = {
    'not-allowed': 'Microphone access was denied — allow it in your browser settings to talk.',
    'no-speech': "I didn't catch that — try again.",
    'audio-capture': 'No microphone was found.',
    network: 'Voice input needs a network connection.'
}

interface ConversationModeProps {
    onClose: () => void
}

export const ConversationMode: React.FC<ConversationModeProps> = ({ onClose }) => {
    const { messages, isTyping, startMessage } = useChatSession()
    const [phase, setPhase] = useState<VoiceOrbMode>(isTyping ? 'thinking' : 'idle')
    const [muted, setMuted] = useState(false)
    const [draft, setDraft] = useState('')
    const [micError, setMicError] = useState<string | null>(null)
    const [speakingAudioEl, setSpeakingAudioEl] = useState<HTMLAudioElement | null>(null)
    const speakingTimeoutRef = useRef<number>()
    const lastMessageCountRef = useRef(messages.length)
    const recognitionRef = useRef<any>(null)
    const finalTranscriptRef = useRef('')
    const voiceSupported = useRef(!!getSpeechRecognitionCtor()).current
    const messagesRef = useRef<HTMLDivElement | null>(null)
    const currentAudioRef = useRef<HTMLAudioElement | null>(null)
    const currentAudioUrlRef = useRef<string | null>(null)
    const ttsAbortRef = useRef<AbortController | null>(null)

    useEffect(() => {
        const element = messagesRef.current
        if (element) element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' })
    }, [messages, isTyping])

    useEffect(() => {
        if (!isTyping) return
        window.clearTimeout(speakingTimeoutRef.current)
        setPhase('thinking')
    }, [isTyping])

    const stopSpeaking = () => {
        ttsAbortRef.current?.abort()
        ttsAbortRef.current = null
        window.clearTimeout(speakingTimeoutRef.current)
        if (currentAudioRef.current) {
            currentAudioRef.current.onended = null
            currentAudioRef.current.onerror = null
            currentAudioRef.current.pause()
            currentAudioRef.current = null
        }
        if (currentAudioUrlRef.current) {
            URL.revokeObjectURL(currentAudioUrlRef.current)
            currentAudioUrlRef.current = null
        }
        setSpeakingAudioEl(null)
    }

    // Timed fallback for when ElevenLabs isn't configured or the request
    // fails — the orb still mimics a plausible speaking duration from the
    // reply's length, so voice being unavailable never breaks the flow.
    const fallbackTimedSpeaking = (text: string) => {
        setSpeakingAudioEl(null)
        speakingTimeoutRef.current = window.setTimeout(
            () => setPhase(current => (current === 'speaking' ? 'idle' : current)),
            estimateSpeakingMs(text)
        )
    }

    const playReply = async (text: string) => {
        setPhase('speaking')
        const controller = new AbortController()
        ttsAbortRef.current = controller
        try {
            const blob = await synthesizeSpeech(text, controller.signal)
            if (controller.signal.aborted) return

            const url = URL.createObjectURL(blob)
            const audio = new Audio(url)
            currentAudioRef.current = audio
            currentAudioUrlRef.current = url

            audio.onended = () => {
                URL.revokeObjectURL(url)
                if (currentAudioUrlRef.current === url) currentAudioUrlRef.current = null
                if (currentAudioRef.current === audio) currentAudioRef.current = null
                setSpeakingAudioEl(current => (current === audio ? null : current))
                setPhase(current => (current === 'speaking' ? 'idle' : current))
            }
            audio.onerror = () => {
                URL.revokeObjectURL(url)
                if (currentAudioUrlRef.current === url) currentAudioUrlRef.current = null
                fallbackTimedSpeaking(text)
            }

            setSpeakingAudioEl(audio)
            await audio.play()
        } catch {
            if (controller.signal.aborted) return
            fallbackTimedSpeaking(text)
        }
    }

    useEffect(() => {
        if (messages.length <= lastMessageCountRef.current) {
            lastMessageCountRef.current = messages.length
            return
        }
        const latest = messages[messages.length - 1]
        lastMessageCountRef.current = messages.length
        if (latest.sender !== 'assistant') return

        stopSpeaking()
        void playReply(latest.content)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [messages])

    const detachRecognition = () => {
        const recognition = recognitionRef.current
        if (!recognition) return
        recognition.onresult = null
        recognition.onerror = null
        recognition.onend = null
        try {
            recognition.abort()
        } catch {
            // already stopped
        }
        recognitionRef.current = null
    }

    useEffect(() => () => {
        detachRecognition()
        stopSpeaking()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])

    const sendMessage = (text: string) => {
        const content = text.trim()
        if (!content) return
        detachRecognition()
        stopSpeaking()
        setPhase(current => (current === 'listening' || current === 'speaking' ? 'idle' : current))
        if (startMessage(content)) setDraft('')
    }

    const startListening = () => {
        const Ctor = getSpeechRecognitionCtor()
        if (!Ctor) {
            setMicError('Voice input is not supported in this browser — type your message instead.')
            return
        }

        setMicError(null)
        setDraft('')
        finalTranscriptRef.current = ''

        const recognition = new Ctor()
        recognition.lang = navigator.language || 'en-US'
        recognition.interimResults = true
        recognition.continuous = false
        recognition.maxAlternatives = 1

        recognition.onresult = (event: any) => {
            let finalText = ''
            let interimText = ''
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const result = event.results[i]
                if (result.isFinal) finalText += result[0].transcript
                else interimText += result[0].transcript
            }
            if (finalText.trim()) finalTranscriptRef.current = finalText.trim()
            // Mirrors what's being heard straight into the composer, like
            // dictation — the same box someone would otherwise type into.
            setDraft(finalTranscriptRef.current || interimText)
        }

        recognition.onerror = (event: any) => {
            if (event.error === 'aborted') return
            setMicError(MIC_ERROR_MESSAGES[event.error] || 'Voice input failed — please try again.')
        }

        recognition.onend = () => {
            recognitionRef.current = null
            const transcript = finalTranscriptRef.current
            finalTranscriptRef.current = ''
            setPhase(current => (current === 'listening' ? 'idle' : current))
            if (transcript) sendMessage(transcript)
        }

        recognitionRef.current = recognition
        setPhase('listening')
        try {
            recognition.start()
        } catch {
            recognitionRef.current = null
            setPhase('idle')
        }
    }

    const stopListening = () => {
        recognitionRef.current?.stop()
    }

    // "Always on": once conversation mode is open and not muted, listening
    // restarts automatically every time we settle back to idle — after a
    // reply finishes, after a false start, whatever — so talking again never
    // needs another tap. Gated on !isTyping too so a reply already in flight
    // can't get a recognition session started underneath it (see the isTyping
    // effect above, which can flip phase to 'thinking' in the same commit).
    useEffect(() => {
        if (muted || isTyping || phase !== 'idle' || !voiceSupported) return
        startListening()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [phase, muted, isTyping])

    const toggleMuted = () => {
        if (!muted) {
            stopListening()
            setMuted(true)
        } else {
            setMuted(false)
        }
    }

    // A real keystroke or focus (never our own recognition-driven setDraft
    // calls) means the user wants to type — stop competing with them. Muting
    // unconditionally (not just when already 'listening') also closes the
    // race where they click in just before the auto-restart effect below
    // fires and starts a recognition session underneath their typing.
    const handleManualTyping = () => {
        setMuted(true)
        stopListening()
    }

    const isBusy = phase === 'thinking' || phase === 'speaking'

    return (
        <div className='conversation-mode' role='dialog' aria-modal='true' aria-label='Conversation mode'>
            <div className='conversation-mode-messages' ref={messagesRef}>
                {messages.map(item => (
                    <div className={`chat-row ${item.sender === 'user' ? 'chat-row-user' : ''}`} key={item.id}>
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
                                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{item.content}</ReactMarkdown>
                                ) : (
                                    <span style={{ whiteSpace: 'pre-wrap' }}>{item.content}</span>
                                )}
                            </div>
                        </div>
                    </div>
                ))}

                {isTyping && (
                    <div className='chat-row'>
                        <Avatar size={30} icon={<OpenAIOutlined />} style={{ background: 'var(--app-accent)' }} />
                        <div className='chat-typing' aria-live='polite' aria-label='D is typing'>
                            <span /><span /><span />
                        </div>
                    </div>
                )}
            </div>

            <div className='conversation-mode-orb-row'>
                <VoiceOrb mode={phase} size={76} audioElement={speakingAudioEl} />
            </div>

            {micError && <p className='conversation-mode-mic-error' role='alert'>{micError}</p>}

            <div className='conversation-mode-bottom'>
                <div className='chat-input-wrap'>
                    <button
                        type='button'
                        className={`chat-voice-button ${phase === 'listening' ? 'chat-voice-button-active' : ''}`}
                        onClick={toggleMuted}
                        disabled={!voiceSupported}
                        aria-pressed={!muted}
                        aria-label={muted ? 'Resume listening' : 'Mute microphone'}
                        title={voiceSupported ? undefined : 'Voice input is not supported in this browser'}
                    >
                        {muted || phase !== 'listening' ? <AudioMutedOutlined /> : <AudioOutlined />}
                    </button>
                    <TextArea
                        value={draft}
                        onChange={event => setDraft(event.target.value)}
                        onKeyDown={handleManualTyping}
                        onFocus={handleManualTyping}
                        onPressEnter={event => {
                            if (!event.shiftKey) {
                                event.preventDefault()
                                sendMessage(draft)
                            }
                        }}
                        placeholder={phase === 'listening' ? 'Listening…' : 'Type your message…'}
                        autoSize={{ minRows: 1, maxRows: 4 }}
                        bordered={false}
                        disabled={isBusy}
                        maxLength={MAX_MESSAGE_LENGTH}
                        aria-label='Message'
                    />
                    <Button
                        type='primary'
                        shape='circle'
                        size='middle'
                        icon={<SendOutlined />}
                        onClick={() => sendMessage(draft)}
                        disabled={!draft.trim() || isBusy}
                        aria-label='Send message'
                        className='chat-send-button'
                    />
                    <button
                        type='button'
                        className='conversation-mode-exit-button'
                        aria-label='Exit conversation mode'
                        onClick={onClose}
                    >
                        <CloseOutlined />
                    </button>
                </div>
            </div>
        </div>
    )
}

export default ConversationMode
