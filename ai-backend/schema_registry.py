FIRESTORE_SCHEMA = {
    "participants": {
        "purpose": (
            "Stores SME and owner profile data, including demographic/ownership "
            "breakdown fields (gender, beeLevel, youthOwnedPercent, "
            "blackOwnedPercent, femaleOwnedPercent) used for demographic charts."
        ),
        "fields": [
            "id",
            "email",
            "participantName",
            "beneficiaryName",
            "sector",
            "province",
            "programId",
            "programName",
            "branchId",
            "branchName",
            "gender",
            "beeLevel",
            "youthOwnedPercent",
            "blackOwnedPercent",
            "femaleOwnedPercent",
        ],
    },
    "assignedInterventions": {
        "purpose": "Stores assigned interventions and progress.",
        "fields": [
            "id",
            "participantId",
            "programId",
            "interventionId",
            "assigneeId",
            "allocationType",
            "groupId",
            "snapshot.beneficiaryName",
            "snapshot.interventionTitle",
            "snapshot.departmentName",
            "assigneeStatus",
            "beneficiaryStatus",
            "completionStatus",
            "progress.percentage",
            "assignedAt",
            "dueDate",
            "completedAt",
        ],
    },
    "diagnosticPlans": {
        "purpose": "Stores confirmed growth plans and planned interventions.",
        "fields": [
            "id",
            "participantId",
            "programId",
            "status",
            "interventions",
            "departmentConfirmations",
            "beneficiaryConfirmations",
            "progressSummary",
        ],
    },
    "complianceDocuments": {
        "purpose": (
            "Stores compliance document status. Lives at "
            "applications/{applicationId}/complianceDocuments (a subcollection), "
            "not a top-level collection — the AI tools join in participantId/"
            "programId from the parent application. departmentId is present but "
            "reflects the uploader's own department, not an authoritative "
            "requirement mapping, so department-level accuracy is approximate."
        ),
        "fields": [
            "id",
            "participantId",
            "programId",
            "applicationId",
            "documentName",
            "slug",
            "status",
            "issueDate",
            "expiryDate",
            "departmentId",
            "departmentName",
        ],
    },
    "monthlyPerformance": {
        "purpose": (
            "Stores a participant's monthly performance history at "
            "monthlyPerformance/{participantId}/history (a subcollection, one "
            "doc per participant, keyed directly by participantId — no join "
            "needed)."
        ),
        "fields": [
            "id",
            "month",
            "revenue",
            "headPermanent",
            "headTemporary",
            "createdAt",
            "updatedAt",
        ],
    },
    "timesheets": {
        "purpose": "Stores one clock-in/out entry per staff user per day.",
        "fields": [
            "id",
            "userId",
            "staffName",
            "date",
            "hoursWorked",
            "status",
        ],
    },
}
