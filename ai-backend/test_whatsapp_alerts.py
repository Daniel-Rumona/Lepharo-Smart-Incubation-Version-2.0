import unittest

from lph_gateway import GatewayError
from test_whatsapp_staff import HOD, SME, FakeGateway, ScriptedStaffReasoner, StaffWhatsAppTests
from whatsapp_staff import StaffDecision


class AlertConsentTests(StaffWhatsAppTests):
    def test_stop_turns_alerts_off(self):
        for text in ("STOP", "stop", "Unsubscribe", "opt out", "stop alerts!"):
            gw = FakeGateway(SME)
            response = self.send(text, gw)
            self.assertIn(("set_alert_consent", {"granted": False}), gw.calls, text)
            self.assertIn("won't get Lepharo updates", response.reply)

    def test_start_turns_alerts_on_for_staff_too(self):
        gw = FakeGateway(HOD)
        response = self.send("START", gw)
        self.assertIn(("set_alert_consent", {"granted": True}), gw.calls)
        self.assertIn("You'll get Lepharo updates", response.reply)

    def test_words_inside_a_sentence_are_not_commands(self):
        gw = FakeGateway(HOD)
        staff = ScriptedStaffReasoner(StaffDecision(responseMode="reply", reply="At 10:00."))
        self.assertEqual(self.send("when does the session start?", gw, staff=staff).reply, "At 10:00.")
        self.assertNotIn("set_alert_consent", gw.actions())

    def test_a_failed_change_is_reported(self):
        gw = FakeGateway(SME, {"set_alert_consent": GatewayError("down")})
        self.assertIn("couldn't update that", self.send("stop", gw).reply)

    def test_an_unknown_number_is_not_changed(self):
        gw = FakeGateway(None)
        # Unmatched numbers go on to the usual appointment handling, which the test reasoner refuses.
        with self.assertRaisesRegex(AssertionError, "appointment reasoner"):
            self.send("stop", gw)
        self.assertNotIn("set_alert_consent", gw.actions())

    def test_the_alert_button_opens_the_menu(self):
        response = self.send("lph:menu", FakeGateway(HOD))
        self.assertEqual(response.conversation.awaiting, "menu")


if __name__ == "__main__":
    unittest.main()
