import React, { useMemo, useState } from 'react'
import { Select } from 'antd'
import { buildCoverageTopicCatalog, canonicalizeCoverageTopics, coverageTopicKey } from '@/lib/coverageTopics'

interface Props {
    value?: string[]
    onChange?: (value: string[]) => void
    topics: string[]
    id?: string
}

/** New topics persist through the normal appointment save, then become suggestions. */
const CoverageTopicSelect: React.FC<Props> = ({ value = [], onChange, topics, id }) => {
    const [search, setSearch] = useState('')
    const catalog = useMemo(() => buildCoverageTopicCatalog([...topics, ...value]), [topics, value])
    const options = catalog.filter(topic => topic.toLowerCase().includes(search.trim().toLowerCase()) ||
        (search.trim() && coverageTopicKey(topic) === coverageTopicKey(search)))
        .map(topic => ({ value: topic, label: topic }))
    const existing = catalog.find(topic => coverageTopicKey(topic) === coverageTopicKey(search))
    if (search.trim() && !existing) options.push({ value: search.trim(), label: `Add new topic: ${search.trim()}` })
    return <Select
        id={id}
        mode='multiple'
        showSearch
        allowClear
        value={value}
        searchValue={search}
        onSearch={setSearch}
        filterOption={false}
        options={options}
        onChange={next => { onChange?.(canonicalizeCoverageTopics(next, catalog)); setSearch('') }}
        placeholder='Search a topic or unit standard, or add a new topic'
        notFoundContent='Type a topic to add it'
        style={{ width: '100%' }}
    />
}

export default CoverageTopicSelect
