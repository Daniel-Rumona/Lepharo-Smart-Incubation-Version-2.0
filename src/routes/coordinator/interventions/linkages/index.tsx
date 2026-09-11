import React, { useEffect, useState } from "react";
import {
    Card,
    Row,
    Col,
    Input,
    Select,
    DatePicker,
    Table,
    Button,
    Form,
    Upload,
    message,
    Tabs,
    Space,
    Typography,
    Modal,
    TabsProps,
    Spin,
    Alert,
    Segmented,
} from "antd";
import {
    SearchOutlined,
    FileOutlined,
    PlusOutlined,
    EditOutlined,
    BarChartOutlined,
    TableOutlined,
    ProjectOutlined,
    DollarOutlined,
    CalculatorOutlined,
    TeamOutlined,
    UploadOutlined,
    FileTextOutlined,
    DeleteOutlined,
} from "@ant-design/icons";
import { motion } from "framer-motion";
import Highcharts from "highcharts";
import HighchartsReact from "highcharts-react-official";
import { db } from "@/firebase";
import { getDocs, query, collection, where, addDoc, doc, updateDoc } from "firebase/firestore";
import { useFullIdentity } from "@/hooks/src/useFullIdentity";
import { useActiveProgramId } from "@/lib/useActiveProgramId";
import { MotionCard } from "@/components/dashboards/metrics/Header";
import sankey from "highcharts/modules/sankey";
import dependencyWheel from "highcharts/modules/dependency-wheel";

if (typeof sankey === "function") {
    sankey(Highcharts);
}
if (typeof dependencyWheel === "function") {
    dependencyWheel(Highcharts);
}

const { Option } = Select;
const { RangePicker } = DatePicker;
const { TextArea } = Input;

type LinkageType = "funding" | "facilitation";
type LinkageStatus = "pending" | "completed";

interface Linkage {
    id: string;
    type: LinkageType;
    participant: string;
    funder?: string;
    sector: string;
    value?: number;
    quantity?: number;
    status: LinkageStatus;
    date: string;
    attachments: any[];
    notes: string;
    smeA?: string;
    smeB?: string;
}

interface LinkageFilters {
    status: LinkageStatus | null;
    sector: string | null;
    dateRange: unknown;
    type: LinkageType | null;
}

interface ParticipantOption {
    name: string;
    email?: string;
    sector?: string;
}

