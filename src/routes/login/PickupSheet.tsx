import React, { useRef } from 'react'
import { CheckCircleOutlined, MailOutlined, QuestionCircleOutlined } from '@ant-design/icons'
import { AuthOption, AuthSheet } from './AuthSheet'

export type PickupChoice = 'always' | 'ask'

interface PickupSheetProps {
    /** Email of the account restored from the last session, or null when closed. */
    email: string | null
    busy: boolean
    onContinue: (remember: PickupChoice) => void
    onDifferentAccount: () => void
}

const PickupSheet: React.FC<PickupSheetProps> = ({
    email,
    busy,
    onContinue,
    onDifferentAccount
}) => {
    // Held so the email does not blank out while the sheet animates away.
    const lastEmail = useRef(email)
    if (email) lastEmail.current = email
    const shown = email ?? lastEmail.current ?? ''

    return (
        <AuthSheet
            open={email !== null}
            // Closing it without a choice would be ambiguous, so it can only be
            // answered.
            dismissible={false}
            onClose={() => undefined}
            tone='accent'
            icon={(shown[0] ?? '?').toUpperCase()}
            title='Welcome back'
            lead='Pick up where you left off?'
        >
            {shown && (
                <div className='auth-sheet-email' title={shown}>
                    <MailOutlined />
                    <span>{shown}</span>
                </div>
            )}

            <div className='auth-sheet-options'>
                <AuthOption
                    icon={<CheckCircleOutlined />}
                    title='Always sign me in'
                    hint='Skip this step on this device'
                    disabled={busy}
                    onClick={() => onContinue('always')}
                />
                <AuthOption
                    icon={<QuestionCircleOutlined />}
                    title='Continue, ask me next time'
                    hint='We will check with you again on your next visit'
                    disabled={busy}
                    onClick={() => onContinue('ask')}
                />
            </div>

            <button
                type='button'
                className='auth-sheet-link'
                disabled={busy}
                onClick={onDifferentAccount}
            >
                Use a different account
            </button>
        </AuthSheet>
    )
}

export default PickupSheet
