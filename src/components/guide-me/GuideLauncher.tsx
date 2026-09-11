import { CompassOutlined } from '@ant-design/icons'
import { Button, FloatButton } from 'antd'
import type { ButtonProps } from 'antd'

import { useOptionalGuide } from './GuideContext'

type GuideLauncherProps = {
    mode?: 'button' | 'fab'
    label?: string
    buttonProps?: Omit<
        ButtonProps,
        'onClick' | 'icon' | 'children'
    >
}

const guideIcon = (
    <CompassOutlined
        style={{
            color: '#1677ff',
            fontSize: 16,
            filter: 'drop-shadow(0 0 3px rgba(22, 119, 255, 0.65))'
        }}
    />
)

export const GuideLauncher = ({
    mode = 'button',
    label = 'Guide Me',
    buttonProps
}: GuideLauncherProps) => {
    const guide = useOptionalGuide()

    if (!guide?.hasGuides) return null

    const { openGuideModal } = guide

    if (mode === 'fab') {
        return (
            <FloatButton
                className="guide-launcher-fab"
                icon={guideIcon}
                tooltip={label}
                onClick={openGuideModal}
                style={{
                    border: '1px solid #69b1ff',
                    background: '#e6f4ff',
                    boxShadow:
                        '0 8px 22px rgba(22, 119, 255, 0.22), 0 0 0 1px rgba(22, 119, 255, 0.08)'
                }}
            />
        )
    }

    const {
        className: externalClassName,
        style: externalStyle,
        ...restButtonProps
    } = buttonProps || {}

    return (
        <Button
            {...restButtonProps}
            className={[
                'guide-launcher-button',
                externalClassName
            ]
                .filter(Boolean)
                .join(' ')}
            icon={guideIcon}
            onClick={openGuideModal}
            style={{
                ...externalStyle,

                // Enforce the Guide Me visual identity even if the surrounding header
                // passes type="text" or borderless styles.
                minHeight: 36,
                paddingInline: 15,

                border: '1px solid #69b1ff',
                borderRadius: 999,

                background: '#e6f4ff',
                color: '#0958d9',

                fontWeight: 600,

                boxShadow:
                    '0 4px 12px rgba(22, 119, 255, 0.12), inset 0 0 0 1px rgba(255, 255, 255, 0.45)'
            }}
        >
            {label}
        </Button>
    )
}
