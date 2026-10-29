import React, { useRef } from 'react'
import { LockOutlined, MailOutlined, SafetyCertificateOutlined } from '@ant-design/icons'
import { AuthOption, AuthSheet, GoogleMark } from './AuthSheet'

export type SignInHelp = {
    email: string
    googleOnly: boolean
}

interface SignInHelpSheetProps {
    help: SignInHelp | null
    onClose: () => void
    onContinueWithGoogle: () => void
    onResetPassword: (email: string) => void
}

const SignInHelpSheet: React.FC<SignInHelpSheetProps> = ({
    help,
    onClose,
    onContinueWithGoogle,
    onResetPassword
}) => {
    // The sheet keeps animating out after `help` goes null, so hold on to the
    // last value or the copy flips to its default mid-slide.
    const lastHelp = useRef<SignInHelp | null>(help)
    if (help) lastHelp.current = help
    const view = help ?? lastHelp.current

    const googleOnly = Boolean(view?.googleOnly)
    const email = view?.email ?? ''

    const google = (
        <AuthOption
            key='google'
            icon={<GoogleMark />}
            title='Continue with Google'
            hint='Use your registered Google account'
            recommended={googleOnly}
            onClick={onContinueWithGoogle}
        />
    )
    const reset = (
        <AuthOption
            key='reset'
            icon={<SafetyCertificateOutlined />}
            title='Set up or reset password'
            hint='We will email you a secure link'
            recommended={!googleOnly}
            onClick={() => onResetPassword(email)}
        />
    )

    return (
        <AuthSheet
            open={Boolean(help)}
            onClose={onClose}
            tone={googleOnly ? 'info' : 'warn'}
            icon={googleOnly ? <GoogleMark /> : <LockOutlined />}
            title={googleOnly ? 'This account uses Google sign-in' : 'Having trouble signing in?'}
            lead={
                googleOnly
                    ? 'You registered with Google. Continue with Google, or set up a password for future email sign-ins.'
                    : 'We could not verify your email or password. If you registered with Google, continue with Google, or get a link to set up or reset your password.'
            }
        >
            {email && (
                <div className='auth-sheet-email' title={email}>
                    <MailOutlined />
                    <span>{email}</span>
                </div>
            )}

            <div className='auth-sheet-options'>{googleOnly ? [google, reset] : [reset, google]}</div>

            <button type='button' className='auth-sheet-link' onClick={onClose}>
                Try a different password
            </button>
        </AuthSheet>
    )
}

export default SignInHelpSheet
