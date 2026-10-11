import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { salesKeys } from "@/core/api/sales";
import { AuthContext, type Me } from "@/core/auth/AuthProvider";
import { refuse, salesServer, wireBin, wireDetail, wirePage, wireRow } from "@/core/sales/fixtures";
import { toSalesPage } from "@/core/sales/wire";
import { LOCKED_REASON } from "@/core/sales/words";
import { ToastProvider } from "@/core/ui";
import { renderApp, stubAuth } from "@/test/render";
import BillPage from "../BillPage";

const STAFF: Partial<Me> = { role: "staff", permissions: ["view", "bill.create", "bill.send", "customer.edit"] };
function Where() { const l = useLocation(); return <p data-testid="where">{`${l.pathname}${l.search}`}</p>; }
const mount = (path: string, me?: Partial<Me>) => renderApp(
  <Routes>
    <Route path="/sales/new" element={<Where />} />
    <Route path="/sales/:id" element={<><BillPage /><Where /></>} />
  </Routes>, { path, me });
const status = (text: string) => screen.getByText(text).closest("[role=status]") as HTMLElement;

afterEach(() => { (window as unknown as { __phone?: boolean }).__phone = false; vi.restoreAllMocks(); });

test("a bill's page: its number and firm, the exact total, the items, parties, what happened and the customer's other bills", async () => {
  const { calls } = salesServer([
    ["GET", "sales/412/", () => wireDetail()],
    ["GET", "sales/", () => wirePage([wireRow(), wireRow({ id: 300, invoice_number: "KGH/2026-27/12", invoice_date: "2026-08-14", total_amount: "45210.00", payment_mode: "bank" })])],
  ]);
  mount("/sales/412");
  expect(await screen.findByRole("heading", { level: 1, name: "KGH/2026-27/31" })).toBeInTheDocument();
  expect(screen.getByText("KIRAN GOLD HOUSE · Thursday, 08 Oct 2026 · 10:42")).toBeInTheDocument();
  // what the customer pays, exact to the paisa: nothing is rounded to the rupee, so there's no round-off to say (Ruling 1B-12)
  expect(screen.queryByText("Rounded off")).not.toBeInTheDocument();
  expect(screen.getByText("Total").parentElement).toHaveTextContent(/^Total₹87,083\.21$/);
  expect(screen.getByText("Eighty Seven Thousand Eighty Three Rupees and Twenty One Paise Only")).toBeInTheDocument();
  const items = screen.getByRole("table", { name: "Items on this bill" });
  expect(within(items).getByText("Peacock design")).toBeInTheDocument();
  expect(within(items).getByText("12.345 gms")).toBeInTheDocument();
  expect(within(items).queryByText("Making")).not.toBeInTheDocument();
  expect(screen.getByText(/^Place of supply/)).toHaveTextContent("Place of supply Rajasthan (08) · local, so CGST + SGST: handed over in Rajasthan · Reverse charge: No · GSTR-1: B2C");
  const activity = screen.getByRole("list", { name: "What happened to this bill" });
  expect(activity).toHaveTextContent("Made the bill by Rakesh Soni");
  expect(activity).toHaveTextContent("08 Oct · 10:42");
  expect(screen.getByText("KGH_2026-27_31.pdf")).toBeInTheDocument();
  expect(await screen.findByRole("link", { name: /^KGH\/2026-27\/12/ })).toHaveAttribute("href", "/sales/300");
  expect(screen.getByText("1 bill in all years · ₹45,210.00")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "All of Anil Gupta's bills" })).toHaveAttribute("href", "/sales?customer=7&all=1");
  expect(calls.find((c) => c.url === "sales/")?.params).toEqual({ customer_id: 7, ordering: "-date", page: 1, page_size: 6 });
});

test("a bill already in a list names its page before its own answer comes", () => {
  salesServer([["GET", "sales/77/", () => new Promise(() => {})]]);
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  qc.setQueryData(salesKeys.list("all", {}), { pages: [toSalesPage(wirePage([wireRow({ id: 77, invoice_number: "KGH/2026-27/77" })]))], pageParams: [1] });
  render(
    <QueryClientProvider client={qc}><AuthContext.Provider value={stubAuth()}>
      <MemoryRouter initialEntries={["/sales/77"]}><ToastProvider><Routes><Route path="/sales/:id" element={<BillPage />} /></Routes></ToastProvider></MemoryRouter>
    </AuthContext.Provider></QueryClientProvider>,
  );
  expect(screen.getByRole("heading", { level: 1, name: "KGH/2026-27/77" })).toBeInTheDocument();
  expect(document.title).toBe("KGH/2026-27/77 · GST Billing");
  expect(screen.getByRole("status", { name: "Loading the bill" })).toBeInTheDocument();
});

