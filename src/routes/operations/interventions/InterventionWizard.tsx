import React, { useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
    Alert,
    Button,
    Card,
    Col,
    Descriptions,
    Input,
    InputNumber,
    Row,
    Select,
    Skeleton,
    Space,
    Radio,
    Switch,
    Tag,
    Typography,
    theme,
} from "antd";
import {
    DeleteOutlined,
    EditOutlined,
    PlusCircleOutlined,
    RobotOutlined,
    SyncOutlined,
} from "@ant-design/icons";
import {
    OUTCOME_TYPES,
    OUTCOME_TYPE_DEFAULTS,
    OUTCOME_TYPE_LABELS,
    type OutcomeType,
} from "@/services/evidenceModel";
import {
    suggestForStep,
    type BreakdownOption,
    type OutcomeOption,
    type ScheduleOption,
} from "@/services/interventionDesignService";

const { Text, Title } = Typography;

/** The same shape the classic form hands to `onFinish`, so saving is single-sourced. */
export type WizardValues = {
    interventionTitle: string;
    compulsory: boolean;
    recurrencePreset: ScheduleOption["frequency"];
    recurrenceStrict: boolean;
    recurrenceEndMode?: "fixed-cycles" | "until-closed" | "programme-end";
    recurrenceCycles?: number;
    defaultPlannedSessions: number;
    hasSubInterventions: boolean;
    subInterventions: { title: string; defaultPlannedSessions: number }[];
    subInterventionRotationMode: "rotate" | "repeat";
    deliverableName: string;
    deliverableDescription: string;
    intendedOutcome: string;
    outcomeType: OutcomeType | "";
    followUpAfterDays: number;
    followUpRequired?: boolean;
    smeCheckIn: boolean;
    outcomeFromSuggestion: boolean;
};

type Props = {
    departmentId: string;
    departmentName: string;
    /** Titles already in this department: shown as a hint and to avoid duplicates. */
    existingTitles?: string[];
    saving: boolean;
    onSubmit: (values: WizardValues) => void | Promise<void>;
    onCancel: () => void;
};

type Loadable<T> = {
    status: "idle" | "loading" | "ready" | "failed";
    message: string;
    options: T[];
};

const idle = <T,>(): Loadable<T> => ({ status: "idle", message: "", options: [] });

// The frequencies the system supports (the same ones the Library form and the
// MOV use). The assistant only recommends among these; it never invents one.
const STANDARD_SCHEDULES: ScheduleOption[] = [
    { label: "As needed", rationale: "Assigned only when required.", frequency: "as-needed", strict: false, endMode: "", cycles: 0, plannedSessions: 1 },
    { label: "Weekly", rationale: "Every week until closed.", frequency: "weekly", strict: true, endMode: "until-closed", cycles: 0, plannedSessions: 1 },
    { label: "Every two weeks", rationale: "Every second week until closed.", frequency: "bi-weekly", strict: true, endMode: "until-closed", cycles: 0, plannedSessions: 1 },
    { label: "Once a month", rationale: "Monthly until closed.", frequency: "monthly", strict: true, endMode: "until-closed", cycles: 0, plannedSessions: 1 },
];
const FALLBACK_BREAKDOWNS: BreakdownOption[] = [
    { label: "Single intervention", rationale: "One piece of work, no breakdown.", hasSubInterventions: false, rotationMode: "rotate", subInterventions: [], plannedSessions: 1 },
];

const frequencyText = (o: ScheduleOption) => {
    const base = { "as-needed": "As needed", weekly: "Weekly", "bi-weekly": "Every two weeks", monthly: "Once a month" }[o.frequency];
    if (o.frequency === "as-needed") return base;
    const end =
        o.endMode === "fixed-cycles" ? `for ${o.cycles} cycles`
            : o.endMode === "programme-end" ? "until the programme ends"
                : "until the HOD closes it";
    return `${base}, ${end}`;
};

const OptionCard: React.FC<{
    selected: boolean;
    onSelect: () => void;
    /** Recommended by the assistant: tinted so it stands out before it is chosen. */
    suggested?: boolean;
    children: React.ReactNode;
}> = ({ selected, onSelect, suggested, children }) => {
    const { token } = theme.useToken();
    return (
    <Card
        hoverable
        size="small"
        styles={{ body: { padding: "8px 12px" } }}
        onClick={onSelect}
        role="radio"
        aria-checked={selected}
        style={{
            height: "100%",
            cursor: "pointer",
            border: `1px solid ${selected ? token.colorPrimary : suggested ? token.colorPrimaryBorder : token.colorBorder}`,
            background: selected ? "rgba(22,119,255,0.06)" : suggested ? "rgba(22,119,255,0.03)" : undefined,
            boxShadow: selected ? "0 0 0 2px rgba(22,119,255,0.15)" : undefined,
        }}
    >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
            <Radio checked={selected} style={{ marginTop: 2 }} />
            <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
        </div>
    </Card>
    );
};

