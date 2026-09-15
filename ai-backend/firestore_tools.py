import os
import json
import re
from datetime import datetime, timedelta, timezone

from firestore_transport import (
    configure_firestore_grpc_transport,
    firestore_routing_diagnostic,
    firestore_transport_diagnostic,
    install_firestore_channel_metadata_guard,
    install_firestore_routing_workaround,
    suppress_default_database_resource_prefix,
)

# This must run before firebase_admin creates its Firestore gRPC channel.
configure_firestore_grpc_transport()

import firebase_admin
from firebase_admin import credentials, firestore
from google.cloud.firestore_v1.services.firestore import client as firestore_gapic_client

# Re-apply against the exact GAPIC module used by the installed Firestore
# client, wrap the channel so nothing reaches the wire with an encoded
# default-database token, then emit a secret-free deployment diagnostic.
install_firestore_routing_workaround(firestore_gapic_client.gapic_v1.routing_header)
install_firestore_channel_metadata_guard()
print(
    "Firestore routing metadata diagnostic:",
    json.dumps(firestore_routing_diagnostic(firestore_gapic_client.gapic_v1.routing_header)),
    flush=True,
)
print(
    "Firestore transport diagnostic:",
    json.dumps(firestore_transport_diagnostic()),
    flush=True,
)


def init_firestore():
    if not firebase_admin._apps:
        raw = os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON")
        if not raw:
            raise RuntimeError("Missing FIREBASE_SERVICE_ACCOUNT_JSON secret.")

        service_account = json.loads(raw)
        cred = credentials.Certificate(service_account)
        firebase_admin.initialize_app(cred)

    client = firestore.client()
    print(
        "Firestore client metadata diagnostic:",
        json.dumps(suppress_default_database_resource_prefix(client)),
        flush=True,
    )
    return client


db = init_firestore()


def firestore_connectivity_probe(timeout: float = 10.0) -> dict:
    """One cheap read at boot, so the log says whether Firestore works.

    Without it the first failure only shows up as a 500 on a user request.
    """
    try:
        next(iter(db.collection("users").limit(1).stream(timeout=timeout)), None)
        return {"ok": True, "database": db._database_string}
    except Exception as error:
        return {
            "ok": False,
            "database": getattr(db, "_database_string", None),
            "error": f"{type(error).__name__}: {error}",
        }


if os.getenv("FIRESTORE_STARTUP_PROBE", "true").strip().lower() not in {
    "0",
    "false",
    "no",
    "off",
}:
    print("Firestore connectivity probe:", json.dumps(firestore_connectivity_probe()), flush=True)


def clean_doc(doc):
    data = doc.to_dict() or {}
    data["id"] = doc.id
    return data


def clean_docs(snap):
    return [clean_doc(doc) for doc in snap]


def list_collection(collection_name: str, max_results: int = 100):
    snap = db.collection(collection_name).limit(max_results).stream()
    return clean_docs(snap)


def query_collection(collection_name: str, field: str, value, max_results: int = 100):
    snap = (
        db.collection(collection_name)
        .where(field, "==", value)
        .limit(max_results)
        .stream()
    )
    return clean_docs(snap)


def _parse_date_like(value) -> "datetime | None":
    if value is None:
        return None
    if hasattr(value, "timestamp"):
        try:
            return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        except Exception:
            return None
    if isinstance(value, str):
        raw = value.strip().replace("Z", "+00:00")
        if not raw:
            return None
        try:
            parsed = datetime.fromisoformat(raw)
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            return None
    return None


COMPLETED_STATUS_VALUES = {"completed", "confirmed", "done"}


def add_overdue_labels(records: list) -> list:
    """
    Adds an exact, server-computed `overdueLabel` (overdue / on_track / completed
    / no_due_date) to each assignedInterventions-style record, derived from
    dueDate vs now and completionStatus. Without this, "overdue" has no
    authoritative signal — dueDate alone requires the model to compare it
    against "now" itself, which we don't allow it to do for exact counts.
    Feeds SUMMARY_BREAKDOWN_FIELDS so summarize_records() gets an exact
    overdue/completed breakdown, not just a raw preview.
    """
    now = datetime.now(timezone.utc)
    for record in records:
        if not isinstance(record, dict):
            continue
        completion_status = str(record.get("completionStatus") or "").strip().lower()
        if completion_status in COMPLETED_STATUS_VALUES:
            record["overdueLabel"] = "completed"
            continue
        due = _parse_date_like(record.get("dueDate"))
        if due is None:
            record["overdueLabel"] = "no_due_date"
        elif due < now:
            record["overdueLabel"] = "overdue"
        else:
            record["overdueLabel"] = "on_track"
    return records


