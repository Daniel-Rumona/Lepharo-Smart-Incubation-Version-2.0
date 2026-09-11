import React, { useState, useEffect, useMemo, useCallback } from 'react'
import {
  Card,
  Row,
  Col,
  DatePicker,
  Button,
  message,
  Spin,
  Table,
  Space,
  Typography,
  Empty,
  Alert
} from 'antd'
import { useAuth } from '@/hooks/useAuth'
import { inquiryService } from '@/services/inquiryService'
import { format, startOfDay, endOfDay } from 'date-fns'
import type { Dayjs } from 'dayjs'
import type { ColumnsType } from 'antd/es/table'

import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'
import heatmapModule from 'highcharts/modules/heatmap'
import exportingModule from 'highcharts/modules/exporting'
import accessibilityModule from 'highcharts/modules/accessibility'
import { MotionCard } from '@/components/dashboards/metrics/Header'

const { RangePicker } = DatePicker
const { Title, Text } = Typography

if (typeof Highcharts === 'function') {
  heatmapModule(Highcharts)
  exportingModule(Highcharts)
  accessibilityModule(Highcharts)
}

type Inquiry = {
  id: string
  status: string
  source: string
  submittedAt: string | number | Date
}

interface ReportData {
  inquiriesByStatus: { status: string; count: number }[]
  inquiriesBySource: { source: string; count: number }[]
  inquiriesByDay: { date: string; count: number }[]
  totalInquiries: number
  raw: Inquiry[]
}

/* ---------- small helpers ---------- */
const isAllZero = (nums: number[]) => nums.every(v => (v || 0) === 0)
const isAllZeroPairs = (pairs: Array<[number, number]>) =>
  pairs.every(([, y]) => (y || 0) === 0)
const toPairsFromDaily = (rows: { date: string; count: number }[]) =>
  rows.map(d => [Date.parse(d.date), d.count] as [number, number])

