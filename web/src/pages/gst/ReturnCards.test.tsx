import { act, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { renderApp } from "@/test/render";
import { monthFixture } from "@/core/gst/fixtures";
import type { Check, Gstr1, Gstr3b, Month } from "@/core/gst/types";
import { Checks } from "./Checks";
import { Gstr1Card } from "./Gstr1Card";
import { Gstr3bCard } from "./Gstr3bCard";

const heads = (igst = 0, cgst = 0, sgst = 0) => ({ igst, cgst, sgst, total: igst + cgst + sgst });
const duplicate = {
  kind: "duplicate", blocks: true, text: "Bill number KGH/2026-27/17 is used twice", detail: "", more_bills: 1, customer: null, suggested: 391,
  bills: [
    { id: 388, invoice_number: "KGH/2026-27/17", invoice_date: "2026-09-09", customer_name: "Anita Mehta", status: "active", total_amount: 4521000, typed: false },
    { id: 391, invoice_number: "KGH/2026-27/17", invoice_date: "2026-09-10", customer_name: "Hemant Dave", status: "active", total_amount: 1250000, typed: true },
  ],
} satisfies Check;
// Hand-worked fixtures: 1,000 × 3% = 30, split 15/15; 400 × 0.25% = 1.
const sections = {
  b2b: [{ bill: duplicate.bills[0], customer: { id: 4, name: "Anita Mehta", gst_number: "08ABCDE1234F1Z5", state_code: "08", state_name: "RAJASTHAN" }, place_of_supply: "08", rates: ["3"], taxable: 100000, igst: 0, cgst: 1500, sgst: 1500, total: 103000 }],
  b2cl: [{ bill: { ...duplicate.bills[1], invoice_number: "KGH/2026-27/18" }, customer: { id: 5, name: "Hemant Dave" }, place_of_supply: "24", place_of_supply_name: "GUJARAT", total: 20600000, rates: [{ rate: "3", taxable: 20000000, igst: 600000 }] }],
  b2cs: [{ place_of_supply: "08", place_of_supply_name: "RAJASTHAN", interstate: false, rate: "0.25", bills: 1, taxable: 40000, igst: 0, cgst: 50, sgst: 50 }],
  nil: [{ supply: "INTRAB2C", bills: 1, value: 120000 }],
  by_rate: [{ rate: "0.25", taxable: 40000, igst: 0, cgst: 50, sgst: 50, tax: 100, value: 40100, bills: 1 }],
  hsn: { b2b: [], b2c: [{ hsn: "710239", description: "Diamonds", uqc: "CTM", quantity: "6.40", rate: "0.25", taxable: 40000, igst: 0, cgst: 50, sgst: 50, service: false, bills: 1 }] },
  docs: [{ from: "KGH/2026-27/17", to: "KGH/2026-27/34", total: 18, cancelled: 1, net: 17 }],
  docs_notes: ["Numbers used in another month of the year (a back-dated bill) split the series into 2 rows, so nothing counts as cancelled twice."],
  cancelled: [{ bill: { id: null, bin_id: 4, invoice_number: "KGH/2026-27/27", invoice_date: "2026-09-24", customer_name: "Walk-in Customer", status: "deleted" }, kind: "deleted", total: 12500, reason: "Entered twice by mistake", on: "2026-10-03" }],
  amendments: { b2ba: 0, b2cla: 0, b2csa: 0 },
} satisfies Gstr1;
function month(overrides: Partial<Month> = {}): Month {
  return { business: 3, firm: { id: 3, name: "KIRAN GOLD HOUSE", short: "Kiran", gst_number: "08VRHFA2322D1ZI", state_code: "08" }, month: "2026-09", fy: "2026-27", stage: "blocked", running: { from: "2026-09-01", to: "2026-09-30" }, due: { gstr1: "2026-10-11", gstr3b: "2026-10-20", file_from: "2026-10-01" }, record: { gstr1: null, gstr1a: null, gstr3b: null, legacy: false, unlocked: null, relocked: null, locked_by: null, locked_on: null }, checks: { blockers: [duplicate], notes: [], passes: ["Every line has an HSN code and a GST rate"] }, gstr1: null, gstr3b: null, late: null, since_filing: null, amendments: null, amended_in: null, download: null, prev_gstr3b_missing: null, ...overrides };
}
// Output 300; opening 120; 4(A)(5) 100 − 4(B)(1) 20 = 4(C) 80.
// Available 200, used 200, cash 100, carry 0. Lapsed 30 stays outside 4(A).
function ledger(overrides: Partial<Gstr3b> = {}): Gstr3b {
  return { month: "2026-09", filed: false, as_filed_at: null, t31a: { bills: 2, taxable: 1000000, igst: 0, cgst: 15000, sgst: 15000, total: 30000 }, t31c: { taxable: 120000 }, amendments: null, t32: [], carry_in: { heads: heads(0, 6000, 6000), from: "2026-08", as_filed: true, opening: false }, t4a5: { bills: 2, heads: heads(0, 5000, 5000), late: [{ id: 77, bill_no: "JGE/1098", bill_date: "2026-02-18", entered_on: "2026-10-05", heads: heads(0, 4000, 4000) }] }, t4b1: { bills: 1, heads: heads(0, 1000, 1000), list: [{ id: 78, bill_no: "JGE/1099", supplier_name: "Jaipur Gem Exports", heads: heads(0, 1000, 1000) }] }, t4c: heads(0, 4000, 4000), t4d2: { bills: 1, heads: heads(0, 1500, 1500), list: [{ id: 79, bill_no: "JGE/1000", supplier_name: "Jaipur Gem Exports", heads: heads(0, 1500, 1500) }] }, t5: { inter: 0, intra: 120000 }, t5_note: "Includes purchases from unregistered suppliers with no GST charged.", reduction_on: heads(), reduction_note: null, interest_note: "worked out to today; check on the portal", available: heads(0, 10000, 10000), steps: [{ from: "cgst", to: "cgst", amount: 10000 }, { from: "sgst", to: "sgst", amount: 10000 }], used: heads(0, 10000, 10000), cash: heads(0, 5000, 5000), cash_paid: null, carry_on: heads(), to_confirm: [], cross_head: null, late: null, opening_missing: false, ...overrides };
}
afterEach(() => { (window as unknown as { __phone: boolean }).__phone = false; vi.useRealTimers(); });

it("shows the named blocker, exact paise, every returned bill and more count; only an editor gets Fix", () => {
  const onFix = vi.fn();
  const { unmount } = renderApp(<Checks month={month()} onFix={onFix} />);
  expect(screen.getByText(duplicate.text)).toBeVisible();
  expect(screen.getByText(/₹45,210.00/)).toBeVisible();
  expect(screen.getByText(/typed by hand/)).toBeVisible();
  expect(screen.getByText(/1 more bill/)).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Fix" }));
  expect(onFix).toHaveBeenCalledWith(duplicate);
  unmount();
  renderApp(<Checks month={month()} onFix={onFix} />, { me: { role: "viewer", permissions: ["view"] } });
  expect(screen.queryByRole("button", { name: "Fix" })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: /Open.*bills/ })).toBeVisible();
});