SUMMARY_BREAKDOWN_FIELDS = (
    "status",
    "applicationStatus",
    "assignmentStatus",
    "assigneeStatus",
    "beneficiaryStatus",
    "completionStatus",
    "currentStatus",
    "overdueLabel",
    "type",
    "allocationType",
)

SUMMARY_UNIQUE_FIELDS = (
    "participantId",
    "programId",
    "assigneeId",
    "departmentId",
)

# Checked in order; the first present, resolvable value wins. Prioritises the
# most specific/terminal date on a record: a completed item should bucket by
# when it was completed, an overdue item by its due date, not by when it was
# first assigned/scheduled — otherwise "completed per month" would silently
# bucket by assignment month instead. Covers the date fields actually used
# across appointments/assignedInterventions/etc.
RECORD_DATE_FIELDS = (
    "completedAt",
    "dueDate",
    "startAt",
    "start",
    "date",
    "scheduledDate",
    "appointmentDate",
    "assignedAt",
    "createdAt",
    "updatedAt",
)


def _resolve_record_month(data: dict) -> str | None:
    for field in RECORD_DATE_FIELDS:
        value = data.get(field)
        if value is None:
            continue
        if hasattr(value, "strftime"):
            try:
                return value.strftime("%Y-%m")
            except Exception:
                continue
        if isinstance(value, str):
            raw = value.strip()
            if len(raw) >= 7 and raw[4] == "-":
                return raw[:7]
    return None


def summarize_records(records) -> dict:
    """Compute exact, ID-free aggregate metadata over an already-fetched record set."""
    total = 0
    breakdowns: dict[str, dict[str, int]] = {}
    unique_values: dict[str, set[str]] = {
        field: set() for field in SUMMARY_UNIQUE_FIELDS
    }
    monthly_counts: dict[str, int] = {}
    progress_total = 0.0
    progress_count = 0

    now = datetime.now(timezone.utc)
    for data in records:
        total += 1

        # summarize_collection() streams straight from Firestore, bypassing the
        # add_overdue_labels() applied to "data" preview lists — compute it here
        # too so program/department-scoped summaries get the same exact
        # overdueLabel breakdown as assignee-scoped ones. Only for records that
        # actually look like assignedInterventions (avoids polluting unrelated
        # collections with a meaningless "no_due_date" bucket).
        if "overdueLabel" not in data and ("dueDate" in data or "completionStatus" in data):
            completion_status = str(data.get("completionStatus") or "").strip().lower()
            if completion_status in COMPLETED_STATUS_VALUES:
                data["overdueLabel"] = "completed"
            else:
                due = _parse_date_like(data.get("dueDate"))
                if due is None:
                    data["overdueLabel"] = "no_due_date"
                elif due < now:
                    data["overdueLabel"] = "overdue"
                else:
                    data["overdueLabel"] = "on_track"

        for field in SUMMARY_BREAKDOWN_FIELDS:
            value = data.get(field)
            if value is None or isinstance(value, (dict, list)):
                continue
            label = str(value).strip() or "Unspecified"
            field_counts = breakdowns.setdefault(field, {})
            field_counts[label] = field_counts.get(label, 0) + 1

        for field in SUMMARY_UNIQUE_FIELDS:
            value = data.get(field)
            if value is not None and str(value).strip():
                unique_values[field].add(str(value))

        month_key = _resolve_record_month(data)
        if month_key:
            monthly_counts[month_key] = monthly_counts.get(month_key, 0) + 1

        progress = data.get("progress")
        percentage = progress.get("percentage") if isinstance(progress, dict) else None
        if isinstance(percentage, (int, float)):
            progress_total += float(percentage)
            progress_count += 1

    summary: dict[str, object] = {
        "totalRecords": total,
        "breakdowns": breakdowns,
        "uniqueCounts": {
            field.removesuffix("Id") + "Count": len(values)
            for field, values in unique_values.items()
            if values
        },
        "complete": True,
    }
    if monthly_counts:
        summary["monthlyCounts"] = dict(sorted(monthly_counts.items()))
    if progress_count:
        summary["averageProgressPercentage"] = round(
            progress_total / progress_count,
            2,
        )
        summary["recordsWithProgress"] = progress_count

    return summary


