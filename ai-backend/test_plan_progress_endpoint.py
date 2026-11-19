"""Exercise the actual endpoint with storage, authentication and AI mocked.

AST loading avoids booting unrelated services or requiring production credentials.
"""
import ast
import base64
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from plan_progress import COLLECTIONS, MAX_RECORDS, storage_location, can_review, build_snapshot, review_prompt, normalize_review


class HttpError(Exception):
    def __init__(self, status_code, detail):
        self.status_code, self.detail = status_code, detail


class PlanProgressEndpointTests(unittest.TestCase):
    def setUp(self):
        self.plan = {"docType": "implementation_plan", "programId": "p1", "departmentId": "d1", "departmentName": "QMS", "title": "Plan",
                     "attachment": {"name": "plan.docx", "url": "https://firebasestorage.googleapis.com/v0/b/project.appspot.com/o/implementation-plans%2Fplan.docx"}}
        self.user = SimpleNamespace(uid="u", email="u@example.test", role="projectadmin", departmentId=None, isMainDepartment=False)
        self.allowed = ["p1"]
        self.fail_records = False
        self.replace_during_review = False
        self.ai_calls = 0
        self.gets = 0
        self.scopes = []
        owner = self

        class Collection:
            def __init__(self, name): self.name = name
            def document(self, id):
                class Ref:
                    def get(_):
                        owner.gets += 1
                        plan = dict(owner.plan)
                        if owner.replace_during_review and owner.gets > 1:
                            plan["attachment"] = {"url": "new"}
                        return SimpleNamespace(id=id, exists=True, to_dict=lambda: plan)
                return Ref()
            def where(self, field, op, value):
                owner.scopes.append((self.name, field, op, value))
                return self
            def limit(self, value): return self
            def stream(self, **kwargs):
                if owner.fail_records: raise RuntimeError("offline")
                return []

        def ai(*args):
            self.ai_calls += 1
            return {"summary": "No evidence", "milestones": [{"title": "Train", "planBasis": "Train 15 SMMEs", "status": "insufficient_evidence"}]}

        self.ns = dict(Request=object, PlanProgressRequest=object, HTTPException=HttpError, db=SimpleNamespace(project="project", collection=Collection),
                       _verified_user=lambda *args: self.user, _normalise_role=lambda v: v,
                       _allowed_program_ids=lambda *args: self.allowed, _hod_department_ids=lambda *args: ["d1"],
                       get_department_role=lambda *args: "monitoring", get_department_roles=lambda: [], get_departments=lambda *args: [],
                       OVERSIGHT_DEPARTMENT_ROLES=("rom", "monitoring"), can_review_plan_progress=can_review,
                       plan_storage_location=storage_location, MAX_SURVEY_FILE_BYTES=10*1024*1024,
                       _read_course_document=lambda *args: (None, "Train 15 SMMEs", 15),
                       _doc_data=lambda d: d.to_dict(), PLAN_PROGRESS_COLLECTIONS=COLLECTIONS, PLAN_PROGRESS_MAX_RECORDS=MAX_RECORDS,
                       datetime=datetime, timezone=timezone, SAST=timezone.utc, base64=base64,
                       build_plan_progress_snapshot=build_snapshot, plan_progress_prompt=review_prompt,
                       normalize_plan_progress=normalize_review, _gemini_json=ai,
                       os=SimpleNamespace(getenv=lambda _: "fake-test-key"))
        tree = ast.parse(Path(__file__).with_name("app.py").read_text(encoding="utf-8"))
        function = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "check_plan_progress")
        function.decorator_list = []
        exec(compile(ast.Module(body=[function], type_ignores=[]), "app.py", "exec"), self.ns)
        blob = SimpleNamespace(size=15, content_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document", generation=1,
                               reload=lambda **kwargs: None, download_as_bytes=lambda **kwargs: b"test-plan")
        self.storage = SimpleNamespace(storage=SimpleNamespace(bucket=lambda _: SimpleNamespace(blob=lambda _: blob)))

    def call(self):
        with patch.dict("sys.modules", {"firebase_admin": self.storage}):
            return self.ns["check_plan_progress"](SimpleNamespace(documentId="doc1"), object())

    def test_live_queries_are_scoped_and_result_identifies_plan(self):
        result = self.call()
        self.assertEqual(result["documentId"], "doc1")
        self.assertEqual(result["overall"], "insufficient_evidence")
        self.assertEqual(len(self.scopes), len(COLLECTIONS))
        self.assertTrue(all(scope[1:] == ("programId", "==", "p1") for scope in self.scopes))

    def test_other_programme_is_rejected_before_storage_or_ai(self):
        self.allowed = ["other"]
        with self.assertRaises(HttpError) as raised: self.call()
        self.assertEqual(raised.exception.status_code, 403)
        self.assertEqual(self.ai_calls, 0)

    def test_internal_document_rejected(self):
        self.plan["docType"] = "internal_operations"
        with self.assertRaises(HttpError) as raised: self.call()
        self.assertEqual(raised.exception.status_code, 400)

    def test_live_data_failure_does_not_create_ai_assessment(self):
        self.fail_records = True
        with self.assertRaises(HttpError) as raised: self.call()
        self.assertEqual(raised.exception.status_code, 503)
        self.assertEqual(self.ai_calls, 0)

    def test_replaced_document_cannot_return_stale_result(self):
        self.replace_during_review = True
        with self.assertRaises(HttpError) as raised: self.call()
        self.assertEqual(raised.exception.status_code, 409)


if __name__ == "__main__":
    unittest.main()
