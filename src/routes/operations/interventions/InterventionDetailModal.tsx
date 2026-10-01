import React, { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Button, Col, Grid, Modal, Row, Segmented, Skeleton, Space, Statistic, Steps, Tag, Typography } from "antd";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/firebase";
import { summariseDelivery, type DeliverySummary } from "@/services/interventionDeliverySummary";
import { EditOutlined } from "@ant-design/icons";
import { OUTCOME_TYPE_LABELS, type OutcomeDef } from "@/services/evidenceModel";

const { Text, Title } = Typography;

export type DetailRecord = {
    id: string;
    interventionTitle: string;
    areaOfSupport?: string;
    departmentId?: string | null;
    compulsory?: boolean;
    recurring?: boolean;
    frequency?: string | null;
    recurrenceStrict?: boolean | null;
    recurrenceEnd?: { mode?: string; cycles?: number | null; endDate?: any } | null;
    hasSubInterventions?: boolean;
    subInterventions?: Array<{ subId: string; title: string; defaultPlannedSessions?: number; active?: boolean; archivedAt?: any }>;
    subInterventionRotationMode?: "rotate" | "repeat";
    defaultPlannedSessions?: number;
    definitionVersion?: number;
    outcomeDef?: OutcomeDef | null;
};

type Props = {
    record: DetailRecord | null;
    departmentLabel?: string;
    onClose: () => void;
    onEdit: (record: DetailRecord) => void;
};

const SECTIONS = [
    { key: "overview", label: "Overview" },
    { key: "outcome", label: "Outcome" },
    { key: "checkback", label: "Check-back" },
    { key: "schedule", label: "Schedule" },
    { key: "structure", label: "Structure" },
    { key: "delivery", label: "Delivery" },
] as const;
type SectionKey = (typeof SECTIONS)[number]["key"];

const FREQUENCY_LABELS: Record<string, string> = {
    "as-needed": "As needed",
    weekly: "Weekly",
    "bi-weekly": "Every two weeks",
    monthly: "Once a month",
};

const END_LABELS: Record<string, string> = {
    "fixed-cycles": "After a set number of cycles",
    "end-date": "On a specific date",
    "until-closed": "Until the HOD closes it",
    "programme-end": "Until the programme ends",
};

const toDate = (value: any): Date | null => {
    if (!value) return null;
    if (typeof value?.toDate === "function") return value.toDate();
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <div style={{ marginBottom: 14 }}>
        <Text type="secondary" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4, display: "block" }}>
            {label}
        </Text>
        <div>{children}</div>
    </div>
);

// Read only when the Delivery section is opened, then reused for a few minutes.
const DELIVERY_TTL_MS = 5 * 60 * 1000;
const deliveryCache = new Map<string, { at: number; value: DeliverySummary }>();

const DeliverySection: React.FC<{ interventionId: string }> = ({ interventionId }) => {
    const [summary, setSummary] = useState<DeliverySummary | null>(null);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        let cancelled = false;
        const cached = deliveryCache.get(interventionId);
        if (cached && Date.now() - cached.at < DELIVERY_TTL_MS) {
            setSummary(cached.value);
            return;
        }
        setSummary(null);
        setFailed(false);
        const byIntervention = (name: string) =>
            getDocs(query(collection(db, name), where("interventionId", "==", interventionId)));
        Promise.all([
            byIntervention("assignedInterventions"),
            byIntervention("movDocuments").catch(() => null),
            byIntervention("outcomeFollowUps").catch(() => null),
        ])
            .then(([assignments, movs, followUps]) => {
                if (cancelled) return;
                const value = summariseDelivery(
                    assignments.docs.map((d) => d.data()),
                    movs?.docs.map((d) => d.data()) ?? [],
                    followUps?.docs.map((d) => d.data()) ?? []
                );
                deliveryCache.set(interventionId, { at: Date.now(), value });
                setSummary(value);
            })
            .catch((error) => {
                console.error("Could not load delivery figures", error);
                if (!cancelled) setFailed(true);
            });
        return () => { cancelled = true; };
    }, [interventionId]);

    if (failed) return <Text type="secondary">Delivery figures could not be loaded.</Text>;
    if (!summary) return <Skeleton active paragraph={{ rows: 4 }} />;

    const tile = (title: string, value: number, hint?: string) => (
        <Col xs={12} md={8} key={title}>
            <Statistic title={title} value={value} />
            {hint ? <Text type="secondary" style={{ fontSize: 11 }}>{hint}</Text> : null}
        </Col>
    );

    return (
        <Space direction="vertical" size={16} style={{ width: "100%" }}>
            <div>
                <Text type="secondary" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4 }}>Delivered</Text>
                <Row gutter={[12, 12]} style={{ marginTop: 6 }}>
                    {tile("Assigned", summary.assigned)}
                    {tile("In delivery", summary.inDelivery)}
                    {tile("Awaiting SME", summary.awaitingSme)}
                    {tile("Completed", summary.completed)}
                    {tile("Closed", summary.closed, "Support ended")}
                </Row>
            </div>
            <div>
                <Text type="secondary" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4 }}>Evidence</Text>
                <Row gutter={[12, 12]} style={{ marginTop: 6 }}>
                    {tile("MOV approved", summary.movApproved, "Proof of delivery")}
                    {tile("Deliverable received", summary.deliverableReceived, "A file was produced")}
                </Row>
            </div>
            <div>
                <Text type="secondary" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4 }}>Outcome</Text>
                <Row gutter={[12, 12]} style={{ marginTop: 6 }}>
                    {tile("Achieved", summary.outcomeAchieved)}
                    {tile("Partially", summary.outcomePartial)}
                    {tile("Not yet", summary.outcomeNotYet)}
                    {tile("Check-back due", summary.checkBackDue, "Waiting for an answer")}
                </Row>
            </div>
            <Text type="secondary" style={{ fontSize: 12 }}>
                Completed work is not counted as an achieved outcome. That needs a check-back.
            </Text>
        </Space>
    );
};

