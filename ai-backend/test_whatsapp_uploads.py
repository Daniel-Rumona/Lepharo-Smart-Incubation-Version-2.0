import unittest
from datetime import date

import whatsapp_uploads
from lph_gateway import GatewayError
from test_whatsapp_staff import SME, FakeGateway, StaffWhatsAppTests
from whatsapp_uploads import match_requirement, parse_issue_date

REQUIREMENTS = [
    {"key": "proof-of-address", "title": "Proof of Address", "status": "missing", "expires": None, "needsIssueDate": True},
    {"key": "sars-tax-compliance-status-tcs-pin", "title": "SARS Tax Compliance Status (TCS) PIN", "status": "expired",
     "expires": "2026-01-01", "needsIssueDate": True},
    {"key": "cipc-registration-docs", "title": "CIPC Registration Docs", "status": "valid", "expires": None, "needsIssueDate": False},
    {"key": "b-bbee-certificate-affidavit", "title": "B-BBEE Certificate/Affidavit", "status": "pending", "expires": "2027-02-01",
     "needsIssueDate": True},
]
SAVED = {"applicationId": "app1", "documentId": "doc1", "title": "CIPC Registration Docs", "issueDate": None, "expiryDate": None}


def gateway(caption="", requirements=REQUIREMENTS, attach=None):
    return FakeGateway(SME, {
        "upload_options": {"requirements": requirements, "caption": caption, "fileName": "scan.pdf"},
        "attach_upload": attach if attach is not None else SAVED,
    })


def attach_call(gw):
    return next(fields for action, fields in gw.calls if action == "attach_upload")


