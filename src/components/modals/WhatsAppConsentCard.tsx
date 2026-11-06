import React, { useState } from 'react'
import { Button, Input, message, theme } from 'antd'
import { MessageOutlined, StopOutlined } from '@ant-design/icons'
import { doc, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from '@/firebase'
import { buildConsent, normalizeWhatsAppNumber, type WhatsAppConsent } from '@/services/whatsappConsent'
import './WhatsAppConsentCard.css'

type Props = {
    userId: string
    /** Prefilled from the SME's profile, if they have a number on file. */
    initialNumber?: string
    source: WhatsAppConsent['source']
    onAnswered: (status: 'granted' | 'declined') => void
    /** Shown when the SME wants to answer later. Omit to hide the option. */
    onLater?: () => void
}

/** One question, used on the first-time Welcome page and as a one-page prompt for existing SMEs. */
export const WhatsAppConsentCard: React.FC<Props> = ({ userId, initialNumber, source, onAnswered, onLater }) => {
    const { token } = theme.useToken()
    const [choice, setChoice] = useState<'granted' | 'declined' | null>(null)
    const [number, setNumber] = useState(initialNumber || '')
    const [saving, setSaving] = useState(false)

    const numberOk = !!normalizeWhatsAppNumber(number)

    const save = async () => {
        if (!choice) return
        const { consent, error } = buildConsent({ status: choice, number, source, now: serverTimestamp() })
        if (!consent) {
            message.warning(error || 'Check the number and try again.')
            return
        }
        setSaving(true)
        try {
            await setDoc(doc(db, 'users', userId), { whatsappConsent: consent }, { merge: true })
            message.success(choice === 'granted' ? 'Thank you. We will message you on WhatsApp.' : 'Noted. We will not message you on WhatsApp.')
            onAnswered(choice)
        } catch (error) {
            console.error('Could not save WhatsApp preference', error)
            message.error('Could not save your choice. Please try again.')
        } finally {
            setSaving(false)
        }
    }

    // Theme colours as custom properties, so the stylesheet follows whichever
    // antd theme (app light/dark, or the brand screens) the card sits in.
    const themeVars = {
        '--wcc-accent': token.colorPrimary,
        '--wcc-ink': token.colorText,
        '--wcc-muted': token.colorTextSecondary,
        '--wcc-line': token.colorBorder,
        '--wcc-line-strong': token.colorTextQuaternary,
        '--wcc-fill': token.colorFillTertiary
    } as React.CSSProperties

    const option = (value: 'granted' | 'declined', title: string, body: string, icon: React.ReactNode) => (
        <button
            type="button"
            role="radio"
            aria-checked={choice === value}
            className={`wcc-option${choice === value ? ' is-selected' : ''}`}
            onClick={() => setChoice(value)}
        >
            <span className="wcc-option-icon" aria-hidden="true">{icon}</span>
            <span className="wcc-option-text">
                <span className="wcc-option-title">{title}</span>
                <span className="wcc-option-body">{body}</span>
            </span>
            <span className="wcc-radio" aria-hidden="true" />
        </button>
    )

    return (
        <div className="wcc" style={themeVars}>
            <p className="wcc-intro">
                Would you like quick updates about your support on WhatsApp, such as a short question about
                whether what you put in place is still working? You can answer with one tap, and you can change
                your mind at any time.
            </p>
            <div className="wcc-options" role="radiogroup" aria-label="WhatsApp updates">
                {option('granted', 'Yes, message me on WhatsApp', 'We will only message you about your programme support.', <MessageOutlined />)}
                {option('declined', 'No thanks', 'We will use the app and email instead.', <StopOutlined />)}
            </div>
            {choice === 'granted' ? (
                <label className="wcc-number">
                    <span className="wcc-number-label">Your WhatsApp number</span>
                    <Input
                        size="large"
                        inputMode="tel"
                        placeholder="e.g. 082 123 4567"
                        value={number}
                        onChange={event => setNumber(event.target.value)}
                        status={number && !numberOk ? 'error' : undefined}
                    />
                    {number && !numberOk ? (
                        <span className="wcc-number-hint">Enter a valid WhatsApp number, for example 082 123 4567.</span>
                    ) : null}
                </label>
            ) : null}
            <div className="wcc-actions">
                {onLater ? (
                    <Button size="large" type="text" onClick={onLater} disabled={saving}>
                        Decide later
                    </Button>
                ) : null}
                <Button
                    type="primary"
                    size="large"
                    disabled={!choice || (choice === 'granted' && !numberOk)}
                    loading={saving}
                    onClick={save}
                >
                    Save my choice
                </Button>
            </div>
        </div>
    )
}

export default WhatsAppConsentCard
