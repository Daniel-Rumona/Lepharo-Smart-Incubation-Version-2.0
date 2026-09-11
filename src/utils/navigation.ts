import type { NavigateOptions } from "react-router-dom";

let __navigate: ((to: string, opts?: NavigateOptions) => void) | null = null;

export function setNavigator(fn: (to: string, opts?: NavigateOptions) => void) {
  __navigate = fn;
}

export function go(to: string, opts?: NavigateOptions) {
  if (!__navigate) {
    console.warn("[NAV] Router not ready. Ignoring:", to, opts);
    return;
  }
  __navigate(to, opts);
}
