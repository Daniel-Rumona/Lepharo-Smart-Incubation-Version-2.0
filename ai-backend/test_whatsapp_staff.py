import unittest
from typing import Any

from lph_gateway import GatewayError, LphGateway
from whatsapp import WhatsAppChatRequest, WhatsAppConversationStore, interpret_whatsapp_message
from whatsapp_staff import StaffDecision, StaffPropose, StaffRead

ADMIN = {"id": "u1", "kind": "staff", "name": "Daniel Rumona", "role": "system_admin", "roleGroup": "system_admin"}
HOD = {"id": "u2", "kind": "staff", "name": "Thandi Nkosi", "role": "operations", "roleGroup": "hod"}
RECEPTION = {"id": "u3", "kind": "staff", "name": "Ayanda", "role": "receptionist", "roleGroup": "receptionist"}
SME = {"id": "p1", "kind": "sme", "name": "Acme Traders", "participantName": "Acme Traders", "role": "incubatee"}


class FakeGateway(LphGateway):
    def __init__(self, identity, responses=None):
        super().__init__(url="https://gateway.test", secret="secret")
        self.identity = identity
        self.responses = responses or {}
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def call(self, action, phone, **fields):
        self.calls.append((action, fields))
        if action == "resolve_identity":
            return {"ok": True, "matched": bool(self.identity), "identity": self.identity}
        if action == "agent_state_get":
            return {"ok": True, "history": []}
        if action == "agent_state_set":
            return {"ok": True}
        result = self.responses.get(action)
        if isinstance(result, Exception):
            raise result
        return {"ok": True, "matched": True, **(result or {})}

    def actions(self):
        return [name for name, _ in self.calls]


class ScriptedStaffReasoner:
    def __init__(self, *decisions):
        self.decisions = list(decisions)
        self.calls = []

    def decide(self, message, identity, history, tool_results, now):
        self.calls.append((message, tool_results))
        return self.decisions.pop(0)


class UnusedReasoner:
    def decide(self, *args, **kwargs):  # the SME appointment reasoner
        raise AssertionError("The appointment reasoner should not be used here")


