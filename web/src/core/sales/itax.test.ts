import { B2C_ADDRESS_LIMIT, itaxFlags, ITAX_LIMIT, readItaxFlags, type ItaxInput } from "./itax";

const bill = (over: Partial<ItaxInput> = {}, customer: Partial<ItaxInput["customer"]> = {}): ItaxInput => ({
  status: "active" as const, payment_mode: "bank" as const, total: 10000000, taxable: 1000000,
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

test("a walk-in over ₹2,00,000 says to put the bill in the buyer's name; exactly ₹2,00,000 doesn't", () => {
  expect(itaxFlags(bill({ total: 25000000 }, { name: "Walk-in Customer", type: "walkin" }))).toEqual([
    { kind: "walkin_limit", short: "Walk-in over ₹2 lakh", text: "A bill over ₹2,00,000 needs the buyer's PAN (Rule 114B). Put the bill in the buyer's name, with their PAN, not Walk-in." },
  ]);
  expect(itaxFlags(bill({ total: ITAX_LIMIT }, { name: "Walk-in Customer", type: "walkin" }))).toEqual([]);
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

const namedAddress = { kind: "b2c_address", short: "Name and address needed", text: "A bill of ₹50,000 or more to a buyer without a GSTIN needs the buyer's address (CGST Rule 46(f)). Add Lalit Jain's address." };
const walkinAddress = { kind: "b2c_address", short: "Name and address needed", text: "A bill of ₹50,000 or more to a buyer without a GSTIN needs the buyer's name and address (CGST Rule 46(f)). Put the bill in the buyer's name, with their address, not Walk-in." };

test("Rule 46(f) uses taxable value: ₹49,999.99 does not flag, ₹50,000.00 does, even when both totals exceed ₹50,000", () => {
  expect(B2C_ADDRESS_LIMIT).toBe(5000000);
  expect(itaxFlags(bill({ taxable: 4999999, total: 5150000 }, { address: "" }))).toEqual([]);
  expect(itaxFlags(bill({ taxable: 5000000, total: 5150000 }, { address: "" }))).toEqual([namedAddress]);
});

test.each(["", "  \t "])("an unregistered named buyer with address %j gets the exact address text", (address) => {
  expect(itaxFlags(bill({ taxable: 5000000 }, { address }))).toEqual([namedAddress]);
});

test("the walk-in needs a name and address, including when the shared walk-in record has an address", () => {
  for (const address of ["", "Counter address"]) {
    expect(itaxFlags(bill({ taxable: 5000000 }, { type: "walkin", address }))).toEqual([walkinAddress]);
  }
});

test("a named buyer with an address and a GSTIN buyer do not get the B2C address flag", () => {
  expect(itaxFlags(bill({ taxable: 5000000 }))).toEqual([]);
  expect(itaxFlags(bill({ taxable: 5000000 }, { gst_number: "08AAKFS4821M1ZQ", address: "" })).map((f) => f.kind)).toEqual(["b2b_address"]);
  expect(itaxFlags(bill({ taxable: 5000000 }, { gst_number: "08AAKFS4821M1Z5", address: "" })).map((f) => f.kind)).toEqual(["b2b_address"]);
});

test.each(["URP", "08AAKFS4821M1Z"])("%s does not count as a GSTIN for Rule 46(f)", (gst_number) => {
  expect(itaxFlags(bill({ taxable: 5000000 }, { gst_number, address: "" }))).toEqual([namedAddress]);
});

test("Rule 46(f) follows the shared possessive rule for names ending in s", () => {
  expect(itaxFlags(bill({ taxable: 5000000 }, { name: "Kulkarni Jewellers", address: "" }))).toEqual([
    { ...namedAddress, text: "A bill of ₹50,000 or more to a buyer without a GSTIN needs the buyer's address (CGST Rule 46(f)). Add Kulkarni Jewellers' address." },
  ]);
});

test("cancelled walk-in and unregistered bills carry no flags", () => {
  for (const type of ["person", "walkin"] as const) {
    expect(itaxFlags(bill({ status: "cancelled", taxable: 5000000, total: 30000000, payment_mode: "cash" }, { type, address: "" }))).toEqual([]);
  }
});

test("server flags retain b2c_address, including its exact words", () => {
  expect(readItaxFlags([namedAddress, walkinAddress, { kind: "future", short: "Later", text: "" }])).toEqual([namedAddress, walkinAddress]);
});
