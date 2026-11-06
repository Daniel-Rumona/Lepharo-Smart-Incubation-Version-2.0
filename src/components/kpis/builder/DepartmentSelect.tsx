import React from 'react'
import { Select, Tag } from 'antd'
import { ApartmentOutlined } from '@ant-design/icons'
import { EntityAvatar } from '@/components/workspace'
import type { Department } from './kpiDraft'

type Common = {
    id?: string
    departments: Department[]
    placeholder?: string
    disabled?: boolean
    /** Optional per-department note shown under the name in the list, e.g. "Lead". */
    note?: (dep: Department) => React.ReactNode
}

/** Option row: the department's initials badge, its name, and an optional note. */
const optionContent = (dep: Department, note?: React.ReactNode) => (
    <span className='kb-dept-option'>
        <EntityAvatar name={dep.name} size={26} />
        <span className='kb-dept-option-text'>
            <span className='kb-dept-option-name'>{dep.name}</span>
            {note ? <span className='kb-dept-option-note'>{note}</span> : null}
        </span>
    </span>
)

const toOptions = (departments: Department[], note?: Common['note']) =>
    departments.map(dep => ({ value: dep.id, label: dep.name, dep, note: note?.(dep) }))

/** Pick one department by id. */
export const DepartmentSelect: React.FC<Common & {
    value?: string | null
    onChange: (value: string) => void
}> = ({ id, departments, value, onChange, placeholder = 'Choose a department', disabled, note }) => (
    <Select
        id={id}
        className='kb-select'
        popupClassName='kb-select-popup'
        showSearch
        optionFilterProp='label'
        placeholder={placeholder}
        disabled={disabled}
        value={value || undefined}
        onChange={onChange}
        prefix={<ApartmentOutlined className='kb-select-prefix' aria-hidden='true' />}
        options={toOptions(departments, note)}
        optionRender={option => optionContent((option.data as any).dep, (option.data as any).note)}
        notFoundContent='No departments match'
    />
)

/** Pick several departments; chosen ones show as removable chips with their initials. */
export const DepartmentMultiSelect: React.FC<Common & {
    value: string[]
    onChange: (value: string[]) => void
}> = ({ id, departments, value, onChange, placeholder = 'Add departments', disabled, note }) => (
    <Select
        id={id}
        className='kb-select'
        popupClassName='kb-select-popup'
        mode='multiple'
        showSearch
        optionFilterProp='label'
        placeholder={placeholder}
        disabled={disabled}
        value={value}
        onChange={onChange}
        options={toOptions(departments, note)}
        optionRender={option => optionContent((option.data as any).dep, (option.data as any).note)}
        tagRender={({ value: v, closable, onClose }) => {
            const dep = departments.find(d => d.id === v)
            return (
                <Tag
                    className='kb-dept-chip'
                    bordered={false}
                    closable={closable}
                    onClose={onClose}
                    onMouseDown={e => {
                        // Keep the dropdown from toggling when a chip's × is pressed.
                        e.preventDefault()
                        e.stopPropagation()
                    }}
                >
                    <EntityAvatar name={dep?.name || String(v)} size={18} />
                    {dep?.name || String(v)}
                </Tag>
            )
        }}
        notFoundContent='No departments match'
    />
)
