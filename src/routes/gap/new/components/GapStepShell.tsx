import React from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Button, Card, Typography, theme } from 'antd'
import { ArrowLeftOutlined, ArrowRightOutlined, CheckOutlined } from '@ant-design/icons'
import type { FlowDirection } from '../types'

const { Title, Text } = Typography

/**
 * The onboarding flow's per-screen shell — an animated slide/fade card with
 * an optional heading and an inline (not sticky) Back/Continue button row —
 * reused here as the container for each GAP analysis step.
 */
const GapStepShell: React.FC<{
    stepKey: string
    direction: FlowDirection
    title?: string
    description?: string
    children: React.ReactNode
    align?: 'start' | 'center'
    maxWidth?: number
    onBack?: () => void
    showBack?: boolean
    backLabel?: string
    onContinue?: () => void
    continueLabel?: string
    continueDisabled?: boolean
    continueLoading?: boolean
    isFinalStep?: boolean
    isEditing?: boolean
}> = ({
    stepKey,
    direction,
    title,
    description,
    children,
    align = 'start',
    onBack,
    showBack = true,
    backLabel,
    onContinue,
    continueLabel,
    continueDisabled,
    continueLoading,
    isFinalStep,
    isEditing
}) => {
        const { token } = theme.useToken()
        const reduceMotion = useReducedMotion()

        const transition = reduceMotion
            ? {
                initial: { opacity: 1, x: 0 },
                animate: { opacity: 1, x: 0 },
                exit: { opacity: 1, x: 0 },
                transition: { duration: 0 }
            }
            : {
                initial: { opacity: 0, x: direction === 'forward' ? 48 : -48 },
                animate: { opacity: 1, x: 0 },
                exit: { opacity: 0, x: direction === 'forward' ? -48 : 48 },
                transition: { duration: 0.24, ease: [0.22, 1, 0.36, 1] as const }
            }

        return (
            <AnimatePresence mode="wait" initial={false}>
                <motion.div
                    key={stepKey}
                    {...transition}
                    style={{
                        height: '100%',
                        minHeight: 0,
                        overflow: 'auto',
                        scrollbarGutter: 'stable',
                        display: 'grid',
                        alignItems: align,
                        padding: '8px 0 16px'
                    }}
                >
                    <Card
                        styles={{ body: { padding: 'clamp(22px, 4vw, 36px)' } }}
                        style={{
                            borderRadius: 24,
                            border: `1px solid ${token.colorBorderSecondary}`
                        }}
                    >
                        {title && (
                            <div style={{ marginBottom: 18 }}>
                                <Title level={3} style={{ marginBottom: 4 }}>
                                    {title}
                                </Title>
                                {description && (
                                    <Text type="secondary">{description}</Text>
                                )}
                            </div>
                        )}

                        {children}

                        {(onBack || onContinue) && (
                            <div
                                style={{
                                    display: 'grid',
                                    gridTemplateColumns:
                                        showBack && onBack
                                            ? 'repeat(2, minmax(0, 1fr))'
                                            : 'minmax(0, 1fr)',
                                    gap: 10,
                                    marginTop: 22
                                }}
                            >
                                {showBack && onBack && (
                                    <Button
                                        size="middle"
                                        icon={<ArrowLeftOutlined />}
                                        onClick={onBack}
                                        style={{ width: '100%', borderRadius: 10, fontWeight: 600 }}
                                    >
                                        {backLabel || (isEditing ? 'Back to review' : 'Back')}
                                    </Button>
                                )}

                                {onContinue && (
                                    <Button
                                        type="primary"
                                        size="middle"
                                        disabled={continueDisabled}
                                        loading={continueLoading}
                                        icon={
                                            isFinalStep || isEditing ? (
                                                <CheckOutlined />
                                            ) : (
                                                <ArrowRightOutlined />
                                            )
                                        }
                                        iconPosition={isFinalStep || isEditing ? undefined : 'end'}
                                        onClick={onContinue}
                                        style={{ width: '100%', borderRadius: 10, fontWeight: 600 }}
                                    >
                                        {continueLabel ||
                                            (isFinalStep
                                                ? 'Submit Assessment'
                                                : isEditing
                                                    ? 'Done'
                                                    : 'Continue')}
                                    </Button>
                                )}
                            </div>
                        )}
                    </Card>
                </motion.div>
            </AnimatePresence>
        )
    }

export default GapStepShell
