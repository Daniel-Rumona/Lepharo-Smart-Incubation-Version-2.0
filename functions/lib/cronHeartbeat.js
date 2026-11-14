"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.scheduledJob = exports.withHeartbeat = void 0;
const admin = __importStar(require("firebase-admin"));
const logger = __importStar(require("firebase-functions/logger"));
const scheduler_1 = require("firebase-functions/v2/scheduler");
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
/** Plain values from a job's return value; anything else is dropped. */
const summaryOf = (value) => {
    if (!value || typeof value !== "object" || Array.isArray(value))
        return null;
    const out = {};
    Object.entries(value).forEach(([key, v]) => {
        if (typeof v === "number" || typeof v === "boolean" || (typeof v === "string" && v.length <= 200))
            out[key] = v;
    });
    return Object.keys(out).length ? out : null;
};
function withHeartbeat(jobId, options, handler) {
    return async (event) => {
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
        const finish = async (status, error, summary) => {
            const finishedAt = new Date();
            const durationMs = finishedAt.getTime() - startedAt.getTime();
            try {
                await ref.set({
                    ...base,
                    runState: "idle",
                    runStatus: status,
                    runError: error,
                    runFinishedAt: admin.firestore.Timestamp.fromDate(finishedAt),
                    runDurationMs: durationMs,
                    runSummary: summary,
                    runCount: admin.firestore.FieldValue.increment(1),
                    runFailCount: admin.firestore.FieldValue.increment(status === "failed" ? 1 : 0),
                }, { merge: true });
                await ref.collection("runs").add({
                    startedAt: admin.firestore.Timestamp.fromDate(startedAt),
                    finishedAt: admin.firestore.Timestamp.fromDate(finishedAt),
                    durationMs,
                    status,
                    error,
                    summary,
                    expireAt: admin.firestore.Timestamp.fromMillis(finishedAt.getTime() + RUN_HISTORY_DAYS * 86400000),
                });
            }
            catch (writeError) {
                logger.warn("cron_heartbeat.finish_failed", { jobId, error: String(writeError) });
            }
        };
        try {
            const result = await handler(event);
            await finish("ok", null, summaryOf(result));
        }
        catch (error) {
            await finish("failed", String(error?.message || error).slice(0, 1000), null);
            throw error;
        }
    };
}
exports.withHeartbeat = withHeartbeat;
/** onSchedule that reports its runs; `jobId` is the heartbeat doc id. */
function scheduledJob(jobId, options, handler) {
    return (0, scheduler_1.onSchedule)(options, withHeartbeat(jobId, options, handler));
}
exports.scheduledJob = scheduledJob;
//# sourceMappingURL=cronHeartbeat.js.map