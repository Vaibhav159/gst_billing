import { beforeEach, expect, it } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { testQueryClient } from "@/test/render";
import { serve } from "@/test/server";
import { decodeReport, normalizeReport, reportParams, useReport, useReconciliation } from "./gstReports";
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={testQueryClient()}>{children}</QueryClientProvider>;
beforeEach(() => localStorage.clear());
it("keeps financial decimal strings as integer paise, counts and CTM quantities unchanged", () => {
  const decoded = decodeReport({ totals: { bills: 2, total: "82808.71", cancelled: 1, heads: { igst: "0.00", cgst: "1205.95", sgst: "1205.95", total: "2411.90" } }, rows: [{ uqc: "CTM", quantity: "6.400", rate: "0.0025", share: "38.71" }] });
  expect(decoded).toEqual({ totals: { bills: 2, total: 8280871, cancelled: 1, heads: { igst: 0, cgst: 120595, sgst: 120595, total: 241190 } }, rows: [{ uqc: "CTM", quantity: "6.400", rate: "0.0025", share: "38.71" }] });
  expect(() => decodeReport({ total: "not a number" })).toThrow("The report contains an invalid amount.");
});
it("omits all-firm scope and does not send false split", () => {
  expect(reportParams({ businessId: "all", from: "2022-04-01", to: "2026-10-08", split: false })).toEqual({ from: "2022-04-01", to: "2026-10-08" });
});
it("does not request a report until the firm is known; the key follows firm, range, split and HSN side", async () => {
  const calls = serve({ "GET reports/hsn/": { side: "sales", rows: [], totals: { bills: 0, taxable: "0.00", igst: "0.00", cgst: "0.00", sgst: "0.00", tax: "0.00", value: "0.00", round_off: "0.00" } } });
  const q = renderHook(({ businessId, side }: { businessId: number | null; side: "sales" | "purchases" }) => useReport("hsn", { businessId, from: "2025-03-31", to: "2026-03-31", split: true }, side), { wrapper, initialProps: { businessId: null, side: "sales" } });
  expect(calls).toHaveLength(0);
  q.rerender({ businessId: 3, side: "purchases" });
  await waitFor(() => expect(q.result.current.isSuccess).toBe(true));
  expect(calls[0].params).toEqual({ business_id: 3, from: "2025-03-31", to: "2026-03-31", split: "1", side: "purchases" });
});
it("keeps coverage arithmetic in bills and money arithmetic in paise", async () => {
  const calls = serve({ "GET gst/reconciliation/": { business: 3, fy: "2026-27", checks: [{ id: "coverage", expected: "12.00", actual: "11.00", diff: "-1.00", status: "fail" }, { id: "rate-3", expected: "1.01", actual: "1.00", diff: "-0.01", status: "rounding" }] } });
  const q = renderHook(() => useReconciliation(3, "2026-27", true), { wrapper });
  await waitFor(() => expect(q.result.current.isSuccess).toBe(true));
  expect(q.result.current.data?.checks.map(c => [c.expected, c.actual, c.diff])).toEqual([[12, 11, -1], [101, 100, -1]]);
  expect(calls[0].params).toEqual({ business_id: 3, fy: "2026-27", split: "1" });
});