def summarize_collection(
    collection_name: str,
    filters: list[tuple[str, str, object]] | None = None,
):
    """Compute exact, ID-free aggregate metadata over the permitted query."""
    query = db.collection(collection_name)
    for field, operator, value in filters or []:
        query = query.where(field, operator, value)

    return summarize_records(
        (document.to_dict() or {}) for document in query.stream()
    )


# Different write paths in the frontend stamp the "who is this assigned to" id
# under different field names (assigneeId, coordinatorId, consultantId,
# facilitatorId, operationsDocId) — see src/services/appointmentService.ts's
# getAppointmentAssigneeId(), which normalises the same inconsistency on read.
# We can't OR across field names in one Firestore query, so fan out and merge.
ASSIGNEE_ID_FIELDS = (
    "assigneeId",
    "coordinatorId",
    "consultantId",
    "facilitatorId",
    "operationsDocId",
)


def query_by_any_field_any_value(
    collection_name: str,
    field_names: tuple[str, ...],
    values: list[str],
    max_results: int = 200,
) -> list[dict]:
    candidates = list(dict.fromkeys(str(v).strip() for v in values if v and str(v).strip()))
    if not candidates:
        return []

    merged: dict[str, dict] = {}
    for field in field_names:
        for value in candidates:
            try:
                docs = (
                    db.collection(collection_name)
                    .where(field, "==", value)
                    .limit(max_results)
                    .stream()
                )
                for doc in docs:
                    if doc.id not in merged:
                        merged[doc.id] = clean_doc(doc)
            except Exception:
                continue

    return list(merged.values())[:max_results]


# -------------------------
# Participants
# -------------------------

def get_participant_by_email(email: str):
    snap = (
        db.collection("participants")
        .where("email", "==", email)
        .limit(1)
        .stream()
    )

    for doc in snap:
        return clean_doc(doc)

    return None


def get_participant_by_id(participant_id: str):
    doc = db.collection("participants").document(participant_id).get()
    return clean_doc(doc) if doc.exists else None


def get_participants(max_results: int = 100):
    return list_collection("participants", max_results)


def get_applications_by_program(program_id: str, max_results: int = 200):
    return query_collection("applications", "programId", program_id, max_results)


def get_accepted_applications_by_program(program_id: str, max_results: int = 200):
    """
    Avoids a compound Firestore filter (programId + applicationStatus) — no
    composite index is deployed for `applications` (checked
    firestore.indexes.json: zero entries for this collection at all), so this
    previously failed at runtime with FAILED_PRECONDITION: query requires an
    index. Fetches by the single indexed field and filters status in Python.
    """
    accepted = []
    for document in (
        db.collection("applications").where("programId", "==", program_id).stream()
    ):
        data = document.to_dict() or {}
        if str(data.get("applicationStatus") or "").strip().lower() == "accepted":
            data["id"] = document.id
            accepted.append(data)
            if len(accepted) >= max_results:
                break
    return accepted


def get_participants_for_program(program_id: str, max_results: int = 200):
    applications = get_accepted_applications_by_program(program_id, max_results)

    participant_ids = list({
        item.get("participantId")
        for item in applications
        if item.get("participantId")
    })

    participants = []

    for participant_id in participant_ids[:max_results]:
        participant = get_participant_by_id(participant_id)
        if participant:
            participants.append(participant)

    return {
        "applications": applications,
        "participants": participants,
    }


def get_participant_metrics(participant_id: str, max_results: int = 100):
    # There is no `participantMetricsTimeline` collection — monthly performance
    # data actually lives at monthlyPerformance/{participantId}/history (a
    # subcollection keyed directly by participantId, no join needed). See
    # src/routes/incubatee/metrics/index.tsx:154-156.
    if not participant_id:
        return []
    return clean_docs(
        db.collection("monthlyPerformance")
        .document(participant_id)
        .collection("history")
        .limit(max_results)
        .stream()
    )


