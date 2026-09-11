import React, { useEffect, useMemo, useState } from "react";
import {
    Alert,
    Avatar,
    Button,
    Card,
    Col,
    DatePicker,
    Empty,
    Form,
    Input,
    List,
    Modal,
    Row,
    Select,
    Space,
    Spin,
    Statistic,
    Table,
    Tag,
    Typography,
    message,
} from "antd";
import {
    DownloadOutlined,
    EyeOutlined,
    ExportOutlined,
    ArrowDownOutlined,
    ArrowUpOutlined,
    BarChartOutlined,
    FileExcelOutlined,
    FileImageOutlined,
    FilePdfOutlined,
    FileWordOutlined,
    PlusOutlined,
    ReloadOutlined,
    SearchOutlined,
    UserOutlined,
    DollarOutlined,
    FileTextOutlined,
    RiseOutlined,
    TeamOutlined,
} from "@ant-design/icons";
import axios from "axios";
import dayjs, { Dayjs } from "dayjs";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/firebase";
import { useActiveProgramId } from "@/lib/useActiveProgramId";
import { MotionCard } from "@/components/dashboards/metrics/Header";
import { useFullIdentity } from "@/hooks/useFullIdentity";
import CountUp from "react-countup";

const { Title, Text } = Typography;
const { RangePicker } = DatePicker;

const API_BASE_URL = "https://quantnow-sa1e.onrender.com";
const QX_FRONTEND_URL = "https://qx.quantilytix.co.za";
const QX_FINANCE_EMAIL = import.meta.env.VITE_QX_FINANCE_EMAIL || import.meta.env.VITE_FINANCE_EMAIL || "";
const QX_FINANCE_PASSWORD = import.meta.env.VITE_QX_FINANCE_PASSWORD || import.meta.env.VITE_FINANCE_PASSWORD || "";

/**
 * Keep the finance login alive instead of forcing the user to re-enter
 * their password every time this page opens.
 *
 * This is a rolling client-side session. Every successful token read extends
 * the local session window. If the API itself rejects the token with 401/403,
 * we still clear the session and ask the user to sync again.
 */
const FINANCE_SESSION_KEY = "qx_finance_session";
const FINANCE_SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

type FinanceDocument = {
    id: string;
    original_name?: string;
    name?: string;
    filename?: string;
    file_path?: string;
    type?: string;
    mime_type?: string;
    url?: string;
    generated?: boolean;
    created_at?: string;
    createdAt?: string;
    upload_date?: string;
    expiry_date?: string;
};

type MonthlyFinancePoint = {
    month: string;
    monthLabel?: string;
    revenue: number;
    expenses: number;
    profit: number;
};

type Participant = {
    id: string;
    name: string;
    email?: string;
    sector?: string;
    revenue: number | null;
    expenses: number | null;
    currentMonthRevenue: number | null;
    previousMonthRevenue: number | null;
    momChangePercentage: number | null;
    monthlyFinance: MonthlyFinancePoint[];
    documents: FinanceDocument[];
    loadingStats: boolean;
    statsError?: string;
};

type FirestoreParticipant = {
    id: string;
    beneficiaryName?: string;
    participantName?: string;
    companyName?: string;
    businessName?: string;
    email?: string;
    programId?: string;
    activeProgramId?: string;
    programIds?: string[];
    programs?: Array<string | { id?: string; programId?: string }>;
};

type LinkedCompany = {
    id: string;
    name: string;
    email?: string;
    role?: string;
    linked_at?: string | null;
};

type FinanceMember = {
    id: string;
    name: string;
    email?: string;
    linked_company_count: number;
    companies: LinkedCompany[];
};

type StoredFinanceSession = {
    token: string;
    user?: any;
    user_id?: string;
    email?: string;
    name?: string;
    savedAt: number;
    expiresAt: number;
};

const readStoredFinanceSession = (): StoredFinanceSession | null => {
    if (typeof window === "undefined") return null;

    const raw = window.localStorage.getItem(FINANCE_SESSION_KEY);

    if (raw) {
        try {
            return JSON.parse(raw) as StoredFinanceSession;
        } catch {
            window.localStorage.removeItem(FINANCE_SESSION_KEY);
        }
    }

    // Backwards compatibility for any old tab that still has the previous sessionStorage token.
    const legacyToken = window.sessionStorage.getItem("qx_token");

    if (!legacyToken) return null;

    return {
        token: legacyToken,
        user_id: window.sessionStorage.getItem("qx_user_id") || undefined,
        email: window.sessionStorage.getItem("qx_email") || undefined,
        name: window.sessionStorage.getItem("qx_name") || undefined,
        savedAt: Date.now(),
        expiresAt: Date.now() + FINANCE_SESSION_TTL_MS,
    };
};

const writeStoredFinanceSession = (session: StoredFinanceSession) => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(FINANCE_SESSION_KEY, JSON.stringify(session));
};

const financeSession = {
    getToken: () => {
        const stored = readStoredFinanceSession();

        if (!stored?.token) return null;

        if (stored.expiresAt <= Date.now()) {
            financeSession.clear();
            return null;
        }

        // Rolling session: active users should not be kicked out while working.
        writeStoredFinanceSession({
            ...stored,
            expiresAt: Date.now() + FINANCE_SESSION_TTL_MS,
        });

        return stored.token;
    },

    setFromLogin: (token: string, user?: any) => {
        const now = Date.now();

        writeStoredFinanceSession({
            token,
            user,
            user_id: user?.user_id,
            email: user?.email,
            name: user?.name,
            savedAt: now,
            expiresAt: now + FINANCE_SESSION_TTL_MS,
        });

        // Remove older temporary storage so there is only one source of truth.
        window.sessionStorage.removeItem("qx_token");
        window.sessionStorage.removeItem("qx_user_id");
        window.sessionStorage.removeItem("qx_email");
        window.sessionStorage.removeItem("qx_name");
    },

    clear: () => {
        if (typeof window === "undefined") return;

        window.localStorage.removeItem(FINANCE_SESSION_KEY);

        // Also clear the older keys in case an older build created them.
        window.sessionStorage.removeItem("qx_token");
        window.sessionStorage.removeItem("qx_user_id");
        window.sessionStorage.removeItem("qx_email");
        window.sessionStorage.removeItem("qx_name");
    },
};

