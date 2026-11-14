import sys
import types
import unittest
from types import SimpleNamespace
from unittest.mock import patch


def _stub_firestore_tools() -> types.ModuleType:
    """tools_dispatcher imports many Firestore helpers; these tests swap in their own tools."""
    module = types.ModuleType("firestore_tools")
    module.__getattr__ = lambda name: (lambda *args, **kwargs: [])  # type: ignore[attr-defined]
    return module


def _import_dispatcher():
    """The real dispatcher when Firebase is available; otherwise one built on the stub. The stub is
    only in sys.modules while importing, so other test files' own firestore_tools stubs still work."""
    try:
        import firestore_tools  # noqa: F401
        import tools_dispatcher
        return tools_dispatcher
    except Exception:
        pass
    with patch.dict(sys.modules, {"firestore_tools": _stub_firestore_tools()}):
        sys.modules.pop("tools_dispatcher", None)
        import tools_dispatcher
        return tools_dispatcher


tools_dispatcher = _import_dispatcher()

USER = SimpleNamespace(email="pa@example.com", uid="u1", role="projectadmin", participantId=None, consultantId=None, departmentId=None, branchId=None)


def run(tools, **context):
    return tools_dispatcher.run_page_tools(
        page_context={"tools": tools, "frontend": context.pop("frontend", {}), **context},
        user=USER,
        base_data={},
    )


class ProgrammeScopeTests(unittest.TestCase):
    def test_all_my_programmes_runs_each_programme_and_merges(self):
        calls = []

        def movs(program_id):
            calls.append(program_id)
            return [{"id": f"{program_id}-mov"}]

        with patch.dict(tools_dispatcher.TOOL_MAP, {"get_movs_by_program": movs}):
            result = run(["get_movs_by_program"], programScope=["p1", "p2"])["get_movs_by_program"]
        self.assertEqual(calls, ["p1", "p2"])
        self.assertTrue(result["ok"])
        self.assertEqual(result["programmes"], ["p1", "p2"])
        self.assertEqual([(r["id"], r["programId"]) for r in result["data"]], [("p1-mov", "p1"), ("p2-mov", "p2")])

    def test_a_selected_programme_runs_only_that_programme(self):
        calls = []
        with patch.dict(tools_dispatcher.TOOL_MAP, {"get_movs_by_program": lambda pid: calls.append(pid) or []}):
            run(["get_movs_by_program"], frontend={"activeProgramId": "p9"}, programScope=["p1", "p2"])
        self.assertEqual(calls, ["p9"])

    def test_no_programme_and_no_scope_is_reported_not_guessed(self):
        result = run(["get_movs_by_program"])["get_movs_by_program"]
        self.assertFalse(result["ok"])


class CutShortTests(unittest.TestCase):
    def test_a_list_at_its_limit_says_how_many_there_really_are(self):
        full = [{"id": str(i)} for i in range(tools_dispatcher.LIST_PREVIEW_LIMIT)]
        with patch.dict(tools_dispatcher.TOOL_MAP, {"get_movs": lambda: full}), \
                patch.object(tools_dispatcher, "count_collection", return_value=342) as count:
            result = run(["get_movs"])["get_movs"]
        count.assert_called_once_with("movDocuments", [])
        self.assertTrue(result["listIsCutShort"])
        self.assertEqual((result["detailRecordsReturned"], result["totalRecords"]), (100, 342))

    def test_short_lists_are_not_counted(self):
        with patch.dict(tools_dispatcher.TOOL_MAP, {"get_movs": lambda: [{"id": "a"}]}), \
                patch.object(tools_dispatcher, "count_collection") as count:
            result = run(["get_movs"])["get_movs"]
        count.assert_not_called()
        self.assertNotIn("listIsCutShort", result)

    def test_filtered_lists_count_with_the_same_filter(self):
        full = [{"id": str(i)} for i in range(tools_dispatcher.LIST_PREVIEW_LIMIT)]
        with patch.dict(tools_dispatcher.TOOL_MAP, {"get_movs_by_program": lambda pid: full}), \
                patch.object(tools_dispatcher, "count_collection", return_value=100) as count:
            result = run(["get_movs_by_program"], frontend={"activeProgramId": "p1"})["get_movs_by_program"]
        count.assert_called_once_with("movDocuments", [("programId", "==", "p1")])
        self.assertNotIn("listIsCutShort", result, "exactly the limit and nothing more is not cut short")


if __name__ == "__main__":
    unittest.main()
