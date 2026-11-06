import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, App, Badge, Button, Input, Modal, Segmented, Select, Space, Table, Tag, Tooltip, Typography } from "antd";
import { DownloadOutlined, EditOutlined, ReloadOutlined, SafetyCertificateOutlined, SendOutlined, StopOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { requestOpenAccountSettings } from "@/lib/accountSettings";
import { useFullIdentity } from "@/hooks/useFullIdentity";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useActiveProgramId } from "@/lib/useActiveProgramId";
import { DashboardFilterBar, MotionCard } from "@/components/dashboards/metrics/Header";
import { MobileCardList, type MobileCardContent } from "@/components/shared/MobileCardList";
import "@/components/shared/setup-segmented.css";
import { useSigningCeremony } from "@/components/shared/SignatureAnimation";
import { type Training, type TrainingAttendee, type TrainingEnrollment, listAllEnrollments, listTrainings } from "./trainingStorage";
import { listAllAttendees } from "./attendeeStorage";
import { type CertificationSettings, type TrainingCertificate, type TrainingCompanyProgress, effectiveCertification } from "./certification";
import { listCompanyProgress, loadCertificationDefaults } from "./certificationStorage";
import {
  type CertificateCandidate,
  certificatesToSign,
  listCertificates,
  prepareCertificates,
  renameCertificate,
  revokeCertificate,
  signCertificates,
} from "./certificateStorage";
import { EligibilityTag } from "./EligibilityTag";

type Tab = "prepare" | "sign" | "issued";
const NO_MATCH = "Nothing matches these filters.";
const candidateKey = (c: CertificateCandidate) => `${c.enrollment.id}|${c.attendee?.id || "company"}`;

/**
 * /operations/training/certificates — from eligible to issued: staff prepare
 * certificates for everyone eligible and send them for signature; the
 * signatory (the Academy head) signs here with their profile signature and
 * the server issues each one; issued certificates can be downloaded or revoked.
 */