test("a cancelled bill says so and offers Make it again; sending and editing aren't offered", async () => {
  salesServer([["GET", "sales/412/", () => wireDetail({ status: "cancelled", cancel_reason: "Customer returned it", cancelled_at: "2026-10-08T15:02:11+05:30", cancelled_by: { id: 1, name: "Kailash Mehta" } })]]);
  mount("/sales/412");
  await screen.findByText("This bill is cancelled");
  const banner = status("This bill is cancelled");
  expect(banner).toHaveTextContent("“Customer returned it”. It stays in October 2026's GSTR-1 as cancelled, with its number. Its amount isn't in sales or the GST figures. Make it again opens a new bill with the same customer, items and payment.");
  expect(screen.getByText("Total when issued")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^Send/ })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Edit" })).not.toBeInTheDocument();
  await userEvent.click(within(banner).getByRole("button", { name: "Make it again" }));
  expect(await screen.findByTestId("where")).toHaveTextContent("/sales/new?remake=412");
});

test("what needs a look: a number used twice, heads that don't match (fixed in place), and the income-tax check with its fix on the customer", async () => {
  const dup = { id: 388, invoice_number: "KGH/2026-27/31", invoice_date: "2026-09-10", customer_name: "Hemant Dave", status: "active" };
  const pan = { kind: "pan", short: "PAN missing", text: "A bill over ₹2,00,000 needs the buyer's PAN (Rule 114B). Add Anil Gupta's PAN." };
  let fixed = false;
  const { calls } = salesServer([
    ["GET", "sales/412/", () => wireDetail({ checks: fixed ? ["duplicate"] : ["duplicate", "heads_mismatch"], duplicates: [dup], itax: [pan], ...(fixed ? {} : { igst: "2536.40", cgst: "0.00", sgst: "0.00" }) })],
    ["POST", "sales/412/fix-heads/", () => { fixed = true; return wireDetail({ checks: ["duplicate"], duplicates: [dup], itax: [pan] }); }],
  ]);
  mount("/sales/412");
  await screen.findByText("Bill number KGH/2026-27/31 is used twice in KIRAN GOLD HOUSE");
  const twice = status("Bill number KGH/2026-27/31 is used twice in KIRAN GOLD HOUSE");
  expect(twice).toHaveTextContent("It shares the number with Hemant Dave's bill of 10 Sep 2026. October's GSTR-1 can't be filed until one of them gets a new number.");
  expect(within(twice).getByRole("link", { name: "Open the other bill" })).toHaveAttribute("href", "/sales/388");
  await userEvent.click(within(status("Tax is under IGST, but this is a local sale")).getByRole("button", { name: "Fix the tax heads" }));
  await waitFor(() => expect(calls.some((c) => c.url === "sales/412/fix-heads/")).toBe(true));
  expect(await screen.findByText("Tax heads fixed on KGH/2026-27/31")).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText("Tax is under IGST, but this is a local sale")).not.toBeInTheDocument());
  const itax = status("The buyer's PAN is missing");
  expect(itax).toHaveTextContent("A bill over ₹2,00,000 needs the buyer's PAN (Rule 114B). Add Anil Gupta's PAN.");
  expect(within(itax).getByRole("link", { name: "Add PAN" })).toHaveAttribute("href", "/customers/7/edit?focus=pan");
});

