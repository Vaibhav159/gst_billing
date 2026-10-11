import { beforeEach, expect, it, vi } from "vitest";
import { fireEvent, screen, within } from "@testing-library/react";
import { renderApp } from "@/test/render";
import { serve } from "@/test/server";
import { decodeReport } from "@/core/api/gstReports";
import type { Reconciliation } from "@/core/gst/reportTypes";
import { reconciliationSheet } from "@/core/excel/reconciliation";
import { ReconView } from "./ReconView";
const { scope } = vi.hoisted(() => ({ scope: { setFirmId: vi.fn(), setFy: vi.fn() } }));
vi.mock("@/core/scope", () => ({ useScope: () => scope, useFirms: () => ({ firms: [{ id: 3, name: "KIRAN GOLD HOUSE", gstin: "08VRHFA2322D1ZI" }], loading: false }) }));
vi.mock("@/pages/gst/WorkbookDialog", () => ({ WorkbookDialog: ({ open, permission }: { open: boolean; permission: string }) => open ? <div>Preview · {permission}</div> : null }));
const amounts = { taxable: "100.00", igst: "0.00", cgst: "1.50", sgst: "1.50", bills: 1 };
const filed = { ...amounts, taxable: "99.00", cgst: "1.49", sgst: "1.49" };
const diff = { taxable: "1.00", igst: "0.00", cgst: "0.01", sgst: "0.01", bills: 0 };
const empty = { taxable: "0.00", igst: "0.00", cgst: "0.00", sgst: "0.00", bills: 0 };
const wire = {
  business: 3, fy: "2026-27", filed: [
    { month: "2026-04", stage: "filed", books: amounts, gstr1: null, gstr3b: null, diff: null, differs: false, amended_in: null },
    { month: "2026-09", stage: "gstr1", books: amounts, gstr1: filed, gstr3b: null, diff, differs: true, amended_in: "2026-10" },
    { month: "2026-10", stage: "open", books: empty, gstr1: null, gstr3b: null, diff: null, differs: false, amended_in: null },
    { month: "2027-01", stage: "future", books: empty, gstr1: null, gstr3b: null, diff: null, differs: false, amended_in: null },
  ],
  periods: [
    { key: "q2", label: "Jul to Sep 2026", months: ["2026-07", "2026-08", "2026-09"], so_far: null, books: amounts, gstr1: filed, gstr3b: null, diff, filed_months: 1, differs: ["2026-09"] },
    { key: "q4", label: "Jan to Mar 2027", months: ["2027-01", "2027-02", "2027-03"], so_far: null, books: empty, gstr1: null, gstr3b: null, diff: null, filed_months: 0, differs: [] },
    { key: "fy", label: "FY 2026-27", months: ["2026-04", "2026-09", "2026-10", "2027-01"], so_far: { from: "2026-04-01", to: "2026-10-08" }, books: { ...amounts, taxable: "200.00", bills: 2 }, gstr1: filed, gstr3b: null, diff, filed_months: 1, differs: ["2026-09"] },
  ],
  sections: [{ key: "q2", all: amounts, b2b: amounts, b2cl: empty, b2c: empty, adds_up: true }, { key: "q4", all: empty, b2b: empty, b2cl: empty, b2c: empty, adds_up: true }, { key: "fy", all: amounts, b2b: amounts, b2cl: empty, b2c: empty, adds_up: true }],
  checks: [
    { id: "rate-3", label: "Tax at 3%", period: "Jul to Sep 2026", expected: "100.00", actual: "101.20", diff: "1.20", status: "rounding", link: null },
    { id: "coverage", label: "Every bill counted once", period: "Jul to Sep 2026", expected: 2, actual: 1, diff: -1, status: "fail", link: { to: "/sales?gst_rate=3", label: "Open these bills" } },
    { id: "split-taxable", label: "Sections add up", period: "Jul to Sep 2026", expected: "100.00", actual: "100.00", diff: "0.00", status: "pass", link: null },
  ], split: [{ mode: "cash", bills: 2, value: "206.00", taxable: "200.00", igst: "0.00", cgst: "3.00", sgst: "3.00", share: "100.00" }], differs: ["2026-09"], failing: 1, roundings: 1,
};
beforeEach(() => { Object.assign(window, { __phone: false }); localStorage.clear(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-08T09:00:00+05:30")); scope.setFirmId.mockClear(); scope.setFy.mockClear(); });
it("shows as-filed differences, unavailable legacy figures, running/future months and partial FY", async () => {
  serve({ "GET gst/reconciliation/": wire });
  renderApp(<ReconView businessId={3} fy="2026-27" />);
  expect(await screen.findByText("1 month differs from the return as filed")).toBeInTheDocument();
  expect(screen.getByRole("table", { name: "Books by buyer class" })).toBeInTheDocument();
  expect(screen.getByText(/nil supplies included/)).toBeInTheDocument();
  expect(screen.getAllByText("As-filed figures unavailable").length).toBeGreaterThan(0);
  expect(screen.getByText("Open · month running")).toBeInTheDocument();
  expect(screen.getAllByText("Not started").length).toBeGreaterThan(0);
  expect(screen.getAllByText(/01 Apr 2026 to 08 Oct 2026/).length).toBeGreaterThan(0);
  expect(screen.getAllByText(/difference on the 1 month filed/).length).toBeGreaterThan(0);
  expect(screen.getByRole("link", { name: "Amended in Oct 2026" })).toHaveAttribute("href", "/gst?firm=3&month=2026-10");
  expect(screen.getByText(/GSTR-2B.*isn't matched here yet/)).toBeInTheDocument();
});
it("shows GSTR-3B only for tax measures and never calls an unfiled return zero", async () => {
  serve({ "GET gst/reconciliation/": wire }); renderApp(<ReconView businessId={3} fy="2026-27" />);
  await screen.findByText("1 month differs from the return as filed");
  expect(screen.queryByRole("columnheader", { name: "GSTR-3B as filed" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("radio", { name: "CGST" }));
  const table = screen.getByRole("table", { name: "CGST, books against the returns as filed" });
  expect(within(table).getByRole("columnheader", { name: "GSTR-3B as filed" })).toBeInTheDocument();
  expect(within(table).getAllByText("not filed").length).toBeGreaterThan(0);
  expect(within(table).getAllByText("+₹0.01").length).toBeGreaterThan(0);
});
it("uses server rounding status even above ₹1 and counts coverage in bills", async () => {
  serve({ "GET gst/reconciliation/": wire }); renderApp(<ReconView businessId={3} fy="2026-27" />);
  await screen.findByText("1 month differs from the return as filed");
  expect(screen.getByText("Rounding · ₹1.20")).toBeInTheDocument();
  expect(screen.getByText("Fail · 1 bill")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("link", { name: "Open these bills" }));
  expect(scope.setFirmId).toHaveBeenCalledWith(3); expect(scope.setFy).toHaveBeenCalledWith("2026-27");
});
it("shows phone cards, includes split only when requested and opens the permitted Excel", async () => {
  Object.assign(window, { __phone: true });
  const calls = serve({ "GET gst/reconciliation/": wire }); renderApp(<ReconView businessId={3} fy="2026-27" />);
  await screen.findByText("1 month differs from the return as filed");
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("radio", { name: "CGST" }));
  fireEvent.click(screen.getByRole("checkbox", { name: /^Cash\/bank split in downloads/ }));
  await screen.findByText("1 month differs from the return as filed");
  expect(calls.at(-1)?.params.split).toBe("1");
  expect(screen.getByRole("radio", { name: "CGST" })).toHaveAttribute("aria-checked", "true");
  fireEvent.click(screen.getByRole("button", { name: "Excel with the working" }));
  expect(screen.getByText("Preview · gst.download")).toBeInTheDocument();
});
it("does not grant reconciliation downloads to a viewer who can export reports", async () => {
  serve({ "GET gst/reconciliation/": wire }); renderApp(<ReconView businessId={3} fy="2026-27" />, { me: { role: "viewer", permissions: ["view", "reports.export"] } });
  await screen.findByText("1 month differs from the return as filed");
  expect(screen.getByRole("button", { name: "Excel with the working" })).toBeDisabled();
});
it("shows no-sales words only after a successful empty reply", async () => {
  serve({ "GET gst/reconciliation/": { ...wire, filed: [], periods: [], sections: [], split: [], checks: [], differs: [], failing: 0, roundings: 0 } }); renderApp(<ReconView businessId={3} fy="2026-27" />);
  expect(screen.queryByText(/No sales for/)).not.toBeInTheDocument();
  expect(await screen.findByText("No sales for KIRAN GOLD HOUSE in FY 2026-27")).toBeInTheDocument();
});
it("exports the same as-filed amounts, quarters/FY, count checks and optional split in a styled sheet", () => {
  const r = decodeReport<Reconciliation>(wire);
  const sheet = reconciliationSheet(r, { name: "KIRAN GOLD HOUSE", gstin: "08VRHFA2322D1ZI" }, true);
  expect(sheet.name).toBe("Reconciliation 2026-27");
  const cells = sheet.rows.flatMap(row => row.cells.map(c => c.v));
  expect(cells).toContain("THE BOOKS BY BUYER CLASS · NIL SUPPLIES INCLUDED");
  expect(cells).toContain("99.00"); expect(cells).toContain("1.00"); expect(cells).toContain("PAYMENT SPLIT (cash / bank)"); expect(cells).toContain("FY 2026-27 · 01 Apr 2026 to 08 Oct 2026");
  const count = sheet.rows.find(row => row.cells[0]?.v === "Every bill counted once");
  expect(count?.cells.slice(2, 5).map(c => c.v)).toEqual([2, 1, -1]);
  expect(cells).toContain("As-filed figures unavailable");
  expect(reconciliationSheet(r, { name: "KIRAN", gstin: "" }, false).rows.some(row => row.cells[0]?.v === "PAYMENT SPLIT (cash / bank)")).toBe(false);
});
it("keeps link headers for screen readers only and right-aligns the number headers", async () => {
  serve({ "GET gst/reconciliation/": wire }); renderApp(<ReconView businessId={3} fy="2026-27" />);
  const filedTable = await screen.findByRole("table", { name: "Taxable value, books against the returns as filed" });
  const heads = within(filedTable).getAllByRole("columnheader");
  expect(heads.at(-1)).toHaveTextContent("Notes"); expect(heads.at(-1)!.firstElementChild).toHaveClass("sr-only");
  expect(heads.slice(1, -1).every(h => h.classList.contains("text-right"))).toBe(true);
  const checkHeads = within(screen.getByRole("table", { name: "All arithmetic checks" })).getAllByRole("columnheader");
  expect(checkHeads.at(-1)!.firstElementChild).toHaveClass("sr-only");
  expect(checkHeads.filter(h => h.classList.contains("text-right")).map(h => h.textContent)).toEqual(["Expected", "Actual", "Difference"]);
});
it("puts a sign only on a check's difference, never on an expected or actual figure that equals it", async () => {
  const checks = [{ id: "split-taxable", label: "Sections add up", period: "Jul to Sep 2026", expected: "1.20", actual: "0.00", diff: "1.20", status: "fail", link: null }];
  serve({ "GET gst/reconciliation/": { ...wire, checks, failing: 1, roundings: 0 } }); renderApp(<ReconView businessId={3} fy="2026-27" />);
  const row = within(await screen.findByRole("table", { name: "All arithmetic checks" })).getByRole("row", { name: /Sections add up/ });
  const cells = within(row).getAllByRole("cell").map(c => c.textContent);
  expect(cells.slice(2, 5)).toEqual(["₹1.20", "₹0.00", "+₹1.20"]);
});
it("shows the phone notes under each month rather than pairing them with a Bills label", async () => {
  Object.assign(window, { __phone: true });
  serve({ "GET gst/reconciliation/": wire }); renderApp(<ReconView businessId={3} fy="2026-27" />);
  await screen.findByText("1 month differs from the return as filed");
  expect(screen.queryAllByText("Bills", { selector: "dt" })).toHaveLength(0);
  expect(screen.getByRole("link", { name: "Open Sep" })).toBeInTheDocument();
});
