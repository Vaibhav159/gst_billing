"""M16: the server and the browser place tax the same way, by one fixture.

taxRules.ts compared raw state names whenever either GSTIN was missing, while
the server resolved each side to a state code (GSTIN first, then the name).
A firm with a GSTIN and a stale state name, a party with a GSTIN and no state,
and "JAMMU & KASHMIR" against "JAMMU AND KASHMIR" all came out differently, so
previews, confirm sheets and import review showed heads the server then
re-filed. src/utils/taxPlacementParity.test.ts reads the same file.
"""

import json
from pathlib import Path
from types import SimpleNamespace

from django.test import SimpleTestCase

from billing.constants import GST_CODE
from billing.tax_rules import is_interstate, state_code

FIXTURE = Path(__file__).resolve().parents[2] / "sweet-rebuild-suite-main" / "src" / "test" / "fixtures" / "tax-placement.json"
CASES = json.loads(FIXTURE.read_text())


def _party(side):
    return SimpleNamespace(gst_number=side["gstin"], state_name=side["state"])


class TaxPlacementParityTest(SimpleTestCase):
    def test_every_state_name_resolves_to_its_code(self):
        for row in CASES["state_names"]:
            with self.subTest(name=row["name"]):
                self.assertEqual(state_code(SimpleNamespace(gst_number="", state_name=row["name"])), row["code"])

    def test_every_placement(self):
        for case in CASES["placements"]:
            with self.subTest(case=case["case"]):
                self.assertEqual(is_interstate(_party(case["firm"]), _party(case["party"])), case["interstate"])

    def test_the_servers_own_state_table_is_in_the_fixture(self):
        listed = {(r["name"], r["code"]) for r in CASES["state_names"]}
        for code, name in GST_CODE.items():
            with self.subTest(name=name):
                self.assertIn((name, code), listed)
