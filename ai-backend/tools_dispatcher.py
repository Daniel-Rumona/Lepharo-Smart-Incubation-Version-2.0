from typing import Any, Callable, Optional

from tool_scope import merge_programme_results

from firestore_tools import (
    count_collection,
    summarize_collection,
    summarize_records,
    get_participant_by_user,
    get_participant_by_id,
    get_participants,
    get_participants_for_program,
    get_participant_metrics,

    get_applications,
    get_applications_by_user,
    get_applications_by_participant,
    get_applications_by_program,
    get_accepted_applications_by_program,

    get_active_programs,
    get_programs,
    get_inquiries_by_user,
    get_inquiries_by_branch,
    get_inquiries,
    get_intake_submissions_by_user,
    get_intake_submissions,

    get_assigned_interventions,
    get_assigned_interventions_by_participant,
    get_assigned_interventions_by_assignee,
    get_assigned_interventions_by_program,
    get_assigned_interventions_by_department,
    get_monthly_participants_serviced_by_program,
    get_monthly_participants_serviced,
    get_intervention_impact_by_program,
    get_intervention_impact,

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

    get_leave_requests_by_user,
    get_leave_requests_by_department,
    get_kpi_targets_by_department,

    get_recent_activity_summary,
)

SUMMARY_TOOL_SPECS: dict[str, tuple[str, list[tuple[str, str, Any]]]] = {
    "get_participants": ("participants", []),
    "get_applications": ("applications", []),
    "get_applications_by_participant": ("applications", [("participantId", "==", 0)]),
    "get_applications_by_program": ("applications", [("programId", "==", 0)]),
    "get_programs": ("programs", []),
    "get_active_programs": ("programs", [("status", "==", ("literal", "active"))]),
    "get_inquiries_by_branch": ("inquiries", [("branchId", "==", 0)]),
    "get_inquiries": ("inquiries", []),
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
    # v5 appointment docs stamp the SME under smeId, not participantId — see
    # PARTICIPANT_ID_FIELDS / _hydrate_appointments_with_sessions() in
    # firestore_tools.py. This fast-count path only supports one equality
    # filter, so unlike get_appointments_by_participant() it can't fan out
    # over both field names; smeId covers current and future data.
    "get_appointments_by_participant": ("appointments", [("smeId", "==", 0)]),
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
    "get_participant_by_user": get_participant_by_user,
    "get_participant_by_id": get_participant_by_id,
    "get_participants": get_participants,
    "get_participants_for_program": get_participants_for_program,
    "get_participant_metrics": get_participant_metrics,

    "get_applications": get_applications,
    "get_applications_by_user": get_applications_by_user,
    "get_applications_by_participant": get_applications_by_participant,
    "get_applications_by_program": get_applications_by_program,
    "get_accepted_applications_by_program": get_accepted_applications_by_program,

    "get_active_programs": get_active_programs,
    "get_programs": get_programs,
    "get_inquiries_by_user": get_inquiries_by_user,
    "get_inquiries_by_branch": get_inquiries_by_branch,
    "get_inquiries": get_inquiries,
    "get_intake_submissions_by_user": get_intake_submissions_by_user,
    "get_intake_submissions": get_intake_submissions,

    "get_assigned_interventions": get_assigned_interventions,
    "get_assigned_interventions_by_participant": get_assigned_interventions_by_participant,
    "get_assigned_interventions_by_assignee": get_assigned_interventions_by_assignee,
    "get_assigned_interventions_by_program": get_assigned_interventions_by_program,
    "get_assigned_interventions_by_department": get_assigned_interventions_by_department,
    "get_monthly_participants_serviced_by_program": get_monthly_participants_serviced_by_program,
    "get_monthly_participants_serviced": get_monthly_participants_serviced,
    "get_intervention_impact_by_program": get_intervention_impact_by_program,
    "get_intervention_impact": get_intervention_impact,

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

    "get_leave_requests_by_user": get_leave_requests_by_user,
    "get_leave_requests_by_department": get_leave_requests_by_department,
    "get_kpi_targets_by_department": get_kpi_targets_by_department,

    "get_recent_activity_summary": get_recent_activity_summary,
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
    "get_leave_requests_by_department",
    "get_completed_interventions_by_department",
    "get_compliance",
    "get_compliance_by_participant",
    "get_compliance_by_program",
    "get_accepted_applications_by_program",
    "get_participants_for_program",
    # The signed-in SME's own records: id fields first, email fallback (firestore_tools.py).
    "get_applications_by_user",
    "get_inquiries_by_user",
    "get_intake_submissions_by_user",
}