class StaffWhatsAppTests(unittest.TestCase):
    def send(self, message, gateway, staff=None, awaiting=None, user="+27821234567"):
        context = {"engine": "LPH"}
        if awaiting is not None:
            context["conversation"] = {"awaiting": awaiting}
        payload = WhatsAppChatRequest(channel="whatsapp", userId=user, message=message, context=context)
        return interpret_whatsapp_message(
            payload, WhatsAppConversationStore(), UnusedReasoner(), gateway=gateway, staff_reasoner=staff
        )

    # -- greeting and menu
    def test_admin_greeting_is_friendly_and_role_aware(self):
        response = self.send("Hie", FakeGateway(ADMIN))
        self.assertIn("Hey there, Daniel!", response.reply)
        for option in ("Feature governance", "User stats", "Appointments", "Intervention status"):
            self.assertIn(option, response.reply)
        self.assertEqual(response.conversation.awaiting, "menu")

    def test_greeting_variants(self):
        for text in ("hi", "Hello!", "hey", "Good morning", "menu", "help"):
            self.assertIn("Hey there", self.send(text, FakeGateway(ADMIN)).reply, text)

    def test_hod_menu_does_not_offer_governance_or_user_stats(self):
        reply = self.send("hi", FakeGateway(HOD)).reply
        self.assertNotIn("Feature governance", reply)
        self.assertNotIn("User stats", reply)
        self.assertIn("Interventions", reply)

    def test_receptionist_menu_is_minimal(self):
        reply = self.send("hello", FakeGateway(RECEPTION)).reply
        self.assertIn("Today's appointments", reply)
        self.assertNotIn("Feature governance", reply)

    def test_sme_menu(self):
        reply = self.send("hey", FakeGateway(SME)).reply
        self.assertIn("Hey there, Acme!", reply)
        self.assertIn("My appointments", reply)
        self.assertNotIn("User stats", reply)

    def test_greeting_when_gateway_unavailable_is_generic(self):
        response = self.send("hi", LphGateway(url="", secret=""))
        self.assertIn("Hey there!", response.reply)
        self.assertNotIn("link", response.reply.lower())

    # -- menu navigation
    def test_menu_number_opens_submenu(self):
        response = self.send("1", FakeGateway(ADMIN), awaiting="menu")
        self.assertIn("Log a meeting", response.reply)
        self.assertEqual(response.conversation.awaiting, "menu:governance")

    def test_submenu_number_gives_guidance_for_logging(self):
        response = self.send("1", FakeGateway(ADMIN), awaiting="menu:governance")
        self.assertIn("who you met", response.reply)

    def test_guide_prompt_is_saved_so_the_answer_keeps_its_context(self):
        gateway = FakeGateway(HOD)
        self.send("lph:menu:top:3", gateway)  # Find an SME
        saved = [fields["history"] for action, fields in gateway.calls if action == "agent_state_set"]
        self.assertEqual(saved[-1][0], {"role": "user", "text": "Find an SME"})
        self.assertIn("SME's name", saved[-1][1]["text"])

    def test_user_stats_from_menu(self):
        gateway = FakeGateway(ADMIN, {"staff_overview": {
            "users": {"total": 12, "byRole": {"system_admin": 2, "operations": 3, "consultant": 4, "employee": 3}},
            "participants": 40, "assignments": {"total": 9, "byStatus": {}}, "upcomingSessions": 2,
        }})
        reply = self.send("2", gateway, awaiting="menu").reply
        self.assertIn("12 users", reply)
        self.assertIn("Employees: 7", reply)
        self.assertIn("40 SMEs", reply)

    def test_pipeline_summary_from_menu(self):
        gateway = FakeGateway(ADMIN, {"governance_summary": {
            "features": {"total": 5, "byStatus": {"planned": 2}}, "pipeline": [{"title": "Reminders", "progress": 40, "dueDate": None}],
            "meetings": {"total": 3, "pending": 1}, "openChallenges": 2,
        }})
        reply = self.send("3", gateway, awaiting="menu:governance").reply
        self.assertIn("Reminders - 40%", reply)
        self.assertIn("2 open challenges", reply)

    def test_forbidden_menu_action_is_reported_kindly(self):
        gateway = FakeGateway(ADMIN, {"staff_overview": GatewayError("no", status=403)})
        self.assertIn("isn't available", self.send("2", gateway, awaiting="menu").reply)

    # -- system administrators view, they do not set up
    def test_admin_menu_offers_no_setup_options(self):
        response = self.send("hi", FakeGateway(ADMIN))
        self.assertNotIn("set one up", response.reply.lower())
        self.assertNotIn("set up", response.reply.lower())
        self.assertNotIn("Assign", response.reply)
        rows = response.interactive.sections[0].rows
        self.assertEqual([row.title for row in rows], ["Feature governance", "User stats", "Appointments", "Intervention status"])

    def test_admin_appointments_option_lists_upcoming_directly(self):
        gateway = FakeGateway(ADMIN, {"my_appointments": {"scope": "organisation", "appointments": [
            {"title": "Compliance", "start": "2026-10-01 10:00", "endTime": "11:00", "assigneeName": "Thandi"},
        ]}})
        response = self.send("lph:menu:top:3", gateway)
        self.assertIn("Compliance", response.reply)
        self.assertIsNone(response.interactive)  # no set-up submenu for admins

    def test_admin_cannot_propose_an_appointment(self):
        gateway = FakeGateway(ADMIN)
        staff = ScriptedStaffReasoner(StaffDecision(
            responseMode="propose", propose=StaffPropose(kind="schedule_appointment", params={"assignedInterventionId": "a1"}),
        ))
        response = self.send("book acme tomorrow at 10", gateway, staff)
        self.assertIn("isn't something I can do", response.reply)
        self.assertNotIn("propose_action", gateway.actions())

    def test_admin_cannot_use_sme_lookups(self):
        gateway = FakeGateway(ADMIN)
        staff = ScriptedStaffReasoner(
            StaffDecision(responseMode="read", read=StaffRead(type="search_assignments", arguments={"query": "Acme"})),
            StaffDecision(responseMode="reply", reply="Only coordinators can do that."),
        )
        self.send("find acme's interventions", gateway, staff)
        self.assertNotIn("search_assignments", gateway.actions())

    # -- agentic logging with confirmation
    def test_log_meeting_is_proposed_then_confirmed(self):
        gateway = FakeGateway(ADMIN, {
            "propose_action": {"proposalId": "p", "summary": "Log a governance meeting\nTitle: Booking issue"},
            "confirm_proposal": {"executed": True, "message": "Meeting logged."},
        })
        staff = ScriptedStaffReasoner(StaffDecision(
            responseMode="propose", propose=StaffPropose(kind="log_meeting", params={"title": "Booking issue", "withName": "Lindiwe"}),
        ))
        proposed = self.send("Met Lindiwe about the booking issue", gateway, staff)
        self.assertIn("Title: Booking issue", proposed.reply)
        self.assertIn("YES", proposed.reply)
        self.assertEqual(proposed.conversation.awaiting, "confirm_proposal")
        self.assertNotIn("confirm_proposal", gateway.actions())

        confirmed = self.send("yes", gateway, staff, awaiting="confirm_proposal")
        self.assertIn("Meeting logged.", confirmed.reply)
        self.assertIn("confirm_proposal", gateway.actions())

    def test_no_discards_the_proposal(self):
        gateway = FakeGateway(ADMIN)
        reply = self.send("no", gateway, ScriptedStaffReasoner(), awaiting="confirm_proposal").reply
        self.assertIn("discarded", reply)
        self.assertIn("cancel_proposal", gateway.actions())
        self.assertNotIn("confirm_proposal", gateway.actions())

    def test_unclear_reply_while_confirming_is_not_treated_as_yes(self):
        gateway = FakeGateway(ADMIN)
        staff = ScriptedStaffReasoner(StaffDecision(responseMode="reply", reply="Sure, what should change?"))
        response = self.send("make the title shorter", gateway, staff, awaiting="confirm_proposal")
        self.assertEqual(response.reply, "Sure, what should change?")
        self.assertNotIn("confirm_proposal", gateway.actions())
        self.assertIn("cancel_proposal", gateway.actions())

    def test_rejected_proposal_shows_the_reason(self):
        gateway = FakeGateway(HOD, {"propose_action": {"rejected": True, "reason": "That time has already passed."}})
        staff = ScriptedStaffReasoner(StaffDecision(
            responseMode="propose", propose=StaffPropose(kind="schedule_appointment", params={"assignedInterventionId": "a1"}),
        ))
        response = self.send("book acme yesterday", gateway, staff)
        self.assertEqual(response.reply, "That time has already passed.")
        self.assertIsNone(response.conversation.awaiting)

    def test_role_without_permission_cannot_propose(self):
        gateway = FakeGateway(HOD)
        staff = ScriptedStaffReasoner(StaffDecision(
            responseMode="propose", propose=StaffPropose(kind="log_meeting", params={"title": "x", "withName": "y"}),
        ))
        response = self.send("log a meeting", gateway, staff)
        self.assertIn("isn't something I can do", response.reply)
        self.assertNotIn("propose_action", gateway.actions())

    def test_unknown_proposal_kind_is_refused(self):
        gateway = FakeGateway(ADMIN)
        staff = ScriptedStaffReasoner(StaffDecision(
            responseMode="propose", propose=StaffPropose(kind="assign_intervention", params={}),
        ))
        self.assertIn("isn't something I can do", self.send("assign it", gateway, staff).reply)
        self.assertNotIn("propose_action", gateway.actions())

    # -- read tools
    def test_read_tool_result_is_fed_back_to_the_model(self):
        gateway = FakeGateway(HOD, {"search_participants": {"participants": [{"id": "p1", "name": "Acme Traders"}]}})
        staff = ScriptedStaffReasoner(
            StaffDecision(responseMode="read", read=StaffRead(type="search_participants", arguments={"query": "Acme"})),
            StaffDecision(responseMode="reply", reply="Found Acme Traders."),
        )
        response = self.send("find acme", gateway, staff)
        self.assertEqual(response.reply, "Found Acme Traders.")
        self.assertEqual(staff.calls[1][1][0]["type"], "search_participants")
        self.assertEqual(staff.calls[1][1][0]["result"]["participants"][0]["name"], "Acme Traders")

    def test_read_tool_outside_role_is_blocked(self):
        gateway = FakeGateway(RECEPTION)
        staff = ScriptedStaffReasoner(
            StaffDecision(responseMode="read", read=StaffRead(type="staff_overview")),
            StaffDecision(responseMode="reply", reply="I can't share that."),
        )
        self.send("how many users", gateway, staff)
        self.assertNotIn("staff_overview", gateway.actions())
        self.assertIn("isn't available", staff.calls[1][1][0]["result"]["error"])

    # -- SME invitation flow
    def test_single_pending_invitation_moves_into_rsvp(self):
        gateway = FakeGateway(SME, {"get_upcoming_appointments": {"appointments": [
            {"id": "a1", "interventionTitle": "Compliance", "smeConfirmation": "pending", "startTime": "2026-10-01T08:00:00.000Z"},
        ]}})
        response = self.send("1", gateway, awaiting="menu")  # first option is My appointments
        self.assertIn("Compliance", response.reply)
        response = self.send("2", gateway, awaiting="menu")
        self.assertIn("Can you make it?", response.reply)
        self.assertEqual(response.conversation.awaiting, "appointment_rsvp_confirmation")
        self.assertEqual(response.conversation.appointmentId, "a1")
        self.assertIn("10:00", response.reply)  # 08:00 UTC is 10:00 SAST