const firm = { id: 3, name: "KIRAN GOLD HOUSE" };
const party = { id: 4, name: "Anil Gupta", gst_number: "" };
const taxHeads = { igst: "0.00", cgst: "1.50", sgst: "1.50", total: "3.00" };
const amounts = { bills: 1, taxable: "100.00", igst: "0.00", cgst: "1.50", sgst: "1.50", tax: "3.00", value: "103.00", round_off: "0.00" };
const gap = { by_date: "3.00", by_return: "4.00", difference: "1.00", parts: ["+₹1.00 from an earlier bill"] };
const query = { businessId: 3, from: "2024-02-12", to: "2024-02-20", split: false };
it("adapts 3B flat sales totals and firm totals without adding cancelled values", () => {
  const result = normalizeReport("sales", { bills: [], totals: { ...amounts, cancelled: 1 }, by_firm: [{ firm, ...amounts }], split: [] }, query);
  expect(result.totals).toEqual({ bills: 1, taxable: 10000, heads: { igst: 0, cgst: 150, sgst: 150, total: 300 }, total: 10300, cancelled: 1 });
  expect(result.by_firm[0].totals.total).toBe(10300);
});
it("adapts 3B purchase credit totals and gap parts and preserves an outside-ledger null credit month", () => {
  const result = normalizeReport("purchases", { bills: [{ id: 7, bill_no: "OLD/7", date: "2024-02-12", firm, supplier: party, taxable: "100.00", heads: taxHeads, total: "103.00", credit_month: null, credit_state: "outside", payment: null }], totals: amounts, credit_by_return: { ...amounts, tax: "4.00" }, gap, split: [] }, query);
  expect(result.bills[0].credit_month).toBeNull(); expect(result.bills[0].credit_state).toBe("outside");
  expect(result.credit_by_return.total).toBe(400); expect(result.gap).toEqual(gap.parts);
});
it("adapts tax rows/state and widens dates to whole leap-year months with nullable pre-ledger cash/carry", () => {
  const result = normalizeReport("tax", { firms: [{ firm, rows: [{ month: "2024-02", output: taxHeads, credit: taxHeads, cash: null, carry_on: null, state: "before_ledger", gstr1_filed_on: null, gstr3b_filed_on: null }], totals: { output: taxHeads, credit: taxHeads, cash: null } }], gap, cuts_month: true }, query);
  expect(result.firms[0].months[0]).toMatchObject({ state: "before_ledger", cash: null, carry_on: null, output: { total: 300 } });
  expect(result.whole_months).toEqual({ from: "2024-02-01", to: "2024-02-29" });
});
it("adapts flat HSN heads with percentage slabs and keeps CTM and quantity untouched", () => {
  const result = normalizeReport("hsn", { side: "sales", rows: [{ hsn: "710239", description: "Diamonds", uqc: "CTM", quantity: "6.400", rate: "0.25", taxable: "100.00", igst: "0.00", cgst: "1.50", sgst: "1.50", bills: 1 }], totals: amounts }, query);
  expect(result.rows[0]).toMatchObject({ uqc: "CTM", quantity: "6.400", rate: "0.0025", heads: { cgst: 150 } });
  expect(result.bills).toBe(1); expect(result.totals.heads.total).toBe(300);
});
it("adapts exact-date monthly books GST separately from return credit and leaves unavailable cash totals null", () => {
  const result = normalizeReport("months", { rows: [{ month: "2024-02", sales: amounts, purchases: amounts, sales_tax: "3.00", credit: { ...taxHeads, total: "4.00" }, cash: null, stage: null }], totals: { sales: amounts, purchases: amounts, credit: { ...taxHeads, total: "4.00" } }, crosses_fy: false }, query);
  expect(result.rows[0]).toMatchObject({ from: "2024-02-12", to: "2024-02-20", sales_tax: 300, credit: 300, cash: null });
  expect(result.totals).toMatchObject({ sales_tax: 300, credit: 300, cash: null });
  expect(result.gap).toBeNull();
});
it("adapts customer udhaar/walkin and grouped products without inventing a product id or rate", () => {
  const customer = normalizeReport("customers", { rows: [{ customer: party, bills: 1, total: "103.00", udhaar: { bills: 1, total: "103.00" }, last_bill: "2024-02-12" }], totals: amounts, walkin: { ...amounts, bills: 0, value: "0.00" } }, query);
  expect(customer.rows[0]).toMatchObject({ udhaar_bills: 1, udhaar_total: 10300 }); expect(customer.walk_in).toEqual({ bills: 0, total: 0 });
  const product = normalizeReport("products", { rows: [{ name: "Diamond", hsn: "710239", quantity: { ct: "6.400", gms: "1.234" }, taxable: "100.00", bills: 1 }], totals: amounts }, query);
  expect(product.rows[0]).toEqual({ name: "Diamond", hsn: "710239", quantity: [{ unit: "ct", quantity: "6.400" }, { unit: "gms", quantity: "1.234" }], taxable: 10000, bills: 1 });
});
