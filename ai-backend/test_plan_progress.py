import unittest
from datetime import datetime, timezone

from plan_progress import build_snapshot, can_review, normalize_review, storage_location, MAX_RECORDS


class PlanProgressTests(unittest.TestCase):
    today = "2026-11-16"

    def snapshot(self, **collections):
        return build_snapshot(collections, "p1", "d1", "QMS", self.today)

    def assignment(self, id="a", **values):
        return {"id": id, "programId": "p1", "departmentId": "d1", "participantId": "s1", **values}

    def milestone(self, **values):
        return {"title": "Training", "planBasis": "Train 15 SMMEs", "status": "complete", "evidenceRefs": ["assignedInterventions/a"], **values}

    def test_scope_excludes_other_programme_department_and_demo(self):
        facts = self.snapshot(assignedInterventions=[self.assignment(), self.assignment("b", programId="p2"), self.assignment("c", departmentId="d2"), self.assignment("d", isDemo=True)])
        self.assertEqual(facts["metrics"]["assignments"], 1)
        self.assertEqual(len(facts["records"]), 1)

    def test_repeated_assignments_are_not_unique_businesses_and_cancelled_not_overdue(self):
        facts = self.snapshot(assignedInterventions=[self.assignment(assignmentStatus="completed"), self.assignment("b", assignmentStatus="in-progress", dueDate="2026-11-15"), self.assignment("c", assignmentStatus="cancelled", dueDate="2026-01-01")])
        self.assertEqual(facts["metrics"], {"assignments": 2, "completedAssignments": 1, "overdueAssignments": 1, "uniqueSmmes": 1, "movs": 0, "approvedMovs": 0})

    def test_legacy_mov_matched_by_name_or_assignment_and_conflicting_department_excluded(self):
        facts = self.snapshot(assignedInterventions=[self.assignment()], movDocuments=[
            {"id": "m1", "programId": "p1", "departmentName": "QMS", "status": "approved"},
            {"id": "m2", "programId": "p1", "assignedInterventionId": "a"},
            {"id": "m3", "programId": "p1", "departmentId": "d2", "departmentName": "QMS"},
        ])
        self.assertEqual(facts["metrics"]["movs"], 2)
        self.assertEqual(facts["metrics"]["approvedMovs"], 1)

    def test_datetimes_and_due_today(self):
        facts = self.snapshot(assignedInterventions=[self.assignment(assignmentStatus="assigned", dueDate=datetime(2026, 11, 16, tzinfo=timezone.utc))])
        self.assertEqual(facts["metrics"]["overdueAssignments"], 0)

    def test_planned_only_cannot_prove_completion(self):
        facts = self.snapshot(diagnosticPlans=[{"id": "dp", "programId": "p1", "interventions": [{"departmentId": "d1", "title": "File compilation"}]}])
        result = normalize_review({"milestones": [self.milestone(evidenceRefs=["diagnosticPlans/dp:0"])]}, facts, self.today)
        self.assertEqual(result["overall"], "insufficient_evidence")

    def test_invented_citation_dropped_and_completion_downgraded(self):
        result = normalize_review({"milestones": [self.milestone(evidenceRefs=["assignedInterventions/fake"])]}, self.snapshot(), self.today)
        self.assertEqual(result["milestones"][0]["evidenceRefs"], [])
        self.assertEqual(result["overall"], "insufficient_evidence")

    def test_pending_assignment_cannot_prove_completion(self):
        result = normalize_review({"milestones": [self.milestone()]}, self.snapshot(assignedInterventions=[self.assignment(assignmentStatus="assigned")]), self.today)
        self.assertEqual(result["overall"], "insufficient_evidence")

    def test_future_milestone_and_invalid_dates(self):
        result = normalize_review({"milestones": [self.milestone(status="not_due", dueDate="2026-12-31", dateConfidence="inferred")]}, self.snapshot(), self.today)
        self.assertEqual(result["overall"], "not_due")
        self.assertEqual(result["milestones"][0]["dateConfidence"], "inferred")
        result = normalize_review({"milestones": [self.milestone(status="not_due", dueDate="nonsense")]}, self.snapshot(), self.today)
        self.assertEqual(result["overall"], "insufficient_evidence")

    def test_sampling_is_disclosed_and_cannot_produce_green_overall(self):
        rows = [self.assignment(str(i), assignmentStatus="completed") for i in range(MAX_RECORDS + 1)]
        facts = self.snapshot(assignedInterventions=rows)
        self.assertEqual(len(facts["records"]), 200)
        self.assertTrue(facts["warnings"])
        result = normalize_review({"milestones": [self.milestone(evidenceRefs=["assignedInterventions/0"])]}, facts, self.today)
        self.assertEqual(result["overall"], "insufficient_evidence")

    def test_malformed_ai_output(self):
        with self.assertRaises(ValueError):
            normalize_review({"milestones": {"a": "junk"}}, self.snapshot(), self.today)
        result = normalize_review({"milestones": [self.milestone(evidenceRefs=None)], "limitations": None}, self.snapshot(), self.today)
        self.assertEqual(result["overall"], "insufficient_evidence")

    def test_storage_rejects_external_and_cross_project_links(self):
        prefix = "https://firebasestorage.googleapis.com/v0/b/"
        self.assertEqual(storage_location(prefix + "project.firebasestorage.app/o/implementation-plans%2Fuploads%2Fplan.docx?alt=media", "project"), ("project.firebasestorage.app", "implementation-plans/uploads/plan.docx"))
        for url in ["http://localhost/secret", "https://example.com/plan.pdf", prefix + "other.appspot.com/o/implementation-plans%2Fplan.pdf", prefix + "project.appspot.com/o/users%2Fprivate.pdf"]:
            with self.assertRaises(ValueError):
                storage_location(url, "project")

    def test_permissions(self):
        self.assertTrue(can_review("projectadmin", None, "d1", "p1", ["p1"]))
        self.assertFalse(can_review("projectadmin", None, "d1", "p2", ["p1"]))
        self.assertTrue(can_review("operations", "d1", "d1", "p1", []))
        self.assertFalse(can_review("operations", None, "d1", "p1", []))
        self.assertFalse(can_review("operations", "d2", "d1", "p1", []))
        self.assertTrue(can_review("operations", "monitoring", "d1", "p1", [], oversight=True))
        self.assertFalse(can_review("incubatee", "d1", "d1", "p1", ["p1"]))


if __name__ == "__main__":
    unittest.main()
