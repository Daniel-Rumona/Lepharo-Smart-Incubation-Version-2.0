from typing import Any, Callable

from firestore_tools import (
    summarize_collection,
    summarize_records,
    get_participant_by_email,
    get_participant_by_id,
    get_participants,
    get_participants_for_program,
    get_participant_metrics,

    get_applications,
    get_applications_by_email,
    get_applications_by_participant,
    get_applications_by_program,
    get_accepted_applications_by_program,

    get_active_programs,
    get_programs,
    get_inquiries_by_email,
    get_inquiries_by_branch,
    get_inquiries,
    get_intake_submissions_by_email,
    get_intake_submissions,

    get_assigned_interventions,
    get_assigned_interventions_by_participant,
    get_assigned_interventions_by_assignee,
    get_assigned_interventions_by_program,
    get_assigned_interventions_by_department,
    get_monthly_participants_serviced_by_program,
    get_monthly_participants_serviced,

    get_diagnostic_plan_by_participant,
    get_diagnostic_plans,
    get_diagnostic_plans_by_program,

    get_compliance_by_participant,
    get_compliance,
    get_compliance_by_program,

    get_intervention_requests,
    get_intervention_requests_by_participant,
    get_intervention_requests_by_program,

    get_completed_interventions,
    get_completed_interventions_by_participant,
    get_completed_interventions_by_program,
    get_completed_interventions_by_department,

    get_appointments,
    get_appointments_by_participant,
    get_appointments_by_assignee,
    get_appointments_by_program,
    get_appointments_by_department,

    get_movs,
    get_movs_by_participant,
    get_movs_by_program,
    get_movs_by_department,

    get_departments,
    get_interventions_catalog,
    get_interventions_by_department,

    get_clock_events,
    get_clock_events_by_user,
    get_time_records,
    get_time_records_by_user,
    get_timesheets_by_program,
    get_timesheets_by_department,
)

SUMMARY_TOOL_SPECS: dict[str, tuple[str, list[tuple[str, str, Any]]]] = {
    "get_participants": ("participants", []),
    "get_applications": ("applications", []),
    "get_applications_by_email": ("applications", [("email", "==", 0)]),
    "get_applications_by_participant": ("applications", [("participantId", "==", 0)]),
    "get_applications_by_program": ("applications", [("programId", "==", 0)]),
    "get_programs": ("programs", []),
    "get_active_programs": ("programs", [("status", "==", ("literal", "active"))]),
    "get_inquiries_by_email": ("inquiries", [("email", "==", 0)]),
    "get_inquiries_by_branch": ("inquiries", [("branchId", "==", 0)]),
    "get_inquiries": ("inquiries", []),
    "get_intake_submissions_by_email": ("smeIntakeSubmissions", [("email", "==", 0)]),
    "get_intake_submissions": ("smeIntakeSubmissions", []),
    "get_assigned_interventions": ("assignedInterventions", []),
    "get_assigned_interventions_by_participant": (
        "assignedInterventions",
        [("participantId", "==", 0)],
    ),
    "get_assigned_interventions_by_program": (
        "assignedInterventions",
        [("programId", "==", 0)],
    ),
    "get_assigned_interventions_by_department": (
        "assignedInterventions",
        [("departmentId", "==", 0)],
    ),
    "get_diagnostic_plans": ("diagnosticPlans", []),
    "get_diagnostic_plans_by_program": ("diagnosticPlans", [("programId", "==", 0)]),
    "get_intervention_requests": ("interventionRequests", []),
    "get_intervention_requests_by_participant": (
        "interventionRequests",
        [("participantId", "==", 0)],
    ),
    "get_intervention_requests_by_program": (
        "interventionRequests",
        [("programId", "==", 0)],
    ),
    "get_completed_interventions": ("assignedInterventions", []),
    "get_completed_interventions_by_participant": (
        "assignedInterventions",
        [("participantId", "==", 0)],
    ),
    "get_completed_interventions_by_program": (
        "assignedInterventions",
        [("programId", "==", 0)],
    ),
    "get_appointments": ("appointments", []),
    "get_appointments_by_participant": ("appointments", [("participantId", "==", 0)]),
    "get_appointments_by_program": ("appointments", [("programId", "==", 0)]),
    "get_appointments_by_department": ("appointments", [("departmentId", "==", 0)]),
    "get_movs": ("movDocuments", []),
    "get_movs_by_participant": ("movDocuments", [("participantId", "==", 0)]),
    "get_movs_by_program": ("movDocuments", [("programId", "==", 0)]),
    "get_movs_by_department": ("movDocuments", [("departmentId", "==", 0)]),
    "get_departments": ("departments", []),
    "get_interventions_catalog": ("interventions", []),
    "get_interventions_by_department": ("interventions", [("departmentId", "==", 0)]),
    "get_clock_events": ("timesheets", []),
    "get_clock_events_by_user": ("timesheets", [("userId", "==", 0)]),
    "get_time_records": ("timesheets", []),
    "get_time_records_by_user": ("timesheets", [("userId", "==", 0)]),
}


