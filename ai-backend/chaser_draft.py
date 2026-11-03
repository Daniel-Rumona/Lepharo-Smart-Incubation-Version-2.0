"""Chasers drafted from the person's own words in the chat.

When someone asks the assistant to get MOVs (or MOV packs) moved along by a date ("get the MOVs
waiting for HOD approval in Legal approved by Friday"), the model adds a chaser marker with the
stage, the names it heard and the deadline as a date. Nothing is saved here: the web app shows
the chaser as a card, the manageChaser function finds the records and lists them, and only the
person's click on "Start chasing" creates it and sends the first nudges. Keep the stages in step
with functions/src/chasersLogic.ts.
"""

import re
from typing import Any, Optional

CHASER_MARKER = "<<<CHASER_JSON>>>"
CHASER_STAGES = ("awaiting_smme", "awaiting_hod", "queried", "awaiting_cc", "awaiting_me")
# The people who can send reminders from the Control Tower (movReminders.canRemind); for
# operations that is ROM and M&E only, which manageChaser checks.
CHASER_ROLES = {"system_admin", "projectadmin", "operations"}
MAX_TEXT = 120
MAX_NAMES = 25


def chaser_directive() -> str:
    return f"""- If the person asks you to chase, follow up, push or get MOVs or MOV packs approved, confirmed or
      validated by a date (for example "get the MOVs waiting for HOD approval in Legal approved by Friday",
      "chase these by the 14th"), append after everything else, on its own new line, the marker {CHASER_MARKER}
      and then, on the same line, ONLY one compact JSON object:
        {{"deadline": "YYYY-MM-DD", "stage"?: "awaiting_smme"|"awaiting_hod"|"queried"|"awaiting_cc"|"awaiting_me",
          "departmentName"?: str, "programName"?: str, "participantNames"?: [str], "maxNudges"?: 1|2|3}}
      Stages: awaiting_smme = waiting for the SME to confirm, awaiting_hod = waiting for HOD approval,
      queried = queried or rejected (the facilitator must act), awaiting_cc = packs waiting for the Centre
      Coordinator, awaiting_me = packs waiting for M&E. Work the deadline out from today's date ("Friday" is the
      coming Friday). When they say "these" about SMEs or MOVs in your previous answer, put those SME names in
      participantNames. Only set maxNudges if they say how many times. In the reply, say in one short sentence
      what you'll chase and by when, and that they can check the list and start it below; do not claim anything
      has been sent. If they give no date, ask for one and add no marker."""


def _text(value: Any) -> Optional[str]:
    if not isinstance(value, (str, int, float)) or isinstance(value, bool):
        return None
    cleaned = " ".join(str(value).split())[:MAX_TEXT]
    return cleaned or None


def sanitize_chaser(raw: Any) -> Optional[dict[str, Any]]:
    """A well-formed draft chaser, or None. The function re-checks everything before saving."""
    if not isinstance(raw, dict):
        return None
    deadline = str(raw.get("deadline") or "").strip()
    if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", deadline):
        return None
    draft: dict[str, Any] = {"deadline": deadline}
    if raw.get("stage") in CHASER_STAGES:
        draft["stage"] = raw["stage"]
    for field in ("departmentName", "programName"):
        value = _text(raw.get(field))
        if value:
            draft[field] = value
    names = raw.get("participantNames")
    if isinstance(names, list):
        cleaned = [name for name in (_text(item) for item in names) if name]
        if cleaned:
            draft["participantNames"] = list(dict.fromkeys(cleaned))[:MAX_NAMES]
    try:
        nudges = int(raw.get("maxNudges") or 0)
    except (TypeError, ValueError):
        nudges = 0
    if 1 <= nudges <= 3:
        draft["maxNudges"] = nudges
    if len(draft) == 1:
        # A date alone names nothing to chase.
        return None
    return draft
