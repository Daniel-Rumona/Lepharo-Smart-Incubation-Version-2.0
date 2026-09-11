import React, { useMemo, useState } from 'react'
import { Avatar, Button, Input, List, Modal, Space, Tag, Typography, message } from 'antd'
import { EyeOutlined, SearchOutlined, StopOutlined } from '@ant-design/icons'
import { collection, getDocs } from 'firebase/firestore'
import { useNavigate } from 'react-router-dom'
import { db } from '@/firebase'
import { AppIdentity, useIdentity } from '@/contexts/IdentityContext'

const { Text } = Typography
const roleHome = (role: string) => {
    const normalized = String(role || '').toLowerCase().replace(/\s+/g, '_')
    const homes: Record<string, string> = {
        admin: '/admin', system_admin: '/admin', coordinator: '/coordinator', operations: '/operations',
        director: '/director', projectadmin: '/projectadmin', funder: '/funder', incubatee: '/incubatee',
        receptionist: '/receptionist', employee: '/auxiliary', auxiliary: '/auxiliary',
        projectmanager: '/projectmanager', consultant: '/coordinator'
    }
    return homes[normalized] || '/tutorials'
}

export const ViewAsControls: React.FC<{ compact?: boolean }> = ({ compact }) => {
    const { actor, canViewAs, isViewingAs, startViewingAs, stopViewingAs } = useIdentity()
    const navigate = useNavigate()
    const [open, setOpen] = useState(false)
    const [loading, setLoading] = useState(false)
    const [users, setUsers] = useState<AppIdentity[]>([])
    const [search, setSearch] = useState('')
    const [messageApi, contextHolder] = message.useMessage()

    const loadUsers = async () => {
        setOpen(true)
        if (users.length) return
        setLoading(true)
        try {
            const snapshot = await getDocs(collection(db, 'users'))
            const rows = snapshot.docs.map(userDoc => {
                const data = userDoc.data()
                const authUid = String(data.authUid || data.uid || data.employeeId || userDoc.id)
                return { ...data, id: userDoc.id, uid: authUid, email: String(data.email || ''),
                    name: String(data.name || data.fullName || data.email || 'Unknown User'),
                    role: String(data.role || 'guest').trim().toLowerCase().replace(/\s+/g, '_') } as AppIdentity
            }).filter(user => user.id !== actor?.id)
            rows.sort((a, b) => a.name.localeCompare(b.name))
            setUsers(rows)
        } catch (error) {
            console.error('Failed to load users for read-only preview:', error)
            messageApi.error('Could not load the user list.')
        } finally { setLoading(false) }
    }

    const filteredUsers = useMemo(() => {
        const needle = search.trim().toLowerCase()
        if (!needle) return users
        return users.filter(user => [user.name, user.email, user.role].some(value => String(value || '').toLowerCase().includes(needle)))
    }, [search, users])

    if (!canViewAs) return null
    const exit = () => { stopViewingAs(); navigate('/admin') }
    return (
        <div data-view-as-control='true'>
            {contextHolder}
            <Space size={6}>
                <Button type={isViewingAs ? 'primary' : 'default'} danger={isViewingAs}
                    icon={isViewingAs ? <StopOutlined /> : <EyeOutlined />}
                    onClick={isViewingAs ? exit : loadUsers}
                    title={isViewingAs ? 'Exit read-only view' : 'View as another user'}>
                    {!compact && (isViewingAs ? 'Exit view' : 'View as')}
                </Button>
                {isViewingAs && !compact && <Button onClick={loadUsers}>Switch user</Button>}
            </Space>
            <Modal title='View as another user' open={open} onCancel={() => setOpen(false)} footer={null} width={680}>
                <Text type='secondary'>This is a read-only preview. Your login and the selected user’s Firestore record are not changed.</Text>
                <Input autoFocus allowClear prefix={<SearchOutlined />} placeholder='Search by name, email, or role'
                    value={search} onChange={event => setSearch(event.target.value)} style={{ margin: '16px 0 8px' }} />
                <List loading={loading} dataSource={filteredUsers} pagination={{ pageSize: 8, hideOnSinglePage: true }}
                    locale={{ emptyText: 'No matching users' }} renderItem={user => (
                        <List.Item actions={[<Button key='view' type='link' onClick={() => {
                            console.info('[ViewAs] Starting preview identity', {
                                profileDocumentId: user.id,
                                authUid: user.uid,
                                email: user.email,
                                name: user.name
                            })
                            startViewingAs(user); setOpen(false); navigate(roleHome(user.role))
                        }}>View</Button>]}>
                            <List.Item.Meta avatar={<Avatar>{user.name.slice(0, 1).toUpperCase()}</Avatar>}
                                title={<Space wrap><Text strong>{user.name}</Text><Tag>{user.role}</Tag></Space>}
                                description={user.email || user.id} />
                        </List.Item>
                    )} />
            </Modal>
        </div>
    )
}

export const ViewAsBanner: React.FC = () => {
    const { isViewingAs, viewedUser, stopViewingAs } = useIdentity()
    const navigate = useNavigate()
    if (!isViewingAs || !viewedUser) return null
    return (
        <div data-view-as-control='true' style={{ background: '#fff1f0', border: '1px solid #ffccc7', color: '#820014',
            padding: '8px 16px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, flexWrap: 'wrap' }}>
            <EyeOutlined /><Text strong>READ-ONLY VIEW:</Text><Text>{viewedUser.name} ({viewedUser.role})</Text>
            <Button size='small' danger onClick={() => { stopViewingAs(); navigate('/admin') }}>Exit view</Button>
        </div>
    )
}
