import { expect, it, vi, beforeEach } from "vitest";
import { act, fireEvent, screen, within, waitFor } from "@testing-library/react";
import { bytesOf } from "@/pages/sales/print/zip";
import { renderApp } from "@/test/render";
import type { CustomersReport, HsnReport, MonthsReport, ProductsReport, PurchasesReport, SalesReport, TaxReport } from "@/core/gst/reportTypes";
import { SalesView, PurchasesView, TaxView, HsnView, CustomersView, ProductsView, MonthsView } from "./ReportViews";
const { saveFile, logReport } = vi.hoisted(() => ({ saveFile: vi.fn(), logReport: vi.fn(async () => undefined) }));
vi.mock("@/core/print/files", () => ({ saveFile }));
vi.mock("@/core/api/gstExports", () => ({ logReport }));
vi.mock("@/pages/gst/WorkbookDialog", () => ({ WorkbookDialog: () => null }));
const heads = { igst: 0, cgst: 150, sgst: 150, total: 300 };
const zero = { igst: 0, cgst: 0, sgst: 0, total: 0 };
const firm = { id: 3, name: "KIRAN GOLD HOUSE" }, customer = { id: 4, name: "Anil Gupta", gst_number: "" };
const ctx = { businessId: 3 as number | "all", scopeName: "KIRAN GOLD HOUSE", period: "Sep 2026", from: "2026-09-01", to: "2026-09-30", split: false };
const totals = { bills: 1, taxable: 10000, heads, total: 10300, cancelled: 1 };
const sales: SalesReport = { totals, by_firm: [{ firm, totals }], split: [], bills: [
  { id: 1, invoice_number: "KGH/21", invoice_date: "2026-09-12", firm, customer, taxable: 10000, heads, total: 10300, status: "active", duplicate: true, payment: "cash" },
  { id: 2, invoice_number: "KGH/22", invoice_date: "2026-09-13", firm, customer, taxable: 990000, heads: zero, total: 990000, status: "cancelled", duplicate: false, payment: null },
] };
beforeEach(() => { Object.assign(window, { __phone: false }); saveFile.mockClear(); logReport.mockClear(); });
it("uses the active server totals when cancelled rows are revealed and links duplicate fixes", () => {
  renderApp(<SalesView ctx={ctx} data={sales} />);
  expect(screen.queryByText("KGH/22")).not.toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("Show cancelled bills (1)"));
  expect(screen.getByText("KGH/22")).toBeInTheDocument();
  expect(screen.getAllByText("₹103.00").length).toBeGreaterThan(1);
  expect(screen.queryByText("₹10,003.00")).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Used twice" })).toHaveAttribute("href", "/gst?firm=3&month=2026-09");
});
it("shows purchase date totals, credit month state and the server's credit-gap words", () => {
  const data: PurchasesReport = { split: [], bills: [{ id: 7, bill_no: "JGE/1183", date: "2026-09-05", supplier: customer, firm, taxable: 10000, heads, total: 10300, credit_month: "2026-10", credit_state: "to_confirm", payment: "bank" }], totals, credit_by_return: { ...heads, total: 90240 }, gap: ["+₹902.40 from a Feb 2026 bill claimed in October 2026"] };
  renderApp(<PurchasesView ctx={ctx} data={data} />);
  expect(screen.getByText(/\+₹902.40 from a Feb 2026 bill claimed in October 2026/)).toBeInTheDocument();
  expect(screen.getByText("To confirm · Oct 2026")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Tax summary" })).toHaveAttribute("href", "/reports/tax");
});
it("shows output and 4C separately, paid/to-pay and whole-month cash from the server", () => {
  const data: TaxReport = { firms: [{ firm, months: [{ month: "2026-09", output: heads, credit: zero, cash: heads, carry_on: zero, state: "paid", filed_on: "2026-10-19" }], totals: { output: heads, credit: zero, cash: heads } }], gap: [], whole_months: null };
  renderApp(<TaxView ctx={ctx} data={data} />);
  expect(screen.getAllByText("Credit on purchases")).toHaveLength(2);
  expect(screen.getByText("paid · 19 Oct 2026")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Sep 2026" })).toHaveAttribute("href", "/gst?firm=3&month=2026-09");
});
it("keeps CTM, 0.25% and three decimal quantities, and switches HSN side", () => {
  const data: HsnReport = { rows: [{ hsn: "710239", description: "Diamond", uqc: "CTM", quantity: "6.400", rate: "0.0025", taxable: 36096000, heads, bills: 1 }], bills: 1, totals: { taxable: 36096000, heads } };
  const onSide = vi.fn();
  renderApp(<HsnView ctx={ctx} data={data} side="sales" onSide={onSide} />);
  expect(screen.getByRole("cell", { name: "CTM" })).toBeInTheDocument();
  expect(screen.getByText("6.400")).toBeInTheDocument();
  expect(screen.getByText("0.25%")).toBeInTheDocument();
  expect(screen.queryByText(/no carat unit/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("radio", { name: "Purchases" }));
  expect(onSide).toHaveBeenCalledWith("purchases");
});
it("describes April's filing summary without claiming every period has a buyer split", () => {
  const data: HsnReport = { rows: [], bills: 0, totals: { taxable: 0, heads: zero } };
  renderApp(<HsnView ctx={{ ...ctx, from: "2025-04-01", to: "2025-04-30", period: "Apr 2025" }} data={data} side="sales" onSide={vi.fn()} />);
  expect(screen.getByText(/For filing, each firm's HSN summary is on GST returns\./)).toBeVisible();
  expect(screen.queryByText(/split into B2B and B2C/)).not.toBeInTheDocument();
});
it("keeps customer udhaar as billed credit and product quantities by unit on phones", () => {
  Object.assign(window, { __phone: true });
  const data: CustomersReport = { rows: [{ customer, bills: 2, total: 10300, udhaar_bills: 1, udhaar_total: 5000, last_bill: "2026-09-12" }], sales_total: 10300, walk_in: { bills: 0, total: 0 } };
  const ui = renderApp(<CustomersView ctx={ctx} data={data} />);
  expect(screen.getByText(/not what is still owed/)).toBeInTheDocument();
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  ui.unmount();
  const products: ProductsReport = { rows: [{ name: "Gold", hsn: "711319", quantity: [{ unit: "gms", quantity: "1.234" }, { unit: "ct", quantity: "2.500" }], taxable: 10000, bills: 2 }], taxable: 10000, bills: 2 };
  renderApp(<ProductsView ctx={ctx} data={products} />);
  expect(screen.getByText("1.234 gms · 2.500 ct")).toBeInTheDocument();
});
it("uses one scale for month bars, server totals and hides per-firm cash for all firms", () => {
  const figures = { sales: { value: 10300, bills: 1 }, purchases: { value: 20600, bills: 2 }, sales_tax: 300, credit: 600, cash: 100 };
  const data: MonthsReport = { rows: [{ ...figures, month: "2026-09", from: "2026-09-01", to: "2026-09-30", stage: "ready" }], totals: figures, gap: [] };
  renderApp(<MonthsView ctx={{ ...ctx, businessId: "all" }} data={data} />);
  expect(screen.queryByRole("columnheader", { name: "Tax to pay in cash" })).not.toBeInTheDocument();
  expect(within(screen.getByRole("table")).getAllByText("₹206.00")).toHaveLength(2);
  expect(screen.getByLabelText("Sep 2026 sales: ₹103.00")).toHaveStyle({ width: "50%" });
  expect(screen.getByLabelText("Sep 2026 purchases: ₹206.00")).toHaveStyle({ width: "100%" });
  fireEvent.click(screen.getByRole("radio", { name: "Bills" }));
  expect(screen.getByLabelText("Sep 2026 purchases: 2 bills")).toHaveStyle({ width: "100%" });
});
it("lets a viewer export reports, independently of gst.download", () => {
  renderApp(<SalesView ctx={ctx} data={sales} />, { me: { role: "viewer", permissions: ["view", "reports.export"] } });
  expect(screen.getByRole("button", { name: /Excel · KIRAN GOLD HOUSE · Sep 2026 · 1 sales bill/ })).toBeEnabled();
  expect(screen.getByRole("button", { name: /CSV/ })).toBeEnabled();
});

it("downloads active CSV rows with dates and exact money, omits payment without split and records the download", async () => {
  renderApp(<SalesView ctx={ctx} data={sales} />);
  fireEvent.click(screen.getByLabelText("Show cancelled bills (1)"));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /CSV/ })); });
  const [blob, file] = saveFile.mock.calls[0] as [Blob, string];
  const csv = new TextDecoder().decode(await bytesOf(blob));
  expect(file).toBe("Sales_register_KIRAN_GOLD_HOUSE_Sep_2026.csv");
  expect(csv).toContain("2026-09-12");
  expect(csv).toContain("KGH/21"); expect(csv).not.toContain("KGH/22");
  expect(csv).toContain("103.00"); expect(csv).not.toContain("Cash");
  await waitFor(() => expect(logReport).toHaveBeenCalledWith("Sales register, KIRAN GOLD HOUSE, Sep 2026", file));
});

