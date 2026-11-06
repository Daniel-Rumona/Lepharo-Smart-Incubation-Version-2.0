import React, { useEffect, useState } from 'react'
import { Alert, Button, Col, Row, Select, Spin, Typography, message } from 'antd'
import { ApartmentOutlined, SaveOutlined } from '@ant-design/icons'
import { Helmet } from 'react-helmet'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { DashboardHeaderCard, MotionCard } from '@/components/dashboards/metrics/Header'
import { DEPARTMENT_ROLES, DepartmentRoleMap, saveDepartmentRoles, useDepartmentRoles } from '@/services/departmentRoles'

const { Text, Paragraph } = Typography

const DepartmentRolesPage: React.FC = () => {
    const { user, loading: identityLoading } = useFullIdentity()
    const { roles, departments, loading } = useDepartmentRoles()
    const [draft, setDraft] = useState<DepartmentRoleMap>({})
    const [saving, setSaving] = useState(false)
    const role = String(user?.role || '').toLowerCase().replace(/\s+/g, '')
    const canEdit = role === 'system_admin' || role === 'director'

    useEffect(() => { if (!loading) setDraft(roles) }, [loading, roles])

    const save = async () => {
        setSaving(true)
        try {
            await saveDepartmentRoles(draft, user?.name || user?.email || 'System Admin')
            message.success('Department roles saved.')
        } catch (error) { console.error(error); message.error('Could not save department roles.') }
        finally { setSaving(false) }
    }

    if (identityLoading || loading) return <div style={{ display: 'grid', placeItems: 'center', minHeight: 400 }}><Spin size='large' /></div>
    if (!canEdit) return <Alert type='error' showIcon message='Only the System Admin or a Director can manage department roles.' />

    const options = departments
        .filter(item => item.isActive !== false)
        .map(item => ({ value: item.id, label: item.name || item.id }))

    return <div style={{ padding: 24, minHeight: '100vh', background: '#f5f8fb' }}>
        <Helmet><title>Department Roles | Smart Incubation</title></Helmet>
        <DashboardHeaderCard title='Department Roles' titleIcon={<ApartmentOutlined />} subtitle='Choose which department plays each role. Dashboards, menus and permissions follow these choices, so renaming a department changes nothing but its label.' />
        <MotionCard bordered={false}>
            <Paragraph type='secondary'>Sub-departments inherit their parent department’s role unless they are given one of their own. Leave a role empty if no department fills it.</Paragraph>
            <Row gutter={[18, 18]}>
                {DEPARTMENT_ROLES.map(item => <Col xs={24} md={12} key={item.key}>
                    <Text strong>{item.label}</Text><br />
                    <Text type='secondary'>{item.description}</Text>
                    <Select allowClear showSearch optionFilterProp='label' size='large' style={{ width: '100%', marginTop: 8 }} placeholder='No department' value={draft[item.key]} options={options} onChange={value => setDraft(current => ({ ...current, [item.key]: value || undefined }))} />
                </Col>)}
            </Row>
            <Button type='primary' size='large' icon={<SaveOutlined />} loading={saving} onClick={save} style={{ marginTop: 24 }}>Save roles</Button>
        </MotionCard>
    </div>
}

export default DepartmentRolesPage