TOOL_MAP: dict[str, Callable[..., Any]] = {
    "get_participant_by_email": get_participant_by_email,
    "get_participant_by_id": get_participant_by_id,
    "get_participants": get_participants,
    "get_participants_for_program": get_participants_for_program,
    "get_participant_metrics": get_participant_metrics,

    "get_applications": get_applications,
    "get_applications_by_email": get_applications_by_email,
    "get_applications_by_participant": get_applications_by_participant,
    "get_applications_by_program": get_applications_by_program,
    "get_accepted_applications_by_program": get_accepted_applications_by_program,

    "get_active_programs": get_active_programs,
    "get_programs": get_programs,
    "get_inquiries_by_email": get_inquiries_by_email,
    "get_inquiries_by_branch": get_inquiries_by_branch,
    "get_inquiries": get_inquiries,
    "get_intake_submissions_by_email": get_intake_submissions_by_email,
    "get_intake_submissions": get_intake_submissions,

    "get_assigned_interventions": get_assigned_interventions,
    "get_assigned_interventions_by_participant": get_assigned_interventions_by_participant,
    "get_assigned_interventions_by_assignee": get_assigned_interventions_by_assignee,
    "get_assigned_interventions_by_program": get_assigned_interventions_by_program,
    "get_assigned_interventions_by_department": get_assigned_interventions_by_department,
    "get_monthly_participants_serviced_by_program": get_monthly_participants_serviced_by_program,
    "get_monthly_participants_serviced": get_monthly_participants_serviced,

    "get_diagnostic_plan_by_participant": get_diagnostic_plan_by_participant,
    "get_diagnostic_plans": get_diagnostic_plans,
    "get_diagnostic_plans_by_program": get_diagnostic_plans_by_program,

    "get_compliance_by_participant": get_compliance_by_participant,
    "get_compliance": get_compliance,
    "get_compliance_by_program": get_compliance_by_program,

    "get_intervention_requests": get_intervention_requests,
    "get_intervention_requests_by_participant": get_intervention_requests_by_participant,
    "get_intervention_requests_by_program": get_intervention_requests_by_program,

    "get_completed_interventions": get_completed_interventions,
    "get_completed_interventions_by_participant": get_completed_interventions_by_participant,
    "get_completed_interventions_by_program": get_completed_interventions_by_program,
    "get_completed_interventions_by_department": get_completed_interventions_by_department,

    "get_appointments": get_appointments,
    "get_appointments_by_participant": get_appointments_by_participant,
    "get_appointments_by_assignee": get_appointments_by_assignee,
    "get_appointments_by_program": get_appointments_by_program,
    "get_appointments_by_department": get_appointments_by_department,

    "get_movs": get_movs,
    "get_movs_by_participant": get_movs_by_participant,
    "get_movs_by_program": get_movs_by_program,
    "get_movs_by_department": get_movs_by_department,

    "get_departments": get_departments,
    "get_interventions_catalog": get_interventions_catalog,
    "get_interventions_by_department": get_interventions_by_department,

    "get_clock_events": get_clock_events,
    "get_clock_events_by_user": get_clock_events_by_user,
    "get_time_records": get_time_records,
    "get_time_records_by_user": get_time_records_by_user,
    "get_timesheets_by_program": get_timesheets_by_program,
    "get_timesheets_by_department": get_timesheets_by_department,
}


def _get_attr(obj: Any, key: str, default=None):
    if obj is None:
        return default

    if isinstance(obj, dict):
        return obj.get(key, default)

    return getattr(obj, key, default)


