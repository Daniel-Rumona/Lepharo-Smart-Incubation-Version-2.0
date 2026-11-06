import React, { useEffect, useState } from "react";
import { Progress, Space, Spin, Tooltip, Typography } from "antd";
import {
  type CourseProgress,
  learnerCourseKey,
  listCatalog,
  progressForLearners,
} from "@/components/courses/learnerCourses";
import type { Training, TrainingEnrollment } from "./trainingStorage";

type ProgressState = {
  progress: Record<string, CourseProgress>;
  courseTitles: Record<string, string>;
  loading: boolean;
};

/**
 * Course progress for enrolled training SMEs: each SME (trainingEnrollments.userId)
 * against every course linked to their training (trainings.courseIds).
 */
export function useTrainingCourseProgress(enrollments: TrainingEnrollment[], trainings: Training[], enabled = true): ProgressState {
  const [state, setState] = useState<ProgressState>({ progress: {}, courseTitles: {}, loading: false });

  useEffect(() => {
    if (!enabled) return;
    const courseIdsOf = new Map(trainings.map((t) => [t.id, t.courseIds || []]));
    const pairs = enrollments.flatMap((e) =>
      e.status === "enrolled" && e.userId ? (courseIdsOf.get(e.trainingId) || []).map((courseId) => ({ learnerId: e.userId!, courseId })) : []
    );
    if (!pairs.length) {
      setState({ progress: {}, courseTitles: {}, loading: false });
      return;
    }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    Promise.all([progressForLearners(pairs), listCatalog()])
      .then(([progress, catalog]) => {
        if (!cancelled) setState({ progress, courseTitles: Object.fromEntries(catalog.map((c) => [c.id, c.title])), loading: false });
      })
      .catch(() => {
        if (!cancelled) setState({ progress: {}, courseTitles: {}, loading: false });
      });
    return () => {
      cancelled = true;
    };
  }, [enrollments, trainings, enabled]);

  return state;
}

/** One progress bar per course linked to the SME's training. */
export function TrainingCourseProgressCell({
  enrollment,
  training,
  state,
}: {
  enrollment: TrainingEnrollment;
  training?: Training;
  state: ProgressState;
}) {
  const courseIds = training?.courseIds || [];
  if (enrollment.status !== "enrolled" || !courseIds.length) return <Typography.Text type="secondary">—</Typography.Text>;
  if (!enrollment.userId) return <Typography.Text type="secondary">No portal login yet</Typography.Text>;
  if (state.loading) return <Spin size="small" />;

  return (
    <Space direction="vertical" size={2} style={{ minWidth: 180 }}>
      {courseIds.map((courseId) => {
        const p = state.progress[learnerCourseKey(enrollment.userId!, courseId)];
        const title = state.courseTitles[courseId] || "Course";
        return (
          <Tooltip key={courseId} title={p ? `${p.completed} of ${p.required} required items completed` : "Not started"}>
            <div>
              <Typography.Text style={{ fontSize: 12 }} ellipsis>
                {title}
              </Typography.Text>
              <Progress percent={p?.percent ?? 0} size="small" status={p?.percent === 100 ? "success" : "normal"} />
            </div>
          </Tooltip>
        );
      })}
    </Space>
  );
}