export default function TrainingCertificates() {
  const { message } = App.useApp();
  const { user } = useFullIdentity();
  const isMobile = useIsMobile();
  const ceremony = useSigningCeremony();
  const [tab, setTab] = useState<Tab>("prepare");
  const [loading, setLoading] = useState(true);
  const [trainings, setTrainings] = useState<Training[]>([]);
  const [enrollments, setEnrollments] = useState<TrainingEnrollment[]>([]);
  const [attendees, setAttendees] = useState<TrainingAttendee[]>([]);
  const [progress, setProgress] = useState<Record<string, TrainingCompanyProgress>>({});
  const [certificates, setCertificates] = useState<TrainingCertificate[]>([]);
  const [defaults, setDefaults] = useState<Partial<CertificationSettings> | null>(null);
  const [mine, setMine] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<React.Key[]>([]);
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<TrainingCertificate | null>(null);
  const [revoking, setRevoking] = useState<TrainingCertificate | null>(null);
  const [text, setText] = useState("");
  const [search, setSearch] = useState("");
  const [trainingFilter, setTrainingFilter] = useState<string>();
  const [statusFilter, setStatusFilter] = useState<"valid" | "revoked">();
  // A training picked in the programme dropdown scopes this page to it, as on Training SMEs.
  const { activeProgramId } = useActiveProgramId();
  useEffect(() => {
    if (!trainings.length) return;
    setTrainingFilter(trainings.some((t) => t.id === activeProgramId) ? activeProgramId : undefined);
  }, [activeProgramId, trainings]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [t, e, a, p, c, d, toSign] = await Promise.all([
        listTrainings(),
        listAllEnrollments(),
        listAllAttendees(),
        listCompanyProgress(),
        listCertificates(),
        loadCertificationDefaults(),
        certificatesToSign().catch(() => [] as string[]),
      ]);
      setTrainings(t);
      setEnrollments(e);
      setAttendees(a);
      setProgress(p);
      setCertificates(c);
      setDefaults(d);
      setMine(new Set(toSign));
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Could not load certificates.");
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    void load();
  }, [load]);
  // A selection hidden by a filter must never be acted on, so changing the view clears it.
  useEffect(() => setSelected([]), [tab, search, trainingFilter, statusFilter]);

  const trainingById = useMemo(() => new Map(trainings.map((t) => [t.id, t])), [trainings]);
  const enrollmentById = useMemo(() => new Map(enrollments.map((e) => [e.id, e])), [enrollments]);
  const settingsFor = useCallback((t: Training) => effectiveCertification(defaults, t.certification), [defaults]);

  // Everyone eligible without a certificate that's still standing.
  const candidates = useMemo(() => {
    const taken = new Set(certificates.filter((c) => c.status !== "revoked").map((c) => `${c.enrollmentId}|${c.attendeeId || "company"}`));
    const list: CertificateCandidate[] = [];
    enrollments.forEach((enrollment) => {
      const training = trainingById.get(enrollment.trainingId);
      if (!training || enrollment.status === "unassigned") return;
      const settings = settingsFor(training);
      if (!settings.enabled) return;
      if (settings.awardTo === "company") {
        if (progress[enrollment.id]?.companyEligibility?.status === "eligible") list.push({ training, enrollment, attendee: null });
        return;
      }
      attendees
        .filter((a) => a.enrollmentId === enrollment.id && a.status === "active" && a.attends && a.progress?.eligibility.status === "eligible")
        .forEach((attendee) => list.push({ training, enrollment, attendee }));
    });
    return list.filter((c) => !taken.has(candidateKey(c)));
  }, [enrollments, attendees, progress, certificates, trainingById, settingsFor]);

  const needle = search.trim().toLowerCase();
  const matches = (...parts: (string | undefined | null)[]) => !needle || parts.filter(Boolean).join(" ").toLowerCase().includes(needle);
  const inTraining = (trainingId: string) => !trainingFilter || trainingId === trainingFilter;

  const shownCandidates = candidates.filter(
    (c) => inTraining(c.training.id) && matches(c.attendee?.name, c.enrollment.companyName, c.enrollment.name)
  );
  const pending = certificates.filter(
    (c) => c.status === "pending_signature" && inTraining(c.trainingId) && matches(c.recipientName, c.companyName)
  );
  const issued = certificates
    .filter(
      (c) =>
        (c.status === "issued" || c.status === "revoked") &&
        inTraining(c.trainingId) &&
        (!statusFilter || (statusFilter === "revoked") === (c.status === "revoked")) &&
        matches(c.recipientName, c.companyName, c.certificateNumber, c.verificationCode)
    )
    .sort((a, b) => (b.issuedAt || "").localeCompare(a.issuedAt || ""));
  const mineShown = pending.filter((c) => mine.has(c.id)).length;
  const filtering = !!needle || !!trainingFilter || (tab === "issued" && !!statusFilter);
  const hasSignature = !!(user as Record<string, unknown> | null)?.signatureURL;

  const prepare = async () => {
    const chosen = shownCandidates.filter((c) => selected.includes(candidateKey(c)));
    setBusy(true);
    try {
      const { prepared, skipped } = await prepareCertificates(chosen, settingsFor, certificates, user?.uid || "");
      if (prepared) message.success(`${prepared} certificate${prepared === 1 ? "" : "s"} sent for signature.`);
      skipped.forEach((s) => message.warning(s, 6));
      setSelected([]);
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Could not prepare the certificates.");
    } finally {
      setBusy(false);
    }
  };

  const sign = async () => {
    setBusy(true);
    try {
      // The signature only lands in the server-made PDF, so show it being written while signing.
      const results = await ceremony.sign(
        (user as Record<string, unknown> | null)?.signatureURL as string | undefined,
        () => signCertificates(selected.map(String)),
        "Signing certificates",
        `${selected.length} certificate${selected.length === 1 ? "" : "s"}`
      );
      const issuedNow = results.filter((r) => r.status === "issued").length;
      const signedNow = results.filter((r) => r.status === "signed").length;
      if (issuedNow) message.success(`${issuedNow} certificate${issuedNow === 1 ? "" : "s"} signed and issued.`);
      if (signedNow) message.success(`${signedNow} signed; waiting for the other signatures.`);
      results.filter((r) => r.status === "skipped").forEach((r) => message.warning(r.reason || "One certificate was skipped.", 6));
      setSelected([]);
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Could not sign.");
    } finally {
      setBusy(false);
    }
  };

  const submitRename = async () => {
    if (!renaming) return;
    setBusy(true);
    try {
      await renameCertificate(renaming.id, text);
      message.success("Name corrected.");
      setRenaming(null);
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Could not correct the name.");
    } finally {
      setBusy(false);
    }
  };

  const submitRevoke = async () => {
    if (!revoking) return;
    setBusy(true);
    try {
      await revokeCertificate(revoking.id, text.trim());
      message.success("Certificate revoked. Its verification now shows it as revoked.");
      setRevoking(null);
      await load();
    } catch (e) {
      message.error(e instanceof Error ? e.message : "Could not revoke the certificate.");
    } finally {
      setBusy(false);
    }
  };

  const trainingName = (id: string) => trainingById.get(id)?.name || "—";

  const count = selected.length ? ` (${selected.length})` : "";
  const toolbar = (
    // The shared setup toolbar: one line on wide screens, stacked full-width rows on phones.
    <div className="setup-toolbar">
      <Segmented
        className="setup-segmented"
        block={isMobile}
        value={tab}
        onChange={(v) => setTab(v as Tab)}
        options={[
          { value: "prepare", label: <Badge count={shownCandidates.length} size="small" offset={[8, -2]}>{isMobile ? "Prepare" : "Ready to prepare"}</Badge> },
          { value: "sign", label: <Badge count={mineShown} size="small" offset={[8, -2]}>To sign</Badge> },
          // Wrapped like the others so all three labels share the same type size.
          { value: "issued", label: <Badge count={0}>Issued</Badge> },
        ]}
      />
      <div className="setup-toolbar-search" style={{ maxWidth: isMobile ? undefined : 300 }}>
        <Input.Search
          placeholder={tab === "issued" ? "Name, company, number or code" : "Name or company"}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          allowClear
        />
      </div>
      <div className="setup-toolbar-filter" style={{ maxWidth: isMobile ? undefined : 240 }}>
        <Select
          placeholder="All trainings"
          allowClear
          value={trainingFilter}
          onChange={setTrainingFilter}
          options={trainings.map((t) => ({ value: t.id, label: t.name }))}
          style={{ width: "100%" }}
        />
      </div>
      {tab === "issued" && (
        <div className="setup-toolbar-filter" style={{ maxWidth: isMobile ? undefined : 140 }}>
          <Select
            placeholder="Any status"
            allowClear
            value={statusFilter}
            onChange={setStatusFilter}
            options={[
              { value: "valid", label: "Valid" },
              { value: "revoked", label: "Revoked" },
            ]}
            style={{ width: "100%" }}
          />
        </div>
      )}
      <div className="setup-toolbar-action" style={{ marginLeft: isMobile ? undefined : "auto" }}>
        <Space size={8} wrap={!isMobile}>
          {tab === "prepare" && (
            <Button type="primary" shape="round" icon={<SendOutlined />} disabled={!selected.length} loading={busy} onClick={() => void prepare()}>
              {isMobile ? `Send to sign${count}` : `Prepare and send for signature${count}`}
            </Button>
          )}
          {tab === "sign" && (
            <Button
              type="primary"
              shape="round"
              icon={<SafetyCertificateOutlined />}
              disabled={!selected.length || !hasSignature}
              loading={busy}
              onClick={() => void sign()}
            >
              {isMobile ? `Sign${count}` : `Sign and issue${count}`}
            </Button>
          )}
          <Button shape="round" icon={<ReloadOutlined />} onClick={() => void load()} loading={loading}>
            Refresh
          </Button>
        </Space>
      </div>
    </div>
  );

  const signatureAlert = !hasSignature && (
    <Alert
      type="warning"
      showIcon
      message="Add your signature first"
      description="Certificates are signed with the signature on your profile."
      action={
        <Button size="small" onClick={() => requestOpenAccountSettings()}>
          Account settings
        </Button>
      }
    />
  );

  const signatureTags = (c: TrainingCertificate) =>
    c.signatories.map((s) => (
      <Tag key={s.key} color={c.signatures?.[s.key] ? "green" : mine.has(c.id) ? "gold" : "default"}>
        {s.title}: {c.signatures?.[s.key] ? "signed" : mine.has(c.id) ? "you" : "waiting"}
      </Tag>
    ));

  const candidateCard = (c: CertificateCandidate): MobileCardContent => ({
    title: c.attendee ? c.attendee.name : c.enrollment.companyName || c.enrollment.name,
    subtitle: [c.attendee ? c.enrollment.companyName || c.enrollment.name : "Company certificate", c.training.name].join(" · "),
    badge: <EligibilityTag eligibility={c.attendee ? c.attendee.progress?.eligibility : progress[c.enrollment.id]?.companyEligibility} />,
    note: settingsFor(c.training).templateId ? undefined : <Tag color="red">Choose a template in the training's certification settings</Tag>,
  });

  const pendingCard = (c: TrainingCertificate): MobileCardContent => ({
    title: c.recipientName,
    subtitle: [c.companyName, trainingName(c.trainingId)].filter(Boolean).join(" · "),
    note: <Space size={[4, 4]} wrap>{signatureTags(c)}</Space>,
    actions: Object.keys(c.signatures || {}).length
      ? undefined
      : [
          <Button key="rename" icon={<EditOutlined />} onClick={() => { setText(c.recipientName); setRenaming(c); }}>
            Correct name
          </Button>,
        ],
  });

  const issuedCard = (c: TrainingCertificate): MobileCardContent => ({
    title: c.recipientName,
    subtitle: [c.companyName || enrollmentById.get(c.enrollmentId)?.name, trainingName(c.trainingId)].filter(Boolean).join(" · "),
    badge: c.status === "revoked" ? <Tag color="red">Revoked</Tag> : <Tag color="green">Valid</Tag>,
    fields: [
      { label: "Number", value: <Typography.Text code>{c.certificateNumber}</Typography.Text> },
      { label: "Issued", value: c.issuedAt ? dayjs(c.issuedAt).format("DD MMM YYYY") : "—" },
    ],
    note: c.status === "revoked" && c.revokedReason ? <Typography.Text type="secondary">{c.revokedReason}</Typography.Text> : undefined,
    actions: [
      ...(c.pdfUrl
        ? [
            <Button key="download" icon={<DownloadOutlined />} href={c.pdfUrl} target="_blank" rel="noreferrer">
              Download
            </Button>,
          ]
        : []),
      ...(c.status === "issued"
        ? [
            <Button key="revoke" danger icon={<StopOutlined />} onClick={() => { setText(""); setRevoking(c); }}>
              Revoke
            </Button>,
          ]
        : []),
    ],
  });

  return (
    <div style={{ padding: isMobile ? 12 : 24 }}>
      {isMobile ? (
        // Phones drop the wrapping card: the toolbar stands on its own and the cards follow it.
        <>
          <DashboardFilterBar marginBottom={16} padding={14}>
            {toolbar}
          </DashboardFilterBar>
          {tab === "prepare" && (
            <MobileCardList
              data={shownCandidates}
              loading={loading}
              getKey={candidateKey}
              pageSize={20}
              selectedKeys={selected}
              onSelectionChange={setSelected}
              emptyText={filtering ? NO_MATCH : "No one is waiting for a certificate yet."}
              renderCard={candidateCard}
            />
          )}
          {tab === "sign" && (
            <Space direction="vertical" size={12} style={{ width: "100%" }}>
              {signatureAlert}
              <MobileCardList
                data={pending}
                loading={loading}
                getKey={(c: TrainingCertificate) => c.id}
                pageSize={20}
                selectedKeys={selected}
                // Only certificates waiting on your signature can be picked.
                onSelectionChange={(keys) => setSelected(keys.filter((k) => mine.has(String(k))))}
                emptyText={filtering ? NO_MATCH : "Nothing is waiting for a signature."}
                renderCard={pendingCard}
              />
            </Space>
          )}
          {tab === "issued" && (
            <MobileCardList
              data={issued}
              loading={loading}
              getKey={(c: TrainingCertificate) => c.id}
              pageSize={20}
              emptyText={filtering ? NO_MATCH : "No certificates issued yet."}
              renderCard={issuedCard}
            />
          )}
        </>
      ) : (
      <MotionCard filterBarProps={{ marginBottom: 16, padding: 14 }} filterBar={toolbar}>
        {tab === "prepare" && (
          <Table
            rowKey={candidateKey}
            loading={loading}
            dataSource={shownCandidates}
            rowSelection={{ selectedRowKeys: selected, onChange: setSelected }}
            pagination={{ pageSize: 20, showSizeChanger: false, position: ["bottomCenter"] }}
            locale={{ emptyText: filtering ? NO_MATCH : "No one is waiting for a certificate. People appear here once they meet their training's rules." }}
            columns={[
              { title: "Recipient", key: "name", render: (_: unknown, c: CertificateCandidate) => (c.attendee ? c.attendee.name : <Space size={6}>{c.enrollment.companyName}<Tag>Company</Tag></Space>) },
              { title: "Company", key: "company", render: (_: unknown, c: CertificateCandidate) => c.enrollment.companyName || c.enrollment.name },
              { title: "Training", key: "training", render: (_: unknown, c: CertificateCandidate) => c.training.name },
              {
                title: "Eligibility",
                key: "eligibility",
                render: (_: unknown, c: CertificateCandidate) => (
                  <EligibilityTag eligibility={c.attendee ? c.attendee.progress?.eligibility : progress[c.enrollment.id]?.companyEligibility} />
                ),
              },
              {
                title: "Template",
                key: "template",
                render: (_: unknown, c: CertificateCandidate) =>
                  settingsFor(c.training).templateId ? <Tag color="blue">Chosen</Tag> : <Tag color="red">Choose in the training's certification settings</Tag>,
              },
            ]}
          />
        )}

        {tab === "sign" && (
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            {signatureAlert}
            <Table
              rowKey="id"
              loading={loading}
              dataSource={pending}
              rowSelection={{ selectedRowKeys: selected, onChange: setSelected, getCheckboxProps: (c: TrainingCertificate) => ({ disabled: !mine.has(c.id) }) }}
              pagination={{ pageSize: 20, showSizeChanger: false, position: ["bottomCenter"] }}
              locale={{ emptyText: filtering ? NO_MATCH : "Nothing is waiting for a signature." }}
              columns={[
                {
                  title: "Recipient",
                  key: "recipient",
                  render: (_: unknown, c: TrainingCertificate) => (
                    <Space size={4}>
                      {c.recipientName}
                      {!Object.keys(c.signatures || {}).length && (
                        <Tooltip title="Correct the name before it is signed">
                          <Button size="small" type="text" icon={<EditOutlined />} onClick={() => { setText(c.recipientName); setRenaming(c); }} aria-label={`Correct ${c.recipientName}`} />
                        </Tooltip>
                      )}
                    </Space>
                  ),
                },
                { title: "Company", dataIndex: "companyName" },
                { title: "Training", key: "training", render: (_: unknown, c: TrainingCertificate) => trainingName(c.trainingId) },
                {
                  title: "Signatures",
                  key: "signatures",
                  render: (_: unknown, c: TrainingCertificate) => signatureTags(c),
                },
              ]}
            />
          </Space>
        )}

        {tab === "issued" && (
          <Table
            rowKey="id"
            loading={loading}
            dataSource={issued}
            pagination={{ pageSize: 20, showSizeChanger: false, position: ["bottomCenter"] }}
            locale={{ emptyText: filtering ? NO_MATCH : "No certificates issued yet." }}
            columns={[
              { title: "Number", dataIndex: "certificateNumber", render: (n: string) => <Typography.Text code>{n}</Typography.Text> },
              { title: "Recipient", dataIndex: "recipientName" },
              { title: "Company", key: "company", render: (_: unknown, c: TrainingCertificate) => c.companyName || enrollmentById.get(c.enrollmentId)?.name || "—" },
              { title: "Training", key: "training", render: (_: unknown, c: TrainingCertificate) => trainingName(c.trainingId) },
              { title: "Issued", key: "issued", render: (_: unknown, c: TrainingCertificate) => (c.issuedAt ? dayjs(c.issuedAt).format("DD MMM YYYY") : "—") },
              {
                title: "Status",
                key: "status",
                render: (_: unknown, c: TrainingCertificate) =>
                  c.status === "revoked" ? (
                    <Tooltip title={c.revokedReason}>
                      <Tag color="red">Revoked</Tag>
                    </Tooltip>
                  ) : (
                    <Tag color="green">Valid</Tag>
                  ),
              },
              {
                title: "",
                key: "actions",
                width: 110,
                render: (_: unknown, c: TrainingCertificate) => (
                  <Space>
                    {c.pdfUrl && (
                      <Tooltip title="Download">
                        <Button shape="circle" size="small" icon={<DownloadOutlined />} href={c.pdfUrl} target="_blank" rel="noreferrer" aria-label="Download certificate" />
                      </Tooltip>
                    )}
                    {c.status === "issued" && (
                      <Tooltip title="Revoke">
                        <Button shape="circle" size="small" danger icon={<StopOutlined />} onClick={() => { setText(""); setRevoking(c); }} aria-label="Revoke certificate" />
                      </Tooltip>
                    )}
                  </Space>
                ),
              },
            ]}
          />
        )}
      </MotionCard>
      )}

      <Modal wrapClassName="mobile-sheet" centered title="Correct the name" open={!!renaming} onCancel={() => setRenaming(null)} onOk={() => void submitRename()} okButtonProps={{ disabled: !text.trim() }} confirmLoading={busy} destroyOnClose>
        <Typography.Paragraph type="secondary">As it should appear on the certificate, e.g. as on their ID.</Typography.Paragraph>
        <Input value={text} onChange={(e) => setText(e.target.value)} />
      </Modal>

      <Modal
        wrapClassName="mobile-sheet"
        centered
        title={revoking ? `Revoke ${revoking.certificateNumber}` : ""}
        open={!!revoking}
        onCancel={() => setRevoking(null)}
        onOk={() => void submitRevoke()}
        okText="Revoke"
        okButtonProps={{ danger: true, disabled: !text.trim() }}
        confirmLoading={busy}
        destroyOnClose
      >
        <Typography.Paragraph>Anyone checking this certificate's code will see it is revoked. A replacement gets a new number.</Typography.Paragraph>
        <Input.TextArea rows={3} placeholder="Why" value={text} onChange={(e) => setText(e.target.value)} />
      </Modal>
      {ceremony.element}
    </div>
  );
}
