import React, { useEffect, useRef, useState } from 'react'
import { Button, Input, Typography } from 'antd'
import { AudioMutedOutlined, AudioOutlined, CloseOutlined, SendOutlined } from '@ant-design/icons'
import { MAX_MESSAGE_LENGTH, useChatSession } from '@/routes/chat/ChatSessionContext'
import { VoiceOrb, type VoiceOrbMode } from '@/routes/chat/VoiceOrb'
import './conversation-mode.css'

const { Text } = Typography

const PHASE_LABEL: Record<VoiceOrbMode, string> = {
    idle: 'Tap the mic to talk',
    listening: 'Listening…',
    thinking: 'Thinking…',
    speaking: 'Speaking…'
}

// Approximates how long ElevenLabs playback of a reply would take, so the
// orb's "speaking" phase has a believable duration until real audio drives
// it. ~2.5 words/sec is a conversational speech pace.
const estimateSpeakingMs = (text: string) => {
    const words = text.trim().split(/\s+/).filter(Boolean).length
    return Math.min(8000, Math.max(1500, (words / 2.5) * 1000))
}

interface ConversationModeProps {
    onClose: () => void
}

export const ConversationMode: React.FC<ConversationModeProps> = ({ onClose }) => {
    const { messages, isTyping, startMessage } = useChatSession()
    const [phase, setPhase] = useState<VoiceOrbMode>(isTyping ? 'thinking' : 'idle')
    const [draft, setDraft] = useState('')
    const speakingTimeoutRef = useRef<number>()
    const listeningTimeoutRef = useRef<number>()
    const lastMessageCountRef = useRef(messages.length)

    useEffect(() => {
        if (!isTyping) return
        window.clearTimeout(speakingTimeoutRef.current)
        setPhase('thinking')
    }, [isTyping])

    useEffect(() => {
        if (messages.length <= lastMessageCountRef.current) {
            lastMessageCountRef.current = messages.length
            return
        }
        const latest = messages[messages.length - 1]
        lastMessageCountRef.current = messages.length
        if (latest.sender !== 'assistant') return

        window.clearTimeout(speakingTimeoutRef.current)
        setPhase('speaking')
        speakingTimeoutRef.current = window.setTimeout(
            () => setPhase('idle'),
            estimateSpeakingMs(latest.content)
        )
    }, [messages])

    useEffect(() => () => {
        window.clearTimeout(speakingTimeoutRef.current)
        window.clearTimeout(listeningTimeoutRef.current)
    }, [])

    // No speech recognition is wired up yet — the mic button only previews
    // the "listening" animation so the visual language is in place before
    // ElevenLabs is connected. It auto-releases after a few seconds of
    // simulated silence rather than sticking on forever.
    const toggleListening = () => {
        if (phase === 'thinking' || phase === 'speaking') return
        window.clearTimeout(listeningTimeoutRef.current)
        if (phase === 'listening') {
            setPhase('idle')
            return
        }
        setPhase('listening')
        listeningTimeoutRef.current = window.setTimeout(() => {
            setPhase(current => (current === 'listening' ? 'idle' : current))
        }, 6000)
    }

    const submitDraft = () => {
        const content = draft.trim()
        if (!content) return
        window.clearTimeout(listeningTimeoutRef.current)
        if (startMessage(content)) setDraft('')
    }

    const lastAssistant = [...messages].reverse().find(item => item.sender === 'assistant')
    const lastUser = [...messages].reverse().find(item => item.sender === 'user')
    const isBusy = phase === 'thinking' || phase === 'speaking'

    return (
        <div className='conversation-mode' role='dialog' aria-modal='true' aria-label='Conversation mode'>
            <div className='conversation-mode-topbar'>
                <Text className='conversation-mode-badge'>Conversation mode</Text>
                <button
                    type='button'
                    className='conversation-mode-close'
                    aria-label='Exit conversation mode'
                    onClick={onClose}
                >
                    <CloseOutlined />
                </button>
            </div>

            <div className='conversation-mode-stage'>
                <VoiceOrb mode={phase} size={220} className='conversation-mode-orb' />
                <div className='conversation-mode-status' aria-live='polite'>{PHASE_LABEL[phase]}</div>

                {(lastUser || lastAssistant) && (
                    <div className='conversation-mode-captions'>
                        {lastUser && <p className='conversation-mode-caption-user'>{lastUser.content}</p>}
                        {lastAssistant && <p className='conversation-mode-caption-assistant'>{lastAssistant.content}</p>}
                    </div>
                )}
            </div>

            <div className='conversation-mode-controls'>
                <button
                    type='button'
                    className={`conversation-mode-mic ${phase === 'listening' ? 'conversation-mode-mic-active' : ''}`}
                    onClick={toggleListening}
                    disabled={isBusy}
                    aria-pressed={phase === 'listening'}
                    aria-label={phase === 'listening' ? 'Stop listening preview' : 'Preview listening animation'}
                >
                    {phase === 'listening' ? <AudioOutlined /> : <AudioMutedOutlined />}
                </button>

                <div className='conversation-mode-composer'>
                    <Input
                        value={draft}
                        onChange={event => setDraft(event.target.value)}
                        onPressEnter={submitDraft}
                        placeholder='Voice input preview — type to send for now…'
                        maxLength={MAX_MESSAGE_LENGTH}
                        disabled={isBusy}
                        aria-label='Message'
                    />
                    <Button
                        type='primary'
                        shape='circle'
                        icon={<SendOutlined />}
                        onClick={submitDraft}
                        disabled={!draft.trim() || isBusy}
                        aria-label='Send message'
                    />
                </div>
            </div>
        </div>
    )
}

export default ConversationMode
