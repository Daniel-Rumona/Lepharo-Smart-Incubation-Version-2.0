import json
import unittest
from datetime import datetime, timezone

from compliance_check import (
    add_months,
    assess_compliance_document,
    build_compliance_prompt,
    claim_daily_check,
    identity_check,
    parse_compliance_reply,
    review_note,
)

NOW = datetime(2026, 11, 1, tzinfo=timezone.utc)
BEE = {"title": "B-BBEE Certificate/Affidavit", "hasExpiry": True, "expiryMonths": 12}
NO_EXPIRY = {"title": "CIPC Registration Docs", "hasExpiry": False}


def reply(**overrides):
    body = {
        "legible": True,
        "matchesExpectedType": True,
        "reason": "A sworn B-BBEE affidavit for the company.",
        "issueDate": "2026-01-01",
        "expiryDate": None,
        "holderName": "Thabo Fresh Produce (Pty) Ltd",
        "registrationNumber": "2019/123456/07",
        "idNumber": None,
        "confidence": "high",
    }
    body.update(overrides)
    return json.dumps(body)


class ParseReplyTest(unittest.TestCase):
    def test_reads_fenced_json_and_dates(self):
        verdict = parse_compliance_reply("```json\n" + reply() + "\n```")
        self.assertTrue(verdict["legible"])
        self.assertEqual(verdict["extracted"]["issueDate"], "2026-01-01")
        self.assertEqual(verdict["extracted"]["registrationNumber"], "2019/123456/07")
        self.assertEqual(verdict["confidence"], "high")

    def test_rejects_unparseable_reply(self):
        self.assertIsNone(parse_compliance_reply("The document looks fine."))
        self.assertIsNone(parse_compliance_reply("[1, 2]"))

    def test_drops_dates_that_are_not_real_or_plausible(self):
        verdict = parse_compliance_reply(reply(issueDate="01/02/2026", expiryDate="2026-02-30"))
        self.assertIsNone(verdict["extracted"]["issueDate"])
        self.assertIsNone(verdict["extracted"]["expiryDate"])
        verdict = parse_compliance_reply(reply(issueDate="1850-01-01"))
        self.assertIsNone(verdict["extracted"]["issueDate"])

    def test_non_boolean_flags_are_false_and_unknown_confidence_is_low(self):
        verdict = parse_compliance_reply(reply(legible="yes", confidence="certain", holderName="null"))
        self.assertFalse(verdict["legible"])
        self.assertEqual(verdict["confidence"], "low")
        self.assertIsNone(verdict["extracted"]["holderName"])


class AssessTest(unittest.TestCase):
    def assess(self, raw, document=None, requirement=BEE, participant=None):
        return assess_compliance_document(parse_compliance_reply(raw), document or {}, requirement, participant, NOW)

    def test_valid_document_is_a_suggestion_with_its_expiry(self):
        review = self.assess(reply())
        self.assertEqual(review["recommendation"], "valid")
        self.assertEqual(review["expiresOn"], "2027-01-01")
        self.assertEqual(review["extracted"]["issueDate"], "2026-01-01")
        self.assertNotIn("idNumber", review["extracted"])

    def test_recorded_issue_date_wins_over_the_reading(self):
        review = self.assess(reply(issueDate="2026-06-01"), document={"issueDate": "2025-01-01"})
        self.assertEqual(review["recommendation"], "expired")
        self.assertEqual(review["expiresOn"], "2026-01-01")

    def test_read_expiry_date_applies_when_requirement_has_no_period(self):
        review = self.assess(reply(issueDate=None, expiryDate="2026-03-31"), requirement=NO_EXPIRY)
        self.assertEqual(review["recommendation"], "expired")

    def test_wrong_document_and_illegible_document(self):
        self.assertEqual(self.assess(reply(matchesExpectedType=False))["recommendation"], "invalid")
        self.assertEqual(self.assess(reply(legible=False))["recommendation"], "unclear")

    def test_unreadable_reply_is_unclear(self):
        review = assess_compliance_document(None, {}, BEE, None, NOW)
        self.assertEqual(review["recommendation"], "unclear")
        self.assertIn("could not be checked", review_note(review))

    def test_registration_number_mismatch_is_flagged(self):
        review = self.assess(reply(), participant={"registrationNumber": "2020/999999/07"})
        self.assertEqual(review["identity"], "mismatch")
        self.assertIn("does not match", review["reason"])
        self.assertEqual(review["recommendation"], "valid")


class HelpersTest(unittest.TestCase):
    def test_identity_compares_digits_only(self):
        self.assertEqual(identity_check({"registrationNumber": "2019/123456/07"}, {"registrationNumber": "2019 123456 07"}), "match")
        self.assertEqual(identity_check({"registrationNumber": None}, {"registrationNumber": "1"}), "unknown")
        self.assertEqual(identity_check({"registrationNumber": "1"}, {}), "unknown")

    def test_add_months_clamps_to_month_end(self):
        self.assertEqual(add_months(datetime(2026, 1, 31), 1), datetime(2026, 2, 28))
        self.assertEqual(add_months(datetime(2025, 12, 31), 3), datetime(2026, 3, 31))

    def test_prompt_names_the_document_and_the_fields(self):
        prompt = build_compliance_prompt("Certified ID Copy")
        self.assertIn('"Certified ID Copy"', prompt)
        for field in ("issueDate", "expiryDate", "registrationNumber", "confidence"):
            self.assertIn(field, prompt)


class DailyCheckTest(unittest.TestCase):
    def test_counts_up_to_the_limit(self):
        state, left = claim_daily_check(None, "2026-11-01", 3)
        self.assertEqual(state, {"date": "2026-11-01", "count": 1})
        self.assertEqual(left, 2)
        state, left = claim_daily_check({"date": "2026-11-01", "count": 2}, "2026-11-01", 3)
        self.assertEqual((state["count"], left), (3, 0))

    def test_refuses_once_the_limit_is_used(self):
        self.assertEqual(claim_daily_check({"date": "2026-11-01", "count": 3}, "2026-11-01", 3), (None, 0))

    def test_restarts_each_day(self):
        state, left = claim_daily_check({"date": "2026-10-31", "count": 3}, "2026-11-01", 3)
        self.assertEqual((state["count"], left), (1, 2))


if __name__ == "__main__":
    unittest.main()