class InteractiveMessageTests(StaffWhatsAppTests):
    """Real WhatsApp lists and buttons, layered on top of the text fallback."""

    def test_greeting_is_a_list_with_a_text_fallback(self):
        response = self.send("hi", FakeGateway(ADMIN))
        self.assertEqual(response.interactive.type, "list")
        rows = response.interactive.sections[0].rows
        self.assertEqual([row.id for row in rows], [f"lph:menu:top:{n}" for n in range(1, 5)])
        self.assertIn("Feature governance", response.reply)  # fallback for text-only routers

    def test_every_role_menu_respects_platform_limits(self):
        for identity in (ADMIN, HOD, RECEPTION, SME, {**ADMIN, "roleGroup": "director"}, {**HOD, "roleGroup": "coordinator"}):
            response = self.send("hey", FakeGateway(identity))
            if response.interactive:  # model validation already enforces 24/72 character limits
                self.assertLessEqual(len(response.interactive.sections[0].rows), 10)

    def test_tapping_a_list_row_opens_the_submenu_without_conversation_state(self):
        response = self.send("lph:menu:top:1", FakeGateway(ADMIN))
        self.assertEqual(response.interactive.type, "list")
        self.assertEqual(response.interactive.sections[0].rows[0].id, "lph:menu:governance:1")
        self.assertEqual(response.conversation.awaiting, "menu:governance")

    def test_proposal_uses_confirm_and_discard_buttons(self):
        gateway = FakeGateway(ADMIN, {"propose_action": {"proposalId": "p", "summary": "Log a governance meeting"}})
        staff = ScriptedStaffReasoner(StaffDecision(
            responseMode="propose", propose=StaffPropose(kind="log_meeting", params={"title": "x", "withName": "y"}),
        ))
        response = self.send("log it", gateway, staff)
        self.assertEqual(response.interactive.type, "buttons")
        self.assertEqual([b.id for b in response.interactive.buttons], ["lph:confirm", "lph:cancel"])
        self.assertEqual([b.title for b in response.interactive.buttons], ["Confirm", "Discard"])

    def test_confirm_button_works_even_after_the_conversation_moved_on(self):
        gateway = FakeGateway(ADMIN, {"confirm_proposal": {"executed": True, "message": "Meeting logged."}})
        response = self.send("lph:confirm", gateway, ScriptedStaffReasoner(), awaiting=None)
        self.assertIn("Meeting logged.", response.reply)
        self.assertIn("confirm_proposal", gateway.actions())

    def test_discard_button(self):
        gateway = FakeGateway(ADMIN)
        response = self.send("lph:cancel", gateway, ScriptedStaffReasoner())
        self.assertIn("discarded", response.reply)
        self.assertNotIn("confirm_proposal", gateway.actions())

    def test_single_invitation_offers_yes_and_cant_make_it_buttons(self):
        gateway = FakeGateway(SME, {"get_upcoming_appointments": {"appointments": [
            {"id": "a1", "interventionTitle": "Compliance", "smeConfirmation": "pending", "startTime": "2026-10-01T08:00:00.000Z"},
        ]}})
        response = self.send("lph:menu:top:2", gateway)
        self.assertEqual([b.id for b in response.interactive.buttons], ["lph:rsvp_yes", "lph:rsvp_no"])
        self.assertEqual(response.conversation.appointmentId, "a1")

    def test_several_invitations_become_a_list_and_a_tap_selects_one(self):
        appointments = [
            {"id": "a1", "interventionTitle": "Compliance", "smeConfirmation": "pending", "startTime": "2026-10-01T08:00:00.000Z"},
            {"id": "a2", "interventionTitle": "Marketing", "smeConfirmation": "pending", "startTime": "2026-10-02T08:00:00.000Z"},
        ]
        gateway = FakeGateway(SME, {"get_upcoming_appointments": {"appointments": appointments}})
        listed = self.send("lph:menu:top:2", gateway)
        self.assertEqual([row.id for row in listed.interactive.sections[0].rows], ["lph:invite:a1", "lph:invite:a2"])
        picked = self.send("lph:invite:a2", gateway, awaiting="appointment_pick")
        self.assertEqual(picked.conversation.appointmentId, "a2")
        self.assertEqual(picked.interactive.type, "buttons")

    def test_greeting_for_unlinked_number_has_no_interactive_menu(self):
        response = self.send("hi", FakeGateway(None))
        self.assertIsNone(response.interactive)


