// src/utils/linkHelpers.ts
const APP_BASE = "https://lepharosmartinc.co.za";

/** Build a login-gated deep link that never bypasses auth */
export function portalLink(path: string, params: Record<string, string | number | boolean> = {}) {
  const q = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  const dest = q.toString() ? `${path}?${q.toString()}` : path;
  return `${APP_BASE}/login?redirect=${encodeURIComponent(dest)}`;
}

/** Canonical destinations used by email templates */
export const Links = {
  incubatee: () => portalLink("/incubatee"),
  signedDocs: () => portalLink("/incubatee/documents/compliance"),
  docsHub: () => portalLink("/incubatee/documents/hub"),
  interventions: () => portalLink("/consultant/allocated"),
};
