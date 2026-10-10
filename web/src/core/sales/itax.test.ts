import { itaxFlags, ITAX_LIMIT } from "./itax";

const bill = (over: Partial<Parameters<typeof itaxFlags>[0]> = {}, customer: Partial<Parameters<typeof itaxFlags>[0]["customer"]> = {}) => ({
  status: "active" as const, payment_mode: "bank" as const, total: 10000000,
  ...over,
  customer: { name: "Lalit Jain", type: "person" as const, pan: "", gst_number: "", address: "12 Station Road", ...customer },
});

test("cash at or over ₹2,00,000 is flagged (Sec 269ST), with the total in words the server uses", () => {
  expect(itaxFlags(bill({ payment_mode: "cash", total: 26574048 }, { pan: "AAKFS4821M" }))).toEqual([
    { kind: "cash_limit", short: "Cash ≥ ₹2 lakh", text: "₹2,65,740.48 taken in cash is at or over the ₹2,00,000 limit for one bill (Income Tax Sec 269ST)." },
  ]);
  expect(itaxFlags(bill({ payment_mode: "cash", total: ITAX_LIMIT }, { pan: "AAKFS4821M" }))).toHaveLength(1);
  expect(itaxFlags(bill({ payment_mode: "mixed", total: 30000000 }, { pan: "AAKFS4821M" }))).toEqual([]);
});

test("over ₹2,00,000 without a PAN asks for it (Rule 114B); exactly ₹2,00,000 doesn't", () => {
  expect(itaxFlags(bill({ total: ITAX_LIMIT + 1 }))).toEqual([
    { kind: "pan", short: "PAN missing", text: "A bill over ₹2,00,000 needs the buyer's PAN (Rule 114B). Add Lalit Jain's PAN." },
  ]);
  expect(itaxFlags(bill({ total: ITAX_LIMIT }))).toEqual([]);
});

test("a walk-in over ₹2,00,000 says to put the bill in the buyer's name", () => {
  expect(itaxFlags(bill({ total: 25000000 }, { name: "Walk-in Customer", type: "walkin" }))).toEqual([
    { kind: "walkin_limit", short: "Walk-in over ₹2 lakh", text: "A bill over ₹2,00,000 needs the buyer's PAN (Rule 114B). Put the bill in the buyer's name, with their PAN, not Walk-in." },
  ]);
});

test("a business without an address is flagged (CGST Rule 46); a cancelled bill carries nothing", () => {
  expect(itaxFlags(bill({}, { type: "business", gst_number: "08ABCPK1234F1Z5", address: "  " }))).toEqual([
    { kind: "b2b_address", short: "No address", text: "A bill to a business needs the buyer's address (CGST Rule 46). Add it on the customer." },
  ]);
  expect(itaxFlags(bill({ status: "cancelled", payment_mode: "cash", total: 30000000 }, { gst_number: "08ABCPK1234F1Z5", address: "" }))).toEqual([]);
});

test("the address check counts a GSTIN as the server does: one failing only its check character counts, a short one doesn't", () => {
  const kinds = (gst_number: string) => itaxFlags(bill({}, { type: "business", gst_number, address: "" })).map((f) => f.kind);
  expect(kinds("08AAKFS4821M1Z5")).toEqual(["b2b_address"]);
  expect(kinds("08AAKFS4821M1Z")).toEqual([]);
});
