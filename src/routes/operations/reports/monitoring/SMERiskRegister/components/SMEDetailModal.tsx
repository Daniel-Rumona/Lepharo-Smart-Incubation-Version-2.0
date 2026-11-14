import { Modal } from 'antd'

import SMEDetailPanel, { type SMEDetailPanelProps } from './SMEDetailPanel'

type Props = SMEDetailPanelProps & {
    open: boolean
    onClose: () => void
}

/** The detail panel in a modal, for screens too narrow for the register's two panels. */
export default function SMEDetailModal({ open, onClose, ...panelProps }: Props) {
    return (
        <Modal
            open={open && Boolean(panelProps.row)}
            onCancel={onClose}
            footer={null}
            width={1080}
            centered
            title={null}
            styles={{ body: { paddingTop: 4 } }}
        >
            <SMEDetailPanel {...panelProps} headerInsetRight={28} />
        </Modal>
    )
}
