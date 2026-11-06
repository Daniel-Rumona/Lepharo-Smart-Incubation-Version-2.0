import React from 'react'

/** Fields from users/{uid} that the settings sections read and update. */
export type AccountUser = {
    name?: string
    fullName?: string
    email?: string
    role?: string
    photoURL?: string | null
    signatureURL?: string | null
    [key: string]: unknown
}

export type SectionProps = {
    userData: AccountUser
    /** Merge saved changes into the modal's copy of the profile. */
    onUpdate: (patch: Partial<AccountUser>) => void
}

/**
 * Frame for one settings section: a scrolling body and, while editing, a
 * footer pinned beneath it for the section's own Cancel / Save buttons.
 */
export const SectionLayout: React.FC<{
    children: React.ReactNode
    footer?: React.ReactNode
}> = ({ children, footer }) => (
    <div className='acs-section'>
        <div className='acs-body'>{children}</div>
        {footer && <div className='acs-footer'>{footer}</div>}
    </div>
)

export const SectionHead: React.FC<{ title: string; sub: string }> = ({ title, sub }) => (
    <div className='acs-section-head'>
        <h3 className='acs-section-title'>{title}</h3>
        <p className='acs-section-sub'>{sub}</p>
    </div>
)
