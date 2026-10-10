import { wireDetail, wireRow } from "./fixtures";
import { toBillDetail, toBillRow, toBinPage, toNumberCheck, toPaperBook, toSalesPage, toShopSettings } from "./wire";

test("the contract's bill reads whole: money in paise, quantities and rates as stored, the firm as frozen on the bill", () => {
  expect(toBillDetail(wireDetail())).toEqual({
    id: 412, business: 3, business_name: "KIRAN GOLD HOUSE", invoice_number: "KGH/2026-27/31", counter: 31, fy: "2026-27",
    invoice_date: "2026-10-08", created_at: "2026-10-08T10:42:05.123456+05:30", paper: false,
    customer: {
      id: 7, name: "Anil Gupta", gst_number: "", mobile_number: "9829041122", type: "person", address: "15 Demo Road, Rajasthan", city: "Udaipur",
      state_name: "RAJASTHAN", state_code: "08", gstin_valid: null, pan_number: "", pan: "", email: "",
    },
    payment_mode: "cash", taxable: 8454681, cgst: 126820, sgst: 126820, igst: 0, tax: 253640, total_amount: 8708321,
    interstate: false, gst_percents: ["3"], line_count: 2, status: "active", cancel_reason: "", sent: null, checks: [], itax: [], locked: false,
    place_of_supply: "08", place_of_supply_name: "RAJASTHAN", place_of_supply_chosen: null, segment: "b2cs", notes: "",
    replaces: null, replaced_by: null, cancelled_at: null, cancelled_by: null,
    firm: {
      name: "KIRAN GOLD HOUSE", address: "12 Sandbox Bazaar, Jaipur, Rajasthan", gst_number: "08ABCPK1234F1Z5", state_name: "RAJASTHAN", state_code: "08",
      pan_number: "ABCPK1234F", mobile_number: "9000000003", email: "firm3@example.com", bank_name: "Sandbox Bank", bank_account_number: "000000000003",
      bank_ifsc_code: "SBOX0000003", bank_branch_name: "Jaipur", invoice_prefix: "KGH", signature_url: null, frozen: true,
    },
    lines: [
      { id: 901, product_name: "Gold Ring 22K", hsn_code: "711319", quantity: "12.345", unit: "gms", rate: "6512.500", gst_percent: "3",
        taxable: 8039681, cgst: 120595, sgst: 120595, igst: 0, tax: 241190, amount: 8280871, note: "" },
      { id: 902, product_name: "Gold Pendant 22K", hsn_code: "711319", quantity: "1.000", unit: "pcs", rate: "4150.000", gst_percent: "3",
        taxable: 415000, cgst: 6225, sgst: 6225, igst: 0, tax: 12450, amount: 427450, note: "Peacock design" },
    ],
    slabs: [{ gst_percent: "3", taxable: 8454681, cgst: 126820, sgst: 126820, igst: 0, tax: 253640 }],
    hsn_summary: [
      { hsn_code: "711319", gst_percent: "3", unit: "gms", quantity: "12.345", taxable: 8039681, cgst: 120595, sgst: 120595, igst: 0, tax: 241190 },
      { hsn_code: "711319", gst_percent: "3", unit: "pcs", quantity: "1.000", taxable: 415000, cgst: 6225, sgst: 6225, igst: 0, tax: 12450 },
    ],
    total_in_words: "Eighty Seven Thousand Eighty Three Rupees and Twenty One Paise Only",
    tax_in_words: "Two Thousand Five Hundred Thirty Six Rupees and Forty Paise Only",
    eway: { eway_bill_number: "", transporter_name: "", transporter_gstin: "", vehicle_number: "", vehicle_type: "Regular", transport_mode: "Road", distance_km: null, may_be_needed: false },
    duplicates: [],
    history: { created_by: { id: 2, name: "Rakesh Soni" }, activity: [{ at: "2026-10-08T10:42:05+05:30", by: "Rakesh Soni", action: "created", details: "Anil Gupta · ₹87,083.21" }] },
  });
});

test("nothing is rounded to the rupee: the total and its words stay exact, whatever an older server adds (Ruling 1B-12)", () => {
  const exact = toBillDetail(wireDetail());
  expect(toBillDetail(wireDetail({ payable: "87083.00", round_off: "-0.21", payable_in_words: "Eighty Seven Thousand Eighty Three Rupees Only" }))).toEqual(exact);
  // words the server left out are the exact figures' own, paise and all
  expect(toBillDetail(wireDetail({ total_in_words: "", tax_in_words: null }))).toEqual(exact);
});