const getFinanceTokenFromEnv = async (forceRefresh = false) => {
    if (!forceRefresh) {
        const existingToken = financeSession.getToken();
        if (existingToken) return existingToken;
    }

    if (!QX_FINANCE_EMAIL || !QX_FINANCE_PASSWORD) {
        throw new Error("Finance credentials are not configured.");
    }

    const response = await axios.post(`${API_BASE_URL}/login`, {
        email: QX_FINANCE_EMAIL,
        password: QX_FINANCE_PASSWORD,
    });

    const { token, user } = response.data || {};

    if (!token) {
        throw new Error("Finance API did not return an access token.");
    }

    financeSession.setFromLogin(token, user);
    return token as string;
};

const money = (value?: number | null) => {
    if (value === null || value === undefined) return "Unavailable";

    return `R ${Number(value || 0).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    })}`;
};

const percentage = (value?: number | null) => {
    if (value === null || value === undefined || Number.isNaN(Number(value)))
        return "0.00%";
    return `${Number(value).toFixed(2)}%`;
};

const toNumber = (value: any) => Number(value || 0);

const normaliseMonthlyFinance = (rows: any[]): MonthlyFinancePoint[] => {
    if (!Array.isArray(rows)) return [];

    return rows.map((row) => ({
        month: String(row.month || ""),
        monthLabel: row.monthLabel || row.month_label || row.month || "",
        revenue: toNumber(row.revenue),
        expenses: toNumber(row.expenses),
        profit: toNumber(row.profit),
    }));
};

const getMonthlySummary = (rows: MonthlyFinancePoint[]) => {
    const current = rows[rows.length - 1];
    const previous = rows[rows.length - 2];
    const currentRevenue = current ? Number(current.revenue || 0) : null;
    const previousRevenue = previous ? Number(previous.revenue || 0) : null;

    let changePercentage: number | null = null;

    if (currentRevenue !== null && previousRevenue !== null) {
        if (previousRevenue === 0) {
            changePercentage = currentRevenue > 0 ? 100 : 0;
        } else {
            changePercentage =
                ((currentRevenue - previousRevenue) / Math.abs(previousRevenue)) * 100;
        }
    }

    return {
        currentMonthRevenue: currentRevenue,
        previousMonthRevenue: previousRevenue,
        momChangePercentage:
            changePercentage === null ? null : Number(changePercentage.toFixed(2)),
    };
};

const getChangeColor = (value?: number | null) => {
    if (value === null || value === undefined) return "#8c8c8c";
    if (value > 0) return "#52c41a";
    if (value < 0) return "#ff4d4f";
    return "#8c8c8c";
};

const getChangeIcon = (value?: number | null) => {
    if (value === null || value === undefined) return null;
    if (value > 0) return <ArrowUpOutlined />;
    if (value < 0) return <ArrowDownOutlined />;
    return null;
};

const getHumanApiError = (error: any, fallback: string) => {
    const status = error?.response?.status;
    const apiMessage = error?.response?.data?.error || error?.message;

    if (status === 401 || status === 403) {
        return "Your finance sync expired or this request is not authorized.";
    }

    if (status === 402) {
        return "This client has reached their current plan limit.";
    }

    if (typeof apiMessage === "string" && apiMessage.trim()) {
        return apiMessage;
    }

    return fallback;
};

const getDocumentName = (doc: FinanceDocument) => {
    return doc.original_name || doc.name || doc.filename || "Untitled document";
};

const getDocumentType = (doc: FinanceDocument) => {
    const raw =
        `${doc.type || doc.mime_type || getDocumentName(doc)}`.toLowerCase();

    if (raw.includes("pdf")) return "pdf";
    if (raw.includes("sheet") || raw.includes("excel") || raw.includes("xls"))
        return "excel";
    if (raw.includes("word") || raw.includes("doc")) return "word";
    if (
        raw.includes("image") ||
        raw.includes("png") ||
        raw.includes("jpg") ||
        raw.includes("jpeg")
    )
        return "image";

    return "file";
};

const getFileIcon = (doc: FinanceDocument) => {
    const type = getDocumentType(doc);

    switch (type) {
        case "pdf":
            return <FilePdfOutlined style={{ color: "#ff4d4f" }} />;
        case "excel":
            return <FileExcelOutlined style={{ color: "#52c41a" }} />;
        case "word":
            return <FileWordOutlined style={{ color: "#1677ff" }} />;
        case "image":
            return <FileImageOutlined style={{ color: "#faad14" }} />;
        default:
            return <FilePdfOutlined />;
    }
};

const getCompanyName = (company: any) =>
    String(company.name || company.company || company.companyName || "Unknown");

const getCompanyEmail = (company: any) => String(company.email || "");

const normalizeEmail = (value?: string | null) =>
    String(value || "")
        .trim()
        .toLowerCase();

const getParticipantProgramIds = (participant: FirestoreParticipant) => {
    const source = participant as any;

    const programValues = [
        source.programId,
        source.activeProgramId,
        source.programmeId,
        source.program?.id,
        source.program?.programId,
        ...(Array.isArray(source.programIds) ? source.programIds : []),
        ...(Array.isArray(source.programs)
            ? source.programs.map((program: any) =>
                typeof program === "string" ? program : program?.id || program?.programId,
            )
            : []),
    ];

    return new Set(
        programValues
            .map((value) => String(value || "").trim())
            .filter(Boolean),
    );
};

const isParticipantInProgram = (
    participant: FirestoreParticipant,
    activeProgramId?: string,
) => {
    if (!activeProgramId) return true;
    return getParticipantProgramIds(participant).has(activeProgramId);
};

