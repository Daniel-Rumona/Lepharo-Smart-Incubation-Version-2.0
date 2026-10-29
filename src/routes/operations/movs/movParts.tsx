import React from 'react'
import { Button, Dropdown } from 'antd'
import { DownOutlined, PaperClipOutlined } from '@ant-design/icons'
import type { PoeResource } from './movData'

/** A small coloured status word, toned like the metric chips. */
export const StatusPill: React.FC<{ tone: string; children: React.ReactNode; title?: string }> = ({ tone, children, title }) => (
    <span className={`mv-pill qtx-tone-${tone}`} title={title}>{children}</span>
)

/** One evidence link opens directly; several open from a menu. */
export const PoeButton: React.FC<{ list: PoeResource[]; block?: boolean; type?: 'default' | 'link' }> = ({ list, block, type = 'default' }) => {
    if (!list.length) return null
    if (list.length === 1) {
        return (
            <Button block={block} type={type} icon={<PaperClipOutlined />} onClick={() => window.open(list[0].link, '_blank', 'noopener')}>
                Evidence
            </Button>
        )
    }
    return (
        <Dropdown
            trigger={['click']}
            menu={{ items: list.map((p, i) => ({ key: `${p.link}-${i}`, label: p.label || `POE ${i + 1}`, onClick: () => window.open(p.link, '_blank', 'noopener') })) }}
        >
            <Button block={block} type={type} icon={<PaperClipOutlined />}>
                Evidence ({list.length}) <DownOutlined />
            </Button>
        </Dropdown>
    )
}