test("right after a save the panel owns the next step, Send on WhatsApp, focused; a paper bill's is the next paper bill", async () => {
  salesServer([
    ["GET", "sales/412/", () => wireDetail()],
    ["GET", "sales/413/", () => wireDetail({ id: 413, invoice_number: "KGH/2026-27/34", counter: 34, paper: true, invoice_date: "2026-09-30" })],
    ["GET", "sales/paper-book/", () => ({ business: 3, month: "2026-09", fy: "2026-27", bills: [], entered: 1, runs: [[34, 34]], missing: [], explained: [], twice: [], after: [], after_months: [],
      next: { counter: 35, invoice_number: "KGH/2026-27/35", invoice_date: "2026-09-30" }, locked: false, gstr1_due: "2026-10-11" })],
  ]);
  const view = mount("/sales/412?saved=new");
  await screen.findByText("Saved KGH/2026-27/31");
  const panel = status("Saved KGH/2026-27/31");
  // the exact total, as the bill prints it (Ruling 1B-12)
  expect(panel).toHaveTextContent("₹87,083.21 · Anil Gupta. Send it now, or print it.");
  await waitFor(() => expect(within(panel).getByRole("button", { name: "Send on WhatsApp" })).toHaveFocus());
  // Send is said once: the header leaves it to the panel
  expect(screen.getAllByRole("button", { name: /^Send/ })).toHaveLength(1);
  view.unmount();
  mount("/sales/413?saved=new");
  await screen.findByText("Saved KGH/2026-27/34");
  const paper = status("Saved KGH/2026-27/34");
  expect(paper).toHaveTextContent("From the paper book, dated 30 Sep 2026: ₹87,083.21 · Anil Gupta. It goes into September's GSTR-1.");
  expect(await within(paper).findByRole("link", { name: "Next paper bill · 35" })).toHaveAttribute("href", "/sales/new?paper=1&firm=3&date=2026-09-30&number=35");
  expect(within(paper).getByRole("link", { name: "Back to the paper book" })).toHaveAttribute("href", "/sales/paper?firm=3&month=2026-09");
});

test("a deleted bill's page says when, who and why; the owner restores it, and the bill comes back", async () => {
  let back = false;
  const { calls } = salesServer([
    ["GET", "sales/205/", () => (back ? wireDetail({ id: 205, invoice_number: "KGH/2026-27/27" }) : refuse(404, { detail: "This bill was deleted.", code: "deleted", binned: wireBin() }))],
    ["POST", "bin/4/restore/", () => { back = true; return wireDetail({ id: 205, invoice_number: "KGH/2026-27/27" }); }],
  ]);
  mount("/sales/205");
  await screen.findByText("This bill was deleted");
  const banner = status("This bill was deleted");
  expect(banner).toHaveTextContent("Walk-in Customer · ₹45,000.00. Deleted on 03 Oct 2026 at 18:40 by Kailash Mehta, because “Entered twice by mistake”. Its number stays used. Restoring puts it back in Sales and in its month's GST figures.");
  await userEvent.click(within(banner).getByRole("button", { name: "Restore it" }));
  await waitFor(() => expect(calls.some((c) => c.url === "bin/4/restore/")).toBe(true));
  expect(await screen.findByText("Restored KGH/2026-27/27")).toBeInTheDocument();
  expect(await screen.findByText("Payment and sending")).toBeInTheDocument();
  expect(screen.queryByText("This bill was deleted")).not.toBeInTheDocument();
});

