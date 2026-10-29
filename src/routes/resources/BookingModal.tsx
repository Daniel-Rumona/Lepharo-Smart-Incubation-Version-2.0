import React, { useEffect, useMemo, useState } from 'react'
import {
  Modal,
  Form,
  Select,
  Input,
  InputNumber,
  DatePicker,
  Button,
  Alert,
  Typography,
  message,
  Result
} from 'antd'
import { AppstoreOutlined, PlusOutlined } from '@ant-design/icons'
import dayjs, { Dayjs } from 'dayjs'
import { collection, getDocs, query, where } from 'firebase/firestore'
import { db } from '@/firebase'
import { useActiveProgramId } from '@/lib/useActiveProgramId'
import {
  EDITABLE_BOOKING_STATUSES,
  BookableUnit,
  ResourceBooking,
  availableForRange,
  bookedByName,
  saveBooking,
  toDate
} from '@/lib/resourceBookings'
import { ResourceItem } from '@/types/resources'
import OptionCards from './OptionCards'

const { Text } = Typography
const { RangePicker } = DatePicker

interface SmeOption {
  applicationId: string
  participantId?: string
  name: string
  email?: string
  label: string
}

interface Props {
  open: boolean
  onClose: () => void
  // Bookable (external) resources only
  resources: ResourceItem[]
  toUnit: (resource: ResourceItem) => BookableUnit
  bookings: ResourceBooking[]
  editing?: ResourceBooking | null
  // Values for a new booking: from an empty timeline day, a resource, or an
  // SME request being approved
  prefill?: BookingPrefill
  onSaved: (bookingId: string) => void
  // Shown when there's nothing bookable yet
  onAddResource: () => void
}

export interface BookingPrefill {
  resourceId?: string
  range?: [Date, Date]
  applicationId?: string
  participantId?: string | null
  quantity?: number
  purpose?: string
  // Shown and saved if the SME isn't in the loaded list (e.g. another programme)
  smeName?: string
  smeEmail?: string
  // Approving an SME request: changes the title and button wording
  fromRequest?: boolean
}

const str = (v: unknown) => String(v ?? '').trim()