# -------------------------
# Applications / Applicant
# -------------------------

def get_applications(max_results: int = 100):
    return list_collection("applications", max_results)


def get_applications_by_email(email: str, max_results: int = 50):
    return query_collection("applications", "email", email, max_results)


def get_applications_by_participant(participant_id: str, max_results: int = 50):
    return query_collection("applications", "participantId", participant_id, max_results)


def get_active_programs(max_results: int = 100):
    snap = (
        db.collection("programs")
        .where("status", "==", "active")
        .limit(max_results)
        .stream()
    )
    return clean_docs(snap)


def get_programs(max_results: int = 100):
    return list_collection("programs", max_results)


def get_inquiries_by_email(email: str, max_results: int = 50):
    # Adjust collection name if your actual collection differs.
    return query_collection("inquiries", "email", email, max_results)


def get_inquiries_by_branch(branch_id: str, max_results: int = 200):
    # Mirrors src/services/inquiryService.ts's getBranchInquiries: inquiries are
    # scoped by `branchId`, not programId (a receptionist's inquiries can be
    # non-incubatee/general, with no program attached at all).
    return query_collection("inquiries", "branchId", branch_id, max_results)


def get_inquiries(max_results: int = 200):
    # Org-wide inquiries — for a director wanting every inquiry, not just their own.
    return list_collection("inquiries", max_results)


def get_intake_submissions_by_email(email: str, max_results: int = 50):
    return query_collection("smeIntakeSubmissions", "email", email, max_results)


def get_intake_submissions(max_results: int = 200):
    return list_collection("smeIntakeSubmissions", max_results)


# -------------------------
# Assigned Interventions
# -------------------------

def get_assigned_interventions(max_results: int = 100):
    return add_overdue_labels(list_collection("assignedInterventions", max_results))


def get_assigned_interventions_by_participant(participant_id: str, max_results: int = 100):
    return add_overdue_labels(
        query_collection("assignedInterventions", "participantId", participant_id, max_results)
    )


def get_assigned_interventions_by_assignee(assignee_ids, max_results: int = 500):
    # A single coordinator's own workload is realistically bounded, so we fetch
    # generously here to keep summarize_records()'s aggregate (monthly counts,
    # status breakdowns) exact rather than a truncated preview.
    values = assignee_ids if isinstance(assignee_ids, list) else [assignee_ids]
    return add_overdue_labels(
        query_by_any_field_any_value(
            "assignedInterventions", ASSIGNEE_ID_FIELDS, values, max_results
        )
    )


def get_assigned_interventions_by_program(program_id: str, max_results: int = 100):
    return add_overdue_labels(
        query_collection("assignedInterventions", "programId", program_id, max_results)
    )


def get_assigned_interventions_by_department(department_id: str, max_results: int = 100):
    return add_overdue_labels(
        query_collection("assignedInterventions", "departmentId", department_id, max_results)
    )


def _monthly_participants_serviced(query) -> list:
    monthly: dict[str, set[str]] = {}
    for document in query.stream():
        data = document.to_dict() or {}
        participant_id = data.get("participantId")
        timestamp = data.get("assignedAt") or data.get("updatedAt") or data.get("createdAt")
        if not participant_id or timestamp is None:
            continue
        try:
            month_key = timestamp.strftime("%Y-%m")
        except AttributeError:
            continue
        monthly.setdefault(month_key, set()).add(str(participant_id))

    return [
        {"month": month, "uniqueParticipantsServiced": len(participant_ids)}
        for month, participant_ids in sorted(monthly.items())
    ]


def get_monthly_participants_serviced_by_program(program_id: str):
    """
    Exact count of unique participants (SMMEs) serviced per calendar month for a
    program, derived from assignedInterventions. Mirrors the client-side
    per-month grouping in src/routes/coordinator/analytics/index.tsx
    (monthSeries) and src/components/dashboards/director/charts/SectorAnalysis.tsx
    (sectorMonthly), since there is no precomputed monthly-aggregate collection.
    Streams the full filtered collection (no page limit) so the result is a
    complete aggregate, not a preview.
    """
    query = db.collection("assignedInterventions").where("programId", "==", program_id)
    return _monthly_participants_serviced(query)


