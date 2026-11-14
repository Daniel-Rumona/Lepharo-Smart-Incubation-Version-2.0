import React, { useEffect, useMemo, useState } from "react";
import { App, Badge, Button, Drawer, Dropdown, Empty, Grid, Input, Modal, Pagination, Popover, Segmented, Space, Tag, Tooltip, Typography, theme } from "antd";
import {
    CheckCircleOutlined,
    ClockCircleOutlined,
    DeleteOutlined,
    EditOutlined,
    FileTextOutlined,
    FilterOutlined,
    KeyOutlined,
    LineChartOutlined,
    MailOutlined,
    MoreOutlined,
    PlusOutlined,
    SafetyCertificateOutlined,
    SearchOutlined,
    SortAscendingOutlined,
    StopOutlined,
    TeamOutlined,
    UserAddOutlined,
    UserOutlined,
} from "@ant-design/icons";
import { useFullIdentity } from "@/hooks/useFullIdentity";
import { useActiveProgramId } from "@/lib/useActiveProgramId";
import { DashboardFilterBar, MotionCard } from "@/components/dashboards/metrics/Header";
import { MetricsGrid, type DashboardMetric } from "@/components/dashboards/metrics/MetricsGrid";
import { ChoiceFilter, ContactList, ContactRow, EntityAvatar, FilterPanel, SortSelect, contactActions, type SortOption } from "@/components/workspace";
import { EnrollSmeForm, type EnrollSmeFormValues } from "./EnrollSmeForm";
import { TrainingCourseProgressCell, useTrainingCourseProgress } from "./TrainingCourseProgress";
import { AssignTrainingForm, DiscontinueForm } from "./EnrollmentStatusForms";
import { TrainingPeopleDrawer } from "./TrainingPeopleDrawer";
import { TrainingSmeDocuments, TrainingSmeProfile, companyOf, statusMetaOf } from "./TrainingSmeSections";
import { deleteSmeCompletely, listAllAttendees } from "./attendeeStorage";
import type { TrainingCompanyProgress } from "./certification";
import { listCompanyProgress, setCompanyOverride } from "./certificationStorage";
import { EligibilityTag } from "./EligibilityTag";
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

type CertificationFilter = "eligible" | "in_progress" | "certified";

const CERTIFICATION_LABEL: Record<CertificationFilter, string> = {
    eligible: "Eligible, not yet certified",
    in_progress: "Working towards it",
    certified: "Certified",
};

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

type Sort = "company" | "name" | "newest";
const SORT_OPTIONS: SortOption<Sort>[] = [
    { value: "company", label: "Company A–Z", icon: <SortAscendingOutlined /> },
    { value: "name", label: "Person A–Z", icon: <UserOutlined /> },
    { value: "newest", label: "Newest added", icon: <ClockCircleOutlined /> },
];

type Filters = { search: string; status: string; certification: string; category: string; training: string };
const NO_FILTERS: Filters = { search: "", status: "all", certification: "all", category: "all", training: "all" };
const PAGE_SIZE = 10;

type Section = "profile" | "people" | "certification" | "documents" | "progress";

/**
 * /operations/training/enroll — the Training Academy's SMEs, laid out like the
 * Participants workspace: tiles, a filter bar, the SMEs beside a detail panel
 * (a full-screen drawer on phones). Everything the old table showed per SME
 * (people, certification, course progress, documents, portal login) lives in
 * the detail panel; its actions in the header and the ⋯ menu.
 */