/** A card-shaped switch between "pick a suggestion" and "write my own". */
const ModeCard: React.FC<{
    icon: React.ReactNode;
    label: string;
    onClick: () => void;
}> = ({ icon, label, onClick }) => {
    const { token } = theme.useToken();
    return (
    <Card
        hoverable
        size="small"
        onClick={onClick}
        role="button"
        styles={{ body: { padding: "10px 12px" } }}
        style={{ border: `1px dashed ${token.colorPrimary}`, cursor: "pointer" }}
    >
        <Space>
            <span style={{ color: "#1677ff" }}>{icon}</span>
            <Text style={{ color: "#1677ff" }}>{label}</Text>
        </Space>
    </Card>
    );
};

const CardSkeletons: React.FC = () => (
    <Row gutter={[12, 12]}>
        {[0, 1, 2].map((i) => (
            <Col xs={24} md={8} key={i}>
                <Card size="small"><Skeleton active paragraph={{ rows: 3 }} title={false} /></Card>
            </Col>
        ))}
    </Row>
);

/** What a suggestion carries: its kind of change and follow-up, defaulted from the type. */
const carriedBy = (o: OutcomeOption) => ({
    kind: o.outcomeType ? OUTCOME_TYPE_LABELS[o.outcomeType] : "",
    days: o.followUpAfterDays || (o.outcomeType ? OUTCOME_TYPE_DEFAULTS[o.outcomeType].followUpAfterDays : 0),
});

const ReviewRow: React.FC<{
    label: string;
    onEdit: () => void;
    last?: boolean;
    children: React.ReactNode;
}> = ({ label, onEdit, last, children }) => (
    <div
        style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 12,
            padding: "10px 16px",
            borderBottom: last ? undefined : "1px solid rgba(5,5,5,0.06)",
        }}
    >
        <div style={{ flex: "0 0 96px", paddingTop: 2 }}>
            <Text type="secondary" style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: 0.4 }}>{label}</Text>
        </div>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>{children}</div>
        <Button type="text" icon={<EditOutlined />} aria-label={`Edit ${label}`} onClick={onEdit} />
    </div>
);

const RowSkeletons: React.FC<{ count?: number }> = ({ count = 3 }) => (
    <Space direction="vertical" size={8} style={{ width: "100%" }}>
        {Array.from({ length: count }, (_, i) => i).map((i) => (
            <Card key={i} size="small" styles={{ body: { padding: "8px 12px" } }}>
                <Skeleton active paragraph={{ rows: 1 }} title={{ width: "40%" }} />
            </Card>
        ))}
    </Space>
);