const BookingModal: React.FC<Props> = ({
  open,
  onClose,
  resources,
  toUnit,
  bookings,
  editing,
  prefill,
  onAddResource,
  onSaved
}) => {
  const [form] = Form.useForm()
  const [saving, setSaving] = useState(false)
  const [smes, setSmes] = useState<SmeOption[]>([])
  const [smesLoading, setSmesLoading] = useState(false)
  const { activeProgramId } = useActiveProgramId()

  const resourceId: string | undefined = Form.useWatch('resourceId', form)
  const range: [Dayjs, Dayjs] | undefined = Form.useWatch('timeRange', form)
  const status: string | undefined = Form.useWatch('status', form)

  // SMEs come from accepted applications, scoped to the active programme
  // when one is selected
  useEffect(() => {
    if (!open) return
    let cancelled = false
    const load = async () => {
      setSmesLoading(true)
      try {
        const constraints = [where('applicationStatus', '==', 'accepted')]
        if (activeProgramId) {
          constraints.push(where('programId', '==', activeProgramId))
        }
        const snap = await getDocs(query(collection(db, 'applications'), ...constraints))
        const list = snap.docs.map(d => {
          const a = d.data()
          const name = str(a.businessName || a.beneficiaryName) || 'SME'
          const owner = str(a.ownerName)
          const email = str(a.email)
          return {
            applicationId: d.id,
            participantId: str(a.participantId) || undefined,
            name,
            email: email || undefined,
            label: [name, owner && `(${owner})`].filter(Boolean).join(' ')
          }
        })
        list.sort((x, y) => x.label.localeCompare(y.label))
        if (!cancelled) setSmes(list)
      } catch (error) {
        console.error('Failed to load SMEs:', error)
        message.error('Failed to load SMEs')
      } finally {
        if (!cancelled) setSmesLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [open, activeProgramId])

  useEffect(() => {
    if (!open) return
    form.resetFields()
    if (editing) {
      form.setFieldsValue({
        resourceId: editing.resourceId,
        allocatedToApplicationId: editing.allocatedToApplicationId,
        purpose: editing.purpose,
        quantity: editing.quantity,
        // 'active' predates date-derived phases and means the same as booked
        status: editing.status === 'active' ? 'scheduled' : editing.status,
        timeRange: [dayjs(toDate(editing.startTime)), dayjs(toDate(editing.endTime))]
      })
    } else {
      form.setFieldsValue({
        resourceId: prefill?.resourceId,
        allocatedToApplicationId: prefill?.applicationId,
        timeRange: prefill?.range && [dayjs(prefill.range[0]), dayjs(prefill.range[1])],
        quantity: prefill?.quantity || 1,
        purpose: prefill?.purpose
      })
    }
  }, [open, editing, prefill, form])

  // Older SME requests only know the participant, so match them to their
  // accepted application once the SME list has loaded
  useEffect(() => {
    if (!open || editing || prefill?.applicationId || !prefill?.participantId) return
    const match = smes.find(s => s.participantId === prefill.participantId)
    if (match && !form.getFieldValue('allocatedToApplicationId')) {
      form.setFieldsValue({ allocatedToApplicationId: match.applicationId })
    }
  }, [open, editing, prefill, smes, form])

  const selectedResource = resources.find(r => r.id === resourceId)
  const selectedUnit = selectedResource ? toUnit(selectedResource) : undefined

  const freeForRange = useMemo(() => {
    if (!selectedUnit || !range?.[0] || !range?.[1]) return undefined
    return availableForRange(
      selectedUnit,
      bookings,
      range[0].toDate(),
      range[1].toDate(),
      editing?.id
    )
  }, [selectedUnit, range, bookings, editing?.id])

  // Keep a booking that points at a now-unbookable resource editable
  const resourceOptions = resources
    .filter(
      r =>
        (r.status !== 'maintenance' && r.status !== 'unavailable') ||
        r.id === editing?.resourceId
    )
    .map(r => ({ value: r.id, label: r.name }))

  // Legacy bookings stored a free-text name with no application link
  const smeOptions = useMemo(() => {
    const options = smes.map(s => ({ value: s.applicationId, label: s.label }))
    if (
      editing?.allocatedToApplicationId &&
      !smes.some(s => s.applicationId === editing.allocatedToApplicationId)
    ) {
      options.unshift({
        value: editing.allocatedToApplicationId,
        label: bookedByName(editing)
      })
    }
    if (
      prefill?.applicationId &&
      !editing &&
      !options.some(o => o.value === prefill.applicationId)
    ) {
      options.unshift({ value: prefill.applicationId, label: prefill.smeName || 'SME' })
    }
    return options
  }, [smes, editing, prefill])

  const handleSubmit = async () => {
    let values: Record<string, any>
    try {
      values = await form.validateFields()
    } catch {
      return
    }
    if (!selectedResource || !selectedUnit) return

    const sme = smes.find(s => s.applicationId === values.allocatedToApplicationId)
    const [start, end] = values.timeRange as [Dayjs, Dayjs]

    setSaving(true)
    try {
      const bookingId = await saveBooking(
        selectedUnit,
        {
          resourceId: selectedResource.id,
          allocatedToApplicationId: values.allocatedToApplicationId,
          allocatedToName:
            sme?.name || (editing ? bookedByName(editing) : prefill?.smeName || 'SME'),
          allocatedToEmail: sme?.email ?? editing?.allocatedToEmail ?? prefill?.smeEmail,
          participantId:
            sme?.participantId ?? editing?.participantId ?? prefill?.participantId ?? undefined,
          purpose: str(values.purpose),
          quantity: selectedUnit.single ? 1 : Number(values.quantity),
          // New bookings are always booked; only edits can complete or cancel
          status: editing ? values.status : 'scheduled',
          startTime: start.toDate(),
          endTime: end.toDate()
        },
        editing?.id
      )
      message.success(editing ? 'Booking updated' : 'Booking created')
      onSaved(bookingId)
      onClose()
    } catch (error: any) {
      console.error('Failed to save booking:', error)
      message.error(error?.message || 'Failed to save booking')
    } finally {
      setSaving(false)
    }
  }

  const holds = !editing || status === 'scheduled'
  const noResources = resourceOptions.length === 0

  return (
    <Modal
      title={editing ? 'Edit Booking' : prefill?.fromRequest ? 'Approve Request' : 'New Booking'}
      open={open}
      onCancel={onClose}
      destroyOnClose
      footer={
        noResources ? null : (
          <Button type='primary' block loading={saving} onClick={handleSubmit}>
            {editing
              ? 'Update Booking'
              : prefill?.fromRequest
                ? 'Approve & Book'
                : 'Save Booking'}
          </Button>
        )
      }
    >
      {noResources ? (
        <Result
          icon={<AppstoreOutlined />}
          title={resources.length ? 'Nothing to book right now' : 'Add resources first'}
          subTitle={
            resources.length
              ? 'Every external resource is under maintenance or unavailable.'
              : 'Bookings are made against external resources. Add one before creating a booking.'
          }
          extra={
            <Button
              type='primary'
              icon={<PlusOutlined />}
              onClick={() => {
                onClose()
                onAddResource()
              }}
            >
              Add Resource
            </Button>
          }
        />
      ) : (
      <Form form={form} layout='vertical'>
        <Form.Item name='resourceId' label='Resource' rules={[{ required: true }]}>
          <Select
            showSearch
            optionFilterProp='label'
            placeholder='Select a resource'
            options={resourceOptions}
          />
        </Form.Item>
        <Form.Item
          name='allocatedToApplicationId'
          label='SME'
          rules={[{ required: true, message: 'Select the SME this is for' }]}
        >
          <Select
            showSearch
            optionFilterProp='label'
            loading={smesLoading}
            placeholder='Select an SME'
            options={smeOptions}
          />
        </Form.Item>
        <Form.Item name='timeRange' label='When' rules={[{ required: true }]}>
          <RangePicker
            showTime={{ format: 'HH:mm' }}
            format='YYYY-MM-DD HH:mm'
            style={{ width: '100%' }}
          />
        </Form.Item>
        {selectedUnit && !selectedUnit.single && (
          <Form.Item
            name='quantity'
            label='Quantity'
            rules={[{ required: true }]}
            extra={
              freeForRange !== undefined && (
                <Text type={freeForRange > 0 ? 'secondary' : 'danger'}>
                  {freeForRange} of {selectedUnit.capacity} free for these dates
                </Text>
              )
            }
          >
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
        )}
        {selectedUnit?.single && holds && freeForRange === 0 && (
          <Alert
            type='warning'
            showIcon
            style={{ marginBottom: 16 }}
            message={`${selectedUnit.name} is already booked during these dates`}
          />
        )}
        <Form.Item name='purpose' label='Purpose' rules={[{ required: true }]}>
          <Input.TextArea rows={2} />
        </Form.Item>
        {editing && (
          <Form.Item
            name='status'
            label='Status'
            rules={[{ required: true }]}
            extra='Completed frees the resource early, e.g. when it comes back before the booked end time.'
          >
            <OptionCards options={EDITABLE_BOOKING_STATUSES} />
          </Form.Item>
        )}
      </Form>
      )}
    </Modal>
  )
}

export default BookingModal
