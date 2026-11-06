"""
AI review of an uploaded compliance document: is it legible, is it the expected
document, and what dates and identifiers does it carry.

The review is a suggestion for staff, never a decision. run_compliance_verification
(app.py) stores it on the document as `aiReview` and leaves the status alone, so
a person still verifies or invalidates every document; the staff Compliance page
offers the suggestion as one click. Only a document whose recorded dates already
show it expired is marked expired, because that follows from the dates alone.

Pure functions, so the prompt, parsing and the decision can be tested without
the Gemini SDK or Firestore.
"""

import calendar
import json
import re
from datetime import datetime, timezone
from typing import Any, Optional

CODE_FENCE = re.compile(r"^```(?:json)?\s*|\s*```$", re.IGNORECASE)
ISO_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

RECOMMENDATIONS = {"valid", "invalid", "expired", "unclear"}
CONFIDENCE = {"high", "medium", "low"}


def build_compliance_prompt(expected_title: str) -> str:
    return f"""
You are checking a compliance document an SME uploaded to a business incubation platform.

Expected document type: "{expected_title or 'Unknown, use your best judgement'}"

Look at the attached file and answer:
1. Is it legible and a genuine, complete document (not blank, not corrupted, not an unrelated photo)?
2. Does its content plausibly match the expected document type above?
3. Read these from the document if they are printed on it, otherwise null:
   - issueDate: the date it was issued, certified, generated or signed
   - expiryDate: the date it expires or is valid until
   - holderName: the company or person it was issued to
   - registrationNumber: the company registration number (e.g. 2019/123456/07)
   - idNumber: a national ID number, only on an identity document
4. How confident are you in the answers above: high, medium or low.

Dates must be YYYY-MM-DD. Never guess a date that is not on the document.

Respond with strict JSON only, no markdown fences, matching exactly:
{{"legible": true|false, "matchesExpectedType": true|false, "reason": "one short sentence",
"issueDate": "YYYY-MM-DD"|null, "expiryDate": "YYYY-MM-DD"|null, "holderName": string|null,
"registrationNumber": string|null, "idNumber": string|null, "confidence": "high"|"medium"|"low"}}
"""


def _clean_text(value: Any, limit: int = 160) -> Optional[str]:
    if value is None:
        return None
    text = re.sub(r"\s+", " ", str(value)).strip()
    if not text or text.lower() in {"null", "none", "n/a", "unknown"}:
        return None
    return text[:limit]


def _clean_date(value: Any) -> Optional[str]:
    """A plausible YYYY-MM-DD date, or None. The model's date is never trusted blindly."""
    text = _clean_text(value, 10)
    if not text or not ISO_DATE.match(text):
        return None
    try:
        parsed = datetime.strptime(text, "%Y-%m-%d")
    except ValueError:
        return None
    return text if 1990 <= parsed.year <= 2100 else None


def parse_compliance_reply(raw_text: str) -> Optional[dict]:
    """The model's JSON reply as a clean verdict, or None if it can't be read."""
    cleaned = CODE_FENCE.sub("", (raw_text or "").strip()).strip()
    try:
        parsed = json.loads(cleaned)
    except (json.JSONDecodeError, TypeError):
        return None
    if not isinstance(parsed, dict):
        return None
    confidence = str(parsed.get("confidence") or "").strip().lower()
    return {
        "legible": parsed.get("legible") is True,
        "matchesExpectedType": parsed.get("matchesExpectedType") is True,
        "reason": (_clean_text(parsed.get("reason"), 300) or ""),
        "confidence": confidence if confidence in CONFIDENCE else "low",
        "extracted": {
            "issueDate": _clean_date(parsed.get("issueDate")),
            "expiryDate": _clean_date(parsed.get("expiryDate")),
            "holderName": _clean_text(parsed.get("holderName")),
            "registrationNumber": _clean_text(parsed.get("registrationNumber"), 40),
            "idNumber": _clean_text(parsed.get("idNumber"), 20),
        },
    }


