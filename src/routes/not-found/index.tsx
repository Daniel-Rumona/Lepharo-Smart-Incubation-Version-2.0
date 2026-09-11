import React from 'react'
import { Button, Typography } from 'antd'
import { motion } from 'framer-motion'
import { HomeOutlined, ArrowLeftOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'

const { Title, Text } = Typography

export default function NotFoundPage () {
  const navigate = useNavigate()

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #0f766e 10%, #134e4a 90%)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        flexDirection: 'column',
        color: '#fff',
        position: 'relative',
        textAlign: 'center',
        padding: '0 16px'
      }}
    >
      {/* Animated icon bubble */}
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
        style={{
          width: 86,
          height: 86,
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.12)',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          marginBottom: 20
        }}
      >
        <HomeOutlined style={{ fontSize: 36, color: '#fff' }} />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <Title level={1} style={{ color: '#fff', marginBottom: 4 }}>
          404
        </Title>
        <Title level={3} style={{ color: '#e0f2f1', marginBottom: 8 }}>
          Page Not Found
        </Title>
        <Text style={{ color: 'rgba(255,255,255,0.85)' }}>
          The page you’re looking for doesn’t exist or has been moved.
        </Text>

        <div
          style={{
            marginTop: 28,
            display: 'flex',
            justifyContent: 'center',
            gap: 10
          }}
        >
          <Button
            type='primary'
            icon={<HomeOutlined />}
            onClick={() => navigate('/')}
            style={{
              background: '#10b981',
              borderColor: '#10b981',
              borderRadius: 10,
              fontWeight: 600
            }}
          >
            Go Home
          </Button>
          <Button
            ghost
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate(-1)}
            style={{
              borderRadius: 10,
              color: '#fff',
              borderColor: 'rgba(255,255,255,0.6)'
            }}
          >
            Go Back
          </Button>
        </div>
      </motion.div>

      {/* Bottom-right QuantO logo */}
      <div
        style={{
          position: 'fixed',
          bottom: 20,
          right: 20,
          height: 46,
          width: 110,
          backgroundColor: 'rgba(0,0,0,0.8)',
          borderRadius: 8,
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          padding: 6,
          boxShadow: '0 6px 18px rgba(0,0,0,0.25)'
        }}
      >
        <img
          src='/assets/images/QuantilytixO.png'
          alt='QuantO Logo'
          style={{ height: '100%', width: '100%', objectFit: 'contain' }}
        />
      </div>
    </div>
  )
}