test("an income-tax flag or a check this app doesn't know yet is left out, never shown as another (Ruling 1B-11)", () => {
  const cash = { kind: "cash_limit", short: "Cash ≥ ₹2 lakh", text: "₹2,65,740.48 taken in cash is at or over the ₹2,00,000 limit for one bill (Income Tax Sec 269ST)." };
  const row = toBillRow(wireRow({ itax: [cash, { kind: "tcs", short: "TCS due", text: "A check this app doesn't know." }, null], checks: ["no_hsn", "rate_drift"] }));
  expect(row.itax).toEqual([cash]);
  expect(row.checks).toEqual(["no_hsn"]);
});

test("a bill's history keeps every action the contract lists, v2's Excel import as its own (Ruling 1B-13); one this app doesn't know reads as an edit", () => {
  const ACTIONS = ["created", "imported", "updated", "cancelled", "renumbered", "moved", "deleted", "restored", "sent", "printed", "exported", "merged"];
  const read = (action: string) => toBillDetail(wireDetail({
    history: { created_by: null, activity: [{ at: "2026-09-02T11:20:00+05:30", by: "Kailash Mehta", action, details: "Imported from Excel (2 items, total: 45210.00)" }] },
  })).history.activity[0].action;
  expect(ACTIONS.map(read)).toEqual(ACTIONS);
  expect(read("rescued")).toBe("updated");
});

test("an answer with fields left out reads as empty, never a crash", () => {
  expect(toBillDetail(undefined)).toMatchObject({
    id: 0, invoice_number: "", counter: null, total_amount: 0, payment_mode: "", status: "active", sent: null, itax: [],
    customer: { name: "", type: "person", gstin_valid: null }, firm: { name: "", signature_url: null, frozen: false }, lines: [], replaces: null,
    eway: { vehicle_type: "Regular", transport_mode: "Road", distance_km: null }, history: { created_by: null, activity: [] }, total_in_words: "Zero Rupees Only",
  });
  expect(toSalesPage({})).toEqual({
    count: 0, next: null, previous: null, results: [], facets: null,
    summary: { of: "active", bills: 0, taxable: 0, cgst: 0, sgst: 0, igst: 0, tax: 0, total_amount: 0, average: null, cancelled: 0 },
  });
  expect(toBinPage(null)).toEqual({ count: 0, next: null, previous: null, results: [] });
  expect(toShopSettings(undefined)).toEqual({ copies: "original", show_bank: true, share_message: "", updated_at: null, updated_by: null });
  expect(toNumberCheck({})).toEqual({ invoice_number: "", counter: null, code: "", problem: "", bill: null, binned: null, note: "", same_counter: null, next: { counter: 0, invoice_number: "" } });
});

test("the paper book's month reads as the contract sends it, its money in paise", () => {
  const book = toPaperBook({
    business: 3, month: "2026-09", fy: "2026-27",
    bills: [{ id: 388, invoice_number: "KGH/2026-27/17", counter: 17, invoice_date: "2026-09-02", customer_name: "Hemant Dave", total_amount: "45210.00", status: "active", paper: true, sent: false }],
    entered: 14, runs: [[17, 29], [34, 36]], missing: [31, 32],
    explained: [
      { counter: 19, kind: "cancelled", id: 205, invoice_number: "KGH/2026-27/19", reason: "Customer returned the piece the same day" },
      { counter: 27, kind: "deleted", bin_id: 4, invoice_number: "KGH/2026-27/27", reason: "Entered twice by mistake", deleted_at: "2026-10-03T18:40:00+05:30" },
    ],
    twice: [22], after: [30, 31, 32, 33], after_months: ["2026-10"],
    next: { counter: 34, invoice_number: "KGH/2026-27/34", invoice_date: "2026-09-30" }, locked: false, gstr1_due: "2026-10-11",
  });
  expect(book).toEqual({
    business: 3, month: "2026-09", fy: "2026-27",
    bills: [{ id: 388, invoice_number: "KGH/2026-27/17", counter: 17, invoice_date: "2026-09-02", customer_name: "Hemant Dave", total_amount: 4521000, status: "active", paper: true, sent: false }],
    entered: 14, runs: [[17, 29], [34, 36]], missing: [31, 32],
    explained: [
      { counter: 19, kind: "cancelled", id: 205, invoice_number: "KGH/2026-27/19", reason: "Customer returned the piece the same day" },
      { counter: 27, kind: "deleted", bin_id: 4, invoice_number: "KGH/2026-27/27", reason: "Entered twice by mistake", deleted_at: "2026-10-03T18:40:00+05:30" },
    ],
    twice: [22], after: [30, 31, 32, 33], after_months: ["2026-10"],
    next: { counter: 34, invoice_number: "KGH/2026-27/34", invoice_date: "2026-09-30" }, locked: false, gstr1_due: "2026-10-11",
  });
});
