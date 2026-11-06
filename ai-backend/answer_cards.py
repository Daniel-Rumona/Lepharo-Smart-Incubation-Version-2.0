"""Answer cards: a small SME profile or intervention timeline under a chat reply.

When an answer is about one to three specific SMEs or interventions, the model may
add a cards marker naming them by id. Only ids that appear in the data fetched for
this question are kept, so a reply can never point at a record the user's tools
didn't return. The web app then loads each card under the user's own Firestore
permissions, so a card never shows more than they may already see.
"""

from typing import Any

CARDS_MARKER = "<<<CARDS_JSON>>>"
CARD_TYPES = ("sme", "intervention")
MAX_CARDS = 3
# Where record ids live in tool results.
ID_KEYS = {"id", "participantId", "assignedInterventionId", "assignmentId", "smeId"}


def cards_directive() -> str:
    return f"""- If — and only if — your answer is about one to three specific SMEs or specific assigned
      interventions that appear in the fetched data, append after everything else, on its own new line, the
      marker {CARDS_MARKER} and then, on the same line, ONLY a compact JSON array of at most {MAX_CARDS} items:
      [{{"type": "sme", "id": <the SME's participant id>}} | {{"type": "intervention", "id": <the assigned intervention's id>}}].
      Copy each id exactly from the fetched data. The app shows each as a small profile or timeline card, so do
      not repeat in prose every detail a card shows. Leave the marker out for general answers, counts, lists of
      more than three, or anything not about specific records."""


def known_ids(fetched: Any) -> set[str]:
    """Every record id in the fetched data, wherever it sits."""
    found: set[str] = set()

    def walk(value: Any) -> None:
        if isinstance(value, dict):
            for key, item in value.items():
                if key in ID_KEYS and isinstance(item, str) and item.strip():
                    found.add(item.strip())
                walk(item)
        elif isinstance(value, list):
            for item in value:
                walk(item)

    walk(fetched)
    return found


def sanitize_cards(raw: Any, fetched: Any) -> list[dict[str, str]]:
    """Keeps up to three well-formed cards whose ids came back from this question's tools."""
    if isinstance(raw, dict):
        raw = [raw]
    if not isinstance(raw, list):
        return []
    ids = known_ids(fetched)
    cards: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()
    for item in raw:
        if not isinstance(item, dict):
            continue
        kind = item.get("type")
        record = str(item.get("id") or "").strip()
        if kind not in CARD_TYPES or not record or record not in ids or (kind, record) in seen:
            continue
        seen.add((kind, record))
        cards.append({"type": kind, "id": record})
        if len(cards) >= MAX_CARDS:
            break
    return cards