export default function EnrollSme() {
    const { token } = theme.useToken();
    const { user } = useFullIdentity();
    const { message, modal } = App.useApp();
    const isPhone = !Grid.useBreakpoint().md;
    const [trainings, setTrainings] = useState<Training[]>([]);
    const [enrollments, setEnrollments] = useState<TrainingEnrollment[]>([]);
    const [loading, setLoading] = useState(true);
    // The shared programme selector is the training scope; the Filters popover narrows within it.
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
    const [overridingCompany, setOverridingCompany] = useState<TrainingEnrollment | null>(null);
    const [overrideReason, setOverrideReason] = useState("");
    const [overrideBusy, setOverrideBusy] = useState(false);
    const [filters, setFilters] = useState<Filters>(NO_FILTERS);
    const [sort, setSort] = useState<Sort>("company");
    const [page, setPage] = useState(1);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [section, setSection] = useState<Section>("profile");
    const [detailOpen, setDetailOpen] = useState(false);
    const patchFilters = (next: Partial<Filters>) => setFilters((f) => ({ ...f, ...next }));

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

    const trainingById = useMemo(() => new Map(trainings.map((t) => [t.id, t])), [trainings]);
    const inScope = useMemo(
        () => enrollments.filter((e) => !selectedTrainingId || e.trainingId === selectedTrainingId),
        [enrollments, selectedTrainingId]
    );
    const certificationLabelOf = (e: TrainingEnrollment) => {
        const state = certificationState(progress[e.id]);
        return state ? CERTIFICATION_LABEL[state] : "";
    };

    // Only the filters that would narrow this list are offered.
    const choices = useMemo(() => {
        const distinct = (values: string[]) => Array.from(new Set(values.filter(Boolean))).sort();
        const list = [
            { key: "status" as const, label: "Status", allLabel: "Any status", values: distinct(inScope.map((e) => statusMetaOf(e).label)) },
            { key: "certification" as const, label: "Certification", allLabel: "Any certification", values: distinct(inScope.map(certificationLabelOf)) },
            { key: "category" as const, label: "Category", allLabel: "All categories", values: distinct(inScope.flatMap((e) => e.categories || [])) },
            ...(selectedTrainingId ? [] : [{ key: "training" as const, label: "Training", allLabel: "All trainings", values: distinct(inScope.map((e) => trainingById.get(e.trainingId)?.name || "No training yet")) }]),
        ];
        return list.filter((c) => c.values.length > 1 || filters[c.key] !== "all");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [inScope, progress, trainingById, selectedTrainingId, filters]);
    const advancedCount = choices.filter((c) => filters[c.key] !== "all").length;

    const rows = useMemo(() => {
        const term = filters.search.trim().toLowerCase();
        const list = inScope.filter((e) => {
            if (term && ![e.name, e.companyName, e.email].some((v) => String(v || "").toLowerCase().includes(term))) return false;
            if (filters.status !== "all" && statusMetaOf(e).label !== filters.status) return false;
            if (filters.certification !== "all" && certificationLabelOf(e) !== filters.certification) return false;
            if (filters.category !== "all" && !e.categories?.includes(filters.category)) return false;
            if (filters.training !== "all" && (trainingById.get(e.trainingId)?.name || "No training yet") !== filters.training) return false;
            return true;
        });
        const by: Record<Sort, (a: TrainingEnrollment, b: TrainingEnrollment) => number> = {
            company: (a, b) => companyOf(a).localeCompare(companyOf(b)),
            name: (a, b) => a.name.localeCompare(b.name),
            newest: (a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""),
        };
        return list.sort(by[sort]);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [inScope, filters, sort, progress, trainingById]);

    const resetKey = JSON.stringify(filters) + sort;
    useEffect(() => setPage(1), [resetKey]);
    // Desktop always shows a detail: keep the selection while it's in view, otherwise take the first row.
    useEffect(() => {
        if (!rows.length) return;
        if (!selectedId || !rows.some((r) => r.id === selectedId)) setSelectedId(rows[0].id);
    }, [rows, selectedId]);
    // Keep the selected SME's page in view when it changes from outside.
    useEffect(() => {
        const index = rows.findIndex((r) => r.id === selectedId);
        if (index >= 0) setPage(Math.floor(index / PAGE_SIZE) + 1);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedId]);

    const selected = rows.find((r) => r.id === selectedId) || null;
    const selectedTraining = selected ? trainingById.get(selected.trainingId) : undefined;
    const select = (e: TrainingEnrollment) => {
        setSelectedId(e.id);
        if (isPhone) setDetailOpen(true);
    };

    const count = (value: number) => (loading ? "…" : value);
    const metrics: DashboardMetric[] = [
        {
            key: "total",
            title: "Total SMEs",
            value: count(inScope.length),
            subtitle: selectedTrainingId ? "In this training" : "Added so far",
            icon: <TeamOutlined style={{ color: token.colorPrimary }} />,
            important: true,
        },
        {
            key: "enrolled",
            title: "Enrolled",
            value: count(inScope.filter((e) => e.status === "enrolled").length),
            subtitle: "Currently in a training",
            icon: <CheckCircleOutlined style={{ color: token.colorSuccess }} />,
            important: true,
        },
        {
            key: "unassigned",
            title: "Awaiting training",
            value: count(inScope.filter((e) => e.status === "unassigned").length),
            subtitle: "Added, not yet enrolled",
            icon: <ClockCircleOutlined style={{ color: token.colorWarning }} />,
        },
        {
            key: "discontinued",
            title: "Discontinued",
            value: count(inScope.filter((e) => e.status === "discontinued").length),
            subtitle: "Stopped attending",
            icon: <StopOutlined style={{ color: token.colorError }} />,
        },
        {
            key: "eligible",
            title: "Awaiting certificate",
            value: count(inScope.filter((e) => certificationState(progress[e.id]) === "eligible").length),
            subtitle: "SMEs with someone eligible, not yet certified",
            icon: <SafetyCertificateOutlined style={{ color: token.colorWarning }} />,
            onClick: () => patchFilters({ certification: CERTIFICATION_LABEL.eligible }),
        },
    ];

    const peopleOfSme = (r: TrainingEnrollment) => attendees.filter((a) => a.enrollmentId === r.id);

    /** The ⋯ menu: status changes, the portal login and certification overrides, then delete. */
    const moreActions = (r: TrainingEnrollment) => {
        const p = progress[r.id];
        const companyStatus = p?.awardTo === "company" ? p.companyEligibility?.status : undefined;
        return [
            ...(r.status === "unassigned" ? [{ key: "enroll", icon: <UserAddOutlined />, label: "Enroll in a training", onClick: () => setAssigning(r) }] : []),
            ...(r.status === "enrolled" ? [{ key: "discontinue", icon: <StopOutlined />, label: "Discontinue", onClick: () => setDiscontinuing(r) }] : []),
            ...(!r.userId && r.status === "enrolled" && r.email
                ? [{ key: "login", icon: <KeyOutlined />, label: "Create portal login", onClick: () => void createLogin(r) }]
                : []),
            ...(p?.certificationEnabled && p.awardTo === "company"
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

    const renderPeople = (r: TrainingEnrollment) => {
        const people = peopleOfSme(r).sort((a, b) => (a.kind === "director" ? -1 : b.kind === "director" ? 1 : a.name.localeCompare(b.name)));
        return (
            <div className="ws-detail-body">
                <section>
                    <h4 className="ws-section-title">Portal login</h4>
                    {r.userId ? (
                        <Tag color="green">Active</Tag>
                    ) : r.status === "enrolled" ? (
                        <Tooltip title={r.email ? `Creates a training-only login for ${r.email} and emails it` : "Add an email address to create a login"}>
                            <Button icon={<KeyOutlined />} disabled={!r.email} loading={creatingLogin === r.id} onClick={() => void createLogin(r)}>
                                Create login
                            </Button>
                        </Tooltip>
                    ) : (
                        <Typography.Text type="secondary">Created when the SME is enrolled.</Typography.Text>
                    )}
                </section>
                <section>
                    <h4 className="ws-section-title">
                        People
                        <Button size="small" type="link" icon={<TeamOutlined />} onClick={() => setPeopleOf(r)}>
                            {people.length ? "Manage" : "Set up"}
                        </Button>
                    </h4>
                    {people.length ? (
                        <ContactList>
                            {people.map((a) => (
                                <ContactRow
                                    key={a.id}
                                    icon={a.kind === "director" ? <UserOutlined /> : <TeamOutlined />}
                                    label={[
                                        a.kind === "director" ? "Director" : "Employee",
                                        a.status === "withdrawn" ? "withdrawn" : a.attends ? "attends" : "doesn't attend",
                                        a.userId ? "login active" : "",
                                    ]
                                        .filter(Boolean)
                                        .join(" · ")}
                                    value={a.name}
                                    action={contactActions.email(a.email, <MailOutlined />)}
                                />
                            ))}
                        </ContactList>
                    ) : (
                        <Typography.Text type="secondary">
                            The director and the employees this SME sends. Until they're set up the SME is invited to sessions as one record.
                        </Typography.Text>
                    )}
                </section>
            </div>
        );
    };

    const renderCertification = (r: TrainingEnrollment) => {
        const p = progress[r.id];
        if (r.status !== "enrolled" && !p) return <Empty className="ws-detail-empty" image={Empty.PRESENTED_IMAGE_SIMPLE} description="Evaluated once the SME is enrolled." />;
        if (!p) return <Empty className="ws-detail-empty" image={Empty.PRESENTED_IMAGE_SIMPLE} description="Not evaluated yet." />;
        if (!p.certificationEnabled) return <Empty className="ws-detail-empty" image={Empty.PRESENTED_IMAGE_SIMPLE} description="Certificates are off for this training." />;
        if (p.awardTo === "company") {
            const status = p.companyEligibility?.status;
            return (
                <div className="ws-detail-body">
                    <section>
                        <h4 className="ws-section-title">Company certificate</h4>
                        <Space size={8} wrap>
                            <EligibilityTag eligibility={p.companyEligibility} />
                            {r.certificationOverride ? (
                                <Tooltip title={`Marked eligible by ${r.certificationOverride.byName}: ${r.certificationOverride.reason}`}>
                                    <Button size="small" loading={overrideBusy} onClick={() => void saveCompanyOverride(r, null)}>
                                        Undo override
                                    </Button>
                                </Tooltip>
                            ) : (
                                status !== "eligible" &&
                                status !== "certified" && (
                                    <Button size="small" onClick={() => { setOverrideReason(""); setOverridingCompany(r); }}>
                                        Mark eligible
                                    </Button>
                                )
                            )}
                        </Space>
                    </section>
                </div>
            );
        }
        return (
            <div className="ws-detail-body">
                <section>
                    <h4 className="ws-section-title">Per person</h4>
                    <dl className="ws-facts">
                        <div>
                            <dt>Attending</dt>
                            <dd>{p.attendingPeople}</dd>
                        </div>
                        <div>
                            <dt>Eligible</dt>
                            <dd>{p.eligiblePeople}</dd>
                        </div>
                        <div>
                            <dt>Certified</dt>
                            <dd>{p.certifiedPeople}</dd>
                        </div>
                    </dl>
                    <Button style={{ marginTop: 12 }} icon={<TeamOutlined />} onClick={() => setPeopleOf(r)}>
                        Each person's checklist
                    </Button>
                </section>
            </div>
        );
    };

    const renderDetail = () => {
        if (!selected) return null;
        const meta = statusMetaOf(selected);
        const twins = duplicatesOf(selected);
        const sub = [selected.companyName ? selected.name : "", selectedTraining?.name || "No training yet"].filter(Boolean).join(" · ");
        const statusTag = <Tag color={meta.color}>{meta.label}</Tag>;
        return (
            <div className="ws-detail">
                <MotionCard>
                    <header className="ws-detail-head">
                        <EntityAvatar name={companyOf(selected)} size={52} />
                        <div className="ws-detail-identity">
                            <h2 className="ws-detail-name">{companyOf(selected)}</h2>
                            <div className="ws-detail-sub">{sub}</div>
                            <div className="ws-detail-tags">
                                {selected.status === "discontinued" && selected.discontinuedReason ? <Tooltip title={selected.discontinuedReason}>{statusTag}</Tooltip> : statusTag}
                                {!!twins && (
                                    <Tooltip title={`${twins} other SME record${twins === 1 ? " has" : "s have"} the email ${selected.email}. If it's the same SME added twice, delete the extra one from ⋯.`}>
                                        <Tag color="orange">Duplicate?</Tag>
                                    </Tooltip>
                                )}
                                {(selected.categories || []).map((c) => (
                                    <Tag key={c}>{c}</Tag>
                                ))}
                            </div>
                        </div>
                        <div className="ws-detail-actions">
                            <Button icon={<EditOutlined />} onClick={() => setEditingSme(selected)}>
                                Edit
                            </Button>
                            <Dropdown trigger={["click"]} menu={{ items: moreActions(selected) }}>
                                <Button icon={<MoreOutlined />} aria-label={`More actions for ${selected.name}`}>
                                    More
                                </Button>
                            </Dropdown>
                        </div>
                    </header>
                    <div className="ws-detail-tabs">
                        <Segmented
                            className="ptx-sections"
                            block
                            value={section}
                            onChange={(v) => setSection(v as Section)}
                            options={[
                                { label: "Profile", value: "profile", icon: <UserOutlined /> },
                                { label: "People", value: "people", icon: <TeamOutlined /> },
                                { label: isPhone ? "Certificate" : "Certification", value: "certification", icon: <SafetyCertificateOutlined /> },
                                { label: isPhone ? "Docs" : "Documents", value: "documents", icon: <FileTextOutlined /> },
                                { label: "Progress", value: "progress", icon: <LineChartOutlined /> },
                            ]}
                        />
                        <div className="ws-detail-pane">
                            {section === "profile" && <TrainingSmeProfile enrollment={selected} training={selectedTraining} />}
                            {section === "people" && renderPeople(selected)}
                            {section === "certification" && renderCertification(selected)}
                            {section === "documents" && <TrainingSmeDocuments enrollment={selected} training={selectedTraining} />}
                            {section === "progress" && (
                                <div className="ws-detail-body">
                                    <section>
                                        <h4 className="ws-section-title">Course progress</h4>
                                        <TrainingCourseProgressCell enrollment={selected} training={selectedTraining} state={courseProgress} />
                                    </section>
                                </div>
                            )}
                        </div>
                    </div>
                </MotionCard>
            </div>
        );
    };

    const filterPanel = (
        <FilterPanel canReset={advancedCount > 0} onReset={() => patchFilters(Object.fromEntries(choices.map((c) => [c.key, "all"])) as Partial<Filters>)}>
            {choices.map((c) => (
                <ChoiceFilter key={c.key} id={`enroll-${c.key}`} label={c.label} allLabel={c.allLabel} value={filters[c.key]} values={c.values} onChange={(value) => patchFilters({ [c.key]: value })} />
            ))}
        </FilterPanel>
    );

    const pageItems = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    return (
        <div className="ws-page">
            <MetricsGrid metrics={metrics} />
            <div style={{ height: 12 }} />

            <DashboardFilterBar>
                <div className="ws-toolbar">
                    <Input
                        className="ws-toolbar-search"
                        placeholder="Search by company, person or email"
                        prefix={<SearchOutlined />}
                        value={filters.search}
                        onChange={(e) => patchFilters({ search: e.target.value })}
                        allowClear
                        aria-label="Search SMEs"
                    />
                    {choices.length > 0 && (
                        <Popover content={filterPanel} trigger="click" placement="bottomLeft" title="Filters">
                            <Badge className="ws-toolbar-button" count={advancedCount} size="small" offset={[-6, 4]}>
                                <Button block icon={<FilterOutlined />}>
                                    Filters
                                </Button>
                            </Badge>
                        </Popover>
                    )}
                    {/* On its own a toolbar button would stretch to fill the bar; keep it its own size on desktop. */}
                    <Button
                        className="ws-toolbar-button"
                        style={isPhone ? undefined : { flex: "0 0 auto" }}
                        type="primary"
                        shape="round"
                        icon={<PlusOutlined />}
                        onClick={() => setAddOpen(true)}
                    >
                        Add SME
                    </Button>
                </div>
            </DashboardFilterBar>

            {!loading && !inScope.length ? (
                <MotionCard>
                    <Empty className="ws-detail-empty" description={selectedTrainingId ? "No SMEs in this training yet." : "No SMEs added yet."} />
                </MotionCard>
            ) : (
                <div className="ws-layout">
                    <MotionCard loading={loading} skeleton="list" skeletonRows={6}>
                        <SortSelect value={sort} options={SORT_OPTIONS} onChange={setSort} label="Sort SMEs" />
                        {!rows.length ? (
                            <Empty className="ws-list-empty" description="No SMEs match these filters" />
                        ) : (
                            <>
                                <div className="ws-rows" role="listbox" aria-label="SMEs">
                                    {pageItems.map((e) => {
                                        const meta = statusMetaOf(e);
                                        const line = [
                                            e.companyName ? e.name : "",
                                            selectedTrainingId ? (e.categories || []).join(", ") : trainingById.get(e.trainingId)?.name || "No training yet",
                                        ]
                                            .filter(Boolean)
                                            .join(" · ");
                                        return (
                                            <button
                                                key={e.id}
                                                type="button"
                                                role="option"
                                                aria-selected={e.id === selectedId}
                                                className={`ws-row${e.id === selectedId ? " is-selected" : ""}`}
                                                onClick={() => select(e)}
                                            >
                                                <EntityAvatar name={companyOf(e)} size={36} />
                                                <div className="ws-row-main">
                                                    <div className="ws-row-name">{companyOf(e)}</div>
                                                    <div className="ws-row-meta">{line || "—"}</div>
                                                </div>
                                                <div className="ws-row-side">
                                                    {!!duplicatesOf(e) && (
                                                        <Tag bordered={false} color="orange">
                                                            Duplicate?
                                                        </Tag>
                                                    )}
                                                    <Tag bordered={false} color={meta.color}>
                                                        {meta.label}
                                                    </Tag>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                                {rows.length > PAGE_SIZE && (
                                    <div className="ws-pagination">
                                        <Pagination size="small" current={page} pageSize={PAGE_SIZE} total={rows.length} onChange={setPage} showSizeChanger={false} showLessItems />
                                    </div>
                                )}
                            </>
                        )}
                    </MotionCard>

                    {!isPhone && (
                        <div className="ws-detail-sticky">
                            {loading ? (
                                <MotionCard loading skeleton="text" skeletonRows={10}>
                                    {null}
                                </MotionCard>
                            ) : (
                                renderDetail() || (
                                    <MotionCard>
                                        <Empty className="ws-detail-empty" description="No SMEs match these filters" />
                                    </MotionCard>
                                )
                            )}
                        </div>
                    )}
                </div>
            )}

            {isPhone && (
                <Drawer
                    className="ws-drawer"
                    open={detailOpen && !!selected}
                    onClose={() => setDetailOpen(false)}
                    placement="right"
                    width="100%"
                    title={selected ? companyOf(selected) : "SME"}
                >
                    {renderDetail()}
                </Drawer>
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