HOD_DOCS = {**HOD, "documentAccess": True}
POPIA = {
    "found": True,
    "participantId": "p1",
    "participantName": "Acme Traders",
    "document": {
        "url": "https://firebasestorage.googleapis.com/v0/b/x/o/popia.pdf?alt=media&token=t",
        "filename": "Acme Traders - POPIA notice.pdf",
        "label": "POPIA notice",
        "signedOn": "2026-01-21",
    },
}
LISTING = {
    "found": True,
    "participantId": "p1",
    "participantName": "Acme Traders",
    "documents": [
        {"key": "popia", "label": "POPIA notice", "issued": "2026-01-21"},
        {"key": "cipc-registration-docs", "label": "CIPC Registration Docs", "issued": "2025-03-02"},
        {"key": "sars-tax-compliance-status-tcs-pin", "label": "SARS Tax Compliance Status (TCS) PIN", "expires": "2026-01-01", "expired": True},
    ],
    "missing": ["Proof of Address"],
}
ASK_FOR_POPIA = StaffDecision(responseMode="read", read=StaffRead(type="sme_document", arguments={"query": "Acme", "document": "popia"}))
ASK_FOR_LIST = StaffDecision(responseMode="read", read=StaffRead(type="sme_document", arguments={"query": "Acme"}))


