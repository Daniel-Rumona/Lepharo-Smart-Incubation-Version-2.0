import unittest

from lph_gateway import GatewayError
from test_whatsapp_staff import HOD, FakeGateway, StaffWhatsAppTests

EMPLOYEE = {**HOD, "role": "consultant", "roleGroup": "employee"}


class CoverageGateway(FakeGateway):
    """Keeps a coverage draft and reports the next step like the gateway's whatsappCoverage.ts."""

    def __init__(self, smes=("Acme Traders",), submit=None, start_error=None):
        super().__init__(EMPLOYEE)
        self.smes = [{"appointmentId": f"a{i}", "participantName": name} for i, name in enumerate(smes, start=1)]
        self.draft = None
        self.submit = submit or {"saved": True, "title": "Business plan review", "held": True, "attended": 1, "invited": 1, "progress": 50}
        self.start_error = start_error

    def view(self):
        d = self.draft
        attendance = [{**row, "outcome": d["attendance"].get(row["appointmentId"])} for row in self.smes]
        if d["held"] is None:
            step = {"step": "held"}
        elif d["held"] is False:
            step = {"step": "not_held_reason"} if not d["notHeldReason"] else {"step": "confirm"}
        else:
            missing = next((row for row in attendance if not row["outcome"]), None)
            step = ({"step": "attendance", "appointmentId": missing["appointmentId"], "participantName": missing["participantName"],
                     "group": len(self.smes) > 1} if missing else {"step": "summary"} if not d["summary"] else {"step": "confirm"})
        return {"draft": {"sessionId": "s1", "title": "Business plan review", "when": "2026-10-29 10:00", "held": d["held"],
                          "notHeldReason": d["notHeldReason"], "reasonNotHeld": d["reasonNotHeld"], "summary": d["summary"],
                          "attendance": attendance, **step}}

    def call(self, action, phone, **fields):
        if not action.startswith("coverage_"):
            return super().call(action, phone, **fields)
        self.calls.append((action, fields))
        if action == "coverage_pending":
            return {"ok": True, "sessions": [{"sessionId": "s1", "title": "Business plan review", "when": "2026-10-29 10:00",
                                              "smes": [row["participantName"] for row in self.smes], "webOnly": False}], "total": 1}
        if action == "coverage_start":
            if self.start_error:
                raise GatewayError(f"Lepharo gateway request failed ({self.start_error}).")
            self.draft = {"held": None, "notHeldReason": None, "reasonNotHeld": None, "attendance": {}, "summary": None}
            return {"ok": True, **self.view()}
        if action == "coverage_update":
            if "held" in fields:
                self.draft["held"] = fields["held"]
            if "notHeldReason" in fields:
                self.draft["notHeldReason"] = fields["notHeldReason"]
            if "reasonNotHeld" in fields:
                self.draft["reasonNotHeld"] = fields["reasonNotHeld"]
            if fields.get("allAttended"):
                self.draft["attendance"] = {row["appointmentId"]: "attended" for row in self.smes}
            self.draft["attendance"].update(fields.get("attendance") or {})
            if "summary" in fields:
                if len(fields["summary"].split()) < 5:
                    raise GatewayError("Lepharo gateway request failed (summary_too_short).")
                self.draft["summary"] = fields["summary"]
            return {"ok": True, **self.view()}
        if action == "coverage_submit":
            if isinstance(self.submit, Exception):
                raise self.submit
            return {"ok": True, **self.submit}
        return {"ok": True}


