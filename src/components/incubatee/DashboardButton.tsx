import React from 'react'
import { Button, theme, type ButtonProps } from 'antd'

/** Shared rounded action treatment for the incubatee dashboard and its dialogs. */
export default function DashboardButton({ type: _type, variant: _variant, color, shape: _shape, style, danger, ...props }: ButtonProps) {
    const { token } = theme.useToken()
    return <Button {...props} danger={danger} shape="round" variant="filled"
        color={danger ? 'danger' : color || 'geekblue'}
        style={{ ...style, border: `1px solid ${danger ? token.colorError : token.colorPrimary}`, boxShadow: 'none' }} />
}
