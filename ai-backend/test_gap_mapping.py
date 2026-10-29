import ast
import sys
import types
import unittest
from pathlib import Path
from unittest.mock import patch


def _role_helpers_module() -> types.ModuleType:
    """firestore_tools needs firebase_admin; load just its pure department-role helpers."""
    source = (Path(__file__).parent / "firestore_tools.py").read_text(encoding="utf-8")
    wanted = {"DEPARTMENT_ROLE_KEYS", "department_lineage", "get_department_role"}
    tree = ast.parse(source)
    body = [
        node for node in tree.body
        if (isinstance(node, ast.FunctionDef) and node.name in wanted)
        or (isinstance(node, ast.Assign) and any(getattr(t, "id", None) in wanted for t in node.targets))
    ]
    module = types.ModuleType("firestore_tools")
    exec(compile(ast.Module(body=body, type_ignores=[]), "firestore_tools.py", "exec"), module.__dict__)
    module.db = None
    module.get_department_roles = lambda: {}
    return module


if "firestore_tools" not in sys.modules:
    try:
        import firestore_tools  # noqa: F401
    except Exception:
        sys.modules["firestore_tools"] = _role_helpers_module()

import gap_mapping  # noqa: E402


class _Snap:
    def __init__(self, doc_id, data):
        self.id = doc_id
        self._data = data
        self.exists = data is not None

    def to_dict(self):
        return dict(self._data or {})


class _Query:
    def __init__(self, docs):
        self._docs = docs

    def where(self, field, op, value):
        return _Query({k: v for k, v in self._docs.items() if v.get(field) == value})

    def stream(self):
        return [_Snap(k, v) for k, v in self._docs.items()]


class _DocRef:
    def __init__(self, store, doc_id):
        self._store = store
        self._id = doc_id

    def get(self):
        return _Snap(self._id, self._store.get(self._id))

    def set(self, data, merge=False):
        self._store.setdefault(self._id, {}).update(data)


class _Collection(_Query):
    def __init__(self, store):
        super().__init__(store)
        self._store = store

    def document(self, doc_id):
        return _DocRef(self._store, doc_id)


class _Db:
    def __init__(self, data):
        self.data = data

    def collection(self, name):
        return _Collection(self.data.setdefault(name, {}))


DEPARTMENTS = {
    "d-rom": {"name": "Recruitment"},
    "d-legal": {"name": "Legal Desk"},
    "d-legal-sub": {"name": "Contracts", "parentDepartmentId": "d-legal"},
    "d-pds": {"name": "Personal Development"},
    "d-other": {"name": "Unassigned"},
}
ROLES = {"rom": "d-rom", "legal": "d-legal", "pds": "d-pds"}


class AllowedSectionsTests(unittest.TestCase):
    departments = [{"id": k, **v} for k, v in DEPARTMENTS.items()]

    def allowed(self, department_id):
        return gap_mapping.allowed_sections_for_department(department_id, ROLES, self.departments)

    def test_role_department_gets_its_sections(self):
        self.assertEqual(self.allowed("d-legal"), ["legal"])
        self.assertEqual(self.allowed("d-rom"), "ALL")

    def test_sub_department_inherits_parent_role(self):
        self.assertEqual(self.allowed("d-legal-sub"), ["legal"])

    def test_department_without_role_gets_nothing(self):
        self.assertEqual(self.allowed("d-other"), [])
        self.assertEqual(self.allowed(None), [])

    def test_every_section_owner_is_a_known_role(self):
        keys = set(gap_mapping.GAP_DEPT_SECTIONS)
        self.assertTrue(set(gap_mapping.GAP_SECTION_OWNER.values()) <= keys)


class BuildGapMappingTests(unittest.TestCase):
    def setUp(self):
        self.db = _Db({
            "departments": {k: dict(v) for k, v in DEPARTMENTS.items()},
            "interventions": {
                "iv-1": {"title": "Contract review", "departmentId": "d-legal"},
                "iv-2": {"title": "Coaching", "departmentId": "d-pds"},
            },
            "gapAnalysis": {
                "gap-1": {"sections": {"legal": {"q": [{"answer": "No"}]}}},
            },
        })
        self.patches = [
            patch.object(gap_mapping, "db", self.db),
            patch.object(gap_mapping, "get_department_roles", lambda: dict(ROLES)),
        ]
        for p in self.patches:
            p.start()

    def tearDown(self):
        for p in self.patches:
            p.stop()

    def request(self, section="legal"):
        return gap_mapping.GapMappingRequest(
            gapId="gap-1",
            sections=[gap_mapping.GapMappingSectionInput(section=section, questions=["Do you have contracts?"])],
        )

    def test_rom_maps_against_owner_department_by_id(self):
        with patch.object(gap_mapping, "_edges_from_ai", lambda *a: [
            {"questionIndex": 0, "interventionId": "iv-1", "confidence": 80, "rationale": "fits"}
        ]):
            result = gap_mapping.build_gap_mapping(
                self.request(), department_id="d-rom", actor="tester", genai_client_factory=None
            )
        section = result.sections[0]
        self.assertEqual(section.departmentId, "d-legal")
        self.assertEqual(section.departmentName, "Legal Desk")
        self.assertEqual([iv.id for iv in section.interventions], ["iv-1"])
        self.assertEqual(section.interventions[0].departmentId, "d-legal")
        stored = self.db.data["gapAnalysis"]["gap-1"]["interventionMapping"]["legal"]
        self.assertEqual(stored["departmentId"], "d-legal")

    def test_rename_does_not_change_access(self):
        self.db.data["departments"]["d-legal"]["name"] = "Legal Advisory (renamed)"
        with patch.object(gap_mapping, "_edges_from_ai", lambda *a: []):
            result = gap_mapping.build_gap_mapping(
                self.request(), department_id="d-legal", actor="tester", genai_client_factory=None
            )
        self.assertEqual(result.sections[0].departmentName, "Legal Advisory (renamed)")

    def test_department_without_section_is_refused(self):
        with self.assertRaises(gap_mapping.GapMappingError) as caught:
            gap_mapping.build_gap_mapping(
                self.request(), department_id="d-other", actor="tester", genai_client_factory=None
            )
        self.assertEqual(caught.exception.status_code, 403)


if __name__ == "__main__":
    unittest.main()
