import React from 'react'
import { Avatar } from 'antd'

/** Up to two initials, skipping company suffixes like "(Pty) Ltd". */
export const initialsOf = (name: string) => {
    const words = name
        .replace(/\(.*?\)/g, ' ')
        .split(/\s+/)
        .filter(w => /^[\p{L}\p{N}]/u.test(w) && !/^(ltd|pty|inc|cc|npc)\.?$/i.test(w))
    const letters = (words.length > 1 ? [words[0], words[1]] : words.slice(0, 1)).map(w => w[0])
    return (letters.join('') || '?').toUpperCase()
}

/**
 * A person or business: their photo or logo when one is stored, otherwise
 * initials on the accent tint. Inside a selected list row (.ws-row.is-selected)
 * it fills with the accent.
 */
export const EntityAvatar: React.FC<{ name: string; photo?: string; size?: number }> = ({ name, photo, size = 36 }) => {
    const src = photo && photo.trim() ? photo : undefined
    return (
        <Avatar
            className='ws-avatar'
            size={size}
            src={src}
            alt={src ? name : undefined}
            style={{ fontSize: Math.round(size * 0.38) }}
            aria-hidden={src ? undefined : true}
        >
            {initialsOf(name)}
        </Avatar>
    )
}