it("keeps B2B portal figures and links, with accessible seven-tab navigation", () => {
  const change = vi.fn();
  renderApp(<Gstr1Card data={sections} month={month()} section="b2b" onSection={change} />);
  const table = screen.getByRole("table", { name: /B2B bills/ });
  expect(within(table).getAllByText("₹1,030.00")).toHaveLength(2);
  expect(within(table).getByRole("link", { name: "KGH/2026-27/17" })).toHaveAttribute("href", "/sales/388");
  expect(screen.getAllByRole("tab")).toHaveLength(7);
  fireEvent.keyDown(screen.getByRole("tab", { name: /^B2B / }), { key: "ArrowRight" });
  expect(change).toHaveBeenCalledWith("b2cl");
});

it("keeps the diamond slab at 0.25%, displays nil Table 8, and exposes all three heads", () => {
  renderApp(<Gstr1Card data={sections} month={month()} section="b2c" onSection={vi.fn()} />);
  expect(screen.getByText("0.25%")).toBeVisible();
  expect(screen.getByRole("table", { name: /Nil-rated supplies/ })).toHaveTextContent("₹1,200.00");
  const row = within(screen.getByRole("table", { name: /B2C summary/ })).getAllByRole("row")[1];
  expect(row).toHaveTextContent("₹400.00₹0.00₹0.50₹0.50");
});