class CoverageConversationTests(StaffWhatsAppTests):
    def test_facilitators_get_record_a_session_in_the_menu(self):
        self.assertIn("Record a session", self.send("hi", FakeGateway(EMPLOYEE)).reply)
        self.assertIn("Record a session", self.send("hi", FakeGateway(HOD)).reply)

    def test_the_menu_lists_sessions_waiting_for_coverage(self):
        response = self.send("lph:menu:top:3", CoverageGateway())
        self.assertEqual(response.interactive.sections[0].rows[0].id, "lph:cov:s1")
        self.assertIn("Business plan review", response.reply)

    def test_a_held_session_with_one_sme(self):
        gw = CoverageGateway()
        response = self.send("lph:cov:s1", gw)
        self.assertIn("Was the session held?", response.reply)
        self.assertEqual([b.id for b in response.interactive.buttons], ["lph:covheld:s1:yes", "lph:covheld:s1:no"])
        response = self.send("lph:covheld:s1:yes", gw)
        self.assertIn("Did *Acme Traders* attend?", response.reply)
        response = self.send("lph:covatt:s1:a1:attended", gw)
        self.assertEqual(response.conversation.awaiting, "cov:s1:summary")
        response = self.send("too short", gw, awaiting="cov:s1:summary")
        self.assertIn("at least 5 words", response.reply)
        response = self.send("Reviewed the cash flow forecast and pricing model", gw, awaiting="cov:s1:summary")
        self.assertIn("Attended: Acme Traders", response.reply)
        self.assertEqual([b.id for b in response.interactive.buttons], ["lph:covok:s1", "lph:covno:s1"])
        response = self.send("lph:covok:s1", gw)
        self.assertIn("Coverage saved", response.reply)
        self.assertIn("Progress is now 50%", response.reply)

    def test_the_last_planned_session_points_to_completion_on_the_web(self):
        gw = CoverageGateway(submit={"saved": True, "title": "T", "held": True, "attended": 1, "invited": 1, "progress": 100, "completionRequired": True})
        self.send("lph:cov:s1", gw)
        self.assertIn("complete the intervention with the signed MOV", self.send("lph:covok:s1", gw).reply)

    def test_a_session_that_was_not_held(self):
        gw = CoverageGateway()
        self.send("lph:cov:s1", gw)
        response = self.send("no", gw, awaiting="cov:s1:held")
        self.assertIn("Why wasn't it held?", response.reply)
        response = self.send("lph:covwhy:s1:no-show", gw)
        self.assertEqual(response.conversation.awaiting, "cov:s1:note")
        response = self.send("They had a family emergency", gw, awaiting="cov:s1:note")
        self.assertIn("Not held - sme didn't come: They had a family emergency", response.reply)
        self.assertIn(("coverage_update", {"sessionId": "s1", "reasonNotHeld": "They had a family emergency"}), gw.calls)
        saved = CoverageGateway(submit={"saved": True, "title": "T", "held": False})
        saved.draft = gw.draft
        self.assertIn("was not held", self.send("yes", saved, awaiting="cov:s1:confirm").reply)

    def test_skipping_the_note(self):
        gw = CoverageGateway()
        self.send("lph:cov:s1", gw)
        self.send("lph:covheld:s1:no", gw)
        self.send("2", gw, awaiting="cov:s1:reason")
        self.assertIn("Shall I save", self.send("skip", gw, awaiting="cov:s1:note").reply)

    def test_a_group_where_everyone_attended(self):
        gw = CoverageGateway(smes=("Acme", "Beta", "Gamma"))
        self.send("lph:cov:s1", gw)
        response = self.send("lph:covheld:s1:yes", gw)
        self.assertIn("Did everyone attend?", response.reply)
        response = self.send("lph:covall:s1", gw)
        self.assertEqual(response.conversation.awaiting, "cov:s1:summary")

    def test_a_group_marked_one_by_one(self):
        gw = CoverageGateway(smes=("Acme", "Beta"))
        self.send("lph:cov:s1", gw)
        self.send("lph:covheld:s1:yes", gw)
        self.assertIn("Did *Acme* attend?", self.send("lph:coveach:s1", gw).reply)
        self.assertIn("Did *Beta* attend?", self.send("yes", gw, awaiting="cov:s1:att:a1").reply)
        self.send("no", gw, awaiting="cov:s1:att:a2")
        response = self.send("Covered marketing basics and next steps together", gw, awaiting="cov:s1:summary")
        self.assertIn("Attended: Acme. Didn't attend: Beta", response.reply)

    def test_discard(self):
        gw = CoverageGateway()
        self.send("lph:cov:s1", gw)
        self.assertIn("nothing was saved", self.send("lph:covno:s1", gw).reply)
        self.assertIn("coverage_cancel", gw.actions())

    def test_training_sessions_go_to_the_web(self):
        self.assertIn("formal topics", self.send("lph:cov:s1", CoverageGateway(start_error="training_coverage_on_web")).reply)

    def test_an_unlinked_assignment_is_not_guessed(self):
        gw = CoverageGateway(submit=GatewayError("Lepharo gateway request failed (assignment_not_linked)."))
        self.send("lph:cov:s1", gw)
        self.assertIn("haven't guessed", self.send("lph:covok:s1", gw).reply)

    def test_an_unclear_answer_asks_again(self):
        gw = CoverageGateway()
        self.send("lph:cov:s1", gw)
        response = self.send("maybe", gw, awaiting="cov:s1:held")
        self.assertEqual(response.conversation.awaiting, "cov:s1:held")


if __name__ == "__main__":
    unittest.main()
