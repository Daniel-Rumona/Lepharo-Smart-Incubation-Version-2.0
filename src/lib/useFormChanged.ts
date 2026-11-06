import { useEffect, useState } from "react";
import { Form } from "antd";
import type { FormInstance } from "antd";

/*
 * Whether a form holds anything worth saving, for dialogs whose one action
 * button stays disabled until it does. It only compares against what the
 * form opened with; it never checks validity, so once something changes the
 * button is enabled and pressing it shows the field errors.
 */

const isEmpty = (v: unknown) =>
  v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

/** JSON with empty values dropped and keys sorted: "", null, undefined and [] all count as unset. */
export const stableValue = (value: unknown) =>
  JSON.stringify(value, (_key, v) => {
    if (isEmpty(v)) return undefined;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(Object.keys(v).sort().map((k) => [k, (v as Record<string, unknown>)[k]]));
    }
    return v;
  }) ?? "";

/**
 * True once the form's values (plus any `extra` state kept outside the form,
 * such as chosen files or list editors) differ from what they were when the
 * form first rendered. Give the form its starting values as `initialValues`.
 * `resetKey` names what is being edited (e.g. the open record's id): when it
 * changes the comparison starts over, for dialogs reopened inside a parent
 * that stays mounted.
 */
export function useFormChanged(form: FormInstance, extra?: unknown, resetKey?: unknown): boolean {
  const values = Form.useWatch((all) => all, form);
  const [initial, setInitial] = useState<{ key: unknown; value: string }>();
  const current = stableValue({ values, extra });
  const stale = initial !== undefined && initial.key !== resetKey;

  useEffect(() => {
    // The form reports its values only after it mounts; that first report is the
    // starting point. A closed (unmounted) form forgets it, so each opening starts fresh.
    if (values === undefined) {
      if (initial !== undefined) setInitial(undefined);
    } else if (initial === undefined || stale) setInitial({ key: resetKey, value: current });
  }, [values, current, initial, stale, resetKey]);

  return initial !== undefined && !stale && current !== initial.value;
}
