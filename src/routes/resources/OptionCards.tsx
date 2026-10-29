import React from 'react'
import { Select, theme } from 'antd'

export interface OptionCard {
  value: string
  label: string
  icon?: React.ReactNode
  description?: React.ReactNode
}

interface Props {
  options: OptionCard[]
  value?: string
  onChange?: (value: string) => void
  placeholder?: string
  // Above this many options the cards get too cramped for one line
  maxCards?: number
  // Show a radio dot on each card instead of centring the content
  indicator?: boolean
  disabled?: boolean
}

// Form-compatible picker: one row of selectable cards, or a Select when
// there are too many options to fit.
const OptionCards: React.FC<Props> = ({
  options,
  value,
  onChange,
  placeholder,
  maxCards = 6,
  indicator = false,
  disabled = false
}) => {
  const { token } = theme.useToken()

  if (options.length > maxCards) {
    return (
      <Select
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        disabled={disabled}
        options={options.map(o => ({ value: o.value, label: o.label }))}
        style={{ width: '100%' }}
      />
    )
  }

  return (
    <div
      role='radiogroup'
      aria-disabled={disabled}
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))`,
        gap: 8
      }}
    >
      {options.map(option => {
        const selected = option.value === value
        const accent = selected ? token.colorPrimary : token.colorBorder
        return (
          <button
            key={option.value}
            type='button'
            role='radio'
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange?.(option.value)}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: indicator ? 'flex-start' : 'center',
              gap: option.description ? 12 : 8,
              minWidth: 0,
              padding: option.description ? '10px 12px' : '8px 10px',
              textAlign: 'left',
              borderRadius: token.borderRadiusLG,
              border: `1px solid ${accent}`,
              background: selected
                ? token.colorPrimaryBg
                : token.colorBgContainer,
              color: selected ? token.colorPrimary : token.colorText,
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.6 : 1,
              transition: 'all 0.2s ease'
            }}
          >
            {option.icon && (
              <span
                style={{
                  // Cards with a description are taller, so the icon can be too
                  fontSize: option.description ? 24 : 16,
                  lineHeight: 1,
                  flexShrink: 0
                }}
              >
                {option.icon}
              </span>
            )}
            <span style={{ minWidth: 0, flex: indicator ? 1 : undefined }}>
              <span
                style={{
                  display: 'block',
                  fontSize: 13,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}
              >
                {option.label}
              </span>
              {option.description && (
                <span
                  style={{
                    display: 'block',
                    fontSize: 12,
                    color: token.colorTextSecondary
                  }}
                >
                  {option.description}
                </span>
              )}
            </span>
            {indicator && (
              <span
                aria-hidden
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  border: `${selected ? 5 : 1}px solid ${accent}`,
                  background: token.colorBgContainer,
                  flexShrink: 0,
                  boxSizing: 'border-box',
                  transition: 'all 0.2s ease'
                }}
              />
            )}
          </button>
        )
      })}
    </div>
  )
}

export default OptionCards
