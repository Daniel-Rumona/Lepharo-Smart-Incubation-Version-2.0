"""Reusable "accepted / edited / declined" feedback loop for AI-drafted suggestions.

Any endpoint that proposes a structured draft for a human to review — a KPI
agreement, a survey, a course outline, whatever comes next — can use this
module for two things:

  1. record_feedback(...) — after the user saves, log what was kept versus
     changed or dropped from the AI's draft, tagged under a `feature` key
     that identifies which endpoint/flow this is.
  2. build_feedback_prompt_block(feature) — fetch the most recent corrections
     for that feature and format them as a short prompt fragment, so the next
     draft nudges away from mistakes that were corrected before. No
     retraining, no per-feature storage schema to invent — just read this
     collection, using your own `feature` string.

All feedback lives in one shared Firestore collection (`aiSuggestionFeedback`)
distinguished only by `feature`, so corrections stay auditable in one place
regardless of how many features end up using this.

Deliberately avoids a Firestore composite index: querying is a single
`where(feature == ...)` and the action/recency filtering happens in Python —
the same fix already needed twice elsewhere in this app for exactly this kind
of "where + order_by needs an index that was never provisioned" failure.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Literal, Optional

from pydantic import BaseModel

from firestore_tools import db

FEEDBACK_COLLECTION = "aiSuggestionFeedback"

FeedbackAction = Literal["accepted", "edited", "declined"]


class FeedbackItem(BaseModel):
    """One suggestion the user reviewed, and what they ultimately did with it."""

    entityType: str
    suggested: Any = None
    final: Any = None
    action: FeedbackAction
    reason: Optional[str] = None


class FeedbackRecordRequest(BaseModel):
    feature: str
    items: list[FeedbackItem]
    sourceExcerpt: Optional[str] = None


def record_feedback(
    feature: str,
    items: list[FeedbackItem],
    actor: str,
    source_excerpt: str | None = None,
) -> int:
    """Persist one review batch. Returns how many items were written.

    Best-effort: a write failure here should never break the caller's actual
    save, so callers are expected to wrap this in a try/except and log rather
    than raise.
    """
    if not items:
        return 0

    feature = (feature or "").strip()[:80]
    if not feature:
        return 0

    now_iso = datetime.now(timezone.utc).isoformat()
    excerpt = (source_excerpt or "")[:400]
    collection = db.collection(FEEDBACK_COLLECTION)
    batch = db.batch()

    for item in items[:50]:
        doc_ref = collection.document()
        batch.set(
            doc_ref,
            {
                "feature": feature,
                "entityType": item.entityType[:120],
                "suggested": item.suggested,
                "final": item.final,
                "action": item.action,
                "reason": (item.reason or "")[:500] or None,
                "sourceExcerpt": excerpt or None,
                "actor": actor,
                "createdAtIso": now_iso,
            },
        )

    batch.commit()
    return min(len(items), 50)


def build_feedback_prompt_block(feature: str, limit: int = 6) -> str:
    """Return a short prompt fragment summarising recent corrections, or "" if none.

    Only "edited" and "declined" rows carry a correction worth surfacing —
    "accepted" rows are still recorded (useful for later auditing/confidence)
    but repeating "you got this right" back into the prompt wastes tokens.
    """
    feature = (feature or "").strip()[:80]
    if not feature:
        return ""

    try:
        docs = list(
            db.collection(FEEDBACK_COLLECTION)
            .where("feature", "==", feature)
            .limit(300)
            .stream()
        )
    except Exception as error:
        print("build_feedback_prompt_block failed:", type(error).__name__, str(error), flush=True)
        return ""

    corrections = [
        data
        for data in (doc.to_dict() or {} for doc in docs)
        if data.get("action") in ("edited", "declined")
    ]
    if not corrections:
        return ""

    corrections.sort(key=lambda d: str(d.get("createdAtIso") or ""), reverse=True)
    corrections = corrections[:limit]

    lines: list[str] = []
    for data in corrections:
        entity = str(data.get("entityType") or "item")
        suggested = json.dumps(data.get("suggested"), default=str)[:200]
        action = data.get("action")
        reason = data.get("reason")

        if action == "declined":
            line = f'- For a "{entity}", you previously suggested {suggested} and it was removed entirely — it was not wanted'
        else:
            final = json.dumps(data.get("final"), default=str)[:200]
            line = f'- For a "{entity}", you previously suggested {suggested} but the correct result was {final}'
        if reason:
            line += f' (reason given: "{reason}")'
        line += "."
        lines.append(line)

    return (
        "Known corrections from past drafts for this task — learn from these, "
        "do not repeat the same mistakes, but still only report what is actually "
        "in the current document/conversation:\n" + "\n".join(lines) + "\n"
    )
