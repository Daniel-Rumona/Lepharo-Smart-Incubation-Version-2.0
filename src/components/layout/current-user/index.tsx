import React, { useEffect, useState } from 'react'

import { Tooltip } from 'antd'

import { CustomAvatar } from '../../custom-avatar'
import { AccountSettings } from '../account-settings'
import { onRequestOpenAccountSettings } from '@/lib/accountSettings'
import { useFullIdentity } from '@/hooks/useFullIdentity'

export const CurrentUser = () => {
  const [opened, setOpened] = React.useState(false)
  const { user, actor, isViewingAs } = useFullIdentity()

  useEffect(() => {
    return onRequestOpenAccountSettings(() => setOpened(true))
  }, [])

  // Account settings is the only thing behind the avatar, so it opens straight
  // from the click rather than through a one-item menu. While viewing as
  // someone else the panel is not rendered at all, so the avatar is inert.
  const canOpenSettings = !!user && !!actor && !isViewingAs

  return (
    <>
      <Tooltip title={isViewingAs ? user?.name : `${user?.name ?? 'Account'} — account settings`}>
        {/* The interactive affordances live on a wrapper: antd's AvatarProps
            has no room for them, and CustomAvatar is memoised on name/src/
            className/style only, so a handler passed to it could go stale. */}
        <span
          role={canOpenSettings ? 'button' : undefined}
          tabIndex={canOpenSettings ? 0 : undefined}
          aria-label={canOpenSettings ? 'Open account settings' : undefined}
          onClick={() => {
            if (canOpenSettings) setOpened(true)
          }}
          onKeyDown={e => {
            if (!canOpenSettings) return
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              setOpened(true)
            }
          }}
          style={{
            display: 'inline-flex',
            borderRadius: '50%',
            cursor: canOpenSettings ? 'pointer' : 'default'
          }}
        >
          <CustomAvatar
            name={user?.name}
            src={user?.avatarUrl || user?.photoURL}
            size='default'
            className='workspace-current-user-avatar'
            style={{ fontWeight: 700 }}
          />
        </span>
      </Tooltip>
      {canOpenSettings && (
        <AccountSettings
          opened={opened}
          setOpened={setOpened}
          userId={actor!.id}
        />
      )}
    </>
  )
}
