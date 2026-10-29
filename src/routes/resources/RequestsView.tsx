import React, { useMemo } from 'react'
import {
  Button,
  Card,
  Col,
  List,
  Result,
  Row,
  Space,
  Tag,
  Tooltip,
  Typography,
  theme
} from 'antd'
import {
  CalendarOutlined,
  CheckOutlined,
  CloseOutlined,
  InboxOutlined
} from '@ant-design/icons'
import dayjs from 'dayjs'
import { toDate } from '@/lib/resourceBookings'
import {
  REQUEST_STATUS_INFO,
  RequestStatus,
  SmeResourceRequest,
  requestReason,
  requestStatus
} from '@/lib/resourceRequests'
import { ResourceItem } from '@/types/resources'

const { Text } = Typography

export type RequestStatusFilter = RequestStatus | 'all'

// Options for the status switch. Counts are left out to keep it compact; the
// pending count is on the Requests tab badge
export const REQUEST_FILTER_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'declined', label: 'Declined' }
]

interface Props {
  requests: SmeResourceRequest[]
  resourcesById: Map<string, ResourceItem>
  loading: boolean
  isDesktop: boolean
  hasFilters: boolean
  isSingle: (resource: ResourceItem) => boolean
  getTypeIcon: (type: string) => React.ReactNode
  onView: (request: SmeResourceRequest) => void
  onApprove: (request: SmeResourceRequest) => void
  onDecline: (request: SmeResourceRequest) => void
  onClearFilters: () => void
  filter: RequestStatusFilter
}

export const requestTime = (value: unknown) => {
  if (!value) return 0
  const t = toDate(value).getTime()
  return Number.isNaN(t) ? 0 : t
}

// When the SME wants it: an exact range on current requests, or the
// needed-by date and free-text duration on older ones
export const requestWhen = (request: SmeResourceRequest) => {
  if (request.startTime && request.endTime) {
    const s = dayjs(toDate(request.startTime))
    const e = dayjs(toDate(request.endTime))
    return s.isSame(e, 'day')
      ? `${s.format('D MMM YYYY, HH:mm')} – ${e.format('HH:mm')}`
      : `${s.format('D MMM, HH:mm')} – ${e.format('D MMM YYYY, HH:mm')}`
  }
  const needed = request.neededByDate ? dayjs(toDate(request.neededByDate)) : null
  return [
    needed && needed.isValid() ? `From ${needed.format('D MMM YYYY')}` : null,
    request.duration
  ]
    .filter(Boolean)
    .join(' · ') || 'No dates given'
}

const RequestsView: React.FC<Props> = ({
  requests,
  resourcesById,
  loading,
  isDesktop,
  hasFilters,
  isSingle,
  getTypeIcon,
  onView,
  onApprove,
  onDecline,
  onClearFilters,
  filter
}) => {
  const { token } = theme.useToken()
  // The status switch lives in the page's filter bar

  // Pending oldest first (deal with the longest-waiting); the rest newest first
  const shown = useMemo(() => {
    const list = requests.filter(r => filter === 'all' || requestStatus(r) === filter)
    return list.sort((a, b) => {
      const ta = requestTime(a.requestedAt || a.createdAt)
      const tb = requestTime(b.requestedAt || b.createdAt)
      return filter === 'pending' ? ta - tb : tb - ta
    })
  }, [requests, filter])

  const renderCard = (request: SmeResourceRequest) => {
    const resource = resourcesById.get(request.resourceId)
    const status = requestStatus(request)
    const info = REQUEST_STATUS_INFO[status]
    const pending = status === 'pending'
    const reason = requestReason(request)
    const quantity =
      resource && !isSingle(resource) && request.quantity ? ` · ×${request.quantity}` : ''

    return (
      <Card
        size='small'
        hoverable
        style={{ width: '100%', borderRadius: 12 }}
        onClick={() => onView(request)}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              display: 'grid',
              placeItems: 'center',
              fontSize: 16,
              flexShrink: 0,
              background: token.colorPrimaryBg,
              color: token.colorPrimary
            }}
          >
            {resource ? getTypeIcon(resource.type) : <InboxOutlined />}
          </div>
          {/* Two lines: what and who, then when and why */}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
              <Text strong ellipsis style={{ minWidth: 0 }}>
                {resource?.name || request.resourceName || 'Deleted resource'}
              </Text>
              <Tag color={info.color} style={{ marginInlineEnd: 0, flexShrink: 0 }}>
                {info.label}
              </Tag>
              {request.urgency === 'High' && pending && (
                <Tag color='volcano' style={{ marginInlineEnd: 0, flexShrink: 0 }}>
                  Urgent
                </Tag>
              )}
              <Text type='secondary' ellipsis style={{ fontSize: 12, minWidth: 0 }}>
                {request.requestedBy || request.requestedByEmail || 'SME'}
                {quantity}
              </Text>
            </div>
            <Text
              type='secondary'
              style={{ fontSize: 12, display: 'block' }}
              ellipsis={{ tooltip: reason || undefined }}
            >
              <CalendarOutlined style={{ marginRight: 6 }} />
              {requestWhen(request)}
              {reason && ` · ${reason}`}
            </Text>
          </div>
          {pending && isDesktop && (
            <Space
              size='small'
              style={{ flexShrink: 0 }}
              onClick={e => e.stopPropagation()}
            >
              <Tooltip title='Approve and book'>
                <Button
                  shape='circle'
                  icon={<CheckOutlined />}
                  style={{ color: token.colorSuccess, borderColor: token.colorSuccess }}
                  onClick={() => onApprove(request)}
                />
              </Tooltip>
              <Tooltip title='Decline'>
                <Button
                  shape='circle'
                  danger
                  icon={<CloseOutlined />}
                  onClick={() => onDecline(request)}
                />
              </Tooltip>
            </Space>
          )}
        </div>
        {pending && !isDesktop && (
          <Row gutter={8} style={{ marginTop: 12 }} onClick={e => e.stopPropagation()}>
            <Col span={12}>
              <Button block icon={<CheckOutlined />} onClick={() => onApprove(request)}>
                Approve
              </Button>
            </Col>
            <Col span={12}>
              <Button block danger icon={<CloseOutlined />} onClick={() => onDecline(request)}>
                Decline
              </Button>
            </Col>
          </Row>
        )}
      </Card>
    )
  }

  return (
    <div>
      <List
        dataSource={shown}
        rowKey='id'
        loading={loading}
        split={false}
        pagination={{ pageSize: 10, hideOnSinglePage: true }}
        locale={{
          emptyText: hasFilters ? (
            <Result
              icon={<InboxOutlined />}
              title='No requests found'
              subTitle='Nothing matches your search or filters.'
              extra={<Button onClick={onClearFilters}>Clear filters</Button>}
            />
          ) : (
            <Result
              icon={<InboxOutlined />}
              title={filter === 'pending' ? 'No pending requests' : 'No requests here'}
              subTitle={
                filter === 'pending'
                  ? "You're all caught up. New SME requests will appear here."
                  : 'Requests from SMEs will show here once they are made.'
              }
            />
          )
        }}
        renderItem={request => (
          <List.Item style={{ padding: '6px 0' }}>{renderCard(request)}</List.Item>
        )}
      />
    </div>
  )
}

export default RequestsView
