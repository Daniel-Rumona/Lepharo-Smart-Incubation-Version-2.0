import React, { useEffect, useState } from "react";
import { App, Button, Dropdown, Input, Modal, Select, Space, Table, Tag, Tooltip, Typography, theme } from "antd";
import { DeleteOutlined, EditOutlined, KeyOutlined, MoreOutlined, PlusOutlined, SafetyCertificateOutlined, TeamOutlined, UserAddOutlined, UserOutlined, CheckCircleOutlined, ClockCircleOutlined, StopOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { useFullIdentity } from "@/hooks/useFullIdentity";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useActiveProgramId } from "@/lib/useActiveProgramId";
import { DashboardFilterBar, MotionCard } from "@/components/dashboards/metrics/Header";
import { MobileCardList } from "@/components/shared/MobileCardList";
import "@/components/shared/setup-segmented.css";
import { MetricsGrid, type DashboardMetric } from "@/components/dashboards/metrics/MetricsGrid";
import { EnrollSmeForm, type EnrollSmeFormValues } from "./EnrollSmeForm";
import { EnrollmentDocumentsCell } from "./EnrollmentDocuments";
import { TrainingCourseProgressCell, useTrainingCourseProgress } from "./TrainingCourseProgress";
import { AssignTrainingForm, DiscontinueForm } from "./EnrollmentStatusForms";
import { TrainingPeopleDrawer } from "./TrainingPeopleDrawer";
import { deleteSmeCompletely, listAllAttendees } from "./attendeeStorage";
import type { TrainingCompanyProgress } from "./certification";
import { listCompanyProgress, setCompanyOverride } from "./certificationStorage";
import { EligibilityTag } from "./EligibilityTag";

type CertificationFilter = "eligible" | "in_progress" | "certified";

/** Where an SME stands on certification, for the filter: eligible means someone (or the company) awaits a certificate. */
function certificationState(p?: TrainingCompanyProgress): CertificationFilter | null {
    if (!p?.certificationEnabled) return null;
    if (p.awardTo === "company") {
        const status = p.companyEligibility?.status;
        return status === "certified" ? "certified" : status === "eligible" ? "eligible" : "in_progress";
    }
    if (p.eligiblePeople > 0) return "eligible";
    if (p.attendingPeople > 0 && p.certifiedPeople >= p.attendingPeople) return "certified";
    return "in_progress";
}
import {
    type Training,
    type TrainingAttendee,
    type TrainingEnrollment,
    assignTraining,
    createEnrollment,
    createPortalLogin,
    updateEnrollment,
    discontinueEnrollment,
    listAllEnrollments,
    listTrainings,
} from "./trainingStorage";

const STATUS_META = {
    unassigned: { color: "gold", label: "Awaiting training" },
    enrolled: { color: "green", label: "Enrolled" },
    discontinued: { color: "red", label: "Discontinued" },
} as const;

