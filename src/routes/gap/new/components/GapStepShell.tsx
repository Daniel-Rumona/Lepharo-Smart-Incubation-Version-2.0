import React from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Button, Card, Typography, theme } from 'antd'
import { ArrowLeftOutlined, ArrowRightOutlined, CheckOutlined } from '@ant-design/icons'
import type { FlowDirection } from '../types'

const { Title, Text } = Typography

/**
 * The onboarding flow's per-screen shell — an animated slide/fade card with
 * an optional heading and an inline Back/Continue button row — reused here as
 * the container for each GAP analysis step. On phones there is no card: the
 * step sits straight on the page and the buttons stay pinned at the bottom.
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
    /** Why Continue is off, shown above the buttons while it is. */
    continueHint?: string
    continueLoading?: boolean
    isFinalStep?: boolean
    isEditing?: boolean
    isMobile?: boolean
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
    continueHint,
    continueLoading,
    isFinalStep,
    isEditing,
    isMobile
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

        const heading = title && (
            <div style={{ marginBottom: 18 }}>
                <Title level={isMobile ? 4 : 3} style={{ marginBottom: 4 }}>
                    {title}
                </Title>
                {description && <Text type="secondary">{description}</Text>}
            </div>
        )

        const actions = (onBack || onContinue) && (
            <div
                style={
                    isMobile
                        ? {
                            // Pinned to the bottom of the step's scroll area,
                            // flush with the screen edges.
                            position: 'sticky',
                            bottom: 0,
                            zIndex: 2,
                            marginTop: 'auto',
                            marginInline: -16,
                            padding: '10px 16px calc(20px + env(safe-area-inset-bottom))',
                            background: token.colorBgLayout,
                            borderTop: `1px solid ${token.colorBorderSecondary}`
                        }
                        : { marginTop: 22 }
                }
            >
                {continueDisabled && continueHint && !continueLoading && (
                    <Text
                        type="secondary"
                        style={{ display: 'block', marginBottom: 8, fontSize: 12.5, textAlign: 'center' }}
                    >
                        {continueHint}
                    </Text>
                )}
                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns:
                            showBack && onBack
                                ? 'repeat(2, minmax(0, 1fr))'
                                : 'minmax(0, 1fr)',
                        gap: 10
                    }}
                >
                    {showBack && onBack && (
                        <Button
                            size={isMobile ? 'large' : 'middle'}
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
                            size={isMobile ? 'large' : 'middle'}
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
            </div>
        )

        return (
            <AnimatePresence mode="wait" initial={false}>
                <motion.div
                    key={stepKey}
                    {...transition}
                    style={{
                        height: '100%',
                        minHeight: 0,
                        overflow: 'auto',
                        scrollbarGutter: isMobile ? undefined : 'stable',
                        display: 'grid',
                        alignItems: align,
                        // On phones the scroll area spans the screen edge to
                        // edge, so the action bar's full-width bleed fits inside
                        // it instead of scrolling the step sideways.
                        ...(isMobile
                            ? { margin: '0 -16px', padding: '8px 16px 0', overflowX: 'hidden' as const }
                            : { padding: '8px 0 16px' })
                    }}
                >
                    {isMobile ? (
                        // Fills the screen so the action bar rests at the bottom
                        // even when a step is shorter than the screen.
                        <div
                            style={{
                                minHeight: '100%',
                                minWidth: 0,
                                display: 'flex',
                                flexDirection: 'column',
                                alignSelf: 'stretch'
                            }}
                        >
                            {heading}
                            {children}
                            <div style={{ height: 22, flex: '0 0 auto' }} />
                            {actions}
                        </div>
                    ) : (
                        <Card
                            styles={{ body: { padding: 'clamp(22px, 4vw, 36px)' } }}
                            style={{
                                borderRadius: 24,
                                border: `1px solid ${token.colorBorderSecondary}`
                            }}
                        >
                            {heading}
                            {children}
                            {actions}
                        </Card>
                    )}
                </motion.div>
            </AnimatePresence>
        )
    }

export default GapStepShell
