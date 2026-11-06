import React from 'react'
import { theme } from 'antd'
import { CheckOutlined, CloseOutlined } from '@ant-design/icons'

/**
 * Card-based Yes/No selector matching the onboarding flow's choice-card
 * language — a controlled `value`/`onChange` component so it can be dropped
 * straight into a `Form.Item` in place of `Radio.Group`.
 */
const YesNoChoiceCard: React.FC<{
    value?: string
    onChange?: (value: string) => void
    disabled?: boolean
    ariaLabel?: string
}> = ({ value, onChange, disabled, ariaLabel }) => {
    const { token } = theme.useToken()

    // Yes reads green and No red, at rest (icon) and once picked (whole card).
    const options: Array<{
        label: 'Yes' | 'No'
        icon: React.ReactNode
        color: string
        bg: string
        border: string
        focus: string
    }> = [
        {
            label: 'Yes',
            icon: <CheckOutlined />,
            color: token.colorSuccess,
            bg: token.colorSuccessBg,
            border: token.colorSuccessBorder,
            focus: token.colorSuccessBorderHover
        },
        {
            label: 'No',
            icon: <CloseOutlined />,
            color: token.colorError,
            bg: token.colorErrorBg,
            border: token.colorErrorBorder,
            focus: token.colorErrorBorderHover
        }
    ]

    return (
        <div
            role="radiogroup"
            aria-label={ariaLabel}
            style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gap: 8,
                width: '100%'
            }}
        >
            {options.map(option => {
                const selected = value === option.label

                return (
                    <button
                        key={option.label}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        disabled={disabled}
                        onClick={() => onChange?.(option.label)}
                        style={{
                            appearance: 'none',
                            width: '100%',
                            minHeight: 40,
                            padding: '7px 8px',
                            borderRadius: 10,
                            border: `1px solid ${selected ? option.color : token.colorBorder}`,
                            background: selected ? option.bg : token.colorBgContainer,
                            color: selected ? option.color : token.colorText,
                            cursor: disabled ? 'not-allowed' : 'pointer',
                            opacity: disabled ? 0.6 : 1,
                            font: 'inherit',
                            fontWeight: selected ? 700 : 600,
                            textAlign: 'center',
                            transition: 'border-color .2s ease, background .2s ease, color .2s ease',
                            outline: 'none'
                        }}
                        onFocus={event => {
                            event.currentTarget.style.boxShadow = `0 0 0 2px ${option.focus}`
                        }}
                        onBlur={event => {
                            event.currentTarget.style.boxShadow = 'none'
                        }}
                    >
                        <span
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 6,
                                fontSize: 13
                            }}
                        >
                            <span
                                aria-hidden="true"
                                style={{
                                    width: 20,
                                    height: 20,
                                    borderRadius: 7,
                                    display: 'grid',
                                    placeItems: 'center',
                                    background: selected ? option.color : option.bg,
                                    color: selected ? token.colorTextLightSolid : option.color,
                                    fontSize: 11,
                                    flex: '0 0 auto'
                                }}
                            >
                                {option.icon}
                            </span>
                            <span>{option.label}</span>
                        </span>
                    </button>
                )
            })}
        </div>
    )
}

export default YesNoChoiceCard
