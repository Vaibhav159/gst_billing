/**
 * M16: the browser and the server place tax the same way, by one fixture.
 * billing/tests/test_tax_placement_parity.py reads the same file.
 */
import { describe, expect, it } from "vitest";
import cases from "@/test/fixtures/tax-placement.json";
import { isIntraState, STATE_CODES, stateCodeOf } from "./taxRules";

describe("tax placement parity with billing/tax_rules.py (M16)", () => {
  it.each(cases.state_names)("state name $name resolves to '$code'", ({ name, code }) => {
    expect(stateCodeOf("", name)).toBe(code);
  });

  it.each(cases.placements)("$case", ({ firm, party, interstate }) => {
    expect(isIntraState(party.gstin, firm.gstin, party.state, firm.state)).toBe(!interstate);
  });

  it("lists every name in the browser's own state table", () => {
    const listed = new Set(cases.state_names.map((r) => `${r.name}|${r.code}`));
    for (const [code, name] of Object.entries(STATE_CODES)) expect(listed).toContain(`${name}|${code}`);
  });
});