it("keeps CTM and exact filed quantity; exposes documents notes and deleted bill reasons", () => {
  const first = renderApp(<Gstr1Card data={sections} month={month()} section="hsn" onSection={vi.fn()} />);
  expect(screen.getByText("CTM")).toBeVisible();
  expect(screen.getByText("6.40")).toBeVisible();
  expect(screen.getByText(/PCS for pieces, NOS for numbers, CTM for carats/)).toBeVisible();
  expect(screen.queryByText(/no carat unit/)).not.toBeInTheDocument();
  first.unmount();
  const second = renderApp(<Gstr1Card data={sections} month={month()} section="docs" onSection={vi.fn()} />);
  expect(screen.getByText(sections.docs_notes[0])).toBeVisible();
  expect(screen.getByRole("table")).toHaveTextContent("18117");
  second.unmount();
  renderApp(<Gstr1Card data={sections} month={month()} section="cancelled" onSection={vi.fn()} />);
  expect(screen.getByText(/Entered twice by mistake/)).toBeVisible();
  expect(screen.getByText("Deleted · in the bin")).toBeVisible();
});

it("shows a phone HSN sheet with label/value lists and no wide table", () => {
  vi.useFakeTimers(); (window as unknown as { __phone: boolean }).__phone = true;
  renderApp(<Gstr1Card data={sections} month={month()} section="hsn" onSection={vi.fn()} phone />);
  fireEvent.click(screen.getByRole("button", { name: /HSN summary/ }));
  act(() => vi.advanceTimersByTime(400));
  const sheet = screen.getByRole("dialog", { name: "HSN summary" });
  expect(within(sheet).getByText("CTM · 6.40")).toBeVisible();
  expect(within(sheet).queryByRole("table")).not.toBeInTheDocument();
});

it("uses Circular 170's corrected rows and hand-worked ledger totals", () => {
  renderApp(<Gstr3bCard month={month()} data={ledger()} />);
  const rows = screen.getAllByRole("row");
  const row = (label: string) => rows.find((r) => r.textContent?.includes(label))!;
  expect(row("Credit not allowed")).toHaveTextContent("4(B)(1)");
  expect(row("Credit too late to claim")).toHaveTextContent("4(D)(2)");
  expect(row("Net credit")).toHaveTextContent("₹80.00");
  expect(row("Credit available")).toHaveTextContent("₹200.00");
  expect(row("Tax to pay in cash")).toHaveTextContent("₹100.00");
  expect(screen.getByText(/Output tax ₹300.00 − credit used ₹200.00/)).toHaveTextContent("₹100.00");
  expect(screen.getByText(/JGE\/1098, 18 Feb 2026/)).toBeVisible();
  expect(screen.getByText("3.1(c)")).toBeVisible();
  expect(screen.getByRole("heading", { name: /Exempt, nil-rated and non-GST purchases/ })).toHaveTextContent(/5$/);
});

it("shows as-filed cash separately without replacing its working, and empty/null states", () => {
  const { unmount } = renderApp(<Gstr3bCard month={month()} data={ledger({ filed: true, as_filed_at: "2026-10-19T17:02:11+05:30", cash_paid: heads(0, 5500, 5500) })} />);
  expect(screen.getByRole("heading", { name: "GSTR-3B · as filed" })).toBeVisible();
  const rows = screen.getAllByRole("row"); const row = (label: string) => rows.find((r) => r.textContent?.includes(label))!;
  expect(row("Tax worked out in cash")).toHaveTextContent("₹100.00");
  expect(row("Tax paid in cash (recorded)")).toHaveTextContent("₹110.00");
  expect(screen.queryByText(/^Tax paid in cash$/)).not.toBeInTheDocument();
  expect(screen.getByText(/Output tax ₹300.00 − credit used ₹200.00 = tax worked out in cash/)).toHaveTextContent("₹100.00");
  unmount();
  renderApp(<Gstr1Card data={{ ...sections, b2b: [] }} month={month()} section="b2b" onSection={vi.fn()} />);
  expect(screen.getByText("No bills to registered buyers in September")).toBeVisible();
});