export default function EnrollSme() {
    const { token } = theme.useToken();
    const { user } = useFullIdentity();
    const { message, modal } = App.useApp();
    const isMobile = useIsMobile();
    const [trainings, setTrainings] = useState<Training[]>([]);
    const [enrollments, setEnrollments] = useState<TrainingEnrollment[]>([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    // The shared programme selector is the sole training filter.
    const { activeProgramId } = useActiveProgramId();
    const selectedTrainingId = trainings.some((t) => t.id === activeProgramId)
        ? activeProgramId
        : undefined;
    const [addOpen, setAddOpen] = useState(false);
    const [assigning, setAssigning] = useState<TrainingEnrollment | null>(null);
    const [discontinuing, setDiscontinuing] = useState<TrainingEnrollment | null>(null);
    const [creatingLogin, setCreatingLogin] = useState<string>();
    const [editingSme, setEditingSme] = useState<TrainingEnrollment | null>(null);
    const [attendees, setAttendees] = useState<TrainingAttendee[]>([]);
    const [peopleOf, setPeopleOf] = useState<TrainingEnrollment | null>(null);
    const [progress, setProgress] = useState<Record<string, TrainingCompanyProgress>>({});
    const [certFilter, setCertFilter] = useState<CertificationFilter>();
    const [overridingCompany, setOverridingCompany] = useState<TrainingEnrollment | null>(null);
    const [overrideReason, setOverrideReason] = useState("");
    const [overrideBusy, setOverrideBusy] = useState(false);

    const saveCompanyOverride = async (r: TrainingEnrollment, reason: string | null) => {
        setOverrideBusy(true);
        try {
            await setCompanyOverride(
                r.id,
                reason ? { by: user?.uid || "", byName: String(user?.name || user?.email || "Staff"), reason, at: new Date().toISOString() } : null
            );
            message.success(reason ? `${r.companyName || r.name} marked eligible. Eligibility is being re-evaluated.` : "Override removed.");
            setOverridingCompany(null);
            await load();
        } catch (e) {
            message.error(e instanceof Error ? e.message : "Could not save the override.");
        } finally {
            setOverrideBusy(false);
        }
    };

    const submitEdit = async (values: EnrollSmeFormValues) => {
        if (!editingSme) return;
        try {
            await updateEnrollment(editingSme, values);
            message.success("SME updated.");
            setEditingSme(null);
            await load();
        } catch (e) {
            message.error(e instanceof Error ? e.message : "Could not update this SME.");
        }
    };

    const createLogin = async (r: TrainingEnrollment) => {
        setCreatingLogin(r.id);
        try {
            const problem = await createPortalLogin(r, trainings.find((t) => t.id === r.trainingId));
            if (problem) message.warning(problem, 6);
            else {
                message.success(`Portal login created and emailed to ${r.email}.`);
                await load();
            }
        } finally {
            setCreatingLogin(undefined);
        }
    };

    const load = async () => {
        setLoading(true);
        try {
            // People are additive: if they can't be read the page still works.
            const [t, e, a, p] = await Promise.all([
                listTrainings(),
                listAllEnrollments(),
                listAllAttendees().catch(() => [] as TrainingAttendee[]),
                listCompanyProgress().catch(() => ({}) as Record<string, TrainingCompanyProgress>),
            ]);
            setTrainings(t);
            setEnrollments(e);
            setAttendees(a);
            setProgress(p);
        } catch (err) {
            message.error(err instanceof Error ? err.message : "Could not load enrollments.");
        } finally {
            setLoading(false);
        }
    };
    useEffect(() => {
        void load();
    }, []);

    const courseProgress = useTrainingCourseProgress(enrollments, trainings);

    const submitAdd = async (values: EnrollSmeFormValues) => {
        try {
            const result = await createEnrollment({ ...values, owner: user?.uid || "" });
            message.success(
                values.trainingId ? (result.accountError ? "SME enrolled." : "SME enrolled and portal login emailed.") : "SME added."
            );
            if (result.accountError) message.warning(result.accountError, 6);
            setAddOpen(false);
            await load();
        } catch (e) {
            message.error(e instanceof Error ? e.message : "Could not add this SME.");
        }
    };

    const submitAssign = async (trainingId: string, categories: string[]) => {
        if (!assigning) return;
        try {
            const result = await assignTraining(assigning.id, trainingId, categories);
            message.success(result.accountError ? "SME enrolled." : "SME enrolled and portal login emailed.");
            if (result.accountError) message.warning(result.accountError, 6);
            setAssigning(null);
            await load();
        } catch (e) {
            message.error(e instanceof Error ? e.message : "Could not enroll this SME.");
        }
    };

    const submitDiscontinue = async (reason: string) => {
        if (!discontinuing) return;
        try {
            await discontinueEnrollment(discontinuing.id, reason);
            message.success("Marked as discontinued.");
            setDiscontinuing(null);
            await load();
        } catch (e) {
            message.error(e instanceof Error ? e.message : "Could not update this SME.");
        }
    };

    /** Deletes an SME and everything that belongs to it, after spelling out what goes. */
    const confirmDelete = (r: TrainingEnrollment) => {
        const people = attendees.filter((a) => a.enrollmentId === r.id);
        const logins = new Set([r.userId, ...people.map((p) => p.userId)].filter(Boolean)).size;
        modal.confirm({
            title: `Delete ${r.name}${r.companyName ? ` (${r.companyName})` : ""} completely?`,
            content: (
                <Space direction="vertical" size={8}>
                    <Typography.Text>
                        This deletes the SME record
                        {people.length ? `, its ${people.length} ${people.length === 1 ? "person" : "people"}` : ""}
                        {logins ? `, ${logins === 1 ? "its training login" : `its ${logins} training logins`}` : ""}, invitations, progress and uploaded documents.
                        It can't be undone.
                    </Typography.Text>
                    <Typography.Text type="secondary">
                        Meant for a record added by mistake or twice. An SME with attendance or certificates on record can't be deleted: discontinue it instead.
                    </Typography.Text>
                </Space>
            ),
            okText: "Delete completely",
            okButtonProps: { danger: true },
            cancelText: "Keep",
            onOk: async () => {
                try {
                    await deleteSmeCompletely(r.id);
                    message.success(`${r.name} deleted.`);
                    await load();
                } catch (e) {
                    message.error(e instanceof Error ? e.message : "Could not delete this SME.", 8);
                }
            },
        });
    };

    // The same email on more than one SME record usually means it was added twice.
    const emailCounts = new Map<string, number>();
    enrollments.forEach((e) => {
        const email = (e.email || "").trim().toLowerCase();
        if (email) emailCounts.set(email, (emailCounts.get(email) || 0) + 1);
    });
    const duplicatesOf = (e: TrainingEnrollment) => Math.max((emailCounts.get((e.email || "").trim().toLowerCase()) || 0) - 1, 0);

    const filtered = enrollments.filter(
        (e) =>
            (!selectedTrainingId || e.trainingId === selectedTrainingId) &&
            (!certFilter || certificationState(progress[e.id]) === certFilter) &&
            (e.name + " " + e.companyName).toLowerCase().includes(search.trim().toLowerCase())
    );

    const enrolledCount = enrollments.filter((e) => e.status === "enrolled").length;
    const unassignedCount = enrollments.filter((e) => e.status === "unassigned").length;
    const discontinuedCount = enrollments.filter((e) => e.status === "discontinued").length;
    const count = (value: number) => (loading ? "…" : value);

    const metrics: DashboardMetric[] = [
        {
            key: "total",
            title: "Total SMEs",
            value: count(enrollments.length),
            subtitle: "Added so far",
            icon: <TeamOutlined style={{ color: token.colorPrimary }} />,
            important: true,
        },
        {
            key: "enrolled",
            title: "Enrolled",
            value: count(enrolledCount),
            subtitle: "Currently in a training",
            icon: <CheckCircleOutlined style={{ color: token.colorSuccess }} />,
            important: true,
        },
        {
            key: "unassigned",
            title: "Awaiting training",
            value: count(unassignedCount),
            subtitle: "Added, not yet enrolled",
            icon: <ClockCircleOutlined style={{ color: token.colorWarning }} />,
        },
        {
            key: "discontinued",
            title: "Discontinued",
            value: count(discontinuedCount),
            subtitle: "Stopped attending",
            icon: <StopOutlined style={{ color: token.colorError }} />,
        },
        {
            key: "eligible",
            title: "Awaiting certificate",
            value: count(enrollments.filter((e) => certificationState(progress[e.id]) === "eligible").length),
            subtitle: "SMEs with someone eligible, not yet certified",
            icon: <SafetyCertificateOutlined style={{ color: token.colorWarning }} />,
            onClick: () => setCertFilter("eligible"),
        },
    ];

    const peopleLabel = (r: TrainingEnrollment) => {
        const people = attendees.filter((a) => a.enrollmentId === r.id && a.status === "active");
        const employees = people.filter((a) => a.kind === "employee").length;
        return !people.length
            ? "Set up"
            : `${people.filter((a) => a.attends).length} attending${employees ? ` · ${employees} employee${employees === 1 ? "" : "s"}` : ""}`;
    };

    /** One line for the phone card; the table shows the full detail. */
    const certificationLabel = (r: TrainingEnrollment) => {
        const p = progress[r.id];
        if (r.status !== "enrolled" && !p) return "—";
        if (!p) return "Not evaluated yet";
        if (!p.certificationEnabled) return "Off";
        if (p.awardTo === "company") {
            const status = p.companyEligibility?.status;
            return status === "certified" ? "Certified" : status === "eligible" ? "Eligible" : "In progress";
        }
        if (p.eligiblePeople || p.certifiedPeople) {
            const parts = [p.eligiblePeople ? `${p.eligiblePeople} eligible` : "", p.certifiedPeople ? `${p.certifiedPeople} certified` : ""];
            return `${parts.filter(Boolean).join(", ")} of ${p.attendingPeople}`;
        }
        return "In progress";
    };

    /** The ⋯ menu. On phones it also carries what the table shows as inline buttons. */
    const moreActions = (r: TrainingEnrollment, phone = true) => {
        const p = progress[r.id];
        const companyStatus = p?.awardTo === "company" ? p.companyEligibility?.status : undefined;
        return [
            ...(r.status === "unassigned" ? [{ key: "enroll", icon: <UserAddOutlined />, label: "Enroll in a training", onClick: () => setAssigning(r) }] : []),
            ...(r.status === "enrolled" ? [{ key: "discontinue", icon: <StopOutlined />, label: "Discontinue", onClick: () => setDiscontinuing(r) }] : []),
            ...(phone && !r.userId && r.status === "enrolled" && r.email
                ? [{ key: "login", icon: <KeyOutlined />, label: "Create portal login", onClick: () => void createLogin(r) }]
                : []),
            ...(phone && p?.certificationEnabled && p.awardTo === "company"
                ? r.certificationOverride
                    ? [{ key: "undo", icon: <SafetyCertificateOutlined />, label: "Undo eligible override", onClick: () => void saveCompanyOverride(r, null) }]
                    : companyStatus !== "eligible" && companyStatus !== "certified"
                      ? [{ key: "eligible", icon: <SafetyCertificateOutlined />, label: "Mark eligible", onClick: () => { setOverrideReason(""); setOverridingCompany(r); } }]
                      : []
                : []),
            { type: "divider" as const },
            { key: "delete", icon: <DeleteOutlined />, label: "Delete completely", danger: true, onClick: () => confirmDelete(r) },
        ];
    };

    const toolbar = (
        // The shared setup toolbar: one line on wide screens, stacked full-width rows on phones.
        <div className="setup-toolbar">
            <div className="setup-toolbar-search" style={{ maxWidth: isMobile ? undefined : 280 }}>
                <Input.Search placeholder="Search by name or company" value={search} onChange={(e) => setSearch(e.target.value)} allowClear />
            </div>
            <div className="setup-toolbar-search" style={{ maxWidth: isMobile ? undefined : 230 }}>
                <Select
                    placeholder="Certification"
                    allowClear
                    style={{ width: "100%" }}
                    value={certFilter}
                    onChange={setCertFilter}
                    options={[
                        { value: "eligible", label: "Eligible, not yet certified" },
                        { value: "in_progress", label: "Working towards it" },
                        { value: "certified", label: "Certified" },
                    ]}
                />
            </div>
            <div className="setup-toolbar-action" style={{ marginLeft: isMobile ? undefined : "auto" }}>
                <Button type="primary" shape="round" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>
                    Add SME
                </Button>
            </div>
        </div>
    );

    return (
        <div style={{ padding: isMobile ? 12 : 24 }}>
            <MetricsGrid metrics={metrics} />
            <div style={{ height: 16 }} />
            {isMobile ? (
                // Phones drop the wrapping card: the toolbar stands on its own and the cards follow it.
                <>
                    <DashboardFilterBar marginBottom={16} padding={14}>
                        {toolbar}
                    </DashboardFilterBar>
                    <MobileCardList
                        data={filtered}
                        loading={loading}
                        getKey={(r: TrainingEnrollment) => r.id}
                        emptyText="No SMEs"
                        renderCard={(r: TrainingEnrollment) => {
                            const meta = STATUS_META[r.status] || STATUS_META.unassigned;
                            const twins = duplicatesOf(r);
                            return {
                                title: r.name,
                                subtitle: [r.companyName, `added ${dayjs(r.createdAt).format("DD MMM YYYY")}`].filter(Boolean).join(" · "),
                                badge: <Tag color={meta.color}>{meta.label}</Tag>,
                                fields: [
                                    { label: "People", value: peopleLabel(r) },
                                    { label: "Certification", value: certificationLabel(r) },
                                    { label: "Categories", value: r.categories?.join(", ") || "—" },
                                    { label: "Portal login", value: r.userId ? "Active" : r.status === "enrolled" ? "Not created" : "After enrolment" },
                                ],
                                note: twins ? (
                                    <Tag color="orange">
                                        Duplicate? {twins} other record{twins === 1 ? " has" : "s have"} this email
                                    </Tag>
                                ) : r.status === "discontinued" && r.discontinuedReason ? (
                                    <Typography.Text type="secondary">{r.discontinuedReason}</Typography.Text>
                                ) : undefined,
                                actions: [
                                    <Button key="people" icon={<UserOutlined />} onClick={() => setPeopleOf(r)}>
                                        People
                                    </Button>,
                                    <Button key="edit" icon={<EditOutlined />} onClick={() => setEditingSme(r)}>
                                        Edit
                                    </Button>,
                                    <Dropdown key="more" trigger={["click"]} menu={{ items: moreActions(r) }}>
                                        <Button icon={<MoreOutlined />}>More</Button>
                                    </Dropdown>,
                                ],
                            };
                        }}
                    />
                </>
            ) : (
            <MotionCard filterBarProps={{ marginBottom: 16, padding: 14 }} filterBar={toolbar}>
                <Table
                    rowKey="id"
                    dataSource={filtered}
                    // Wide content scrolls sideways inside the card; the actions stay pinned.
                    scroll={{ x: "max-content" }}
                    loading={loading}
                    pagination={{ pageSize: 10, showSizeChanger: false, position: ["bottomCenter"] }}
                    columns={[
                        {
                            title: "SME",
                            key: "sme",
                            render: (_: unknown, r: TrainingEnrollment) => {
                                const twins = duplicatesOf(r);
                                return (
                                    <Space direction="vertical" size={0}>
                                        <Space size={6} wrap>
                                            <Typography.Text strong>{r.name}</Typography.Text>
                                            {!!twins && (
                                                <Tooltip title={`${twins} other SME record${twins === 1 ? " has" : "s have"} the email ${r.email}. If it's the same SME added twice, delete the extra one from ⋯.`}>
                                                    <Tag color="orange">Duplicate?</Tag>
                                                </Tooltip>
                                            )}
                                        </Space>
                                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                            {[r.companyName, `added ${dayjs(r.createdAt).format("DD MMM YYYY")}`].filter(Boolean).join(" · ")}
                                        </Typography.Text>
                                        {!!r.categories?.length && (
                                            <Space size={[4, 4]} wrap style={{ marginTop: 4 }}>
                                                {r.categories.map((category) => (
                                                    <Tag key={category} style={{ marginInlineEnd: 0 }}>
                                                        {category}
                                                    </Tag>
                                                ))}
                                            </Space>
                                        )}
                                    </Space>
                                );
                            },
                        },
                        {
                            title: "Status",
                            key: "status",
                            render: (_: unknown, r: TrainingEnrollment) => {
                                const meta = STATUS_META[r.status] || STATUS_META.unassigned;
                                const tag = <Tag color={meta.color}>{meta.label}</Tag>;
                                return r.status === "discontinued" && r.discontinuedReason ? (
                                    <Tooltip title={r.discontinuedReason}>{tag}</Tooltip>
                                ) : (
                                    tag
                                );
                            },
                        },
                        {
                            title: "People",
                            key: "people",
                            render: (_: unknown, r: TrainingEnrollment) => {
                                const people = attendees.filter((a) => a.enrollmentId === r.id && a.status === "active");
                                const employees = people.filter((a) => a.kind === "employee").length;
                                const label = !people.length
                                    ? "Set up"
                                    : `${people.filter((a) => a.attends).length} attending${employees ? ` · ${employees} employee${employees === 1 ? "" : "s"}` : ""}`;
                                return (
                                    <Tooltip title="The director and the employees this SME sends">
                                        <Button size="small" shape="round" icon={<UserOutlined />} onClick={() => setPeopleOf(r)}>
                                            {label}
                                        </Button>
                                    </Tooltip>
                                );
                            },
                        },
                        {
                            title: "Certification",
                            key: "certification",
                            render: (_: unknown, r: TrainingEnrollment) => {
                                const p = progress[r.id];
                                if (r.status !== "enrolled" && !p) return <Typography.Text type="secondary">—</Typography.Text>;
                                if (!p) return <Typography.Text type="secondary">Not evaluated yet</Typography.Text>;
                                if (!p.certificationEnabled) return <Typography.Text type="secondary">Off for this training</Typography.Text>;
                                if (p.awardTo === "company") {
                                    const status = p.companyEligibility?.status;
                                    return (
                                        <Space size={4} wrap>
                                            <EligibilityTag eligibility={p.companyEligibility} />
                                            {r.certificationOverride ? (
                                                <Tooltip title={`Marked eligible by ${r.certificationOverride.byName}: ${r.certificationOverride.reason}`}>
                                                    <Button size="small" type="link" loading={overrideBusy} onClick={() => void saveCompanyOverride(r, null)}>
                                                        Undo override
                                                    </Button>
                                                </Tooltip>
                                            ) : (
                                                status !== "eligible" && status !== "certified" && (
                                                    <Button size="small" type="link" onClick={() => { setOverrideReason(""); setOverridingCompany(r); }}>
                                                        Mark eligible
                                                    </Button>
                                                )
                                            )}
                                        </Space>
                                    );
                                }
                                return (
                                    <Tooltip title="Per person: open People to see each person's checklist or mark someone eligible">
                                        <Button size="small" type="link" style={{ padding: 0 }} onClick={() => setPeopleOf(r)}>
                                            <Space size={4}>
                                                {!!p.eligiblePeople && <Tag color="gold">{p.eligiblePeople} eligible</Tag>}
                                                {!!p.certifiedPeople && <Tag color="green">{p.certifiedPeople} certified</Tag>}
                                                {!p.eligiblePeople && !p.certifiedPeople && <Tag color="processing">In progress</Tag>}
                                                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                                                    of {p.attendingPeople}
                                                </Typography.Text>
                                            </Space>
                                        </Button>
                                    </Tooltip>
                                );
                            },
                        },
                        {
                            title: "Course progress",
                            key: "courseProgress",
                            render: (_: unknown, r: TrainingEnrollment) => (
                                <TrainingCourseProgressCell
                                    enrollment={r}
                                    training={trainings.find((t) => t.id === r.trainingId)}
                                    state={courseProgress}
                                />
                            ),
                        },
                        {
                            title: "Documents",
                            key: "documents",
                            render: (_: unknown, r: TrainingEnrollment) => (
                                <EnrollmentDocumentsCell enrollment={r} training={trainings.find((t) => t.id === r.trainingId)} />
                            ),
                        },
                        {
                            title: "Portal login",
                            key: "login",
                            render: (_: unknown, r: TrainingEnrollment) =>
                                r.userId ? (
                                    <Tag color="green">Active</Tag>
                                ) : r.status === "enrolled" ? (
                                    <Tooltip title={r.email ? `Creates a training-only login for ${r.email} and emails it` : "Add an email address to create a login"}>
                                        <Button size="small" shape="round" icon={<KeyOutlined />} disabled={!r.email} loading={creatingLogin === r.id} onClick={() => void createLogin(r)}>
                                            Create login
                                        </Button>
                                    </Tooltip>
                                ) : (
                                    <Typography.Text type="secondary">After enrolment</Typography.Text>
                                ),
                        },
                        {
                            // Pinned to the right edge so it never scrolls out of view.
                            title: "",
                            key: "actions",
                            fixed: "right" as const,
                            width: 88,
                            render: (_: unknown, r: TrainingEnrollment) => (
                                <Space size={4}>
                                    <Tooltip title="Edit details and documents">
                                        <Button shape="circle" size="small" icon={<EditOutlined />} onClick={() => setEditingSme(r)} aria-label={`Edit ${r.name}`} />
                                    </Tooltip>
                                    <Dropdown
                                        trigger={["click"]}
                                        menu={{ items: moreActions(r, false) }}
                                    >
                                        <Button shape="circle" size="small" icon={<MoreOutlined />} aria-label={`More actions for ${r.name}`} />
                                    </Dropdown>
                                </Space>
                            ),
                        },
                    ]}
                />
            </MotionCard>
            )}

            <Modal
                wrapClassName="mobile-sheet"
                centered
                title={overridingCompany ? `Mark ${overridingCompany.companyName || overridingCompany.name} eligible` : ""}
                open={!!overridingCompany}
                onCancel={() => setOverridingCompany(null)}
                onOk={() => overridingCompany && void saveCompanyOverride(overridingCompany, overrideReason.trim())}
                okText="Mark eligible"
                okButtonProps={{ disabled: !overrideReason.trim() }}
                confirmLoading={overrideBusy}
                destroyOnClose
            >
                <Typography.Paragraph>
                    The company becomes eligible for its certificate whatever the rules say. Your name and reason are kept with the decision.
                </Typography.Paragraph>
                <Input.TextArea rows={3} placeholder="Why" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} />
            </Modal>

            <TrainingPeopleDrawer
                enrollment={peopleOf}
                training={trainings.find((t) => t.id === peopleOf?.trainingId)}
                onClose={() => setPeopleOf(null)}
                onChanged={() => {
                    void listAllAttendees().then(setAttendees).catch(() => undefined);
                    void listCompanyProgress().then(setProgress).catch(() => undefined);
                }}
            />

            <Modal
                wrapClassName="mobile-sheet"
                centered
                title={editingSme ? `Edit ${editingSme.name}` : "Edit SME"}
                open={!!editingSme}
                onCancel={() => setEditingSme(null)}
                footer={null}
                maskClosable={false}
                destroyOnClose
                width={720}
            >
                {editingSme && (
                    <EnrollSmeForm trainings={trainings} enrollment={editingSme} onSubmit={submitEdit} />
                )}
            </Modal>

            <Modal wrapClassName="mobile-sheet" centered title="Add an SME" open={addOpen} onCancel={() => setAddOpen(false)} footer={null} maskClosable={false} destroyOnClose width={720}>
                <EnrollSmeForm
                    trainings={trainings}
                    defaultTrainingId={selectedTrainingId}
                    trainingRequired={false}
                    onSubmit={submitAdd}
                />
            </Modal>

            <Modal
                wrapClassName="mobile-sheet"
                centered
                title={assigning ? `Enroll ${assigning.name}` : "Enroll"}
                open={!!assigning}
                onCancel={() => setAssigning(null)}
                footer={null}
                maskClosable={false}
                destroyOnClose
                width={560}
            >
                {assigning && <AssignTrainingForm trainings={trainings} onSubmit={submitAssign} />}
            </Modal>

            <Modal
                wrapClassName="mobile-sheet"
                centered
                title={discontinuing ? `Discontinue ${discontinuing.name}` : "Discontinue"}
                open={!!discontinuing}
                onCancel={() => setDiscontinuing(null)}
                footer={null}
                maskClosable={false}
                destroyOnClose
                width={480}
            >
                {discontinuing && (
                    <DiscontinueForm smeName={discontinuing.name} onSubmit={submitDiscontinue} />
                )}
            </Modal>
        </div>
    );
}
