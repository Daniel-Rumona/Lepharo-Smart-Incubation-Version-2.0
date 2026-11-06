import React, { useState } from 'react'
import { Button, Select, Tooltip } from 'antd'
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { collection, getDocs, limit, query } from 'firebase/firestore'
import { db } from '@/firebase'
import { useDepartmentRoles } from '@/services/departmentRoles'
import { SOURCE_CONFIGS, type FilterOp, type KpiFilter, type SourceType } from './kpiModel'

/* --- Value suggestions ---------------------------------------------------------- */

// Distinct values per source+field, loaded once per session the first time a
// value dropdown opens. Business-metric and sector values come from
// participants, the records those fields actually describe.
const suggestionCache = new Map<string, string[]>()

const loadSuggestions = async (st: SourceType, fieldKey: string): Promise<string[]> => {
    const cacheKey = `${st}|${fieldKey}`
    const cached = suggestionCache.get(cacheKey)
    if (cached) return cached
    const cfg = SOURCE_CONFIGS[st]
    const field = cfg.fields.find(f => f.key === fieldKey)
    const firestoreKey = field?.sourceFieldKey || fieldKey
    const target = st === 'metrics' || fieldKey === 'sector' ? 'participants' : cfg.collection
    const snap = await getDocs(query(collection(db, target), limit(350)))
    const values = new Set<string>()
    snap.docs.forEach(d => {
        const raw = (d.data() as any)?.[firestoreKey]
        ;(Array.isArray(raw) ? raw : [raw]).forEach(v => {
            const t = String(v ?? '').trim()
            if (t) values.add(t)
        })
    })
    const list = Array.from(values).sort((a, b) => a.localeCompare(b)).slice(0, 120)
    suggestionCache.set(cacheKey, list)
    return list
}

const ValueInput: React.FC<{ st: SourceType; condition: KpiFilter; onChange: (value: any) => void }> = ({ st, condition, onChange }) => {
    const field = SOURCE_CONFIGS[st].fields.find(f => f.key === condition.field)
    const [options, setOptions] = useState<string[] | null>(field ? suggestionCache.get(`${st}|${field.key}`) || null : null)
    const [loading, setLoading] = useState(false)
    const { departments } = useDepartmentRoles()
    const multiple = condition.op === 'in'

    if (!field) return <Select disabled placeholder='Value' style={{ width: '100%' }} />

    if (field.type === 'department') {
        return (
            <Select
                mode={multiple ? 'multiple' : undefined}
                placeholder={multiple ? 'Choose departments' : 'Choose a department'}
                style={{ width: '100%' }}
                showSearch
                optionFilterProp='label'
                value={condition.value ?? undefined}
                onChange={onChange}
                options={departments.map(dep => ({ value: dep.id, label: String(dep.name || dep.id) }))}
            />
        )
    }

    if (field.type === 'enum' && field.enumOptions?.length) {
        return (
            <Select
                mode={multiple ? 'multiple' : undefined}
                placeholder={multiple ? 'Choose values' : 'Choose a value'}
                style={{ width: '100%' }}
                value={condition.value ?? undefined}
                onChange={onChange}
                options={field.enumOptions.map(o => ({ value: o.value, label: o.label }))}
            />
        )
    }

    return (
        <Select
            mode={multiple ? 'multiple' : undefined}
            placeholder={multiple ? 'Choose values' : 'Choose a value'}
            style={{ width: '100%' }}
            showSearch
            loading={loading}
            value={condition.value ?? undefined}
            onChange={onChange}
            notFoundContent={loading ? 'Loading…' : 'No values found'}
            onDropdownVisibleChange={async open => {
                if (!open || options) return
                setLoading(true)
                try {
                    setOptions(await loadSuggestions(st, field.key))
                } catch {
                    setOptions([])
                } finally {
                    setLoading(false)
                }
            }}
            options={(options || []).map(v => ({ value: v, label: v }))}
        />
    )
}

/**
 * "Only include records where…" — a list of field / is / value rows. Rows can
 * be added half-finished; the builder's validation asks for them to be
 * completed or removed before continuing.
 */
export const KpiConditions: React.FC<{
    sourceType: SourceType
    value: KpiFilter[]
    onChange: (next: KpiFilter[]) => void
    addLabel?: string
}> = ({ sourceType, value, onChange, addLabel = 'Add condition' }) => {
    const fields = SOURCE_CONFIGS[sourceType].fields.filter(f => f.isCondition)
    const update = (index: number, patch: Partial<KpiFilter>) =>
        onChange(value.map((c, i) => (i === index ? { ...c, ...patch } : c)))

    return (
        <div className='kb-conditions'>
            {value.map((condition, index) => (
                <div className='kb-condition' key={index}>
                    <Select
                        className='kb-condition-field'
                        placeholder='Field'
                        value={condition.field || undefined}
                        onChange={field => update(index, { field, value: undefined })}
                        options={fields.map(f => ({ value: f.key, label: f.label }))}
                    />
                    <Select<FilterOp>
                        className='kb-condition-op'
                        value={condition.op}
                        onChange={op => update(index, { op, value: undefined })}
                        options={[
                            { value: '==', label: 'is' },
                            { value: '!=', label: 'is not' },
                            { value: 'in', label: 'is one of' }
                        ]}
                    />
                    <div className='kb-condition-value'>
                        <ValueInput st={sourceType} condition={condition} onChange={v => update(index, { value: v })} />
                    </div>
                    <Tooltip title='Remove condition'>
                        <Button
                            type='text'
                            danger
                            icon={<DeleteOutlined />}
                            aria-label='Remove condition'
                            onClick={() => onChange(value.filter((_, i) => i !== index))}
                        />
                    </Tooltip>
                </div>
            ))}
            <Button
                className='kb-condition-add'
                type='dashed'
                icon={<PlusOutlined />}
                onClick={() => onChange([...value, { field: '', op: '==', value: undefined }])}
            >
                {addLabel}
            </Button>
        </div>
    )
}
