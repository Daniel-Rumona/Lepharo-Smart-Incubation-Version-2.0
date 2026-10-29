import type { ReactNode } from 'react'
import { Button } from 'antd'
import { ArrowLeftOutlined, FileSearchOutlined, HomeOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import './record-unavailable.css'

type Action = { label: string; to: string }

type RecordUnavailableProps = {
    /** What the person was trying to open, e.g. "inquiry". */
    noun: string
    /**
     * Why it can't be shown. 'missing-id': the link carried no record id;
     * 'not-found': the id points at nothing (deleted, or never existed);
     * 'incomplete': the record exists but is missing data needed to show it.
     */
    reason: 'missing-id' | 'not-found' | 'incomplete'
    /** Where the list of these records lives, so there's a way forward. */
    back: Action
    icon?: ReactNode
    /** Optional technical detail, shown small (e.g. which fields are missing). */
    detail?: string
}

const COPY: Record<RecordUnavailableProps['reason'], (noun: string) => { title: string; body: string }> = {
    'missing-id': noun => ({
        title: `Which ${noun}?`,
        body: `This link didn't say which ${noun} to open. Pick one from the list instead.`,
    }),
    'not-found': noun => ({
        title: `This ${noun} isn't available`,
        body: `It may have been deleted or moved, or the link is out of date.`,
    }),
    incomplete: noun => ({
        title: `This ${noun} can't be shown yet`,
        body: `Some of its details are missing. Ask an administrator to check the record.`,
    }),
}

/**
 * In-layout stand-in for a record page that can't show its record, used
 * instead of a bare "Invalid ID" line. Same tokens as the account and
 * notification panels, so it reads as part of the workspace, not an error dump.
 */
export function RecordUnavailable({ noun, reason, back, icon, detail }: RecordUnavailableProps) {
    const navigate = useNavigate()
    const { title, body } = COPY[reason](noun)

    return (
        <div className='record-unavailable' role='status'>
            <div className='record-unavailable-card'>
                <span className='record-unavailable-icon' aria-hidden='true'>
                    {icon ?? <FileSearchOutlined />}
                </span>
                <h2>{title}</h2>
                <p>{body}</p>
                {detail && <code className='record-unavailable-detail'>{detail}</code>}
                <div className='record-unavailable-actions'>
                    <Button type='primary' shape='round' icon={<ArrowLeftOutlined />} onClick={() => navigate(back.to)}>
                        {back.label}
                    </Button>
                    <Button shape='round' icon={<HomeOutlined />} onClick={() => navigate('/')}>
                        Home
                    </Button>
                </div>
            </div>
        </div>
    )
}

export default RecordUnavailable