class DocumentGateway(FakeGateway):
    """Lists the SME's documents, or sends the one asked for."""

    def __init__(self, identity=HOD_DOCS):
        super().__init__(identity)

    def call(self, action, phone, **fields):
        if action != "sme_document":
            return super().call(action, phone, **fields)
        self.calls.append((action, fields))
        wanted = fields.get("document")
        if not wanted:
            return {"ok": True, **LISTING}
        doc = next((d for d in LISTING["documents"] if d["key"] == wanted or wanted.lower() in d["label"].lower()), None)
        if doc is None:
            return {"ok": True, **LISTING, "reason": "document_not_uploaded", "asked": wanted}
        return {"ok": True, **POPIA, "document": {**POPIA["document"], "label": doc["label"], "filename": f"Acme Traders - {doc['label']}.pdf",
                                                  "signedOn": None, "expires": doc.get("expires"), "expired": doc.get("expired", False)}}


class DocumentTests(StaffWhatsAppTests):
    def test_popia_is_sent_as_a_document_with_a_caption(self):
        gateway = FakeGateway(HOD_DOCS, {"sme_document": POPIA})
        response = self.send("send me the POPIA for Acme", gateway, staff=ScriptedStaffReasoner(ASK_FOR_POPIA))
        self.assertEqual(response.document.url, POPIA["document"]["url"])
        self.assertEqual(response.document.filename, "Acme Traders - POPIA notice.pdf")
        self.assertIn("POPIA notice for *Acme Traders* (signed 2026-01-21)", response.reply)
        self.assertIn(("sme_document", {"query": "Acme", "document": "popia"}), gateway.calls)

    def test_asking_for_documents_lists_them_to_tap(self):
        response = self.send("what documents does Acme have?", DocumentGateway(), staff=ScriptedStaffReasoner(ASK_FOR_LIST))
        self.assertIsNone(response.document)
        rows = response.interactive.sections[0].rows
        self.assertEqual([row.id for row in rows], ["lph:doc:p1:popia", "lph:doc:p1:cipc-registration-docs", "lph:doc:p1:sars-tax-compliance-status-tcs-pin"])
        self.assertTrue(all(len(row.title) <= 24 and len(row.description or "") <= 72 for row in rows))
        self.assertIn("Not uploaded yet: Proof of Address", response.reply)
        self.assertIn("expired 2026-01-01", response.reply)
        self.assertEqual(response.conversation.awaiting, "document:p1")

    def test_tapping_a_document_sends_it(self):
        gateway = DocumentGateway()
        response = self.send("lph:doc:p1:cipc-registration-docs", gateway)
        self.assertEqual(response.document.filename, "Acme Traders - CIPC Registration Docs.pdf")
        self.assertIn(("sme_document", {"participantId": "p1", "document": "cipc-registration-docs"}), gateway.calls)

    def test_replying_with_a_number_or_name_sends_that_document(self):
        self.assertEqual(self.send("2", DocumentGateway(), awaiting="document:p1").document.filename, "Acme Traders - CIPC Registration Docs.pdf")
        self.assertEqual(self.send("cipc", DocumentGateway(), awaiting="document:p1").document.filename, "Acme Traders - CIPC Registration Docs.pdf")

    def test_an_expired_document_is_flagged(self):
        response = self.send("3", DocumentGateway(), awaiting="document:p1")
        self.assertIn("expired 2026-01-01", response.reply)
        self.assertIn("This document has expired", response.reply)

    def test_an_unrelated_reply_to_the_list_goes_to_the_agent(self):
        staff = ScriptedStaffReasoner(StaffDecision(responseMode="reply", reply="Sure, which SME?"))
        response = self.send("find another SME", DocumentGateway(), staff=staff, awaiting="document:p1")
        self.assertEqual(response.reply, "Sure, which SME?")

    def test_several_matches_go_back_to_the_model_to_ask(self):
        matches = {"found": False, "reason": "several_matches", "matches": [{"id": "a", "name": "Acme"}, {"id": "b", "name": "Acme Two"}]}
        staff = ScriptedStaffReasoner(ASK_FOR_POPIA, StaffDecision(responseMode="reply", reply="Which one: Acme or Acme Two?"))
        response = self.send("popia for acme", FakeGateway(HOD_DOCS, {"sme_document": matches}), staff=staff)
        self.assertIsNone(response.document)
        self.assertEqual(response.reply, "Which one: Acme or Acme Two?")
        self.assertEqual(staff.calls[1][1][0]["result"]["reason"], "several_matches")

    def test_missing_document_is_explained_by_the_model(self):
        staff = ScriptedStaffReasoner(
            StaffDecision(responseMode="read", read=StaffRead(type="sme_document", arguments={"query": "Acme", "document": "vat"})),
            StaffDecision(responseMode="reply", reply="Acme hasn't uploaded a VAT certificate."),
        )
        response = self.send("acme's vat", DocumentGateway(), staff=staff)
        self.assertIsNone(response.document)
        self.assertEqual(response.reply, "Acme hasn't uploaded a VAT certificate.")

    def test_bank_letter_refusal_is_explained(self):
        gateway = FakeGateway(HOD_DOCS, {"sme_document": {**LISTING, "reason": "bank_letter_not_permitted"}})
        response = self.send("lph:doc:p1:bank-confirmation-letter", gateway)
        self.assertIn("only available to admins and the ROM team", response.reply)
        self.assertIsNone(response.document)

    def test_without_document_access_nothing_is_fetched(self):
        staff = ScriptedStaffReasoner(ASK_FOR_POPIA, StaffDecision(responseMode="reply", reply="I can't send that."))
        gateway = FakeGateway(HOD, {"sme_document": POPIA})
        self.assertIsNone(self.send("popia for acme", gateway, staff=staff).document)
        self.assertIsNone(self.send("lph:doc:p1:popia", gateway).document)
        self.assertNotIn("sme_document", gateway.actions())

    def test_menu_offers_documents_only_with_access(self):
        coordinator = {**HOD_DOCS, "role": "coordinator", "roleGroup": "coordinator"}
        self.assertIn("SME documents", self.send("hi", FakeGateway(HOD_DOCS)).reply)
        self.assertIn("SME documents", self.send("hi", FakeGateway(coordinator)).reply)
        self.assertNotIn("SME documents", self.send("hi", FakeGateway(HOD)).reply)
        self.assertNotIn("SME documents", self.send("hi", FakeGateway(RECEPTION)).reply)

    def test_documents_menu_option_asks_for_the_sme(self):
        response = self.send("lph:menu:top:5", FakeGateway(HOD_DOCS))  # after "Record a session"
        self.assertIn("Which SME's documents", response.reply)


