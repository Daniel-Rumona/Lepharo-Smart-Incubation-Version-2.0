export type UserRole =
  | "admin" | "system_admin" | "funder" | "consultant" | "incubatee" | "participant"
  | "operations" | "projectmanager" | "director" | "projectadmin"
  | "investor" | "government" | "receptionist" | "";

export function canonicalRole(raw?: string | null | undefined): UserRole {
  return (raw || "").toLowerCase().replace(/\s+/g, "") as UserRole;
}

export function roleAwarePath(page: string, role: UserRole, entityId?: string | null): string {
  const key = (page || "").toLowerCase();

  const alias: Record<string, string> = {
    home: "dashboard", dash: "dashboard",
    participant: "participants", kpi: "kpis",
  };
  const pageKey = alias[key] || key;

  const withId = (base: string) => (entityId ? `${base}/${entityId}` : base);

  if (role === "incubatee") {
    const map: Record<string, string> = {
      dashboard: "/incubatee",
      interventions: "/incubatee/interventions",
      appointments: "/incubatee/appointments",
      inquiries: "/incubatee/feedback",
      feedback: "/incubatee/feedback",
      metrics: "/incubatee/metrics",
      financials: "/incubatee/financials",
      resources: "/incubatee/resources",
      "documents/compliance": "/incubatee/documents/compliance",
      "documents/hub": "/incubatee/documents/hub",
      documents: "/incubatee/documents/hub",
      roadmap: "/incubatee/roadmap",
      tracker: "/applicant/tracker",
      profile: "/applicant/profile",
      sme: "/applicant",
      analytics: "/incubatee/analytics",
      gap: "/incubatee/gap-analysis",
    };
    return map[pageKey] || map.dashboard;
  }

  if (role === "operations") {
    const map: Record<string, string> = {
      dashboard: "/operations",
      participants: "/operations/participants",
      compliance: "/compliance",
      resources: "/operations/resources",
      requests: "/operations/requests",
      interventions: "/operations/interventions",
      movs: "/operations/monitoring/movs",
      forms: "/operations/forms",
      kpis: "/operations/kpis/KPITrackerView",
      reports: "/operations/reports",
      finance: "/operations/finance",
      grouphistory: "/operations/groupHistory",
      diagnostic: "/operations/plan",
      gap: "/operations/gap",
      plan: "/operations/plan",
      assignments: "/operations/assignments",
      consultants: "/operations/consultants",
      impact: "/operations/impact",
      "success-challenges": "/operations/success-challenges",
      milestones: "/operations/success-challenges",
      challenges: "/operations/success-challenges",
      training: "/operations/training",
    };
    return map[pageKey] || map.dashboard;
  }

  if (role === "projectadmin") {
    const map: Record<string, string> = {
      dashboard: "/projectadmin",
      reports: "/projectadmin/reports",
      movs: "/projectadmin/movs/approvals",
      inquiries: "/projectadmin/inquiries",
      programs: "/programs",
      applications: "/applications",
      interventions: "/interventions",
      resources: "/resources",
    };
    return map[pageKey] || map.dashboard;
  }

  if (role === "consultant") {
    const map: Record<string, string> = {
      dashboard: "/consultant",
      allocated: "/consultant/allocated",
      appointments: "/consultant/appointments",
      feedback: "/consultant/feedback",
      analytics: "/consultant/analytics",
      queries: "/consultant/queries",
      interventions: "/consultant/allocated",
      "interventions/history": "/consultant/allocated/history",
      linkages: "/consultant/interventions/Linkages",
      hse: "/consultant/interventions/hse",
      wellness: "/consultant/interventions/wellness",
      participants: "/consultant/participants",
    };
    if (pageKey === "allocated" && entityId) return withId("/consultant/allocated/intervention");
    return map[pageKey] || map.dashboard;
  }

  if (role === "director") {
    const map: Record<string, string> = {
      dashboard: "/director",
      operators: "/director/operators",
      branches: "/director/branches",
      departments: "/director/departments",
      reports: "/operations/reports",
    };
    return map[pageKey] || map.dashboard;
  }

  if (role === "funder") {
    const map: Record<string, string> = {
      dashboard: "/funder",
      analytics: "/funder/analytics",
    };
    return map[pageKey] || map.dashboard;
  }

  if (role === "investor") {
    const map: Record<string, string> = {
      dashboard: "/investor",
      opportunities: "/investor/opportunities",
      portfolio: "/investor/portfolio",
      "due-diligence": "/investor/due-diligence",
      analytics: "/investor/analytics",
      documents: "/investor/documents",
      calendar: "/investor/calendar",
    };
    return map[pageKey] || map.dashboard;
  }

  if (role === "government") {
    const map: Record<string, string> = {
      dashboard: "/government",
      analytics: "/government/analytics",
      participants: "/government/participants",
      programs: "/government/programs",
      reports: "/government/reports",
    };
    return map[pageKey] || map.dashboard;
  }

  if (role === "receptionist") {
    const map: Record<string, string> = {
      dashboard: "/receptionist",
      inquiries: "/receptionist/inquiries",
      contacts: "/receptionist/contacts",
      "follow-ups": "/receptionist/follow-ups",
      reports: "/receptionist/reports",
    };
    return map[pageKey] || map.dashboard;
  }

  if (role === "system_admin") {
    const map: Record<string, string> = {
      dashboard: "/admin",
      monitoring: "/admin/monitoring",
      email: "/admin/email",
      emails: "/admin/email",
      system: "/system",
    };
    return map[pageKey] || map.dashboard;
  }

  if (role === "projectmanager") {
    const map: Record<string, string> = {
      dashboard: "/projectmanager",
      "inhouse/requests": "/projectmanager/inhouse/requests",
    };
    return map[pageKey] || map.dashboard;
  }

  const generic: Record<string, string> = {
    dashboard: "/",
    applications: "/applications",
    interventions: "/interventions",
    resources: "/resources",
    reports: "/operations/reports",
  };
  return generic[pageKey] || generic.dashboard;
}
