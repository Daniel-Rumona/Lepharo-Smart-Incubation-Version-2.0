import {
  ArrowRightOutlined,
  CompassOutlined,
  PlayCircleOutlined,
  QuestionCircleOutlined
} from '@ant-design/icons'
import {
  Button,
  Divider,
  Flex,
  Modal,
  Tag,
  Typography
} from 'antd'

import type { AppGuide, GuideKind } from './guideTypes'

const { Text, Title } = Typography

type GuideModalProps = {
  open: boolean
  pageTitle?: string
  guides: AppGuide[]
  onClose: () => void
  onStart: (guideId: string) => void
}

const kindMeta: Record<
  GuideKind,
  {
    label: string
    color: string
    icon: React.ReactNode
  }
> = {
  page: {
    label: 'Page tour',
    color: 'blue',
    icon: <CompassOutlined />
  },
  task: {
    label: 'Task guide',
    color: 'green',
    icon: <PlayCircleOutlined />
  },
  process: {
    label: 'Process guide',
    color: 'purple',
    icon: <QuestionCircleOutlined />
  }
}

export const GuideModal = ({
  open,
  pageTitle,
  guides,
  onClose,
  onStart
}: GuideModalProps) => {
  return (
    <Modal
      open={open}
      rootClassName="guide-selection-modal"
      onCancel={onClose}
      footer={null}
      centered
      width={580}
      destroyOnHidden
      mask={{ closable: true, blur: true }}
      title={
        <Flex align="center" gap={8}>
          <QuestionCircleOutlined />
          <span>Guide Me</span>
        </Flex>
      }
    >
      <div style={{ paddingTop: 4 }}>
        <Title level={5} style={{ marginBottom: 4 }}>
          {pageTitle || 'Current page'}
        </Title>

        <Text type="secondary">
          Choose what you would like help with.
        </Text>

        <Divider style={{ margin: '16px 0 10px' }} />

        <Flex vertical gap={10}>
          {guides.map(guide => {
            const kind = guide.kind || 'page'
            const meta = kindMeta[kind]

            return (
              <Button
                key={guide.id}
                className="guide-selection-card"
                block
                type="text"
                disabled={guide.disabled}
                onClick={() => onStart(guide.id)}
                style={{
                  height: 'auto',
                  minHeight: 76,
                  padding: '12px 14px',
                  border: '1px solid #f0f0f0',
                  borderRadius: 12,
                  textAlign: 'left'
                }}
              >
                <Flex
                  align="center"
                  justify="space-between"
                  gap={14}
                  style={{ width: '100%' }}
                >
                  <Flex vertical gap={4} style={{ minWidth: 0 }}>
                    <Flex align="center" gap={8} wrap>
                      <Text strong>{guide.title}</Text>

                      <Tag
                        color={meta.color}
                        icon={meta.icon}
                        style={{ marginInlineEnd: 0 }}
                      >
                        {meta.label}
                      </Tag>
                    </Flex>

                    {guide.description ? (
                      <Text
                        type="secondary"
                        style={{
                          whiteSpace: 'normal',
                          lineHeight: 1.45
                        }}
                      >
                        {guide.disabled && guide.disabledReason
                          ? guide.disabledReason
                          : guide.description}
                      </Text>
                    ) : null}
                  </Flex>

                  <ArrowRightOutlined
                    className="guide-selection-arrow"
                    style={{
                      flex: '0 0 auto',
                      color: 'rgba(0,0,0,.45)'
                    }}
                  />
                </Flex>
              </Button>
            )
          })}
        </Flex>
      </div>
    </Modal>
  )
}