const NotSet: React.FC<{ text?: string }> = ({ text = "Not set" }) => <Text type="secondary">{text}</Text>;

export const InterventionDetailModal: React.FC<Props> = ({ record, departmentLabel, onClose, onEdit }) => {
    const [section, setSection] = useState<SectionKey>("overview");
    const screens = Grid.useBreakpoint();
    const reduceMotion = useReducedMotion();
    const compact = !screens.md;

    // Every opening starts at the overview.
    useEffect(() => {
        if (record) setSection("overview");
    }, [record?.id]);

    const def = record?.outcomeDef || null;
    const followUp = def?.followUp;
    const activeSubs = (record?.subInterventions || []).filter((s) => s.active !== false && !s.archivedAt);

    const renderSection = () => {
        if (!record) return null;
        switch (section) {
            case "overview":
                return (
                    <>
                        <Field label="Department">{departmentLabel || record.areaOfSupport || <NotSet />}</Field>
                        <Field label="Compulsory">
                            <Tag color={record.compulsory ? "red" : undefined} style={{ borderRadius: 999 }}>
                                {record.compulsory ? "Yes, for every accepted SME" : "No, assigned as needed"}
                            </Tag>
                        </Field>
                        <Field label="Definition version">v{record.definitionVersion || 1}</Field>
                    </>
                );
            case "outcome":
                return def && (def.deliverable?.name || def.intendedOutcome) ? (
                    <>
                        <Field label="Deliverable">
                            {def.deliverable?.name ? <Tag color="blue">{def.deliverable.name}</Tag> : <NotSet text="No deliverable" />}
                        </Field>
                        {def.deliverable?.description ? <Field label="Deliverable notes">{def.deliverable.description}</Field> : null}
                        <Field label="What should be different afterwards">
                            {def.intendedOutcome || <NotSet />}
                        </Field>
                        <Field label="Kind of change">
                            {def.outcomeType ? <Tag style={{ borderRadius: 999 }}>{OUTCOME_TYPE_LABELS[def.outcomeType]}</Tag> : <NotSet />}
                        </Field>
                        <Field label="Written by">{def.origin === "ai_suggested" ? "Chosen from an assistant suggestion" : "Written by your team"}</Field>
                    </>
                ) : (
                    <NotDefined onEdit={() => record && onEdit(record)} what="an outcome" />
                );
            case "checkback":
                return followUp?.required ? (
                    <>
                        <Field label="Check back">After {def?.followUpAfterDays || 60} days</Field>
                        <Field label="Who gives the update">
                            <Space size={6} wrap>
                                <Tag style={{ borderRadius: 999 }}>Facilitator</Tag>
                                {followUp.smeCheckIn ? <Tag style={{ borderRadius: 999 }}>The SME</Tag> : null}
                            </Space>
                        </Field>
                    </>
                ) : def?.intendedOutcome ? (
                    <Field label="Check back"><NotSet text="No check-back for this intervention" /></Field>
                ) : (
                    <NotDefined onEdit={() => record && onEdit(record)} what="a check-back" />
                );
            case "schedule": {
                const freq = record.frequency || (record.recurring ? "monthly" : "as-needed");
                const end = record.recurrenceEnd;
                const endDate = toDate(end?.endDate);
                return (
                    <>
                        <Field label="Frequency">{FREQUENCY_LABELS[freq] || freq}</Field>
                        {record.recurring ? (
                            <>
                                <Field label="Runs">
                                    {end?.mode ? END_LABELS[end.mode] || end.mode : END_LABELS["until-closed"]}
                                    {end?.mode === "fixed-cycles" && end.cycles ? ` (${end.cycles} cycles)` : ""}
                                    {end?.mode === "end-date" && endDate ? ` (${endDate.toLocaleDateString()})` : ""}
                                </Field>
                                <Field label="Expected every cycle">
                                    <Tag style={{ borderRadius: 999 }}>{record.recurrenceStrict === false ? "No, can be skipped" : "Yes"}</Tag>
                                </Field>
                            </>
                        ) : null}
                        {!record.hasSubInterventions ? (
                            <Field label="Typical sessions">{record.defaultPlannedSessions || 1}</Field>
                        ) : null}
                    </>
                );
            }
            case "delivery":
                return <DeliverySection interventionId={record.id} />;
            case "structure":
                return record.hasSubInterventions && activeSubs.length ? (
                    <>
                        <Field label="Steps, in delivery order">
                            <ol style={{ margin: 0, paddingLeft: 20 }}>
                                {activeSubs.map((sub) => (
                                    <li key={sub.subId} style={{ marginBottom: 4 }}>
                                        {sub.title}
                                        <Text type="secondary"> · {sub.defaultPlannedSessions || 1} session{(sub.defaultPlannedSessions || 1) === 1 ? "" : "s"}</Text>
                                    </li>
                                ))}
                            </ol>
                        </Field>
                        <Field label="Each new cycle">
                            {record.subInterventionRotationMode === "repeat" ? "Repeats the same step" : "Moves to the next step"}
                        </Field>
                    </>
                ) : (
                    <Field label="Structure">Single intervention, no breakdown</Field>
                );
        }
    };

    return (
        <Modal
            centered
            open={!!record}
            onCancel={onClose}
            width={820}
            destroyOnClose
            title={
                <Space direction="vertical" size={2}>
                    <Title level={5} style={{ margin: 0 }}>{record?.interventionTitle}</Title>
                    <Space size={6} wrap>
                        {record?.compulsory ? <Tag color="red" style={{ marginInlineEnd: 0 }}>Compulsory</Tag> : null}
                        <Tag color={record?.recurring ? "geekblue" : "blue"} style={{ marginInlineEnd: 0 }}>
                            {record?.recurring ? "Scheduled" : "As needed"}
                        </Tag>
                    </Space>
                </Space>
            }
            footer={[
                <Button key="close" shape="round" onClick={onClose}>Close</Button>,
                <Button key="edit" type="primary" shape="round" icon={<EditOutlined />} onClick={() => record && onEdit(record)}>
                    Edit
                </Button>,
            ]}
        >
            <Row gutter={[24, 16]} style={{ minHeight: compact ? undefined : 320 }}>
                <Col xs={24} md={7}>
                    {compact ? (
                        <div style={{ overflowX: "auto" }}>
                            <Segmented
                                value={section}
                                onChange={(value) => setSection(value as SectionKey)}
                                options={SECTIONS.map((s) => ({ value: s.key, label: s.label }))}
                            />
                        </div>
                    ) : (
                        <Steps
                            direction="vertical"
                            size="small"
                            current={SECTIONS.findIndex((s) => s.key === section)}
                            onChange={(index) => setSection(SECTIONS[index].key)}
                            items={SECTIONS.map((s) => ({
                                title: s.label,
                                // Sections are places to visit, not stages to finish: no ticks.
                                status: s.key === section ? "process" : "wait",
                            }))}
                        />
                    )}
                </Col>
                <Col xs={24} md={17}>
                    <AnimatePresence mode="wait" initial={false}>
                        <motion.div
                            key={section}
                            initial={{ opacity: 0, x: reduceMotion ? 0 : 12 }}
                            animate={{ opacity: 1, x: 0 }}
                            exit={{ opacity: 0, x: reduceMotion ? 0 : -12 }}
                            transition={{ duration: reduceMotion ? 0 : 0.14 }}
                        >
                            {renderSection()}
                        </motion.div>
                    </AnimatePresence>
                </Col>
            </Row>
        </Modal>
    );
};

const NotDefined: React.FC<{ what: string; onEdit: () => void }> = ({ what, onEdit }) => (
    <Space direction="vertical" size={8}>
        <Text type="secondary">This intervention has no {what} yet.</Text>
        <Button shape="round" icon={<EditOutlined />} onClick={onEdit}>Set it now</Button>
    </Space>
);

export default InterventionDetailModal;