const isSameIdentity = (
    client: Pick<Participant, "name" | "email">,
    fb: FirestoreParticipant,
) => {
    const clientEmail = String(client.email || "")
        .trim()
        .toLowerCase();
    const fbEmail = String(fb.email || "")
        .trim()
        .toLowerCase();

    if (clientEmail && fbEmail && clientEmail === fbEmail) return true;

    const clientName = String(client.name || "")
        .trim()
        .toLowerCase();
    const fbNames = [
        fb.beneficiaryName,
        fb.participantName,
        fb.companyName,
        fb.businessName,
    ]
        .filter(Boolean)
        .map((name) => String(name).trim().toLowerCase());

    return !!clientName && fbNames.includes(clientName);
};

const downloadBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");

    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();

    URL.revokeObjectURL(url);
};

const CreateClientModal = ({
    open,
    onClose,
    onCreated,
}: {
    open: boolean;
    onClose: () => void;
    onCreated: (client: Participant) => void;
}) => {
    const [form] = Form.useForm();
    const [loading, setLoading] = useState(false);

    const handleCreate = async (values: any) => {
        setLoading(true);

        try {
            const token = await getFinanceTokenFromEnv();

            if (!token) {
                message.warning("Finance credentials are not configured.");
                return;
            }

            const response = await axios.post(
                `${API_BASE_URL}/accountant/create-client`,
                values,
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                },
            );

            if (!response.data?.ok) {
                throw new Error(response.data?.error || "Could not create client.");
            }

            const company = response.data.company;

            onCreated({
                id: String(company.id),
                name: company.name || company.companyName || values.companyName,
                email: company.email || values.clientEmail,
                sector: company.sector || "Uncategorized",
                revenue: null,
                expenses: null,
                currentMonthRevenue: null,
                previousMonthRevenue: null,
                momChangePercentage: null,
                monthlyFinance: [],
                documents: [],
                loadingStats: false,
            });

            form.resetFields();
            message.success("Client created and linked successfully.");
            onClose();
        } catch (error: any) {
            console.error("Create client failed:", error?.response?.data || error);
            message.error(
                getHumanApiError(error, "Could not create client account."),
            );
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal
            title="Onboard New Client"
            open={open}
            onCancel={onClose}
            footer={null}
            destroyOnClose
        >
            <Alert
                type="info"
                showIcon
                style={{ marginBottom: 16 }}
                message="This creates a Qx finance account and links it to the synced finance user."
            />

            <Form form={form} layout="vertical" onFinish={handleCreate}>
                <Row gutter={16}>
                    <Col xs={24} md={12}>
                        <Form.Item
                            name="clientName"
                            label="Client Owner Name"
                            rules={[{ required: true }]}
                        >
                            <Input placeholder="Jane Doe" />
                        </Form.Item>
                    </Col>

                    <Col xs={24} md={12}>
                        <Form.Item
                            name="companyName"
                            label="Company Name"
                            rules={[{ required: true }]}
                        >
                            <Input placeholder="Acme Trading" />
                        </Form.Item>
                    </Col>
                </Row>

                <Form.Item
                    name="clientEmail"
                    label="Client Email Address"
                    rules={[{ required: true, type: "email" }]}
                >
                    <Input placeholder="client@example.com" />
                </Form.Item>

                <Row gutter={16}>
                    <Col xs={24} md={12}>
                        <Form.Item
                            name="password"
                            label="Temporary Password"
                            rules={[{ required: true, min: 6 }]}
                        >
                            <Input.Password placeholder="Minimum 6 characters" />
                        </Form.Item>
                    </Col>

                    <Col xs={24} md={12}>
                        <Form.Item name="phone" label="Phone Number">
                            <Input placeholder="+27..." />
                        </Form.Item>
                    </Col>
                </Row>

                <Button
                    type="primary"
                    htmlType="submit"
                    block
                    loading={loading}
                    icon={<PlusOutlined />}
                >
                    Create & Link Client
                </Button>
            </Form>
        </Modal>
    );
};

const DocumentViewModal = ({
    participant,
    open,
    onClose,
}: {
    participant: Participant | null;
    open: boolean;
    onClose: () => void;
}) => {
    const [busyId, setBusyId] = useState<string | null>(null);

    const downloadDocument = async (doc: FinanceDocument) => {
        if (!participant?.email) {
            message.warning("Client email is missing.");
            return;
        }

        try {
            setBusyId(doc.id);

            const response = await axios.get(
                `${API_BASE_URL}/api/documents/public/${doc.id}/download`,
                {
                    params: {
                        email: participant.email,
                    },
                    responseType: "blob",
                },
            );

            const contentType =
                response.headers["content-type"] || "application/octet-stream";
            const blob = new Blob([response.data], { type: contentType });

            downloadBlob(blob, getDocumentName(doc));

            message.success("Document downloaded.");
        } catch (error: any) {
            console.error(
                "Document download failed:",
                error?.response?.data || error,
            );
            message.error(getHumanApiError(error, "Could not download document."));
        } finally {
            setBusyId(null);
        }
    };

    return (
        <Modal
            title={participant ? `${participant.name} Documents` : "Documents"}
            open={open}
            onCancel={onClose}
            footer={null}
            width={760}
            destroyOnClose
        >
            {!participant ? (
                <Empty description="No client selected" />
            ) : participant.documents.length === 0 ? (
                <Empty description="No documents found for this client" />
            ) : (
                <List
                    dataSource={participant.documents}
                    renderItem={(doc) => (
                        <List.Item
                            actions={[
                                <Button
                                    key="download"
                                    icon={<DownloadOutlined />}
                                    loading={busyId === doc.id}
                                    onClick={() => downloadDocument(doc)}
                                >
                                    Download
                                </Button>,
                            ]}
                        >
                            <List.Item.Meta
                                avatar={<Avatar icon={getFileIcon(doc)} />}
                                title={<Text strong>{getDocumentName(doc)}</Text>}
                                description={
                                    <Space direction="vertical" size={0}>
                                        <Text type="secondary">
                                            Type: {getDocumentType(doc).toUpperCase()}
                                        </Text>
                                        {(doc.created_at || doc.createdAt || doc.upload_date) && (
                                            <Text type="secondary">
                                                Uploaded:{" "}
                                                {dayjs(
                                                    doc.created_at || doc.createdAt || doc.upload_date,
                                                ).format("DD MMM YYYY")}
                                            </Text>
                                        )}
                                    </Space>
                                }
                            />
                        </List.Item>
                    )}
                />
            )}
        </Modal>
    );
};

