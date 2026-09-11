import React, { useEffect, useMemo, useState } from 'react'
import { Modal, Button, Typography, Space, Divider, Tag, message } from 'antd'
import {
  GoogleOutlined,
  WindowsOutlined,
  VideoCameraOutlined
} from '@ant-design/icons'
import { getAuth } from 'firebase/auth'
import { doc, getDoc, collection, getDocs } from 'firebase/firestore'
import { db } from '@/firebase'

const { Text, Title } = Typography

type Props = {
  open: boolean
  onClose: () => void
}

const OAUTH_BASE = 'https://us-central1-<project-id>.cloudfunctions.net/api' // same as functions config

export const ConnectAccountsModal: React.FC<Props> = ({ open, onClose }) => {
  const auth = getAuth()
  const user = auth.currentUser
  const [connecting, setConnecting] = useState<string | null>(null)
  const [connections, setConnections] = useState<{
    google?: boolean
    microsoft?: boolean
    zoom?: boolean
  }>({})

  const redirectAfter = useMemo(
    () => window.location.origin + window.location.pathname,
    []
  )

  const loadConnections = async () => {
    if (!user) return
    const connsSnap = await getDocs(
      collection(db, 'users', user.uid, 'connections')
    )
    const found: any = {}
    connsSnap.forEach(d => (found[d.id] = true))
    setConnections({
      google: !!found.google,
      microsoft: !!found.microsoft,
      zoom: !!found.zoom
    })
  }

  useEffect(() => {
    if (open) loadConnections()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const withIdToken = async () => {
    const idToken = await user?.getIdToken()
    if (!idToken) throw new Error('No idToken')
    return idToken
  }

  const startGoogle = async () => {
    try {
      setConnecting('google')
      const idToken = await withIdToken()
      const url =
        `${OAUTH_BASE}/auth/google` +
        `?idToken=${encodeURIComponent(idToken)}` +
        `&redirect=${encodeURIComponent(redirectAfter)}`
      window.open(url, '_blank', 'noopener,noreferrer')
      message.info(
        'Complete the Google consent in the opened tab, then come back.'
      )
    } finally {
      setConnecting(null)
    }
  }

  // Stubs if you add Microsoft/Zoom later:
  const startMicrosoft = async () => {
    message.info(
      'Microsoft OAuth not wired yet. Follow the same pattern as Google.'
    )
    // const idToken = await withIdToken();
    // window.open(`${OAUTH_BASE}/auth/microsoft?idToken=${encodeURIComponent(idToken)}&redirect=${encodeURIComponent(redirectAfter)}`, "_blank");
  }
  const startZoom = async () => {
    message.info('Zoom OAuth not wired yet. Follow the same pattern as Google.')
  }

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={560}
      destroyOnClose
      title={
        <Title level={4} style={{ margin: 0 }}>
          Connect your calendar/meeting apps
        </Title>
      }
    >
      <Text type='secondary'>
        Link your accounts so we can check your availability and automatically
        add Meet/Teams/Zoom links to events.
      </Text>

      <Divider />

      <Space direction='vertical' style={{ width: '100%' }} size='large'>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <Space>
            <GoogleOutlined />
            <Text>Google Calendar + Google Meet</Text>
          </Space>
          <Space>
            {connections.google ? (
              <Tag color='green'>Connected</Tag>
            ) : (
              <Tag>Not connected</Tag>
            )}
            <Button
              type='primary'
              loading={connecting === 'google'}
              onClick={startGoogle}
            >
              {connections.google ? 'Reconnect' : 'Connect'}
            </Button>
          </Space>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <Space>
            <WindowsOutlined />
            <Text>Microsoft 365 (Outlook Calendar + Teams)</Text>
          </Space>
          <Space>
            {connections.microsoft ? (
              <Tag color='green'>Connected</Tag>
            ) : (
              <Tag>Not connected</Tag>
            )}
            <Button onClick={startMicrosoft}>
              {connections.microsoft ? 'Reconnect' : 'Connect'}
            </Button>
          </Space>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <Space>
            <VideoCameraOutlined />
            <Text>Zoom</Text>
          </Space>
          <Space>
            {connections.zoom ? (
              <Tag color='green'>Connected</Tag>
            ) : (
              <Tag>Not connected</Tag>
            )}
            <Button onClick={startZoom}>
              {connections.zoom ? 'Reconnect' : 'Connect'}
            </Button>
          </Space>
        </div>
      </Space>
    </Modal>
  )
}
