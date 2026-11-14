import React, { useEffect, useMemo, useState } from "react";
import { Empty, Grid, Skeleton, Tag, Typography } from "antd";
import { RightOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import { collectionGroup, getDoc, onSnapshot, query, where, type Timestamp } from "firebase/firestore";
import dayjs from "dayjs";
import { db } from "@/firebase";
import { useFullIdentity } from "@/hooks/useFullIdentity";
import { MotionCard } from "@/components/dashboards/metrics/Header";
import { EntityAvatar } from "@/components/workspace";

const { Title, Text } = Typography;

type Row = {
  formId: string;
  title: string;
  description: string;
  dueDate: Date | null;
  sentAt: Date | null;
  completed: boolean;
  started: boolean;
};

const toDate = (value?: Timestamp | null) => (value && typeof value.toDate === "function" ? value.toDate() : null);

/**
 * The person's own copies of each survey. Training SMEs answer as a person:
 * users.participantId is the company (shared with colleagues), so their copy
 * is keyed by trainingAttendeeId, or {enrollmentId}_director for a director
 * from before people were recorded. Same ids as the answer page.
 */
export const useTrainingPersonIds = () => {
  const { user } = useFullIdentity();
  const profile = (user || {}) as Record<string, unknown>;
  const attendeeId = String(profile.trainingAttendeeId || "").trim();
  const enrollmentId = String(profile.participantId || "").trim();
  const isEmployee = profile.trainingRole === "employee";
  return useMemo(() => {
    const ids = [attendeeId];
    if (!isEmployee && enrollmentId) ids.push(`${enrollmentId}_director`);
    return Array.from(new Set(ids.filter(Boolean)));
  }, [attendeeId, enrollmentId, isEmployee]);
};

/** /training/surveys — surveys sent to this person, to answer or look back on. */
export default function SmeSurveys() {
  const navigate = useNavigate();
  const ids = useTrainingPersonIds();
  const idsKey = ids.join("|");
  const padding = Grid.useBreakpoint().md ? 24 : 16;
  const [rowsById, setRowsById] = useState<Record<string, Row[]>>({});
  const [loaded, setLoaded] = useState<Set<string>>(new Set());

  useEffect(() => {
    const personIds = idsKey ? idsKey.split("|") : [];
    setRowsById({});
    setLoaded(new Set());
    // One equality query per id: the rules can prove each one is this person's.
    const unsubscribes = personIds.map((personId) =>
      onSnapshot(
        query(collectionGroup(db, "responses"), where("participantId", "==", personId)),
        async (snap) => {
          const rows = await Promise.all(
            snap.docs.map(async (response) => {
              const data = response.data() as any;
              const formRef = response.ref.parent.parent;
              const form = formRef ? await getDoc(formRef).then((s) => (s.exists() ? (s.data() as any) : null)).catch(() => null) : null;
              if (!formRef || !form) return null;
              return {
                formId: formRef.id,
                title: String(form.title || "Survey"),
                description: String(form.description || ""),
                dueDate: toDate(form.dueDate),
                sentAt: toDate(form.sentAt),
                completed: data.completed === true,
                started: !!data.answersDraft && Object.keys(data.answersDraft).length > 0,
              } as Row;
            })
          );
          setRowsById((previous) => ({ ...previous, [personId]: rows.filter((r): r is Row => !!r) }));
          setLoaded((previous) => new Set(previous).add(personId));
        },
        (error) => {
          console.error("Failed to load surveys", error);
          setLoaded((previous) => new Set(previous).add(personId));
        }
      )
    );
    return () => unsubscribes.forEach((unsubscribe) => unsubscribe());
  }, [idsKey]);

  const loading = ids.length > 0 && ids.some((id) => !loaded.has(id));

  // Open ones first (soonest due), then the rest, newest first.
  const rows = useMemo(() => {
    const now = Date.now();
    const all = Object.values(rowsById).flat();
    const unique = Array.from(new Map(all.map((r) => [r.formId, r])).values());
    const isOpen = (r: Row) => !r.completed && (!r.dueDate || r.dueDate.getTime() >= now);
    return unique.sort((a, b) => {
      if (isOpen(a) !== isOpen(b)) return isOpen(a) ? -1 : 1;
      if (isOpen(a)) return (a.dueDate?.getTime() ?? Infinity) - (b.dueDate?.getTime() ?? Infinity);
      return (b.sentAt?.getTime() ?? 0) - (a.sentAt?.getTime() ?? 0);
    });
  }, [rowsById]);

  const statusOf = (row: Row) => {
    if (row.completed) return <Tag color="success">Submitted</Tag>;
    if (row.dueDate && row.dueDate.getTime() < Date.now()) return <Tag>Closed</Tag>;
    if (row.started) return <Tag color="processing">In progress</Tag>;
    return <Tag color="warning">To do</Tag>;
  };

  return (
    <div style={{ padding }}>
      <MotionCard>
        <Title level={4} style={{ marginTop: 0 }}>
          Surveys
        </Title>
        <Text type="secondary">Questionnaires from the Training Academy. Your answers are saved as you go.</Text>
        <div style={{ marginTop: 16 }}>
          {loading ? (
            <Skeleton active />
          ) : rows.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="No surveys for you yet" />
          ) : (
            <div role="list" aria-label="Surveys" style={{ display: "grid", gap: 4 }}>
              {rows.map((row) => (
                <button
                  key={row.formId}
                  type="button"
                  role="listitem"
                  className="ws-row"
                  onClick={() => navigate(`/training/surveys/${row.formId}`)}
                >
                  <EntityAvatar name={row.title} size={36} />
                  <div className="ws-row-main">
                    <div className="ws-row-name">{row.title}</div>
                    <div className="ws-row-meta">
                      {[
                        row.dueDate && `Due ${dayjs(row.dueDate).format("D MMM YYYY")}`,
                        row.sentAt && `Sent ${dayjs(row.sentAt).format("D MMM")}`,
                      ]
                        .filter(Boolean)
                        .join(" · ") || row.description}
                    </div>
                  </div>
                  <div className="ws-row-side">
                    {statusOf(row)}
                    <RightOutlined />
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </MotionCard>
    </div>
  );
}