const MarketLinkageManager = () => {
    const [smeOptions, setSmeOptions] = useState<string[]>([]);
    const [participantOptions, setParticipantOptions] = useState<ParticipantOption[]>([]);
    const [searchText, setSearchText] = useState("");
    const [filters, setFilters] = useState<LinkageFilters>({
        status: null,
        sector: null,
        dateRange: null,
        type: null,
    });
    const [isDrawerVisible, setIsDrawerVisible] = useState(false);
    const [editingRecord, setEditingRecord] = useState<Linkage | null>(null);
    const [form] = Form.useForm();
    const [activeTab, setActiveTab] = useState("data");
    const { user } = useFullIdentity();
    const { activeProgramId } = useActiveProgramId();

    // Tender upload states
    const [tenderFile, setTenderFile] = useState<any>(null);
    const [isScanning, setIsScanning] = useState(false);
    const [scanResult, setScanResult] = useState<any>(null);

    useEffect(() => {
        const fetchSMEs = async () => {
            const [participantsSnap, applicationsSnap] = await Promise.all([
                getDocs(
                    query(
                        collection(db, "participants"),
                    )
                ),
                getDocs(
                    query(
                        collection(db, "applications"),
                    )
                ),
            ]);

            const acceptedEmails = applicationsSnap.docs
                .filter(
                    (doc) => doc.data().applicationStatus?.toLowerCase() === "accepted"
                )
                .map((doc) => doc.data().email);

            const options = participantsSnap.docs
                .filter((doc) => acceptedEmails.includes(doc.data().email))
                .map((doc) => {
                    const data = doc.data();
                    const name =
                        data.beneficiaryName ||
                        data.businessName ||
                        data.name ||
                        data.email;

                    return {
                        name,
                        email: data.email,
                        sector:
                            data.sector ||
                            data.businessSector ||
                            data.industry ||
                            data.category ||
                            "",
                    };
                })
                .filter((option) => Boolean(option.name));

            const names = options.map((option) => option.name);

            setSmeOptions(names);
            setParticipantOptions(options);
        };

        fetchSMEs();
    }, []);

    const renderTabBar: TabsProps["renderTabBar"] = (props, DefaultTabBar) => (
        <DefaultTabBar {...props} />
    );

    const [linkages, setLinkages] = useState<Linkage[]>([]);
    const sectors = Array.from(
        new Set(linkages.map((linkage) => linkage.sector).filter(Boolean))
    );
    const participants = smeOptions;
    const sectorByParticipant = React.useMemo(() => {
        return participantOptions.reduce<Record<string, string>>((acc, option) => {
            if (option.name && option.sector) acc[option.name] = option.sector;
            return acc;
        }, {});
    }, [participantOptions]);

    const deriveSector = (values: Partial<Linkage>) => {
        if (values.type === "facilitation") {
            const sectors = [values.smeA, values.smeB]
                .map((name) => sectorByParticipant[name || ""])
                .filter(Boolean);
            return Array.from(new Set(sectors)).join(" / ");
        }

        return sectorByParticipant[values.participant || ""] || "";
    };

    const syncDerivedFields = (_changedValues: any, allValues: Partial<Linkage>) => {
        const nextSector = deriveSector(allValues);
        const nextValues: Partial<Linkage> = {};

        if (nextSector !== form.getFieldValue("sector")) {
            nextValues.sector = nextSector;
        }

        if (allValues.type === "facilitation") {
            const participantLabel = [allValues.smeA, allValues.smeB].filter(Boolean).join(" / ");
            if (participantLabel && participantLabel !== form.getFieldValue("participant")) {
                nextValues.participant = participantLabel;
            }
        }

        if (Object.keys(nextValues).length) {
            form.setFieldsValue(nextValues);
        }
    };

    useEffect(() => {
        const fetchLinkages = async () => {

            try {
                const snap = await getDocs(
                    query(collection(db, "linkages"))
                );
                const rows = snap.docs
                    .map((docSnap) => {
                        const data = docSnap.data() as Partial<Linkage> & { programId?: string };
                        return {
                            id: docSnap.id,
                            type: data.type || "funding",
                            participant: data.participant || "",
                            funder: data.funder,
                            sector: data.sector || "",
                            value: data.value,
                            quantity: data.quantity,
                            status: data.status || "pending",
                            date: data.date || new Date().toISOString().split("T")[0],
                            attachments: Array.isArray(data.attachments) ? data.attachments : [],
                            notes: data.notes || "",
                            smeA: data.smeA,
                            smeB: data.smeB,
                            programId: data.programId,
                        } as Linkage & { programId?: string };
                    })
                    .filter((row) => !activeProgramId || !row.programId || row.programId === activeProgramId);

                setLinkages(rows);
            } catch (error) {
                console.error("Error loading linkages:", error);
                message.error("Failed to load linkages");
            }
        };

        fetchLinkages();
    }, [activeProgramId]);

    // Columns for the table
    const columns = [
        {
            title: "Type",
            dataIndex: "type",
            key: "type",
            render: (type: LinkageType) =>
                type === "funding" ? "Funding" : "Facilitation",
            filters: [
                { text: "Funding", value: "funding" },
                { text: "Facilitation", value: "facilitation" },
            ],
            onFilter: (value: string, record: Linkage) => record.type === value,
        },
        {
            title: "Participant",
            dataIndex: "participant",
            key: "participant",
        },
        {
            title: "Funder",
            dataIndex: "funder",
            key: "funder",
            render: (funder: string | undefined, record: Linkage) =>
                record.type === "funding" ? funder : "N/A",
        },
        {
            title: "Sector",
            dataIndex: "sector",
            key: "sector",
            filters: sectors.map((s) => ({ text: s, value: s })),
            onFilter: (value: string, record: Linkage) => record.sector === value,
        },
        {
            title: "Value/Quantity",
            key: "value",
            render: (_: any, record: Linkage) =>
                record.type === "funding"
                    ? `R ${record.value?.toLocaleString()}`
                    : `${record.quantity} connections`,
            sorter: (a: Linkage, b: Linkage) =>
                (a.type === "funding" ? a.value || 0 : a.quantity || 0) -
                (b.type === "funding" ? b.value || 0 : b.quantity || 0),
        },
        {
            title: "Status",
            dataIndex: "status",
            key: "status",
            render: (status: LinkageStatus) => {
                const color = status === "completed" ? "green" : "gold";
                return (
                    <span
                        style={{
                            backgroundColor: color === "green" ? "#f6ffed" : "#fffbe6",
                            color: color === "green" ? "#52c41a" : "#faad14",
                            border: `1px solid ${color === "green" ? "#b7eb8f" : "#ffe58f"}`,
                            borderRadius: 8,
                            padding: "2px 10px",
                            fontWeight: 500,
                        }}
                    >
                        {status.charAt(0).toUpperCase() + status.slice(1)}
                    </span>
                );
            },
            filters: [
                { text: "Pending", value: "pending" },
                { text: "Completed", value: "completed" },
            ],
            onFilter: (value: string, record: Linkage) => record.status === value,
        },
        {
            title: "Actions",
            key: "actions",
            render: (_: any, record: Linkage) => (
                <Space>
                    <Button icon={<EditOutlined />} onClick={() => handleEdit(record)} />
                    <Upload
                        beforeUpload={() => false} // disables actual upload
                        onChange={(info) => handleUpload(record.id, info)}
                        showUploadList={false}
                    >
                        <Button icon={<FileOutlined />} />
                    </Upload>
                </Space>
            ),
        },
    ];

    const handleUpload = (id: string, info: any) => {
        const file = info.file;

        if (!file) return;

        setLinkages((prev) =>
            prev.map((item) =>
                item.id === id
                    ? { ...item, attachments: [...item.attachments, file] }
                    : item
            )
        );

        message.success(`${file.name} attached successfully`);
    };

    const handleEdit = (record: Linkage) => {
        setEditingRecord(record);
        form.setFieldsValue(record);
        setIsDrawerVisible(true);
    };

    const handleSubmit = async (values: any) => {
        try {
            const sector = deriveSector(values) || values.sector || "";
            const participant =
                values.type === "facilitation"
                    ? [values.smeA, values.smeB].filter(Boolean).join(" / ")
                    : values.participant;

            if (editingRecord) {
                const payload = {
                    ...values,
                    participant,
                    sector,
                    programId: activeProgramId || null,
                };

                await updateDoc(doc(db, "linkages", editingRecord.id), payload);
                setLinkages((prev) =>
                    prev.map((item) =>
                        item.id === editingRecord.id ? { ...item, ...payload } : item
                    )
                );
                message.success("Linkage updated successfully");
            } else {
                const payload = {
                    ...values,
                    participant,
                    sector,
                    attachments: [],
                    date: new Date().toISOString().split("T")[0],
                    status: "pending",
                    programId: activeProgramId || null,
                    createdBy: user?.email || null,
                    createdAt: new Date().toISOString(),
                };
                const ref = await addDoc(collection(db, "linkages"), payload);

                setLinkages((prev) => [
                    ...prev,
                    {
                        ...payload,
                        id: ref.id,
                    },
                ]);
                message.success("New linkage added successfully");
            }
            setIsDrawerVisible(false);
        } catch (error) {
            console.error("Failed to save linkage:", error);
            message.error("Failed to save linkage");
        }
    };

    // Tender upload handlers
    const beforeTenderUpload = (file: any) => {
        const isPdf = file.type === "application/pdf";
        if (!isPdf) {
            message.error("You can only upload PDF files!");
            return Upload.LIST_IGNORE;
        }
        return true;
    };

    const handleTenderUpload = (info: any) => {
        const file = info.file;
        if (!file) return;

        setTenderFile(file); // <- set the raw file
        message.success(`${file.name} attached successfully`);
    };

    const scanTender = async () => {
        if (!tenderFile) {
            message.warning("Please upload a tender document first");
            return;
        }

        setIsScanning(true);
        setScanResult(null);

        try {
            const reader = new FileReader();

            reader.onload = async () => {
                const scanPayload = {
                    success: false,
                    summary:
                        "Tender scanning is not connected to a live analysis service yet.",
                    recommendations: [],
                };

                setScanResult(scanPayload);
                message.info(
                    "Tender document attached. Scanning service is not configured."
                );

                // Save to Firestore
                await addDoc(collection(db, "tenderScans"), {
                    fileName: tenderFile.name,
                    fileSize: tenderFile.size,
                    result: scanPayload,
                    scannedBy: user?.email,
                    scannedAt: new Date(),
                });

                setIsScanning(false);
            };

            reader.readAsDataURL(tenderFile.originFileObj || tenderFile);
        } catch (error) {
            console.error("Scan failed:", error);
            message.error("Failed to scan tender document");
            setIsScanning(false);
        }
    };

    const sectorCounts = sectors.map(
        (sector) => linkages.filter((linkage) => linkage.sector === sector).length
    );

    const facilitationConnections = linkages.reduce<
        Array<[string, string, number]>
    >((connections, linkage) => {
        if (linkage.type === "facilitation" && linkage.smeA && linkage.smeB) {
            connections.push([linkage.smeA, linkage.smeB, linkage.quantity || 1]);
        }

        return connections;
    }, []);

    const sectorChartOptions = {
        chart: {
            type: "column",
            backgroundColor: "transparent",
            height: 300,
        },
        title: {
            text: "Linkages by Sector",
        },
        xAxis: {
            categories: sectors,
            crosshair: true,
        },
        yAxis: {
            min: 0,
            title: {
                text: "Number of Linkages",
            },
        },
        colors: ["#1890ff", "#52c41a", "#faad14", "#f5222d", "#722ed1"],
        series: [
            {
                name: "Linkages",
                data: sectorCounts,
                dataLabels: {
                    enabled: true,
                    style: {
                        color: "#000",
                    },
                },
            },
        ],
        plotOptions: {
            column: {
                borderRadius: 12,
                pointPadding: 0.2,
                borderWidth: 0,
            },
        },
        credits: {
            enabled: false,
        },
        tooltip: {
            headerFormat: '<span style="font-size:10px">{point.key}</span><table>',
            pointFormat:
                '<tr><td style="color:{series.color};padding:0">{series.name}: </td>' +
                '<td style="padding:0"><b>{point.y}</b></td></tr>',
            footerFormat: "</table>",
            shared: true,
            useHTML: true,
        },
    };

    const statusChartOptions = {
        chart: {
            type: "pie",
            backgroundColor: "transparent",
            height: 300,
        },
        title: {
            text: "Completion Status",
        },
        colors: ["#52c41a", "#faad14"],
        series: [
            {
                name: "Linkages",
                colorByPoint: true,
                data: [
                    {
                        name: "Completed",
                        y: linkages.filter((l) => l.status === "completed").length,
                    },
                    {
                        name: "Pending",
                        y: linkages.filter((l) => l.status === "pending").length,
                    },
                ],
            },
        ],
        plotOptions: {
            pie: {
                allowPointSelect: true,
                cursor: "pointer",
                dataLabels: {
                    enabled: false,
                    format: "<b>{point.name}</b>: {point.percentage:.1f}%",
                },
                showInLegend: true,
            },
        },
        credits: {
            enabled: false,
        },
    };

    const timelineChartOptions = {
        chart: {
            type: "line",
            backgroundColor: "transparent",
            height: 300,
        },
        title: {
            text: "Linkage Timeline",
        },
        xAxis: {
            type: "datetime",
            title: {
                text: "Date",
            },
        },
        yAxis: {
            title: {
                text: "Number of Linkages",
            },
        },
        series: [
            {
                name: "Linkages Created",
                data: linkages
                    .map((l) => ({
                        x: new Date(l.date).getTime(),
                        y: 1,
                    }))
                    .sort((a, b) => a.x - b.x)
                    .reduce((acc, curr) => {
                        if (acc.length === 0) return [curr];
                        const last = acc[acc.length - 1];
                        if (last.x === curr.x) {
                            last.y++;
                        } else {
                            acc.push(curr);
                        }
                        return acc;
                    }, []),
            },
        ],
        plotOptions: {
            line: {
                marker: {
                    radius: 4,
                    lineColor: "#1890ff",
                    lineWidth: 2,
                },
            },
        },
        credits: {
            enabled: false,
        },
    };

    const dependencyOptions = {
        title: {
            text: "SME Linkages (Facilitation)",
        },
        credits: {
            enabled: false,
        },
        accessibility: {
            point: {
                valueDescriptionFormat:
                    "{index}. From {point.from} to {point.to}: {point.weight}.",
            },
        },
        series: [
            {
                keys: ["from", "to", "weight"],
                data: facilitationConnections,
                type: "dependencywheel",
                name: "SME Link Flow",
                dataLabels: {
                    color: "#333",
                    style: { textOutline: "none" },
                    textPath: { enabled: true },
                    distance: 10,
                },
                size: "95%",
            },
        ],
    };

    const fundingLinkages = linkages.filter((l) => l.type === "funding");
    const facilitationLinkages = linkages.filter((l) => l.type === "facilitation");
    const totalFundingValue = fundingLinkages.reduce((sum, l) => sum + (l.value || 0), 0);

    const metricCards = [
        {
            title: "Total Linkages",
            value: linkages.length,
            icon: <ProjectOutlined style={{ color: "#1677ff" }} />,
            iconBg: "rgba(22,119,255,.12)",
            subtitle: "Funding and facilitation",
        },
        {
            title: "Funding Linkages",
            value: fundingLinkages.length,
            icon: <DollarOutlined style={{ color: "#722ed1" }} />,
            iconBg: "rgba(114,46,209,.12)",
            subtitle: `R ${totalFundingValue.toLocaleString()}`,
        },
        {
            title: "Facilitation Linkages",
            value: facilitationLinkages.length,
            icon: <TeamOutlined style={{ color: "#13c2c2" }} />,
            iconBg: "rgba(19,194,194,.14)",
            subtitle: "SME connections",
        },
        {
            title: "Total Monetary Value",
            value: `R ${totalFundingValue.toLocaleString()}`,
            icon: <CalculatorOutlined style={{ color: "#52c41a" }} />,
            iconBg: "rgba(82,196,26,.14)",
            subtitle: "Funding records only",
        },
    ];

    return (
        <div style={{ padding: 24, minHeight: "100vh" }}>
            {/* 1. At-a-Glance Metrics - Updated for both types */}
            <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
                {metricCards.map((metric) => (
                    <Col xs={24} sm={12} md={8} lg={6} key={metric.title}>
                        <MotionCard style={{ height: "100%" }}>
                            <MotionCard.Metric
                                title={metric.title}
                                value={metric.value}
                                subtitle={metric.subtitle}
                                icon={metric.icon}
                                iconBg={metric.iconBg}
                            />
                        </MotionCard>
                    </Col>
                ))}
            </Row>

            {/* Tab Navigation */}
            <Tabs
                activeKey={activeTab}
                onChange={setActiveTab}
                centered
                style={{ marginBottom: 24, textAlign: "center" }}
                renderTabBar={renderTabBar}
                items={[
                    {
                        label: (
                            <span>
                                <TableOutlined /> Data Management
                            </span>
                        ),
                        key: "data",
                        children: (
                            <>
                                {/* 3. Editable Table */}
                                <MotionCard
                                    filterBar={
                                        <Row gutter={[16, 16]} align="middle">
                                            <Col xs={24} lg={7}>
                                                <Input
                                                    placeholder="Search by participant, sector, or funder"
                                                    prefix={<SearchOutlined />}
                                                    value={searchText}
                                                    onChange={(e) => setSearchText(e.target.value)}
                                                    allowClear
                                                />
                                            </Col>
                                            <Col xs={24} sm={12} lg={3}>
                                                <Select
                                                    placeholder="Type"
                                                    style={{ width: "100%" }}
                                                    allowClear
                                                    value={filters.type || undefined}
                                                    onChange={(value) =>
                                                        setFilters({ ...filters, type: value || null })
                                                    }
                                                >
                                                    <Option value="funding">Funding</Option>
                                                    <Option value="facilitation">Facilitation</Option>
                                                </Select>
                                            </Col>
                                            <Col xs={24} sm={12} lg={3}>
                                                <Select
                                                    placeholder="Status"
                                                    style={{ width: "100%" }}
                                                    allowClear
                                                    value={filters.status || undefined}
                                                    onChange={(value) =>
                                                        setFilters({ ...filters, status: value || null })
                                                    }
                                                >
                                                    <Option value="pending">Pending</Option>
                                                    <Option value="completed">Completed</Option>
                                                </Select>
                                            </Col>
                                            <Col xs={24} sm={12} lg={3}>
                                                <Select
                                                    placeholder="Sector"
                                                    style={{ width: "100%" }}
                                                    allowClear
                                                    value={filters.sector || undefined}
                                                    onChange={(value) =>
                                                        setFilters({ ...filters, sector: value || null })
                                                    }
                                                >
                                                    {sectors.map((sector) => (
                                                        <Option key={sector} value={sector}>
                                                            {sector}
                                                        </Option>
                                                    ))}
                                                </Select>
                                            </Col>
                                            <Col xs={24} sm={12} lg={4}>
                                                <RangePicker
                                                    style={{ width: "100%" }}
                                                    onChange={(dates) =>
                                                        setFilters({ ...filters, dateRange: dates })
                                                    }
                                                />
                                            </Col>
                                            <Col xs={24} lg={4}>
                                                <Button
                                                    type="primary"
                                                    block
                                                    icon={<PlusOutlined />}
                                                    onClick={() => {
                                                        setEditingRecord(null);
                                                        form.resetFields();
                                                        setIsDrawerVisible(true);
                                                    }}
                                                >
                                                    Add New Linkage
                                                </Button>
                                            </Col>
                                        </Row>
                                    }
                                >
                                    <Table
                                        columns={columns}
                                        dataSource={linkages.filter((linkage) => {
                                            // Apply filters
                                            if (filters.type && linkage.type !== filters.type)
                                                return false;
                                            if (filters.status && linkage.status !== filters.status)
                                                return false;
                                            if (filters.sector && linkage.sector !== filters.sector)
                                                return false;
                                            const search = searchText.toLowerCase();
                                            const matchesSearch =
                                                linkage.participant.toLowerCase().includes(search) ||
                                                Boolean(
                                                    linkage.funder?.toLowerCase().includes(search)
                                                ) ||
                                                linkage.sector.toLowerCase().includes(search);

                                            if (searchText && !matchesSearch) {
                                                return false;
                                            }
                                            return true;
                                        })}
                                        rowKey="id"
                                        scroll={{ x: true }}
                                    />
                                </MotionCard>
                            </>
                        ),
                    },
                    {
                        label: (
                            <span>
                                <BarChartOutlined /> Analytics
                            </span>
                        ),
                        key: "analytics",
                        children: (
                            <>
                                {/* 5. Progress Visuals with Highcharts */}
                                <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
                                    <Col xs={24} lg={12}>
                                        <motion.div
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ duration: 0.4 }}
                                        >
                                            <Card
                                                hoverable
                                                style={{
                                                    boxShadow: "0 12px 32px rgba(0,0,0,0.12)",
                                                    transition: "all 0.3s ease",
                                                    borderRadius: 8,
                                                    border: "1px solid #d6e4ff",
                                                }}
                                            >
                                                <HighchartsReact
                                                    highcharts={Highcharts}
                                                    options={sectorChartOptions}
                                                />
                                            </Card>
                                        </motion.div>
                                    </Col>
                                    <Col xs={24} lg={12}>
                                        <motion.div
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ duration: 0.4 }}
                                        >
                                            <Card
                                                hoverable
                                                style={{
                                                    boxShadow: "0 12px 32px rgba(0,0,0,0.12)",
                                                    transition: "all 0.3s ease",
                                                    borderRadius: 8,
                                                    border: "1px solid #d6e4ff",
                                                }}
                                            >
                                                <HighchartsReact
                                                    highcharts={Highcharts}
                                                    options={statusChartOptions}
                                                />
                                            </Card>
                                        </motion.div>
                                    </Col>
                                </Row>
                                <Row gutter={[16, 16]}>
                                    <Col span={12}>
                                        <motion.div
                                            initial={{ opacity: 0, y: 10 }}
                                            animate={{ opacity: 1, y: 0 }}
                                            transition={{ duration: 0.4 }}
                                        >
                                            <Card
                                                hoverable
                                                style={{
                                                    boxShadow: "0 12px 32px rgba(0,0,0,0.12)",
                                                    transition: "all 0.3s ease",
                                                    borderRadius: 8,
                                                    border: "1px solid #d6e4ff",
                                                }}
                                            >
                                                <HighchartsReact
                                                    highcharts={Highcharts}
                                                    options={timelineChartOptions}
                                                />
                                            </Card>
                                        </motion.div>
                                    </Col>
                                    <Col span={12}>
                                        <Card
                                            hoverable
                                            style={{
                                                boxShadow: "0 12px 32px rgba(0,0,0,0.12)",
                                                transition: "all 0.3s ease",
                                                borderRadius: 8,
                                                border: "1px solid #d6e4ff",
                                            }}
                                        >
                                            <HighchartsReact
                                                highcharts={Highcharts}
                                                options={dependencyOptions}
                                            />
                                        </Card>
                                    </Col>
                                </Row>
                            </>
                        ),
                    },
                    {
                        label: (
                            <span>
                                <FileTextOutlined /> Tender Scanner
                            </span>
                        ),
                        key: "tender",
                        children: (
                            <Card
                                title="Tender Document Scanner"
                                style={{
                                    boxShadow: "0 12px 32px rgba(0,0,0,0.12)",
                                    transition: "all 0.3s ease",
                                    borderRadius: 8,
                                    border: "1px solid #d6e4ff",
                                }}
                            >
                                <Row gutter={[16, 16]}>
                                    <Col span={24}>
                                        <Alert
                                            message="Tender Scanning Instructions"
                                            description="Upload a tender document (PDF) to scan for key requirements and get a summary of what's needed to apply."
                                            type="info"
                                            showIcon
                                        />
                                    </Col>
                                    <Col span={24}>
                                        <Card title="Upload Tender Document">
                                            <Upload.Dragger
                                                name="tenderFile"
                                                multiple={false}
                                                accept=".pdf"
                                                beforeUpload={beforeTenderUpload}
                                                onChange={handleTenderUpload}
                                                showUploadList={{
                                                    showRemoveIcon: true,
                                                    removeIcon: <DeleteOutlined />,
                                                }}
                                                maxCount={1}
                                                fileList={
                                                    tenderFile
                                                        ? [
                                                            {
                                                                uid: "1",
                                                                name: tenderFile.name,
                                                                status: "done",
                                                                originFileObj: tenderFile, // <-- this is required for preview/scanning
                                                            },
                                                        ]
                                                        : []
                                                }
                                            >
                                                <p className="ant-upload-drag-icon">
                                                    <UploadOutlined />
                                                </p>
                                                <p className="ant-upload-text">
                                                    Click or drag PDF file to this area to upload
                                                </p>
                                                <p className="ant-upload-hint">
                                                    Support for a single PDF file upload
                                                </p>
                                            </Upload.Dragger>
                                        </Card>
                                    </Col>
                                    <Col span={24}>
                                        <Button
                                            type="primary"
                                            onClick={scanTender}
                                            //   disabled={!tenderFile || isScanning}
                                            loading={isScanning}
                                            icon={<SearchOutlined />}
                                            size="large"
                                            style={{ marginTop: 16 }}
                                        >
                                            {isScanning ? "Scanning..." : "Scan Tender Document"}
                                        </Button>
                                    </Col>
                                    {scanResult && (
                                        <Col span={24}>
                                            <Card title="Scan Results" style={{ marginTop: 16 }}>
                                                <Spin spinning={isScanning}>
                                                    <div style={{ whiteSpace: "pre-line" }}>
                                                        <h3>Summary</h3>
                                                        <p>{scanResult.summary}</p>

                                                        <h3 style={{ marginTop: 16 }}>Recommendations</h3>
                                                        <ul>
                                                            {scanResult.recommendations.map(
                                                                (rec: string, index: number) => (
                                                                    <li key={index}>{rec}</li>
                                                                )
                                                            )}
                                                        </ul>
                                                    </div>
                                                </Spin>
                                            </Card>
                                        </Col>
                                    )}
                                </Row>
                            </Card>
                        ),
                    },
                ]}
            />

            <Modal
                title={editingRecord ? "Edit Linkage" : "Add New Linkage"}
                width={560}
                open={isDrawerVisible}
                onCancel={() => setIsDrawerVisible(false)}
                footer={null}
                destroyOnClose
            >
                <Form
                    form={form}
                    layout="vertical"
                    onFinish={handleSubmit}
                    onValuesChange={syncDerivedFields}
                    initialValues={{
                        status: "pending",
                        type: "funding",
                    }}
                >
                    <Form.Item
                        name="type"
                        label="Linkage Type"
                        rules={[{ required: true }]}
                    >
                        <Segmented
                            block
                            options={[
                                { label: "Funding", value: "funding" },
                                { label: "Facilitation", value: "facilitation" },
                            ]}
                            style={{ width: "100%" }}
                        />
                    </Form.Item>

                    <Form.Item
                        noStyle
                        shouldUpdate={(prevValues, currentValues) =>
                            prevValues.type !== currentValues.type
                        }
                    >
                        {({ getFieldValue }) =>
                            getFieldValue("type") === "funding" ? (
                                <>
                                    <Form.Item
                                        name="participant"
                                        label="Participant"
                                        rules={[
                                            { required: true, message: "Please select a participant" },
                                        ]}
                                    >
                                        <Select
                                            placeholder="Select participant"
                                            options={participants.map((participant) => ({
                                                label: participant,
                                                value: participant,
                                            }))}
                                            allowClear
                                        />
                                    </Form.Item>

                                    <Form.Item
                                        name="funder"
                                        label="Funder"
                                        rules={[
                                            { required: true, message: "Please enter a funder" },
                                        ]}
                                    >
                                        <Input placeholder="Enter funder name" allowClear />
                                    </Form.Item>
                                </>
                            ) : null
                        }
                    </Form.Item>

                    <Form.Item
                        noStyle
                        shouldUpdate={(prev, curr) => prev.type !== curr.type}
                    >
                        {({ getFieldValue }) =>
                            getFieldValue("type") === "facilitation" && (
                                <Row gutter={16}>
                                    <Col xs={24} md={12}>
                                        <Form.Item
                                            name="smeA"
                                            label="SME A"
                                            rules={[
                                                { required: true, message: "Please select SME A" },
                                            ]}
                                        >
                                            <Select
                                                placeholder="Select SME A"
                                                options={smeOptions.map((name) => ({
                                                    label: name,
                                                    value: name,
                                                }))}
                                                allowClear
                                            />
                                        </Form.Item>
                                    </Col>
                                    <Col xs={24} md={12}>
                                        <Form.Item
                                            name="smeB"
                                            label="SME B"
                                            rules={[
                                                { required: true, message: "Please select SME B" },
                                            ]}
                                        >
                                            <Select
                                                placeholder="Select SME B"
                                                options={smeOptions.map((name) => ({
                                                    label: name,
                                                    value: name,
                                                }))}
                                                allowClear
                                            />
                                        </Form.Item>
                                    </Col>
                                </Row>
                            )
                        }
                    </Form.Item>

                    <Form.Item name="sector" label="Sector">
                        <Input placeholder="Auto-filled from selected participant" disabled />
                    </Form.Item>

                    <Form.Item
                        noStyle
                        shouldUpdate={(prevValues, currentValues) =>
                            prevValues.type !== currentValues.type
                        }
                    >
                        {({ getFieldValue }) =>
                            getFieldValue("type") === "funding" ? (
                                <Form.Item
                                    name="value"
                                    label="Funding Amount (R)"
                                    rules={[
                                        { required: true, message: "Please enter the amount" },
                                    ]}
                                >
                                    <Input type="number" prefix="R" />
                                </Form.Item>
                            ) : (
                                <Form.Item
                                    name="quantity"
                                    label="Number of Connections"
                                    rules={[
                                        { required: true, message: "Please enter the quantity" },
                                    ]}
                                >
                                    <Input type="number" />
                                </Form.Item>
                            )
                        }
                    </Form.Item>

                    <Form.Item name="status" label="Status">
                        <Select>
                            <Option value="pending">Pending</Option>
                            <Option value="completed">Completed</Option>
                        </Select>
                    </Form.Item>
                    <Form.Item name="attachments" label="Attachments">
                        <Upload.Dragger
                            multiple
                            beforeUpload={() => false}
                            fileList={editingRecord?.attachments || []}
                        >
                            <p className="ant-upload-drag-icon">
                                <FileOutlined />
                            </p>
                            <p>Click or drag files to upload</p>
                        </Upload.Dragger>
                    </Form.Item>
                    <Form.Item name="notes" label="Notes/Comments">
                        <TextArea rows={4} />
                    </Form.Item>
                    <Form.Item style={{ marginBottom: 0 }}>
                        <Row gutter={12}>
                            <Col xs={24} sm={12}>
                                <Button block onClick={() => setIsDrawerVisible(false)}>
                                    Cancel
                                </Button>
                            </Col>
                            <Col xs={24} sm={12}>
                                <Button block type="primary" htmlType="submit">
                                    {editingRecord ? "Update" : "Create"} Linkage
                                </Button>
                            </Col>
                        </Row>
                    </Form.Item>
                </Form>
            </Modal>
        </div>
    );
};

export default MarketLinkageManager;