def add_months(value: datetime, months: int) -> datetime:
    """Clamped to the month's last day (31 Jan + 1 month = 28/29 Feb), as the app does."""
    total = value.month - 1 + months
    year = value.year + total // 12
    month = total % 12 + 1
    return value.replace(year=year, month=month, day=min(value.day, calendar.monthrange(year, month)[1]))


def _as_date(value: Any) -> Optional[datetime]:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    text = _clean_date(value) if isinstance(value, str) and len(value.strip()) == 10 else None
    if text:
        return datetime.strptime(text, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    if isinstance(value, str) and value.strip():
        try:
            parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            return None
    return None


def _digits(value: Any) -> str:
    return re.sub(r"\D", "", str(value or ""))


def identity_check(extracted: dict, participant: Optional[dict]) -> str:
    """
    'match' or 'mismatch' when the document's registration number can be compared
    with the SME's, otherwise 'unknown'. Names are shown to staff, not compared:
    an ID copy names a director, not the business.
    """
    read = _digits(extracted.get("registrationNumber"))
    known = {_digits((participant or {}).get(field)) for field in ("registrationNumber", "companyRegistrationNumber", "regNumber")}
    known.discard("")
    if not read or not known:
        return "unknown"
    return "match" if read in known else "mismatch"


def expiry_from_reading(extracted: dict, document: dict, requirement: Optional[dict]) -> Optional[datetime]:
    """
    When the document expires, by the app's rule (the requirement's validity period
    from the issue date, else an expiry date), using the recorded issue date first
    and the one read from the document otherwise.
    """
    months = int((requirement or {}).get("expiryMonths") or 0) if (requirement or {}).get("hasExpiry") else 0
    issued = _as_date(document.get("issueDate")) or _as_date(extracted.get("issueDate"))
    if months > 0 and issued:
        return add_months(issued, months)
    return _as_date(document.get("expiryDate")) or _as_date(extracted.get("expiryDate"))


def assess_compliance_document(
    verdict: Optional[dict],
    document: dict,
    requirement: Optional[dict],
    participant: Optional[dict],
    now: datetime,
) -> dict:
    """The AI review to store, with a one-line note for staff."""
    if verdict is None:
        return {
            "recommendation": "unclear",
            "reason": "AI verification could not process this document.",
            "confidence": "low",
            "extracted": {},
            "identity": "unknown",
        }

    extracted = verdict["extracted"]
    identity = identity_check(extracted, participant)
    expires = expiry_from_reading(extracted, document, requirement)

    if not verdict["legible"]:
        recommendation, reason = "unclear", verdict["reason"] or "Document was not legible."
    elif not verdict["matchesExpectedType"]:
        recommendation, reason = "invalid", verdict["reason"] or "Document does not appear to match the required type."
    elif expires and expires < now:
        recommendation, reason = "expired", f"Document expired on {expires.date().isoformat()}."
    else:
        recommendation, reason = "valid", verdict["reason"] or "Document is legible and matches the required type."

    if identity == "mismatch":
        reason = f"{reason} The registration number on the document does not match the SME's."

    return {
        "recommendation": recommendation,
        "reason": reason[:300],
        "confidence": verdict["confidence"],
        "extracted": {key: value for key, value in extracted.items() if value},
        "identity": identity,
        **({"expiresOn": expires.date().isoformat()} if expires else {}),
    }


def claim_daily_check(state: Optional[dict], today: str, limit: int) -> tuple[Optional[dict], int]:
    """
    One more applicant pre-check today: the usage record to store and the checks
    left, or (None, 0) when today's limit is used up. The count restarts each day.
    """
    count = int((state or {}).get("count") or 0) if (state or {}).get("date") == today else 0
    if count >= limit:
        return None, 0
    return {"date": today, "count": count + 1}, limit - count - 1


RECOMMENDATION_LABELS = {
    "valid": "looks valid",
    "invalid": "does not look like the required document",
    "expired": "has expired",
    "unclear": "could not be checked",
}


def review_note(review: dict) -> str:
    """One line for the status history and the page's message."""
    label = RECOMMENDATION_LABELS.get(review.get("recommendation"), "could not be checked")
    return f"AI suggestion: {label}. {review.get('reason') or ''}".strip()
