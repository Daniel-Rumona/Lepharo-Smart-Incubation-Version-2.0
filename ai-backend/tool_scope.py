"""Which data tools a chat request may use, decided by the programme filter.

One rule for every role: the universal programme filter decides the scope.
- A programme selected: that programme's tools. Whole-system tools that have a
  per-programme twin are swapped for the twin, so an admin's "how many MOVs?"
  answers for the selected programme rather than the whole system.
- "All programmes", for people who may see everything: the whole-system tools.
  Per-programme tools are dropped (they need a programme to run).
- "All programmes", for people limited to their own programmes (project admins,
  funders): the per-programme tools run once for each of their programmes and
  the results are merged, up to MAX_SCOPED_PROGRAMMES. They never get the
  whole-system tools, which would show other programmes.

Pure, so test_tool_scope.py runs without Firebase.
"""

from typing import Any, Optional

MAX_SCOPED_PROGRAMMES = 5

# Whole-system tool -> the same data for one programme.
PROGRAMME_TWINS = {
    "get_participants": "get_participants_for_program",
    "get_applications": "get_applications_by_program",
    "get_assigned_interventions": "get_assigned_interventions_by_program",
    "get_diagnostic_plans": "get_diagnostic_plans_by_program",
    "get_compliance": "get_compliance_by_program",
    "get_intervention_requests": "get_intervention_requests_by_program",
    "get_completed_interventions": "get_completed_interventions_by_program",
    "get_appointments": "get_appointments_by_program",
    "get_movs": "get_movs_by_program",
    "get_monthly_participants_serviced": "get_monthly_participants_serviced_by_program",
    "get_intervention_impact": "get_intervention_impact_by_program",
}


def scope_tools(
    allowed: set[str],
    *,
    programme: Optional[str],
    own_programmes: Optional[list[str]],
    programme_tools: set[str],
) -> tuple[set[str], Optional[list[str]], Optional[str]]:
    """Returns (tools to offer, programmes to run per-programme tools across, a note for the model).

    own_programmes is None for people who may see every programme, and the list of
    their programmes otherwise.
    """
    tools = set(allowed)
    if programme:
        for whole_system, twin in PROGRAMME_TWINS.items():
            if whole_system in tools and twin in programme_tools:
                tools.discard(whole_system)
                tools.add(twin)
        return tools, None, None

    if own_programmes is None:
        return tools - programme_tools, None, None

    if not own_programmes:
        return tools - programme_tools, None, "This person has no programmes assigned, so no programme data is available."
    if len(own_programmes) > MAX_SCOPED_PROGRAMMES:
        return (
            tools - programme_tools,
            None,
            f"This person has {len(own_programmes)} programmes, too many to answer across at once. "
            "If the question needs programme data, ask them to choose one in the programme filter at the top of the page.",
        )
    return tools, list(own_programmes), None


def merge_programme_results(by_programme: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """One tool's results from each programme, as one result. Records keep their own fields
    (and say which programme they came from); summaries stay per programme."""
    ok = [result for result in by_programme.values() if isinstance(result, dict) and result.get("ok")]
    if not ok:
        errors = [str(result.get("error")) for result in by_programme.values() if isinstance(result, dict)]
        return {"ok": False, "error": "; ".join(dict.fromkeys(errors)) or "No programme returned data."}

    data: list[Any] = []
    seen: set[str] = set()
    other: dict[str, Any] = {}
    summaries: dict[str, Any] = {}
    for programme, result in by_programme.items():
        if not (isinstance(result, dict) and result.get("ok")):
            continue
        records = result.get("data")
        if isinstance(records, list):
            for record in records:
                key = record.get("id") if isinstance(record, dict) else None
                if key and key in seen:
                    continue
                if key:
                    seen.add(key)
                if isinstance(record, dict) and "programId" not in record:
                    record = {**record, "programId": programme}
                data.append(record)
        elif records is not None:
            other[programme] = records
        if "summary" in result:
            summaries[programme] = result["summary"]

    merged: dict[str, Any] = {"ok": True, "programmes": list(by_programme.keys())}
    if data or not other:
        merged["data"] = data
        merged["detailRecordsReturned"] = len(data)
        merged["detailsArePreview"] = any(result.get("detailsArePreview") for result in ok)
        cut = [result for result in ok if result.get("listIsCutShort")]
        if cut:
            merged["listIsCutShort"] = True
            merged["totalRecords"] = sum(int(result.get("totalRecords") or result.get("detailRecordsReturned") or 0) for result in ok)
    if other:
        merged["dataByProgramme"] = other
    if summaries:
        merged["summaryByProgramme"] = summaries
    return merged
