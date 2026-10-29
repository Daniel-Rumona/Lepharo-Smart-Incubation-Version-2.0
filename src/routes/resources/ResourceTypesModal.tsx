import React, { useEffect, useState } from 'react'
import {
  Modal,
  Card,
  List,
  Input,
  Button,
  Space,
  Popconfirm,
  Tooltip,
  Typography,
  message
} from 'antd'
import {
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  CheckOutlined,
  CloseOutlined
} from '@ant-design/icons'
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  serverTimestamp,
  writeBatch,
  getDocs,
  query,
  where
} from 'firebase/firestore'
import { db } from '@/firebase'
import OptionCards from './OptionCards'

const { Text } = Typography

// quantity: a pool of interchangeable units (chairs, laptops, seats in a hall)
// single: booked as a whole, one booking at a time (vehicle, boardroom)
export type BookingMode = 'quantity' | 'single'

export const BOOKING_MODE_OPTIONS: { value: BookingMode; label: string }[] = [
  { value: 'quantity', label: 'Quantity' },
  { value: 'single', label: 'Single booking' }
]

export interface ResourceTypeOption {
  id?: string
  value: string
  label: string
  mode?: BookingMode
}

// Shown (and seeded on first edit) until the resourceTypes collection has entries
export const DEFAULT_RESOURCE_TYPES: ResourceTypeOption[] = [
  { value: 'room', label: 'Room', mode: 'quantity' },
  { value: 'equipment', label: 'Equipment', mode: 'quantity' },
  { value: 'vehicle', label: 'Vehicle', mode: 'single' }
]

// Types saved before modes existed have no mode; vehicles were the only
// whole-unit bookings then, everything else was counted.
export const getBookingMode = (
  type: Pick<ResourceTypeOption, 'value' | 'mode'> | undefined
): BookingMode =>
  type?.mode ||
  (/vehicle|car|van|bus|truck/.test(type?.value || '') ? 'single' : 'quantity')

const toTypeValue = (label: string) =>
  label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')

interface Props {
  open: boolean
  onClose: () => void
  types: ResourceTypeOption[]
  // Number of resources using each type value; types in use can't be deleted
  usage: Record<string, number>
  onChanged: () => void
}

