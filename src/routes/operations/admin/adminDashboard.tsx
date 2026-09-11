import React, { useEffect, useState } from 'react'
import { Card, Row, Col, Statistic, Typography, Divider } from 'antd'
import {
  UserOutlined,
  SmileOutlined,
  FrownOutlined,
  TeamOutlined
} from '@ant-design/icons'
import { UserManagement } from '@/components/user-management'
import { collection, onSnapshot } from 'firebase/firestore'
import { db } from '@/firebase'
import { motion } from 'framer-motion'

const { Title } = Typography

export const AdminDashboard: React.FC = () => {
  const [activeTab, setActiveTab] = useState('users')
  const [userCount, setUserCount] = useState<number>(0)
  const [activeCount, setActiveCount] = useState<number>(0)
  const [inactiveCount, setInactiveCount] = useState<number>(0)
  const [roleBreakdown, setRoleBreakdown] = useState<{ [key: string]: number }>(
    {}
  )

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'users'), snapshot => {
      const users = snapshot.docs.map(doc => doc.data())
      setUserCount(users.length)

      const active = users.filter((u: any) => u.status === 'Active').length
      const inactive = users.length - active
      setActiveCount(active)
      setInactiveCount(inactive)

      const roles: { [key: string]: number } = {}
      users.forEach((u: any) => {
        const roleKey =
          u.role === 'projectadmin'
            ? 'Center Coordinator'
            : u.role.charAt(0).toUpperCase() + u.role.slice(1)
        roles[roleKey] = (roles[roleKey] || 0) + 1
      })
      setRoleBreakdown(roles)
    })

    return () => unsubscribe()
  }, [])

  return (
    <div style={{ padding: '20px', minHeight: '100vh' }}>
      {/* Stats Overview */}
      <Row gutter={[16, 16]} style={{ marginBottom: '24px' }}>
        <Col xs={24} sm={12} md={8}>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <Card
              style={{
                boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
                transition: 'all 0.3s ease',
                borderRadius: 12,
                border: '1px solid #d6e4ff'
              }}
            >
              <Statistic
                title='Total Users'
                value={userCount}
                prefix={<UserOutlined />}
              />
            </Card>
          </motion.div>
        </Col>
        <Col xs={24} sm={12} md={8}>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <Card
              style={{
                boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
                transition: 'all 0.3s ease',
                borderRadius: 12,
                border: '1px solid #d6e4ff'
              }}
            >
              <Statistic
                title='Active Users'
                value={activeCount}
                prefix={<SmileOutlined />}
              />
            </Card>
          </motion.div>
        </Col>
        <Col xs={24} sm={12} md={8}>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <Card
              style={{
                boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
                transition: 'all 0.3s ease',
                borderRadius: 12,
                border: '1px solid #d6e4ff'
              }}
            >
              <Statistic
                title='Inactive Users'
                value={inactiveCount}
                prefix={<FrownOutlined />}
              />
            </Card>
          </motion.div>
        </Col>
      </Row>

      {/* Main Tabs */}
      <Card
        style={{
          boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
          transition: 'all 0.3s ease',
          borderRadius: 12,
          border: '1px solid #d6e4ff'
        }}
      >
        <UserManagement />
      </Card>
    </div>
  )
}
