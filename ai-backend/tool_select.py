"""Which data tools a chat question runs. Keyword rules, not the model: cheap and predictable.

Kept apart from app.py so it can be tested without Firebase.
"""

import re


# Topic keyword -> substring(s) that must appear in a candidate tool's name.
# Keyword-based, not an LLM call: this used to cost a full Gemini request per
# message just to shortlist tool names, which is wasteful given free-tier
# quota is 20 requests/day (and this ran on every single message).
TOOL_TOPIC_RULES: list[tuple[re.Pattern, tuple[str, ...]]] = [
    (re.compile(r"\bparticipants?\b|\bsmmes?\b|\bsmes?\b|\bincubatees?\b|\bbeneficiar|\bdemographic|\bownership|\byouth.?owned|\bfemale.?owned|\bblack.?owned|\bbee\b|\bprofile\b", re.I), ("participant",)),
    (re.compile(r"\bapplications?\b|\bapplicants?\b|\bapplied\b|\baccepted\b", re.I), ("application",)),
    (re.compile(r"\bintervention|\bworkshop|\btraining|\boverdue\b|\bworkload\b|\bcompletion\b|\bcompleted\b|\bin progress\b", re.I), ("intervention",)),
    (re.compile(r"\bappointments?\b|\bsessions?\b|\bmeetings?\b|\bschedul|\bcalendar\b", re.I), ("appointment",)),
    (re.compile(r"\bcompliance\b|\boutstanding document", re.I), ("compliance",)),
    (re.compile(r"\bmovs?\b|means of verification", re.I), ("mov",)),
    (re.compile(r"\bdiagnostic\b|\bgrowth plan\b|\bdevelopment(al)? plan\b", re.I), ("diagnostic",)),
    (re.compile(r"\binquir|\benquir|\bquer(y|ies)\b", re.I), ("inquir",)),
    (re.compile(r"\bintake\b|\bsubmissions?\b", re.I), ("intake",)),
    (re.compile(r"\btimesheets?\b|\bclock.?(in|out)|\bhours worked\b|\battendance\b", re.I), ("clock", "time_record", "timesheet")),
    (re.compile(r"\bleave\b|\bpto\b|\bvacation\b|\btime off\b|\bsick(\s|-)?leave\b|\bannual leave\b|\bon leave\b", re.I), ("leave",)),
    (re.compile(r"\bkpis?\b|\bkey performance\b|\btargets?\b", re.I), ("kpi",)),
    (re.compile(r"\bmonthly\b|\btrend\b|\bover time\b|\bper month\b|\bchart\b|\bgraph\b|\bplot\b|\bspline\b|\bdonut\b", re.I), ("monthly",)),
    (re.compile(r"\bcatalog|\bservices? (offered|catalog)\b", re.I), ("catalog", "interventions_catalog")),
    (re.compile(r"\bdepartments?\b|\bhod\b", re.I), ("department",)),
    (re.compile(r"\bprogram(me)?s?\b|\bbranch\b", re.I), ("program",)),
    (re.compile(r"\bimpact\b|\bworking\b|\bworked\b|\beffective|\blift\b|\bpaying off\b|\bmade a difference\b|\brevenue (growth|change|increase)|\bjobs? (created|creation|growth|added)|\bheadcount\b|\bemployment\b", re.I), ("impact",)),
    (re.compile(r"\bbrief me\b|\bcatch me up\b|\bwhat happened\b|\brecap\b|\brecent activity\b|\bwhat'?s new\b|\btoday'?s? activity\b|\bsince (i|we) last\b|\bwhat needs my attention\b", re.I), ("recent_activity",)),
]

SELF_SCOPE_PATTERN = re.compile(r"\bmy\b|\bmine\b|\bassigned to me\b|\bi have\b|\bi am\b", re.I)
DEPARTMENT_SCOPE_PATTERN = re.compile(r"\bdepartment\b|\bmy team\b", re.I)
ORG_WIDE_SCOPE_PATTERN = re.compile(r"\ball program|\bacross the organi[sz]ation\b|\borg.?wide\b|\bwhole company\b|\bevery program", re.I)
SCOPE_SUFFIXES = ("_by_program", "_by_department", "_by_assignee", "_by_participant", "_by_email", "_by_user")


def _subject(name: str) -> str:
    """What a tool reads, without who it is filtered by: "get_appointments_by_participant" -> "get_appointments".
    The topic "SMEs" means participant records, not every tool that filters by participant."""
    return name.split("_by_")[0]


def select_tools(
    question: str,
    allowed_tools: set[str],
    page_tools: list[str],
) -> list[str]:
    if not allowed_tools:
        return []

    scores: dict[str, int] = {name: 0 for name in allowed_tools}
    on_topic: set[str] = set()

    for pattern, substrings in TOOL_TOPIC_RULES:
        if not pattern.search(question):
            continue
        for name in allowed_tools:
            if any(substring in _subject(name) for substring in substrings):
                scores[name] += 2
                on_topic.add(name)

    if SELF_SCOPE_PATTERN.search(question):
        for name in allowed_tools:
            if name.endswith(("_by_assignee", "_by_email", "_by_participant", "_by_user")):
                scores[name] += 1

    if DEPARTMENT_SCOPE_PATTERN.search(question):
        for name in allowed_tools:
            if name.endswith("_by_department"):
                scores[name] += 1

    if ORG_WIDE_SCOPE_PATTERN.search(question):
        for name in allowed_tools:
            if not name.endswith(SCOPE_SUFFIXES):
                scores[name] += 1

    for name in page_tools:
        if name in scores:
            scores[name] += 3

    # When the question names a topic ("my submitted inquiries"), only that topic's tools run: "my",
    # "department" and "all programmes" choose between them, never add unrelated reads such as the
    # person's own leave requests or applications. With no clear topic, the scope and page decide.
    candidates = on_topic or set(scores)
    ranked = sorted((name for name in candidates if scores[name] > 0), key=lambda n: (-scores[n], n))
    if ranked:
        return ranked[:6]

    return [name for name in page_tools if name in allowed_tools][:6]
