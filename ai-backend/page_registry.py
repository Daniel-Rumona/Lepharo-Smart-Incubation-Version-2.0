PAGE_REGISTRY = {
    "/applicant/inquiries": {
        "page_name": "Applicant Inquiries",
        "role_area": "applicant",
        "purpose": "Applicant inquiry submissions and guidance.",
        "collections": ["inquiries", "participants"],
        "tools": ["get_inquiries_by_email", "get_participant_by_email"],
    },
    "/applicant/profile": {
        "page_name": "Applicant Profile",
        "role_area": "applicant",
        "purpose": "Applicant personal and business profile details.",
        "collections": ["participants"],
        "tools": ["get_participant_by_email"],
    },
    "/applicant/programs": {
        "page_name": "Applicant Programs",
        "role_area": "applicant",
        "purpose": "Available programs and application readiness.",
        "collections": ["programs", "applications", "participants"],
        "tools": ["get_active_programs", "get_applications_by_email"],
    },
    "/applicant": {
        "page_name": "Applicant Dashboard",
        "role_area": "applicant",
        "purpose": "Applicant overview and application progress.",
        "collections": ["participants", "applications", "programs"],
        "tools": ["get_participant_by_email", "get_applications_by_email"],
    },

    "/incubatee": {
        "page_name": "Incubatee Dashboard",
        "role_area": "incubatee",
        "purpose": "Incubatee overview, progress, interventions, compliance, and roadmap.",
        "collections": ["participants", "assignedInterventions", "diagnosticPlans", "participantComplianceTimeline"],
        "tools": ["get_participant_by_email", "get_assigned_interventions_by_participant", "get_diagnostic_plan_by_participant", "get_compliance_by_participant"],
    },
    "/incubatee/interventions": {
        "page_name": "My Interventions",
        "role_area": "incubatee",
        "purpose": "Assigned interventions, intervention requests, progress, and completion.",
        "collections": ["assignedInterventions", "interventionRequests"],
        "tools": ["get_assigned_interventions_by_participant", "get_intervention_requests_by_participant"],
    },
    "/incubatee/roadmap": {
        "page_name": "Growth Roadmap",
        "role_area": "incubatee",
        "purpose": "Diagnostic plan, roadmap, and department confirmations.",
        "collections": ["diagnosticPlans", "assignedInterventions"],
        "tools": ["get_diagnostic_plan_by_participant", "get_assigned_interventions_by_participant"],
    },
    "/incubatee/compliance": {
        "page_name": "Compliance",
        "role_area": "incubatee",
        "purpose": "Compliance documents, missing files, uploaded files, and status trail.",
        "collections": ["participantComplianceTimeline"],
        "tools": ["get_compliance_by_participant"],
    },
    "/incubatee/profile": {
        "page_name": "Profile",
        "role_area": "incubatee",
        "purpose": "Incubatee and SME profile details.",
        "collections": ["participants", "participantMetricsTimeline"],
        "tools": ["get_participant_by_email", "get_participant_metrics"],
    },

    "/operations": {
        "page_name": "Operations Dashboard",
        "role_area": "operations",
        "purpose": "Operational overview.",
        "collections": ["applications", "participants", "assignedInterventions", "appointments", "movDocuments"],
        "tools": ["get_participants", "get_assigned_interventions", "get_appointments", "get_movs"],
    },
    "/operations/clock": {
        "page_name": "Operations Timesheet",
        "role_area": "operations",
        "purpose": "Clock-in, clock-out, attendance, and timesheet activity.",
        "collections": ["clockEvents", "timeRecords", "users"],
        "tools": ["get_clock_events", "get_time_records"],
    },
    "/operations/hr/leave": {
        "page_name": "HR Leave Management",
        "role_area": "operations",
        "purpose": "Staff leave requests, approvals, and balances for the department.",
        "collections": ["leaveRequests", "users"],
        "tools": ["get_leave_requests_by_department"],
    },
    "/operations/hr/performance": {
        "page_name": "HR Performance",
        "role_area": "operations",
        "purpose": "Department KPI targets and staff performance tracking.",
        "collections": ["kpiTargets", "kpiDefinitions"],
        "tools": ["get_kpi_targets_by_department"],
    },
    "/operations/applications": {
        "page_name": "Applications",
        "role_area": "operations",
        "purpose": "Application review, applicant details, and application statuses.",
        "collections": ["applications", "participants", "programs"],
        "tools": ["get_applications", "get_participants"],
    },
    "/operations/participants": {
        "page_name": "Participants",
        "role_area": "operations",
        "purpose": "Participant list, SME details, and participant tracking.",
        "collections": ["participants", "applications", "participantMetricsTimeline"],
        "tools": ["get_participants", "get_applications"],
    },
    "/operations/compliance": {
        "page_name": "Participant Compliance",
        "role_area": "operations",
        "purpose": "Participant compliance status and document verification.",
        "collections": ["participantComplianceTimeline", "participants", "programs"],
        "tools": ["get_compliance", "get_participants"],
    },
    "/operations/diagnostic-plans": {
        "page_name": "Diagnostic Plans",
        "role_area": "operations",
        "purpose": "Diagnostic plans, department review, beneficiary review, and confirmations.",
        "collections": ["diagnosticPlans", "participants", "departments", "interventions"],
        "tools": ["get_diagnostic_plans", "get_participants"],
    },
    "/operations/assignments": {
        "page_name": "Assignments",
        "role_area": "operations",
        "purpose": "Assigned interventions, assignment coverage, grouped assignments, and bottlenecks.",
        "collections": ["assignedInterventions", "diagnosticPlans", "participants", "interventions"],
        "tools": ["get_assigned_interventions", "get_diagnostic_plans"],
    },
    "/operations/appointments": {
        "page_name": "Appointments",
        "role_area": "operations",
        "purpose": "Appointments, QR attendance, meetings, and linked interventions.",
        "collections": ["appointments", "assignedInterventions"],
        "tools": ["get_appointments", "get_assigned_interventions"],
    },
    "/operations/movs": {
        "page_name": "MOVs",
        "role_area": "operations",
        "purpose": "MOV documents, signatures, and completed intervention evidence.",
        "collections": ["movDocuments", "assignedInterventions"],
        "tools": ["get_movs", "get_completed_interventions"],
    },
    "/operations/reports": {
        "page_name": "Reports",
        "role_area": "operations",
        "purpose": "Operational reporting and performance trends.",
        "collections": ["participants", "assignedInterventions", "appointments", "movDocuments"],
        "tools": ["get_participants", "get_assigned_interventions", "get_appointments", "get_movs"],
    },
    "/operations/assistant": {
        "page_name": "Agent Assistant",
        "role_area": "operations",
        "purpose": "General operational assistant workspace.",
        "collections": ["participants", "applications", "assignedInterventions", "appointments", "movDocuments", "diagnosticPlans"],
        "tools": ["get_participants", "get_applications", "get_assigned_interventions"],
    },

    "/projectadmin": {
        "page_name": "Project Admin Dashboard",
        "role_area": "projectadmin",
        "purpose": "Project admin dashboard and project-level activity.",
        "collections": ["participants", "assignedInterventions", "appointments", "movDocuments", "diagnosticPlans"],
        "tools": ["get_participants", "get_assigned_interventions", "get_appointments"],
    },
    "/projectadmin/clock": {
        "page_name": "Project Admin Timesheet",
        "role_area": "projectadmin",
        "purpose": "Project admin clock-in and team attendance.",
        "collections": ["clockEvents", "timeRecords", "users"],
        "tools": ["get_clock_events", "get_time_records"],
    },

    "/timesheet": {
        "page_name": "My Timesheet",
        "role_area": "shared",
        "purpose": "The signed-in staff member's own clock-in/out activity.",
        "collections": ["timesheets"],
        "tools": ["get_clock_events_by_user", "get_time_records_by_user"],
    },
    "/leave": {
        "page_name": "My Leave",
        "role_area": "shared",
        "purpose": "The signed-in staff member's own leave requests and balance.",
        "collections": ["leaveRequests"],
        "tools": ["get_leave_requests_by_user"],
    },
    "/kpis/track": {
        "page_name": "KPI Tracker",
        "role_area": "shared",
        "purpose": "Department KPI targets and progress tracking.",
        "collections": ["kpiTargets", "kpiDefinitions"],
        "tools": ["get_kpi_targets_by_department"],
    },
}


def get_page_context(route: str | None):
    if not route:
        return {
            "page_name": "Unknown Page",
            "role_area": "unknown",
            "purpose": "No route was provided.",
            "collections": [],
            "tools": [],
        }

    normalized = route.rstrip("/") or "/"

    return PAGE_REGISTRY.get(normalized, {
        "page_name": "Unknown Page",
        "role_area": "unknown",
        "purpose": f"No registry entry exists for route: {normalized}",
        "collections": [],
        "tools": [],
    })
