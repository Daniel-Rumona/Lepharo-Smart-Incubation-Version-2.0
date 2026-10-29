import React from 'react'
import { Typography, theme } from 'antd'
import { FileProtectOutlined } from '@ant-design/icons'
import './intervention-completion.css'

const { Text } = Typography

/** Card title: tinted icon tile plus a title that truncates instead of pushing the tag onto its own line. */
export const EvidenceCardTitle: React.FC<{ title: string; tone: 'required' | 'optional' }> = ({ title, tone }) => {
    const { token } = theme.useToken()
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <span
                style={{
                    flex: '0 0 auto',
                    width: 32,
                    height: 32,
                    borderRadius: 10,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: tone === 'required' ? token.colorError : token.colorPrimary,
                    background: tone === 'required' ? token.colorErrorBg : token.colorPrimaryBg
                }}
            >
                <FileProtectOutlined />
            </span>
            <Text strong ellipsis={{ tooltip: title }} style={{ minWidth: 0, fontSize: 15 }}>
                {title}
            </Text>
        </div>
    )
}

/** Rounded status tag used in evidence card headers. */
export const pillTag: React.CSSProperties = { marginInlineEnd: 0, borderRadius: 999, paddingInline: 10 }

/** Card props shared by the MOV and POE evidence cards. */
export const evidenceCardProps = {
    className: 'completion-evidence-card',
    style: { borderRadius: 16, height: '100%' } as React.CSSProperties,
    styles: { header: { padding: '12px 20px', minHeight: 56 }, body: { padding: 20 } }
}

export default EvidenceCardTitle