const ReceptionistReports: React.FC = () => {
  const { user, loading: userLoading } = useAuth()
  const [reportData, setReportData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [dateRange, setDateRange] = useState<
    [Dayjs | null, Dayjs | null] | null
  >(null)

  // donut slice selections
  const [selectedStatus, setSelectedStatus] = useState<string | null>(null)
  const [selectedSource, setSelectedSource] = useState<string | null>(null)

  const loadReportData = useCallback(async () => {
    if (!user?.assignedBranch) {
      setLoading(false)
      return
    }
    try {
      setLoading(true)
      const inquiries = await inquiryService.getInquiriesByBranch(
        user.assignedBranch
      )

      // range filter
      let filtered: Inquiry[] = inquiries
      if (dateRange?.[0] && dateRange?.[1]) {
        const start = startOfDay(dateRange[0].toDate())
        const end = endOfDay(dateRange[1].toDate())
        filtered = inquiries.filter(i => {
          const d = new Date(i.submittedAt)
          return d >= start && d <= end
        })
      }

      // aggregations
      const statusMap = new Map<string, number>()
      const sourceMap = new Map<string, number>()
      const dayMap = new Map<string, number>()

      filtered.forEach(i => {
        statusMap.set(i.status, (statusMap.get(i.status) || 0) + 1)
        sourceMap.set(i.source, (sourceMap.get(i.source) || 0) + 1)
        const key = format(new Date(i.submittedAt), 'yyyy-MM-dd')
        dayMap.set(key, (dayMap.get(key) || 0) + 1)
      })

      const rd: ReportData = {
        inquiriesByStatus: Array.from(statusMap, ([status, count]) => ({
          status,
          count
        })),
        inquiriesBySource: Array.from(sourceMap, ([source, count]) => ({
          source,
          count
        })),
        inquiriesByDay: Array.from(dayMap, ([date, count]) => ({
          date,
          count
        })).sort((a, b) => a.date.localeCompare(b.date)),
        totalInquiries: filtered.length,
        raw: filtered
      }

      setReportData(rd)
      setSelectedStatus(null)
      setSelectedSource(null)
    } catch (e) {
      console.error(e)
      message.error('Failed to load report data')
    } finally {
      setLoading(false)
    }
  }, [user?.assignedBranch, dateRange])

  useEffect(() => {
    if (user?.assignedBranch) loadReportData()
  }, [user?.assignedBranch, loadReportData])

  /* ---------- linked mini tables ---------- */
  const filteredBySelectedStatus = useMemo(() => {
    if (!reportData || !selectedStatus) return []
    return reportData.raw
      .filter(i => i.status === selectedStatus)
      .sort((a, b) => +new Date(b.submittedAt) - +new Date(a.submittedAt))
      .slice(0, 10)
      .map(i => ({
        key: i.id,
        date: format(new Date(i.submittedAt), 'dd MMM yyyy'),
        source: i.source,
        status: i.status
      }))
  }, [reportData, selectedStatus])

  const filteredBySelectedSource = useMemo(() => {
    if (!reportData || !selectedSource) return []
    return reportData.raw
      .filter(i => i.source === selectedSource)
      .sort((a, b) => +new Date(b.submittedAt) - +new Date(a.submittedAt))
      .slice(0, 10)
      .map(i => ({
        key: i.id,
        date: format(new Date(i.submittedAt), 'dd MMM yyyy'),
        source: i.source,
        status: i.status
      }))
  }, [reportData, selectedSource])

  const smallCols: ColumnsType<any> = [
    { title: 'Date', dataIndex: 'date', key: 'date', width: 140 },
    { title: 'Source', dataIndex: 'source', key: 'source', width: 140 },
    { title: 'Status', dataIndex: 'status', key: 'status' }
  ]

  /* ---------- datasets and emptiness checks ---------- */
  const statusData = useMemo(
    () =>
      (reportData?.inquiriesByStatus || []).map(s => ({
        name: s.status,
        y: s.count
      })),
    [reportData]
  )
  const sourceData = useMemo(
    () =>
      (reportData?.inquiriesBySource || []).map(s => ({
        name: s.source,
        y: s.count
      })),
    [reportData]
  )
  const trendPairs = useMemo(
    () => toPairsFromDaily(reportData?.inquiriesByDay || []),
    [reportData]
  )

  // heatmap cells
  const heatmapCells = useMemo(() => {
    const rows = reportData?.inquiriesByDay || []
    if (!rows.length) return [] as Array<[number, number, number]>

    const d0 = new Date(rows[0].date)
    const d1 = new Date(rows[rows.length - 1].date)
    const start = new Date(d0)
    start.setHours(0, 0, 0, 0)
    const day = start.getDay()
    const diffToMon = (day + 6) % 7
    start.setDate(start.getDate() - diffToMon)

    const countsByKey = new Map(
      rows.map(r => [r.date, r.count] as [string, number])
    )
    const cells: Array<[number, number, number]> = []
    let weekIndex = 0

    while (true) {
      let filledAny = false
      for (let dow = 0; dow < 7; dow++) {
        const d = new Date(start)
        d.setDate(start.getDate() + weekIndex * 7 + dow)
        if (d > d1) break
        const key = format(d, 'yyyy-MM-dd')
        const val = countsByKey.get(key) || 0
        cells.push([weekIndex, dow, val])
        filledAny = true
      }
      if (!filledAny) break
      weekIndex++
      const nextBase = new Date(start)
      nextBase.setDate(start.getDate() + weekIndex * 7)
      if (nextBase > d1) break
    }
    return cells
  }, [reportData])

  const isStatusEmpty =
    !statusData.length || isAllZero(statusData.map(d => d.y))
  const isSourceEmpty =
    !sourceData.length || isAllZero(sourceData.map(d => d.y))
  const isTrendEmpty = !trendPairs.length || isAllZeroPairs(trendPairs)
  const isHeatEmpty =
    !heatmapCells.length || isAllZero(heatmapCells.map(c => c[2]))

  const allEmpty = isStatusEmpty && isSourceEmpty && isTrendEmpty && isHeatEmpty

  /* ---------- chart options (pies: donut + hide labels at 0) ---------- */
  const statusDonutOptions = useMemo(
    (): Highcharts.Options => ({
      chart: { type: 'pie', height: 340 },
      title: { text: 'Status Breakdown' },
      tooltip: { pointFormat: '<b>{point.y} ({point.percentage:.1f}%)</b>' },
      plotOptions: {
        pie: {
          innerSize: '60%',
          showInLegend: true,
          cursor: 'pointer',
          dataLabels: {
            enabled: true,
            formatter: function () {
              // @ts-ignore
              return this.y > 0
                ? `${this.point.name}<br/>${this.percentage!.toFixed(1)}%`
                : null
            }
          },
          point: {
            events: {
              click: function () {
                // @ts-ignore
                const name = this.name as string
                setSelectedStatus(prev => (prev === name ? null : name))
              }
            }
          }
        }
      },
      series: [{ type: 'pie', name: 'Inquiries', data: statusData }],
      credits: { enabled: false },
      legend: { align: 'center', verticalAlign: 'bottom' }
    }),
    [statusData]
  )

  const sourceDonutOptions = useMemo(
    (): Highcharts.Options => ({
      chart: { type: 'pie', height: 340 },
      title: { text: 'Source Breakdown' },
      tooltip: { pointFormat: '<b>{point.y} ({point.percentage:.1f}%)</b>' },
      plotOptions: {
        pie: {
          innerSize: '60%',
          showInLegend: true,
          cursor: 'pointer',
          dataLabels: {
            enabled: true,
            formatter: function () {
              // @ts-ignore
              return this.y > 0
                ? `${this.point.name}<br/>${this.percentage!.toFixed(1)}%`
                : null
            }
          },
          point: {
            events: {
              click: function () {
                // @ts-ignore
                const name = this.name as string
                setSelectedSource(prev => (prev === name ? null : name))
              }
            }
          }
        }
      },
      series: [{ type: 'pie', name: 'Inquiries', data: sourceData }],
      credits: { enabled: false },
      legend: { align: 'center', verticalAlign: 'bottom' }
    }),
    [sourceData]
  )

  const trendAreaOptions = useMemo(
    (): Highcharts.Options => ({
      chart: { type: 'areaspline', height: 340 },
      title: { text: 'Inquiry Trend' },
      xAxis: { type: 'datetime', tickLength: 0 },
      yAxis: { title: { text: 'Inquiries' }, allowDecimals: false },
      tooltip: {
        shared: true,
        xDateFormat: '%a, %e %b %Y',
        pointFormat: '<b>{point.y} inquiries</b>'
      },
      series: [
        {
          type: 'areaspline',
          name: 'Inquiries',
          data: trendPairs,
          fillOpacity: 0.2
        }
      ],
      credits: { enabled: false }
    }),
    [trendPairs]
  )

  const heatmapOptions = useMemo(
    (): Highcharts.Options => ({
      chart: { type: 'heatmap', height: 360, marginTop: 50, marginBottom: 60 },
      title: { text: 'Activity Heatmap (Weeks × Day of Week)' },
      xAxis: { title: { text: 'Weeks (in range)' } },
      yAxis: {
        categories: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
        title: { text: undefined },
        reversed: true
      },
      colorAxis: {
        min: 0,
        stops: [
          [0, '#f0f5ff'],
          [0.5, '#85a5ff'],
          [1, '#2f54eb']
        ]
      },
      legend: {
        align: 'right',
        layout: 'vertical',
        verticalAlign: 'middle',
        symbolHeight: 200
      },
      tooltip: {
        formatter: function () {
          // @ts-ignore
          const y = this.point.y as number
          const v = (this.point as any).value as number
          const dayName = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][y]
          return `<b>${dayName}</b><br/>Inquiries: <b>${v}</b>`
        }
      },
      series: [
        {
          type: 'heatmap',
          data: heatmapCells,
          borderWidth: 1,
          dataLabels: { enabled: false }
        }
      ],
      credits: { enabled: false }
    }),
    [heatmapCells]
  )

  /* ---------- guards ---------- */
  if (userLoading) {
    return (
      <div style={{ padding: 24, textAlign: 'center', minHeight: '100vh' }}>
        <MotionCard>
          <Spin size='large' />
          <div style={{ marginTop: 16 }}>
            <h3>Loading user data...</h3>
          </div>
        </MotionCard>
      </div>
    )
  }

  if (user && !user.assignedBranch) {
    return (
      <div style={{ padding: 24, textAlign: 'center' }}>
        <MotionCard style={{ maxWidth: 500, margin: '0 auto' }}>
          <div style={{ padding: '40px 20px' }}>
            <h2>Branch Assignment Required</h2>
            <p style={{ fontSize: 16, color: '#666', marginBottom: 24 }}>
              You need to be assigned to a branch to access reports.
            </p>
            <p style={{ fontSize: 14, color: '#888' }}>
              Please contact your <strong>Director</strong> to assign you to a
              branch through the User Management system.
            </p>
          </div>
        </MotionCard>
      </div>
    )
  }

  if (loading || !reportData) {
    return (
      <div style={{ padding: 24, textAlign: 'center', minHeight: '100vh' }}>
        <MotionCard>
          <Spin size='large' />
          <div style={{ marginTop: 16 }}>
            <h3>Generating reports...</h3>
          </div>
        </MotionCard>
      </div>
    )
  }

  /* ---------- render ---------- */
  return (
    <div style={{ padding: 24, minHeight: '100vh' }}>
      {/* Global empty notice when all charts have no data */}
      {allEmpty && (
        <Alert
          type='info'
          showIcon
          message='No data in the selected period'
          description='Try adjusting your date range or no data has been uploaded yet.'
          style={{ marginBottom: 16 }}
        />
      )}

      {/* Filters */}
      <MotionCard style={{ marginBottom: 24 }}>
        <Row gutter={16} align='middle'>
          <Col xs={24} sm={10}>
            <div style={{ marginBottom: 8 }}>
              <label>Date Range:</label>
            </div>
            <RangePicker
              style={{ width: '100%' }}
              value={dateRange}
              onChange={setDateRange}
              placeholder={['Start Date', 'End Date']}
            />
          </Col>
          <Col xs={24} sm={6}>
            <div style={{ marginBottom: 8 }}>
              <label>&nbsp;</label>
            </div>
            <Button
              onClick={() => {
                setDateRange(null)
              }}
            >
              Reset Filters
            </Button>
          </Col>
        </Row>
      </MotionCard>

      {/* Top row: Trend + Heatmap */}
      <Row gutter={16} style={{ marginBottom: 24 }}>
        <Col xs={24} lg={14}>
          <MotionCard>
            {isTrendEmpty ? (
              <Empty
                description='No trend data'
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            ) : (
              <HighchartsReact
                highcharts={Highcharts}
                options={trendAreaOptions}
              />
            )}
          </MotionCard>
        </Col>
        <Col xs={24} lg={10}>
          <MotionCard>
            {isHeatEmpty ? (
              <Empty
                description='No heatmap data'
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            ) : (
              <HighchartsReact
                highcharts={Highcharts}
                options={heatmapOptions}
              />
            )}
          </MotionCard>
        </Col>
      </Row>

      {/* Donuts row: Status + Source with linked mini tables */}
      <Row gutter={16}>
        <Col xs={24} lg={12}>
          <MotionCard>
            {isStatusEmpty ? (
              <Empty
                description='No status data'
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            ) : (
              <HighchartsReact
                highcharts={Highcharts}
                options={statusDonutOptions}
              />
            )}

            {selectedStatus && !isStatusEmpty && (
              <div style={{ marginTop: 12 }}>
                <Space style={{ marginBottom: 8 }}>
                  <Text strong>Selected Status:</Text>
                  <Text>{selectedStatus}</Text>
                  <Button size='small' onClick={() => setSelectedStatus(null)}>
                    Clear
                  </Button>
                </Space>
                <Table
                  columns={smallCols}
                  dataSource={filteredBySelectedStatus}
                  size='small'
                  pagination={{ pageSize: 5 }}
                />
              </div>
            )}
          </MotionCard>
        </Col>

        <Col xs={24} lg={12}>
          <MotionCard>
            {isSourceEmpty ? (
              <Empty
                description='No source data'
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              />
            ) : (
              <HighchartsReact
                highcharts={Highcharts}
                options={sourceDonutOptions}
              />
            )}

            {selectedSource && !isSourceEmpty && (
              <div style={{ marginTop: 12 }}>
                <Space style={{ marginBottom: 8 }}>
                  <Text strong>Selected Source:</Text>
                  <Text>{selectedSource}</Text>
                  <Button size='small' onClick={() => setSelectedSource(null)}>
                    Clear
                  </Button>
                </Space>
                <Table
                  columns={smallCols}
                  dataSource={filteredBySelectedSource}
                  size='small'
                  pagination={{ pageSize: 5 }}
                />
              </div>
            )}
          </MotionCard>
        </Col>
      </Row>
    </div>
  )
}

export default ReceptionistReports