it("keeps the complete ledger readable on a phone without a wide table", () => {
  (window as unknown as { __phone: boolean }).__phone = true;
  renderApp(<Gstr3bCard month={month()} data={ledger()} phone />);
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(screen.getByText("4(B)(1)")).toBeVisible();
  expect(screen.getAllByText("₹50.00").length).toBeGreaterThan(1);
});

it("shows mixed-rate B2CL once per bill and keeps each slab's taxable value and IGST", () => {
  const mixed = { ...sections, b2cl: [{ ...sections.b2cl[0], total: 20650125, rates: [{ rate: "3", taxable: 20000000, igst: 600000 }, { rate: "0.25", taxable: 50000, igst: 125 }] }] };
  renderApp(<Gstr1Card data={mixed} month={month()} section="b2cl" onSection={vi.fn()} />);
  const table = screen.getByRole("table", { name: /B2CL bills/ });
  const rows = within(table).getAllByRole("row");
  expect(rows[1]).toHaveTextContent("₹2,06,501.25");
  expect(rows[2]).toHaveTextContent("0.25%₹500.00₹1.25");
  expect(rows[3]).toHaveTextContent("₹2,00,500.00₹6,001.25");
  expect(within(table).getAllByRole("link", { name: "KGH/2026-27/18" })).toHaveLength(1);
});

it("shows the by-rate total and a correctly scoped link for the diamond bills", () => {
  renderApp(<Gstr1Card data={sections} month={month()} section="rate" onSection={vi.fn()} />);
  const table = screen.getByRole("table", { name: /Sales by GST rate/ });
  const rows = within(table).getAllByRole("row");
  expect(rows[1]).toHaveTextContent("0.25%₹400.00₹0.00₹0.50₹0.50₹1.00₹401.00");
  expect(within(table).getByRole("link", { name: "Open the 1 bill at 0.25%" })).toHaveAttribute("href", "/sales?firm=3&month=2026-09&gst_rate=0.25");
});

it("shows a total for both HSN groups without summing incompatible quantities", () => {
  renderApp(<Gstr1Card data={sections} month={month()} section="hsn" onSection={vi.fn()} />);
  const table = screen.getByRole("table", { name: /HSN totals/ });
  expect(table).toHaveTextContent("₹400.00₹0.00₹0.50₹0.50");
});

it("keeps as-filed controls optional and emits the choice without recalculating the snapshot", () => {
  const onAsFiled = vi.fn();
  const filing = { id: 81, business: 3, month: "2026-09", kind: "gstr1" as const, filed_on: "2026-10-10", arn: "", cash: null, cash_worked_out: null, late_fee: null, interest: null, credit_left: null, marked_by: { id: 1, name: "Kailash" }, marked_at: "2026-10-10T17:00:00+05:30", updated_by: null, updated_at: null, legacy: false };
  const recorded = month(); recorded.record.gstr1 = filing;
  renderApp(<Gstr1Card data={sections} month={recorded} section="b2b" onSection={vi.fn()} onAsFiled={onAsFiled} />);
  fireEvent.click(screen.getByRole("radio", { name: "As filed" }));
  expect(onAsFiled).toHaveBeenCalledWith(true);
});

