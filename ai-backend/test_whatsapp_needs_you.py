import unittest

import whatsapp_needs_you
from test_whatsapp_staff import HOD, FakeGateway, StaffWhatsAppTests

CENTRE_COORDINATOR = {**HOD, "role": "projectadmin", "roleGroup": "coordinator", "uid": "cc-uid"}
COORDINATOR = {**HOD, "role": "coordinator", "roleGroup": "coordinator", "uid": "co-uid"}
PROGRAMMES = [{"id": "p1", "name": "Rustenburg ESD"}, {"id": "p2", "name": "Mogale Pilot"}]
ITEMS = [
    {"participantId": f"s{n}", "name": f"SME {n}", "level": "High" if n == 1 else None, "points": 50 - n,
     "why": ["High risk", "7 missing document(s)", "ignored"], "nextStep": f"Step for SME {n}"}
    for n in range(1, 8)
]


def gateway(identity, current=None, programmes=PROGRAMMES):
    return FakeGateway(identity, {"list_programmes": {"programmes": programmes, "current": current, "needsChoice": False}})


class NeedsYouTests(StaffWhatsAppTests):
    def setUp(self):
        self.scopes = []

        def load(scope):
            self.scopes.append(scope)
            return {"items": ITEMS, "total": 12}

        whatsapp_needs_you.LOAD_ATTENTION = load

    def tearDown(self):
        whatsapp_needs_you.LOAD_ATTENTION = None

    def test_it_is_the_first_option_for_centre_coordinators_and_coordinators(self):
        for identity in (CENTRE_COORDINATOR, COORDINATOR):
            self.assertIn("1. *Needs you this week*", self.send("hi", gateway(identity)).reply)
        self.assertNotIn("Needs you this week", self.send("hi", gateway(HOD)).reply)

    def test_a_centre_coordinator_gets_their_programmes_and_a_coordinator_their_own_smes(self):
        self.send("lph:menu:top:1", gateway(CENTRE_COORDINATOR))
        self.send("lph:menu:top:1", gateway(COORDINATOR))
        self.assertEqual(self.scopes[0], {"kind": "programmes", "programmeIds": ["p1", "p2"]})
        self.assertEqual(self.scopes[1], {"kind": "own", "uid": "co-uid", "programmeIds": []})

    def test_the_chosen_programme_narrows_the_list(self):
        response = self.send("lph:menu:top:1", gateway(CENTRE_COORDINATOR, current=PROGRAMMES[1]))
        self.assertEqual(self.scopes[0]["programmeIds"], ["p2"])
        self.assertIn("on *Mogale Pilot*", response.reply)
        self.send("lph:menu:top:1", gateway(COORDINATOR, current=PROGRAMMES[0]))
        self.assertEqual(self.scopes[1], {"kind": "own", "uid": "co-uid", "programmeIds": ["p1"]})

    def test_the_reply_shows_the_top_five_with_a_next_step_each(self):
        reply = self.send("lph:menu:top:1", gateway(CENTRE_COORDINATOR)).reply
        self.assertIn("the top 5 of 12", reply)
        self.assertIn("1. *SME 1* - High risk\n7 missing document(s); ignored\n\U0001f449 Step for SME 1", reply)
        self.assertIn("2. *SME 2*\nHigh risk; 7 missing document(s)\n", reply)
        self.assertIn("5. *SME 5*", reply)
        self.assertNotIn("SME 6", reply)

    def test_asking_in_their_own_words_gets_the_list(self):
        reply = self.send("Which SMEs need me this week?", gateway(COORDINATOR)).reply
        self.assertIn("SMEs that need you this week", reply)

    def test_a_centre_coordinator_without_programmes_is_told_so(self):
        reply = self.send("lph:menu:top:1", gateway(CENTRE_COORDINATOR, programmes=[])).reply
        self.assertIn("no programmes linked", reply)
        self.assertEqual(self.scopes, [])

    def test_nothing_to_do(self):
        whatsapp_needs_you.LOAD_ATTENTION = lambda scope: {"items": [], "total": 0}
        self.assertIn("Nothing needs you this week", self.send("lph:menu:top:1", gateway(COORDINATOR)).reply)


if __name__ == "__main__":
    unittest.main()
