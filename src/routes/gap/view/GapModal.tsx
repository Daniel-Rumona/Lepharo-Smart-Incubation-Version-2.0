import React from 'react'
import { Grid, Modal } from 'antd'
import GapDetail from './GapDetail'
import type { SectionKey } from '../sections'

const { useBreakpoint } = Grid

export type GapAnalysisViewModalProps = {
    open: boolean
    onClose: () => void

    gapId?: string | null
    /** applications/{appId}/complianceDocuments/{gapId} — needed to reload a manual GAP */
    appId?: string | null
    manualRecord?: any | null

    isROM: boolean
    allowedSections?: SectionKey[] | 'ALL'

    romName?: string
    romEmail?: string
}

/**
 * Thin modal shell around GapDetail, for places that view a GAP without leaving
 * their own context (compliance documents, the incubatee drawer).
 *
 * The canonical surface is the full page at /operations/gap/:id — prefer that
 * from the GAP list. All content, actions and the confirm flow live in GapDetail
 * so the two surfaces cannot drift apart.
 */
const GapAnalysisViewModal: React.FC<GapAnalysisViewModalProps> = ({
    open,
    onClose,
    gapId,
    appId,
    manualRecord,
    isROM,
    allowedSections,
    romName,
    romEmail
}) => {
    const screens = useBreakpoint()
    const isMobile = !screens.md

    return (
        <Modal
            title={null}
            open={open}
            onCancel={onClose}
            footer={null}
            width={isMobile ? '100%' : 1200}
            style={isMobile ? { top: 8 } : undefined}
            styles={{ body: { padding: isMobile ? 12 : 16, maxHeight: '78vh', overflowY: 'auto' } }}
            destroyOnClose
        >
            {open && (
                <GapDetail
                    gapId={gapId}
                    appId={appId}
                    manualRecord={manualRecord}
                    isROM={isROM}
                    allowedSections={allowedSections}
                    romName={romName}
                    romEmail={romEmail}
                    mode='embedded'
                    onBack={onClose}
                />
            )}
        </Modal>
    )
}

export default GapAnalysisViewModal
