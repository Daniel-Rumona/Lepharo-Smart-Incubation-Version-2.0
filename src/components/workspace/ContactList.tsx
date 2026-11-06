import React from 'react'
import { Button, Tooltip, message } from 'antd'
import { CopyOutlined } from '@ant-design/icons'

export type ContactAction = { href: string; label: string; icon: React.ReactNode; external?: boolean }

const copy = (text: string, what: string) =>
    navigator.clipboard.writeText(text).then(
        () => message.success(`${what} copied`),
        () => message.error(`Could not copy the ${what.toLowerCase()}`)
    )

/** One contact detail: icon, label and value, with copy and a direct action (email, call, open). */
export const ContactRow: React.FC<{
    icon: React.ReactNode
    label: string
    value?: string
    empty?: string
    /** Name used in the copy button and toast, e.g. "Phone number". Defaults to the label. */
    copyLabel?: string
    action?: ContactAction
    /** Shares its row with the next half-width item on wider panels. */
    half?: boolean
}> = ({ icon, label, value, empty, copyLabel = label, action, half }) => (
    <li className={`ws-contact-row${half ? ' is-half' : ''}`}>
        <span className='ws-contact-icon' aria-hidden='true'>
            {icon}
        </span>
        <div className='ws-contact-text'>
            <div className='ws-contact-label'>{label}</div>
            <div className={`ws-contact-value${value ? '' : ' is-empty'}`}>{value || empty || '—'}</div>
        </div>
        {value && (
            <div className='ws-contact-actions'>
                <Tooltip title={`Copy ${copyLabel.toLowerCase()}`}>
                    <Button
                        type='text'
                        size='small'
                        icon={<CopyOutlined />}
                        aria-label={`Copy ${copyLabel.toLowerCase()}`}
                        onClick={() => copy(value, copyLabel)}
                    />
                </Tooltip>
                {action && (
                    <Tooltip title={action.label}>
                        <Button
                            type='text'
                            size='small'
                            icon={action.icon}
                            href={action.href}
                            target={action.external ? '_blank' : undefined}
                            rel={action.external ? 'noreferrer' : undefined}
                            aria-label={action.label}
                        />
                    </Tooltip>
                )}
            </div>
        )}
    </li>
)

/** A bordered list of ContactRows; half-width rows pair up on wider panels. */
export const ContactList: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <ul className='ws-contact-list'>{children}</ul>
)

/** Standard actions for the common contact kinds. */
export const contactActions = {
    email: (email?: string, icon?: React.ReactNode): ContactAction | undefined =>
        email ? { href: `mailto:${email}`, label: 'Send email', icon } : undefined,
    phone: (phone?: string, icon?: React.ReactNode): ContactAction | undefined =>
        phone ? { href: `tel:${phone.replace(/\s+/g, '')}`, label: 'Call', icon } : undefined,
    website: (url?: string, icon?: React.ReactNode): ContactAction | undefined =>
        url
            ? { href: url.startsWith('http') ? url : `https://${url}`, label: 'Open website', icon, external: true }
            : undefined,
    map: (address?: string, icon?: React.ReactNode): ContactAction | undefined =>
        address
            ? {
                href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`,
                label: 'Open in Maps',
                icon,
                external: true
            }
            : undefined
}
