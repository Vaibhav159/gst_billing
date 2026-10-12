import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useLocation } from "react-router";
import { renderApp } from "@/test/render";
import { serve } from "@/test/server";
import { creditWire } from "@/core/gst/creditFixtures";
import { CreditView } from "./CreditView";

const firms = [{ id: 3, name: "KIRAN GOLD HOUSE", gst_number: "08VRHFA2322D1ZI" }, { id: 1, name: "MEERA ORNAMENTS", gst_number: "08ABCDE1234F1Z5" }];
const label = "Claim JGE/1098's credit in";
function Location() { const l = useLocation(); return <output aria-label="Location">{l.pathname + l.search}</output>; }
afterEach(() => { cleanup(); vi.restoreAllMocks(); (window as unknown as { __phone: boolean }).__phone = false; });

describe("Credit and deadlines", () => {
  it.each([false, true])("shows credit before the ledger on its own line with its count (phone=%s)", async phone => {
    (window as unknown as { __phone: boolean }).__phone = phone;
    serve({ "GET businesses/": firms, "GET gst/credit/": { ...creditWire, fy: "2024-25",
      at_risk: { deadline: null, days_left: null, tax: "0.00", count: 0, bills: [] }, others_at_risk: [],
      buckets: { ...creditWire.buckets, fy: "2024-25", deadline: "2025-11-30", days_left: -312,
        claimed: { bills: 0, tax: "0.00" }, open: { bills: 0, tax: "0.00" }, lapsed: { bills: 0, tax: "0.00" },
        before_ledger: { count: 2, tax: "1234.56" }, none: [],
      },
    } });
    renderApp(<CreditView businessId={3} fy="2024-25" />);
    const card = await screen.findByRole("region", { name: "Credit on FY 2024-25 purchase bills" });
    const line = within(card).getByText(/Before the app's ledger/);
    expect(line).toHaveTextContent("Before the app's ledger (April 2025): ₹1,234.56. This credit is in your opening balance, or it has lapsed.");
    expect(line).toHaveTextContent("2 purchase bills");
    expect(within(card).getByText(/nothing lapsed/)).toBeVisible();
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  });
  it("ports the server's deadline, bill and bucket figures and opening anchor", async () => {
    serve({ "GET businesses/": firms, "GET gst/credit/": creditWire });
    renderApp(<CreditView businessId={3} fy="2026-27" />);
    await screen.findByRole("table", { name: "Purchase bills with credit at risk" });
    expect(screen.getByText(/1 purchase bill · ₹902.40 of credit/)).toBeVisible();
    expect(screen.getByRole("option", { name: /November 2026.*after the last day/ })).toBeDisabled();
    expect(screen.getByText(/No credit on 1 bill/)).toHaveTextContent("Local Supplier (XYZ/18, credit not allowed)");
    expect(screen.getByRole("region", { name: "Credit carried into FY 2025-26" })).toHaveAttribute("id", "opening");
    expect(screen.getByRole("region", { name: "Credit carried into FY 2025-26" })).toHaveTextContent("Changing this moves the credit in every month before June 2025; that month's GSTR-3B is filed, so its figures stay as filed.");
    expect(screen.getByRole("region", { name: "Credit on FY 2026-27 purchase bills" })).toHaveTextContent("30 Nov 2027");
    expect(screen.getByRole("region", { name: "Credit on FY 2026-27 purchase bills" })).toHaveTextContent("418 days left");
    expect(screen.getByRole("region", { name: "Last year's credit to claim · by 30 Nov 2026" })).toBeVisible();
    expect(screen.getByText(/April 2025 ended with ₹16,000.00 carried on/)).toBeVisible();
    expect(screen.getByRole("button", { name: "Edit opening credit" })).toBeEnabled();
  });
  it.each([
    ["2025-04", "Changing this moves the credit in every month before April 2025; that month's GSTR-3B is filed, so its figures stay as filed."],
    [null, "Changing this moves the credit in every month."],
  ] as const)("shows the server's first filed month %s to a viewer without a privileged preview", async (first_filed_3b, words) => {
    const calls = serve({ "GET businesses/": firms, "GET gst/credit/": { ...creditWire, opening: { ...creditWire.opening, first_filed_3b } } });
    renderApp(<CreditView businessId={3} fy="2026-27" />, { me: { role: "viewer", permissions: ["view"] } });
    const card = await screen.findByRole("region", { name: "Credit carried into FY 2025-26" });
    expect(card).toHaveTextContent(words);
    expect(card).not.toHaveTextContent("A change here moves only the months before the first filed GSTR-3B.");
    expect(calls.every(c => c.method === "GET")).toBe(true);
    expect(calls.some(c => c.url === "gst/opening-credit/")).toBe(false);
    expect(screen.queryByRole("button", { name: "Edit opening credit" })).not.toBeInTheDocument();
  });
  it.each([
    ["accountant", ["view", "gst.file", "purchase.edit"], true],
    ["staff", ["view", "purchase.create"], false],
    ["viewer", ["view"], null],
  ] as const)("gates mutations for %s", async (role, permissions, allowed) => {
    serve({ "GET businesses/": firms, "GET gst/credit/": creditWire });
    renderApp(<CreditView businessId={3} fy="2026-27" />, { me: { role, permissions: [...permissions] } });
    await screen.findByRole("table");
    expect(screen.queryByRole("button", { name: "Edit opening credit" })).not.toBeInTheDocument();
    if (allowed === null) expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
    else if (allowed) expect(screen.getByLabelText(label)).toBeEnabled();
    else expect(screen.getByLabelText(label)).toBeDisabled();
  });
  it("moves credit through part 2 and refreshes the server-owned selected month", async () => {
    let moved = false;
    const calls = serve({ "GET businesses/": firms,
      "GET gst/credit/": () => ({ status: 200, data: moved ? { ...creditWire, at_risk: { ...creditWire.at_risk, bills: [{ ...creditWire.at_risk.bills[0], credit_month: "2026-09" }] } } : creditWire }),
      "PUT purchases/77/credit-month/": () => { moved = true; return { status: 200, data: {} }; },
    });
    renderApp(<CreditView businessId={3} fy="2026-27" />);
    fireEvent.change(await screen.findByLabelText(label), { target: { value: "2026-09" } });
    await waitFor(() => expect(screen.getByLabelText(label)).toHaveValue("2026-09"));
    expect(calls.filter(c => c.method === "PUT").map(c => c.data)).toEqual([{ itc_month: "2026-09" }]);
    expect(calls.filter(c => c.url === "gst/credit/")).toHaveLength(2);
  });
  it.each([400, 409, 0])("preserves the prior month when moving credit fails with %s", async status => {
    const message = status === 400 ? "Choose an open credit month." : "Have the owner unlock September in GST returns first.";
    const calls = serve({ "GET businesses/": firms, "GET gst/credit/": creditWire,
      "PUT purchases/77/credit-month/": () => ({ status, data: status === 400 ? { itc_month: [message] } : { code: "month_closed", detail: message } }),
    });
    renderApp(<CreditView businessId={3} fy="2026-27" />);
    await screen.findByLabelText(label);
    if (!status) vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    fireEvent.change(screen.getByLabelText(label), { target: { value: "2026-09" } });
    await screen.findByRole("alert");
    expect(screen.getByLabelText(label)).toHaveValue("2026-10");
    expect(screen.getByRole("alert")).toHaveTextContent(status ? message : "You're offline, so this wasn't saved");
    if (status === 400) expect(screen.getByLabelText(label)).toHaveAttribute("aria-invalid", "true");
    expect(calls.filter(c => c.method === "PUT")).toHaveLength(1);
  });
  it("keeps phone bill links separate from credit selectors", async () => {
    (window as unknown as { __phone: boolean }).__phone = true;
    serve({ "GET businesses/": firms, "GET gst/credit/": creditWire });
    renderApp(<><CreditView businessId={3} fy="2026-27" /><Location /></>);
    await screen.findByLabelText(label);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Jaipur Gem Exports.*JGE\/1098/ });
    expect(within(link).queryByRole("combobox")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show Meera" }));
    expect(screen.getByLabelText("Location")).toHaveTextContent("/gst?tab=credit&firm=1&fy=2026-27");
  });
  it("shows no-risk copy without dropping another firm's warning", async () => {
    serve({ "GET businesses/": firms, "GET gst/credit/": { ...creditWire, at_risk: { deadline: null, days_left: null, tax: "0.00", count: 0, bills: [] } } });
    renderApp(<CreditView businessId={3} fy="2026-27" />);
    await screen.findByText("No credit at risk for KIRAN GOLD HOUSE");
    expect(screen.getByRole("button", { name: "Show Meera" })).toBeVisible();
  });
  it("does not call lapsed credit claimed and focuses the opening link", async () => {
    serve({ "GET businesses/": firms, "GET gst/credit/": { ...creditWire,
      at_risk: { deadline: null, days_left: null, tax: "0.00", count: 0, bills: [] },
      buckets: { ...creditWire.buckets, fy: "2025-26", deadline: "2026-11-30", days_left: -1, claimed: { bills: 0, tax: "0.00" }, open: { bills: 0, tax: "0.00" }, lapsed: { bills: 1, tax: "902.40" } },
    } });
    renderApp(<CreditView businessId={3} fy="2025-26" />, { path: "/gst?tab=credit&firm=3#opening" });
    await screen.findByText("No credit at risk for KIRAN GOLD HOUSE");
    expect(screen.queryByText(/Every purchase bill from last year is in a filed return/)).not.toBeInTheDocument();
    expect(screen.getByText(/past the deadline: this credit can't be claimed/)).toBeVisible();
    expect(screen.getByRole("region", { name: "Credit carried into FY 2025-26" }).parentElement).toHaveFocus();
  });
  it("shows the opening audit day in IST across UTC midnight", async () => {
    serve({ "GET businesses/": firms, "GET gst/credit/": { ...creditWire, opening: { ...creditWire.opening, updated_at: "2026-10-07T22:00:00Z" } } });
    renderApp(<CreditView businessId={3} fy="2026-27" />);
    expect(await screen.findByText(/Last changed by Kailash Mehta/)).toHaveTextContent("08 Oct 2026");
  });
  it("shows failed reads as errors rather than an empty credit balance", async () => {
    serve({ "GET businesses/": firms, "GET gst/credit/": () => ({ status: 403, data: { detail: "Access refused." } }) });
    renderApp(<CreditView businessId={3} fy="2026-27" />);
    await screen.findByText("Access refused.");
    expect(screen.queryByText(/No credit at risk/)).not.toBeInTheDocument();
  });
  it("describes every at-risk bill in the banner with the server's too-late flag for its month", async () => {
    const [bill] = creditWire.at_risk.bills;
    const late = { ...bill, id: 78, bill_no: "JGE/1102", tax: "100.00", credit_month: "2026-11", credit_month_due: "2026-12-20" };
    serve({ "GET businesses/": firms, "GET gst/credit/": { ...creditWire, at_risk: { ...creditWire.at_risk, tax: "1002.40", count: 2, bills: [bill, late] } } });
    renderApp(<CreditView businessId={3} fy="2026-27" />);
    await screen.findByRole("table");
    expect(screen.getByText(/JGE\/1098 is set to go in October 2026's GSTR-3B, due 20 Nov 2026: in time/)).toBeVisible();
    expect(screen.getByText(/JGE\/1102 is set to go in November 2026's GSTR-3B, due after the last day/)).toBeVisible();
  });
  it("names the opening FY and first month from the server rather than fixed words", async () => {
    const opening = { ...creditWire.opening, as_of: "2024-04-01", carried_out_of_first_month: { ...creditWire.opening.carried_out_of_first_month, month: "2024-04" } };
    serve({ "GET businesses/": firms, "GET gst/credit/": { ...creditWire, opening } });
    renderApp(<CreditView businessId={3} fy="2026-27" />);
    const card = await screen.findByRole("region", { name: "Credit carried into FY 2024-25" });
    expect(card).toHaveTextContent("April 2024's return starts from this");
    expect(card).toHaveTextContent("April 2024 ended with ₹16,000.00 carried on.");
  });
  it("hides the claim selector by permission, not by role name", async () => {
    serve({ "GET businesses/": firms, "GET gst/credit/": creditWire });
    renderApp(<CreditView businessId={3} fy="2026-27" />, { me: { role: "accountant", permissions: ["view"] } });
    await screen.findByRole("table");
    expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
  });
  it("offers a link to every other firm with credit at risk", async () => {
    const third = { id: 4, name: "RAJ JEWELS", gst_number: "08AAAAA0000A1Z5" };
    serve({ "GET businesses/": [...firms, third], "GET gst/credit/": { ...creditWire, others_at_risk: [...creditWire.others_at_risk, { business: 4, short: "Raj", count: 2 }] } });
    renderApp(<><CreditView businessId={3} fy="2026-27" /><Location /></>);
    await screen.findByRole("table");
    expect(screen.getByRole("button", { name: "Show Meera" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Show Raj" }));
    expect(screen.getByLabelText("Location")).toHaveTextContent("/gst?tab=credit&firm=4&fy=2026-27");
  });
});