it("shows zero credit, opening-credit link and hand-worked late fees without inventing figures", () => {
  const data = ledger({ steps: [], opening_missing: true, late: { gstr1: { days: 3, per_day: 5000, fee: 15000, cap: 500000, capped: false }, gstr3b: { days: 0, per_day: 5000, fee: 0, cap: 500000, capped: false }, interest: 0, interest_on: 10000, interest_from: "2026-10-21", turnover_band: "1.5cr_5cr", nil: { gstr1: false, gstr3b: false }, total: 15000 } });
  renderApp(<Gstr3bCard month={month()} data={data} />);
  expect(screen.getByText("No credit to use this month.")).toBeVisible();
  expect(screen.getByRole("link", { name: "See or change it under Credit and deadlines." })).toHaveAttribute("href", "/gst?tab=credit&firm=3");
  expect(screen.getByText(/GSTR-1: 3 days at ₹50.00 a day, capped at ₹5,000.00/)).toBeVisible();
  expect(screen.getAllByText("₹150.00").length).toBeGreaterThan(0);
});

it("keeps amendment head movements visible even when their total is zero", () => {
  renderApp(<Gstr3bCard month={month()} data={ledger({ amendments: { months: ["2026-08"], output: heads(10000, -5000, -5000), credit: heads(-2000, 1000, 1000) } })} />);
  const rows = screen.getAllByRole("row");
  const output = rows.find((row) => row.textContent?.includes("of which amendments to August"));
  expect(output).toHaveTextContent("₹100.00−₹50.00−₹50.00₹0.00");
  const credit = rows.find((row) => row.textContent?.includes("Amendments to August"));
  expect(credit).toHaveTextContent("−₹20.00₹10.00₹10.00₹0.00");
});

it("uses the selected as-filed bill count in the rate total instead of live books", () => {
  const recorded = monthFixture();
  recorded.gstr1!.bills = 3;
  recorded.gstr1!.as_filed = { bills: 2, taxable: 40000, tax: 100, at: "2026-10-10T17:00:00+05:30" };
  renderApp(<Gstr1Card data={sections} month={recorded} section="rate" onSection={vi.fn()} asFiled />);
  const rows = within(screen.getByRole("table", { name: /Sales by GST rate/ })).getAllByRole("row");
  const cells = within(rows[rows.length - 1]).getAllByRole("cell");
  expect(cells[cells.length - 1]).toHaveTextContent(/^2$/);
  expect(screen.getByText(/September 2026 · 2 sales bills · as filed/)).toBeVisible();
});


it("labels deleted check bills and links the owner to the bin ID instead of the original bill ID", () => {
  const deleted: Check = { ...duplicate, kind: "deleted", blocks: false, text: "A bill was deleted", detail: "It remains in Documents issued.", more_bills: 0, bills: [{ ...duplicate.bills[0], id: 388, bin_id: 4, status: "deleted" }] };
  const m = month({ checks: { blockers: [], notes: [deleted], passes: [] } });
  const view = renderApp(<Checks month={m} onFix={vi.fn()} />);
  expect(screen.getByText("Deleted", { exact: true })).toBeVisible();
  expect(screen.getByRole("link", { name: "Open the deleted bill" })).toHaveAttribute("href", "/audit?restore=4");
  expect(screen.queryByRole("link", { name: "Open the bill" })).not.toBeInTheDocument();
  view.unmount();
  delete (deleted.bills[0] as typeof duplicate.bills[0] & { bin_id?: number }).bin_id;
  renderApp(<Checks month={m} onFix={vi.fn()} />);
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
});

it("shows deleted check bills without a link for viewers and accountants who can only view audit", () => {
  const deleted: Check = { ...duplicate, kind: "deleted", blocks: false, text: "A bill was deleted", detail: "It remains in Documents issued.", more_bills: 0, bills: [{ ...duplicate.bills[0], id: 388, bin_id: 4, status: "deleted" }] };
  const m = month({ checks: { blockers: [], notes: [deleted], passes: [] } });
  const viewer = renderApp(<Checks month={m} onFix={vi.fn()} />, { me: { role: "viewer", permissions: ["view"] } });
  expect(screen.getByText("Deleted", { exact: true })).toBeVisible();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Open the Audit log" })).not.toBeInTheDocument();
  viewer.unmount();
  renderApp(<Checks month={m} onFix={vi.fn()} />, { me: { role: "accountant", permissions: ["view", "audit.view"] } });
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Open the Audit log" })).not.toBeInTheDocument();
});


