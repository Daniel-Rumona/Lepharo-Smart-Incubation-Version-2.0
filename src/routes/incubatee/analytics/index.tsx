import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Col,
  DatePicker,
  Empty,
  Grid,
  Modal,
  Row,
  Segmented,
  Space,
  Tooltip,
  message,
} from "antd";
import HighchartsReact from "highcharts-react-official";
import Highcharts from "highcharts";
import { collection, getDocs, query, where } from "firebase/firestore";
import { Helmet } from "react-helmet";
import dayjs, { Dayjs } from "dayjs";
import customParseFormat from "dayjs/plugin/customParseFormat";
import { ExpandAltOutlined, ReloadOutlined } from "@ant-design/icons";
import { db } from "@/firebase";
import { LoadingOverlay } from "@/components/shared/LoadingOverlay";
import { MotionCard } from "@/components/dashboards/metrics/Header";
import GrowthScoreCard from "@/components/growth-score/GrowthScoreCard";
import MilestoneJourney, { MilestoneActivityChart } from "@/components/milestone-journey/MilestoneJourney";
import { useFullIdentity } from "@/hooks/useFullIdentity";

dayjs.extend(customParseFormat);

type MonthlyPerformanceRow = {
  key: string;
  month?: string;
  revenue?: number;
  headPermanent?: number;
  headTemporary?: number;
  createdAt?: any;
  updatedAt?: any;
};

const numberValue = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

// This is deliberately the same source and date logic as the Metrics page.
const rowDate = (row: MonthlyPerformanceRow): Dayjs | null => {
  const timestamp = row.createdAt || row.updatedAt;
  if (typeof timestamp?.toDate === "function") {
    const parsed = dayjs(timestamp.toDate());
    if (parsed.isValid()) return parsed;
  }

  const month = String(row.month || "").trim();
  if (!month) return null;
  const strict = dayjs(month, ["MMMM YYYY", "MMM YYYY", "YYYY-MM"], true);
  if (strict.isValid()) return strict;
  const fallback = dayjs(month);
  return fallback.isValid() ? fallback : null;
};

const monthLabel = (row: MonthlyPerformanceRow) =>
  String(row.month || "").trim() ||
  rowDate(row)?.format("MMMM YYYY") ||
  "Unknown month";

const formatRevenue = (value: number) => {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return `${value}`;
};

const { RangePicker } = DatePicker;
const { useBreakpoint } = Grid;

