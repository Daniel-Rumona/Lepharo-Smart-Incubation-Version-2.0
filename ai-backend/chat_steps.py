"""The steps the assistant shows while it works ("Reading your interventions…").

Each data tool gets a plain label from its name, with overrides where the name
reads badly. The web app shows them live from /chat/stream, so waiting reads as
work being done rather than a spinner.
"""

import json
import queue
import re
import threading
from typing import Any, Iterator, Optional

UNDERSTANDING = "Understanding your question"
WRITING = "Writing the answer"

# Where the plain rule ("get_assigned_interventions_by_program" -> "assigned
# interventions") doesn't say it the way a person would.
LABELS = {
    "get_participant_by_email": "Looking up your profile",
    "get_participant_by_user": "Looking up your profile",
    "get_participant_by_id": "Looking up the SME",
    "get_active_programs": "Checking the programmes",
    "get_programs": "Checking the programmes",
    "get_movs": "Reading MOVs",
    "get_compliance": "Checking compliance documents",
    "get_clock_events": "Reading clock-ins",
    "get_time_records": "Reading timesheets",
    "get_intervention_impact": "Reading what's working",
    "get_recent_activity_summary": "Summarising recent activity",
    "get_monthly_participants_serviced": "Counting SMEs supported",
    "get_kpi_targets": "Reading KPI targets",
    "get_interventions_catalog": "Reading the intervention library",
    "get_participant_metrics": "Reading revenue and employees",
    "get_diagnostic_plan": "Reading the development plan",
}


def tool_step_label(name: str) -> str:
    """'get_appointments_by_department' -> 'Reading appointments'."""
    base = re.sub(r"_by_[a-z_]+$", "", str(name or ""))
    for key in (name, base):
        if key in LABELS:
            return LABELS[key]
    words = re.sub(r"^get_", "", base).replace("_", " ").strip()
    if not words:
        return "Gathering data"
    words = words.replace("movs", "MOVs").replace("kpi", "KPI")
    return f"Reading {words}"


class StepReporter:
    """Passes each step on once: tools that read alike share one line."""

    def __init__(self, send):
        self._send = send
        self._seen: set[str] = set()

    def __call__(self, label: str) -> None:
        if label and label not in self._seen:
            self._seen.add(label)
            self._send(label)

    def tool(self, name: str) -> None:
        self(tool_step_label(name))


def stream_events(run, server_error: str) -> Iterator[str]:
    """Runs `run(step)` on a worker thread and yields server-sent events as it goes: a "step"
    event per stage, then "result" with what `run` returned, or "error" with the status and
    detail of what it raised (anything carrying status_code/detail, like FastAPI's HTTPException)."""
    events: "queue.Queue[Optional[dict[str, Any]]]" = queue.Queue()

    def work() -> None:
        try:
            reply = run(StepReporter(lambda label: events.put({"type": "step", "label": label})))
            events.put({"type": "result", "data": reply})
        except Exception as error:  # noqa: BLE001 - reported to the page, never raised into the stream
            status = getattr(error, "status_code", None)
            if isinstance(status, int):
                events.put({"type": "error", "status": status, "detail": getattr(error, "detail", "") or server_error})
            else:
                print("Chat stream failed:", type(error).__name__, str(error), flush=True)
                events.put({"type": "error", "status": 500, "detail": server_error})
        finally:
            events.put(None)

    threading.Thread(target=work, daemon=True).start()
    while True:
        item = events.get()
        if item is None:
            return
        yield f"data: {json.dumps(item, default=str)}\n\n"