it.each(["b2b", "b2cl", "cancelled"] as const)("routes deleted %s references to the owner's bin row and leaves other roles unlinked", (section) => {
  const bill = { ...duplicate.bills[0], id: 388, bin_id: 4, status: "deleted" as const };
  const data: Gstr1 = { ...sections, b2b: [{ ...sections.b2b[0], bill }], b2cl: [{ ...sections.b2cl[0], bill }], cancelled: [{ ...sections.cancelled[0], bill }] };
  const owner = renderApp(<Gstr1Card data={data} month={month()} section={section} onSection={vi.fn()} asFiled />);
  expect(screen.getByRole("link", { name: bill.invoice_number })).toHaveAttribute("href", "/audit?restore=4");
  expect(screen.getByText(section === "cancelled" ? "Deleted · in the bin" : "Deleted")).toBeVisible();
  owner.unmount();
  const viewer = renderApp(<Gstr1Card data={data} month={month()} section={section} onSection={vi.fn()} asFiled />, { me: { role: "viewer", permissions: ["view"] } });
  expect(screen.getByText(bill.invoice_number)).toBeVisible();
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  viewer.unmount();
  const accountant = renderApp(<Gstr1Card data={data} month={month()} section={section} onSection={vi.fn()} asFiled />, { me: { role: "accountant", permissions: ["view", "audit.view"] } });
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  if (section === "cancelled") expect(screen.getByText(/The owner can restore a deleted bill from the Audit log/)).toBeVisible();
  accountant.unmount();
  delete (bill as { bin_id?: number }).bin_id;
  renderApp(<Gstr1Card data={data} month={month()} section={section} onSection={vi.fn()} asFiled />);
  expect(screen.queryByRole("link", { name: bill.invoice_number })).not.toBeInTheDocument();
});


it.each([false, true])("shows April's combined portal HSN rows and exact two-decimal quantities (phone=%s)", (phone) => {
  const april = month({ month: "2025-04", fy: "2025-26" });
  const data = { ...sections, hsn: { b2b: [], b2c: [], data: [
    { ...sections.hsn.b2c[0], hsn: "711319", description: "Gold jewellery", uqc: "GMS", quantity: "512.35", taxable: 100000, igst: 0, cgst: 1500, sgst: 1500, rate: "3" },
    { ...sections.hsn.b2c[0], hsn: "9988", description: "Making service", uqc: "NA", quantity: "0.00", service: true },
  ] } };
  if (phone) { vi.useFakeTimers(); (window as unknown as { __phone: boolean }).__phone = true; }
  renderApp(<Gstr1Card data={data} month={april} section="hsn" onSection={vi.fn()} phone={phone} />);
  if (phone) {
    expect(screen.getByRole("button", { name: "HSN summary 2" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "HSN summary 2" }));
    act(() => vi.advanceTimersByTime(400));
  } else expect(screen.getByRole("tab", { name: "HSN 2" })).toBeVisible();
  expect(screen.getByRole("heading", { name: "All buyers" })).toBeVisible();
  expect(screen.getByText(phone ? "GMS · 512.35" : "512.35")).toBeVisible();
  expect(screen.getByText(phone ? "NA · 0.00" : "0.00")).toBeVisible();
  expect(screen.queryByRole("heading", { name: /B2B · bills/ })).not.toBeInTheDocument();
  expect(screen.getByText(/From May 2025, B2B and B2C are listed apart/)).toBeVisible();
  expect(screen.queryByText(/512.350/)).not.toBeInTheDocument();
  if (!phone) expect(screen.getByRole("table", { name: /HSN totals/ })).toHaveTextContent("₹1,400.00₹0.00₹15.50₹15.50");
  else expect(screen.getByText("₹1,400.00")).toBeVisible();
});

