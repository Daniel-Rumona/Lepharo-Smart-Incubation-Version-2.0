import React, { useEffect, useMemo, useState } from "react";
import { App, Badge, Button, Col, Drawer, Empty, Input, Modal, Pagination, Popover, Row, Segmented, Tag, Grid } from "antd";
import {
  ArrowLeftOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  EditOutlined,
  FileTextOutlined,
  FilterOutlined,
  LineChartOutlined,
  SearchOutlined,
  SortAscendingOutlined,
  StopOutlined,
  TeamOutlined,
  UserAddOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { collection, getDocs } from "firebase/firestore";
import { db } from "@/firebase";
import { useFullIdentity } from "@/hooks/useFullIdentity";
import { DashboardFilterBar, MotionCard } from "@/components/dashboards/metrics/Header";
import { MetricTile } from "@/components/dashboards/metrics/MetricTile";
import { ChoiceFilter, EntityAvatar, FilterPanel, SortSelect, type SortOption } from "@/components/workspace";
import {
  type Training,
  type TrainingEnrollment,
  createEnrollment,
  listAllEnrollments,
  listTrainings,
  updateEnrollment,
} from "./trainingStorage";
import { TrainingCourseProgressCell, useTrainingCourseProgress } from "./TrainingCourseProgress";
import { EnrollSmeForm, type EnrollSmeFormValues } from "./EnrollSmeForm";
import { TrainingSmeDocuments, TrainingSmeProfile, companyOf, statusMetaOf } from "./TrainingSmeSections";

type Sort = "company" | "name" | "newest";
const SORT_OPTIONS: SortOption<Sort>[] = [
  { value: "company", label: "Company A–Z", icon: <SortAscendingOutlined /> },
  { value: "name", label: "Person A–Z", icon: <UserOutlined /> },
  { value: "newest", label: "Newest added", icon: <ClockCircleOutlined /> },
];

type Filters = { search: string; status: string; region: string; category: string; training: string };
const NO_FILTERS: Filters = { search: "", status: "all", region: "all", category: "all", training: "all" };
const PAGE_SIZE = 10;

type Section = "profile" | "documents" | "progress";

/**
 * Training SMEs for departments granted access to a training (Training.access),
 * shown on the Participants page when a training is picked in the selector
 * (or from "View Training SMEs"). Laid out like the Participants workspace —
 * tiles, filter bar, a list of SMEs beside a detail panel — but built for a
 * training-sourced SME, which has none of the intervention/KPI/compliance
 * history the incubatee workspace assumes.
 *
 * canAdd lets staff enrol SMEs (Training Academy and ROM, the recruitment
 * department); canEdit lets them correct an SME's details and documents.
 */
export default function TrainingSmesRepository({
  onBack,
  trainingId,
  seesAll = false,
  canAdd = false,
  canEdit = false,
}: {
  onBack?: () => void;
  trainingId?: string;
  /** Training Academy staff: every training and its progress, whatever its access grants. */
  seesAll?: boolean;
  canAdd?: boolean;
  canEdit?: boolean;
}) {
  const { user } = useFullIdentity();
  const { message } = App.useApp();
  const isPhone = !Grid.useBreakpoint().md;
  const userRecord = user as Record<string, unknown> | null;
  const departmentId = String(userRecord?.departmentId || "").trim();
  const isCenterCoordinator = userRecord?.role === "projectadmin";
  const assignedBranch = String(userRecord?.assignedBranch || "").trim();

  const [trainings, setTrainings] = useState<Training[]>([]);
  const [enrollments, setEnrollments] = useState<TrainingEnrollment[]>([]);
  const [branchProvince, setBranchProvince] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [sort, setSort] = useState<Sort>("company");
  const [page, setPage] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [section, setSection] = useState<Section>("profile");
  const [detailOpen, setDetailOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<TrainingEnrollment | null>(null);
  const patch = (next: Partial<Filters>) => setFilters((f) => ({ ...f, ...next }));

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([listTrainings(), listAllEnrollments(), getDocs(collection(db, "branches"))])
      .then(([t, e, branchSnap]) => {
        if (cancelled) return;
        setTrainings(t);
        setEnrollments(e);
        const map: Record<string, string> = {};
        branchSnap.docs.forEach((d) => {
          const data = d.data() as Record<string, unknown>;
          const location = data.location as Record<string, unknown> | undefined;
          const province = (location?.province as string) || (data.province as string);
          if (province) map[d.id] = province;
        });
        setBranchProvince(map);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Picked in the selector, a training is open to any department its setup
  // lists (that is what put it in the selector); otherwise only to "repository".
  const accessibleTrainings = useMemo(
    () =>
      trainings.filter((t) => {
        if (trainingId && t.id !== trainingId) return false;
        if (seesAll) return true;
        const grant = t.access?.find((a) => a.departmentId === departmentId);
        const departmentGranted = trainingId ? !!grant : !!grant?.capabilities.includes("repository");
        const coordinatorGranted = isCenterCoordinator && t.centerCoordinatorAccess && !!assignedBranch && t.centers.some((c) => c.id === assignedBranch);
        return departmentGranted || coordinatorGranted;
      }),
    [trainings, trainingId, seesAll, departmentId, isCenterCoordinator, assignedBranch]
  );
  const scopedTraining = trainingId ? accessibleTrainings[0] : undefined;
  const accessibleIds = useMemo(() => new Set(accessibleTrainings.map((t) => t.id)), [accessibleTrainings]);
  const trainingById = useMemo(() => new Map(accessibleTrainings.map((t) => [t.id, t])), [accessibleTrainings]);

  const reload = async () => setEnrollments(await listAllEnrollments());

  const submitAdd = async (values: EnrollSmeFormValues) => {
    try {
      const result = await createEnrollment({ ...values, owner: user?.uid || "" });
      message.success(result.accountError ? "SME enrolled." : "SME enrolled and portal login emailed.");
      if (result.accountError) message.warning(result.accountError, 6);
      setAddOpen(false);
      await reload();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Could not add this SME.");
    }
  };

  const submitEdit = async (values: EnrollSmeFormValues) => {
    if (!editing) return;
    try {
      await updateEnrollment(editing, values);
      message.success("SME updated.");
      setEditing(null);
      await reload();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Could not update this SME.");
    }
  };

  const regionOf = (training?: Training) => {
    if (!training) return [] as string[];
    const set = new Set<string>();
    training.centers.forEach((c) => {
      const province = branchProvince[c.id];
      if (province) set.add(province);
    });
    return Array.from(set);
  };

  const progressTrainings = useMemo(
    () =>
      accessibleTrainings.filter(
        (t) =>
          seesAll ||
          t.access.some((a) => a.departmentId === departmentId && a.capabilities.includes("progress")) ||
          (isCenterCoordinator && t.centerCoordinatorAccess)
      ),
    [accessibleTrainings, seesAll, departmentId, isCenterCoordinator]
  );
  const progressTrainingIds = useMemo(() => new Set(progressTrainings.map((t) => t.id)), [progressTrainings]);
  const progressEnrollments = useMemo(() => enrollments.filter((e) => progressTrainingIds.has(e.trainingId)), [enrollments, progressTrainingIds]);
  const courseProgress = useTrainingCourseProgress(progressEnrollments, progressTrainings, progressTrainings.length > 0);

  const inScope = useMemo(() => enrollments.filter((e) => accessibleIds.has(e.trainingId)), [enrollments, accessibleIds]);

  // Only the filters that would narrow this list are offered.
  const choices = useMemo(() => {
    const distinct = (values: string[]) => Array.from(new Set(values.filter(Boolean))).sort();
    const list = [
      { key: "status" as const, label: "Status", allLabel: "Any status", values: distinct(inScope.map((e) => statusMetaOf(e).label || "")) },
      { key: "region" as const, label: "Region", allLabel: "All regions", values: distinct(inScope.flatMap((e) => regionOf(trainingById.get(e.trainingId)))) },
      { key: "category" as const, label: "Category", allLabel: "All categories", values: distinct(inScope.flatMap((e) => e.categories || [])) },
      ...(scopedTraining ? [] : [{ key: "training" as const, label: "Training", allLabel: "All trainings", values: distinct(inScope.map((e) => trainingById.get(e.trainingId)?.name || "")) }]),
    ];
    return list.filter((c) => c.values.length > 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inScope, trainingById, branchProvince, scopedTraining]);

  const rows = useMemo(() => {
    const term = filters.search.trim().toLowerCase();
    const list = inScope.filter((e) => {
      if (term && ![e.name, e.companyName, e.email].some((v) => String(v || "").toLowerCase().includes(term))) return false;
      if (filters.status !== "all" && statusMetaOf(e).label !== filters.status) return false;
      if (filters.region !== "all" && !regionOf(trainingById.get(e.trainingId)).includes(filters.region)) return false;
      if (filters.category !== "all" && !e.categories?.includes(filters.category)) return false;
      if (filters.training !== "all" && trainingById.get(e.trainingId)?.name !== filters.training) return false;
      return true;
    });
    const by: Record<Sort, (a: TrainingEnrollment, b: TrainingEnrollment) => number> = {
      company: (a, b) => companyOf(a).localeCompare(companyOf(b)),
      name: (a, b) => a.name.localeCompare(b.name),
      newest: (a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""),
    };
    return list.sort(by[sort]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inScope, filters, sort, trainingById, branchProvince]);

  const resetKey = JSON.stringify(filters) + sort;
  useEffect(() => setPage(1), [resetKey]);
  // Desktop always shows a detail: keep the selection while it's in view, otherwise take the first row.
  useEffect(() => {
    if (!rows.length) return;
    if (!selectedId || !rows.some((r) => r.id === selectedId)) setSelectedId(rows[0].id);
  }, [rows, selectedId]);

  const selected = rows.find((r) => r.id === selectedId) || null;
  const selectedTraining = selected ? trainingById.get(selected.trainingId) : undefined;
  const selectedHasProgress = !!selected && progressTrainingIds.has(selected.trainingId);
  const openSection = section === "progress" && !selectedHasProgress ? "profile" : section;

  const select = (e: TrainingEnrollment) => {
    setSelectedId(e.id);
    if (isPhone) setDetailOpen(true);
  };

  const counts = {
    all: inScope.length,
    enrolled: inScope.filter((e) => e.status === "enrolled").length,
    unassigned: inScope.filter((e) => e.status === "unassigned").length,
    discontinued: inScope.filter((e) => e.status === "discontinued").length,
  };
  const advancedCount = choices.filter((c) => filters[c.key] !== "all").length;

  const renderDetail = () => {
    if (!selected) return null;
    const meta = statusMetaOf(selected);
    const sub = [selected.companyName ? selected.name : "", selectedTraining?.name].filter(Boolean).join(" · ");
    return (
      <div className="ws-detail">
        <MotionCard>
          <header className="ws-detail-head">
            <EntityAvatar name={companyOf(selected)} size={52} />
            <div className="ws-detail-identity">
              <h2 className="ws-detail-name">{companyOf(selected)}</h2>
              {sub && <div className="ws-detail-sub">{sub}</div>}
              <div className="ws-detail-tags">
                <Tag color={meta.color}>{meta.label}</Tag>
                {(selected.categories || []).map((c) => (
                  <Tag key={c}>{c}</Tag>
                ))}
              </div>
            </div>
            {canEdit && (
              <div className="ws-detail-actions">
                <Button icon={<EditOutlined />} onClick={() => setEditing(selected)}>
                  Edit
                </Button>
              </div>
            )}
          </header>
          <div className="ws-detail-tabs">
            <Segmented
              className="ptx-sections"
              block
              value={openSection}
              onChange={(v) => setSection(v as Section)}
              options={[
                { label: "Profile", value: "profile", icon: <UserOutlined /> },
                { label: "Documents", value: "documents", icon: <FileTextOutlined /> },
                ...(selectedHasProgress ? [{ label: "Progress", value: "progress", icon: <LineChartOutlined /> }] : []),
              ]}
            />
            <div className="ws-detail-pane">
              {openSection === "profile" && <TrainingSmeProfile enrollment={selected} training={selectedTraining} />}
              {openSection === "documents" && <TrainingSmeDocuments enrollment={selected} training={selectedTraining} />}
              {openSection === "progress" && (
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
    <FilterPanel canReset={advancedCount > 0} onReset={() => patch(Object.fromEntries(choices.map((c) => [c.key, "all"])) as Partial<Filters>)}>
      {choices.map((c) => (
        <ChoiceFilter key={c.key} id={`tsr-${c.key}`} label={c.label} allLabel={c.allLabel} value={filters[c.key]} values={c.values} onChange={(value) => patch({ [c.key]: value })} />
      ))}
    </FilterPanel>
  );

  const pageItems = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <>
      <Row gutter={[12, 12]} style={{ marginBottom: 12 }}>
        {[
          { key: "all", title: isPhone ? "SMEs" : scopedTraining ? `${scopedTraining.name} SMEs` : "Training SMEs", value: counts.all, icon: <TeamOutlined />, tone: "accent" as const },
          { key: "enrolled", title: "Enrolled", value: counts.enrolled, icon: <CheckCircleOutlined />, tone: "success" as const },
          { key: "unassigned", title: isPhone ? "Awaiting" : "Awaiting training", value: counts.unassigned, icon: <ClockCircleOutlined />, tone: "warning" as const },
          { key: "discontinued", title: "Discontinued", value: counts.discontinued, icon: <StopOutlined />, tone: "danger" as const },
        ].map((t) => (
          <Col key={t.key} xs={12} xl={6}>
            <MetricTile title={t.title} value={t.value} icon={t.icon} tone={t.tone} loading={loading} compact={isPhone} />
          </Col>
        ))}
      </Row>

      <DashboardFilterBar>
        <div className="ws-toolbar">
          {onBack && (
            <Button className="ws-toolbar-button" icon={<ArrowLeftOutlined />} onClick={onBack}>
              Incubatees
            </Button>
          )}
          <Input
            className="ws-toolbar-search"
            placeholder="Search by company, person or email"
            prefix={<SearchOutlined />}
            value={filters.search}
            onChange={(e) => patch({ search: e.target.value })}
            allowClear
            aria-label="Search training SMEs"
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
          {canAdd && !!accessibleTrainings.length && (
            // On its own a toolbar button would stretch to fill the bar; keep it its own size on desktop.
            <Button
              className="ws-toolbar-button"
              style={isPhone ? undefined : { flex: "0 0 auto" }}
              type="primary"
              shape="round"
              icon={<UserAddOutlined />}
              onClick={() => setAddOpen(true)}
            >
              Add SME
            </Button>
          )}
        </div>
      </DashboardFilterBar>

      {!loading && !accessibleTrainings.length ? (
        <MotionCard>
          <Empty className="ws-detail-empty" description="No trainings have been shared with your department yet." />
        </MotionCard>
      ) : !loading && !inScope.length ? (
        <MotionCard>
          <Empty className="ws-detail-empty" description={scopedTraining ? `No SMEs in ${scopedTraining.name} yet.` : "No training SMEs yet."} />
        </MotionCard>
      ) : (
        <div className="ws-layout">
          <MotionCard loading={loading} skeleton="list" skeletonRows={6}>
            <SortSelect value={sort} options={SORT_OPTIONS} onChange={setSort} label="Sort SMEs" />
            {!rows.length ? (
              <Empty className="ws-list-empty" description="No SMEs match these filters" />
            ) : (
              <>
                <div className="ws-rows" role="listbox" aria-label="Training SMEs">
                  {pageItems.map((e) => {
                    const meta = statusMetaOf(e);
                    const line = [e.companyName ? e.name : "", scopedTraining ? (e.categories || []).join(", ") : trainingById.get(e.trainingId)?.name]
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
        <Drawer className="ws-drawer" open={detailOpen && !!selected} onClose={() => setDetailOpen(false)} placement="right" width="100%" title={selected ? companyOf(selected) : "SME"}>
          {renderDetail()}
        </Drawer>
      )}

      {/* Enrols into the picked training, or one of the trainings listed here. */}
      <Modal wrapClassName="mobile-sheet" centered title="Add an SME" open={addOpen} onCancel={() => setAddOpen(false)} footer={null} maskClosable={false} destroyOnClose width={720}>
        <EnrollSmeForm trainings={accessibleTrainings} lockedTrainingId={scopedTraining?.id} onSubmit={submitAdd} />
      </Modal>

      <Modal
        wrapClassName="mobile-sheet"
        centered
        title={editing ? `Edit ${companyOf(editing)}` : "Edit SME"}
        open={!!editing}
        onCancel={() => setEditing(null)}
        footer={null}
        maskClosable={false}
        destroyOnClose
        width={720}
      >
        {editing && <EnrollSmeForm trainings={accessibleTrainings} enrollment={editing} lockedTrainingId={editing.trainingId} onSubmit={submitEdit} />}
      </Modal>
    </>
  );
}
