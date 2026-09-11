// PayrollPage.tsx
import React, { useEffect, useMemo, useState } from 'react'
import {
    Card,
    Row,
    Col,
    Table,
    Typography,
    Button,
    Space,
    InputNumber,
    Select,
    Tag,
    Modal,
    Divider,
    Form,
    message,
    Tooltip
} from 'antd'
import {
    FileTextOutlined,
    DollarCircleOutlined,
    PrinterOutlined,
    SaveOutlined,
    CheckCircleOutlined,
    CloudDownloadOutlined,
    ReloadOutlined
} from '@ant-design/icons'
import { motion } from 'framer-motion'
import dayjs from 'dayjs'
import {
    collection,
    doc,
    getDocs,
    query,
    setDoc,
    where,
    getDoc
} from 'firebase/firestore'
import { db } from '@/firebase'
import { useFullIdentity } from '@/hooks/src/useFullIdentity'

const { Title, Text } = Typography
const { Option } = Select

/** ---------- Unified card style + motion wrapper ---------- */
const cardStyle: React.CSSProperties = {
    boxShadow: '0 12px 32px rgba(0,0,0,0.12)',
    transition: 'all 0.3s ease',
    borderRadius: 8,
    border: '1px solid #d6e4ff'
}

const MotionCard: React.FC<React.ComponentProps<typeof Card>> = ({
    children,
    style,
    ...rest
}) => (
    <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
    >
        <Card {...rest} style={{ ...cardStyle, ...(style || {}) }}>
            {children}
        </Card>
    </motion.div>
)

/** ---------- Types ---------- */
type Employee = {
    id: string
    name: string
    email: string
    role: string
    department?: string
    baseSalary?: number
}

type PayslipRow = {
    employeeId: string
    name: string
    email: string
    base: number
    overtime: number
    allowances: number
    otherDeductions: number
    paye: number // computed 18%
    uif: number // computed 1%
    gross: number
    totalDeductions: number
    net: number
    status: 'draft' | 'paid'
}

type PayrollRun = {
    companyCode: string
    monthKey: string // 'YYYY-MM'
    createdAt: string
    rows: PayslipRow[]
    totals: { gross: number; net: number; deductions: number }
}

/** ---------- Dummy fallback data ---------- */
const dummyEmployees: Employee[] = [
    {
        id: 'e1',
        name: 'Alex Mokoena',
        email: 'alex@company.co.za',
        role: 'employee',
        department: 'Ops',
        baseSalary: 22000
    },
    {
        id: 'e2',
        name: 'Lerato Nkosi',
        email: 'lerato@company.co.za',
        role: 'employee',
        department: 'HR',
        baseSalary: 26000
    },
    {
        id: 'e3',
        name: 'Thabo Dlamini',
        email: 'thabo@company.co.za',
        role: 'staff',
        department: 'Finance',
        baseSalary: 30000
    },
    {
        id: 'e4',
        name: 'Naledi M.',
        email: 'naledi@company.co.za',
        role: 'employee',
        department: 'Tech',
        baseSalary: 35000
    }
]

/** ---------- Helpers ---------- */
const monthKeyOf = (d: dayjs.Dayjs) => d.format('YYYY-MM')

function calcRow(
    base = 0,
    overtime = 0,
    allowances = 0,
    otherDeductions = 0
): {
    gross: number
    paye: number
    uif: number
    totalDeductions: number
    net: number
} {
    const gross = base + overtime + allowances
    const paye = Math.round(gross * 0.18) // simple flat illustrative PAYE for demo
    const uif = Math.round(gross * 0.01)
    const totalDeductions = paye + uif + (otherDeductions || 0)
    const net = gross - totalDeductions
    return { gross, paye, uif, totalDeductions, net }
}

function toCurrency(n: number) {
    if (Number.isNaN(n)) return 'R 0'
    return `R ${n.toLocaleString('en-ZA')}`
}

