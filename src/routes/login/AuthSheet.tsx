import React from 'react'
import { Drawer, Modal } from 'antd'
import { CloseOutlined, RightOutlined } from '@ant-design/icons'
import { useIsMobile } from '@/hooks/useIsMobile'
import './AuthSheet.css'

/** Same cut-off the auth screens use for their phone layouts (md = 768px). */
export const useIsMobileSheet = useIsMobile

export const GoogleMark: React.FC = () => (
    <svg viewBox='0 0 48 48' width='20' height='20' aria-hidden='true'>
        <path
            fill='#FFC107'
            d='M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.6-.4-3.9z'
        />
        <path
            fill='#FF3D00'
            d='M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 8 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z'
        />
        <path
            fill='#4CAF50'
            d='M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z'
        />
        <path
            fill='#1976D2'
            d='M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z'
        />
    </svg>
)

interface AuthSheetProps {
    open: boolean
    onClose: () => void
    /** When false there is no close button and backdrop/Esc do nothing, so the
     *  user has to pick one of the actions inside. */
    dismissible?: boolean
    icon: React.ReactNode
    tone?: 'warn' | 'info' | 'accent'
    title: string
    lead?: React.ReactNode
    children?: React.ReactNode
}

/**
 * One design for the login screen's dialogs: a bottom drawer on phones, a
 * centred modal everywhere else. Colours come from the --app-* tokens, so
 * light, dark and every accent palette follow without per-theme rules.
 */
export const AuthSheet: React.FC<AuthSheetProps> = ({
    open,
    onClose,
    dismissible = true,
    icon,
    tone = 'info',
    title,
    lead,
    children
}) => {
    const mobile = useIsMobileSheet()

    const content = (
        <div className={`auth-sheet ${mobile ? 'is-drawer' : 'is-modal'}`}>
            {mobile && <span className='auth-sheet-handle' aria-hidden='true' />}

            {dismissible && (
                <button
                    type='button'
                    className='auth-sheet-close'
                    aria-label='Close'
                    onClick={onClose}
                >
                    <CloseOutlined />
                </button>
            )}

            <div className={`auth-sheet-badge is-${tone}`}>{icon}</div>
            <h2 className='auth-sheet-title'>{title}</h2>
            {lead && <p className='auth-sheet-lead'>{lead}</p>}
            {children}
        </div>
    )

    if (mobile) {
        return (
            <Drawer
                open={open}
                onClose={onClose}
                placement='bottom'
                height='auto'
                closable={false}
                maskClosable={dismissible}
                keyboard={dismissible}
                destroyOnClose
                rootClassName='auth-sheet-root'
                classNames={{ wrapper: 'auth-sheet-wrapper', body: 'auth-sheet-body' }}
                styles={{ header: { display: 'none' } }}
                title={title}
            >
                {content}
            </Drawer>
        )
    }

    return (
        <Modal
            open={open}
            onCancel={onClose}
            footer={null}
            closable={false}
            centered
            width={440}
            maskClosable={dismissible}
            keyboard={dismissible}
            destroyOnClose
            rootClassName='auth-sheet-root'
            className='auth-modal'
        >
            {content}
        </Modal>
    )
}

interface AuthOptionProps {
    icon: React.ReactNode
    title: string
    hint: string
    recommended?: boolean
    disabled?: boolean
    onClick: () => void
}

export const AuthOption: React.FC<AuthOptionProps> = ({
    icon,
    title,
    hint,
    recommended,
    disabled,
    onClick
}) => (
    <button
        type='button'
        disabled={disabled}
        className={`auth-option${recommended ? ' is-recommended' : ''}`}
        onClick={onClick}
    >
        <span className='auth-option-icon'>{icon}</span>
        <span className='auth-option-text'>
            <span className='auth-option-title'>
                {title}
                {recommended && <span className='auth-tag'>Suggested</span>}
            </span>
            <span className='auth-option-hint'>{hint}</span>
        </span>
        <RightOutlined className='auth-option-chevron' />
    </button>
)