def get_monthly_participants_serviced():
    """Org-wide equivalent of get_monthly_participants_serviced_by_program, for
    a director wanting a trend across every programme, not one at a time."""
    query = db.collection("assignedInterventions")
    return _monthly_participants_serviced(query)


# -------------------------
# Diagnostic Plans
# -------------------------

def get_diagnostic_plan_by_participant(participant_id: str):
    snap = (
        db.collection("diagnosticPlans")
        .where("participantId", "==", participant_id)
        .limit(1)
        .stream()
    )

    for doc in snap:
        return clean_doc(doc)

    return None


def get_diagnostic_plans(max_results: int = 100):
    return list_collection("diagnosticPlans", max_results)


def get_diagnostic_plans_by_program(program_id: str, max_results: int = 100):
    return query_collection("diagnosticPlans", "programId", program_id, max_results)


# -------------------------
# Compliance
# -------------------------
# There is no `participantComplianceTimeline` collection — compliance documents
# actually live at applications/{applicationId}/complianceDocuments (a
# subcollection), with a legacy fallback: some older records only exist in an
# embedded `complianceDocuments` array field on the application doc itself
# (src/routes/shared/compliance/index.tsx:1106-1132;
# functions/src/complianceExpiry.ts:285-308 merges both). Neither storage
# location carries participantId/programId directly on the record — both are
# joined in from the parent application doc.
#
# No collectionGroup index is deployed for this (checked firestore.indexes.json
# — no complianceDocuments entries), so rather than requiring new infra we
# fetch applications first (already indexed by participantId/programId) and
# read each one's subcollection directly, mirroring complianceExpiry.ts.

def _compliance_records_for_applications(applications: list, max_results: int = 300) -> list:
    records: list = []
    for application in applications:
        app_id = application.get("id")
        if not app_id:
            continue
        participant_id = application.get("participantId")
        program_id = application.get("programId")

        try:
            for doc in (
                db.collection("applications")
                .document(app_id)
                .collection("complianceDocuments")
                .limit(max_results)
                .stream()
            ):
                data = clean_doc(doc)
                data["participantId"] = data.get("participantId") or participant_id
                data["programId"] = data.get("programId") or program_id
                data["applicationId"] = app_id
                records.append(data)
        except Exception:
            pass

        legacy = application.get("complianceDocuments")
        if isinstance(legacy, list):
            for index, item in enumerate(legacy):
                if not isinstance(item, dict):
                    continue
                data = dict(item)
                data.setdefault("id", f"{app_id}-legacy-{index}")
                data["participantId"] = data.get("participantId") or participant_id
                data["programId"] = data.get("programId") or program_id
                data["applicationId"] = app_id
                records.append(data)

        if len(records) >= max_results:
            break

    return records[:max_results]


def get_compliance_by_participant(participant_id: str, max_results: int = 200):
    applications = query_collection("applications", "participantId", participant_id, 50)
    return _compliance_records_for_applications(applications, max_results)


def get_compliance(max_results: int = 300):
    applications = list_collection("applications", 200)
    return _compliance_records_for_applications(applications, max_results)


def get_compliance_by_program(program_id: str, max_results: int = 300):
    applications = query_collection("applications", "programId", program_id, 200)
    return _compliance_records_for_applications(applications, max_results)


def get_compliance_document(application_id: str, document_id: str):
    """
    Fetch a single compliance document with participantId/programId joined in
    from its parent application, for the AI compliance-verification endpoint.
    """
    doc_ref = (
        db.collection("applications")
        .document(application_id)
        .collection("complianceDocuments")
        .document(document_id)
    )
    snapshot = doc_ref.get()
    if not snapshot.exists:
        return None

    data = clean_doc(snapshot)
    application_snapshot = db.collection("applications").document(application_id).get()
    application_data = (application_snapshot.to_dict() or {}) if application_snapshot.exists else {}
    data["participantId"] = data.get("participantId") or application_data.get("participantId")
    data["programId"] = data.get("programId") or application_data.get("programId")
    data["applicationId"] = application_id
    return data


def _slugify(value: str) -> str:
    text = re.sub(r"[^a-z0-9]+", "-", (value or "").strip().lower())
    return text.strip("-")


