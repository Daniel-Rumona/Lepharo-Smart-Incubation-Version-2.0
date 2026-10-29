"""Turn an uploaded departmental implementation plan into a DRAFT roadmap.

Nothing here persists. The endpoint returns milestones for the HOD to review,
edit and publish; only then does the client write them to `planRoadmaps`.
Plans are inconsistent (some give dates, many only say "Quarter 4"), so every
milestone carries a `dateConfidence` flag and the HOD confirms dates on review.
"""
from __future__ import annotations

import re
from datetime import date, timedelta
from typing import Any, Optional

from pydantic import BaseModel, Field

RECURRENCES = {"none", "weekly", "monthly", "quarterly"}
DATE_CONFIDENCE = {"exact", "inferred", "unknown"}
MAX_MILESTONES = 150


class RoadmapExtractionRequest(BaseModel):
    fileBase64: str
    fileName: str = ""
    mimeType: str = ""
    departmentId: str = ""
    programId: str = ""


class RoadmapMilestone(BaseModel):
    title: str
    deliverable: str = ""
    responsible: str = ""
    startDate: Optional[str] = None  # ISO yyyy-mm-dd
    dueDate: Optional[str] = None
    dateConfidence: str = "unknown"
    timeframeText: str = ""  # the plan's own wording, e.g. "Quarter 4"
    recurrence: str = "none"
    target: str = ""  # e.g. "15 SMMEs"


class RoadmapDraft(BaseModel):
    planTitle: str = ""
    departmentName: str = ""
    periodStart: Optional[str] = None
    periodEnd: Optional[str] = None
    milestones: list[RoadmapMilestone] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


def roadmap_extraction_prompt(today: date, department_name: str, feedback_block: str = "") -> str:
    return f"""
You read a departmental implementation plan for a funded SMME-support programme
and turn it into a milestone roadmap that a Head of Department will track.

Today is {today.isoformat()}. {f"The department is {department_name}." if department_name else ""}
{feedback_block}
Plans come in several shapes - treat each row of an activity/output/timeframe
table, each scheduled training session, each weekly engagement line and each
recurring service as a milestone. Skip pure mission text and budget lines.

Rules:
- Never invent activities, owners or numbers. Copy the plan's wording.
- "dueDate" must be ISO yyyy-mm-dd. If the plan gives a real date, use it and set
  dateConfidence "exact". If it only gives a period ("Quarter 4", "Nov 25 - Nov 26",
  "monthly"), set dueDate to the END of that period, dateConfidence "inferred",
  and keep the original wording in "timeframeText". Quarters are the plan's
  financial/academic year when stated, otherwise calendar quarters. If there is no
  timing at all, leave dueDate null and dateConfidence "unknown".
- "recurrence" is one of none, weekly, monthly, quarterly - use it for standing
  activities such as "weekly progress report" instead of listing every occurrence.
- "responsible" is the role/person named in the plan, else "".
- "target" is a quantity if the plan gives one (e.g. "15 SMMEs"), else "".
- One plan, one roadmap. Do not merge unrelated activities.

Return strict JSON only, no markdown fences:
{{"planTitle":"","departmentName":"","periodStart":"yyyy-mm-dd or null","periodEnd":"yyyy-mm-dd or null",
"milestones":[{{"title":"","deliverable":"","responsible":"","startDate":null,"dueDate":null,
"dateConfidence":"exact|inferred|unknown","timeframeText":"","recurrence":"none","target":""}}]}}
"""


def _clean(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _iso(value: Any) -> Optional[str]:
    text = _clean(value)
    if not text:
        return None
    try:
        return date.fromisoformat(text[:10]).isoformat()
    except ValueError:
        return None


def build_roadmap_draft(parsed: dict[str, Any], today: Optional[date] = None) -> RoadmapDraft:
    """Normalise model output; drop junk rather than failing the whole draft."""
    today = today or date.today()
    warnings: list[str] = []
    milestones: list[RoadmapMilestone] = []
    seen: set[tuple[str, Optional[str]]] = set()

    rows = parsed.get("milestones")
    for row in rows if isinstance(rows, list) else []:
        if not isinstance(row, dict):
            continue
        title = _clean(row.get("title"))
        if not title:
            continue
        due = _iso(row.get("dueDate"))
        start = _iso(row.get("startDate"))
        confidence = _clean(row.get("dateConfidence")).lower()
        if confidence not in DATE_CONFIDENCE:
            confidence = "unknown"
        if due is None:
            confidence = "unknown"
        elif confidence == "unknown":
            confidence = "inferred"
        if start and due and start > due:
            start = None
        recurrence = _clean(row.get("recurrence")).lower()
        if recurrence not in RECURRENCES:
            recurrence = "none"
        key = (title.lower(), due)
        if key in seen:
            continue
        seen.add(key)
        milestones.append(RoadmapMilestone(
            title=title[:300],
            deliverable=_clean(row.get("deliverable"))[:1000],
            responsible=_clean(row.get("responsible"))[:200],
            startDate=start,
            dueDate=due,
            dateConfidence=confidence,
            timeframeText=_clean(row.get("timeframeText"))[:200],
            recurrence=recurrence,
            target=_clean(row.get("target"))[:200],
        ))

    if len(milestones) > MAX_MILESTONES:
        warnings.append(f"Only the first {MAX_MILESTONES} milestones were kept.")
        milestones = milestones[:MAX_MILESTONES]

    undated = sum(1 for m in milestones if m.dueDate is None)
    inferred = sum(1 for m in milestones if m.dateConfidence == "inferred")
    past = sum(1 for m in milestones if m.dueDate and m.dueDate < today.isoformat() and m.recurrence == "none")
    if undated:
        warnings.append(f"{undated} milestone(s) have no date in the plan - set a due date or they will not be chased.")
    if inferred:
        warnings.append(f"{inferred} due date(s) were inferred from a period such as 'Quarter 4' - please confirm.")
    if past:
        warnings.append(f"{past} milestone(s) are already past due - mark them done or move the date.")

    return RoadmapDraft(
        planTitle=_clean(parsed.get("planTitle"))[:300],
        departmentName=_clean(parsed.get("departmentName"))[:200],
        periodStart=_iso(parsed.get("periodStart")),
        periodEnd=_iso(parsed.get("periodEnd")),
        milestones=milestones,
        warnings=warnings,
    )


def next_occurrence(due: date, recurrence: str) -> Optional[date]:
    """Used by tests/clients to expand a recurring milestone one step."""
    if recurrence == "weekly":
        return due + timedelta(days=7)
    if recurrence in ("monthly", "quarterly"):
        step = 1 if recurrence == "monthly" else 3
        month = due.month - 1 + step
        year, month = due.year + month // 12, month % 12 + 1
        for day in (due.day, 30, 29, 28):
            try:
                return date(year, month, day)
            except ValueError:
                continue
    return None
