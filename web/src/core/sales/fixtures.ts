// Test data shaped exactly as the API contract's examples (v3/2026-10-10-part-1-api-contract.md §0.2), and a fake
// server for sales tests: it answers by method and path, records each call, and refuses with a status and a body.
// Only tests import this file (plans 1C to 1E's tests too).
import { paiseToDecimal, toPaise } from "@/core/format";
import { serveWith } from "@/test/server";

type Wire = Record<string, unknown>;

export const FIRM = { id: 3, name: "KIRAN GOLD HOUSE", gst_number: "08ABCPK1234F1Z5", state_name: "RAJASTHAN" };
export const OTHER_FIRM = { id: 2, name: "MEERA ORNAMENTS", gst_number: "08AAKFS4821M1ZQ", state_name: "RAJASTHAN" };

/** The contract's bill, line by line: a 22K ring and a pendant at 3%, Rajasthan to Rajasthan. */
export const WIRE_LINES = [
  { id: 901, product_name: "Gold Ring 22K", hsn_code: "711319", quantity: "12.345", unit: "gms", rate: "6512.500", gst_percent: "3",
    taxable: "80396.81", cgst: "1205.95", sgst: "1205.95", igst: "0.00", tax: "2411.90", amount: "82808.71", note: "" },
  { id: 902, product_name: "Gold Pendant 22K", hsn_code: "711319", quantity: "1.000", unit: "pcs", rate: "4150.000", gst_percent: "3",
    taxable: "4150.00", cgst: "62.25", sgst: "62.25", igst: "0.00", tax: "124.50", amount: "4274.50", note: "Peacock design" },
];

/** A BillRow as the server sends it: the contract's KGH/2026-27/31 for Anil Gupta. */
export function wireRow(over: Wire = {}): Wire {
  return {
    id: 412, business: 3, business_name: "KIRAN GOLD HOUSE", invoice_number: "KGH/2026-27/31", counter: 31, fy: "2026-27",
    invoice_date: "2026-10-08", created_at: "2026-10-08T10:42:05.123456+05:30", paper: false,
    customer: { id: 7, name: "Anil Gupta", gst_number: "", mobile_number: "9829041122", type: "person" },
    payment_mode: "cash", taxable: "84546.81", cgst: "1268.20", sgst: "1268.20", igst: "0.00", tax: "2536.40", total_amount: "87083.21",
    interstate: false, gst_percents: ["3"], line_count: 2, status: "active", cancel_reason: "", sent: null, checks: [], itax: [], locked: false,
    ...over,
  };
}

/** A BillDetail as the server sends it: the contract's example with its two lines. Its total is exact: nothing rounds it (Ruling 1B-12). */
export function wireDetail(over: Wire = {}): Wire {
  return {
    ...wireRow(),
    place_of_supply: "08", place_of_supply_name: "RAJASTHAN", place_of_supply_chosen: null, segment: "b2cs", notes: "",
    replaces: null, replaced_by: null, cancelled_at: null, cancelled_by: null,
    firm: {
      name: "KIRAN GOLD HOUSE", address: "12 Sandbox Bazaar, Jaipur, Rajasthan", gst_number: "08ABCPK1234F1Z5", state_name: "RAJASTHAN",
      state_code: "08", pan_number: "ABCPK1234F", mobile_number: "9000000003", email: "firm3@example.com", bank_name: "Sandbox Bank",
      bank_account_number: "000000000003", bank_ifsc_code: "SBOX0000003", bank_branch_name: "Jaipur", invoice_prefix: "KGH", signature_url: null, frozen: true,
    },
    customer: {
      id: 7, name: "Anil Gupta", type: "person", address: "15 Demo Road, Rajasthan", city: "Udaipur", state_name: "RAJASTHAN", state_code: "08",
      gst_number: "", gstin_valid: null, pan_number: "", pan: "", mobile_number: "9829041122", email: "",
    },
    lines: WIRE_LINES,
    slabs: [{ gst_percent: "3", taxable: "84546.81", cgst: "1268.20", sgst: "1268.20", igst: "0.00", tax: "2536.40" }],
    hsn_summary: [
      { hsn_code: "711319", gst_percent: "3", unit: "gms", quantity: "12.345", taxable: "80396.81", cgst: "1205.95", sgst: "1205.95", igst: "0.00", tax: "2411.90" },
      { hsn_code: "711319", gst_percent: "3", unit: "pcs", quantity: "1.000", taxable: "4150.00", cgst: "62.25", sgst: "62.25", igst: "0.00", tax: "124.50" },
    ],
    total_in_words: "Eighty Seven Thousand Eighty Three Rupees and Twenty One Paise Only",
    tax_in_words: "Two Thousand Five Hundred Thirty Six Rupees and Forty Paise Only",
    eway: { eway_bill_number: "", transporter_name: "", transporter_gstin: "", vehicle_number: "", vehicle_type: "Regular", transport_mode: "Road", distance_km: null, may_be_needed: false },
    duplicates: [],
    history: { created_by: { id: 2, name: "Rakesh Soni" }, activity: [{ at: "2026-10-08T10:42:05+05:30", by: "Rakesh Soni", action: "created", details: "Anil Gupta · ₹87,083.21" }] },
    ...over,
  };
}