test("a bill that was never there says so, with the way to Sales", async () => {
  salesServer([["GET", "sales/999/", () => refuse(404, { detail: "No Invoice matches the given query." })]]);
  mount("/sales/999");
  expect(await screen.findByText("This bill isn't here")).toBeInTheDocument();
  expect(screen.getByText("No sales bill has the id “999”. It may have been deleted; deleted bills can be restored from the Audit log.")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Go to Sales" })).toHaveAttribute("href", "/sales");
});

test("on a phone the bar holds Edit, Print, More and Send; counter staff get no dead Edit, and the note says why", async () => {
  (window as unknown as { __phone?: boolean }).__phone = true;
  salesServer([["GET", "sales/412/", () => wireDetail()]]);
  const view = mount("/sales/412");
  expect(await screen.findByRole("heading", { level: 1, name: "Bill KGH/2026-27/31" })).toBeInTheDocument();
  let bar = document.querySelector("[data-actionbar]") as HTMLElement;
  expect(within(bar).getAllByRole("link").map((a) => a.textContent)).toEqual(["Edit", "Print"]);
  expect(within(bar).getByRole("button", { name: "More for KGH/2026-27/31" })).toBeInTheDocument();
  expect(within(bar).getByRole("button", { name: "Send" })).toBeInTheDocument();
  view.unmount();
  mount("/sales/412", STAFF);
  await screen.findByRole("heading", { level: 1, name: "Bill KGH/2026-27/31" });
  bar = document.querySelector("[data-actionbar]") as HTMLElement;
  expect(within(bar).getAllByRole("link").map((a) => a.textContent)).toEqual(["Print"]);
  expect(screen.getByText("Signed in as counter staff: you can send and print this bill. Editing, cancelling and deleting are for the owner.")).toBeInTheDocument();
});

/* ── Beyond the brief: the rulings and carries that came after it ── */

const SETTINGS = { copies: "original", show_bank: true, share_message: "", updated_at: null, updated_by: null };
const SENT = { at: "2026-10-08T12:31:00+05:30", last_at: "2026-10-08T12:31:00+05:30", count: 1, via: "whatsapp", to: "" };

test.each([
  ["the header's", "Send again", "/sales/412", false, "Send on WhatsApp"],
  ["the saved panel's", "Send again", "/sales/412?saved=new", false, "Send on WhatsApp"],
  ["the phone bar's", "Resend", "/sales/412", true, "Send"],
])("%s Send waits for the shop's WhatsApp message, sends once on a double click even when the record lands between the clicks, and reads %s in its place", async (_where, after, path, phone, before) => {
  (window as unknown as { __phone?: boolean }).__phone = phone;
  vi.spyOn(window, "open").mockImplementation(() => null);
  let settings: (w: unknown) => void = () => {};
  let sent: typeof SENT | null = null;
  // the record answers at once: on a quick connection it lands between a double click's two clicks
  const { calls } = salesServer([
    ["GET", "sales/412/", () => wireDetail({ sent })],
    ["GET", "shop-settings/", () => new Promise((resolve) => { settings = resolve; })],
    ["POST", "sales/412/sent/", () => { sent = SENT; return { id: 412, sent: SENT }; }],
  ]);
  mount(path);
  const send = await screen.findByRole("button", { name: before });
  // until the shop's own message is in, so it never goes with the standard one instead
  expect(send).toBeDisabled();
  await act(async () => { settings(SETTINGS); });
  await waitFor(() => expect(send).toBeEnabled());
  await userEvent.dblClick(send);
  expect(window.open).toHaveBeenCalledTimes(1);
  expect(await screen.findByText("KGH/2026-27/31 sent")).toBeInTheDocument();
  expect(calls.filter((c) => c.url === "sales/412/sent/")).toHaveLength(1);
  expect(screen.getByRole("button", { name: after })).toBe(send);
});

test("an unsent paper bill never asks to be sent: it's On paper, its copy goes from More on a phone, and its saved edit offers Print", async () => {
  const PAPER = { id: 413, invoice_number: "KGH/2026-27/34", counter: 34, paper: true, invoice_date: "2026-09-30" };
  salesServer([["GET", "sales/413/", () => wireDetail(PAPER)]]);
  let view = mount("/sales/413");
  await screen.findByRole("heading", { level: 1, name: "KGH/2026-27/34" });
  expect(screen.getByText("On paper")).toBeInTheDocument();
  expect(screen.queryByText("Not sent yet")).not.toBeInTheDocument();
  expect(screen.getByText("No need: the customer has the paper bill")).toBeInTheDocument();
  // a copy can still go, but nothing is the main step
  expect(screen.getByRole("button", { name: "Send a copy" })).toHaveAttribute("data-variant", "secondary");
  expect(screen.getByRole("link", { name: "Print and share" })).toHaveAttribute("data-variant", "secondary");
  view.unmount();
  (window as unknown as { __phone?: boolean }).__phone = true;
  view = mount("/sales/413");
  await screen.findByRole("heading", { level: 1, name: "Bill KGH/2026-27/34" });
  expect(screen.getByText("On paper")).toBeInTheDocument();
  const bar = document.querySelector("[data-actionbar]") as HTMLElement;
  expect(within(bar).queryByRole("button", { name: /^Send|^Resend/ })).not.toBeInTheDocument();
  view.unmount();
  (window as unknown as { __phone?: boolean }).__phone = false;
  mount("/sales/413?saved=edit");
  await screen.findByText("Changes saved");
  const panel = status("Changes saved");
  expect(panel).toHaveTextContent("Written to the audit log, with what changed.");
  expect(within(panel).getByRole("link", { name: "Print" })).toHaveAttribute("href", "/sales/413/print");
  expect(within(panel).queryByRole("button")).not.toBeInTheDocument();
});

test("in a filed month the e-way bill and Renumber are locked with the reason, as the menu has them; an open month's e-way bill can be changed, its number in fours", async () => {
  const dup = { id: 388, invoice_number: "KGH/2026-27/31", invoice_date: "2026-09-10", customer_name: "Hemant Dave", status: "active" };
  const EWAY = { eway_bill_number: "", transporter_name: "Shree Transport", transporter_gstin: "", vehicle_number: "RJ14AB1234", vehicle_type: "Regular", transport_mode: "Road", distance_km: 120, may_be_needed: true };
  salesServer([
    ["GET", "sales/412/", () => wireDetail({ locked: true, checks: ["duplicate"], duplicates: [dup], eway: EWAY,
      // v2's Excel import made it: its history says so, and no made-up "Made the bill" goes under it
      history: { created_by: { id: 1, name: "Kailash Mehta" }, activity: [{ at: "2026-10-09T11:20:00+05:30", by: "Kailash Mehta", action: "imported", details: "Imported from Excel (2 items, total: 87083.21)" }] } })],
    ["GET", "sales/414/", () => wireDetail({ id: 414, invoice_number: "KGH/2026-27/35", eway: { ...EWAY, eway_bill_number: "123456789012", may_be_needed: false } })],
  ]);
  const view = mount("/sales/412");
  await screen.findByText("October 2026 is filed and locked");
  const add = within(status("An e-way bill may be needed")).getByRole("button", { name: "Add the e-way bill" });
  expect(add).toBeDisabled();
  expect(add).toHaveAttribute("title", LOCKED_REASON);
  const card = screen.getByRole("region", { name: "E-way bill" });
  expect(within(card).getByRole("button", { name: "Edit" })).toBeDisabled();
  expect(within(card).getByRole("button", { name: "Edit" })).toHaveAttribute("title", LOCKED_REASON);
  const renumber = within(status("Bill number KGH/2026-27/31 is used twice in KIRAN GOLD HOUSE")).getByRole("button", { name: "Renumber this one" });
  expect(renumber).toBeDisabled();
  expect(renumber).toHaveAttribute("title", LOCKED_REASON);
  const activity = screen.getByRole("list", { name: "What happened to this bill" });
  expect(activity).toHaveTextContent("Imported from Excel by Kailash Mehta");
  expect(activity).not.toHaveTextContent("Made the bill");
  view.unmount();
  mount("/sales/414");
  const open = await screen.findByRole("region", { name: "E-way bill" });
  expect(within(open).getByText("1234 5678 9012")).toBeInTheDocument();
  expect(within(open).getByRole("button", { name: "Edit" })).toBeEnabled();
});

test("a bill that doesn't load says so, and Try again asks for it again", async () => {
  let down = true;
  const { calls } = salesServer([["GET", "sales/412/", () => (down ? refuse(500, {}) : wireDetail())]]);
  mount("/sales/412");
  expect(await screen.findByText("Couldn't load this bill")).toBeInTheDocument();
  down = false;
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByRole("heading", { level: 1, name: "KGH/2026-27/31" })).toBeInTheDocument();
  expect(calls.filter((c) => c.url === "sales/412/")).toHaveLength(2);
});

test("the customer's other bills that don't load say so, and Try again asks for them again", async () => {
  let down = true;
  const { calls } = salesServer([
    ["GET", "sales/412/", () => wireDetail()],
    ["GET", "sales/", () => (down ? refuse(500, {}) : wirePage([wireRow(), wireRow({ id: 300, invoice_number: "KGH/2026-27/12", invoice_date: "2026-08-14", total_amount: "45210.00" })]))],
  ]);
  mount("/sales/412");
  const card = await screen.findByRole("region", { name: "Other bills for Anil Gupta" });
  expect(await within(card).findByText(/^Couldn't load them just now\./)).toBeInTheDocument();
  down = false;
  await userEvent.click(within(card).getByRole("button", { name: "Try again" }));
  expect(await within(card).findByRole("link", { name: /^KGH\/2026-27\/12/ })).toHaveAttribute("href", "/sales/300");
  expect(calls.filter((c) => c.url === "sales/")).toHaveLength(2);
});