it("shows pre-ledger books with no cash/carry and the exact whole-month note", () => {
  const data: TaxReport = { firms: [{ firm, months: [{ month: "2024-02", output: heads, credit: zero, cash: null, carry_on: null, state: "before_ledger", filed_on: null }], totals: { output: heads, credit: zero, cash: null } }], gap: [], whole_months: { from: "2024-02-01", to: "2024-02-29" } };
  renderApp(<TaxView ctx={{ ...ctx, from: "2024-02-12", to: "2024-02-20" }} data={data} />);
  expect(screen.getByText("Before the app's credit ledger (it starts April 2025).")).toBeInTheDocument();
  expect(screen.getByText("Shown for whole months: 01 Feb 2024 to 29 Feb 2024.")).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Feb 2024" })).not.toBeInTheDocument();
  expect(screen.queryByText(/Cash over this period/)).not.toBeInTheDocument();
  expect(screen.getAllByRole("cell", { name: "—" })).toHaveLength(2);
});
it("keeps historical purchases with no credit month readable and exportable", async () => {
  const data: PurchasesReport = { bills: [{ id: 7, bill_no: "OLD/7", date: "2024-02-12", supplier: customer, firm, taxable: 10000, heads, total: 10300, credit_month: null, credit_state: "outside", payment: null }], totals, credit_by_return: zero, gap: [], split: [] };
  renderApp(<PurchasesView ctx={ctx} data={data} />);
  expect(screen.getByText("Outside the credit ledger")).toBeInTheDocument();
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /CSV/ })); });
  const csv = new TextDecoder().decode(await bytesOf(saveFile.mock.calls[0][0]));
  expect(csv).toContain("OLD/7"); expect(csv).not.toContain("null");
});

it("puts only the main sheet's header and bills in the CSV, without the title, total or payment split", async () => {
  renderApp(<SalesView ctx={{ ...ctx, split: true }} data={{ ...sales, split: [{ mode: "cash", bills: 1, value: 10300 }] }} />);
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /CSV/ })); });
  const csv = new TextDecoder().decode(await bytesOf((saveFile.mock.calls[0] as [Blob])[0]));
  const lines = csv.replace(/^\ufeff/, "").trim().split("\r\n");
  expect(lines[0]).toBe("Bill,Date,Firm,Customer,GSTIN,Payment,Taxable value,IGST,CGST,SGST,Bill value");
  expect(lines).toHaveLength(2);
  expect(lines[1]).toMatch(/^KGH\/21,2026-09-12,/);
});
it("aligns each header with its column's figures rather than by position", () => {
  renderApp(<SalesView ctx={ctx} data={sales} />);
  const table = screen.getByRole("table", { name: "Sales bills" });
  const right = within(table).getAllByRole("columnheader").filter(h => h.classList.contains("text-right")).map(h => h.textContent);
  expect(right).toEqual(["Taxable value", "IGST", "CGST", "SGST", "Bill value"]);
});
