"""One question across features: "which SMEs need me this week?"

Answered as one ranked list rather than four separate lookups. For each SME the person supports
it combines:
- the early-warning risk score and its reasons (smeRiskSnapshots, scored nightly; missing and
  expired documents, unanswered interventions and overdue check-backs are already in its reasons),
- MOVs whose evidence check came back weak, missing or unreadable (movDocuments.evidenceCheck),
- open interventions that are overdue or due in the next week (assignedInterventions),
- whether a session is booked in the next two weeks (appointments),
and gives each SME one next step. Who counts as "theirs" follows the watches' rules
(functions/src/watchesLogic.ts visibilityFor): everyone, their programmes, or the SMEs they own.

rank_attention is pure so test_attention_list.py runs without Firebase.
"""

import re
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

MAX_ITEMS = 10
DUE_SOON_DAYS = 7
SESSION_WINDOW_DAYS = 14
OPEN_ASSIGNMENT = {"assigned", "in-progress", "needs-reassignment"}
WEAK_EVIDENCE = ("weak", "missing", "unreadable")
LEVEL_POINTS = {"Critical": 40, "High": 25, "Medium": 10}
ROLE_VISIBILITY = {
    **{role: "all" for role in ("director", "operations", "system_admin", "superadmin")},
    **{role: "programmes" for role in ("projectadmin", "receptionist", "funder")},
    **{role: "own" for role in ("coordinator", "consultant", "mentor", "facilitator", "advisor")},
}

ATTENTION_PATTERN = re.compile(
    r"\bneeds?\b[^.?!]{0,25}\b(me|my attention|attention|help|follow.?up)\b"
    r"|\bwho should i\b"
    r"|\bwhich (smes?|businesses|clients|participants)\b[^.?!]{0,40}\b(focus|priorit|attention|worr|chase|follow|struggl|behind)"
    r"|\bpriorit(y|ies|ise|ize)\b[^.?!]{0,30}\b(smes?|businesses|clients|this week|today)\b"
    r"|\bwhere should i (focus|start)\b",
    re.I,
)


def asks_for_attention(question: str) -> bool:
    return bool(ATTENTION_PATTERN.search(question or ""))


def visibility_for(role: str, uid: str, programmes: Optional[list[str]]) -> Optional[dict[str, Any]]:
    """None when the person has no SMEs to rank. programmes: their programmes, or the one selected."""
    kind = ROLE_VISIBILITY.get((role or "").strip().lower())
    if not kind:
        return None
    if kind == "all":
        return {"kind": "programmes", "programmeIds": list(programmes)} if programmes else {"kind": "all"}
    if kind == "programmes":
        return {"kind": "programmes", "programmeIds": list(programmes)} if programmes else None
    return {"kind": "own", "uid": uid, "programmeIds": list(programmes or [])}


def _millis(value: Any) -> int:
    if isinstance(value, datetime):
        return int(value.timestamp() * 1000)
    if isinstance(value, (int, float)):
        return int(value)
    if isinstance(value, str):
        try:
            return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp() * 1000)
        except ValueError:
            return 0
    return 0


SAST = timezone(timedelta(hours=2))


def _day(ms: int, now_ms: int) -> str:
    """"Thu 6 Nov", with the year when it isn't this year ("17 Feb 2026")."""
    when = datetime.fromtimestamp(ms / 1000, SAST)
    if when.year != datetime.fromtimestamp(now_ms / 1000, SAST).year:
        return f"{when.day} {when.strftime('%b %Y')}"
    return f"{when.strftime('%a')} {when.day} {when.strftime('%b')}"


