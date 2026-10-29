import React from 'react'
import { Button, type ButtonProps } from 'antd'

/**
 * The incubatee dashboard's action button: always the tonal variant (accent
 * tint, accent border), whatever type/variant the caller passes. Shape,
 * colours and hover come from the shared button design in styles/buttons.css.
 */
export default function DashboardButton({ type: _type, variant: _variant, color: _color, shape: _shape, danger, ...props }: ButtonProps) {
    return <Button {...props} danger={danger} variant="filled"
        color={danger ? 'danger' : 'primary'}
        className={`dashboard-action-button${props.className ? ` ${props.className}` : ''}`} />
}
