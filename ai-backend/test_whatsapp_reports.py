import unittest

from lph_gateway import GatewayError
from test_whatsapp_staff import HOD, FakeGateway, StaffWhatsAppTests

CENTRE_COORDINATOR = {**HOD, "role": "projectadmin", "roleGroup": "coordinator", "reportAccess": True}
REPORTS = [
    {"id": "executive", "title": "Executive Report", "description": "Monthly executive & operations report for your centre"},
    {"id": "national", "title": "National Report", "description": "Interventions progress for your centre"},
]
MONTHS = [{"month": "2026-10", "label": "October 2026"}, {"month": "2026-09", "label": "September 2026"}]


def gateway(reports=REPORTS, request=None, identity=CENTRE_COORDINATOR):
    return FakeGateway(identity, {
        "report_options": {"reports": reports, "months": MONTHS},
        "request_report": request if request is not None else {"queued": True, "title": "National Report", "monthLabel": "October 2026"},
    })


class ReportConversationTests(StaffWhatsAppTests):
    def test_reports_menu_only_with_report_access(self):
        self.assertIn("Reports", self.send("hi", FakeGateway(CENTRE_COORDINATOR)).reply)
        self.assertNotIn("Reports", self.send("hi", FakeGateway({**CENTRE_COORDINATOR, "reportAccess": False})).reply)

    def test_choosing_reports_offers_each_report(self):
        response = self.send("lph:menu:top:4", gateway())  # Appointments, Find an SME, Record a session, Reports
        self.assertEqual([b.id for b in response.interactive.buttons], ["lph:rpt:executive", "lph:rpt:national"])

    def test_a_single_report_goes_straight_to_the_month(self):
        response = self.send("lph:menu:top:4", gateway(reports=REPORTS[:1]))
        self.assertIn("*Executive Report* - which month?", response.reply)

    def test_picking_a_report_then_a_month_queues_it(self):
        gw = gateway()
        response = self.send("lph:rpt:national", gw)
        self.assertEqual([b.id for b in response.interactive.buttons], ["lph:rptm:national:2026-10", "lph:rptm:national:2026-09"])
        response = self.send("lph:rptm:national:2026-10", gw)
        self.assertIn(("request_report", {"reportId": "national", "month": "2026-10"}), gw.calls)
        self.assertIn("Preparing your *National Report* for October 2026", response.reply)

    def test_typed_answers(self):
        gw = gateway()
        self.assertIn("which month", self.send("2", gw, awaiting="report:pick").reply)
        self.send("2", gw, awaiting="report:national")
        self.assertIn(("request_report", {"reportId": "national", "month": "2026-09"}), gw.calls)
        self.assertIn("reply 1", self.send("whenever", gateway(), awaiting="report:national").reply)

    def test_a_double_tap_is_not_built_twice(self):
        gw = gateway(request={"queued": True, "duplicate": True, "title": "National Report", "monthLabel": "October 2026"})
        self.assertIn("already preparing", self.send("lph:rptm:national:2026-10", gw).reply)

    def test_not_permitted(self):
        gw = gateway(request=GatewayError("Lepharo gateway request failed (report_not_permitted)."))
        self.assertIn("isn't available for your role", self.send("lph:rptm:national:2026-10", gw).reply)


if __name__ == "__main__":
    unittest.main()