it("labels the downloadable GSTR-3B interest for the CA to check on the portal, only when interest is due on an unfiled month", () => {
  const late = { gstr1: { days: 0, per_day: 5000, fee: 0, cap: 200000, capped: false }, gstr3b: { days: 3, per_day: 5000, fee: 15000, cap: 200000, capped: false }, interest: 120, interest_on: 10000, interest_from: "2026-10-21", turnover_band: "upto_1.5cr" as const, nil: { gstr1: false, gstr3b: false }, total: 15120 };
  const note = "Interest in the GSTR-3B JSON: worked out to today; check on the portal.";
  const view = renderApp(<Gstr3bCard month={month()} data={ledger({ late })} />);
  expect(screen.getByText(note)).toBeVisible();
  view.unmount();
  const again = renderApp(<Gstr3bCard month={month()} data={ledger()} />);
  expect(screen.queryByText(note)).not.toBeInTheDocument();
  again.unmount();
  renderApp(<Gstr3bCard month={month()} data={ledger({ late, filed: true, as_filed_at: "2026-10-19T17:02:11+05:30" })} />);
  expect(screen.queryByText(note)).not.toBeInTheDocument();
});

it("shows 3A's recorded late costs, the carried 3.1(a) correction and the Table 5 note", () => {
  // R3A-4: a filed GSTR-3B's charges come from its record (days 0), so no day count or cap is shown.
  const late = { gstr1: { days: 0, per_day: 5000, fee: 0, cap: 200000, capped: false }, gstr3b: { days: 0, per_day: 5000, fee: 40000, cap: 200000, capped: false }, interest: 1250, interest_on: 10000, interest_from: "2026-10-21", turnover_band: "upto_1.5cr" as const, nil: { gstr1: false, gstr3b: false }, total: 41250, recorded: true as const };
  // R3A-2: CGST 60 of an earlier correction couldn't come off this month's 3.1(a), which stays at 0.
  const reduction_note = "₹0.60 of an earlier correction is taken off next month's tax.";
  renderApp(<Gstr3bCard month={month()} data={ledger({ late, filed: true, as_filed_at: "2026-10-19T17:02:11+05:30", reduction_on: heads(0, 60, 0), reduction_note })} />);
  expect(screen.getByRole("heading", { name: "Late fee and interest recorded" })).toBeVisible();
  expect(screen.getByText("As typed when GSTR-3B was marked filed.")).toBeVisible();
  expect(screen.getByText("₹400.00")).toBeVisible();
  expect(screen.getByText("₹12.50")).toBeVisible();
  expect(screen.queryByText(/days? at/)).not.toBeInTheDocument();
  expect(screen.getByText(reduction_note)).toBeVisible();
  expect(screen.getByText("Includes purchases from unregistered suppliers with no GST charged.")).toBeVisible();
});

it("does not count the firms in the explanation", () => {
  renderApp(<Gstr3bCard month={month()} data={ledger()} />);
  expect(screen.queryByText(/three firms/)).not.toBeInTheDocument();
});

it("checks: no 'All 0 pass', the restore hint without detail, and no dash for a missing bill total", () => {
  const deleted: Check = { ...duplicate, kind: "deleted", blocks: false, text: "A bill was deleted", detail: "", more_bills: 0, bills: [{ id: null, bin_id: 4, invoice_number: "KGH/2026-27/27", invoice_date: "2026-09-24", customer_name: "Walk-in Customer", status: "deleted" }] };
  renderApp(<Checks month={month({ checks: { blockers: [], notes: [deleted], passes: [] } })} onFix={vi.fn()} />);
  expect(screen.queryByText(/All 0 pass/)).not.toBeInTheDocument();
  expect(screen.getByText(/1 note/)).toBeVisible();
  expect(screen.getByText(/If it was a real sale, restore it from the Audit log/)).toBeVisible();
  expect(screen.getByText(/KGH\/2026-27\/27/)).not.toHaveTextContent("—");
});

it("B2B rows without a bill id keep unique keys", () => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  const bill = { ...duplicate.bills[0], id: null, bin_id: 4, status: "deleted" as const };
  renderApp(<Gstr1Card data={{ ...sections, b2b: [{ ...sections.b2b[0], bill }, { ...sections.b2b[0], bill: { ...bill, bin_id: 5 } }] }} month={month()} section="b2b" onSection={vi.fn()} />);
  expect(error.mock.calls.flat().join(" ")).not.toMatch(/same key/);
  error.mockRestore();
});