def _active_program_id(page_context: dict[str, Any]) -> str | None:
    frontend = page_context.get("frontend") or {}

    active_program_id = (
        frontend.get("activeProgramId")
        or frontend.get("programId")
        or frontend.get("programFilter")
    )

    if active_program_id == "all":
        return None

    return active_program_id


def _resolve_participant_id(user: Any, base_data: dict[str, Any]) -> str | None:
    participant_id = _get_attr(user, "participantId")

    if participant_id:
        return participant_id

    participant = base_data.get("participant")

    if participant:
        return participant.get("id")

    return None


def _resolve_user_id(user: Any) -> str | None:
    return (
        _get_attr(user, "uid")
        or _get_attr(user, "userId")
        or _get_attr(user, "id")
    )


def _resolve_assignee_ids(user: Any) -> list[str]:
    candidates = (
        _get_attr(user, "consultantId"),
        _get_attr(user, "assigneeId"),
        _resolve_user_id(user),
    )
    return list(
        dict.fromkeys(
            str(candidate).strip()
            for candidate in candidates
            if candidate and str(candidate).strip()
        )
    )


# These tools fan out across multiple assignee-id field names (see
# ASSIGNEE_ID_FIELDS in firestore_tools.py), so their exact summary is computed
# directly from the merged, already-fetched record set instead of a single
# Firestore filter query.
MULTI_FIELD_SUMMARY_TOOLS = {
    "get_appointments_by_assignee",
    "get_assigned_interventions_by_assignee",
    "get_timesheets_by_program",
    "get_timesheets_by_department",
    "get_completed_interventions_by_department",
    "get_compliance",
    "get_compliance_by_participant",
    "get_compliance_by_program",
    "get_accepted_applications_by_program",
    "get_participants_for_program",
}

# These tools already stream the full filtered collection and return a small,
# complete aggregate (not a capped preview) — see their docstrings.
COMPLETE_AGGREGATE_TOOLS = {
    "get_monthly_participants_serviced_by_program",
    "get_monthly_participants_serviced",
}


def _resolve_department_id(user: Any) -> str | None:
    return _get_attr(user, "departmentId")


def _resolve_branch_id(user: Any) -> str | None:
    return _get_attr(user, "branchId")


def _safe_run(tool_name: str, *args, include_summary: bool = False):
    fn = TOOL_MAP.get(tool_name)

    if not fn:
        return {
            "ok": False,
            "error": f"Tool is not registered: {tool_name}",
        }

    try:
        data = fn(*args)
        result = {
            "ok": True,
            "data": data,
        }
        if isinstance(data, list):
            result["detailRecordsReturned"] = len(data)
            result["detailsArePreview"] = tool_name not in COMPLETE_AGGREGATE_TOOLS
        if include_summary and tool_name in MULTI_FIELD_SUMMARY_TOOLS and isinstance(data, list):
            result["summary"] = summarize_records(data)
            result["detailsArePreview"] = True
        else:
            summary_spec = SUMMARY_TOOL_SPECS.get(tool_name)
            if include_summary and summary_spec:
                collection_name, filter_specs = summary_spec
                filters = []
                for field, operator, source in filter_specs:
                    value = (
                        source[1]
                        if isinstance(source, tuple) and source[0] == "literal"
                        else args[source]
                    )
                    filters.append((field, operator, value))
                result["summary"] = summarize_collection(collection_name, filters)
                result["detailsArePreview"] = True
        return result
    except Exception as exc:
        return {
            "ok": False,
            "error": str(exc),
        }


