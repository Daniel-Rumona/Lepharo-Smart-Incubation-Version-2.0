"""Watches drafted from the person's own words in the chat.

When someone asks to be told when something happens ("let me know if any Rustenburg SME goes
High risk with no session booked"), the model adds a watch marker with one of the fixed watch
types and the names it heard. Nothing is saved here: the web app shows the watch as a card,
the manageWatch function matches the names to records the person may see and says what already
matches, and only their click on "Start watching" creates it. Keep the types in step with
functions/src/watchesLogic.ts.
"""

from typing import Any, Optional

WATCH_MARKER = "<<<WATCH_JSON>>>"
WATCH_TYPES = ("sme_risk", "impact_reportable", "intervention_done")
# Roles that may set watches (watchesLogic.visibilityFor).
WATCH_ROLES = {
    "director", "operations", "system_admin", "superadmin",
    "projectadmin", "receptionist", "funder",
    "coordinator", "consultant", "mentor", "facilitator", "advisor",
}
TEXT_FIELDS = ("participantName", "participantId", "programName", "programId", "interventionTitle", "interventionId")
MAX_TEXT = 120


def watch_directive() -> str:
    return f"""- If the person asks to be told, alerted, kept posted or reminded WHEN something happens in the
      future (not a question about now), and it is one of these, append after everything else, on its own
      new line, the marker {WATCH_MARKER} and then, on the same line, ONLY one compact JSON object:
        {{"type": "sme_risk", "participantName"?: str, "programName"?: str, "level"?: "Medium"|"High"|"Critical", "noSessionDays"?: int}}
          when an SME (or any SME, optionally in a programme) reaches a risk level, optionally with no session
          booked in the next N days ("no session booked" alone means 14);
        {{"type": "impact_reportable", "interventionTitle": str, "programName"?: str, "metric"?: "revenue"|"jobs"}}
          when an intervention's impact result becomes reportable;
        {{"type": "intervention_done", "participantName": str, "interventionTitle"?: str}}
          when an SME completes an intervention.
      Use the names exactly as the person said them (or as they appear in the fetched data); include an id
      field only if you copy it from the fetched data. In the reply, say in one short sentence what you will
      watch and that they can start it below; do not claim it is already set. Checks run every morning.
      If they ask for something else to be watched, say which of these three you can watch instead and add no marker.
    - Offering a watch: when the person asks about the current state of one of these three (e.g. which SMEs are
      High risk with no session booked, whether an intervention's impact is reportable yet, whether an SME has
      finished an intervention) and the answer is something that could change later, you may add the same marker
      with the matching object plus "offer": true, so the app can ask "Want me to tell you when this changes?".
      Do not mention the offer in the reply text; the app shows it. At most one marker per reply."""


def _text(value: Any) -> Optional[str]:
    if not isinstance(value, (str, int, float)) or isinstance(value, bool):
        return None
    cleaned = " ".join(str(value).split())[:MAX_TEXT]
    return cleaned or None


def sanitize_watch(raw: Any) -> Optional[dict[str, Any]]:
    """A well-formed draft watch, or None. The function re-checks everything before saving."""
    if not isinstance(raw, dict) or raw.get("type") not in WATCH_TYPES:
        return None
    draft: dict[str, Any] = {"type": raw["type"]}
    if raw.get("offer") is True:
        # Offered after an answer, not asked for: the app shows a question first.
        draft["offer"] = True
    for field in TEXT_FIELDS:
        value = _text(raw.get(field))
        if value:
            draft[field] = value
    if raw["type"] == "sme_risk":
        level = str(raw.get("level") or "").lower()
        if level in ("medium", "critical"):
            draft["level"] = level.capitalize()
        try:
            days = int(raw.get("noSessionDays") or 0)
        except (TypeError, ValueError):
            days = 0
        if days > 0:
            draft["noSessionDays"] = min(days, 90)
    if raw["type"] == "impact_reportable":
        if not (draft.get("interventionTitle") or draft.get("interventionId")):
            return None
        if raw.get("metric") in ("revenue", "jobs"):
            draft["metric"] = raw["metric"]
    if raw["type"] == "intervention_done" and not (draft.get("participantName") or draft.get("participantId")):
        return None
    return draft
