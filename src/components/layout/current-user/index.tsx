import React, { useEffect, useState } from 'react'
import { Dropdown, Tooltip } from 'antd'
import {
    CheckOutlined,
    CompassOutlined,
    LogoutOutlined,
    RightOutlined,
    SettingOutlined
} from '@ant-design/icons'
import { useWindowSize } from 'react-use'
import { CustomAvatar } from '../../custom-avatar'
import { AccountSettings } from '../account-settings'
import { ACCENT_OPTIONS, MODE_OPTIONS } from '../theme-toggle'
import { useOptionalGuide } from '@/components/guide-me'
import { onRequestOpenAccountSettings } from '@/lib/accountSettings'
import { formatRole } from '@/lib/roleLabels'
import { useColorMode, type ColorModePreference } from '@/contexts/ThemeContext'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import './account-menu.css'

type CurrentUserProps = {
    /** Shows the Log out row; every live top bar passes it. */
    onLogout?: () => void
    /** Which edge of the avatar the panel lines up with. */
    placement?: 'bottomLeft' | 'bottomRight'
}

/**
 * The avatar and its account panel: who you are, account settings, the page
 * guide, appearance and log out — the same panel at every screen size, so the
 * top bar only carries what is used on most screens.
 */
export const CurrentUser = ({ onLogout, placement = 'bottomRight' }: CurrentUserProps) => {
    const [open, setOpen] = useState(false)
    const [settingsOpen, setSettingsOpen] = useState(false)
    const { user, actor, isViewingAs } = useFullIdentity()
    const { preference, setPreference, accent, setAccent, isDark } = useColorMode()
    const guide = useOptionalGuide()
    // Tooltips fire on tap on touch screens and steal the tap meant for the panel.
    const { width } = useWindowSize()
    const isMobile = width < 768

    useEffect(() => onRequestOpenAccountSettings(() => setSettingsOpen(true)), [])

    // Settings edit the signed-in person's own profile, so they are off while
    // viewing as someone else. Log out stays available either way.
    const canOpenSettings = !!user && !!actor && !isViewingAs
    const displayName = user?.name || 'Account'

    /** Close the panel, then act — so a modal never opens under it. */
    const run = (action: () => void) => () => {
        setOpen(false)
        action()
    }

    const panel = (
        <div className='account-panel' role='dialog' aria-label='Account'>
            <div className='account-panel-who'>
                <CustomAvatar
                    name={user?.name}
                    src={user?.photoURL}
                    size={44}
                    className='workspace-current-user-avatar'
                    style={{ fontWeight: 700, flex: '0 0 auto' }}
                />
                <div className='account-panel-id'>
                    {isViewingAs && <span className='account-panel-viewing'>Viewing as</span>}
                    <strong>{displayName}</strong>
                    <span className='account-panel-role'>{formatRole(user?.role)}</span>
                    {!isViewingAs && user?.email && (
                        <span className='account-panel-email' title={user.email}>
                            {user.email}
                        </span>
                    )}
                </div>
            </div>

            <div className='account-panel-actions'>
                <button
                    type='button'
                    className='account-panel-row'
                    disabled={!canOpenSettings}
                    title={canOpenSettings ? undefined : 'Unavailable while viewing as someone else'}
                    onClick={run(() => setSettingsOpen(true))}
                >
                    <span className='account-panel-icon'>
                        <SettingOutlined />
                    </span>
                    <span className='account-panel-label'>
                        Account settings
                        <small>Profile, password and signature</small>
                    </span>
                    <RightOutlined className='account-panel-chevron' />
                </button>

                {guide?.hasGuides && (
                    <button
                        type='button'
                        className='account-panel-row'
                        onClick={run(() => guide.openGuideModal())}
                    >
                        <span className='account-panel-icon'>
                            <CompassOutlined />
                        </span>
                        <span className='account-panel-label'>
                            Guide for this page
                            <small>A short walkthrough of this screen</small>
                        </span>
                        <RightOutlined className='account-panel-chevron' />
                    </button>
                )}
            </div>

            <div className='account-panel-appearance'>
                <span className='account-panel-heading'>Appearance</span>
                {/* Same pill strip as the top bar's primary nav. */}
                <div className='account-panel-modes' role='radiogroup' aria-label='Colour mode'>
                    {MODE_OPTIONS.map(option => {
                        const active = preference === option.key
                        return (
                            <button
                                key={option.key}
                                type='button'
                                role='radio'
                                aria-checked={active}
                                className={active ? 'account-panel-mode is-active' : 'account-panel-mode'}
                                onClick={() => setPreference(option.key as ColorModePreference)}
                            >
                                <span className='account-panel-mode-icon'>{option.icon}</span>
                                {option.label}
                            </button>
                        )
                    })}
                </div>
                <div className='account-panel-colour'>
                    <span className='account-panel-colour-label'>Colour</span>
                    <div className='account-panel-swatches' role='radiogroup' aria-label='Colour'>
                        {ACCENT_OPTIONS.map(option => {
                            const selected = accent === option.key
                            return (
                                <button
                                    key={option.key}
                                    type='button'
                                    role='radio'
                                    aria-checked={selected}
                                    aria-label={option.label}
                                    title={option.label}
                                    className={selected ? 'account-panel-swatch is-selected' : 'account-panel-swatch'}
                                    style={{ '--swatch': isDark ? option.dark : option.light } as React.CSSProperties}
                                    onClick={() => setAccent(option.key)}
                                >
                                    {selected && <CheckOutlined />}
                                </button>
                            )
                        })}
                    </div>
                </div>
            </div>

            {onLogout && (
                <button
                    type='button'
                    className='account-panel-row account-panel-logout'
                    onClick={run(onLogout)}
                >
                    <span className='account-panel-icon'>
                        <LogoutOutlined />
                    </span>
                    <span className='account-panel-label'>Log out</span>
                </button>
            )}
        </div>
    )

    const trigger = (
        <button
            type='button'
            className='account-menu-trigger'
            aria-label={`Account menu for ${displayName}`}
            aria-haspopup='dialog'
            aria-expanded={open}
        >
            <CustomAvatar
                name={user?.name}
                src={user?.photoURL}
                size='default'
                className='workspace-current-user-avatar'
                style={{ fontWeight: 700 }}
            />
        </button>
    )

    return (
        <>
            <Dropdown
                trigger={['click']}
                placement={placement}
                open={open}
                onOpenChange={setOpen}
                dropdownRender={() => panel}
            >
                {isMobile || open ? trigger : <Tooltip title={displayName}>{trigger}</Tooltip>}
            </Dropdown>

            {canOpenSettings && (
                <AccountSettings opened={settingsOpen} setOpened={setSettingsOpen} userId={actor!.id} />
            )}
        </>
    )
}

export default CurrentUser