const ResourceTypesModal: React.FC<Props> = ({
  open,
  onClose,
  types,
  usage,
  onChanged
}) => {
  const [newLabel, setNewLabel] = useState('')
  const [newMode, setNewMode] = useState<BookingMode>('quantity')
  const [editingValue, setEditingValue] = useState<string | null>(null)
  const [editingLabel, setEditingLabel] = useState('')
  const [saving, setSaving] = useState(false)
  const [modal, modalContextHolder] = Modal.useModal()

  useEffect(() => {
    if (!open) {
      setNewLabel('')
      setNewMode('quantity')
      setEditingValue(null)
    }
  }, [open])

  // Defaults aren't stored yet; persist them before the first change so they
  // aren't lost once the collection stops being empty.
  const ensureSeeded = async (): Promise<ResourceTypeOption[]> => {
    if (types.some(t => t.id)) return types
    const batch = writeBatch(db)
    const seeded = types.map(t => {
      const ref = doc(collection(db, 'resourceTypes'))
      batch.set(ref, {
        value: t.value,
        label: t.label,
        mode: getBookingMode(t),
        createdAt: serverTimestamp()
      })
      return { ...t, id: ref.id }
    })
    await batch.commit()
    return seeded
  }

  const run = async (fn: () => Promise<void>) => {
    setSaving(true)
    try {
      await fn()
      onChanged()
    } catch (error) {
      console.error('Resource type update failed:', error)
      message.error('Failed to update resource types')
    } finally {
      setSaving(false)
    }
  }

  const handleAdd = () => {
    const label = newLabel.trim()
    const value = toTypeValue(label)
    if (!value) return
    if (types.some(t => t.value === value)) {
      message.warning(`"${label}" already exists`)
      return
    }
    run(async () => {
      await ensureSeeded()
      await addDoc(collection(db, 'resourceTypes'), {
        value,
        label,
        mode: newMode,
        createdAt: serverTimestamp()
      })
      setNewLabel('')
      setNewMode('quantity')
      message.success('Type added')
    })
  }

  const applyModeChange = (type: ResourceTypeOption, mode: BookingMode) =>
    run(async () => {
      const seeded = await ensureSeeded()
      const id = seeded.find(t => t.value === type.value)?.id
      const batch = writeBatch(db)
      if (id) batch.update(doc(db, 'resourceTypes', id), { mode })
      // A single-mode resource is exactly one unit, bookable or inventory;
      // collapse existing quantities so counts stay consistent.
      if (mode === 'single') {
        const snapshot = await getDocs(
          query(collection(db, 'resources'), where('type', '==', type.value))
        )
        snapshot.docs
          .forEach(d => {
            const available = Number(d.data().available || 0)
            batch.update(d.ref, {
              capacity: 1,
              available: available > 0 ? 1 : 0
            })
          })
      }
      await batch.commit()
      message.success('Booking mode updated')
    })

  const handleModeChange = (type: ResourceTypeOption, mode: BookingMode) => {
    const count = usage[type.value] || 0
    if (!count) {
      applyModeChange(type, mode)
      return
    }
    modal.confirm({
      title: `Switch "${type.label}" to ${
        mode === 'single' ? 'single booking' : 'quantity'
      }?`,
      content:
        mode === 'single'
          ? `${count} existing resource${
              count === 1 ? '' : 's'
            } will each be treated as one unit. Their quantities will be reset to 1.`
          : `${count} existing resource${
              count === 1 ? '' : 's'
            } will start at a quantity of 1. Edit each one to set its real quantity.`,
      okText: 'Switch',
      onOk: () => applyModeChange(type, mode)
    })
  }

  // Only the label changes; the stored value stays stable so existing
  // resources keep pointing at the same type.
  const handleRename = (type: ResourceTypeOption) => {
    const label = editingLabel.trim()
    if (!label || label === type.label) {
      setEditingValue(null)
      return
    }
    run(async () => {
      const seeded = await ensureSeeded()
      const id = seeded.find(t => t.value === type.value)?.id
      if (id) await updateDoc(doc(db, 'resourceTypes', id), { label })
      setEditingValue(null)
      message.success('Type renamed')
    })
  }

  const handleDelete = (type: ResourceTypeOption) =>
    run(async () => {
      const seeded = await ensureSeeded()
      const id = seeded.find(t => t.value === type.value)?.id
      if (id) await deleteDoc(doc(db, 'resourceTypes', id))
      message.success('Type removed')
    })

  const renderType = (type: ResourceTypeOption) => {
    const count = usage[type.value] || 0
    const inUse = count > 0
    const isEditing = editingValue === type.value

    return (
      <Card size='small' style={{ width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            {isEditing ? (
              <Input
                autoFocus
                value={editingLabel}
                onChange={e => setEditingLabel(e.target.value)}
                onPressEnter={() => handleRename(type)}
              />
            ) : (
              <>
                <Text strong>{type.label}</Text>
                <br />
                <Text type='secondary' style={{ fontSize: 12 }}>
                  {count} resource{count === 1 ? '' : 's'}
                </Text>
              </>
            )}
          </div>
          {isEditing ? (
            <Space size='small'>
              <Tooltip title='Save'>
                <Button
                  shape='circle'
                  icon={<CheckOutlined />}
                  loading={saving}
                  onClick={() => handleRename(type)}
                />
              </Tooltip>
              <Tooltip title='Cancel'>
                <Button
                  shape='circle'
                  icon={<CloseOutlined />}
                  onClick={() => setEditingValue(null)}
                />
              </Tooltip>
            </Space>
          ) : (
            <Space size='small'>
              <Tooltip title='Rename'>
                <Button
                  shape='circle'
                  icon={<EditOutlined />}
                  disabled={saving}
                  onClick={() => {
                    setEditingValue(type.value)
                    setEditingLabel(type.label)
                  }}
                />
              </Tooltip>
              <Tooltip
                title={inUse ? 'In use by existing resources' : 'Delete type'}
              >
                <Popconfirm
                  title={`Delete "${type.label}"?`}
                  onConfirm={() => handleDelete(type)}
                  disabled={inUse || saving}
                >
                  <Button
                    shape='circle'
                    danger
                    icon={<DeleteOutlined />}
                    disabled={inUse || saving}
                  />
                </Popconfirm>
              </Tooltip>
            </Space>
          )}
        </div>
        <div style={{ marginTop: 10 }}>
          <OptionCards
            indicator
            options={BOOKING_MODE_OPTIONS}
            value={getBookingMode(type)}
            disabled={saving}
            onChange={mode => {
              if (mode !== getBookingMode(type)) {
                handleModeChange(type, mode as BookingMode)
              }
            }}
          />
        </div>
      </Card>
    )
  }

  return (
    <Modal
      title='Manage Resource Types'
      width={600}
      open={open}
      onCancel={onClose}
      footer={null}
      destroyOnClose
    >
      {modalContextHolder}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 8
        }}
      >
        <Input
          placeholder='New type, e.g. Projector'
          value={newLabel}
          onChange={e => setNewLabel(e.target.value)}
          onPressEnter={handleAdd}
        />
        <Tooltip title='Add type'>
          <Button
            shape='circle'
            icon={<PlusOutlined />}
            onClick={handleAdd}
            loading={saving}
            disabled={!toTypeValue(newLabel)}
          />
        </Tooltip>
      </div>
      <div style={{ marginBottom: 16 }}>
        <OptionCards
          indicator
          options={BOOKING_MODE_OPTIONS}
          value={newMode}
          onChange={mode => setNewMode(mode as BookingMode)}
        />
      </div>
      <List
        dataSource={types}
        rowKey='value'
        split={false}
        renderItem={type => (
          <List.Item style={{ padding: '4px 0' }}>{renderType(type)}</List.Item>
        )}
      />
    </Modal>
  )
}

export default ResourceTypesModal
