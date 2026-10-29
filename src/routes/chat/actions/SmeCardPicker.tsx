import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Avatar, Button, Empty, Input, Tag, Typography } from 'antd'
import { LeftOutlined, RightOutlined, SearchOutlined, UserOutlined } from '@ant-design/icons'
import type { SchedulableSme } from '@/services/coordinatorSchedulingService'
import './schedule-flow.css'

const { Text, Title } = Typography

const SWIPE_THRESHOLD_PX = 40

type Props = {
    smes: SchedulableSme[]
    initialQuery?: string
    onSelect: (sme: SchedulableSme) => void
}

const SmeCardPicker: React.FC<Props> = ({ smes, initialQuery = '', onSelect }) => {
    const [query, setQuery] = useState(initialQuery)
    const [index, setIndex] = useState(0)
    const touchStartX = useRef<number | null>(null)

    const filtered = useMemo(() => {
        const needle = query.trim().toLowerCase()
        if (!needle) return smes
        return smes.filter(sme =>
            sme.name.toLowerCase().includes(needle) ||
            sme.companyName.toLowerCase().includes(needle)
        )
    }, [smes, query])

    useEffect(() => { setIndex(0) }, [query])

    const count = filtered.length
    const current = count ? filtered[Math.min(index, count - 1)] : null

    const go = (delta: number) => {
        if (!count) return
        setIndex(value => (value + delta + count) % count)
    }

    const onKeyDown = (event: React.KeyboardEvent) => {
        if (event.key === 'ArrowLeft') { event.preventDefault(); go(-1) }
        if (event.key === 'ArrowRight') { event.preventDefault(); go(1) }
        if (event.key === 'Enter' && current && event.target === event.currentTarget) onSelect(current)
    }

    return (
        <div className='sme-picker' onKeyDown={onKeyDown}>
            <Input
                allowClear
                size='large'
                prefix={<SearchOutlined />}
                placeholder='Search by SME or company'
                value={query}
                onChange={event => setQuery(event.target.value)}
                aria-label='Search SMEs'
            />

            {current ? (
                <>
                    <div className='sme-picker-stage'>
                        <Button
                            shape='circle'
                            size='large'
                            icon={<LeftOutlined />}
                            onClick={() => go(-1)}
                            disabled={count < 2}
                            aria-label='Previous SME'
                            className='sme-picker-arrow'
                        />

                        <div
                            className='sme-card'
                            tabIndex={0}
                            onTouchStart={event => { touchStartX.current = event.touches[0].clientX }}
                            onTouchEnd={event => {
                                const start = touchStartX.current
                                touchStartX.current = null
                                if (start === null) return
                                const delta = event.changedTouches[0].clientX - start
                                if (Math.abs(delta) >= SWIPE_THRESHOLD_PX) go(delta < 0 ? 1 : -1)
                            }}
                        >
                            <Avatar
                                className='sme-card-avatar'
                                size={96}
                                src={current.photoUrl || undefined}
                                icon={!current.photoUrl ? <UserOutlined /> : undefined}
                            >
                                {current.name.slice(0, 1).toUpperCase()}
                            </Avatar>
                            <Title level={4} className='sme-card-company'>
                                {current.companyName || current.name}
                            </Title>
                            {current.companyName && (
                                <Text type='secondary' className='sme-card-name'>{current.name}</Text>
                            )}
                            <Tag className='sme-card-tag'>
                                {current.assignments.length} open intervention{current.assignments.length === 1 ? '' : 's'}
                            </Tag>
                        </div>

                        <Button
                            shape='circle'
                            size='large'
                            icon={<RightOutlined />}
                            onClick={() => go(1)}
                            disabled={count < 2}
                            aria-label='Next SME'
                            className='sme-picker-arrow'
                        />
                    </div>

                    <Text type='secondary' className='sme-picker-count'>
                        {Math.min(index, count - 1) + 1} of {count}
                    </Text>

                    <Button type='primary' size='large' block shape='round' onClick={() => onSelect(current)}>
                        Select {current.companyName || current.name}
                    </Button>
                </>
            ) : (
                <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={smes.length ? 'No SME matches that search.' : 'You have no SMEs with open interventions to schedule.'}
                />
            )}
        </div>
    )
}

export default SmeCardPicker