def _requirement_key(entry: dict) -> str:
    kind = str(entry.get("type") or entry.get("kind") or "upload")
    base = (
        entry.get("agreementId") or entry.get("id") or entry.get("title")
        if kind == "agreement"
        else entry.get("presetId") or entry.get("id") or entry.get("title")
    )
    return f"{kind}:{_slugify(str(base or ''))}"


def _document_key(document: dict) -> str:
    kind = str(document.get("kind") or "upload")
    base = (
        document.get("agreementId") or document.get("documentName")
        if kind == "agreement"
        else document.get("slug")
        or document.get("presetId")
        or document.get("documentName")
        # The incubatee self-service upload path
        # (src/routes/incubatee/documents/compliance/index.tsx) stores a plain
        # `type` field instead of slug/presetId/documentName — fall back to it.
        or document.get("type")
    )
    return f"{kind}:{_slugify(str(base or ''))}"


def find_required_document(program_id, department_id, document: dict):
    """
    Mirrors keyForReq()/keyForDoc() matching in
    src/routes/shared/compliance/index.tsx: finds which deptRequirements entry
    (programs/{programId}/deptRequirements/{departmentId}.requiredDocuments)
    an uploaded compliance document is meant to satisfy, so we know its
    expected title/expiry rule.
    """
    if not program_id or not department_id:
        return None

    snapshot = (
        db.collection("programs")
        .document(str(program_id))
        .collection("deptRequirements")
        .document(str(department_id))
        .get()
    )
    if not snapshot.exists:
        return None

    required_documents = (snapshot.to_dict() or {}).get("requiredDocuments")
    if not isinstance(required_documents, list):
        return None

    target_key = _document_key(document)
    for entry in required_documents:
        if isinstance(entry, dict) and _requirement_key(entry) == target_key:
            return entry
    return None


def update_compliance_document_status(
    application_id: str,
    document_id: str,
    status: str,
    note: str,
    reviewed_by: str = "AI Compliance Check",
):
    doc_ref = (
        db.collection("applications")
        .document(application_id)
        .collection("complianceDocuments")
        .document(document_id)
    )
    snapshot = doc_ref.get()
    existing = (snapshot.to_dict() or {}) if snapshot.exists else {}
    history = existing.get("statusHistory")
    history = list(history) if isinstance(history, list) else []
    history.append(
        {
            "status": status,
            "by": reviewed_by,
            "atISO": datetime.now(timezone.utc).isoformat(),
            "note": note,
        }
    )
    doc_ref.set(
        {"status": status, "statusHistory": history, "aiVerificationNote": note},
        merge=True,
    )


# -------------------------
# Intervention Requests
# -------------------------

def get_intervention_requests(max_results: int = 100):
    return list_collection("interventionRequests", max_results)


def get_intervention_requests_by_participant(participant_id: str, max_results: int = 100):
    return query_collection("interventionRequests", "participantId", participant_id, max_results)


def get_intervention_requests_by_program(program_id: str, max_results: int = 100):
    return query_collection("interventionRequests", "programId", program_id, max_results)


# -------------------------
# Completed Intervention Database
# -------------------------

def _is_sme_confirmed(record: dict) -> bool:
    status = str(record.get("participantCompletionStatus") or "").strip().lower()
    return status == "confirmed" or bool(record.get("participantConfirmedAt"))


def _completed_assigned(records: list[dict], max_results: int) -> list[dict]:
    return add_overdue_labels([record for record in records if _is_sme_confirmed(record)][:max_results])


def get_completed_interventions(max_results: int = 100):
    return _completed_assigned(list_collection("assignedInterventions", max_results * 3), max_results)


def get_completed_interventions_by_participant(participant_id: str, max_results: int = 100):
    return _completed_assigned(query_collection("assignedInterventions", "participantId", participant_id, max_results * 3), max_results)


def get_completed_interventions_by_program(program_id: str, max_results: int = 100):
    return _completed_assigned(query_collection("assignedInterventions", "programId", program_id, max_results * 3), max_results)


