import React, { useEffect, useRef, useState } from 'react'
import { Alert, Button, Input, Space, Typography, message, theme } from 'antd'
import { AudioMutedOutlined, AudioOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { draftCoverage, type CoverageDraft } from '@/services/sessionCopilotService'

const { Text } = Typography

type Props = {
    sessionTitle: string
    interventionTitle: string
    plannedCoverage: string[]
    formalTopics: boolean
    /** Group and QR sessions: attendance comes from the register, never from notes. */
    attendanceLocked: boolean
    onDraft: (draft: CoverageDraft) => void
}

const speechRecognition = (): (new () => any) | null => {
    if (typeof window === 'undefined') return null
    return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null
}

/**
 * "Draft from my notes": the facilitator types or dictates what happened, and the
 * assistant fills in the coverage form below for them to check. Nothing is saved
 * here; the form's own Save does that.
 */
export const CoverageNotesCopilot: React.FC<Props> = props => {
    const { token } = theme.useToken()
    const [notes, setNotes] = useState('')
    const [drafting, setDrafting] = useState(false)
    const [listening, setListening] = useState(false)
    const [toCheck, setToCheck] = useState<string[] | null>(null)
    const recognitionRef = useRef<any>(null)
    const canDictate = useRef(!!speechRecognition()).current

    useEffect(() => () => recognitionRef.current?.stop?.(), [])

    const toggleDictation = () => {
        if (listening) {
            recognitionRef.current?.stop?.()
            return
        }
        const Recognition = speechRecognition()
        if (!Recognition) return
        const recognition = new Recognition()
        recognition.lang = 'en-ZA'
        recognition.continuous = true
        recognition.interimResults = false
        recognition.onresult = (event: any) => {
            const heard = Array.from(event.results as ArrayLike<any>)
                .slice(event.resultIndex)
                .filter((result: any) => result.isFinal)
                .map((result: any) => result[0]?.transcript || '')
                .join(' ')
                .trim()
            if (heard) setNotes(current => (current ? `${current.trimEnd()} ${heard}` : heard))
        }
        recognition.onerror = (event: any) => {
            if (event?.error === 'not-allowed') message.warning('Allow microphone access to dictate your notes.')
        }
        recognition.onend = () => setListening(false)
        recognitionRef.current = recognition
        recognition.start()
        setListening(true)
    }

    const draft = async () => {
        recognitionRef.current?.stop?.()
        setDrafting(true)
        try {
            const result = await draftCoverage({ notes, ...props })
            props.onDraft(result)
            setToCheck(result.toCheck)
        } catch (error: any) {
            message.error(error?.message || 'The assistant could not draft this right now. You can still fill in the form.')
        } finally {
            setDrafting(false)
        }
    }

    return (
        <div
            style={{
                marginBottom: 16,
                padding: 14,
                borderRadius: token.borderRadiusLG,
                border: `1px solid ${token.colorPrimaryBorder}`,
                background: token.colorPrimaryBg
            }}
        >
            <Text strong style={{ display: 'block' }}>Draft from my notes</Text>
            <Text type='secondary' style={{ display: 'block', fontSize: 12, marginBottom: 8 }}>
                Type or dictate what happened, in your own words. The assistant fills in the form below for you to check before saving.
            </Text>
            <Input.TextArea
                value={notes}
                onChange={event => setNotes(event.target.value)}
                autoSize={{ minRows: 3, maxRows: 8 }}
                maxLength={4000}
                placeholder='e.g. Met Thandi at the shop. Went through the cash flow template, she will send 3 months of bank statements by Friday. Next time: build the forecast.'
            />
            <Space wrap style={{ marginTop: 8 }}>
                {canDictate ? (
                    <Button
                        icon={listening ? <AudioMutedOutlined /> : <AudioOutlined />}
                        onClick={toggleDictation}
                        danger={listening}
                    >
                        {listening ? 'Stop dictating' : 'Dictate'}
                    </Button>
                ) : null}
                <Button
                    type='primary'
                    icon={<ThunderboltOutlined />}
                    loading={drafting}
                    disabled={notes.trim().split(/\s+/).length < 3}
                    onClick={draft}
                >
                    Draft the form
                </Button>
            </Space>
            {toCheck ? (
                <Alert
                    style={{ marginTop: 10 }}
                    type={toCheck.length ? 'warning' : 'success'}
                    showIcon
                    message={toCheck.length ? 'Drafted. Check these before saving:' : 'Drafted. Check the form before saving.'}
                    description={toCheck.length ? (
                        <ul style={{ margin: 0, paddingLeft: 18 }}>
                            {toCheck.map(item => <li key={item}>{item}</li>)}
                        </ul>
                    ) : undefined}
                />
            ) : null}
        </div>
    )
}

export default CoverageNotesCopilot
