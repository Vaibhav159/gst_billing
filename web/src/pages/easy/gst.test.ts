import { describe, expect, test, vi } from "vitest";
import { easyGst, gstShareText, groupBlockers, shareGst } from "./gst";
import { gstFixture } from "./gst.fixture";
export const month = gstFixture();
describe("the Easy projection of part 3's answer", () => {
  test("keeps stage, dates, server money and missing-opening working", () => {
    const result = easyGst(month);
    expect(result).toMatchObject({ business: 3, stage: "blocked", output: 1037876, cash: 212000, credit: 0, openingMissing: true, filed: { gstr1: null, gstr3b: null } });
    expect(result.blockers[0]).toMatchObject({ words: month.checks.blockers[0].text, more_bills: 12, bills: [{ total: 4521000 }] });
    expect(month.checks.blockers[0].bills[0]).not.toHaveProperty("total");
  });
  test("preserves filed dates and legacy without inventing a filing date", () => {
    expect(easyGst({ ...month, stage: "filed", record: { ...month.record, gstr1: gstFixture("gstr1").record.gstr1, gstr3b: gstFixture("filed").record.gstr3b, legacy: false } }).filed).toEqual({ gstr1: "2026-10-10", gstr3b: "2026-10-19" });
    expect(easyGst({ ...month, stage: "filed", record: { ...month.record, gstr1: null, gstr3b: null, legacy: true } })).toMatchObject({ legacy: true, filed: { gstr1: null, gstr3b: null } });
  });
  test.each(["future", "open", "blocked", "ready", "gstr1", "filed", "unlocked"] as const)("does not turn %s into ready", (stage) => {
    expect(easyGst({ ...month, stage, gstr3b: stage === "future" ? null : month.gstr3b }).stage).toBe(stage);
  });
  test("future has unknown amounts, never fabricated zero", () => {
    expect(easyGst({ ...month, stage: "future", checks: { blockers: [], notes: [], passes: [] }, gstr3b: null })).toMatchObject({ output: null, cash: null, credit: null, blockers: [] });
  });
  test("groups other kinds, deduplicates visible bills and preserves each overflow", () => {
    const first = month.checks.blockers[0];
    const groups = groupBlockers(easyGst({ ...month, checks: { ...month.checks, blockers: [first, { ...first, text: "Bill number OTHER/19 is used twice" }, { ...first, kind: "hsn", more_bills: 1 }, { ...first, kind: "hsn", more_bills: 2 }, { ...first, kind: "badgstin", text: "Correct the GSTIN on the customer.", more_bills: 0 }] } }).blockers);
    expect(groups).toHaveLength(4);
    expect(groups[2].bills).toHaveLength(1);
    expect(groups[2].more).toBe(3);
    expect(groups[3].words).toEqual(["Correct the GSTIN on the customer."]);
  });
  test("share contains exact money, both due dates and this month; opening caveat travels", () => {
    expect(gstShareText("KIRAN GOLD HOUSE", easyGst(month), { month: "2026-10", tax: 880071, bills: 3 })).toBe("KIRAN GOLD HOUSE\nSeptember 2026: GST on sales ₹10,378.76; left to pay in cash ₹2,120.00.\nGSTR-1 due 11 Oct 2026; GSTR-3B due 20 Oct 2026.\nOctober 2026 so far: GST on sales ₹8,800.71 · 3 bills.\nThe opening credit isn't typed yet, so the credit carried in may be too low.");
  });
});
describe("sharing GST text", () => {
  test("native share has no recipient and sends no request", async () => {
    const share = vi.fn().mockResolvedValue(undefined), open = vi.fn();
    await expect(shareGst("figures", { share, open })).resolves.toBe("shared");
    expect(share).toHaveBeenCalledWith({ text: "figures" }); expect(open).not.toHaveBeenCalled();
  });
  test("cancelling the sheet does not open WhatsApp", async () => {
    const open = vi.fn();
    await expect(shareGst("figures", { share: vi.fn().mockRejectedValue(new DOMException("Cancelled", "AbortError")), open })).resolves.toBe("cancelled");
    expect(open).not.toHaveBeenCalled();
  });
  test("unsupported share uses an empty-recipient WhatsApp link; blocked window is an error", async () => {
    const open = vi.fn().mockReturnValue({});
    await expect(shareGst("₹1.00", { open })).resolves.toBe("opened");
    expect(open).toHaveBeenCalledWith("https://wa.me/?text=%E2%82%B91.00", "_blank");
    await expect(shareGst("figures", { open: () => null })).rejects.toThrow("The browser stopped WhatsApp from opening. Allow pop-ups, then try again.");
  });
  test("a rejected native share stays an error; no misleading shared toast", async () => {
    const open = vi.fn();
    await expect(shareGst("figures", { share: vi.fn().mockRejectedValue(new Error("failed")), open })).rejects.toThrow("The share sheet couldn't open. Try again.");
    expect(open).not.toHaveBeenCalled();
  });
});
