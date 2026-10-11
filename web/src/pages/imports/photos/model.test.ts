import { describe, expect, it } from "vitest";
import { bodyFor, detect, fileProblem, localProblems, statusOf, totalOf } from "./model";
import { read, row, firms } from "./fixtures";
const may = { purchases: true, sales: true };
describe("bill-photo model", () => {
  it("detects a purchase, a sale, a linked pair and an unknown firm from contract fields", () => {
    expect(detect(read)).toEqual({ kind: "purchase", firmId: 3, buyerFirmId: null });
    expect(detect({ ...read, seller_business: 2 })).toEqual({ kind: "interfirm", firmId: 2, buyerFirmId: 3 });
    expect(detect({ ...read, seller_business: 2, buyer: { ...read.buyer, business: null } })).toEqual({ kind: "sale", firmId: 2, buyerFirmId: null });
    expect(detect({ ...read, buyer: { ...read.buyer, business: null } }).firmId).toBeNull();
  });
  it("keeps amount-only lines and the 0.25% slab verbatim, without a float total", () => {
    const r = row({ read: { ...read, lines: [{ ...read.lines[0], quantity: null, rate: null, taxable: "100.00", amount_only: true, gst_percent: "0.25" }] } });
    expect(totalOf(r)).toBe(10025);
    expect(bodyFor([r], "purchases", firms).bills[0].lines[0]).toEqual({ product_name: "Gold bullion 995", hsn_code: "7108", gst_percent: "0.25", unit: "gms", taxable: "100.00", amount_only: true, note: "" });
  });
  it("puts a pair only in purchases/import and never makes a separate sale request", () => {
    const r = row({ kind: "interfirm", firmId: 2, buyerFirmId: 3 });
    const body = bodyFor([r], "purchases", firms);
    expect(body.file_name).toBe(""); expect(body.dry_run).toBe(true);
    expect(body.bills[0]).toMatchObject({ business: 3, pair: { seller: 2, invoice_number: read.invoice_number } });
    expect(bodyFor([r], "sales", firms).bills).toEqual([]);
  });
  it("blocks sales and pairs for the accountant, missing firm, missing slab and an unknown unregistered party", () => {
    expect(statusOf(row({ kind: "sale" }), { purchases: true, sales: false }, firms)).toBe("Not for your role");
    expect(statusOf(row({ kind: "interfirm", buyerFirmId: 2 }), { purchases: true, sales: false }, firms)).toBe("Not for your role");
    expect(statusOf(row({ firmId: null }), may, firms)).toBe("Needs a firm");
    expect(statusOf(row({ read: { ...read, lines: [{ ...read.lines[0], gst_percent: null }] } }), may, firms)).toBe("Fix before import");
    expect(statusOf(row({ partyId: null, read: { ...read, supplier: { ...read.supplier, id: null, gst_number: "" } } }), may, firms)).toBe("Needs a supplier");
  });
  it("keeps the server's duplicate and field refusals beside their row", () => {
    expect(statusOf(row({ duplicate: { id: 4, invoice_number: "UBS/26-27/0866" } }), may, firms)).toBe("Already entered");
    expect(localProblems(row({ problems: [{ field: "itc_month", detail: "Choose an open credit month." }] }), may, firms)).toContain("Choose an open credit month.");
  });
  it("sends acknowledged billed-to and credit choices and no review/capture overrides", () => {
    const bill = bodyFor([row({ buyerAck: true, itcEligible: false, itcMonth: "2026-11" })], "purchases", firms).bills[0];
    expect(bill).toMatchObject({ buyer_ack: true, itc_eligible: false, itc_month: "2026-11" });
    for (const k of ["capture", "duplicate_ok", "needs_review"]) expect(bill).not.toHaveProperty(k);
  });
  it("keeps pre-ledger bills outside credit and refuses a chosen month below April 2025", () => {
    const before = row({ read: { ...read, invoice_date: "2025-03-31" }, itcMonth: "2025-04" });
    expect(bodyFor([before], "purchases", firms).bills[0].itc_month).toBeNull();
    expect(localProblems(row({ itcMonth: "2025-03" }), may, firms)).toContain("The credit ledger starts in April 2025. Pick April 2025 or later.");
  });
  it.each([null, ""])("blocks an unread date (%s) until corrected, keeping the paper's rates", (invoice_date) => {
    const original = row({ read: { ...read, invoice_date } });
    expect(statusOf(original, may, firms)).toBe("Fix before import");
    expect(localProblems(original, may, firms)).toContain("Type the date printed on the bill, like 08 Oct 2026.");
    expect(() => bodyFor([original], "purchases", firms)).toThrow("Type the date printed on the bill, like 08 Oct 2026.");
    const corrected = { ...original, read: { ...original.read!, invoice_date: "2026-10-07" } };
    expect(statusOf(corrected, may, firms)).toBe("Ready");
    const bill = bodyFor([corrected], "purchases", firms).bills[0];
    expect(bill.invoice_date).toBe("2026-10-07");
    expect(bill.lines[0]).toMatchObject({ rate: "6878.000", quantity: "42.180", gst_percent: "3" });
    expect(original.read!.invoice_date).toBe(invoice_date);
  });
  it("rounds each 0.025 line half-up before summing the bill's paise", () => {
    const line = { ...read.lines[0], quantity: "1", rate: "0.025", taxable: "0.025", gst_percent: "0" };
    expect(totalOf(row({ read: { ...read, lines: [line, line] } }))).toBe(6);
    expect(totalOf(row({ read: { ...read, lines: [{ ...line, amount_only: true }, { ...line, amount_only: true }] } }))).toBe(6);
  });
  it("validates every upload path and keeps server-sized files bounded", () => {
    expect(fileProblem(new File(["text"], "bill.txt", { type: "text/plain" }))).toBe("bill.txt: Choose a photo (JPEG, PNG or HEIC) or a PDF.");
    const big = new File(["synthetic"], "large.pdf", { type: "application/pdf" }); Object.defineProperty(big, "size", { value: 21 * 1024 * 1024 });
    expect(fileProblem(big)).toBe("large.pdf is 21.0 MB. The most is 20 MB.");
    expect(fileProblem(new File(["synthetic"], "bill.heic", { type: "" }))).toBeNull();
  });
});
it("explains a supplier's GST refusal and the actual off-slab printed rate", () => {
  expect(localProblems(row({ read: { ...read, supplier: { ...read.supplier, gst_number: "" } } }), may, firms)).toContain("Line 1: the supplier has no GSTIN, so this purchase carries no input tax credit. Add the supplier's GSTIN to claim GST, or set the line to 0%.");
  expect(localProblems(row({ read: { ...read, lines: [{ ...read.lines[0], gst_percent: null, printed_rate: "2.5%" }] } }), may, firms).join(" ")).toContain("The bill shows 2.5%, which isn't a GST rate.");
});
