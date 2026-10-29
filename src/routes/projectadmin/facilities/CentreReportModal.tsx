import React, { useState } from 'react'
import { DatePicker, Form, Modal, Space, Typography, message } from 'antd'
import dayjs from 'dayjs'
import { useFullIdentity } from '@/hooks/useFullIdentity'
import { generateCentreReport, loadCentreReportData } from './centreReport'

/** Asks for a month, then downloads the centre's Monthly Executive & Operations Report as a PowerPoint. */
const CentreReportModal: React.FC<{ open: boolean; onClose: () => void }> = ({ open, onClose }) => {
    const { user } = useFullIdentity()
    const [busy, setBusy] = useState(false)
    // Early in a month the report is usually for the month just ended.
    const [month, setMonth] = useState(() => dayjs().subtract(dayjs().date() < 10 ? 1 : 0, 'month'))

    const build = async () => {
        setBusy(true)
        try {
            const data = await loadCentreReportData(user, month)
            const fileName = await generateCentreReport(data)
            message.success(`Downloaded ${fileName}`)
            onClose()
        } catch (error: any) {
            console.error('Centre report failed', error)
            message.error(error?.message || 'Could not generate the report')
        } finally {
            setBusy(false)
        }
    }

    return (
        <Modal
            title='Monthly Executive & Operations Report'
            open={open}
            onCancel={onClose}
            onOk={build}
            okText='Generate PowerPoint'
            okButtonProps={{ disabled: !user?.assignedBranch }}
            confirmLoading={busy}
        >
            <Space direction='vertical' size={12} style={{ width: '100%' }}>
                <Typography.Text type='secondary'>
                    Builds the centre deck on the usual template: team organogram, centre management, facilities issues with photos,
                    gaps, SMMEs and locality, workshop occupancy, staff attendance heatmap, needs list and challenges. Budget and printer
                    usage are left out. The .pptx downloads to this device.
                </Typography.Text>
                {!user?.assignedBranch && (
                    <Typography.Text type='warning'>Your profile has no assigned centre, so there is no report to build.</Typography.Text>
                )}
                <Form layout='vertical'>
                    <Form.Item label='Report month' style={{ marginBottom: 0 }}>
                        <DatePicker
                            picker='month'
                            allowClear={false}
                            value={month}
                            onChange={value => value && setMonth(value)}
                            disabledDate={date => date.isAfter(dayjs(), 'month')}
                            style={{ width: '100%' }}
                        />
                    </Form.Item>
                </Form>
            </Space>
        </Modal>
    )
}

export default CentreReportModal
