import unittest

from lph_gateway import GatewayError
from test_whatsapp_staff import ADMIN, HOD, FakeGateway, ScriptedStaffReasoner, StaffWhatsAppTests
from whatsapp_staff import StaffDecision

COORDINATOR = {**HOD, "role": "coordinator", "roleGroup": "coordinator"}
MOVS = [
    {"movId": "m1", "sme": "Kudu Glass", "intervention": "Contract Management", "facilitator": "Lerato M", "evidence": True,
     "evidenceWarning": None, "evidenceSummary": None},
    {"movId": "m2", "sme": "Lowveld Bricks", "intervention": "IP Advisory", "facilitator": "Sipho K", "evidence": False,
     "evidenceWarning": "weak", "evidenceSummary": "The register is unsigned."},
]


def detail(mov, own=0, others=0, can_query=True):
    return {"mov": mov, "ownOpenQueries": own, "otherOpenQueries": others, "canQuery": can_query}


class MovGateway(FakeGateway):
    def __init__(self, identity=HOD, **responses):
        super().__init__(identity, {
            "mov_review_pending": {"movs": MOVS, "total": 2, "programme": None},
            "mov_review_detail": detail(MOVS[0]),
            "mov_review_approve": {"approved": True, "sme": "Kudu Glass", "intervention": "Contract Management", "evidence": True, "resolvedQueries": 1},
            "mov_review_query_draft": {"draft": {"movId": "m1", "sme": "Kudu Glass", "intervention": "Contract Management",
                                                 "facilitator": "Lerato M", "typeLabel": "Evidence (POE)", "message": "The register is unsigned, please re-upload."}},
            "mov_review_query_send": {"queried": True, "sme": "Kudu Glass", "intervention": "Contract Management", "facilitator": "Lerato M"},
            "mov_review_cancel": {"cancelled": True},
            **responses,
        })

    def writes(self):
        return [name for name in self.actions() if name in {"mov_review_approve", "mov_review_query_send"}]


class MovReviewTests(StaffWhatsAppTests):
    def test_it_is_the_first_option_for_heads_of_department_only(self):
        self.assertIn("1. *MOVs to approve*", self.send("hi", FakeGateway(HOD)).reply)
        for identity in (COORDINATOR, ADMIN):
            self.assertNotIn("MOVs to approve", self.send("hi", FakeGateway(identity)).reply)

    def test_the_list_flags_evidence_problems(self):
        response = self.send("lph:menu:top:1", MovGateway())
        self.assertIn("1. *Kudu Glass* - Contract Management\n2. *Lowveld Bricks* - IP Advisory ⚠️", response.reply)
        self.assertEqual([row.id for row in response.interactive.sections[0].rows], ["lph:movr:m1", "lph:movr:m2"])
        self.assertEqual(response.conversation.awaiting, "movr:pick")

    def test_nothing_waiting(self):
        reply = self.send("lph:menu:top:1", MovGateway(mov_review_pending={"movs": [], "total": 0, "programme": "SEDFA"})).reply
        self.assertIn("Nothing is waiting for your approval on *SEDFA*", reply)

    def test_a_number_opens_that_mov(self):
        gateway = MovGateway(mov_review_detail=detail(MOVS[1], others=1))
        response = self.send("2", gateway, awaiting="movr:pick")
        self.assertIn(("mov_review_detail", {"movId": "m2"}), gateway.calls)
        self.assertIn("No evidence attached", response.reply)
        self.assertIn("found it weak - The register is unsigned.", response.reply)
        self.assertEqual([b.id for b in response.interactive.buttons], ["lph:mova:m2", "lph:movq:m2", "lph:movnext"])

    def test_approving_asks_first_then_approves(self):
        gateway = MovGateway(mov_review_detail=detail(MOVS[0], own=1, others=1))
        response = self.send("lph:mova:m1", gateway)
        self.assertEqual(gateway.writes(), [], "nothing is approved before the yes")
        self.assertIn("Your open query on it will be marked resolved.", response.reply)
        self.assertIn("One query raised by someone else will stay open.", response.reply)
        response = self.send("yes", gateway, awaiting="movr:m1:approve")
        self.assertIn(("mov_review_approve", {"movId": "m1"}), gateway.calls)
        self.assertIn("✅ Approved: the Contract Management MOV for *Kudu Glass*", response.reply)
        self.assertEqual([b.id for b in response.interactive.buttons], ["lph:movnext"])

    def test_no_evidence_is_warned_about_before_approving(self):
        gateway = MovGateway(mov_review_detail=detail(MOVS[1]))
        self.assertIn("can't go into a monthly pack", self.send("approve", gateway, awaiting="movr:m2:detail").reply)

    def test_saying_no_goes_back_without_approving(self):
        gateway = MovGateway()
        self.send("no", gateway, awaiting="movr:m1:approve")
        self.assertEqual(gateway.writes(), [])

    def test_a_query_is_written_checked_then_sent(self):
        gateway = MovGateway()
        response = self.send("lph:movq:m1", gateway)
        self.assertEqual([b.id for b in response.interactive.buttons],
                         ["lph:movqt:m1:poe-request", "lph:movqt:m1:mov-issue", "lph:movqt:m1:general-query"])
        response = self.send("1", gateway, awaiting=response.conversation.awaiting)
        self.assertEqual(response.conversation.awaiting, "movr:m1:msg:poe-request")
        response = self.send("The register is unsigned, please re-upload.", gateway, awaiting=response.conversation.awaiting)
        self.assertIn(("mov_review_query_draft", {"movId": "m1", "type": "poe-request", "message": "The register is unsigned, please re-upload."}), gateway.calls)
        self.assertIn("Send this query to Lerato M", response.reply)
        self.assertEqual(gateway.writes(), [], "nothing is sent before the yes")
        response = self.send("lph:movqs:m1", gateway)
        self.assertIn(("mov_review_query_send", {"movId": "m1"}), gateway.calls)
        self.assertIn("Query sent to Lerato M", response.reply)

    def test_a_short_query_is_asked_again(self):
        gateway = MovGateway(mov_review_query_draft=GatewayError("query_too_short", status=400))
        response = self.send("fix it", gateway, awaiting="movr:m1:msg:general-query")
        self.assertIn("say a little more", response.reply)
        self.assertEqual(response.conversation.awaiting, "movr:m1:msg:general-query")

    def test_discarding_changes_nothing(self):
        gateway = MovGateway()
        response = self.send("lph:movx", gateway)
        self.assertIn("nothing was changed", response.reply)
        self.assertEqual(gateway.writes(), [])

    def test_gateway_refusals_are_explained(self):
        gateway = MovGateway(mov_review_approve=GatewayError("mov_already_approved", status=409))
        self.assertIn("already been approved", self.send("lph:movok:m1", gateway).reply)

    def test_a_query_without_a_facilitator_is_not_offered(self):
        gateway = MovGateway(mov_review_detail=detail(MOVS[0], can_query=False))
        response = self.send("lph:movr:m1", gateway)
        self.assertEqual([b.id for b in response.interactive.buttons], ["lph:mova:m1", "lph:movnext"])

    def test_buttons_from_other_roles_do_nothing(self):
        gateway = MovGateway(identity=COORDINATOR)
        staff = ScriptedStaffReasoner(StaffDecision(responseMode="reply", reply="I can't help with that one."))
        self.send("lph:movok:m1", gateway, staff=staff)
        self.assertEqual(gateway.writes(), [], "only a head of department's turns reach the MOV review")


if __name__ == "__main__":
    unittest.main()
