// src/utils/templates.ts
import type { Template } from "./emailService";

export const QUICK_RESPONSE_TEMPLATES: Template[] = [
  {
    id: "program-accept",
    title: "Acceptance: specific programme",
    subject: "Welcome to {{programName}}",
    md: `
Hi {{firstName}},

Great news — you've been **accepted** into **{{programName}}**{{cohortName ? (' (Cohort ' + cohortName + ')') : ''}}.

**Start date:** {{startDate}}
**Next steps:** {{nextSteps}}

Open your portal to get started:
[Go to portal]({{links.incubatee}})

Welcome aboard!
Smart Incubation Support
    `,
    vars: ["firstName","programName","cohortName","startDate","nextSteps","links.incubatee"]
  },
  {
    id: "program-decline",
    title: "Decline: waitlist note",
    subject: "Your application to {{programName}}",
    md: `
Hi {{firstName}},

Thank you for applying to **{{programName}}**. Due to very high competition this round, we couldn't offer you a spot.

You are on our **waiting list**. If space opens up, we'll contact you immediately.

You can log in any time to update your profile:
[Go to portal]({{links.incubatee}})

We appreciate your interest and encourage you to reapply in the next intake.

— Smart Incubation Team
    `,
    vars: ["firstName","programName","links.incubatee"]
  },
  {
    id: "intervention-assigned",
    title: "Intervention assigned",
    subject: "New intervention assigned",
    md: `
Hi {{firstName}},

You've been assigned a new intervention.

**Due date:** {{dueDate}}
**Assigned by:** {{assignedBy}}

View details and requirements:
[Open interventions]({{links.interventions}})

— Smart Incubation Team
    `,
    vars: ["firstName","dueDate","assignedBy","links.interventions"]
  },
  {
    id: "intervention-overdue",
    title: "Intervention overdue reminder",
    subject: "Overdue intervention",
    md: `
Hi {{firstName}},

This is a reminder that one of your interventions is **overdue** (due on {{dueDate}}).

Please submit the outstanding work or request an extension in the portal.

[Open interventions]({{links.interventions}})

If you've already completed it, you can ignore this message.

— Smart Incubation Team
    `,
    vars: ["firstName","dueDate","links.interventions"]
  },
  {
    id: "doc-sign-reminder",
    title: "Reminder to sign documents (signed docs area)",
    subject: "Action needed: sign required documents",
    md: `
Hi {{firstName}},

The following document(s) require your signature:

{{bulletList}}

Sign here:
[Open signed documents]({{links.signedDocs}})

— Smart Incubation Team
    `,
    vars: ["firstName","bulletList","links.signedDocs"]
  },
  {
    id: "general-compliance-reminder",
    title: "General compliance documents reminder (hub)",
    subject: "Action needed: upload required compliance documents",
    md: `
Hi {{firstName}},

You have outstanding compliance documents to upload:

{{bulletList}}

Upload them here:
[Open compliance hub]({{links.docsHub}})

— Smart Incubation Team
    `,
    vars: ["firstName","bulletList","links.docsHub"]
  },
  {
    id: "extra-proof-request",
    title: "Request: extra proof for a completed intervention",
    subject: "More info needed",
    md: `
Hi {{firstName}},

Thanks for your submission. To complete verification we need the following additional proof:

{{requestedList}}

Please upload by **{{dueDate}}**:
[Open compliance hub]({{links.docsHub}})

— Smart Incubation Team
    `,
    vars: ["firstName","requestedList","dueDate","links.docsHub"]
  }
];

/** Helpers for building Markdown lists from arrays */
export const mdList = (items: string[] = []) =>
  items.length ? items.map(i => `- ${i}`).join("\n") : "- —";