const IncubateeAnalytics = () => {
  const { user } = useFullIdentity();
  const [loading, setLoading] = useState(true);
  const [hasParticipant, setHasParticipant] = useState(false);
  const [rows, setRows] = useState<MonthlyPerformanceRow[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [expandedChart, setExpandedChart] = useState<
    "revenue" | "headcount" | null
  >(null);
  const [view, setView] = useState<"Activity" | "Metrics">("Activity");
  const [dateRange, setDateRange] = useState<[Dayjs, Dayjs]>([
    dayjs().subtract(5, "month").startOf("month"),
    dayjs().endOf("month"),
  ]);
  const screens = useBreakpoint();
  const isMobile = !screens.md;

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const email = user?.email;
      if (!email) {
        setRows([]);
        setHasParticipant(false);
        return;
      }

      const participantSnapshot = await getDocs(
        query(collection(db, "participants"), where("email", "==", email))
      );
      if (participantSnapshot.empty) {
        setRows([]);
        setHasParticipant(false);
        return;
      }

      setHasParticipant(true);
      const participantId = participantSnapshot.docs[0].id;
      const historySnapshot = await getDocs(
        collection(db, "monthlyPerformance", participantId, "history")
      );
      setRows(
        historySnapshot.docs
          .map(
            (item) =>
              ({ key: item.id, ...item.data() } as MonthlyPerformanceRow)
          )
          .sort(
            (left, right) =>
              (rowDate(left)?.valueOf() || 0) - (rowDate(right)?.valueOf() || 0)
          )
      );
    } catch (error) {
      console.error("Failed to load incubatee analytics:", error);
      message.error("Failed to load analytics data");
    } finally {
      setLoading(false);
    }
  }, [user?.email]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filteredRows = useMemo(
    () =>
      rows.filter((row) => {
        const date = rowDate(row);
        return (
          !!date &&
          (date.isAfter(dateRange[0], "month") ||
            date.isSame(dateRange[0], "month")) &&
          (date.isBefore(dateRange[1], "month") ||
            date.isSame(dateRange[1], "month"))
        );
      }),
    [dateRange, rows]
  );
  const categories = useMemo(
    () => filteredRows.map(monthLabel),
    [filteredRows]
  );
  const permanentSeries = useMemo(
    () => filteredRows.map((row) => numberValue(row.headPermanent)),
    [filteredRows]
  );
  const temporarySeries = useMemo(
    () => filteredRows.map((row) => numberValue(row.headTemporary)),
    [filteredRows]
  );
  const revenueSeries = useMemo(
    () => filteredRows.map((row) => numberValue(row.revenue)),
    [filteredRows]
  );

  const headcountVsRevenueOptions = useMemo(
    () => ({
      chart: { zoomType: "xy" },
      credits: { enabled: false },
      title: { text: "Headcount vs Revenue" },
      xAxis: [{ categories, crosshair: true }],
      yAxis: [
        { title: { text: "Employees" } },
        {
          title: { text: "Revenue (ZAR)" },
          opposite: true,
          labels: {
            formatter: function (
              this: Highcharts.AxisLabelsFormatterContextObject
            ) {
              return formatRevenue(Number(this.value));
            },
          },
        },
      ],
      tooltip: { shared: true },
      series: [
        {
          type: "column",
          name: "Permanent Employees",
          data: permanentSeries,
          yAxis: 0,
        },
        {
          type: "column",
          name: "Temporary Employees",
          data: temporarySeries,
          yAxis: 0,
        },
        { type: "spline", name: "Revenue", data: revenueSeries, yAxis: 1 },
      ],
    }),
    [categories, permanentSeries, temporarySeries, revenueSeries]
  );

  const revenueChartOptions = useMemo(
    () => ({
      credits: { enabled: false },
      title: { text: "Monthly Revenue Trend" },
      xAxis: { categories },
      yAxis: {
        title: { text: "Revenue (ZAR)" },
        labels: {
          formatter: function (
            this: Highcharts.AxisLabelsFormatterContextObject
          ) {
            return formatRevenue(Number(this.value));
          },
        },
      },
      tooltip: { shared: true },
      series: [{ name: "Revenue", data: revenueSeries, type: "spline" }],
    }),
    [categories, revenueSeries]
  );

  return (
    <div style={{ minHeight: "100vh", padding: 24 }}>
      <Helmet>
        <title>My Analytics | Smart Incubation</title>
        <meta
          name="description"
          content="Track your revenue, staff growth and verified progress over time."
        />
      </Helmet>

      {loading ? (
        <LoadingOverlay tip="Loading analytics" />
      ) : (
        <MotionCard
          filterBar={
            <div
              style={{
                display: "grid",
                gap: 12,
                gridTemplateColumns: isMobile
                  ? "1fr"
                  : "minmax(0, 1fr) minmax(0, 1fr)",
                width: "100%",
              }}
            >
              <Segmented
                value={view}
                onChange={(value) => setView(value as "Activity" | "Metrics")}
                options={["Activity", "Metrics"]}
                style={{ width: "100%" }}
                block
              />
              <RangePicker
                picker="month"
                value={dateRange}
                allowClear={false}
                onChange={(value) => {
                  if (value?.[0] && value?.[1])
                    setDateRange([value[0], value[1]]);
                }}
                style={{ width: "100%" }}
              />
            </div>
          }
          filterBarProps={{ marginBottom: 20 }}
        >
          <Row gutter={[24, 24]}>
            {!hasParticipant && (
              <Col span={24}>
                <Alert
                  type="info"
                  showIcon
                  message="Performance data becomes available once your participant profile is active."
                />
              </Col>
            )}
            {view === "Activity" && (
              <>
                <Col span={24}>
                  <MilestoneJourney
                    scope="sme"
                    email={user?.email}
                    participantId={user?.participantId}
                  />
                </Col>
                <Col span={24}>
                  <MilestoneActivityChart
                    scope="sme"
                    email={user?.email}
                    participantId={user?.participantId}
                    dateRange={dateRange}
                  />
                </Col>
              </>
            )}
            {view === "Metrics" && (
              <>
                <Col span={24}>
                  <GrowthScoreCard email={user?.email} />
                </Col>
                <Col xs={24} md={12}>
                  <MotionCard
                    title="Revenue Chart"
                    extra={
                      rows.length > 0 && (
                        <Button
                          type="link"
                          icon={<ExpandAltOutlined />}
                          onClick={() => {
                            setExpandedChart("revenue");
                            setModalVisible(true);
                          }}
                        >
                          Expand
                        </Button>
                      )
                    }
                  >
                    {filteredRows.length ? (
                      <HighchartsReact
                        highcharts={Highcharts}
                        options={revenueChartOptions}
                      />
                    ) : (
                      <Empty description="No monthly revenue data for this period" />
                    )}
                  </MotionCard>
                </Col>
                <Col xs={24} md={12}>
                  <MotionCard
                    title="Headcount vs Revenue"
                    extra={
                      rows.length > 0 && (
                        <Button
                          type="link"
                          icon={<ExpandAltOutlined />}
                          onClick={() => {
                            setExpandedChart("headcount");
                            setModalVisible(true);
                          }}
                        >
                          Expand
                        </Button>
                      )
                    }
                  >
                    {filteredRows.length ? (
                      <HighchartsReact
                        highcharts={Highcharts}
                        options={headcountVsRevenueOptions}
                      />
                    ) : (
                      <Empty description="No monthly headcount or revenue data for this period" />
                    )}
                  </MotionCard>
                </Col>
              </>
            )}
          </Row>
        </MotionCard>
      )}

      <Modal
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        footer={null}
        title={
          expandedChart === "revenue"
            ? "Expanded View: Revenue Chart"
            : "Expanded View: Headcount vs Revenue"
        }
        width={900}
      >
        {expandedChart === "revenue" && filteredRows.length > 0 && (
          <HighchartsReact
            highcharts={Highcharts}
            options={revenueChartOptions}
          />
        )}
        {expandedChart === "headcount" && filteredRows.length > 0 && (
          <HighchartsReact
            highcharts={Highcharts}
            options={headcountVsRevenueOptions}
          />
        )}
        {!filteredRows.length && (
          <Empty description="No monthly data for this period" />
        )}
      </Modal>
    </div>
  );
};

export default IncubateeAnalytics;
