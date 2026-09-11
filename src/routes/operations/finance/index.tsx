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
    Segmented,
    Select,
    Skeleton,
    Space,
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
import { auth, db } from "@/firebase";
import { useActiveProgramId } from "@/lib/useActiveProgramId";
import { MotionCard } from "@/components/dashboards/metrics/Header";
import { useFullIdentity } from "@/hooks/useFullIdentity";
import {
    guideTarget,
    usePageGuides,
    type PageGuideRegistration,
} from "@/components/guide-me";
import CountUp from "react-countup";
import { Chart as HighchartsChart } from "@highcharts/react";

const { Text } = Typography;
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

type ProgrammeMatchStatus =
    | "supported"
    | "other-program"
    | "unassigned"
    | "unmatched";

type Participant = {
    id: string;
    name: string;
    email?: string;
    isSupportedProgram: boolean;
    programmeMatchStatus: ProgrammeMatchStatus;
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
    email?: string;
};

type FirestoreApplication = {
    id: string;
    email?: string;
    applicantEmail?: string;
    participantId?: string;
    beneficiaryName?: string;
    applicationStatus?: string;
    decision?: {
        status?: string;
    };
    programId?: string;
    programName?: string;
};

type LinkedCompany = {
    id: string;
    name: string;
    email?: string;
    role?: string;
    linked_at?: string | null;
};