class DecisionParsingTests(unittest.TestCase):
    def parse(self, raw):
        from whatsapp_staff import GeminiStaffReasoner
        return GeminiStaffReasoner._parse(raw)

    def test_read_with_null_reply_is_accepted(self):
        decision = self.parse('{"responseMode": "read", "reply": null, "read": {"type": "search_participants", "arguments": {"query": "Acme"}}, "propose": null}')
        self.assertEqual(decision.read.arguments, {"query": "Acme"})
        self.assertEqual(decision.reply, "")

    def test_null_arguments_and_params_become_empty(self):
        self.assertEqual(self.parse('{"responseMode": "read", "read": {"type": "my_appointments", "arguments": null}}').read.arguments, {})
        self.assertEqual(self.parse('{"responseMode": "propose", "propose": {"kind": "log_feature", "params": null}}').propose.params, {})

    def test_single_decision_in_a_list_is_unwrapped(self):
        self.assertEqual(self.parse('[{"responseMode": "reply", "reply": "Hi"}]').reply, "Hi")

    def test_long_reply_is_trimmed_not_rejected(self):
        self.assertEqual(len(self.parse('{"responseMode": "reply", "reply": "' + "x" * 3000 + '"}').reply), 1500)

    def test_invalid_output_is_still_rejected(self):
        for raw in ("not json", '{"responseMode": "dance"}', "[]"):
            with self.assertRaises(ValueError, msg=raw):
                self.parse(raw)