def get_completed_interventions_by_department(department_id: str, max_results: int = 100):
    return _completed_assigned(query_collection("assignedInterventions", "departmentId", department_id, max_results * 3), max_results)
    """
    Department-scoped records are read directly from the canonical collection.
    departmentId field at all — only assignedInterventions does. Joins via the
    Records are read directly from assignedInterventions.
    records back to department-scoped assignedInterventions.
    """
    return []
    ''' assigned_intervention_ids = [
        document.id
        for document in db.collection("assignedInterventions")
        .where("departmentId", "==", department_id)
        .stream()
    ]
    if not assigned_intervention_ids:
        return []

    return query_by_any_field_any_value(
        "assignedInterventions",
        ("assignedInterventionId",),
        assigned_intervention_ids,
        max_results,
    ) '''


# -------------------------
# Appointments
# -------------------------

def get_appointments(max_results: int = 100):
    return list_collection("appointments", max_results)


def get_appointments_by_participant(participant_id: str, max_results: int = 100):
    return query_collection("appointments", "participantId", participant_id, max_results)


def get_appointments_by_assignee(assignee_ids, max_results: int = 500):
    values = assignee_ids if isinstance(assignee_ids, list) else [assignee_ids]
    return query_by_any_field_any_value(
        "appointments", ASSIGNEE_ID_FIELDS, values, max_results
    )


def get_appointments_by_program(program_id: str, max_results: int = 100):
    return query_collection("appointments", "programId", program_id, max_results)


def get_appointments_by_department(department_id: str, max_results: int = 100):
    return query_collection("appointments", "departmentId", department_id, max_results)


# -------------------------
# MOVs
# -------------------------

def get_movs(max_results: int = 100):
    return list_collection("movDocuments", max_results)


def get_movs_by_participant(participant_id: str, max_results: int = 100):
    return query_collection("movDocuments", "participantId", participant_id, max_results)


def get_movs_by_program(program_id: str, max_results: int = 100):
    return query_collection("movDocuments", "programId", program_id, max_results)


def get_movs_by_department(department_id: str, max_results: int = 100):
    # departmentId is stamped by the primary MOV-creation path
    # (src/services/movService.ts) but a second path
    # (coordinator/allocated/intervention) only sets departmentName, not
    # departmentId — so this may miss some MOVs created via that path.
    return query_collection("movDocuments", "departmentId", department_id, max_results)


# -------------------------
# Departments / Intervention Catalog
# -------------------------

def get_departments(max_results: int = 100):
    return list_collection("departments", max_results)


def get_interventions_catalog(max_results: int = 100):
    return list_collection("interventions", max_results)


def get_interventions_by_department(department_id: str, max_results: int = 100):
    return query_collection("interventions", "departmentId", department_id, max_results)


# -------------------------
# Recent activity (on-demand catch-up, not a pushed digest)
# -------------------------
# (counterKey, collectionName, candidate date fields checked in order)
RECENT_ACTIVITY_SOURCES: tuple[tuple[str, str, tuple[str, ...]], ...] = (
    ("newApplications", "applications", ("submittedAt", "createdAt")),
    ("completedInterventions", "assignedInterventions", ("completedAt",)),
    ("movsUploaded", "movDocuments", ("uploadedAt", "createdAt")),
    ("appointmentsHeld", "appointments", ("startAt", "scheduledDate", "date")),
    ("complianceUpdates", "participantComplianceTimeline", ("updatedAt", "createdAt")),
)

# (windowLabel, windowDays)
RECENT_ACTIVITY_WINDOWS: tuple[tuple[str, int], ...] = (
    ("today", 1),
    ("week", 7),
    ("month", 30),
)


def get_recent_activity_summary() -> dict:
    """
    Exact, organisation-wide activity counts for a director's on-demand
    catch-up ("what happened today / this week / this month") — this is
    answered only when asked, never pushed. Streams each source collection
    once (same exactness guarantee as summarize_collection(): no max_results
    cap) and buckets each record into every window it falls within, so a
    record dated 2 days ago counts toward "week" and "month" but not "today".
    """
    now = datetime.now(timezone.utc)
    cutoffs = {label: now - timedelta(days=days) for label, days in RECENT_ACTIVITY_WINDOWS}
    counts: dict[str, dict[str, int]] = {
        label: {key: 0 for key, _, _ in RECENT_ACTIVITY_SOURCES}
        for label, _ in RECENT_ACTIVITY_WINDOWS
    }

    for key, collection_name, date_fields in RECENT_ACTIVITY_SOURCES:
        try:
            stream = db.collection(collection_name).stream()
        except Exception:
            continue

        for doc in stream:
            data = doc.to_dict() or {}

            record_date = None
            for field in date_fields:
                record_date = _parse_date_like(data.get(field))
                if record_date:
                    break

            if not record_date:
                continue

            for label, cutoff in cutoffs.items():
                if record_date >= cutoff:
                    counts[label][key] += 1

    return {
        "generatedAt": now.isoformat(),
        "windows": counts,
        "complete": True,
    }