const QxFinancialsDownloadModal = ({
    participant,
    open,
    onClose,
}: {
    participant: Participant | null;
    open: boolean;
    onClose: () => void;
}) => {
    const [range, setRange] = useState<[Dayjs, Dayjs]>([
        dayjs().startOf("year"),
        dayjs().endOf("year"),
    ]);

    const [documentType, setDocumentType] = useState<
        | "income-statement"
        | "balance-sheet"
        | "trial-balance"
        | "cash-flow-statement"
    >("income-statement");

    const [loading, setLoading] = useState(false);

    const downloadFinancials = async () => {
        if (!participant?.email) {
            message.warning("Client email is missing.");
            return;
        }

        setLoading(true);

        try {
            const startDate = range[0].format("YYYY-MM-DD");
            const endDate = range[1].format("YYYY-MM-DD");

            const response = await axios.get(
                `${API_BASE_URL}/api/financials/public/download`,
                {
                    params: {
                        email: participant.email,
                        documentType,
                        startDate,
                        endDate,
                    },
                    responseType: "blob",
                },
            );

            const blob = new Blob([response.data], {
                type: response.headers["content-type"] || "application/pdf",
            });

            downloadBlob(
                blob,
                `${participant.name}-${documentType}-${startDate}-to-${endDate}.pdf`,
            );

            message.success("Financial report downloaded.");
            onClose();
        } catch (error: any) {
            console.error(
                "Financials download failed:",
                error?.response?.data || error,
            );
            message.error(
                getHumanApiError(error, "Could not download financial report."),
            );
        } finally {
            setLoading(false);
        }
    };

    return (
        <Modal
            title={
                participant
                    ? `Download Financials - ${participant.name}`
                    : "Download Financials"
            }
            open={open}
            onCancel={onClose}
            footer={null}
            destroyOnClose
        >
            <Space direction="vertical" style={{ width: "100%" }} size={16}>
                <Alert
                    type="info"
                    showIcon
                    message="Choose the report type and reporting period."
                />

                <Select
                    value={documentType}
                    onChange={setDocumentType}
                    style={{ width: "100%" }}
                    options={[
                        { value: "income-statement", label: "Income Statement" },
                        { value: "balance-sheet", label: "Balance Sheet" },
                        { value: "trial-balance", label: "Trial Balance" },
                        { value: "cash-flow-statement", label: "Cash Flow Statement" },
                    ]}
                />

                <RangePicker
                    style={{ width: "100%" }}
                    value={range}
                    onChange={(value) => {
                        if (value?.[0] && value?.[1]) {
                            setRange([value[0], value[1]]);
                        }
                    }}
                />

                <Button
                    type="primary"
                    block
                    icon={<DownloadOutlined />}
                    loading={loading}
                    onClick={downloadFinancials}
                >
                    Download Financials
                </Button>
            </Space>
        </Modal>
    );
};