PROGRAMMES = [{"id": "p-eskom", "name": "Eskom MSME SDL & I development Programme"}, {"id": "p-sedfa", "name": "SEDFA"}]


class ProgrammeTests(StaffWhatsAppTests):
    def gateway(self, needs_choice=True, current=None, allow_all=True, programmes=PROGRAMMES, **responses):
        listing = {"programmes": programmes, "allowAll": allow_all, "current": current, "needsChoice": needs_choice}
        return FakeGateway(HOD, {"list_programmes": listing, "select_programme": {"current": PROGRAMMES[1]}, **responses})

    def test_greeting_asks_for_the_programme_first(self):
        response = self.send("hi", self.gateway())
        self.assertIn("Which programme are we looking at today?", response.reply)
        self.assertEqual(response.conversation.awaiting, "programme")
        ids = [row.id for row in response.interactive.sections[0].rows]
        self.assertEqual(ids, ["lph:programme:all", "lph:programme:p-eskom", "lph:programme:p-sedfa"])
        self.assertTrue(all(len(row.title) <= 24 for row in response.interactive.sections[0].rows))

    def test_picking_a_programme_saves_it_and_shows_the_menu(self):
        gateway = self.gateway()
        response = self.send("3", gateway, awaiting="programme")
        self.assertIn(("select_programme", {"programId": "p-sedfa"}), gateway.calls)
        self.assertIn("*SEDFA*", response.reply)
        self.assertIn("switch programme", response.reply)
        self.assertEqual(response.conversation.awaiting, "menu")

    def test_tapping_a_programme_works_without_conversation_state(self):
        gateway = self.gateway()
        self.send("lph:programme:p-sedfa", gateway)
        self.assertIn(("select_programme", {"programId": "p-sedfa"}), gateway.calls)

    def test_a_programme_can_be_picked_by_name(self):
        gateway = self.gateway()
        self.send("sedfa", gateway, awaiting="programme")
        self.assertIn(("select_programme", {"programId": "p-sedfa"}), gateway.calls)

    def test_greeting_names_the_programme_chosen_today(self):
        response = self.send("hi", self.gateway(needs_choice=False, current=PROGRAMMES[1]))
        self.assertIn("*SEDFA* - say *switch programme* to change", response.reply)
        self.assertEqual(response.conversation.awaiting, "menu")

    def test_switch_command_reopens_the_picker(self):
        for text in ("switch programme", "Change program", "programmes", "switch the programme"):
            response = self.send(text, self.gateway(needs_choice=False, current=PROGRAMMES[1]))
            self.assertEqual(response.conversation.awaiting, "programme", text)

    def test_switch_with_a_single_programme_explains_there_is_nothing_to_switch(self):
        response = self.send("switch programme", self.gateway(needs_choice=False, programmes=PROGRAMMES[:1], allow_all=False))
        self.assertIn("only work in", response.reply)

    def test_menu_option_waits_for_a_programme_choice(self):
        gateway = self.gateway()
        response = self.send("lph:menu:top:1", gateway)
        self.assertEqual(response.conversation.awaiting, "programme")
        self.assertNotIn("staff_overview", gateway.actions())

    def test_free_text_gets_the_programme_in_the_prompt_identity(self):
        staff = ScriptedStaffReasoner(StaffDecision(responseMode="reply", reply="Nothing coming up."))
        captured = {}
        original = staff.decide

        def decide(message, identity, *rest):
            captured.update(identity)
            return original(message, identity, *rest)

        staff.decide = decide
        self.send("what is the upcoming session?", self.gateway(needs_choice=False, current=PROGRAMMES[1]), staff=staff)
        self.assertEqual(captured.get("programme"), "SEDFA")

    def test_unrecognised_answer_repeats_the_picker(self):
        response = self.send("the other one", self.gateway(), awaiting="programme")
        self.assertIn("didn't catch which programme", response.reply)
        self.assertEqual(response.conversation.awaiting, "programme")

    def test_overview_shows_the_programme(self):
        overview = {"scope": "department", "departmentName": "ROM", "programme": "SEDFA", "participants": 3,
                    "assignments": {"total": 4, "byStatus": {"assigned": 4}}, "upcomingSessions": 0}
        response = self.send("lph:menu:top:1", self.gateway(needs_choice=False, current=PROGRAMMES[1], staff_overview=overview))
        self.assertIn("*Interventions - ROM*", response.reply)
        self.assertIn("SEDFA", response.reply)
        self.assertIn("Ready to schedule: 4", response.reply)

    def test_programme_lookup_failure_does_not_block_the_menu(self):
        gateway = FakeGateway(HOD, {"list_programmes": GatewayError("down")})
        self.assertEqual(self.send("hi", gateway).conversation.awaiting, "menu")


if __name__ == "__main__":
    unittest.main()