export const InterventionWizard: React.FC<Props> = ({
    departmentId,
    departmentName,
    existingTitles = [],
    saving,
    onSubmit,
    onCancel,
}) => {
    const [step, setStep] = useState(0);

    // Step 0
    const [title, setTitle] = useState("");
    const [context, setContext] = useState("");

    // Step 1: outcome & deliverable
    const [outcomes, setOutcomes] = useState<Loadable<OutcomeOption>>(idle());
    const [outcomePick, setOutcomePick] = useState<number | null>(null);
    const [deliverableName, setDeliverableName] = useState("");
    const [deliverableDescription, setDeliverableDescription] = useState("");
    const [intendedOutcome, setIntendedOutcome] = useState("");
    const [outcomeType, setOutcomeType] = useState<OutcomeType | "">("");
    const [followUpAfterDays, setFollowUpAfterDays] = useState(0);
    const [ownMode, setOwnMode] = useState(false);

    // Step 2: follow-up. null = follow the default (on whenever an outcome is set).
    const [followUpRequired, setFollowUpRequired] = useState<boolean | null>(null);
    const [smeCheckIn, setSmeCheckIn] = useState(false);
    const reduceMotion = useReducedMotion();

    // Step 2: schedule
    const [schedules, setSchedules] = useState<Loadable<ScheduleOption>>(idle());
    const [schedule, setSchedule] = useState<ScheduleOption | null>(null);

    // Step 3: structure
    const [breakdowns, setBreakdowns] = useState<Loadable<BreakdownOption>>(idle());
    const [breakdown, setBreakdown] = useState<BreakdownOption | null>(null);
    const [subs, setSubs] = useState<{ title: string; defaultPlannedSessions: number }[]>([]);
    const [compulsory, setCompulsory] = useState(false);

    const draft = () => ({
        deliverableName,
        intendedOutcome,
        recurrencePreset: schedule?.frequency || "",
    });

    // Bumped whenever the title or constraints change, so a slow answer for the
    // old wording can never land on the new one.
    const requestSeq = useRef(0);

    const load = async <S extends "outcomes" | "schedule" | "breakdown">(
        which: S,
        set: React.Dispatch<React.SetStateAction<Loadable<any>>>,
        fallback: any[] = []
    ) => {
        const seq = requestSeq.current;
        set({ status: "loading", message: "", options: [] });
        try {
            const result = await suggestForStep(which, {
                title: title.trim(),
                context: context.trim(),
                departmentId,
                draft: draft(),
            });
            if (seq !== requestSeq.current) return;
            set({ status: "ready", message: result.message, options: result.options });
        } catch (error) {
            if (seq !== requestSeq.current) return;
            set({
                status: "failed",
                message: error instanceof Error ? error.message : "The assistant is unavailable.",
                options: fallback,
            });
        }
    };

    // Editing one section from the review: remember everything so "Back to review" can undo it.
    const [editing, setEditing] = useState(false);
    const snapshot = useRef<Record<string, any> | null>(null);

    const editSection = (target: number) => {
        snapshot.current = {
            title, context, outcomePick, deliverableName, deliverableDescription, intendedOutcome,
            outcomeType, followUpAfterDays, followUpRequired, smeCheckIn, schedule, breakdown, subs, compulsory, ownMode,
        };
        setEditing(true);
        goTo(target);
    };

    const backToReview = () => {
        const snap = snapshot.current;
        if (snap) {
            requestSeq.current += 1;
            setTitle(snap.title); setContext(snap.context); setOutcomePick(snap.outcomePick);
            setDeliverableName(snap.deliverableName); setDeliverableDescription(snap.deliverableDescription);
            setIntendedOutcome(snap.intendedOutcome); setOutcomeType(snap.outcomeType);
            setFollowUpAfterDays(snap.followUpAfterDays); setFollowUpRequired(snap.followUpRequired);
            setSmeCheckIn(snap.smeCheckIn); setSchedule(snap.schedule); setBreakdown(snap.breakdown);
            setSubs(snap.subs); setCompulsory(snap.compulsory); setOwnMode(snap.ownMode);
            // Suggestions may have been reset by a title edit; they reload from the cache when revisited.
            setOutcomes(idle()); setSchedules(idle()); setBreakdowns(idle());
        }
        snapshot.current = null;
        setEditing(false);
        setStep(5);
    };

    const applyEdit = () => {
        // A changed title clears the later choices, so carry on through those steps instead.
        snapshot.current = null;
        setEditing(false);
        if (schedule && breakdown) setStep(5);
        else goTo(step + 1);
    };

    const goTo = (next: number) => {
        setStep(next);
        if (next === 1 && outcomes.status === "idle") void load("outcomes", setOutcomes);
        if (next === 3 && schedules.status === "idle") void load("schedule", setSchedules);
        if (next === 4 && breakdowns.status === "idle") void load("breakdown", setBreakdowns, FALLBACK_BREAKDOWNS);
    };

    const pickOutcome = (index: number) => {
        const o = outcomes.options[index];
        setOutcomePick(index);
        setDeliverableName(o.deliverableName);
        setDeliverableDescription(o.deliverableDescription);
        setIntendedOutcome(o.intendedOutcome);
        setOutcomeType(o.outcomeType);
        setFollowUpAfterDays(carriedBy(o).days);
    };

    const pickBreakdown = (option: BreakdownOption) => {
        setBreakdown(option);
        setSubs(option.subInterventions.map((s) => ({ ...s })));
    };

    // Editing text after choosing a card means the result is no longer the AI's wording.
    const edited = (setter: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        setter(e.target.value);
        setOutcomePick(null);
    };

    // The standard frequencies, with any the assistant recommends listed first.
    const orderedSchedules = useMemo(() => {
        const rows = STANDARD_SCHEDULES.map((standard) => ({
            standard,
            suggestion: schedules.options.find((o) => o.frequency === standard.frequency),
        }));
        const ordered = [...rows.filter((r) => r.suggestion), ...rows.filter((r) => !r.suggestion)];
        // The assistant lists its best fit first; only that one is flagged, so the flag still means something.
        return ordered.map((row) => ({ ...row, best: !!row.suggestion && row.suggestion === schedules.options[0] }));
    }, [schedules.options]);

    // Structure choices: the assistant's, plus a plain single intervention that is always available.
    const structureOptions = useMemo(() => {
        const suggested = breakdowns.status === "ready";
        // Best fit is listed first by the assistant; only that one is flagged.
        const rows = breakdowns.options.map((option, index) => ({ option, suggested: suggested && index === 0 }));
        if (!rows.some((r) => !r.option.hasSubInterventions)) {
            rows.push({ option: FALLBACK_BREAKDOWNS[0], suggested: false });
        }
        return rows;
    }, [breakdowns.options, breakdowns.status]);
    const sameBreakdown = (a: BreakdownOption | null, b: BreakdownOption) =>
        !!a && a.label === b.label && a.rationale === b.rationale && a.hasSubInterventions === b.hasSubInterventions;

    // Suggestions are the default; the manual fields show on request, or when there is nothing to suggest.
    const showOwn = ownMode || (outcomes.status !== "loading" && !outcomes.options.length);

    const hasOutcome = intendedOutcome.trim().length > 0;
    const followUpOn = hasOutcome && (followUpRequired ?? true);

    const cleanSubs = subs.filter((s) => s.title.trim());
    const hasSubs = !!breakdown?.hasSubInterventions && cleanSubs.length >= 2;

    const canNext = useMemo(() => {
        if (step === 0) return title.trim().length > 0;
        if (step === 3) return !!schedule;
        if (step === 4) return !!breakdown && (!breakdown.hasSubInterventions || cleanSubs.length >= 2);
        return true;
    }, [step, title, schedule, breakdown, cleanSubs.length]);

    const submit = () => {
        if (!schedule) return;
        void onSubmit({
            interventionTitle: title.trim(),
            compulsory,
            recurrencePreset: schedule.frequency,
            recurrenceStrict: schedule.frequency === "as-needed" ? true : schedule.strict,
            recurrenceEndMode: schedule.endMode || undefined,
            recurrenceCycles: schedule.endMode === "fixed-cycles" ? schedule.cycles : undefined,
            defaultPlannedSessions: breakdown?.plannedSessions || schedule.plannedSessions || 1,
            hasSubInterventions: hasSubs,
            subInterventions: hasSubs ? cleanSubs : [],
            subInterventionRotationMode: breakdown?.rotationMode || "rotate",
            deliverableName: deliverableName.trim(),
            deliverableDescription: deliverableDescription.trim(),
            intendedOutcome: intendedOutcome.trim(),
            outcomeType,
            followUpAfterDays,
            followUpRequired: hasOutcome ? followUpOn : undefined,
            smeCheckIn: followUpOn && smeCheckIn,
            outcomeFromSuggestion: outcomePick !== null,
        });
    };

    const assistantNote = (state: Loadable<any>) =>
        state.status === "failed" ? (
            <Alert
                type="info"
                showIcon
                style={{ marginBottom: 12 }}
                message="The assistant isn't available right now."
                description={`${state.message} You can still set this yourself below.`}
            />
        ) : null;

    return (
        <div>

            {step === 0 && (
                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                    <Title level={5} style={{ margin: 0 }}>What is this intervention called?</Title>
                    <Input
                        size="large"
                        autoFocus
                        placeholder={departmentName ? `Name this ${departmentName} intervention` : "Name this intervention"}
                        value={title}
                        onChange={(e) => {
                            setTitle(e.target.value);
                            // A new title makes earlier suggestions stale.
                            requestSeq.current += 1;
                            setOutcomes(idle()); setSchedules(idle()); setBreakdowns(idle());
                            setOutcomePick(null); setSchedule(null); setBreakdown(null);
                            setOwnMode(false);
                        }}
                        onPressEnter={() => title.trim() && goTo(1)}
                    />
                    <div>
                        <Text strong>Anything I should know?</Text>{" "}
                        <Text type="secondary">(optional)</Text>
                        <Input.TextArea
                            rows={3}
                            style={{ marginTop: 6 }}
                            placeholder="Who is it for, how long it should run, how it's delivered, any limits (e.g. 'monthly, no more than 6 months, group workshop')"
                            value={context}
                            onChange={(e) => {
                                setContext(e.target.value);
                                requestSeq.current += 1;
                                setOutcomes(idle()); setSchedules(idle()); setBreakdowns(idle());
                            }}
                        />
                    </div>
                    {departmentName ? (
                        <Text type="secondary">
                            This will be added to {departmentName}.
                            {existingTitles.length
                                ? ` Already there: ${existingTitles.slice(0, 4).join(", ")}${existingTitles.length > 4 ? "…" : ""}.`
                                : ""}
                        </Text>
                    ) : null}
                </Space>
            )}

            {step === 1 && (
                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                    <Title level={5} style={{ margin: 0 }}>What should the business end up with, and what should change?</Title>
                    {outcomes.status === "loading" ? <RowSkeletons /> : (
                        <div style={{ perspective: 1000 }}>
                            <AnimatePresence mode="wait" initial={false}>
                                {showOwn ? (
                                    <motion.div
                                        key="own"
                                        initial={{ rotateX: -90, opacity: 0 }}
                                        animate={{ rotateX: 0, opacity: 1 }}
                                        exit={{ rotateX: 90, opacity: 0 }}
                                        transition={{ duration: reduceMotion ? 0 : 0.2, ease: "easeInOut" }}
                                        style={{ transformOrigin: "center" }}
                                    >
                                        {assistantNote(outcomes)}
                                        <Card size="small" title={<><EditOutlined /> Write your own</>}>
                                            <Space direction="vertical" style={{ width: "100%" }} size={8}>
                                                <div>
                                                    <Text>Deliverable</Text>
                                                    <Input
                                                        placeholder="What the business ends up with, e.g. a plan, policy or report (leave empty if nothing is produced)"
                                                        value={deliverableName}
                                                        onChange={edited(setDeliverableName)}
                                                    />
                                                </div>
                                                <div>
                                                    <Text>What should be different afterwards?</Text>
                                                    <Input.TextArea
                                                        rows={2}
                                                        placeholder="Describe the change in the business once this is done"
                                                        value={intendedOutcome}
                                                        onChange={edited(setIntendedOutcome)}
                                                    />
                                                </div>
                                                <Row gutter={[12, 8]}>
                                                    <Col xs={24}>
                                                        <Text>Kind of change</Text>{" "}
                                                        <Text type="secondary">(optional)</Text>
                                                        <Select
                                                            allowClear
                                                            style={{ width: "100%" }}
                                                            placeholder="What sort of change is this?"
                                                            value={outcomeType || undefined}
                                                            onChange={(value?: OutcomeType) => {
                                                                setOutcomeType(value || "");
                                                                // Follow-up follows the type unless it was set by hand.
                                                                if (value && !followUpAfterDays) {
                                                                    setFollowUpAfterDays(OUTCOME_TYPE_DEFAULTS[value].followUpAfterDays);
                                                                }
                                                            }}
                                                            options={OUTCOME_TYPES.map((t) => ({ value: t, label: OUTCOME_TYPE_LABELS[t] }))}
                                                        />
                                                    </Col>
                                                </Row>
                                            </Space>
                                        </Card>
                                        {outcomes.options.length ? (
                                            <div style={{ marginTop: 8 }}>
                                                <ModeCard icon={<RobotOutlined />} label="Choose from suggestions" onClick={() => setOwnMode(false)} />
                                            </div>
                                        ) : null}
                                    </motion.div>
                                ) : (
                                    <motion.div
                                        key="suggested"
                                        initial={{ rotateX: 90, opacity: 0 }}
                                        animate={{ rotateX: 0, opacity: 1 }}
                                        exit={{ rotateX: -90, opacity: 0 }}
                                        transition={{ duration: reduceMotion ? 0 : 0.2, ease: "easeInOut" }}
                                        style={{ transformOrigin: "center" }}
                                    >
                                        {assistantNote(outcomes)}
                                        <Space direction="vertical" size={8} style={{ width: "100%" }}>
                                            {outcomes.options.map((o, i) => (
                                                <OptionCard key={i} selected={outcomePick === i} onSelect={() => pickOutcome(i)}>
                                                    <div style={{ paddingRight: 20 }}>
                                                        <Text strong>{o.deliverableName || "No document produced"}</Text>
                                                        <div style={{ fontSize: 13, color: "rgba(0,0,0,0.55)", lineHeight: 1.35 }}>
                                                            {o.intendedOutcome}
                                                        </div>
                                                        {carriedBy(o).kind || carriedBy(o).days ? (
                                                            <div style={{ marginTop: 6 }}>
                                                                {carriedBy(o).kind ? <Tag color="blue" style={{ marginInlineEnd: 6 }}>{carriedBy(o).kind}</Tag> : null}
                                                                {carriedBy(o).days ? <Tag>Check back in {carriedBy(o).days} days</Tag> : null}
                                                            </div>
                                                        ) : null}
                                                    </div>
                                                </OptionCard>
                                            ))}
                                        </Space>
                                        {outcomePick === null && (deliverableName || intendedOutcome) ? (
                                            <Text type="secondary" style={{ display: "block", marginTop: 8 }}>
                                                Using your own wording{deliverableName ? `: ${deliverableName}` : ""}
                                            </Text>
                                        ) : null}
                                        <div style={{ marginTop: 8 }}>
                                            <ModeCard
                                                icon={<EditOutlined />}
                                                label={outcomePick !== null ? "Edit or write my own" : "Write my own instead"}
                                                onClick={() => setOwnMode(true)}
                                            />
                                        </div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    )}
                    <Text type="secondary">You can skip this. It can be added later.</Text>
                </Space>
            )}

            {step === 2 && (
                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                    <Title level={5} style={{ margin: 0 }}>Should we check back later to see if the change lasted?</Title>
                    {!hasOutcome ? (
                        <Alert type="info" showIcon message="No intended change was set, so there is nothing to check back on." />
                    ) : (
                        <>
                            <OptionCard selected={followUpOn} onSelect={() => setFollowUpRequired(true)}>
                                <Text strong>Yes, check back</Text>
                                <div style={{ fontSize: 13, color: "rgba(0,0,0,0.55)" }}>The facilitator is asked to confirm the change is still in place.</div>
                            </OptionCard>
                            <OptionCard selected={!followUpOn} onSelect={() => setFollowUpRequired(false)}>
                                <Text strong>No, do not check back</Text>
                                <div style={{ fontSize: 13, color: "rgba(0,0,0,0.55)" }}>Nothing more is asked once the intervention is finished.</div>
                            </OptionCard>
                            {followUpOn ? (
                                <>
                                    <div>
                                        <Text>Check back after</Text>
                                        <InputNumber
                                            min={7}
                                            max={365}
                                            style={{ width: "100%" }}
                                            addonAfter="days"
                                            value={followUpAfterDays || null}
                                            placeholder="e.g. 60"
                                            onChange={(value) => setFollowUpAfterDays(Number(value) || 0)}
                                        />
                                    </div>
                                    <Text strong>Who gives the update?</Text>
                                    <OptionCard selected={!smeCheckIn} onSelect={() => setSmeCheckIn(false)}>
                                        <Text strong>Facilitator only</Text>
                                        <div style={{ fontSize: 13, color: "rgba(0,0,0,0.55)" }}>The facilitator records what they observed.</div>
                                    </OptionCard>
                                    <OptionCard selected={smeCheckIn} onSelect={() => setSmeCheckIn(true)}>
                                        <Text strong>Facilitator and the SME</Text>
                                        <div style={{ fontSize: 13, color: "rgba(0,0,0,0.55)" }}>The SME is also asked one quick question: are they still using it?</div>
                                    </OptionCard>
                                </>
                            ) : null}
                        </>
                    )}
                </Space>
            )}

            {step === 3 && (
                <Space direction="vertical" size={10} style={{ width: "100%" }}>
                    <Title level={5} style={{ margin: 0 }}>How often should it happen?</Title>
                    {schedules.status === "loading" ? (
                        <RowSkeletons count={STANDARD_SCHEDULES.length} />
                    ) : (
                        <>
                            {schedules.status === "failed" ? (
                                <Text type="secondary">Suggestions aren't available right now. Choose from the options below.</Text>
                            ) : null}
                            {orderedSchedules.map(({ standard, suggestion, best }) => {
                                const option: ScheduleOption = suggestion
                                    ? { ...suggestion, label: standard.label }
                                    : { ...standard };
                                const chosen = schedule?.frequency === standard.frequency;
                                return (
                                    <div key={standard.frequency}>
                                        <OptionCard
                                            selected={chosen}
                                            suggested={best}
                                            onSelect={() => setSchedule({ ...option })}
                                        >
                                            <Space size={8} wrap>
                                                <Text strong>{standard.label}</Text>
                                                {best ? <Tag color="blue" icon={<RobotOutlined />} style={{ marginInlineEnd: 0 }}>Suggested</Tag> : null}
                                            </Space>
                                            <div>{frequencyText(chosen && schedule ? schedule : option)}</div>
                                            <Text type="secondary" style={{ fontSize: 12 }}>
                                                {suggestion?.rationale || standard.rationale}
                                            </Text>
                                        </OptionCard>
                                        <AnimatePresence initial={false}>
                                            {chosen && schedule && standard.frequency !== "as-needed" ? (
                                                <motion.div
                                                    key="duration"
                                                    initial={{ height: 0, opacity: 0 }}
                                                    animate={{ height: "auto", opacity: 1 }}
                                                    exit={{ height: 0, opacity: 0 }}
                                                    transition={{ duration: reduceMotion ? 0 : 0.2, ease: "easeInOut" }}
                                                    style={{ overflow: "hidden" }}
                                                >
                                                    <Card size="small" title="How long should it run?" style={{ marginTop: 8 }}>
                                                        <Space direction="vertical" style={{ width: "100%" }} size={10}>
                                                            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                                                                <Select
                                                                    style={{ flex: "1 1 220px", minWidth: 0 }}
                                                                    value={schedule.endMode || "until-closed"}
                                                                    onChange={(endMode: ScheduleOption["endMode"]) =>
                                                                        setSchedule({ ...schedule, endMode, cycles: endMode === "fixed-cycles" ? schedule.cycles || 3 : 0 })
                                                                    }
                                                                    options={[
                                                                        { value: "fixed-cycles", label: "After a set number of cycles" },
                                                                        { value: "until-closed", label: "Until the HOD closes it" },
                                                                        { value: "programme-end", label: "Until the programme ends" },
                                                                    ]}
                                                                />
                                                                {schedule.endMode === "fixed-cycles" ? (
                                                                    <>
                                                                        <InputNumber
                                                                            min={1}
                                                                            style={{ width: 80 }}
                                                                            value={schedule.cycles}
                                                                            onChange={(cycles) => setSchedule({ ...schedule, cycles: Number(cycles) || 1 })}
                                                                        />
                                                                        <Tag icon={<SyncOutlined />} style={{ marginInlineEnd: 0, borderRadius: 999, paddingInline: 10 }}>cycles</Tag>
                                                                    </>
                                                                ) : null}
                                                            </div>
                                                            <Text strong>Is it expected every cycle?</Text>
                                                            <div style={{ display: "flex", gap: 8 }}>
                                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                                    <OptionCard selected={schedule.strict} onSelect={() => setSchedule({ ...schedule, strict: true })}>
                                                                        <Text strong>Yes, every cycle</Text>
                                                                        <div style={{ fontSize: 13, color: "rgba(0,0,0,0.55)" }}>Tracked as missed if skipped.</div>
                                                                    </OptionCard>
                                                                </div>
                                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                                    <OptionCard selected={!schedule.strict} onSelect={() => setSchedule({ ...schedule, strict: false })}>
                                                                        <Text strong>No, can be skipped</Text>
                                                                        <div style={{ fontSize: 13, color: "rgba(0,0,0,0.55)" }}>Assigned only when needed.</div>
                                                                    </OptionCard>
                                                                </div>
                                                            </div>
                                                        </Space>
                                                    </Card>
                                                </motion.div>
                                            ) : null}
                                        </AnimatePresence>
                                    </div>
                                );
                            })}
                        </>
                    )}
                </Space>
            )}

            {step === 4 && (
                <Space direction="vertical" size={10} style={{ width: "100%" }}>
                    <Title level={5} style={{ margin: 0 }}>How is the work structured?</Title>
                    {breakdowns.status === "loading" ? (
                        <RowSkeletons count={3} />
                    ) : (
                        <>
                            {breakdowns.status === "failed" ? (
                                <Text type="secondary">Suggestions aren't available right now. Choose from the options below.</Text>
                            ) : null}
                            {structureOptions.map(({ option: o, suggested }, i) => {
                                const chosen = sameBreakdown(breakdown, o);
                                return (
                                    <div key={i}>
                                        <OptionCard selected={chosen} suggested={suggested} onSelect={() => pickBreakdown(o)}>
                                            <Space size={8} wrap>
                                                <Text strong>{o.label}</Text>
                                                {suggested ? <Tag color="blue" icon={<RobotOutlined />} style={{ marginInlineEnd: 0 }}>Suggested</Tag> : null}
                                                {o.hasSubInterventions ? (
                                                    <Tag style={{ marginInlineEnd: 0, borderRadius: 999 }}>{o.subInterventions.length} steps</Tag>
                                                ) : null}
                                            </Space>
                                            {o.rationale ? (
                                                <div><Text type="secondary" style={{ fontSize: 12 }}>{o.rationale}</Text></div>
                                            ) : null}
                                            {o.hasSubInterventions && !chosen ? (
                                                <div style={{ marginTop: 4, fontSize: 13, color: "rgba(0,0,0,0.65)" }}>
                                                    {o.subInterventions.map((sub) => sub.title).join("  →  ")}
                                                </div>
                                            ) : null}
                                        </OptionCard>
                                        <AnimatePresence initial={false}>
                                            {chosen && o.hasSubInterventions ? (
                                                <motion.div
                                                    key="steps"
                                                    initial={{ height: 0, opacity: 0 }}
                                                    animate={{ height: "auto", opacity: 1 }}
                                                    exit={{ height: 0, opacity: 0 }}
                                                    transition={{ duration: reduceMotion ? 0 : 0.2, ease: "easeInOut" }}
                                                    style={{ overflow: "hidden" }}
                                                >
                                                    <Card size="small" title="Steps, in delivery order" style={{ marginTop: 8 }}>
                                                        <Space direction="vertical" style={{ width: "100%" }} size={8}>
                                                            {subs.map((sub, j) => (
                                                                <Space.Compact key={j} style={{ width: "100%" }}>
                                                                    <Input
                                                                        value={sub.title}
                                                                        placeholder={`Step ${j + 1}`}
                                                                        onChange={(e) => setSubs(subs.map((x, k) => (k === j ? { ...x, title: e.target.value } : x)))}
                                                                    />
                                                                    <Button icon={<DeleteOutlined />} aria-label="Remove step" onClick={() => setSubs(subs.filter((_, k) => k !== j))} />
                                                                </Space.Compact>
                                                            ))}
                                                            <Button type="dashed" icon={<PlusCircleOutlined />} onClick={() => setSubs([...subs, { title: "", defaultPlannedSessions: 1 }])}>
                                                                Add step
                                                            </Button>
                                                            {cleanSubs.length < 2 ? <Text type="danger">Add at least 2 steps, or pick a single intervention.</Text> : null}
                                                        </Space>
                                                    </Card>
                                                </motion.div>
                                            ) : null}
                                        </AnimatePresence>
                                    </div>
                                );
                            })}
                        </>
                    )}
                    <Text strong style={{ marginTop: 6 }}>Is it compulsory for every accepted SME?</Text>
                    <div style={{ display: "flex", gap: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <OptionCard selected={compulsory} onSelect={() => setCompulsory(true)}>
                                <Text strong>Yes, compulsory</Text>
                                <div style={{ fontSize: 13, color: "rgba(0,0,0,0.55)" }}>Added to every accepted SME's plan.</div>
                            </OptionCard>
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <OptionCard selected={!compulsory} onSelect={() => setCompulsory(false)}>
                                <Text strong>No, assigned as needed</Text>
                                <div style={{ fontSize: 13, color: "rgba(0,0,0,0.55)" }}>Assigned to SMEs one by one.</div>
                            </OptionCard>
                        </div>
                    </div>
                </Space>
            )}

            {step === 5 && schedule && (
                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                    <Title level={5} style={{ margin: 0 }}>Review and add</Title>
                    <Card size="small" styles={{ body: { padding: 0 } }}>
                        <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(5,5,5,0.06)", display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                                <Title level={5} style={{ margin: 0 }}>{title.trim()}</Title>
                                {departmentName ? <Text type="secondary">{departmentName}</Text> : null}
                            </div>
                            <Button type="text" icon={<EditOutlined />} aria-label="Edit name" onClick={() => editSection(0)} />
                        </div>

                        <ReviewRow label="Outcome" onEdit={() => editSection(1)}>
                            <Space size={6} wrap>
                                {deliverableName.trim()
                                    ? <Tag color="blue" style={{ marginInlineEnd: 0 }}>{deliverableName.trim()}</Tag>
                                    : <Text type="secondary">No deliverable</Text>}
                                {outcomeType ? <Tag style={{ marginInlineEnd: 0, borderRadius: 999 }}>{OUTCOME_TYPE_LABELS[outcomeType]}</Tag> : null}
                            </Space>
                            <div>{intendedOutcome.trim() || <Text type="secondary">No intended change set</Text>}</div>
                        </ReviewRow>

                        <ReviewRow label="Check-back" onEdit={() => editSection(2)}>
                            {!hasOutcome ? (
                                <Text type="secondary">Nothing to check back on</Text>
                            ) : followUpOn ? (
                                <Space size={6} wrap>
                                    <Tag style={{ marginInlineEnd: 0, borderRadius: 999 }}>After {followUpAfterDays || 60} days</Tag>
                                    <Tag style={{ marginInlineEnd: 0, borderRadius: 999 }}>{smeCheckIn ? "Facilitator + SME" : "Facilitator"}</Tag>
                                </Space>
                            ) : (
                                <Text type="secondary">No check-back</Text>
                            )}
                        </ReviewRow>

                        <ReviewRow label="Schedule" onEdit={() => editSection(3)}>
                            <div>{frequencyText(schedule)}</div>
                            {schedule.frequency !== "as-needed" ? (
                                <Tag style={{ marginInlineEnd: 0, borderRadius: 999 }}>{schedule.strict ? "Expected every cycle" : "Can be skipped"}</Tag>
                            ) : null}
                        </ReviewRow>

                        <ReviewRow label="Structure" onEdit={() => editSection(4)}>
                            {hasSubs ? (
                                <ol style={{ margin: 0, paddingLeft: 18 }}>
                                    {cleanSubs.map((sub, i) => <li key={i}>{sub.title}</li>)}
                                </ol>
                            ) : (
                                <div>Single intervention</div>
                            )}
                        </ReviewRow>

                        <ReviewRow label="Compulsory" onEdit={() => editSection(4)} last>
                            <Tag color={compulsory ? "orange" : undefined} style={{ marginInlineEnd: 0, borderRadius: 999 }}>
                                {compulsory ? "Yes, for every accepted SME" : "No, assigned as needed"}
                            </Tag>
                        </ReviewRow>
                    </Card>
                </Space>
            )}

            <div style={{ display: "flex", gap: 8, marginTop: 24 }}>
                {editing && step < 5 ? (
                    <>
                        <Button block size="large" shape="round" style={{ flex: 1 }} onClick={backToReview}>
                            Back to review
                        </Button>
                        <Button block size="large" type="primary" shape="round" style={{ flex: 1 }} disabled={!canNext} onClick={applyEdit}>
                            Update
                        </Button>
                    </>
                ) : (
                    <>
                        <Button
                            block
                            size="large"
                            shape="round"
                            style={{ flex: 1 }}
                            onClick={step === 0 ? onCancel : () => setStep(step - 1)}
                        >
                            {step === 0 ? "Cancel" : "Back"}
                        </Button>
                        {step === 1 ? (
                            <Button
                                block
                                size="large"
                                shape="round"
                                style={{ flex: 1 }}
                                onClick={() => {
                                    setOutcomePick(null); setDeliverableName(""); setDeliverableDescription("");
                                    setIntendedOutcome(""); setOutcomeType(""); setFollowUpAfterDays(0);
                                    setOwnMode(false);
                                    goTo(3);
                                }}
                            >
                                Skip
                            </Button>
                        ) : null}
                        {step < 5 ? (
                            <Button
                                block
                                size="large"
                                type="primary"
                                shape="round"
                                style={{ flex: 1 }}
                                disabled={!canNext}
                                onClick={() => goTo(step + 1)}
                            >
                                Next
                            </Button>
                        ) : (
                            <Button
                                block
                                size="large"
                                type="primary"
                                shape="round"
                                style={{ flex: 1 }}
                                loading={saving}
                                onClick={submit}
                                className="guide-intervention-submit"
                            >
                                Add intervention
                            </Button>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};

export default InterventionWizard;