/** A BinRow: the contract's KGH/2026-27/27, deleted as entered twice. */
export function wireBin(over: Wire = {}): Wire {
  return {
    id: 4, original_id: 205, kind: "deleted", business: 3, business_name: "KIRAN GOLD HOUSE", invoice_number: "KGH/2026-27/27",
    invoice_date: "2026-09-24", fy: "2026-27", customer: { id: 9, name: "Walk-in Customer" }, total_amount: "45000.00",
    reason: "Entered twice by mistake", deleted_at: "2026-10-03T18:40:00+05:30", deleted_by: { id: 1, name: "Kailash Mehta" }, locked: false,
    ...over,
  };
}

/** A page of the list: these rows and a summary of them, active bills counted and cancelled ones named apart. */
export function wirePage(rows: Wire[], over: Wire = {}): Wire {
  const active = rows.filter((r) => r.status !== "cancelled");
  const sum = (k: string) => active.reduce((a, r) => a + (toPaise(r[k] as string) ?? 0), 0);
  return {
    count: rows.length, next: null, previous: null, results: rows,
    summary: {
      of: "active", bills: active.length, taxable: paiseToDecimal(sum("taxable")), cgst: paiseToDecimal(sum("cgst")), sgst: paiseToDecimal(sum("sgst")),
      igst: paiseToDecimal(sum("igst")), tax: paiseToDecimal(sum("tax")), total_amount: paiseToDecimal(sum("total_amount")),
      average: active.length > 1 ? paiseToDecimal(Math.round(sum("total_amount") / active.length)) : null, cancelled: rows.length - active.length,
    },
    ...over,
  };
}

/** The facets of FY 2026-27 for one firm: April to August filed, the views' counts. */
export function wireFacets(over: Wire = {}): Wire {
  return {
    months: [
      { month: "2026-04", bills: 31, locked: true }, { month: "2026-05", bills: 28, locked: true }, { month: "2026-06", bills: 25, locked: true },
      { month: "2026-07", bills: 22, locked: true }, { month: "2026-08", bills: 19, locked: true }, { month: "2026-09", bills: 14, locked: false },
      { month: "2026-10", bills: 4, locked: false },
    ],
    views: { unsent_today: 2, credit_month: 5, check: 3, cash: 1 },
    elsewhere: [],
    ...over,
  };
}

/** A refusal: an answer that throws refuse(409, { detail, code }) makes the server answer with that status and body (0: no reply, the network failed). */
export class Refusal {
  constructor(readonly status: number, readonly data: unknown) {}
}
export function refuse(status: number, data: unknown): never {
  throw new Refusal(status, data);
}

export type Call = { method: string; url: string; params: Record<string, unknown>; body: unknown };
export type Route = [method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string | RegExp, answer: (call: Call) => unknown];

/**
 * Answers the app's requests from `routes`, through the shared fake server (@/test/server): the first whose method and
 * path match (the path without its leading slash; a string exactly, a RegExp by test). An answer is the body to send,
 * or a promise of one; refuse() sends a status instead. The shell's own questions get no preferences and two firms;
 * anything else gets an empty page.
 */
export function salesServer(routes: Route[] = []): { calls: Call[] } {
  const calls: Call[] = [];
  serveWith(async ({ method, url, params, data }) => {
    const call: Call = { method, url: url.replace(/^\/+/, ""), params, body: data };
    calls.push(call);
    const route = routes.find(([m, p]) => m === method && (typeof p === "string" ? p === call.url : p.test(call.url)));
    if (route) {
      try {
        return { status: 200, data: await route[2](call) };
      } catch (e) {
        if (e instanceof Refusal) return { status: e.status, data: e.data };
        throw e;
      }
    }
    if (call.url.startsWith("preferences/")) return { status: 200, data: { data: {} } };
    if (call.url.startsWith("businesses/")) return { status: 200, data: { results: [FIRM, OTHER_FIRM] } };
    return { status: 200, data: { count: 0, next: null, previous: null, results: [] } };
  });
  return { calls };
}