const RevenueTrendModal = ({
    participant,
    open,
    onClose,
}: {
    participant: Participant | null;
    open: boolean;
    onClose: () => void;
}) => {
    const rows = participant?.monthlyFinance || [];
    const bestMonth = rows.reduce<MonthlyFinancePoint | null>((best, item) => {
        if (!best) return item;
        return item.revenue > best.revenue ? item : best;
    }, null);
    const maxRevenue = Math.max(
        ...rows.map((item) => Number(item.revenue || 0)),
        0,
    );

    return (
        <Modal
            title={
                participant ? `${participant.name} Revenue Trend` : "Revenue Trend"
            }
            open={open}
            onCancel={onClose}
            footer={null}
            width={920}
            destroyOnClose
        >
            {!participant ? (
                <Empty description="No client selected" />
            ) : rows.length === 0 ? (
                <Empty description="No monthly revenue data found for this client" />
            ) : (
                <Space direction="vertical" style={{ width: "100%" }} size={18}>
                    <Row gutter={[16, 16]}>
                        <Col xs={24} sm={12} lg={6}>
                            <Card>
                                <Statistic
                                    title="Current Month"
                                    value={participant.currentMonthRevenue || 0}
                                    precision={2}
                                    prefix="R"
                                />
                            </Card>
                        </Col>

                        <Col xs={24} sm={12} lg={6}>
                            <Card>
                                <Statistic
                                    title="Previous Month"
                                    value={participant.previousMonthRevenue || 0}
                                    precision={2}
                                    prefix="R"
                                />
                            </Card>
                        </Col>

                        <Col xs={24} sm={12} lg={6}>
                            <Card>
                                <Statistic
                                    title="Month-on-Month"
                                    value={participant.momChangePercentage || 0}
                                    precision={2}
                                    suffix="%"
                                    prefix={getChangeIcon(participant.momChangePercentage)}
                                    valueStyle={{
                                        color: getChangeColor(participant.momChangePercentage),
                                    }}
                                />
                            </Card>
                        </Col>

                        <Col xs={24} sm={12} lg={6}>
                            <Card>
                                <Statistic
                                    title={
                                        bestMonth
                                            ? `Best Month (${bestMonth.monthLabel || bestMonth.month})`
                                            : "Best Month"
                                    }
                                    value={bestMonth?.revenue || 0}
                                    precision={2}
                                    prefix="R"
                                />
                            </Card>
                        </Col>
                    </Row>

                    <Card
                        title={
                            <Space>
                                <BarChartOutlined />
                                <span>Month-by-month revenue</span>
                            </Space>
                        }
                    >
                        <Space direction="vertical" style={{ width: "100%" }} size={12}>
                            {rows.map((item) => {
                                const width =
                                    maxRevenue > 0
                                        ? Math.max((item.revenue / maxRevenue) * 100, 3)
                                        : 0;

                                return (
                                    <div key={item.month}>
                                        <Row gutter={12} align="middle">
                                            <Col xs={24} sm={5}>
                                                <Text strong>{item.monthLabel || item.month}</Text>
                                            </Col>

                                            <Col xs={24} sm={14}>
                                                <div
                                                    style={{
                                                        height: 12,
                                                        width: "100%",
                                                        background: "#f0f0f0",
                                                        borderRadius: 999,
                                                        overflow: "hidden",
                                                    }}
                                                >
                                                    <div
                                                        style={{
                                                            height: "100%",
                                                            width: `${width}%`,
                                                            background: "#1677ff",
                                                            borderRadius: 999,
                                                        }}
                                                    />
                                                </div>
                                            </Col>

                                            <Col xs={24} sm={5} style={{ textAlign: "right" }}>
                                                <Text strong>{money(item.revenue)}</Text>
                                            </Col>
                                        </Row>
                                    </div>
                                );
                            })}
                        </Space>
                    </Card>

                    <Table
                        rowKey="month"
                        dataSource={rows}
                        pagination={false}
                        scroll={{ x: true }}
                        columns={[
                            {
                                title: "Month",
                                dataIndex: "monthLabel",
                                key: "monthLabel",
                                render: (_: any, record: MonthlyFinancePoint) =>
                                    record.monthLabel || record.month,
                            },
                            {
                                title: "Revenue",
                                dataIndex: "revenue",
                                key: "revenue",
                                render: (value: number) => <Text strong>{money(value)}</Text>,
                            },
                            {
                                title: "Expenses",
                                dataIndex: "expenses",
                                key: "expenses",
                                render: (value: number) => money(value),
                            },
                            {
                                title: "Profit",
                                dataIndex: "profit",
                                key: "profit",
                                render: (value: number) => (
                                    <Text
                                        style={{ color: value >= 0 ? "#52c41a" : "#ff4d4f" }}
                                        strong
                                    >
                                        {money(value)}
                                    </Text>
                                ),
                            },
                        ]}
                    />
                </Space>
            )}
        </Modal>
    );
};

