import { useCallback, useEffect, useRef, useState } from "react";
import {
  type SavedCourse,
  backupCourse,
  getCourse,
  getRecovery,
  normalizeCourse,
  saveCourse,
} from "../courseStorage";

export type SaveState = "saved" | "unsaved" | "saving" | "failed" | "recovery";

export const saveLabel: Record<SaveState, string> = {
  saved: "Saved",
  unsaved: "Unsaved changes",
  saving: "Saving…",
  failed: "Not synced",
  recovery: "Local copy — not synced yet",
};

/**
 * Loads one author draft and keeps it saved: IndexedDB backup shortly after each
 * change, a cloud save after a pause, and a recovery copy offer when the local
 * copy is newer. Changes go through `mutate`, which always applies to the latest
 * state, so background AI drafting and typing never overwrite each other.
 */
export function useCourseDraft(owner: string, id: string) {
  const [course, setCourse] = useState<SavedCourse>();
  const latest = useRef<SavedCourse>();
  const saveLock = useRef(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [recovery, setRecovery] = useState<SavedCourse>();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    if (!owner) return;
    Promise.all([getCourse(owner, id), getRecovery(owner, id).catch(() => undefined)])
      .then(([saved, local]) => {
        if (cancelled) return;
        if (!saved) {
          setLoadError("This course was not found. It may have been created on another device that hasn't synced yet.");
          return;
        }
        const next = normalizeCourse(saved);
        latest.current = next;
        setCourse(next);
        setDirty(false);
        setSaveState(saved.localRecovery ? "recovery" : "saved");
        if (local && local.updatedAt > saved.updatedAt && !saved.localRecovery) setRecovery(local);
      })
      .catch((reason) => {
        if (!cancelled) setLoadError(reason instanceof Error ? reason.message : "The course could not be loaded.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id, owner]);

  const mutate = useCallback((change: (current: SavedCourse) => SavedCourse) => {
    setCourse((current) => {
      if (!current) return current;
      const next = change(current);
      latest.current = next;
      return next;
    });
    setDirty(true);
    setSaveState("unsaved");
  }, []);

  /** Apply a change that already exists in the cloud (e.g. a publish result) without marking the draft unsaved. */
  const adopt = useCallback((change: (current: SavedCourse) => SavedCourse) => {
    setCourse((current) => {
      if (!current) return current;
      const next = change(current);
      latest.current = next;
      return next;
    });
  }, []);

  const save = useCallback(async (): Promise<SavedCourse | undefined> => {
    const snapshot = latest.current;
    if (!snapshot || saveLock.current || snapshot.deletedAt) return;
    saveLock.current = true;
    setSaveState("saving");
    try {
      const saved = await saveCourse({ ...snapshot, updatedAt: new Date().toISOString() });
      const unchanged = latest.current === snapshot;
      setCourse((current) => {
        const next =
          current === snapshot || !current
            ? saved
            : { ...current, revision: saved.revision, publishedRevision: saved.publishedRevision, updatedAt: saved.updatedAt };
        latest.current = next;
        return next;
      });
      setDirty(!unchanged);
      setSaveState(unchanged ? "saved" : "unsaved");
      setError("");
      return saved;
    } catch (reason) {
      setSaveState("failed");
      setError(reason instanceof Error ? reason.message : "The course could not be saved.");
      return undefined;
    } finally {
      saveLock.current = false;
    }
  }, []);

  useEffect(() => {
    if (!dirty || loading || !course) return;
    const backup = setTimeout(() => {
      void backupCourse({ ...course, updatedAt: new Date().toISOString() }).catch(() => undefined);
    }, 300);
    const timer = setTimeout(() => void save(), 1800);
    return () => {
      clearTimeout(backup);
      clearTimeout(timer);
    };
  }, [course, dirty, loading, save]);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const restoreRecovery = useCallback(() => {
    if (!recovery) return;
    mutate((current) => ({
      ...normalizeCourse(recovery),
      revision: current.revision,
      publishedRevision: current.publishedRevision,
    }));
    setRecovery(undefined);
  }, [recovery, mutate]);

  const keepLocalCopy = useCallback(async () => {
    if (latest.current) await backupCourse({ ...latest.current, updatedAt: new Date().toISOString() });
  }, []);

  return {
    course,
    latest,
    loading,
    loadError,
    error,
    setError,
    dirty,
    saveState,
    recovery,
    dismissRecovery: () => setRecovery(undefined),
    restoreRecovery,
    mutate,
    adopt,
    save,
    keepLocalCopy,
  };
}