def rank_attention(
    snapshots: list[dict[str, Any]],
    assignments: list[dict[str, Any]],
    weak_movs: list[dict[str, Any]],
    next_session: dict[str, int],
    visibility: dict[str, Any],
    now_ms: int,
) -> dict[str, Any]:
    """{"items": [...], "total": n}: SMEs that need the person, most pressing first."""
    smes: dict[str, dict[str, Any]] = {}

    def sme(participant_id: str, name: str, programme: str) -> dict[str, Any]:
        entry = smes.setdefault(participant_id, {
            "participantId": participant_id, "name": name or "An SME", "programId": programme,
            "level": None, "score": 0, "trend": None, "reasons": [], "suggestion": None,
            "overdue": [], "dueSoon": [], "weakEvidence": [], "ownerIds": set(), "assigneeIds": set(),
        })
        if name and entry["name"] == "An SME":
            entry["name"] = name
        entry["programId"] = entry["programId"] or programme
        return entry

    for snap in snapshots:
        entry = sme(str(snap.get("participantId") or snap.get("id") or ""), str(snap.get("participantName") or ""), str(snap.get("programId") or ""))
        entry["level"] = snap.get("level")
        entry["trend"] = snap.get("trend")
        entry["ownerIds"].update(str(item) for item in snap.get("ownerIds") or [])
        reasons = [item for item in snap.get("reasons") or [] if isinstance(item, dict) and item.get("label")]
        entry["reasons"] = [str(item["label"]) for item in sorted(reasons, key=lambda item: -(item.get("points") or 0))]
        suggestion = snap.get("suggestion")
        entry["suggestion"] = suggestion.get("text") if isinstance(suggestion, dict) else None

    for row in assignments:
        if str(row.get("assignmentStatus") or "").lower() not in OPEN_ASSIGNMENT:
            continue
        due = _millis(row.get("dueDate"))
        if not due or due > now_ms + DUE_SOON_DAYS * 86_400_000:
            continue
        entry = sme(str(row.get("participantId") or ""), str(row.get("participantName") or ""), str(row.get("programId") or ""))
        entry["assigneeIds"].add(str(row.get("assigneeId") or ""))
        item = {"title": str(row.get("interventionTitle") or "An intervention"), "due": due}
        (entry["overdue"] if due < now_ms else entry["dueSoon"]).append(item)

    for mov in weak_movs:
        if str(mov.get("status") or "") == "approved":
            continue
        entry = sme(str(mov.get("participantId") or ""), str(mov.get("smmeCompanyName") or mov.get("beneficiaryName") or ""), str(mov.get("programId") or ""))
        entry["assigneeIds"].add(str(mov.get("facilitatorId") or ""))
        check = mov.get("evidenceCheck") or {}
        entry["weakEvidence"].append({"title": str(mov.get("interventionTitle") or "an intervention"), "verdict": str(check.get("verdict") or "weak")})

    def visible(entry: dict[str, Any]) -> bool:
        if not entry["participantId"]:
            return False
        kind = visibility.get("kind")
        programmes = visibility.get("programmeIds") or []
        if kind == "all":
            return True
        if kind == "programmes":
            return entry["programId"] in programmes
        uid = visibility.get("uid")
        mine = uid in entry["ownerIds"] or uid in entry["assigneeIds"]
        return mine and (not programmes or entry["programId"] in programmes)

    items = []
    for entry in smes.values():
        if not visible(entry):
            continue
        level = entry["level"] if entry["level"] in LEVEL_POINTS else None
        session = next_session.get(entry["participantId"])
        no_session = level in ("High", "Critical") and not (session and session <= now_ms + SESSION_WINDOW_DAYS * 86_400_000)
        points = (
            LEVEL_POINTS.get(level or "", 0)
            + min(len(entry["overdue"]) * 8, 24)
            + min(len(entry["weakEvidence"]) * 10, 20)
            + min(len(entry["dueSoon"]) * 4, 8)
            + (5 if entry["trend"] == "up" else 0)
            + (6 if no_session else 0)
        )
        if not points:
            continue

        why: list[str] = []
        if level:
            why.append(f"{level} risk" + (", getting worse" if entry["trend"] == "up" else ""))
        why.extend(entry["reasons"][:2])
        for mov in entry["weakEvidence"][:1]:
            why.append(f"Evidence on the {mov['title']} MOV is {mov['verdict']}")
        if entry["overdue"] and not any("past due" in reason for reason in entry["reasons"]):
            why.append(f"{len(entry['overdue'])} intervention{'s' if len(entry['overdue']) != 1 else ''} overdue")
        if entry["dueSoon"]:
            first = min(entry["dueSoon"], key=lambda item: item["due"])
            why.append(f"{first['title']} due {_day(first['due'], now_ms)}")
        if no_session:
            why.append(f"No session booked in the next {SESSION_WINDOW_DAYS} days")
        elif session and session <= now_ms + DUE_SOON_DAYS * 86_400_000:
            why.append(f"Session booked {_day(session, now_ms)}")

        if entry["weakEvidence"]:
            next_step = f"Fix the evidence on the {entry['weakEvidence'][0]['title']} MOV before the HOD reviews it."
        elif entry["suggestion"]:
            next_step = entry["suggestion"]
        elif entry["overdue"]:
            oldest = min(entry["overdue"], key=lambda item: item["due"])
            next_step = f"Deliver or reschedule {oldest['title']} (overdue since {_day(oldest['due'], now_ms)})."
        elif no_session:
            next_step = "Book a session."
        else:
            first = min(entry["dueSoon"], key=lambda item: item["due"])
            next_step = f"Deliver {first['title']} by {_day(first['due'], now_ms)}."

        items.append({
            "participantId": entry["participantId"],
            "name": entry["name"],
            "level": level,
            "points": points,
            "why": why[:4],
            "nextStep": next_step,
        })

    items.sort(key=lambda item: (-item["points"], item["name"]))
    return {"items": items[:MAX_ITEMS], "total": len(items)}


def load_attention(db: Any, visibility: dict[str, Any], now: Optional[datetime] = None) -> dict[str, Any]:
    """Reads the four sources and ranks them. Programme-limited people read only their programmes."""
    now = now or datetime.now(timezone.utc)
    now_ms = int(now.timestamp() * 1000)
    programmes = visibility.get("programmeIds") if visibility.get("kind") == "programmes" else None

    def rows(collection: str, *filters: tuple[str, str, Any]) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        chunks = [programmes[i:i + 30] for i in range(0, len(programmes), 30)] if programmes else [None]
        for chunk in chunks:
            query = db.collection(collection)
            for field, op, value in filters:
                query = query.where(field, op, value)
            if chunk is not None:
                query = query.where("programId", "in", chunk)
            out.extend({"id": doc.id, **(doc.to_dict() or {})} for doc in query.stream())
        return out

    snapshots = rows("smeRiskSnapshots")
    assignments = rows("assignedInterventions", ("assignmentStatus", "in", sorted(OPEN_ASSIGNMENT)))
    # Few MOVs have a weak check, so one query for all of them; rank_attention applies the scope.
    weak_movs = [{"id": doc.id, **(doc.to_dict() or {})} for doc in db.collection("movDocuments").where("evidenceCheck.verdict", "in", list(WEAK_EVIDENCE)).stream()]

    next_session: dict[str, int] = {}
    for doc in db.collection("appointments").where("startAt", ">=", now).stream():
        data = doc.to_dict() or {}
        if str(data.get("status") or "").lower() in ("cancelled", "declined", "completed"):
            continue
        sme = str(data.get("smeId") or data.get("participantId") or "")
        at = _millis(data.get("startAt"))
        if sme and at and (sme not in next_session or at < next_session[sme]):
            next_session[sme] = at
    return rank_attention(snapshots, assignments, weak_movs, next_session, visibility, now_ms)
