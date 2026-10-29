import React from 'react'
import { Button, Input } from 'antd'
import { KeyOutlined, MailOutlined } from '@ant-design/icons'
import { AuthSheet, useIsMobileSheet } from './AuthSheet'

interface ResetPasswordSheetProps {
    open: boolean
    email: string
    sending: boolean
    onEmailChange: (email: string) => void
    onSubmit: () => void
    onClose: () => void
}

const ResetPasswordSheet: React.FC<ResetPasswordSheetProps> = ({
    open,
    email,
    sending,
    onEmailChange,
    onSubmit,
    onClose
}) => {
    // Focusing on open would pop the keyboard up mid-slide on a phone.
    const mobile = useIsMobileSheet()

    return (
        <AuthSheet
            open={open}
            onClose={onClose}
            tone='accent'
            icon={<KeyOutlined />}
            title='Set up or reset your password'
            lead='Enter your registered email and we will send you a secure link to set up or reset your password.'
        >
            <form
                className='auth-sheet-form'
                onSubmit={event => {
                    event.preventDefault()
                    onSubmit()
                }}
            >
                <Input
                    size='large'
                    type='email'
                    inputMode='email'
                    autoComplete='email'
                    placeholder='you@example.com'
                    prefix={<MailOutlined />}
                    value={email}
                    onChange={event => onEmailChange(event.target.value)}
                    autoFocus={!mobile}
                />
                <div className='auth-sheet-actions'>
                    <Button block disabled={sending} onClick={onClose}>
                        Cancel
                    </Button>
                    <Button type='primary' htmlType='submit' block loading={sending}>
                        Send setup link
                    </Button>
                </div>
            </form>
        </AuthSheet>
    )
}

export default ResetPasswordSheet