def run_page_tools(
    *,
    page_context: dict[str, Any],
    user: Any,
    base_data: dict[str, Any],
    include_summaries: bool = False,
) -> dict[str, Any]:
    """
    Runs the tools listed in page_registry.py using safe inferred arguments.

    It does not let Gemini run arbitrary Firestore queries.
    It only executes registered tools from TOOL_MAP.
    """

    results: dict[str, Any] = {}

    tools = page_context.get("tools") or []

    email = _get_attr(user, "email")
    participant_id = _resolve_participant_id(user, base_data)
    program_id = _active_program_id(page_context)
    assignee_ids = _resolve_assignee_ids(user)
    department_id = _resolve_department_id(user)
    branch_id = _resolve_branch_id(user)
    user_id = _resolve_user_id(user)

    for tool_name in tools:
        # Email-based applicant tools
        if tool_name in {
            "get_participant_by_email",
            "get_applications_by_email",
            "get_inquiries_by_email",
            "get_intake_submissions_by_email",
        }:
            if not email:
                results[tool_name] = {
                    "ok": False,
                    "error": "Missing user.email",
                }
                continue

            results[tool_name] = _safe_run(
                tool_name,
                email,
                include_summary=include_summaries,
            )
            continue

        # Participant tools
        if tool_name in {
            "get_assigned_interventions_by_participant",
            "get_diagnostic_plan_by_participant",
            "get_compliance_by_participant",
            "get_intervention_requests_by_participant",
            "get_completed_interventions_by_participant",
            "get_appointments_by_participant",
            "get_movs_by_participant",
            "get_applications_by_participant",
            "get_participant_metrics",
        }:
            if not participant_id:
                results[tool_name] = {
                    "ok": False,
                    "error": "Missing participantId",
                }
                continue

            results[tool_name] = _safe_run(
                tool_name,
                participant_id,
                include_summary=include_summaries,
            )
            continue

        # Program tools
        if tool_name in {
            "get_participants_for_program",
            "get_applications_by_program",
            "get_accepted_applications_by_program",
            "get_assigned_interventions_by_program",
            "get_diagnostic_plans_by_program",
            "get_compliance_by_program",
            "get_intervention_requests_by_program",
            "get_completed_interventions_by_program",
            "get_appointments_by_program",
            "get_movs_by_program",
            "get_monthly_participants_serviced_by_program",
            "get_timesheets_by_program",
        }:
            if not program_id:
                results[tool_name] = {
                    "ok": False,
                    "error": "Missing active programId. User may be viewing all programs.",
                }
                continue

            results[tool_name] = _safe_run(
                tool_name,
                program_id,
                include_summary=include_summaries,
            )
            continue

        # Assignee tools
        if tool_name in {
            "get_assigned_interventions_by_assignee",
            "get_appointments_by_assignee",
        }:
            if not assignee_ids:
                results[tool_name] = {
                    "ok": False,
                    "error": "Missing assigneeId",
                }
                continue

            results[tool_name] = _safe_run(
                tool_name,
                assignee_ids,
                include_summary=include_summaries,
            )
            continue

        # Department tools
        if tool_name in {
            "get_assigned_interventions_by_department",
            "get_interventions_by_department",
            "get_appointments_by_department",
            "get_movs_by_department",
            "get_completed_interventions_by_department",
            "get_timesheets_by_department",
        }:
            if not department_id:
                results[tool_name] = {
                    "ok": False,
                    "error": "Missing departmentId",
                }
                continue

            results[tool_name] = _safe_run(
                tool_name,
                department_id,
                include_summary=include_summaries,
            )
            continue

        # Branch tools
        if tool_name in {"get_inquiries_by_branch"}:
            if not branch_id:
                results[tool_name] = {
                    "ok": False,
                    "error": "Missing branchId",
                }
                continue

            results[tool_name] = _safe_run(
                tool_name,
                branch_id,
                include_summary=include_summaries,
            )
            continue

        # User/timesheet tools
        if tool_name in {
            "get_clock_events_by_user",
            "get_time_records_by_user",
        }:
            if not user_id:
                results[tool_name] = {
                    "ok": False,
                    "error": "Missing user id",
                }
                continue

            results[tool_name] = _safe_run(
                tool_name,
                user_id,
                include_summary=include_summaries,
            )
            continue

        # No-argument list tools
        if tool_name in {
            "get_participants",
            "get_applications",
            "get_active_programs",
            "get_programs",
            "get_assigned_interventions",
            "get_diagnostic_plans",
            "get_compliance",
            "get_intervention_requests",
            "get_completed_interventions",
            "get_appointments",
            "get_movs",
            "get_departments",
            "get_interventions_catalog",
            "get_clock_events",
            "get_time_records",
            "get_inquiries",
            "get_intake_submissions",
            "get_monthly_participants_serviced",
        }:
            results[tool_name] = _safe_run(
                tool_name,
                include_summary=include_summaries,
            )
            continue

        results[tool_name] = {
            "ok": False,
            "error": f"No dispatch rule for tool: {tool_name}",
        }

    return results
