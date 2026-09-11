// src/utils/emailService.ts
import { marked } from "marked";

export type TemplateId =
  | "program-accept"
  | "program-decline"
  | "intervention-assigned"
  | "intervention-overdue"
  | "doc-sign-reminder"
  | "general-compliance-reminder"
  | "extra-proof-request";

export type Template = {
  id: TemplateId;
  title: string;
  subject: string;  // may contain {{vars}}
  md: string;       // Markdown body with {{vars}}
  vars: string[];   // for UI hints and insert menu
};

export function renderVars(template: string, vars: Record<string, any>) {
  return template.replace(/{{\s*([\w.]+)\s*}}/g, (_, key) => {
    const val = key.split(".").reduce((o: any, k: string) => (o ? o[k] : undefined), vars);
    return val == null ? "" : String(val);
  });
}

/** Compile Markdown template -> { subject, html, text } */
export function compileTemplate(t: Template, vars: Record<string, any>) {
  const subject = renderVars(t.subject, vars);
  const md = renderVars(t.md, vars);
  const html = marked.parse(md) as string;
  // Simple plaintext fallback improves deliverability
  const text = md
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1 ($2)")   // links
    .replace(/[*_`>#-]/g, "")                   // md syntax
    .replace(/\n{3,}/g, "\n\n");
  return { subject, html, text };
}