export const ParticipantsFinancialView: React.FC = () => {
    const { user } = useFullIdentity() as any;
    const activeProgram = useActiveProgramId() as unknown as
        | string
        | {
            activeProgramId?: string;
            value?: string;
            programId?: string;
            isAllPrograms?: boolean;
        };

    const activeProgramId = useMemo(() => {
        const raw =
            typeof activeProgram === "string"
                ? activeProgram
                : activeProgram.activeProgramId ||
                activeProgram.value ||
                activeProgram.programId;

        if (!raw || raw === "all") return undefined;

        return String(raw);
    }, [activeProgram]);

    const [connected, setConnected] = useState(false);
    const [createOpen, setCreateOpen] = useState(false);

    const [loading, setLoading] = useState(false);
    const [clients, setClients] = useState<Participant[]>([]);

    const [search, setSearch] = useState("");
    const [activeParticipant, setActiveParticipant] =
        useState<Participant | null>(null);
    const [documentsOpen, setDocumentsOpen] = useState(false);
    const [financialsOpen, setFinancialsOpen] = useState(false);
    const [revenueTrendOpen, setRevenueTrendOpen] = useState(false);
    const [members, setMembers] = useState<FinanceMember[]>([]);
    const [selectedMemberId, setSelectedMemberId] = useState<string>("all");
    const [statsLoading, setStatsLoading] = useState(false);
    const [authError, setAuthError] = useState<string | null>(null);
    const currentUserEmail = normalizeEmail(user?.email);

    useEffect(() => {
        let cancelled = false;

        const connect = async () => {
            try {
                const token = await getFinanceTokenFromEnv();
                if (cancelled) return;
                setConnected(Boolean(token));
                setAuthError(null);
            } catch (error: any) {
                if (cancelled) return;
                setConnected(false);
                setAuthError(error?.message || "Could not connect to the finance workspace.");
            }
        };

        connect();

        return () => {
            cancelled = true;
        };
    }, []);

    const fetchProgramParticipants = async () => {
        const snap = await getDocs(collection(db, "participants"));

        const rows = snap.docs.map((item) => ({
            id: item.id,
            ...item.data(),
        })) as FirestoreParticipant[];

        if (!activeProgramId) return rows;

        return rows.filter((participant) =>
            isParticipantInProgram(participant, activeProgramId),
        );
    };

    const fetchStatsForCompany = async (company: any) => {
        try {
            const email = company.email;

            if (!email) {
                throw new Error(
                    "Client email is missing. Cannot load public finance stats.",
                );
            }

            const [revenueResult, expensesResult, monthlyResult, documentsResult] =
                await Promise.allSettled([
                    axios.get(`${API_BASE_URL}/api/stats/public/revenue`, {
                        params: { email },
                    }),

                    axios.get(`${API_BASE_URL}/api/stats/public/expenses`, {
                        params: { email },
                    }),

                    axios.get(`${API_BASE_URL}/api/stats/public/revenue-monthly`, {
                        params: { email, months: 12 },
                    }),

                    axios.get(`${API_BASE_URL}/api/documents/public`, {
                        params: { email },
                    }),
                ]);

            if (revenueResult.status === "rejected") {
                console.error(
                    `Public revenue failed for ${company.name}:`,
                    revenueResult.reason?.response?.data || revenueResult.reason,
                );
            }

            if (expensesResult.status === "rejected") {
                console.error(
                    `Public expenses failed for ${company.name}:`,
                    expensesResult.reason?.response?.data || expensesResult.reason,
                );
            }

            if (monthlyResult.status === "rejected") {
                console.error(
                    `Public monthly revenue failed for ${company.name}:`,
                    monthlyResult.reason?.response?.data || monthlyResult.reason,
                );
            }

            if (documentsResult.status === "rejected") {
                console.error(
                    `Public documents failed for ${company.name}:`,
                    documentsResult.reason?.response?.data || documentsResult.reason,
                );
            }

            const revenue =
                revenueResult.status === "fulfilled"
                    ? Number(revenueResult.value.data?.value || 0)
                    : null;

            const expenses =
                expensesResult.status === "fulfilled"
                    ? Number(expensesResult.value.data?.value || 0)
                    : null;

            const monthlyFinance =
                monthlyResult.status === "fulfilled"
                    ? normaliseMonthlyFinance(
                        monthlyResult.value.data?.months ||
                        monthlyResult.value.data ||
                        [],
                    )
                    : [];

            const monthlySummary = getMonthlySummary(monthlyFinance);

            const documents =
                documentsResult.status === "fulfilled" &&
                    Array.isArray(documentsResult.value.data)
                    ? documentsResult.value.data
                    : [];

            const failedParts = [
                revenueResult.status === "rejected" ? "revenue" : null,
                expensesResult.status === "rejected" ? "expenses" : null,
                monthlyResult.status === "rejected" ? "monthly revenue" : null,
                documentsResult.status === "rejected" ? "documents" : null,
            ].filter(Boolean);

            const statsError =
                failedParts.length > 0
                    ? `Could not load: ${failedParts.join(", ")}.`
                    : undefined;

            setClients((prev) =>
                prev.map((client) =>
                    client.id === String(company.id)
                        ? {
                            ...client,
                            revenue,
                            expenses,
                            currentMonthRevenue: monthlySummary.currentMonthRevenue,
                            previousMonthRevenue: monthlySummary.previousMonthRevenue,
                            momChangePercentage: monthlySummary.momChangePercentage,
                            monthlyFinance,
                            documents,
                            loadingStats: false,
                            statsError,
                        }
                        : client,
                ),
            );
        } catch (error: any) {
            console.error(
                `Public stats failed for ${company.name}:`,
                error?.response?.data || error,
            );

            setClients((prev) =>
                prev.map((client) =>
                    client.id === String(company.id)
                        ? {
                            ...client,
                            revenue: null,
                            expenses: null,
                            currentMonthRevenue: null,
                            previousMonthRevenue: null,
                            momChangePercentage: null,
                            monthlyFinance: [],
                            documents: [],
                            loadingStats: false,
                            statsError: getHumanApiError(
                                error,
                                "Could not load finance metrics.",
                            ),
                        }
                        : client,
                ),
            );
        }
    };

    const runInBatches = async <T,>(
        items: T[],
        batchSize: number,
        worker: (item: T) => Promise<void>,
    ) => {
        for (let i = 0; i < items.length; i += batchSize) {
            const batch = items.slice(i, i + batchSize);
            await Promise.allSettled(batch.map(worker));
        }
    };

    const fetchClientsAndStats = async () => {
        let token: string;

        try {
            token = await getFinanceTokenFromEnv();
        } catch (error: any) {
            setConnected(false);
            setAuthError(error?.message || "Could not connect to the finance workspace.");
            return;
        }

        setLoading(true);

        try {
            const [programParticipants, res] = await Promise.all([
                fetchProgramParticipants(),
                axios.get(`${API_BASE_URL}/admin/all-memberships`, {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                }),
            ]);

            const serverMembers: FinanceMember[] = Array.isArray(res.data?.members)
                ? res.data.members
                : [];

            const companies = Array.isArray(res.data?.companies)
                ? res.data.companies
                : [];

            const scopedCompanies = activeProgramId
                ? companies.filter((company: any) =>
                    programParticipants.some((participant) =>
                        isSameIdentity(
                            {
                                name: getCompanyName(company),
                                email: getCompanyEmail(company),
                            },
                            participant,
                        ),
                    ),
                )
                : companies;

            setMembers(serverMembers);

            const initialClients: Participant[] = scopedCompanies.map((company: any) => ({
                id: String(company.id),
                name: getCompanyName(company),
                email: getCompanyEmail(company),
                sector: company.sector || "Uncategorized",
                revenue: null,
                expenses: null,
                currentMonthRevenue: null,
                previousMonthRevenue: null,
                momChangePercentage: null,
                monthlyFinance: [],
                documents: [],
                loadingStats: true,
            }));

            // Show companies immediately.
            setClients(initialClients);

            if (scopedCompanies.length === 0) {
                message.info(
                    activeProgramId
                        ? "No managed finance clients found for the active program."
                        : "No managed finance clients found.",
                );
            }

            // Stop full-page loading immediately.
            setLoading(false);

            // Load stats in background.
            setStatsLoading(true);

            await runInBatches(scopedCompanies, 5, async (company) => {
                await fetchStatsForCompany(company);
            });

            setStatsLoading(false);
        } catch (error: any) {
            console.error(
                "Load finance clients failed:",
                error?.response?.data || error,
            );

            if (error?.response?.status === 401 || error?.response?.status === 403) {
                financeSession.clear();
                setConnected(false);
                setAuthError("Finance credentials were rejected by the API.");
            }

            message.error(
                getHumanApiError(error, "Could not load managed finance clients."),
            );
            setLoading(false);
            setStatsLoading(false);
        }
    };

    useEffect(() => {
        if (connected) {
            fetchClientsAndStats();
        }
    }, [connected, activeProgramId]);

    const selectedMember = useMemo(() => {
        if (selectedMemberId === "all") return null;
        return members.find((member) => member.id === selectedMemberId) || null;
    }, [members, selectedMemberId]);

    const memberScopedClients = useMemo(() => {
        if (!selectedMember) return clients;

        const allowedCompanyIds = new Set(
            selectedMember.companies.map((company) => String(company.id)),
        );

        return clients.filter((client) => allowedCompanyIds.has(String(client.id)));
    }, [clients, selectedMember]);

    const currentUserLinkedCompanyIds = useMemo(() => {
        if (!currentUserEmail) return new Set<string>();

        const owner = members.find(
            (member) => normalizeEmail(member.email) === currentUserEmail,
        );

        return new Set(
            (owner?.companies || []).map((company) => String(company.id)),
        );
    }, [members, currentUserEmail]);

    const canOpenClient = (client: Participant) =>
        currentUserLinkedCompanyIds.has(String(client.id));

    const filteredClients = useMemo(() => {
        const term = search.trim().toLowerCase();

        if (!term) return memberScopedClients;

        return memberScopedClients.filter((client) => {
            return (
                client.name.toLowerCase().includes(term) ||
                String(client.email || "")
                    .toLowerCase()
                    .includes(term) ||
                String(client.sector || "")
                    .toLowerCase()
                    .includes(term)
            );
        });
    }, [memberScopedClients, search]);

    const totals = useMemo(() => {
        const revenue = clients.reduce(
            (sum, item) => sum + Number(item.revenue || 0),
            0,
        );
        const expenses = clients.reduce(
            (sum, item) => sum + Number(item.expenses || 0),
            0,
        );
        const documents = clients.reduce(
            (sum, item) => sum + Number(item.documents?.length || 0),
            0,
        );
        const currentMonthRevenue = clients.reduce(
            (sum, item) => sum + Number(item.currentMonthRevenue || 0),
            0,
        );
        const growingClients = clients.filter(
            (item) => Number(item.momChangePercentage || 0) > 0,
        ).length;

        return {
            clients: clients.length,
            revenue,
            expenses,
            currentMonthRevenue,
            growingClients,
            documents,
        };
    }, [clients]);

    const openDocuments = (client: Participant) => {
        setActiveParticipant(client);
        setDocumentsOpen(true);
    };

    const openFinancials = (client: Participant) => {
        setActiveParticipant(client);
        setFinancialsOpen(true);
    };

    const openRevenueTrend = (client: Participant) => {
        setActiveParticipant(client);
        setRevenueTrendOpen(true);
    };

    const handleOpenCompanyInQx = async (
        companyId: string,
        companyName: string,
        event?: React.MouseEvent,
    ) => {
        event?.stopPropagation();

        try {
            message.loading({
                content: `Opening ${companyName} in QxAnalytix...`,
                key: "open-qx-company",
            });

            const token = await getFinanceTokenFromEnv();

            const response = await axios.post(
                `${API_BASE_URL}/session/switch-company`,
                {
                    company_id: companyId,
                },
                {
                    headers: {
                        Authorization: `Bearer ${token}`,
                    },
                },
            );

            const scopedToken = response.data?.token;

            if (!scopedToken) {
                throw new Error("No company token returned.");
            }

            const targetUrl = `${QX_FRONTEND_URL}/?token=${encodeURIComponent(
                scopedToken,
            )}&companyId=${encodeURIComponent(companyId)}`;

            message.success({
                content: "Opening company workspace...",
                key: "open-qx-company",
            });

            window.open(targetUrl, "_blank", "noopener,noreferrer");
        } catch (error: any) {
            console.error("Open Qx company failed:", error?.response?.data || error);

            message.error({
                content:
                    error?.response?.data?.error ||
                    "Could not open this company in QxAnalytix.",
                key: "open-qx-company",
            });
        }
    };
    const tableColumns = [
        {
            title: "Client",
            dataIndex: "name",
            key: "name",
            render: (_: any, record: Participant) => (
                <Space>
                    <Avatar>{record.name.charAt(0).toUpperCase()}</Avatar>
                    <Space direction="vertical" size={0}>
                        <Text strong>{record.name}</Text>
                        <Text type="secondary" style={{ fontSize: 12 }}>
                            {record.email || "No email"}
                        </Text>
                    </Space>
                </Space>
            ),
        },
        {
            title: "Current Month Revenue",
            dataIndex: "currentMonthRevenue",
            key: "currentMonthRevenue",
            render: (_: any, record: Participant) =>
                record.loadingStats ? (
                    <Spin size="small" />
                ) : (
                    <Text strong>{money(record.currentMonthRevenue)}</Text>
                ),
        },
        {
            title: "Previous Month",
            dataIndex: "previousMonthRevenue",
            key: "previousMonthRevenue",
            render: (_: any, record: Participant) =>
                record.loadingStats ? (
                    <Spin size="small" />
                ) : (
                    money(record.previousMonthRevenue)
                ),
        },
        {
            title: "MoM Change",
            dataIndex: "momChangePercentage",
            key: "momChangePercentage",
            render: (_: any, record: Participant) =>
                record.loadingStats ? (
                    <Spin size="small" />
                ) : (
                    <Tag
                        color={
                            Number(record.momChangePercentage || 0) >= 0 ? "green" : "red"
                        }
                    >
                        <Space size={4}>
                            {getChangeIcon(record.momChangePercentage)}
                            {percentage(record.momChangePercentage)}
                        </Space>
                    </Tag>
                ),
        },
        {
            title: "Expenses",
            dataIndex: "expenses",
            key: "expenses",
            render: (_: any, record: Participant) =>
                record.loadingStats ? (
                    <Spin size="small" />
                ) : (
                    <Text>{money(record.expenses)}</Text>
                ),
        },
        {
            title: "Documents",
            dataIndex: "documents",
            key: "documents",
            render: (_: any, record: Participant) =>
                record.loadingStats ? (
                    <Spin size="small" />
                ) : (
                    <Tag color="blue">{record.documents.length}</Tag>
                ),
        },
        {
            title: "Actions",
            key: "actions",
            render: (_: any, record: Participant) => (
                <Space>
                    <Button icon={<EyeOutlined />} onClick={() => openDocuments(record)}>
                        Documents
                    </Button>

                    <Button
                        icon={<BarChartOutlined />}
                        onClick={() => openRevenueTrend(record)}
                    >
                        Trend
                    </Button>

                    <Button
                        icon={<DownloadOutlined />}
                        onClick={() => openFinancials(record)}
                    >
                        Financials
                    </Button>
                    {canOpenClient(record) ? (
                        <Button
                            icon={<ExportOutlined />}
                            onClick={(event) =>
                                handleOpenCompanyInQx(record.id, record.name, event)
                            }
                        >
                            Open
                        </Button>
                    ) : null}
                </Space>
            ),
        },
    ];

    return (
        <div style={{ padding: 24, minHeight: '100vh' }}>

            {!connected && authError && (
                <Alert
                    type="warning"
                    showIcon
                    style={{ marginBottom: 20 }}
                    message="Finance workspace unavailable"
                    description={authError}
                />
            )}

            <Row
                gutter={[16, 16]}
                style={{ marginBottom: 20 }}
                align="stretch"
            >
                <Col xs={24} sm={12} md={8} xl={5}>
                    <MotionCard.Metric
                        icon={<TeamOutlined />}
                        iconBg="rgba(22, 119, 255, 0.12)"
                        title="Clients"
                        value={
                            <CountUp
                                end={Number(totals.clients || 0)}
                                duration={0.8}
                                separator=","
                                preserveValue
                            />
                        }
                    />
                </Col>

                <Col xs={24} sm={12} md={8} xl={5}>
                    <MotionCard.Metric
                        icon={<DollarOutlined />}
                        iconBg="rgba(82, 196, 26, 0.12)"
                        title="Total Revenue"
                        value={
                            <CountUp
                                end={Number(totals.revenue || 0)}
                                duration={0.8}
                                preserveValue
                                formattingFn={(value) => money(value)}
                            />
                        }
                    />
                </Col>

                <Col xs={24} sm={12} md={8} xl={5}>
                    <MotionCard.Metric
                        icon={<DollarOutlined />}
                        iconBg="rgba(19, 194, 194, 0.12)"
                        title="Current Month Revenue"
                        value={
                            <CountUp
                                end={Number(totals.currentMonthRevenue || 0)}
                                duration={0.8}
                                preserveValue
                                formattingFn={(value) => money(value)}
                            />
                        }
                    />
                </Col>

                <Col xs={24} sm={12} md={8} xl={4}>
                    <MotionCard.Metric
                        icon={<RiseOutlined />}
                        iconBg="rgba(114, 46, 209, 0.12)"
                        title="Growing SMEs"
                        value={
                            <CountUp
                                end={Number(totals.growingClients || 0)}
                                duration={0.8}
                                separator=","
                                preserveValue
                            />
                        }
                    />
                </Col>

                <Col xs={24} sm={12} md={8} xl={5}>
                    <MotionCard.Metric
                        icon={<FileTextOutlined />}
                        iconBg="rgba(47, 84, 235, 0.12)"
                        title="Financial Documents"
                        value={
                            <CountUp
                                end={Number(totals.documents || 0)}
                                duration={0.8}
                                separator=","
                                preserveValue
                            />
                        }
                    />
                </Col>
            </Row>

            <MotionCard
                style={{ borderRadius: 18 }}
                filterBar={
                    <Row gutter={[12, 12]} align="middle" justify="space-between">
                        <Col xs={24} lg={8}>
                            <Input
                                allowClear
                                prefix={<SearchOutlined />}
                                placeholder="Search by client, email, or sector"
                                value={search}
                                onChange={(event) => setSearch(event.target.value)}
                            />
                        </Col>

                        <Col xs={24} lg={16}>
                            <Space wrap style={{ width: "100%", justifyContent: "flex-end" }}>
                                {statsLoading && (
                                    <Tag color="processing">
                                        Loading company metrics...
                                    </Tag>
                                )}

                                {activeProgramId && (
                                    <Tag color="blue">
                                        Active program SMEs
                                    </Tag>
                                )}

                                <Button
                                    icon={<ReloadOutlined />}
                                    onClick={fetchClientsAndStats}
                                    disabled={!connected}
                                >
                                    Refresh
                                </Button>

                                <Button
                                    icon={<PlusOutlined />}
                                    onClick={() => setCreateOpen(true)}
                                    disabled={!connected}
                                >
                                    New Client
                                </Button>

                            </Space>
                        </Col>
                    </Row>
                }>

                <Spin spinning={loading}>
                    {filteredClients.length === 0 ? (
                        <Empty
                            description={
                                connected
                                    ? "No finance clients found."
                                    : "Finance workspace is not connected."
                            }
                        />
                    ) : (
                        <>
                            <div style={{ marginTop: 24 }}>
                                <Table
                                    rowKey="id"
                                    columns={tableColumns}
                                    dataSource={filteredClients}
                                    pagination={{ pageSize: 8 }}
                                    scroll={{ x: true }}
                                />
                            </div>
                        </>
                    )}
                </Spin>
            </MotionCard>

            <CreateClientModal
                open={createOpen}
                onClose={() => setCreateOpen(false)}
                onCreated={(client) => {
                    setClients((prev) => [client, ...prev]);
                }}
            />

            <DocumentViewModal
                participant={activeParticipant}
                open={documentsOpen}
                onClose={() => setDocumentsOpen(false)}
            />

            <RevenueTrendModal
                participant={activeParticipant}
                open={revenueTrendOpen}
                onClose={() => setRevenueTrendOpen(false)}
            />

            <QxFinancialsDownloadModal
                participant={activeParticipant}
                open={financialsOpen}
                onClose={() => setFinancialsOpen(false)}
            />
        </div>
    );
};

export default ParticipantsFinancialView;
