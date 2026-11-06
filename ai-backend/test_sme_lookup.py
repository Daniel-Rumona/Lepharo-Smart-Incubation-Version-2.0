import unittest

from sme_lookup import match_named_smes, named_sme_records

SMES = [
    {"id": "dante", "programId": "srmcdt", "names": ["Dante Welch", "Zungu Trading"]},
    {"id": "rms", "programId": "srmcdt", "names": ["Rustenburg Mining Services"]},
    {"id": "test", "programId": "other", "names": ["Test Inc (Pty) Ltd"]},
    {"id": "hv", "programId": "other", "names": ["Highveld"]},
    {"id": "hvm", "programId": "other", "names": ["Highveld Metal Works"]},
]


class MatchTests(unittest.TestCase):
    def ids(self, question):
        return [sme["id"] for sme in match_named_smes(question, SMES)]

    def test_company_or_person_name_finds_the_sme(self):
        self.assertEqual(self.ids("what about zungu trading"), ["dante"])
        self.assertEqual(self.ids("Tell me about Dante Welch"), ["dante"])

    def test_company_endings_can_be_left_off(self):
        self.assertEqual(self.ids("how is Test Inc doing?"), ["test"])

    def test_a_name_inside_a_longer_one_is_the_same_mention(self):
        self.assertEqual(self.ids("Highveld Metal Works revenue"), ["hvm"])

    def test_whole_words_only_and_nothing_named(self):
        self.assertEqual(self.ids("how many interventions are active"), [])
        self.assertEqual(self.ids("the dantewelch account"), [])


class RecordTests(unittest.TestCase):
    def test_only_smes_the_person_may_see_are_fetched(self):
        fetched = []
        fetchers = {"profile": lambda pid: fetched.append(pid) or {"id": pid}}
        self.assertEqual(named_sme_records("Test Inc and Zungu Trading", SMES, ["srmcdt"], fetchers)[0]["participantId"], "dante")
        self.assertEqual(fetched, ["dante"])
        self.assertEqual(len(named_sme_records("Test Inc and Zungu Trading", SMES, None, fetchers)), 2)

    def test_one_failing_part_keeps_the_rest(self):
        def broken(_):
            raise RuntimeError("down")
        record = named_sme_records("Zungu Trading", SMES, None, {"profile": lambda pid: {"id": pid}, "risk": broken})[0]
        self.assertEqual(record["profile"], {"id": "dante"})
        self.assertEqual(record["risk"], {"error": "RuntimeError"})


if __name__ == "__main__":
    unittest.main()
