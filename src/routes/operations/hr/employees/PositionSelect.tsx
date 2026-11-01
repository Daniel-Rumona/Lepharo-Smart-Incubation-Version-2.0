import React, { useMemo, useState } from 'react'
import { Select } from 'antd'
import { normalizePositionLabel } from './employeeShared'

type Props = {
    positions: string[]
    value?: string
    onChange?: (value: string) => void
    id?: string
}

/** Pick a known HR position, or type a new one and choose "Add". Form.Item controls value/onChange. */
export const PositionSelect: React.FC<Props> = ({ positions, value, onChange, id }) => {
    const [search, setSearch] = useState('')

    const options = useMemo(() => {
        const typed = normalizePositionLabel(search)
        const known = positions.map(position => ({ value: position, label: position }))
        const isNew = typed && !positions.some(position => position.toLowerCase() === typed.toLowerCase())
        return isNew ? [{ value: typed, label: `Add “${typed}”` }, ...known] : known
    }, [positions, search])

    return (
        <Select
            id={id}
            showSearch
            value={value || undefined}
            placeholder='Select or type a position'
            optionFilterProp='label'
            filterOption={(input, option) =>
                String(option?.value || '').toLowerCase().includes(input.trim().toLowerCase())
            }
            searchValue={search}
            onSearch={setSearch}
            onChange={next => {
                onChange?.(normalizePositionLabel(String(next)))
                setSearch('')
            }}
            options={options}
        />
    )
}

export default PositionSelect
