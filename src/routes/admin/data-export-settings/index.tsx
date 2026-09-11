import React, { useEffect, useState } from 'react'
import { Alert, Button, Checkbox, Col, Collapse, Row, Select, Spin, Typography, message } from 'antd'
import { SaveOutlined, SafetyCertificateOutlined } from '@ant-design/icons'
import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { DATASETS } from '@/routes/data-export'
import { Helmet } from 'react-helmet'
import { DashboardHeaderCard, MotionCard } from '@/components/dashboards/metrics/Header'

const { Text, Paragraph } = Typography
type Department = { id: string; name: string; isActive?: boolean }

const DataExportSettingsPage: React.FC = () => {
    const { user, loading: identityLoading } = useFullIdentity()
    const [departments, setDepartments] = useState<Department[]>([])
    const [departmentId, setDepartmentId] = useState<string>()
    const [allowed, setAllowed] = useState<string[]>([])
    const [loading, setLoading] = useState(true)
    const [saving, setSaving] = useState(false)
    const isAdmin = String(user?.role || '').toLowerCase().replace(/\s+/g, '') === 'admin'

    useEffect(() => {
        if (identityLoading) return
        if (!isAdmin) { setLoading(false); return }
        getDocs(collection(db, 'departments')).then(snapshot => {
            const rows = snapshot.docs.map(item => ({ id: item.id, ...(item.data() as any) }))
                .filter(item => item.isActive !== false).sort((a, b) => a.name.localeCompare(b.name))
            setDepartments(rows)
            if (rows[0]) selectDepartment(rows[0].id)
            else setLoading(false)
        }).catch(error => { console.error(error); message.error('Could not load departments.'); setLoading(false) })
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [identityLoading, isAdmin])

    const selectDepartment = async (value: string) => {
        setDepartmentId(value)
        setLoading(true)
        try {
            const snapshot = await getDoc(doc(db, 'dataExportSettings', value))
            setAllowed(snapshot.exists() && Array.isArray(snapshot.data().allowedDatasets) ? snapshot.data().allowedDatasets : [])
        } catch (error) { console.error(error); message.error('Could not load this department’s permissions.') }
        finally { setLoading(false) }
    }

    const save = async () => {
        if (!departmentId) return
        setSaving(true)
        try {
            const department = departments.find(item => item.id === departmentId)
            await setDoc(doc(db, 'dataExportSettings', departmentId), {
                departmentName: department?.name || '',
                allowedDatasets: allowed,
                updatedAt: serverTimestamp(),
                updatedByName: user?.name || user?.email || 'System Admin'
            }, { merge: true })
            message.success(`Export access saved for ${department?.name}.`)
        } catch (error) { console.error(error); message.error('Could not save export access.') }
        finally { setSaving(false) }
    }

    if (identityLoading || loading) return <div style={{ display: 'grid', placeItems: 'center', minHeight: 400 }}><Spin size='large' /></div>
    if (!isAdmin) return <Alert type='error' showIcon message='Only the System Admin can manage Data Export permissions.' />

    const groups = Array.from(new Set(DATASETS.map(item => item.group)))
    return <div style={{ padding: 24, minHeight: '100vh', background: '#f5f8fb' }}>
        <Helmet><title>Data Export Permissions | Smart Incubation</title></Helmet>
        <DashboardHeaderCard title='Data Export Permissions' titleIcon={<SafetyCertificateOutlined />} subtitle='Control which datasets each department may preview and export.' />
        <Row gutter={[18, 18]}>
            <Col xs={24} lg={8}><MotionCard title='Department' bordered={false}><Paragraph type='secondary'>Choose a department, then assign only the data it needs.</Paragraph><Select showSearch optionFilterProp='label' size='large' style={{ width: '100%' }} value={departmentId} onChange={selectDepartment} options={departments.map(item => ({ value: item.id, label: item.name }))} /><Button style={{ marginTop: 16 }} onClick={() => setAllowed(DATASETS.map(item => item.key))}>Select all</Button><Button style={{ marginTop: 16, marginLeft: 8 }} onClick={() => setAllowed([])}>Clear all</Button></MotionCard></Col>
            <Col xs={24} lg={16}><MotionCard title='Allowed datasets' bordered={false}><Collapse defaultActiveKey={groups} items={groups.map(group => ({ key: group, label: group, children: <Row gutter={[12, 12]}>{DATASETS.filter(item => item.group === group).map(item => <Col xs={24} md={12} key={item.key}><Checkbox checked={allowed.includes(item.key)} onChange={event => setAllowed(current => event.target.checked ? [...new Set([...current, item.key])] : current.filter(key => key !== item.key))}><Text strong>{item.label}</Text><br /><Text type='secondary'>{item.description}</Text></Checkbox></Col>)}</Row> }))} /><Button type='primary' size='large' icon={<SaveOutlined />} loading={saving} onClick={save} style={{ marginTop: 20 }}>Save permissions</Button></MotionCard></Col>
        </Row>
    </div>
}

export default DataExportSettingsPage
