import * as admin from "firebase-admin";
import * as logger from "firebase-functions/logger";
import { onSchedule, type ScheduleOptions, type ScheduledEvent } from "firebase-functions/v2/scheduler";

/*
 * Every scheduled job reports its runs to systemHeartbeats/{jobId}, so the
 * System Admin email page (src/routes/admin/email) can show what ran, when,
 * how long it took and whether it failed.
 *
 * The run fields are prefixed `run*` because a few jobs already write their
 * own lastRunAt/lastStatus to the same doc (brevoApiKeepAlive, revenue sync,
 * risk scoring, intervention impact); those stay as they were.
 *
 * Each run is also kept under systemHeartbeats/{jobId}/runs. `expireAt` is
 * there for a Firestore TTL policy on that collection group.
 */

const RUN_HISTORY_DAYS = 30;

type Handler = (event: ScheduledEvent) => unknown | Promise<unknown>;

/** Plain values from a job's return value; anything else is dropped. */
const summaryOf = (value: unknown) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, string | number | boolean> = {};
  Object.entries(value as Record<string, unknown>).forEach(([key, v]) => {
    if (typeof v === "number" || typeof v === "boolean" || (typeof v === "string" && v.length <= 200)) out[key] = v;
  });
  return Object.keys(out).length ? out : null;
};

export function withHeartbeat(jobId: string, options: ScheduleOptions, handler: Handler) {
  return async (event: ScheduledEvent) => {
    const db = admin.firestore();
    const ref = db.collection("systemHeartbeats").doc(jobId);
    const startedAt = new Date();
    const base = {
      schedule: String(options.schedule || ""),
      timeZone: String(options.timeZone || "UTC"),
    };

    // Reporting must never stop a job from running.
    await ref
      .set({ ...base, runStartedAt: admin.firestore.Timestamp.fromDate(startedAt), runState: "running" }, { merge: true })
      .catch((error) => logger.warn("cron_heartbeat.start_failed", { jobId, error: String(error) }));

    const finish = async (status: "ok" | "failed", error: string | null, summary: Record<string, unknown> | null) => {
      const finishedAt = new Date();
      const durationMs = finishedAt.getTime() - startedAt.getTime();
      try {
        await ref.set(
          {
            ...base,
            runState: "idle",
            runStatus: status,
            runError: error,
            runFinishedAt: admin.firestore.Timestamp.fromDate(finishedAt),
            runDurationMs: durationMs,
            runSummary: summary,
            runCount: admin.firestore.FieldValue.increment(1),
            runFailCount: admin.firestore.FieldValue.increment(status === "failed" ? 1 : 0),
          },
          { merge: true }
        );
        await ref.collection("runs").add({
          startedAt: admin.firestore.Timestamp.fromDate(startedAt),
          finishedAt: admin.firestore.Timestamp.fromDate(finishedAt),
          durationMs,
          status,
          error,
          summary,
          expireAt: admin.firestore.Timestamp.fromMillis(finishedAt.getTime() + RUN_HISTORY_DAYS * 86_400_000),
        });
      } catch (writeError) {
        logger.warn("cron_heartbeat.finish_failed", { jobId, error: String(writeError) });
      }
    };

    try {
      const result = await handler(event);
      await finish("ok", null, summaryOf(result));
    } catch (error: any) {
      await finish("failed", String(error?.message || error).slice(0, 1000), null);
      throw error;
    }
  };
}

/** onSchedule that reports its runs; `jobId` is the heartbeat doc id. */
export function scheduledJob(jobId: string, options: ScheduleOptions, handler: Handler) {
  return onSchedule(options, withHeartbeat(jobId, options, handler));
}
