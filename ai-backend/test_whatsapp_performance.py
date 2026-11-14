import unittest

from test_whatsapp_staff import ADMIN, FakeGateway, StaffWhatsAppTests
from whatsapp_staff import _read_allowed, format_performance

DIRECTOR = {**ADMIN, "role": "director", "roleGroup": "director"}
CYCLE = {
    "cycle": "FY2026/27", "phase": "midYear", "phaseOpen": True, "phaseClosesOn": "2026-11-30", "staff": 12,
    "noLineManager": 1, "compacts": {"agreed": 9, "awaitingSignature": 2, "notStarted": 1},
    "reviews": {"phase": "midYear", "notStarted": 4, "inProgress": 5, "awaitingCalibration": 1, "awaitingValidation": 2, "disputed": 0, "validated": 0},
    "overdue": 3,
    "waitingOnYou": [{"text": "2 mid-year reviews calibrated and awaiting your validation (FY2026/27)", "overdue": False},
                     {"text": "Complete Thandi's mid-year review assessment", "overdue": True}],
}


class PerformanceTests(StaffWhatsAppTests):
    def test_directors_get_performance_and_not_feature_governance(self):
        reply = self.send("hi", FakeGateway(DIRECTOR)).reply
        self.assertIn("1. *Performance*", reply)
        self.assertNotIn("Feature governance", reply)
        self.assertIn("Feature governance", self.send("hi", FakeGateway(ADMIN)).reply, "system admins keep it")

    def test_feature_governance_is_not_a_tool_for_directors(self):
        self.assertFalse(_read_allowed("governance_summary", DIRECTOR))
        self.assertTrue(_read_allowed("governance_summary", ADMIN))

    def test_the_option_shows_the_cycle_and_what_waits_on_the_director(self):
        gateway = FakeGateway(DIRECTOR, {"performance_summary": {"cycles": [CYCLE]}})
        reply = self.send("lph:menu:top:1", gateway).reply
        self.assertIn("performance_summary", gateway.actions())
        self.assertIn("*Performance - FY2026/27*\nMid-year reviews (closes 30 Nov)\n12 staff in the cycle", reply)
        self.assertIn("Compacts: 9 agreed, 2 awaiting a signature, 1 not started", reply)
        self.assertIn("Mid-year reviews: 2 awaiting your validation, 1 with HR to calibrate, 5 in progress, 4 not started", reply)
        self.assertIn("*Waiting on you*\n- 2 mid-year reviews calibrated", reply)
        self.assertIn("- Overdue: Complete Thandi's", reply)

    def test_no_cycle_running(self):
        self.assertIn("No performance cycle is running", format_performance({"cycles": []}))

    def test_nothing_waiting(self):
        self.assertIn("Nothing is waiting on you", format_performance({"cycles": [{**CYCLE, "waitingOnYou": [], "reviews": None}]}))


if __name__ == "__main__":
    unittest.main()