# -------------------------
# Clock / Timesheets
# -------------------------
# The real collection is `timesheets` (src/routes/shared/timesheet/ClockInPage.tsx),
# one doc per user per day: { userId, date: "YYYY-MM-DD", hoursWorked, status }.
# There is no separate clockEvents/timeRecords collection — both tool pairs below
# read the same collection; they were previously pointed at collections that
# don't exist, so they always returned empty results.

def _staff_name(data: dict, fallback: str) -> str:
    direct = data.get("displayName") or data.get("fullName") or data.get("name")
    if direct:
        return str(direct).strip()
    parts = [data.get("firstName"), data.get("lastName")]
    combined = " ".join(str(part).strip() for part in parts if part and str(part).strip())
    return combined or str(data.get("email") or fallback)


def _decorate_timesheets(records: list[dict]) -> list[dict]:
    user_ids = {str(row.get("userId")) for row in records if row.get("userId")}
    names: dict[str, str] = {}
    if user_ids:
        for document in db.collection("users").stream():
            if document.id in user_ids:
                names[document.id] = _staff_name(document.to_dict() or {}, document.id)
    for row in records:
        user_id = str(row.get("userId") or "")
        row["staffName"] = names.get(user_id, "Staff member")
    return records


def get_clock_events(max_results: int = 100):
    return _decorate_timesheets(list_collection("timesheets", max_results))


def get_clock_events_by_user(user_id: str, max_results: int = 100):
    return _decorate_timesheets(query_collection("timesheets", "userId", user_id, max_results))


def get_time_records(max_results: int = 100):
    return _decorate_timesheets(list_collection("timesheets", max_results))


def get_time_records_by_user(user_id: str, max_results: int = 100):
    return _decorate_timesheets(query_collection("timesheets", "userId", user_id, max_results))


def get_timesheets_by_program(program_id: str, max_results: int = 200):
    """
    Timesheet entries for coordinators/staff assigned to a program — lets a
    Center Coordinator (projectadmin) see clock-in/out activity for the
    coordinators under their branch's programs. Timesheets only carry `userId`,
    so this resolves candidate user ids from `users` docs whose assigned
    program(s) include this program, then fetches their timesheet entries.
    """
    user_ids: set[str] = set()

    def _collect_program_ids(value) -> list[str]:
        values = value if isinstance(value, list) else [value]
        collected = []
        for item in values:
            if isinstance(item, dict):
                item = item.get("id") or item.get("programId")
            if item is not None and str(item).strip():
                collected.append(str(item).strip())
        return collected

    for document in db.collection("users").stream():
        data = document.to_dict() or {}
        assigned = _collect_program_ids(data.get("assignedPrograms")) + _collect_program_ids(
            data.get("assignedProgramId")
        )
        if program_id in assigned:
            user_ids.add(document.id)

    if not user_ids:
        return []

    return _decorate_timesheets(query_by_any_field_any_value("timesheets", ("userId",), list(user_ids), max_results))


def get_timesheets_by_department(department_id: str, max_results: int = 200):
    """
    Timesheet entries for staff in a department — lets an HOD see their own
    department's clock-in/out activity. Mirrors the same users->timesheets
    join as get_timesheets_by_program (timesheets only carry `userId`), using
    `users.departmentId` (confirmed real and already used for this exact
    purpose in src/services/attendanceVisibility.ts).
    """
    user_ids = [
        document.id
        for document in db.collection("users")
        .where("departmentId", "==", department_id)
        .stream()
    ]
    if not user_ids:
        return []

    return _decorate_timesheets(query_by_any_field_any_value("timesheets", ("userId",), user_ids, max_results))