class UploadConversationTests(StaffWhatsAppTests):
    def setUp(self):
        self.verified = []
        whatsapp_uploads.VERIFY_UPLOAD = lambda application_id, document_id: self.verified.append((application_id, document_id))

    def tearDown(self):
        whatsapp_uploads.VERIFY_UPLOAD = None

    def test_caption_naming_the_document_files_it_straight_away(self):
        gw = gateway(caption="Here is my CIPC")
        response = self.send("lph:upload:u1", gw)
        self.assertEqual(attach_call(gw), {"uploadId": "u1", "requirementKey": "cipc-registration-docs"})
        self.assertIn("I've saved your *CIPC Registration Docs*", response.reply)
        self.assertEqual(self.verified, [("app1", "doc1")])

    def test_without_a_caption_the_sme_picks_from_a_list(self):
        response = self.send("lph:upload:u1", gateway())
        self.assertEqual(response.conversation.awaiting, "upload:u1")
        rows = response.interactive.sections[0].rows
        self.assertEqual(rows[0].id, "lph:attach:u1:proof-of-address")
        self.assertTrue(all(len(row.title) <= 24 and len(row.description or "") <= 72 for row in rows))
        self.assertIn("Expired (expired 2026-01-01)", response.reply)

    def test_a_document_with_a_validity_period_asks_for_its_issue_date(self):
        response = self.send("1", gateway(), awaiting="upload:u1")
        self.assertEqual(response.conversation.awaiting, "upload_date:u1:proof-of-address")
        self.assertIn("issue date", response.reply)

    def test_issue_date_reply_files_it_with_that_date(self):
        gw = gateway(attach={**SAVED, "title": "Proof of Address", "expiryDate": "2026-06-15"})
        response = self.send("15/03/2026", gw, awaiting="upload_date:u1:proof-of-address")
        self.assertEqual(attach_call(gw), {"uploadId": "u1", "requirementKey": "proof-of-address", "issueDate": "2026-03-15"})
        self.assertIn("valid until 2026-06-15", response.reply)

    def test_skip_files_it_without_a_date(self):
        gw = gateway()
        self.send("skip", gw, awaiting="upload_date:u1:proof-of-address")
        self.assertEqual(attach_call(gw), {"uploadId": "u1", "requirementKey": "proof-of-address"})

    def test_an_unreadable_date_is_asked_again(self):
        gw = gateway()
        response = self.send("sometime last year", gw, awaiting="upload_date:u1:proof-of-address")
        self.assertEqual(response.conversation.awaiting, "upload_date:u1:proof-of-address")
        self.assertNotIn("attach_upload", gw.actions())

    def test_tapping_a_row_picks_that_document(self):
        gw = gateway()
        self.send("lph:attach:u1:cipc-registration-docs", gw)
        self.assertEqual(attach_call(gw)["requirementKey"], "cipc-registration-docs")

    def test_naming_the_document_in_reply_to_the_list_picks_it(self):
        response = self.send("tax pin", gateway(), awaiting="upload:u1")
        self.assertEqual(response.conversation.awaiting, "upload_date:u1:sars-tax-compliance-status-tcs-pin")

    def test_an_unclear_reply_shows_the_list_again(self):
        response = self.send("the other one", gateway(), awaiting="upload:u1")
        self.assertIn("didn't catch which document", response.reply)
        self.assertEqual(response.conversation.awaiting, "upload:u1")

    def test_no_application_to_file_against_is_explained(self):
        self.assertIn("couldn't find an approved application", self.send("lph:upload:u1", gateway(requirements=[])).reply)

    def test_an_expired_upload_asks_to_send_again(self):
        gw = FakeGateway(SME, {"upload_options": GatewayError("Lepharo gateway request failed (upload_not_found).")})
        self.assertIn("Please send it again", self.send("lph:upload:u1", gw).reply)

    def test_send_a_document_menu_lists_what_is_outstanding(self):
        response = self.send("lph:menu:top:3", gateway())
        self.assertIn("Proof of Address: Not uploaded yet", response.reply)
        self.assertIn("SARS Tax Compliance Status (TCS) PIN: Expired", response.reply)
        self.assertNotIn("CIPC", response.reply)  # approved
        self.assertNotIn("B-BBEE", response.reply)  # awaiting review

    def test_nothing_outstanding(self):
        done = [{**r, "status": "valid"} for r in REQUIREMENTS]
        self.assertIn("up to date", self.send("lph:menu:top:3", gateway(requirements=done)).reply)

    # -- several files for one document
    def test_later_pages_are_acknowledged_without_asking_again(self):
        gw = gateway()
        response = self.send("lph:upload:u1:2", gw, awaiting="upload:u1")
        self.assertEqual(response.reply, "\U0001f4ce Got page 2.")
        self.assertEqual(response.conversation.awaiting, "upload:u1")
        self.assertNotIn("upload_options", gw.actions())

    def test_a_page_arriving_during_the_date_question_keeps_that_question(self):
        response = self.send("lph:upload:u1:3", gateway(), awaiting="upload_date:u1:proof-of-address")
        self.assertEqual(response.conversation.awaiting, "upload_date:u1:proof-of-address")

    def test_first_page_invites_more_pages(self):
        self.assertIn("If you have more pages, send them now", self.send("lph:upload:u1:1", gateway()).reply)

    def test_a_multi_page_upload_is_saved_as_one_pdf(self):
        response = self.send("lph:attach:u1:cipc-registration-docs", gateway(attach={**SAVED, "pages": 3}))
        self.assertIn("(3 pages, as one PDF)", response.reply)

    def test_files_that_cannot_be_combined_are_explained(self):
        gw = FakeGateway(SME, {"upload_options": {"requirements": REQUIREMENTS},
                               "attach_upload": GatewayError("Lepharo gateway request failed (cannot_combine_files).")})
        self.assertIn("single PDF", self.send("lph:attach:u1:cipc-registration-docs", gw).reply)

    # -- a file sent just after one was filed
    def follow_gateway(self, append=None):
        return FakeGateway(SME, {
            "upload_options": {"requirements": REQUIREMENTS, "caption": "", "pages": 1, "follows": {"uploadId": "u0", "title": "Proof of Address"}},
            "append_upload": append if append is not None else {"applicationId": "app1", "documentId": "doc1", "title": "Proof of Address", "pages": 2},
            "attach_upload": SAVED,
        })

    def test_a_file_just_after_filing_asks_whether_it_is_another_page(self):
        response = self.send("lph:upload:u2:1", self.follow_gateway())
        self.assertIn("another page of the *Proof of Address*", response.reply)
        self.assertEqual([b.id for b in response.interactive.buttons], ["lph:addpage:u2", "lph:newdoc:u2"])
        self.assertEqual(response.conversation.awaiting, "upload_follow:u2")

    def test_add_as_a_page_appends_it_and_checks_again(self):
        gw = self.follow_gateway()
        response = self.send("lph:addpage:u2", gw)
        self.assertIn(("append_upload", {"uploadId": "u2"}), gw.calls)
        self.assertIn("now has 2 pages", response.reply)
        self.assertEqual(self.verified, [("app1", "doc1")])

    def test_different_document_goes_to_the_usual_question(self):
        response = self.send("lph:newdoc:u2", self.follow_gateway())
        self.assertIn("Which document is it?", response.reply)
        self.assertEqual(response.conversation.awaiting, "upload:u2")

    def test_typed_answers_to_the_page_question(self):
        gw = self.follow_gateway()
        self.send("add", gw, awaiting="upload_follow:u2")
        self.assertIn("append_upload", gw.actions())
        self.assertEqual(self.send("new", self.follow_gateway(), awaiting="upload_follow:u2").conversation.awaiting, "upload:u2")
        self.assertEqual(self.send("hmm", self.follow_gateway(), awaiting="upload_follow:u2").conversation.awaiting, "upload_follow:u2")

    def test_if_the_earlier_document_changed_the_file_is_filed_on_its_own(self):
        gw = self.follow_gateway(append=GatewayError("Lepharo gateway request failed (document_changed)."))
        response = self.send("lph:addpage:u2", gw)
        self.assertIn("Which document is it?", response.reply)


class UploadHelperTests(unittest.TestCase):
    def test_issue_dates(self):
        today = date(2026, 10, 29)
        self.assertEqual(parse_issue_date("2026-03-15", today), "2026-03-15")
        self.assertEqual(parse_issue_date("15/03/2026", today), "2026-03-15")
        self.assertEqual(parse_issue_date("15-03-2026", today), "2026-03-15")
        self.assertEqual(parse_issue_date("15 March 2026", today), "2026-03-15")
        self.assertEqual(parse_issue_date("3 sept 2025", today), "2025-09-03")
        self.assertIsNone(parse_issue_date("31/02/2026", today))
        self.assertIsNone(parse_issue_date("01/12/2026", today))  # future
        self.assertIsNone(parse_issue_date("last week", today))

    def test_requirement_names(self):
        self.assertEqual(match_requirement("my id copy", REQUIREMENTS + [
            {"key": "certified-id-copy", "title": "Certified ID Copy"}])["key"], "certified-id-copy")
        self.assertEqual(match_requirement("BBBEE affidavit", REQUIREMENTS)["key"], "b-bbee-certificate-affidavit")
        self.assertEqual(match_requirement("Proof of Address", REQUIREMENTS)["key"], "proof-of-address")
        self.assertEqual(match_requirement("2", REQUIREMENTS)["key"], "sars-tax-compliance-status-tcs-pin")
        self.assertIsNone(match_requirement("hello", REQUIREMENTS))
        self.assertIsNone(match_requirement("", REQUIREMENTS))


if __name__ == "__main__":
    unittest.main()