/** ---------- Component ---------- */
const PayrollPage: React.FC = () => {
    const { user } = useFullIdentity()
    const [loading, setLoading] = useState(true)
    const [employees, setEmployees] = useState<Employee[]>([])
    const [month, setMonth] = useState<string>(monthKeyOf(dayjs()))
    const [rows, setRows] = useState<PayslipRow[]>([])
    const [payslipModal, setPayslipModal] = useState<{
        open: boolean
        row?: PayslipRow
    }>({ open: false })

    const companyCode = user?.companyCode || 'DUMMY'

    /** Load employees (with graceful fallback) */
    useEffect(() => {
        let mounted = true
        async function run() {
            setLoading(true)
            try {
                if (user?.companyCode) {
                    const q = query(
                        collection(db, 'users'),
                        where('companyCode', '==', user.companyCode),
                        where('role', 'in', ['employee', 'staff'])
                    )
                    const snap = await getDocs(q)
                    const list: Employee[] = snap.docs.map(d => {
                        const data: any = d.data()
                        return {
                            id: d.id,
                            name:
                                data.name ||
                                data.fullName ||
                                data.email?.split('@')[0] ||
                                'Employee',
                            email: data.email,
                            role: data.role,
                            department: data.department || '—',
                            baseSalary: data.baseSalary || 22000
                        }
                    })
                    if (mounted) setEmployees(list.length ? list : dummyEmployees)
                } else {
                    if (mounted) setEmployees(dummyEmployees)
                }
            } catch {
                // fallback on any error
                if (mounted) setEmployees(dummyEmployees)
            } finally {
                if (mounted) setLoading(false)
            }
        }
        run()
        return () => {
            mounted = false
        }
    }, [])

    /** Load existing payroll run for selected month (or seed from employees) */
    useEffect(() => {
        let mounted = true
        async function loadRun() {
            setLoading(true)
            try {
                if (user?.companyCode) {
                    const id = `${companyCode}_${month}`
                    const ref = doc(db, 'payroll', id)
                    const snap = await getDoc(ref)
                    if (snap.exists()) {
                        const data = snap.data() as PayrollRun
                        if (mounted) setRows(data.rows)
                        setLoading(false)
                        return
                    }
                }
                // Seed default rows from employees
                const seeded = (
                    employees.length ? employees : dummyEmployees
                ).map<PayslipRow>(e => {
                    const base = e.baseSalary ?? 22000
                    const { gross, paye, uif, totalDeductions, net } = calcRow(
                        base,
                        0,
                        0,
                        0
                    )
                    return {
                        employeeId: e.id,
                        name: e.name,
                        email: e.email,
                        base,
                        overtime: 0,
                        allowances: 0,
                        otherDeductions: 0,
                        paye,
                        uif,
                        gross,
                        totalDeductions,
                        net,
                        status: 'draft'
                    }
                })
                if (mounted) setRows(seeded)
            } catch {
                const seeded = (
                    employees.length ? employees : dummyEmployees
                ).map<PayslipRow>(e => {
                    const base = e.baseSalary ?? 22000
                    const { gross, paye, uif, totalDeductions, net } = calcRow(
                        base,
                        0,
                        0,
                        0
                    )
                    return {
                        employeeId: e.id,
                        name: e.name,
                        email: e.email,
                        base,
                        overtime: 0,
                        allowances: 0,
                        otherDeductions: 0,
                        paye,
                        uif,
                        gross,
                        totalDeductions,
                        net,
                        status: 'draft'
                    }
                })
                if (mounted) setRows(seeded)
            } finally {
                if (mounted) setLoading(false)
            }
        }
        loadRun()
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [month, companyCode, employees.length])

    /** Derived totals */
    const totals = useMemo(() => {
        const gross = rows.reduce((a, r) => a + (r.gross || 0), 0)
        const deductions = rows.reduce((a, r) => a + (r.totalDeductions || 0), 0)
        const net = rows.reduce((a, r) => a + (r.net || 0), 0)
        return { gross, deductions, net }
    }, [rows])

    /** Update a row, re-calc amounts */
    const updateRow = (empId: string, patch: Partial<PayslipRow>) => {
        setRows(prev =>
            prev.map(r => {
                if (r.employeeId !== empId) return r
                const base = patch.base ?? r.base
                const overtime = patch.overtime ?? r.overtime
                const allowances = patch.allowances ?? r.allowances
                const otherDeductions = patch.otherDeductions ?? r.otherDeductions
                const { gross, paye, uif, totalDeductions, net } = calcRow(
                    base,
                    overtime,
                    allowances,
                    otherDeductions
                )
                return { ...r, ...patch, gross, paye, uif, totalDeductions, net }
            })
        )
    }

    /** Save run to Firestore */
    const saveRun = async () => {
        const run: PayrollRun = {
            companyCode,
            monthKey: month,
            createdAt: new Date().toISOString(),
            rows,
            totals
        }
        try {
            if (user?.companyCode) {
                const id = `${companyCode}_${month}`
                await setDoc(doc(db, 'payroll', id), run, { merge: true })
                message.success('Payroll saved ✅')
            } else {
                message.info('Saved locally (using dummy mode).')
            }
        } catch (e) {
            console.error(e)
            message.error('Could not save payroll.')
        }
    }

    /** Mark an employee as paid */
    const markPaid = async (empId: string) => {
        setRows(prev =>
            prev.map(r => (r.employeeId === empId ? { ...r, status: 'paid' } : r))
        )
        // persist run after change
        await saveRun()
    }

    /** Export CSV */
    const exportCSV = () => {
        const header = [
            'Employee,Email,Base,Overtime,Allowances,Other Deductions,PAYE,UIF,Gross,Total Deductions,Net,Status'
        ]
        const lines = rows.map(r =>
            [
                r.name,
                r.email,
                r.base,
                r.overtime,
                r.allowances,
                r.otherDeductions,
                r.paye,
                r.uif,
                r.gross,
                r.totalDeductions,
                r.net,
                r.status
            ].join(',')
        )
        const csv = header.concat(lines).join('\n')
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `payroll_${companyCode}_${month}.csv`
        a.click()
        URL.revokeObjectURL(url)
    }

    /** Columns */
    const columns = [
        {
            title: 'Employee',
            dataIndex: 'name',
            key: 'name',
            fixed: 'left' as const
        },
        { title: 'Email', dataIndex: 'email', key: 'email' },
        {
            title: 'Base',
            dataIndex: 'base',
            key: 'base',
            render: (v: number, r: PayslipRow) => (
                <InputNumber
                    min={0}
                    value={v}
                    onChange={val => updateRow(r.employeeId, { base: Number(val || 0) })}
                    formatter={val => `R ${val}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                    parser={val => Number(String(val).replace(/[R\s,]/g, ''))}
                />
            )
        },
        {
            title: 'Overtime',
            dataIndex: 'overtime',
            key: 'overtime',
            render: (v: number, r: PayslipRow) => (
                <InputNumber
                    min={0}
                    value={v}
                    onChange={val =>
                        updateRow(r.employeeId, { overtime: Number(val || 0) })
                    }
                    formatter={val => `R ${val}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                    parser={val => Number(String(val).replace(/[R\s,]/g, ''))}
                />
            )
        },
        {
            title: 'Allowances',
            dataIndex: 'allowances',
            key: 'allowances',
            render: (v: number, r: PayslipRow) => (
                <InputNumber
                    min={0}
                    value={v}
                    onChange={val =>
                        updateRow(r.employeeId, { allowances: Number(val || 0) })
                    }
                    formatter={val => `R ${val}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                    parser={val => Number(String(val).replace(/[R\s,]/g, ''))}
                />
            )
        },
        {
            title: 'Other Deductions',
            dataIndex: 'otherDeductions',
            key: 'otherDeductions',
            render: (v: number, r: PayslipRow) => (
                <InputNumber
                    min={0}
                    value={v}
                    onChange={val =>
                        updateRow(r.employeeId, { otherDeductions: Number(val || 0) })
                    }
                    formatter={val => `R ${val}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                    parser={val => Number(String(val).replace(/[R\s,]/g, ''))}
                />
            )
        },
        {
            title: 'Gross',
            dataIndex: 'gross',
            key: 'gross',
            render: (v: number) => <Text strong>{toCurrency(v)}</Text>
        },
        {
            title: 'Deductions',
            dataIndex: 'totalDeductions',
            key: 'totalDeductions',
            render: (v: number, r: PayslipRow) => (
                <span>
                    <Tooltip
                        title={`PAYE: ${toCurrency(r.paye)} • UIF: ${toCurrency(
                            r.uif
                        )} • Other: ${toCurrency(r.otherDeductions)}`}
                    >
                        {toCurrency(v)}
                    </Tooltip>
                </span>
            )
        },
        {
            title: 'Net',
            dataIndex: 'net',
            key: 'net',
            render: (v: number) => (
                <Text style={{ color: '#52c41a' }}>{toCurrency(v)}</Text>
            )
        },
        {
            title: 'Status',
            dataIndex: 'status',
            key: 'status',
            render: (s: PayslipRow['status']) =>
                s === 'paid' ? (
                    <Tag color='green'>Paid</Tag>
                ) : (
                    <Tag color='orange'>Draft</Tag>
                )
        },
        {
            title: 'Actions',
            key: 'actions',
            fixed: 'right' as const,
            render: (_: any, r: PayslipRow) => (
                <Space>
                    <Button
                        size='small'
                        icon={<FileTextOutlined />}
                        onClick={() => setPayslipModal({ open: true, row: r })}
                    >
                        Payslip
                    </Button>
                    {r.status !== 'paid' && (
                        <Button
                            size='small'
                            type='primary'
                            icon={<CheckCircleOutlined />}
                            onClick={() => markPaid(r.employeeId)}
                        >
                            Mark Paid
                        </Button>
                    )}
                </Space>
            )
        }
    ]

    return (
        <div style={{ padding: 24 }}>
            {/* Header */}
            <MotionCard>
                <Row align='middle' justify='space-between'>
                    <Col>
                        <Title level={4} style={{ marginBottom: 0 }}>
                            Payroll
                        </Title>
                        <Text type='secondary'>
                            Run payroll, preview payslips, and export for {month}.
                        </Text>
                    </Col>
                    <Col>
                        <Space wrap>
                            <Select
                                value={month}
                                onChange={setMonth}
                                style={{ width: 140 }}
                                dropdownMatchSelectWidth={false}
                            >
                                {Array.from({ length: 12 }).map((_, i) => {
                                    const m = dayjs().subtract(i, 'month')
                                    const key = monthKeyOf(m)
                                    return (
                                        <Option key={key} value={key}>
                                            {m.format('MMM YYYY')}
                                        </Option>
                                    )
                                })}
                            </Select>
                            <Button icon={<ReloadOutlined />} onClick={() => setMonth(month)}>
                                Refresh
                            </Button>
                            <Button icon={<CloudDownloadOutlined />} onClick={exportCSV}>
                                Export CSV
                            </Button>
                            <Button type='primary' icon={<SaveOutlined />} onClick={saveRun}>
                                Save Run
                            </Button>
                        </Space>
                    </Col>
                </Row>
            </MotionCard>

            {/* KPIs */}
            <Row gutter={[16, 16]} style={{ marginTop: 12 }}>
                <Col xs={24} md={8}>
                    <MotionCard>
                        <Space>
                            <DollarCircleOutlined
                                style={{ fontSize: 22, color: '#1677ff' }}
                            />
                            <div>
                                <Text type='secondary'>Total Gross</Text>
                                <div style={{ fontSize: 18, fontWeight: 600 }}>
                                    {toCurrency(totals.gross)}
                                </div>
                            </div>
                        </Space>
                    </MotionCard>
                </Col>
                <Col xs={24} md={8}>
                    <MotionCard>
                        <Space>
                            <DollarCircleOutlined
                                style={{ fontSize: 22, color: '#faad14' }}
                            />
                            <div>
                                <Text type='secondary'>Total Deductions</Text>
                                <div style={{ fontSize: 18, fontWeight: 600 }}>
                                    {toCurrency(totals.deductions)}
                                </div>
                            </div>
                        </Space>
                    </MotionCard>
                </Col>
                <Col xs={24} md={8}>
                    <MotionCard>
                        <Space>
                            <DollarCircleOutlined
                                style={{ fontSize: 22, color: '#52c41a' }}
                            />
                            <div>
                                <Text type='secondary'>Total Net</Text>
                                <div style={{ fontSize: 18, fontWeight: 600 }}>
                                    {toCurrency(totals.net)}
                                </div>
                            </div>
                        </Space>
                    </MotionCard>
                </Col>
            </Row>

            {/* Table */}
            <MotionCard style={{ marginTop: 16 }}>
                <Table<PayslipRow>
                    rowKey='employeeId'
                    loading={loading}
                    dataSource={rows}
                    columns={columns as any}
                    pagination={{ pageSize: 8 }}
                    scroll={{ x: 1200 }}
                />
            </MotionCard>

            {/* Payslip Modal (print-friendly) */}
            <Modal
                open={payslipModal.open}
                onCancel={() => setPayslipModal({ open: false })}
                title='Payslip Preview'
                width={720}
                footer={
                    <Space>
                        <Button onClick={() => setPayslipModal({ open: false })}>
                            Close
                        </Button>
                        <Button
                            type='primary'
                            icon={<PrinterOutlined />}
                            onClick={() => {
                                const el = document.getElementById('printable-payslip')
                                if (!el) return
                                const w = window.open('', '_blank', 'width=800,height=900')
                                if (!w) return
                                w.document.write(`
                  <html>
                    <head>
                      <title>Payslip</title>
                      <style>
                        body{font-family: -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; padding:24px;}
                        .box{border:1px solid #d6e4ff;border-radius:8px;padding:16px;}
                        .row{display:flex;justify-content:space-between;margin:6px 0;}
                        .muted{color:#999}
                        h2{margin:0 0 8px 0}
                        table{width:100%;border-collapse:collapse;margin-top:12px;}
                        th,td{border-bottom:1px solid #eee;padding:8px;text-align:left;}
                        .right{text-align:right;}
                      </style>
                    </head>
                    <body>${el.innerHTML}</body>
                  </html>
                `)
                                w.document.close()
                                w.focus()
                                w.print()
                            }}
                        >
                            Print / Save PDF
                        </Button>
                    </Space>
                }
            >
                {payslipModal.row && (
                    <div id='printable-payslip'>
                        <div className='box'>
                            <Row justify='space-between'>
                                <Col>
                                    <Title level={4} style={{ margin: 0 }}>
                                        Payslip
                                    </Title>
                                    <Text className='muted'>
                                        Month: {dayjs(month + '-01').format('MMMM YYYY')}
                                    </Text>
                                </Col>
                                <Col>
                                    <div style={{ textAlign: 'right' }}>
                                        <Text strong>Company</Text>
                                        <div>Code: {companyCode}</div>
                                        <div>Date: {dayjs().format('YYYY-MM-DD')}</div>
                                    </div>
                                </Col>
                            </Row>
                            <Divider />
                            <Row gutter={16}>
                                <Col span={12}>
                                    <Text strong>Employee</Text>
                                    <div>{payslipModal.row.name}</div>
                                    <div className='muted'>{payslipModal.row.email}</div>
                                </Col>
                                <Col span={12}>
                                    <Text strong>Status</Text>
                                    <div>
                                        {payslipModal.row.status === 'paid' ? 'Paid' : 'Draft'}
                                    </div>
                                </Col>
                            </Row>

                            <Divider />

                            <table>
                                <thead>
                                    <tr>
                                        <th>Earning / Deduction</th>
                                        <th className='right'>Amount</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <td>Base Salary</td>
                                        <td className='right'>
                                            {toCurrency(payslipModal.row.base)}
                                        </td>
                                    </tr>
                                    <tr>
                                        <td>Overtime</td>
                                        <td className='right'>
                                            {toCurrency(payslipModal.row.overtime)}
                                        </td>
                                    </tr>
                                    <tr>
                                        <td>Allowances</td>
                                        <td className='right'>
                                            {toCurrency(payslipModal.row.allowances)}
                                        </td>
                                    </tr>
                                    <tr>
                                        <td>
                                            <strong>Gross Pay</strong>
                                        </td>
                                        <td className='right'>
                                            <strong>{toCurrency(payslipModal.row.gross)}</strong>
                                        </td>
                                    </tr>
                                    <tr>
                                        <td>PAYE (18%)</td>
                                        <td className='right'>
                                            -{toCurrency(payslipModal.row.paye)}
                                        </td>
                                    </tr>
                                    <tr>
                                        <td>UIF (1%)</td>
                                        <td className='right'>
                                            -{toCurrency(payslipModal.row.uif)}
                                        </td>
                                    </tr>
                                    <tr>
                                        <td>Other Deductions</td>
                                        <td className='right'>
                                            -{toCurrency(payslipModal.row.otherDeductions)}
                                        </td>
                                    </tr>
                                    <tr>
                                        <td>
                                            <strong>Net Pay</strong>
                                        </td>
                                        <td className='right'>
                                            <strong>{toCurrency(payslipModal.row.net)}</strong>
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </Modal>
        </div>
    )
}

export default PayrollPage
