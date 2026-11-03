import unittest

from tool_scope import MAX_SCOPED_PROGRAMMES, merge_programme_results, scope_tools

PROGRAMME_TOOLS = {"get_movs_by_program", "get_participants_for_program", "get_appointments_by_program"}
WHOLE_SYSTEM = {"get_movs", "get_participants", "get_departments", "get_clock_events"}
OWN = {"get_participant_by_email"}


class ScopeToolsTests(unittest.TestCase):
    def test_a_selected_programme_swaps_whole_system_tools_for_their_twins(self):
        tools, scope, note = scope_tools(OWN | WHOLE_SYSTEM | PROGRAMME_TOOLS, programme="p1", own_programmes=None, programme_tools=PROGRAMME_TOOLS)
        self.assertNotIn("get_movs", tools)
        self.assertNotIn("get_participants", tools)
        self.assertIn("get_movs_by_program", tools)
        # Tools with no programme twin are not programme data and stay.
        self.assertIn("get_departments", tools)
        self.assertIn("get_clock_events", tools)
        self.assertEqual((scope, note), (None, None))

    def test_all_programmes_for_admins_uses_whole_system_tools(self):
        tools, scope, _ = scope_tools(OWN | WHOLE_SYSTEM | PROGRAMME_TOOLS, programme=None, own_programmes=None, programme_tools=PROGRAMME_TOOLS)
        self.assertIn("get_movs", tools)
        self.assertFalse(tools & PROGRAMME_TOOLS)
        self.assertIsNone(scope)

    def test_all_programmes_for_scoped_roles_runs_across_their_own(self):
        tools, scope, note = scope_tools(OWN | PROGRAMME_TOOLS, programme=None, own_programmes=["p1", "p2"], programme_tools=PROGRAMME_TOOLS)
        self.assertTrue(PROGRAMME_TOOLS <= tools)
        self.assertFalse(tools & WHOLE_SYSTEM, "scoped roles never get whole-system tools")
        self.assertEqual(scope, ["p1", "p2"])
        self.assertIsNone(note)

    def test_scoped_roles_get_whole_system_tools_only_if_they_had_them(self):
        # A scoped role selecting a programme gets that programme's tools, never a twin it wasn't allowed.
        tools, _, _ = scope_tools(OWN | PROGRAMME_TOOLS, programme="p1", own_programmes=["p1", "p2"], programme_tools=PROGRAMME_TOOLS)
        self.assertFalse(tools & WHOLE_SYSTEM)

    def test_too_many_or_no_programmes(self):
        many = [f"p{i}" for i in range(MAX_SCOPED_PROGRAMMES + 1)]
        tools, scope, note = scope_tools(OWN | PROGRAMME_TOOLS, programme=None, own_programmes=many, programme_tools=PROGRAMME_TOOLS)
        self.assertFalse(tools & PROGRAMME_TOOLS)
        self.assertIsNone(scope)
        self.assertIn("choose one in the programme filter", note)
        tools, scope, note = scope_tools(OWN | PROGRAMME_TOOLS, programme=None, own_programmes=[], programme_tools=PROGRAMME_TOOLS)
        self.assertEqual(tools, OWN)
        self.assertIn("no programmes", note)


class MergeTests(unittest.TestCase):
    def test_records_merge_with_their_programme_and_without_duplicates(self):
        merged = merge_programme_results({
            "p1": {"ok": True, "data": [{"id": "a"}, {"id": "b", "programId": "p1"}], "detailsArePreview": True, "summary": {"total": 2}},
            "p2": {"ok": True, "data": [{"id": "b", "programId": "p1"}, {"id": "c"}], "summary": {"total": 1}},
        })
        self.assertEqual([r["id"] for r in merged["data"]], ["a", "b", "c"])
        self.assertEqual(merged["data"][2]["programId"], "p2")
        self.assertEqual(merged["detailRecordsReturned"], 3)
        self.assertTrue(merged["detailsArePreview"])
        self.assertEqual(merged["summaryByProgramme"], {"p1": {"total": 2}, "p2": {"total": 1}})
        self.assertEqual(merged["programmes"], ["p1", "p2"])

    def test_one_programme_failing_keeps_the_others(self):
        merged = merge_programme_results({"p1": {"ok": False, "error": "denied"}, "p2": {"ok": True, "data": [{"id": "x"}]}})
        self.assertTrue(merged["ok"])
        self.assertEqual(len(merged["data"]), 1)

    def test_all_failing_reports_the_error(self):
        merged = merge_programme_results({"p1": {"ok": False, "error": "denied"}, "p2": {"ok": False, "error": "denied"}})
        self.assertEqual(merged, {"ok": False, "error": "denied"})

    def test_cut_short_lists_add_up(self):
        merged = merge_programme_results({
            "p1": {"ok": True, "data": [{"id": "a"}], "listIsCutShort": True, "totalRecords": 140},
            "p2": {"ok": True, "data": [{"id": "b"}], "detailRecordsReturned": 1},
        })
        self.assertTrue(merged["listIsCutShort"])
        self.assertEqual(merged["totalRecords"], 141)

    def test_non_list_results_stay_per_programme(self):
        merged = merge_programme_results({"p1": {"ok": True, "data": {"months": 3}}, "p2": {"ok": True, "data": {"months": 5}}})
        self.assertEqual(merged["dataByProgramme"], {"p1": {"months": 3}, "p2": {"months": 5}})


if __name__ == "__main__":
    unittest.main()
