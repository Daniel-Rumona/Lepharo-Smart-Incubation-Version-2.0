import React from 'react'
import { Drawer, Grid, Modal } from 'antd'

const { useBreakpoint } = Grid

type ResponsiveSheetProps = {
    open: boolean
    title?: React.ReactNode
    onClose: () => void
    footer?: React.ReactNode
    /** Desktop modal width. */
    width?: number
    /**
     * Mobile drawer only: use the system's modal-style drawer (centred title,
     * close button on the right, no grab handle) instead of the plain sheet.
     */
    modalStyle?: boolean
    children: React.ReactNode
}

/**
 * A centered modal on desktop, a bottom drawer on mobile — one place for the
 * "same interaction, shaped for the screen" pattern the agentic flows use.
 */
const ResponsiveSheet: React.FC<ResponsiveSheetProps> = ({
    open,
    title,
    onClose,
    footer,
    width = 560,
    modalStyle = false,
    children
}) => {
    const screens = useBreakpoint()
    const isMobile = !screens.md

    if (isMobile) {
        return (
            <Drawer
                open={open}
                title={title}
                placement='bottom'
                height='92dvh'
                onClose={onClose}
                destroyOnClose
                footer={footer}
                rootClassName={
                    modalStyle
                        ? 'modal-style-drawer responsive-sheet-drawer'
                        : 'responsive-sheet-drawer'
                }
                styles={{
                    body: { padding: '4px 16px 16px' },
                    footer: { padding: '12px 16px calc(12px + env(safe-area-inset-bottom))' }
                }}
            >
                {!modalStyle && <div className='responsive-sheet-grabber' aria-hidden='true' />}
                {children}
            </Drawer>
        )
    }

    return (
        <Modal
            open={open}
            title={title}
            onCancel={onClose}
            footer={footer ?? null}
            width={width}
            centered
            destroyOnClose
            maskClosable={false}
        >
            {children}
        </Modal>
    )
}

export default ResponsiveSheet
