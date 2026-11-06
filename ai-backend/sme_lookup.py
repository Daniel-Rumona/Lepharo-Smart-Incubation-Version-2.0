"""SMEs named in a question ("tell me about Zungu Trading"), looked up for staff.

The per-SME tools only know the signed-in SME's own record, so staff asking about an SME by
name got nothing back. This finds the SMEs whose name appears in the question, among the ones
the person may see (all, or their programmes), and fetches each one's records directly. An SME
can be named by its company (on the application) or by the person or business on the
participant record, so both are matched.

match_named_smes is pure so test_sme_lookup.py runs without Firebase.
"""

import re
import time
from typing import Any, Callable, Optional

MAX_NAMED = 3
MIN_NAME_LENGTH = 4
# Endings people leave off when they say a company's name.
COMPANY_SUFFIXES = re.compile(r"\b(pty|ltd|limited|cc|inc|npc|soc)\b")
CACHE_SECONDS = 300

_cache: dict[str, Any] = {"at": 0.0, "rows": []}


def _fold(value: Any) -> str:
    return " ".join(re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).split())


def _variants(name: str) -> set[str]:
    folded = _fold(name)
    short = " ".join(COMPANY_SUFFIXES.sub(" ", folded).split())
    return {item for item in (folded, short) if len(item) >= MIN_NAME_LENGTH}


def match_named_smes(question: str, candidates: list[dict[str, Any]], limit: int = MAX_NAMED) -> list[dict[str, Any]]:
    """Candidates ({id, programId, names: [...]}) with a name that appears whole in the question.
    A name inside a longer matched name is the same mention, so "Highveld Metal Works" doesn't
    also bring back an SME called "Highveld"."""
    text = f" {_fold(question)} "
    found: list[tuple[str, dict[str, Any]]] = []
    for candidate in candidates:
        matched = [variant for name in candidate.get("names") or [] for variant in _variants(name) if f" {variant} " in text]
        if matched:
            found.append((max(matched, key=len), candidate))
    found.sort(key=lambda item: -len(item[0]))
    kept: list[tuple[str, dict[str, Any]]] = []
    for name, candidate in found:
        if any(name != longer and f" {name} " in f" {longer} " for longer, _ in kept):
            continue
        kept.append((name, candidate))
    return [candidate for _, candidate in kept[:limit]]


def load_sme_names(db: Any) -> list[dict[str, Any]]:
    """Every SME with the names it goes by, cached for a few minutes."""
    if time.time() - _cache["at"] < CACHE_SECONDS and _cache["rows"]:
        return _cache["rows"]
    rows: dict[str, dict[str, Any]] = {}
    for document in db.collection("participants").stream():
        data = document.to_dict() or {}
        rows[document.id] = {
            "id": document.id,
            "programId": str(data.get("programId") or ""),
            "names": [data.get(field) for field in ("companyName", "beneficiaryName", "participantName", "businessName") if data.get(field)],
        }
    for document in db.collection("applications").stream():
        data = document.to_dict() or {}
        participant_id = str(data.get("participantId") or "")
        if participant_id not in rows:
            continue
        rows[participant_id]["names"].extend(
            data.get(field) for field in ("companyName", "businessName", "beneficiaryName") if data.get(field)
        )
    _cache["at"] = time.time()
    _cache["rows"] = list(rows.values())
    return _cache["rows"]


def named_sme_records(
    question: str,
    candidates: list[dict[str, Any]],
    programmes: Optional[list[str]],
    fetchers: dict[str, Callable[[str], Any]],
) -> list[dict[str, Any]]:
    """Records for each SME named in the question. programmes None means the person may see all."""
    visible = [item for item in candidates if programmes is None or item.get("programId") in programmes]
    records = []
    for sme in match_named_smes(question, visible):
        record: dict[str, Any] = {"participantId": sme["id"], "programId": sme.get("programId")}
        for key, fetch in fetchers.items():
            try:
                record[key] = fetch(sme["id"])
            except Exception as error:  # noqa: BLE001 - one missing part shouldn't lose the rest
                record[key] = {"error": type(error).__name__}
        records.append(record)
    return records