type PlatformUser = {
    id: string;
    email?: string;
    name?: string;
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

const isExampleFinanceEmail = (value?: string | null) =>
    normalizeEmail(value).endsWith("@example.com");

const isExcludedScopedCompanyEmail = (value?: string | null) => {
    const email = normalizeEmail(value);

    if (!email) return false;

    return (
        email.endsWith("@example.com") ||
        email.endsWith("@lepharo.co.za") ||
        email.endsWith("@quantilytix.co.za") ||
        email === "lepharo@gmail.com"
    );
};

const getApplicationEmail = (application: FirestoreApplication) =>
    normalizeEmail(application.email || application.applicantEmail);

const isAcceptedApplication = (application: FirestoreApplication) => {
    const status = String(
        application.applicationStatus ||
        application.decision?.status ||
        "",
    )
        .trim()
        .toLowerCase();

    return status === "accepted";
};

const findMatchingParticipant = (
    client: Pick<Participant, "name" | "email">,
    participants: FirestoreParticipant[],
) => {
    const email = normalizeEmail(client.email);
    const emailMatches = email
        ? participants.filter((participant) => normalizeEmail(participant.email) === email)
        : [];

    if (emailMatches.length > 0) {
        return emailMatches.length === 1 ? emailMatches[0] : null;
    }

    const name = String(client.name || "").trim().toLowerCase();
    if (!name) return null;

    const nameMatches = participants.filter(
        (participant) =>
            String(participant.beneficiaryName || "").trim().toLowerCase() === name,
    );

    // A shared name must not link an account to an arbitrary participant.
    return nameMatches.length === 1 ? nameMatches[0] : null;
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
        setStatsLoading(true);
        setMetricsReady(false);

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
                isSupportedProgram: false,
                programmeMatchStatus: "unmatched",
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
    const [trendView, setTrendView] = useState<"revenue" | "profitLoss">("revenue");
    const [trendRange, setTrendRange] = useState<
        [Dayjs | null, Dayjs | null] | null
    >(null);

    const rows = participant?.monthlyFinance || [];

    const getMonthDate = (value?: string | null) => {
        const raw = String(value || "").trim();
        if (!raw) return null;

        const yearMonth = raw.match(/^(\d{4})-(\d{1,2})$/);

        if (yearMonth) {
            const [, year, month] = yearMonth;
            const parsed = dayjs(
                `${year}-${String(month).padStart(2, "0")}-01`,
            );

            return parsed.isValid() ? parsed.startOf("month") : null;
        }

        const parsed = dayjs(raw);
        return parsed.isValid() ? parsed.startOf("month") : null;
    };

    const datedRows = useMemo(
        () =>
            rows
                .map((item, index) => ({
                    ...item,
                    label: item.monthLabel || item.month,
                    date:
                        getMonthDate(item.month) ||
                        getMonthDate(item.monthLabel),
                    originalIndex: index,
                }))
                .sort((a, b) => {
                    if (a.date && b.date) {
                        return a.date.valueOf() - b.date.valueOf();
                    }

                    return a.originalIndex - b.originalIndex;
                }),
        [rows],
    );

    const availableRange = useMemo(() => {
        const validDates = datedRows
            .map((item) => item.date)
            .filter((date): date is Dayjs => Boolean(date));

        if (validDates.length === 0) return null;

        return [
            validDates[0].startOf("month"),
            validDates[validDates.length - 1].endOf("month"),
        ] as [Dayjs, Dayjs];
    }, [datedRows]);

    useEffect(() => {
        if (!open) return;

        setTrendView("revenue");
        setTrendRange(
            availableRange
                ? [availableRange[0], availableRange[1]]
                : null,
        );
    }, [
        open,
        participant?.id,
        availableRange?.[0]?.valueOf(),
        availableRange?.[1]?.valueOf(),
    ]);

    const filteredRows = useMemo(() => {
        if (!trendRange?.[0] || !trendRange?.[1]) {
            return datedRows;
        }

        const start = trendRange[0].startOf("month");
        const end = trendRange[1].endOf("month");

        return datedRows.filter((item) => {
            if (!item.date) return false;

            const value = item.date.valueOf();
            return value >= start.valueOf() && value <= end.valueOf();
        });
    }, [datedRows, trendRange]);

    const filteredSummary = useMemo(
        () => getMonthlySummary(filteredRows),
        [filteredRows],
    );

    const bestRevenueMonth = useMemo(
        () =>
            filteredRows.reduce<(typeof filteredRows)[number] | null>(
                (best, item) => {
                    if (!best) return item;
                    return item.revenue > best.revenue ? item : best;
                },
                null,
            ),
        [filteredRows],
    );

    const totalProfitLoss = useMemo(
        () =>
            filteredRows.reduce(
                (sum, item) => sum + Number(item.profit || 0),
                0,
            ),
        [filteredRows],
    );

    const profitableMonths = useMemo(
        () =>
            filteredRows.filter(
                (item) => Number(item.profit || 0) > 0,
            ).length,
        [filteredRows],
    );

    const lossMonths = useMemo(
        () =>
            filteredRows.filter(
                (item) => Number(item.profit || 0) < 0,
            ).length,
        [filteredRows],
    );

    const bestProfitMonth = useMemo(
        () =>
            filteredRows.reduce<(typeof filteredRows)[number] | null>(
                (best, item) => {
                    if (!best) return item;
                    return item.profit > best.profit ? item : best;
                },
                null,
            ),
        [filteredRows],
    );

    const currentPeriodRow =
        filteredRows.length > 0
            ? filteredRows[filteredRows.length - 1]
            : null;

    const previousPeriodRow =
        filteredRows.length > 1
            ? filteredRows[filteredRows.length - 2]
            : null;

    const chartOptions = useMemo(() => {
        const isRevenue = trendView === "revenue";

        return {
            chart: {
                type: isRevenue ? "spline" : "column",
                height: 330,
                spacingTop: 28,
                spacingRight: 20,
                spacingBottom: 12,
                spacingLeft: 12,
            },
            title: {
                text: undefined,
            },
            credits: {
                enabled: false,
            },
            legend: {
                enabled: false,
            },
            xAxis: {
                categories: filteredRows.map((item) => item.label),
                tickLength: 0,
                lineColor: "#f0f0f0",
                labels: {
                    style: {
                        fontSize: "11px",
                    },
                },
            },
            yAxis: {
                title: {
                    text: undefined,
                },
                gridLineColor: "#f0f0f0",
                plotLines: isRevenue
                    ? []
                    : [
                        {
                            value: 0,
                            width: 1,
                            color: "#8c8c8c",
                            zIndex: 3,
                        },
                    ],
                labels: {
                    formatter: function (this: any) {
                        const value = Number(this.value || 0);

                        if (Math.abs(value) >= 1_000_000) {
                            return `R${(value / 1_000_000).toFixed(1)}m`;
                        }

                        if (Math.abs(value) >= 1_000) {
                            return `R${(value / 1_000).toFixed(0)}k`;
                        }

                        return `R${value.toFixed(0)}`;
                    },
                },
            },
            tooltip: {
                shared: false,
                formatter: function (this: any) {
                    const value = Number(this.y || 0);

                    return `<b>${this.x}</b><br/>${isRevenue ? "Revenue" : "P/L"
                        }: ${money(value)}`;
                },
            },
            plotOptions: {
                series: {
                    animation: {
                        duration: 450,
                    },
                    marker: {
                        enabled: isRevenue,
                        radius: 4,
                    },
                    dataLabels: {
                        enabled: true,
                        crop: false,
                        overflow: "allow",
                        padding: 3,
                        formatter: function (this: any) {
                            const value = Number(this.y || 0);

                            if (value === 0) return undefined;

                            return money(value);
                        },
                        style: {
                            fontSize: "10px",
                            fontWeight: "600",
                            textOutline: "none",
                        },
                    },
                },
            },
            series: [
                {
                    name: isRevenue ? "Revenue" : "Profit / Loss",
                    type: isRevenue ? "spline" : "column",
                    data: filteredRows.map((item) => {
                        const value = isRevenue
                            ? Number(item.revenue || 0)
                            : Number(item.profit || 0);

                        if (isRevenue) {
                            return value;
                        }

                        return {
                            y: value,
                            color:
                                value > 0
                                    ? "#52c41a"
                                    : value < 0
                                        ? "#ff4d4f"
                                        : "#d9d9d9",
                        };
                    }),
                },
            ],
        };
    }, [filteredRows, trendView]);

    return (
        <Modal
            className="guide-finance-trends-modal"
            title={
                participant
                    ? `${participant.name} Financial Trends`
                    : "Financial Trends"
            }
            open={open}
            onCancel={onClose}
            footer={null}
            width={980}
            centered
            destroyOnClose
        >
            {!participant ? (
                <Empty description="No client selected" />
            ) : rows.length === 0 ? (
                <Empty description="No monthly financial data found for this client" />
            ) : (
                <Space direction="vertical" style={{ width: "100%" }} size={16}>
                    <div
                        data-guide="finance-trend-controls"
                        style={{
                            display: "flex",
                            gap: 12,
                            width: "100%",
                            alignItems: "center",
                            flexWrap: "wrap",
                        }}
                    >
                        <Segmented
                            block
                            value={trendView}
                            onChange={(value) =>
                                setTrendView(
                                    value as "revenue" | "profitLoss",
                                )
                            }
                            options={[
                                {
                                    label: "Revenue",
                                    value: "revenue",
                                },
                                {
                                    label: "P/L",
                                    value: "profitLoss",
                                },
                            ]}
                            style={{ flex: "1 1 320px" }}
                        />

                        <RangePicker
                            picker="month"
                            allowClear
                            value={trendRange}
                            minDate={availableRange?.[0]}
                            maxDate={availableRange?.[1]}
                            onChange={(value) => {
                                if (!value?.[0] || !value?.[1]) {
                                    setTrendRange(null);
                                    return;
                                }

                                setTrendRange([
                                    value[0].startOf("month"),
                                    value[1].endOf("month"),
                                ]);
                            }}
                            style={{ flex: "1 1 320px" }}
                        />
                    </div>

                    {filteredRows.length === 0 ? (
                        <Empty description="No finance data in the selected period" />
                    ) : (
                        <>
                            {trendView === "revenue" ? (
                                <Row
                                    data-guide="finance-trend-metrics"
                                    gutter={[12, 12]}
                                    align="stretch"
                                >
                                    <Col xs={24} sm={12} lg={6}>
                                        <MotionCard.Metric
                                            icon={<DollarOutlined />}
                                            iconBg="rgba(22, 119, 255, 0.12)"
                                            title={
                                                currentPeriodRow
                                                    ? `Latest (${currentPeriodRow.label})`
                                                    : "Latest"
                                            }
                                            value={money(
                                                filteredSummary.currentMonthRevenue,
                                            )}
                                        />
                                    </Col>

                                    <Col xs={24} sm={12} lg={6}>
                                        <MotionCard.Metric
                                            icon={<DollarOutlined />}
                                            iconBg="rgba(19, 194, 194, 0.12)"
                                            title={
                                                previousPeriodRow
                                                    ? `Previous (${previousPeriodRow.label})`
                                                    : "Previous"
                                            }
                                            value={money(
                                                filteredSummary.previousMonthRevenue,
                                            )}
                                        />
                                    </Col>

                                    <Col xs={24} sm={12} lg={6}>
                                        <MotionCard.Metric
                                            icon={
                                                getChangeIcon(
                                                    filteredSummary.momChangePercentage,
                                                ) || <RiseOutlined />
                                            }
                                            iconBg={
                                                Number(
                                                    filteredSummary.momChangePercentage ||
                                                    0,
                                                ) >= 0
                                                    ? "rgba(82, 196, 26, 0.12)"
                                                    : "rgba(255, 77, 79, 0.12)"
                                            }
                                            title="Month-on-Month"
                                            value={percentage(
                                                filteredSummary.momChangePercentage,
                                            )}
                                        />
                                    </Col>

                                    <Col xs={24} sm={12} lg={6}>
                                        <MotionCard.Metric
                                            icon={<BarChartOutlined />}
                                            iconBg="rgba(114, 46, 209, 0.12)"
                                            title={
                                                bestRevenueMonth
                                                    ? `Best (${bestRevenueMonth.label})`
                                                    : "Best Month"
                                            }
                                            value={money(
                                                bestRevenueMonth?.revenue ?? null,
                                            )}
                                        />
                                    </Col>
                                </Row>
                            ) : (
                                <Row
                                    data-guide="finance-trend-metrics"
                                    gutter={[12, 12]}
                                    align="stretch"
                                >
                                    <Col xs={24} sm={12} lg={6}>
                                        <MotionCard.Metric
                                            icon={<DollarOutlined />}
                                            iconBg={
                                                totalProfitLoss >= 0
                                                    ? "rgba(82, 196, 26, 0.12)"
                                                    : "rgba(255, 77, 79, 0.12)"
                                            }
                                            title="Total P/L"
                                            value={
                                                <Text
                                                    strong
                                                    style={{
                                                        color:
                                                            totalProfitLoss >= 0
                                                                ? "#389e0d"
                                                                : "#cf1322",
                                                    }}
                                                >
                                                    {money(totalProfitLoss)}
                                                </Text>
                                            }
                                        />
                                    </Col>

                                    <Col xs={24} sm={12} lg={6}>
                                        <MotionCard.Metric
                                            icon={<ArrowUpOutlined />}
                                            iconBg="rgba(82, 196, 26, 0.12)"
                                            title="Profitable Months"
                                            value={profitableMonths}
                                        />
                                    </Col>

                                    <Col xs={24} sm={12} lg={6}>
                                        <MotionCard.Metric
                                            icon={<ArrowDownOutlined />}
                                            iconBg="rgba(255, 77, 79, 0.12)"
                                            title="Loss Months"
                                            value={lossMonths}
                                        />
                                    </Col>

                                    <Col xs={24} sm={12} lg={6}>
                                        <MotionCard.Metric
                                            icon={<BarChartOutlined />}
                                            iconBg={
                                                Number(
                                                    bestProfitMonth?.profit || 0,
                                                ) >= 0
                                                    ? "rgba(82, 196, 26, 0.12)"
                                                    : "rgba(255, 77, 79, 0.12)"
                                            }
                                            title={
                                                bestProfitMonth
                                                    ? `Best P/L (${bestProfitMonth.label})`
                                                    : "Best P/L"
                                            }
                                            value={money(
                                                bestProfitMonth?.profit ?? null,
                                            )}
                                        />
                                    </Col>
                                </Row>
                            )}

                            <div data-guide="finance-trend-chart">
                                <Card
                                    size="small"
                                    title={
                                        trendView === "revenue"
                                            ? "Monthly Revenue"
                                            : "Monthly Profit / Loss"
                                    }
                                    styles={{
                                        body: {
                                            padding: "8px 8px 4px",
                                            overflow: "hidden",
                                        },
                                    }}
                                >
                                    <HighchartsChart
                                        options={chartOptions as any}
                                        containerProps={{
                                            style: {
                                                width: "100%",
                                                minHeight: 330,
                                            },
                                        }}
                                    />
                                </Card>
                            </div>
                        </>
                    )}
                </Space>
            )}
        </Modal>
    );
};

const MetricValueSkeleton = ({
    width = 82,
}: {
    width?: number;
}) => (
    <div
        style={{
            width: "100%",
            maxWidth: width,
            minWidth: 0,
            overflow: "hidden",
        }}
    >
        <Skeleton.Input
            active
            size="small"
            block
            style={{
                width: "100%",
                maxWidth: "100%",
                minWidth: 0,
                height: 24,
            }}
        />
    </div>
);

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
    const [unsupportedAccountsOpen, setUnsupportedAccountsOpen] = useState(false);
    const [unmatchedAccountsOpen, setUnmatchedAccountsOpen] = useState(false);

    const [unsupportedSmeFilter, setUnsupportedSmeFilter] = useState("");
    const [unsupportedCoordinatorFilter, setUnsupportedCoordinatorFilter] =
        useState<string | undefined>();

    const [unmatchedSmeFilter, setUnmatchedSmeFilter] = useState("");
    const [unmatchedCoordinatorFilter, setUnmatchedCoordinatorFilter] =
        useState<string | undefined>();

    const [statsLoading, setStatsLoading] = useState(false);
    const [metricsReady, setMetricsReady] = useState(false);
    const [authError, setAuthError] = useState<string | null>(null);

    const currentUserEmail = normalizeEmail(auth.currentUser?.email || user?.email);
    const currentUserRole = String(user?.role || "").trim().toLowerCase();
    const isOperations = currentUserRole === "operations" || currentUserRole === "hod";
    const isCoordinator = currentUserRole === "coordinator";

    const guideRegistration = useMemo<PageGuideRegistration>(
        () => ({
            pageId: "participant-finance",
            pageTitle: "Finance",
            guides: [
                {
                    id: "finance-overview",
                    title: "Quick tour",
                    description:
                        "Understand programme finance metrics, finance-user scope, account-link checks and SME financial records.",
                    kind: "page",
                    order: 1,
                    steps: [
                        {
                            element: guideTarget("finance-metrics"),
                            popover: {
                                title: "Programme finance overview",
                                description:
                                    "These metrics use supported SMEs only. Accounts flagged as Not in Any Programme or No Participant Link stay available for investigation but do not affect the programme figures.",
                                side: "bottom",
                                align: "start",
                            },
                        },
                        {
                            element: guideTarget("finance-user-scope"),
                            skipMissingElement: true,
                            popover: {
                                title: "Finance-user scope",
                                description:
                                    "Operations can select All Companies or a finance user. Each user card shows only the active SMEs they manage in the current programme scope, and users with no active SMEs are hidden.",
                                side: "bottom",
                                align: "start",
                            },
                        },
                        {
                            element: guideTarget("finance-filters"),
                            popover: {
                                title: "Search and manage accounts",
                                description:
                                    "Search the current finance list, refresh finance data, create a finance client and review programme-link exceptions from one filter bar.",
                                side: "bottom",
                                align: "start",
                            },
                        },
                        {
                            element: guideTarget("finance-link-exceptions"),
                            skipMissingElement: true,
                            popover: {
                                title: "Programme-link checks",
                                description:
                                    "Not in Any Programme identifies matched SMEs without an accepted programme application. No Participant Link identifies finance accounts that could not be matched to a Lepharo Smart Incubation SME by email. Operations see all exception accounts; coordinators see only accounts linked to their own Qx finance email.",
                                side: "bottom",
                                align: "center",
                            },
                        },
                        {
                            element: guideTarget("finance-table"),
                            popover: {
                                title: "SME finance records",
                                description:
                                    "Review current and previous revenue, month-on-month movement, available finance documents and programme-link status. Supported SMEs are listed first when flagged accounts are present.",
                                side: "top",
                                align: "start",
                            },
                        },
                        {
                            element: guideTarget("finance-client-actions"),
                            skipMissingElement: true,
                            popover: {
                                title: "Finance actions",
                                description:
                                    "Open uploaded documents, inspect financial trends, download financials and open the linked Qx company workspace when access is available.",
                                side: "left",
                                align: "center",
                            },
                        },
                    ],
                },
                {
                    id: "finance-trends",
                    title: "Review financial trends",
                    description:
                        "Open an SME trend view and analyse revenue or profit and loss over a selected period.",
                    kind: "task",
                    order: 2,
                    steps: [
                        {
                            element: guideTarget("finance-trend-action"),
                            waitForElement: 1500,
                            advanceOnClick: true,
                            skipMissingElement: true,
                            popover: {
                                title: "Open financial trends",
                                description:
                                    "Select Trend on an SME row to open its monthly financial analysis.",
                                side: "left",
                                align: "center",
                                showButtons: ["close"],
                            },
                        },
                        {
                            element: ".guide-finance-trends-modal",
                            waitForElement: 5000,
                            skipMissingElement: true,
                            popover: {
                                title: "Financial trends",
                                description:
                                    "This workspace analyses the selected SME using its available monthly finance history.",
                                side: "left",
                                align: "start",
                            },
                        },
                        {
                            element: guideTarget("finance-trend-controls"),
                            waitForElement: 5000,
                            skipMissingElement: true,
                            popover: {
                                title: "Choose the analysis",
                                description:
                                    "Switch between Revenue and P/L, then choose the month range you want to analyse. Both the metrics and chart follow this range.",
                                side: "bottom",
                                align: "start",
                            },
                        },
                        {
                            element: guideTarget("finance-trend-metrics"),
                            waitForElement: 5000,
                            skipMissingElement: true,
                            popover: {
                                title: "Period summary",
                                description:
                                    "These metrics summarise the selected period. Revenue shows latest, previous, month-on-month and best month; P/L shows total result, profitable months, loss months and best P/L month.",
                                side: "bottom",
                                align: "start",
                            },
                        },
                        {
                            element: guideTarget("finance-trend-chart"),
                            waitForElement: 5000,
                            skipMissingElement: true,
                            popover: {
                                title: "Monthly trend",
                                description:
                                    "Revenue is shown as a spline. P/L uses green for profits and red for losses, with zero-value labels hidden so the meaningful figures remain clear.",
                                side: "top",
                                align: "start",
                            },
                        },
                    ],
                },
            ],
        }),
        [],
    );

    usePageGuides(guideRegistration);

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

    const fetchAllParticipants = async () => {
        const snap = await getDocs(collection(db, "participants"));

        return snap.docs.map((item) => ({
            id: item.id,
            ...item.data(),
        })) as FirestoreParticipant[];
    };

    const fetchAllApplications = async () => {
        const snap = await getDocs(collection(db, "applications"));

        return snap.docs.map((item) => ({
            id: item.id,
            ...item.data(),
        })) as FirestoreApplication[];
    };

    const fetchAllPlatformUsers = async () => {
        const snap = await getDocs(collection(db, "users"));

        return snap.docs.map((item) => ({
            id: item.id,
            ...item.data(),
        })) as PlatformUser[];
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
            const [allParticipants, allApplications, platformUsers, res] =
                await Promise.all([
                    fetchAllParticipants(),
                    fetchAllApplications(),
                    fetchAllPlatformUsers(),
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

            // Ignore placeholder/demo finance users.
            const hiddenExampleMembers = serverMembers.filter((member) =>
                isExampleFinanceEmail(member.email),
            );

            const hiddenExampleCompanyIds = new Set(
                hiddenExampleMembers.flatMap((member) =>
                    (member.companies || []).map((company) => String(company.id)),
                ),
            );

            const platformUsersByEmail = new Map(
                platformUsers
                    .map((platformUser) => [
                        normalizeEmail(platformUser.email),
                        platformUser,
                    ] as const)
                    .filter(([email]) => Boolean(email)),
            );

            const visibleMembers = serverMembers
                .filter((member) => !isExampleFinanceEmail(member.email))
                .map((member) => {
                    const memberEmail = normalizeEmail(member.email);
                    const platformUser = memberEmail
                        ? platformUsersByEmail.get(memberEmail)
                        : undefined;

                    return {
                        ...member,
                        // users.name is the platform display-name source.
                        // If the email is not found in users, show the email.
                        name:
                            String(platformUser?.name || "").trim() ||
                            member.email ||
                            "Unknown user",
                    };
                });

            // Remove companies linked to hidden @example.com finance users,
            // plus internal/demo company accounts that should not be shown.
            const scopedCompanies = companies.filter((company: any) => {
                const companyId = String(company.id);
                const companyEmail = getCompanyEmail(company);

                return (
                    !hiddenExampleCompanyIds.has(companyId) &&
                    !isExcludedScopedCompanyEmail(companyEmail)
                );
            });

            setMembers(visibleMembers);

            const acceptedApplications = allApplications.filter(
                isAcceptedApplication,
            );

            const classifiedCompanies = scopedCompanies.map((company: any) => {
                const identity = {
                    name: getCompanyName(company),
                    email: getCompanyEmail(company),
                };

                const companyEmail = normalizeEmail(identity.email);

                // Programme membership comes from accepted applications.
                // participants.programId is intentionally never used.
                const matchedParticipant = findMatchingParticipant(identity, allParticipants);
                const participantEmail = normalizeEmail(matchedParticipant?.email);
                const directApplications = companyEmail
                    ? acceptedApplications.filter(
                        (application) =>
                            getApplicationEmail(application) === companyEmail,
                    )
                    : [];
                const matchingApplications = directApplications.length > 0
                    ? directApplications
                    : matchedParticipant
                        ? acceptedApplications.filter((application) =>
                            application.participantId === matchedParticipant.id ||
                            (!!participantEmail && getApplicationEmail(application) === participantEmail),
                        )
                        : [];

                const applicationProgramIds = new Set(
                    matchingApplications
                        .map((application) =>
                            String(application.programId || "").trim(),
                        )
                        .filter(Boolean),
                );

                let programmeMatchStatus: ProgrammeMatchStatus;

                if (applicationProgramIds.size > 0) {
                    if (
                        !activeProgramId ||
                        applicationProgramIds.has(activeProgramId)
                    ) {
                        programmeMatchStatus = "supported";
                    } else {
                        programmeMatchStatus = "other-program";
                    }
                } else if (matchedParticipant) {
                    programmeMatchStatus = "unassigned";
                } else {
                    programmeMatchStatus = "unmatched";
                }

                return {
                    company,
                    programmeMatchStatus,
                };
            });

            const visibleClassifiedCompanies = activeProgramId
                ? classifiedCompanies.filter(
                    ({ programmeMatchStatus }) =>
                        programmeMatchStatus !== "other-program",
                )
                : classifiedCompanies;

            const initialClients: Participant[] = visibleClassifiedCompanies.map(
                ({ company, programmeMatchStatus }) => ({
                    id: String(company.id),
                    name: getCompanyName(company),
                    email: getCompanyEmail(company),
                    isSupportedProgram: programmeMatchStatus === "supported",
                    programmeMatchStatus,
                    revenue: null,
                    expenses: null,
                    currentMonthRevenue: null,
                    previousMonthRevenue: null,
                    momChangePercentage: null,
                    monthlyFinance: [],
                    documents: [],
                    loadingStats: true,
                }),
            );

            setClients(initialClients);

            if (visibleClassifiedCompanies.length === 0) {
                message.info(
                    activeProgramId
                        ? "No finance clients found for the active programme."
                        : "No managed finance clients found.",
                );
            }

            setLoading(false);

            await runInBatches(
                visibleClassifiedCompanies.map(({ company }) => company),
                5,
                async (company) => {
                    await fetchStatsForCompany(company);
                },
            );

            setStatsLoading(false);
            setMetricsReady(true);
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
            setMetricsReady(true);
        }
    };

    useEffect(() => {
        if (connected) {
            fetchClientsAndStats();
        }
    }, [connected, activeProgramId]);

    const currentUserFinanceMembers = useMemo(() => {
        if (!currentUserEmail) return [];

        return members.filter(
            (member) => normalizeEmail(member.email) === currentUserEmail,
        );
    }, [members, currentUserEmail]);

    const currentUserLinkedCompanyIds = useMemo(() => {
        const ids = new Set<string>();

        currentUserFinanceMembers.forEach((member) => {
            (member.companies || []).forEach((company) => {
                ids.add(String(company.id));
            });
        });

        return ids;
    }, [currentUserFinanceMembers]);

    // Coordinators only work with Qx companies linked to their own finance
    // member email. Operations keep the full finance population.
    const roleScopedClients = useMemo(() => {
        if (!isCoordinator) return clients;

        return clients.filter((client) =>
            currentUserLinkedCompanyIds.has(String(client.id)),
        );
    }, [clients, isCoordinator, currentUserLinkedCompanyIds]);

    const unsupportedAccounts = useMemo(
        () =>
            roleScopedClients.filter(
                (client) => client.programmeMatchStatus === "unassigned",
            ),
        [roleScopedClients],
    );

    const unmatchedAccounts = useMemo(
        () =>
            roleScopedClients.filter(
                (client) => client.programmeMatchStatus === "unmatched",
            ),
        [roleScopedClients],
    );

    const activeClients = useMemo(
        () =>
            roleScopedClients.filter(
                (client) => client.programmeMatchStatus === "supported",
            ),
        [roleScopedClients],
    );

    const activeClientIds = useMemo(
        () => new Set(activeClients.map((client) => String(client.id))),
        [activeClients],
    );

    // Keep every visible finance user in the Operations selector. The number
    // shown on each card is only the active SME count for the current scope.
    const financeMembersWithActiveCounts = useMemo(
        () =>
            members.map((member) => {
                const activeCompanyIds = new Set(
                    (member.companies || [])
                        .map((company) => String(company.id))
                        .filter((companyId) => activeClientIds.has(companyId)),
                );

                return {
                    member,
                    activeCompanyIds,
                    activeCount: activeCompanyIds.size,
                };
            }),
        [members, activeClientIds],
    );

    const visibleFinanceMembers = useMemo(
        () =>
            financeMembersWithActiveCounts.map(({ member }) => member),
        [financeMembersWithActiveCounts],
    );

    const selectedMember = useMemo(() => {
        if (selectedMemberId === "all") return null;

        return (
            visibleFinanceMembers.find(
                (member) => member.id === selectedMemberId,
            ) || null
        );
    }, [visibleFinanceMembers, selectedMemberId]);

    useEffect(() => {
        if (
            selectedMemberId !== "all" &&
            !visibleFinanceMembers.some(
                (member) => member.id === selectedMemberId,
            )
        ) {
            setSelectedMemberId("all");
        }
    }, [selectedMemberId, visibleFinanceMembers]);

    const memberScopedClients = useMemo(() => {
        // Coordinators do not get the Operations finance-user selector; their
        // table is already scoped to every Qx company linked to their email.
        if (isCoordinator) return roleScopedClients;

        if (!selectedMember) return roleScopedClients;

        const activeEntry = financeMembersWithActiveCounts.find(
            ({ member }) => member.id === selectedMember.id,
        );

        if (!activeEntry) return [];

        // Selecting a finance user from the Operations card row filters to the
        // exact active SME count displayed on that card.
        return roleScopedClients.filter(
            (client) =>
                client.programmeMatchStatus === "supported" &&
                activeEntry.activeCompanyIds.has(String(client.id)),
        );
    }, [
        financeMembersWithActiveCounts,
        isCoordinator,
        roleScopedClients,
        selectedMember,
    ]);

    const scopedUnsupportedAccounts = unsupportedAccounts;
    const scopedUnmatchedAccounts = unmatchedAccounts;

    const canSeeFinanceExceptions = isOperations || isCoordinator;

    const canOpenClient = (client: Participant) =>
        currentUserLinkedCompanyIds.has(String(client.id));

    const getLinkedFinanceUsers = (clientId: string) =>
        members.filter((member) =>
            (member.companies || []).some(
                (company) => String(company.id) === String(clientId),
            ),
        );

    const getFinanceUserLabel = (member: FinanceMember) => {
        const email = String(member.email || "").trim();
        const name = String(member.name || "").trim();

        if (name && email && normalizeEmail(name) !== normalizeEmail(email)) {
            return `${name} (${email})`;
        }

        return email || name || "Unknown user";
    };

    const buildCoordinatorOptions = (accounts: Participant[]) => {
        const accountIds = new Set(accounts.map((client) => String(client.id)));
        const byEmail = new Map<string, { label: string; value: string }>();

        members.forEach((member) => {
            const memberEmail = normalizeEmail(member.email);
            if (!memberEmail) return;

            const hasLinkedAccount = (member.companies || []).some((company) =>
                accountIds.has(String(company.id)),
            );

            if (!hasLinkedAccount) return;

            byEmail.set(memberEmail, {
                label: getFinanceUserLabel(member),
                value: memberEmail,
            });
        });

        return Array.from(byEmail.values()).sort((a, b) =>
            a.label.localeCompare(b.label, undefined, {
                sensitivity: "base",
            }),
        );
    };

    const unsupportedCoordinatorOptions = useMemo(
        () => buildCoordinatorOptions(scopedUnsupportedAccounts),
        [scopedUnsupportedAccounts, members],
    );

    const unmatchedCoordinatorOptions = useMemo(
        () => buildCoordinatorOptions(scopedUnmatchedAccounts),
        [scopedUnmatchedAccounts, members],
    );

    const filteredUnsupportedAccounts = useMemo(() => {
        const term = unsupportedSmeFilter.trim().toLowerCase();

        return scopedUnsupportedAccounts.filter((client) => {
            const matchesSme =
                !term ||
                client.name.toLowerCase().includes(term) ||
                normalizeEmail(client.email).includes(term);

            const matchesCoordinator =
                !unsupportedCoordinatorFilter ||
                getLinkedFinanceUsers(client.id).some(
                    (member) =>
                        normalizeEmail(member.email) ===
                        unsupportedCoordinatorFilter,
                );

            return matchesSme && matchesCoordinator;
        });
    }, [
        scopedUnsupportedAccounts,
        unsupportedSmeFilter,
        unsupportedCoordinatorFilter,
        members,
    ]);

    const filteredUnmatchedAccounts = useMemo(() => {
        const term = unmatchedSmeFilter.trim().toLowerCase();

        return scopedUnmatchedAccounts.filter((client) => {
            const matchesSme =
                !term ||
                client.name.toLowerCase().includes(term) ||
                normalizeEmail(client.email).includes(term);

            const matchesCoordinator =
                !unmatchedCoordinatorFilter ||
                getLinkedFinanceUsers(client.id).some(
                    (member) =>
                        normalizeEmail(member.email) ===
                        unmatchedCoordinatorFilter,
                );

            return matchesSme && matchesCoordinator;
        });
    }, [
        scopedUnmatchedAccounts,
        unmatchedSmeFilter,
        unmatchedCoordinatorFilter,
        members,
    ]);

    const filteredClients = useMemo(() => {
        const term = search.trim().toLowerCase();

        const rows = term
            ? memberScopedClients.filter((client) => {
                return (
                    client.name.toLowerCase().includes(term) ||
                    String(client.email || "")
                        .toLowerCase()
                        .includes(term)
                );
            })
            : [...memberScopedClients];

        const hasSupportedAccounts = rows.some(
            (client) => client.programmeMatchStatus === "supported",
        );

        const hasFlaggedAccounts = rows.some(
            (client) =>
                client.programmeMatchStatus === "unassigned" ||
                client.programmeMatchStatus === "unmatched",
        );

        return [...rows].sort((a, b) => {
            if (hasSupportedAccounts && hasFlaggedAccounts) {
                const aSupported = a.programmeMatchStatus === "supported";
                const bSupported = b.programmeMatchStatus === "supported";

                if (aSupported !== bSupported) {
                    return aSupported ? -1 : 1;
                }
            }

            return a.name.localeCompare(b.name, undefined, {
                sensitivity: "base",
            });
        });
    }, [memberScopedClients, search]);

    const totals = useMemo(() => {
        const revenue = activeClients.reduce(
            (sum, item) => sum + Number(item.revenue || 0),
            0,
        );

        const documents = activeClients.reduce(
            (sum, item) => sum + Number(item.documents?.length || 0),
            0,
        );

        const currentMonthRevenue = activeClients.reduce(
            (sum, item) => sum + Number(item.currentMonthRevenue || 0),
            0,
        );

        const growingClients = activeClients.filter(
            (item) => Number(item.momChangePercentage || 0) > 0,
        ).length;

        return {
            clients: activeClients.length,
            revenue,
            currentMonthRevenue,
            growingClients,
            documents,
        };
    }, [activeClients]);

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
                    <Space direction="vertical" size={2}>
                        <Space size={6} wrap>
                            <Text strong>{record.name}</Text>
                            {record.programmeMatchStatus === "unassigned" && (
                                <Tag color="red">Not in Any Programme</Tag>
                            )}

                            {record.programmeMatchStatus === "unmatched" && (
                                <Tag color="orange">No Participant Link</Tag>
                            )}
                        </Space>
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
                    <Skeleton.Input
                        active
                        size="small"
                        style={{ width: 96, height: 20 }}
                    />
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
                    <Skeleton.Input
                        active
                        size="small"
                        style={{ width: 96, height: 20 }}
                    />
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
                    <Skeleton.Input
                        active
                        size="small"
                        style={{ width: 96, height: 20 }}
                    />
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
            title: "Documents",
            dataIndex: "documents",
            key: "documents",
            render: (_: any, record: Participant) =>
                record.loadingStats ? (
                    <Skeleton.Input
                        active
                        size="small"
                        style={{ width: 96, height: 20 }}
                    />
                ) : (
                    <Tag color="blue">{record.documents.length}</Tag>
                ),
        },
        {
            title: "Actions",
            key: "actions",
            render: (_: any, record: Participant) => (
                <Space data-guide="finance-client-actions">
                    <Button icon={<EyeOutlined />} onClick={() => openDocuments(record)}>
                        Documents
                    </Button>

                    <Button
                        data-guide="finance-trend-action"
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
                data-guide="finance-metrics"
                gutter={[16, 16]}
                style={{ marginBottom: 20 }}
                align="stretch"
            >
                <Col xs={24} sm={12} md={8} xl={5}>
                    <MotionCard.Metric
                        icon={<TeamOutlined />}
                        iconBg="rgba(22, 119, 255, 0.12)"
                        title="Active SMEs"
                        value={
                            metricsReady ? (
                                <CountUp
                                    key={`clients-${totals.clients}`}
                                    end={Number(totals.clients || 0)}
                                    duration={0.8}
                                    separator=","
                                />
                            ) : (
                                <MetricValueSkeleton width={68} />
                            )
                        }
                    />
                </Col>

                <Col xs={24} sm={12} md={8} xl={5}>
                    <MotionCard.Metric
                        icon={<DollarOutlined />}
                        iconBg="rgba(82, 196, 26, 0.12)"
                        title="Total Revenue"
                        value={
                            metricsReady ? (
                                <CountUp
                                    key={`revenue-${totals.revenue}`}
                                    end={Number(totals.revenue || 0)}
                                    duration={0.8}
                                    formattingFn={(value) => money(value)}
                                />
                            ) : (
                                <MetricValueSkeleton width={92} />
                            )
                        }
                    />
                </Col>

                <Col xs={24} sm={12} md={8} xl={5}>
                    <MotionCard.Metric
                        icon={<DollarOutlined />}
                        iconBg="rgba(19, 194, 194, 0.12)"
                        title="Current Month Revenue"
                        value={
                            metricsReady ? (
                                <CountUp
                                    key={`current-${totals.currentMonthRevenue}`}
                                    end={Number(totals.currentMonthRevenue || 0)}
                                    duration={0.8}
                                    formattingFn={(value) => money(value)}
                                />
                            ) : (
                                <MetricValueSkeleton width={92} />
                            )
                        }
                    />
                </Col>

                <Col xs={24} sm={12} md={8} xl={4}>
                    <MotionCard.Metric
                        icon={<RiseOutlined />}
                        iconBg="rgba(114, 46, 209, 0.12)"
                        title="Growing SMEs"
                        value={
                            metricsReady ? (
                                <CountUp
                                    key={`growing-${totals.growingClients}`}
                                    end={Number(totals.growingClients || 0)}
                                    duration={0.8}
                                    separator=","
                                />
                            ) : (
                                <MetricValueSkeleton width={68} />
                            )
                        }
                    />
                </Col>

                <Col xs={24} sm={12} md={8} xl={5}>
                    <MotionCard.Metric
                        icon={<FileTextOutlined />}
                        iconBg="rgba(47, 84, 235, 0.12)"
                        title="Financial Documents"
                        value={
                            metricsReady ? (
                                <CountUp
                                    key={`documents-${totals.documents}`}
                                    end={Number(totals.documents || 0)}
                                    duration={0.8}
                                    separator=","
                                />
                            ) : (
                                <MetricValueSkeleton width={68} />
                            )
                        }
                    />
                </Col>
            </Row>

            {isOperations && members.length > 0 && (
                <MotionCard
                    style={{ borderRadius: 18, marginBottom: 16 }}
                    bodyStyle={{ padding: 10 }}
                >
                    <div
                        data-guide="finance-user-scope"
                        style={{
                            display: "grid",
                            gridTemplateColumns: `repeat(${visibleFinanceMembers.length + 1}, minmax(170px, 1fr))`,
                            gap: 8,
                            width: "100%",
                            overflowX: "auto",
                        }}
                    >
                        <Card
                            onClick={() => setSelectedMemberId("all")}
                            onMouseEnter={(event) => {
                                event.currentTarget.style.borderColor = "#1677ff";
                                event.currentTarget.style.boxShadow = "none";
                            }}
                            onMouseLeave={(event) => {
                                event.currentTarget.style.borderColor =
                                    selectedMemberId === "all"
                                        ? "#1677ff"
                                        : "#f0f0f0";
                                event.currentTarget.style.boxShadow = "none";
                            }}
                            styles={{
                                body: {
                                    padding: "6px 9px",
                                },
                            }}
                            style={{
                                borderRadius: 12,
                                cursor: "pointer",
                                minHeight: 54,
                                boxShadow: "none",
                                transition: "border-color 0.18s ease",
                                border:
                                    selectedMemberId === "all"
                                        ? "1px solid #1677ff"
                                        : "1px solid #f0f0f0",
                                background:
                                    selectedMemberId === "all"
                                        ? "#f0f7ff"
                                        : "#fff",
                            }}
                        >
                            <Space align="center" size={8}>
                                <Avatar size={30} icon={<TeamOutlined />} />

                                <div style={{ minWidth: 0 }}>
                                    <Text strong style={{ display: "block", lineHeight: 1.15 }}>
                                        All Companies
                                    </Text>
                                    <Text type="secondary" style={{ fontSize: 11 }}>
                                        {activeClients.length} active SMEs
                                    </Text>
                                </div>
                            </Space>
                        </Card>

                        {financeMembersWithActiveCounts.map(({ member, activeCount }) => {
                            const active = selectedMemberId === member.id;
                            const selectable = activeCount > 0;

                            return (
                                <Card
                                    key={member.id}
                                    onClick={
                                        selectable
                                            ? () => setSelectedMemberId(member.id)
                                            : undefined
                                    }
                                    onMouseEnter={(event) => {
                                        if (!selectable) return;
                                        event.currentTarget.style.borderColor =
                                            "#1677ff";
                                        event.currentTarget.style.boxShadow =
                                            "none";
                                    }}
                                    onMouseLeave={(event) => {
                                        if (!selectable) return;
                                        event.currentTarget.style.borderColor =
                                            active ? "#1677ff" : "#f0f0f0";
                                        event.currentTarget.style.boxShadow =
                                            "none";
                                    }}
                                    styles={{
                                        body: {
                                            padding: "6px 9px",
                                        },
                                    }}
                                    style={{
                                        borderRadius: 12,
                                        cursor: selectable ? "pointer" : "default",
                                        opacity: selectable ? 1 : 0.62,
                                        minHeight: 54,
                                        boxShadow: "none",
                                        transition: "border-color 0.18s ease",
                                        border: active
                                            ? "1px solid #1677ff"
                                            : "1px solid #f0f0f0",
                                        background: active ? "#f0f7ff" : "#fff",
                                    }}
                                >
                                    <Space
                                        align="center"
                                        size={8}
                                        style={{ width: "100%", minWidth: 0 }}
                                    >
                                        <Avatar size={30} icon={<UserOutlined />}>
                                            {member.name?.charAt(0)?.toUpperCase()}
                                        </Avatar>

                                        <div style={{ minWidth: 0, flex: 1 }}>
                                            <Text
                                                strong
                                                ellipsis
                                                style={{
                                                    display: "block",
                                                    maxWidth: "100%",
                                                    lineHeight: 1.15,
                                                }}
                                            >
                                                {member.name || "Unknown user"}
                                            </Text>

                                            <Text
                                                type="secondary"
                                                ellipsis
                                                style={{
                                                    display: "block",
                                                    maxWidth: "100%",
                                                    fontSize: 11,
                                                    lineHeight: 1.15,
                                                }}
                                            >
                                                {activeCount} active SME
                                                {activeCount === 1 ? "" : "s"}
                                            </Text>
                                        </div>
                                    </Space>
                                </Card>
                            );
                        })}
                    </div>
                </MotionCard>
            )}

            <MotionCard
                style={{ borderRadius: 18 }}
                filterBar={
                    <Row
                        data-guide="finance-filters"
                        gutter={[10, 10]}
                        align="middle"
                        style={{ width: "100%" }}
                    >
                        <Col
                            xs={24}
                            md={canSeeFinanceExceptions ? 12 : 8}
                            xl={canSeeFinanceExceptions ? 6 : 8}
                        >
                            <Input
                                allowClear
                                prefix={<SearchOutlined />}
                                placeholder="Search by client or email"
                                value={search}
                                onChange={(event) => setSearch(event.target.value)}
                                style={{ width: "100%" }}
                            />
                        </Col>

                        {canSeeFinanceExceptions && (
                            <Col
                                xs={24}
                                xl={10}
                                data-guide="finance-link-exceptions"
                            >
                                <Row gutter={[10, 10]}>
                                    <Col xs={24} sm={12}>
                                        <Button
                                            block
                                            icon={<TeamOutlined />}
                                            onClick={() =>
                                                setUnsupportedAccountsOpen(true)
                                            }
                                            disabled={!connected}
                                        >
                                            Not in Any Programme (
                                            {scopedUnsupportedAccounts.length})
                                        </Button>
                                    </Col>

                                    <Col xs={24} sm={12}>
                                        <Button
                                            block
                                            icon={<UserOutlined />}
                                            onClick={() =>
                                                setUnmatchedAccountsOpen(true)
                                            }
                                            disabled={!connected}
                                        >
                                            No Participant Link (
                                            {scopedUnmatchedAccounts.length})
                                        </Button>
                                    </Col>
                                </Row>
                            </Col>
                        )}

                        <Col
                            xs={24}
                            sm={12}
                            md={canSeeFinanceExceptions ? 12 : 8}
                            xl={canSeeFinanceExceptions ? 4 : 8}
                        >
                            <Button
                                block
                                icon={<ReloadOutlined />}
                                onClick={fetchClientsAndStats}
                                disabled={!connected}
                            >
                                Refresh
                            </Button>
                        </Col>

                        <Col
                            xs={24}
                            sm={12}
                            md={canSeeFinanceExceptions ? 12 : 8}
                            xl={canSeeFinanceExceptions ? 4 : 8}
                        >
                            <Button
                                block
                                icon={<PlusOutlined />}
                                onClick={() => setCreateOpen(true)}
                                disabled={!connected}
                            >
                                New Client
                            </Button>
                        </Col>
                    </Row>
                }>

                {loading ? (
                    <Space
                        direction="vertical"
                        size={12}
                        style={{ width: "100%", marginTop: 16 }}
                    >
                        {Array.from({ length: 5 }).map((_, index) => (
                            <Skeleton
                                key={index}
                                active
                                avatar
                                title={{ width: "28%" }}
                                paragraph={{ rows: 1, width: ["72%"] }}
                            />
                        ))}
                    </Space>
                ) : filteredClients.length === 0 ? (
                    <Empty
                        description={
                            connected
                                ? "No finance clients found."
                                : "Finance workspace is not connected."
                        }
                    />
                ) : (
                    <div data-guide="finance-table" style={{ marginTop: 24 }}>
                        <Table
                            rowKey="id"
                            columns={tableColumns}
                            dataSource={filteredClients}
                            pagination={{
                                pageSize: 8,
                                position: ["bottomCenter"],
                                showSizeChanger: false,
                            }}
                            scroll={{ x: true }}
                        />
                    </div>
                )}
            </MotionCard>

            <Modal
                title="Not in Any Programme"
                open={unsupportedAccountsOpen}
                onCancel={() => {
                    setUnsupportedAccountsOpen(false);
                    setUnsupportedSmeFilter("");
                    setUnsupportedCoordinatorFilter(undefined);
                }}
                footer={null}
                width={760}
                centered
                destroyOnClose
            >
                <Alert
                    type="info"
                    showIcon
                    style={{ marginBottom: 16 }}
                    message="These accounts match participants, but no accepted application with a programme assignment was found for their finance email or matched participant."
                />

                <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
                    <Col xs={24} md={12}>
                        <Input
                            allowClear
                            prefix={<SearchOutlined />}
                            placeholder="Filter by SME"
                            value={unsupportedSmeFilter}
                            onChange={(event) =>
                                setUnsupportedSmeFilter(event.target.value)
                            }
                        />
                    </Col>

                    <Col xs={24} md={12}>
                        <Select
                            allowClear
                            showSearch
                            optionFilterProp="label"
                            placeholder="All coordinators"
                            value={unsupportedCoordinatorFilter}
                            onChange={setUnsupportedCoordinatorFilter}
                            options={unsupportedCoordinatorOptions}
                            style={{ width: "100%" }}
                        />
                    </Col>
                </Row>

                <List
                    dataSource={filteredUnsupportedAccounts}
                    locale={{
                        emptyText: "No accounts match the selected filters.",
                    }}
                    pagination={
                        filteredUnsupportedAccounts.length > 5
                            ? {
                                pageSize: 5,
                                position: "bottom",
                                align: "center",
                                showSizeChanger: false,
                            }
                            : false
                    }
                    renderItem={(client) => {
                        const linkedUsers = getLinkedFinanceUsers(client.id);

                        return (
                            <List.Item>
                                <List.Item.Meta
                                    avatar={
                                        <Avatar>
                                            {client.name.charAt(0).toUpperCase()}
                                        </Avatar>
                                    }
                                    title={<Text strong>{client.name}</Text>}
                                    description={
                                        <Space direction="vertical" size={2}>
                                            <Text type="secondary">
                                                {client.email || "No email"}
                                            </Text>
                                            <Text
                                                type="secondary"
                                                style={{ fontSize: 12 }}
                                            >
                                                Finance user:{" "}
                                                {linkedUsers.length > 0
                                                    ? linkedUsers
                                                        .map(getFinanceUserLabel)
                                                        .join(", ")
                                                    : "Not linked"}
                                            </Text>
                                        </Space>
                                    }
                                />

                                <Tag color="red">Not in Any Programme</Tag>
                            </List.Item>
                        );
                    }}
                />
            </Modal>

            <Modal
                title="No Participant Link"
                open={unmatchedAccountsOpen}
                onCancel={() => {
                    setUnmatchedAccountsOpen(false);
                    setUnmatchedSmeFilter("");
                    setUnmatchedCoordinatorFilter(undefined);
                }}
                footer={null}
                width={760}
                centered
                destroyOnClose
            >
                <Alert
                    type="warning"
                    showIcon
                    style={{ marginBottom: 16 }}
                    message="These finance accounts could not be matched to a Lepharo Smart Incubation SME by email or a unique beneficiary name."
                />

                <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
                    <Col xs={24} md={12}>
                        <Input
                            allowClear
                            prefix={<SearchOutlined />}
                            placeholder="Filter by SME"
                            value={unmatchedSmeFilter}
                            onChange={(event) =>
                                setUnmatchedSmeFilter(event.target.value)
                            }
                        />
                    </Col>

                    <Col xs={24} md={12}>
                        <Select
                            allowClear
                            showSearch
                            optionFilterProp="label"
                            placeholder="All coordinators"
                            value={unmatchedCoordinatorFilter}
                            onChange={setUnmatchedCoordinatorFilter}
                            options={unmatchedCoordinatorOptions}
                            style={{ width: "100%" }}
                        />
                    </Col>
                </Row>

                <List
                    dataSource={filteredUnmatchedAccounts}
                    locale={{
                        emptyText: "No accounts match the selected filters.",
                    }}
                    pagination={
                        filteredUnmatchedAccounts.length > 5
                            ? {
                                pageSize: 5,
                                position: "bottom",
                                align: "center",
                                showSizeChanger: false,
                            }
                            : false
                    }
                    renderItem={(client) => {
                        const linkedUsers = getLinkedFinanceUsers(client.id);

                        return (
                            <List.Item>
                                <List.Item.Meta
                                    avatar={
                                        <Avatar>
                                            {client.name.charAt(0).toUpperCase()}
                                        </Avatar>
                                    }
                                    title={<Text strong>{client.name}</Text>}
                                    description={
                                        <Space direction="vertical" size={2}>
                                            <Text type="secondary">
                                                {client.email || "No email"}
                                            </Text>
                                            <Text
                                                type="secondary"
                                                style={{ fontSize: 12 }}
                                            >
                                                Finance user:{" "}
                                                {linkedUsers.length > 0
                                                    ? linkedUsers
                                                        .map(getFinanceUserLabel)
                                                        .join(", ")
                                                    : "Not linked"}
                                            </Text>
                                        </Space>
                                    }
                                />

                                <Tag color="orange">
                                    No Participant Link
                                </Tag>
                            </List.Item>
                        );
                    }}
                />
            </Modal>

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