# These tools already stream the full filtered collection and return a small,
# complete aggregate (not a capped preview) — see their docstrings.
COMPLETE_AGGREGATE_TOOLS = {
    "get_monthly_participants_serviced_by_program",
    "get_monthly_participants_serviced",
    "get_intervention_impact_by_program",
    "get_intervention_impact",
}


def _resolve_department_id(user: Any) -> str | None:
    return _get_attr(user, "departmentId")


def _resolve_branch_id(user: Any) -> str | None:
    return _get_attr(user, "branchId")


# Lists stop at this many records (the tools' default limit); a full list may be longer.
LIST_PREVIEW_LIMIT = 100


def _spec_filters(filter_specs, args) -> list[tuple[str, str, Any]]:
    filters = []
    for field, operator, source in filter_specs:
        value = source[1] if isinstance(source, tuple) and source[0] == "literal" else args[source]
        filters.append((field, operator, value))
    return filters


def _mark_cut_short(result: dict[str, Any], tool_name: str, data: list, args: tuple) -> None:
    """When a list reached its limit, count the whole query so the answer can say "N of M"."""
    spec = SUMMARY_TOOL_SPECS.get(tool_name)
    if tool_name in COMPLETE_AGGREGATE_TOOLS or not spec or len(data) < LIST_PREVIEW_LIMIT:
        return
    collection_name, filter_specs = spec
    total = count_collection(collection_name, _spec_filters(filter_specs, args))
    if isinstance(total, int) and total > len(data):
        result["listIsCutShort"] = True
        result["totalRecords"] = total


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
            _mark_cut_short(result, tool_name, data, args)
        if include_summary and tool_name in MULTI_FIELD_SUMMARY_TOOLS and isinstance(data, list):
            result["summary"] = summarize_records(data)
            result["detailsArePreview"] = True
        else:
            summary_spec = SUMMARY_TOOL_SPECS.get(tool_name)
            if include_summary and summary_spec:
                collection_name, filter_specs = summary_spec
                result["summary"] = summarize_collection(collection_name, _spec_filters(filter_specs, args))
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
    on_tool: Optional[Callable[[str], None]] = None,
) -> dict[str, Any]:
    """
    Runs the tools listed in page_registry.py using safe inferred arguments.
    on_tool hears each tool's name as it starts (the chat's live steps).

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
        if on_tool:
            on_tool(tool_name)
        # The signed-in SME's own records: participantId/uid first; the email is
        # passed only as the email fallback until Phase 4 (docs/sme-identity-migration-plan.md).
        if tool_name in {
            "get_participant_by_user",
            "get_applications_by_user",
            "get_inquiries_by_user",
            "get_intake_submissions_by_user",
        }:
            if not (participant_id or user_id or email):
                results[tool_name] = {
                    "ok": False,
                    "error": "Missing participantId and user id",
                }
                continue

            results[tool_name] = _safe_run(
                tool_name,
                participant_id or "",
                user_id or "",
                email or "",
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
            "get_intervention_impact_by_program",
            "get_timesheets_by_program",
        }:
            if not program_id:
                # "All my programmes" (tool_scope.py): once per programme the person holds, merged.
                programme_scope = page_context.get("programScope") or []
                if programme_scope:
                    results[tool_name] = merge_programme_results({
                        scoped_id: _safe_run(tool_name, scoped_id, include_summary=include_summaries)
                        for scoped_id in programme_scope
                    })
                    continue
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
            "get_leave_requests_by_department",
            "get_kpi_targets_by_department",
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
            "get_leave_requests_by_user",
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
            "get_intervention_impact",
            "get_recent_activity_summary",
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
