// Synthetic Easy examples layered on the app's existing fake server; tests only.
import { toCustomer } from "@/core/api/customers";
import type { Draft } from "@/core/draftData";
import { salesServer, wireDetail, wirePage, wireRow, type Route } from "@/core/sales/fixtures";

export const EASY_TODAY = "2026-10-08";
export function easyCustomer(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 7, name: "Anil Gupta", address: "15 Demo Road", city: "Udaipur", state_name: "RAJASTHAN", gst_number: "", pan_number: "",
    mobile_number: "9829041122", email: "", businesses: [3], created_at: "2026-10-08T10:00:00+05:30", customer_type: "", type: "person", pan: "",
    figures: { bills: 1, total: "87083.21", cancelled: 0, udhaar_bills: 0, udhaar_total: "0.00",
      last_bill: { id: 412, invoice_number: "KGH/2026-27/31", invoice_date: EASY_TODAY, total_amount: "87083.21", business: 3 } },
    ...over,
  };
}
export function easyDraft(over: Partial<Draft> = {}): Draft {
  return {
    id: "5d1c2a8e-0b7f-4a8e-9c3a-1f2e3d4c5b6a", business: 3, started_by: { id: 2, name: "Rakesh Soni" },
    created_at: "2026-10-08T15:20:00+05:30", updated_at: "2026-10-08T15:21:00+05:30",
    data: { v: 1, firmId: 3, customer: toCustomer(easyCustomer()), date: EASY_TODAY, number: "34", numberTyped: false, paper: false,
      posOverride: null, payment: null, notes: "", replaces: null,
      lines: [{ productId: 5, name: "Gold Ring 22K", hsn: "711319", gst: "3", unit: "gms", qty: 4.5, rate: "6500", note: "", custom: false }] },
    ...over,
  };
}
/** Put test-specific answers first. Everything else uses salesServer's single request recorder. */
export function easyServer(routes: Route[] = []) {
  return salesServer([...routes,
    ["GET", "sales/", () => wirePage([wireRow()])],
    ["GET", "sales/412/", () => wireDetail()],
    ["GET", "customers/", () => ({ count: 1, next: null, previous: null, results: [easyCustomer()] })],
    ["GET", "drafts/", () => ({ results: [easyDraft()] })],
    ["GET", "products/", () => ({ results: [{ id: 5, name: "Gold Ring 22K", hsn_code: "711319", gst_tax_rate: "0.03", default_unit: "gms" }] })],
  ]);
}
