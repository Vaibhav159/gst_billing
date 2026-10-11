import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { queryClient as appClient } from "@/core/api/query";
import { billQuery, invalidateSales, salesKeys, type BillOutcome } from "@/core/api/sales";
import { AuthContext, type Me } from "@/core/auth/AuthProvider";
import { RoleContext } from "@/core/auth/role";
import { Refusal, refuse, salesServer, wireBin, wireDetail, wirePage, wireRow } from "@/core/sales/fixtures";
import { toBillDetail, toPaperBook, toSalesPage } from "@/core/sales/wire";
import { LOCKED_REASON } from "@/core/sales/words";
import { ToastProvider } from "@/core/ui";
import { renderApp, stubAuth, testQueryClient } from "@/test/render";
import BillPage from "../BillPage";

// plan 1E: a send makes the bill's PDF (core/print's own tests make real ones); here a stand-in
vi.mock("@/core/print/make", async (real) => ({
  ...(await real<typeof import("@/core/print/make")>()),
  billFile: vi.fn(async () => ({ blob: new Blob(["%PDF-1.3"], { type: "application/pdf" }), name: "bill.pdf", sheets: 1 })),
}));

const STAFF: Partial<Me> = { role: "staff", permissions: ["view", "bill.create", "bill.send", "customer.edit"] };
function Where() { const l = useLocation(); return <p data-testid="where">{`${l.pathname}${l.search}`}</p>; }
const mount = (path: string, me?: Partial<Me>) => renderApp(
  <Routes>
    <Route path="/sales/new" element={<Where />} />
    <Route path="/sales/:id" element={<><BillPage /><Where /></>} />
  </Routes>, { path, me });
const status = (text: string) => screen.getByText(text).closest("[role=status]") as HTMLElement;

afterEach(() => { (window as unknown as { __phone?: boolean }).__phone = false; vi.restoreAllMocks(); vi.unstubAllGlobals(); act(() => { onlineManager.setOnline(true); }); appClient.clear(); });
// plan 1E: a send downloads its PDF beside the chat; jsdom (no object URLs, no downloads) clicks nothing
beforeEach(() => {
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:pdf"), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

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
  const { calls } = salesServer([
    ["GET", "sales/999/", () => refuse(404, { detail: "No Invoice matches the given query." })],
    ["GET", "purchases/999/", () => refuse(404, { detail: "No purchase matches the given query." })],
  ]);
  mount("/sales/999");
  expect(await screen.findByText("This bill isn't here")).toBeInTheDocument();
  expect(calls.some(c => c.method === "GET" && c.url === "purchases/999/")).toBe(true);
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
  vi.spyOn(window, "open").mockImplementation(() => ({}) as Window); // the tab it opened (null: one the browser stopped)
  let settings: (w: unknown) => void = () => {};
  // every ask waits for the one answer, as a server's do (plan 1E: a send's PDF asks again, through the app's own client)
  const answer = new Promise((resolve) => { settings = resolve; });
  let sent: typeof SENT | null = null;
  // the record answers at once: on a quick connection it lands between a double click's two clicks
  const { calls } = salesServer([
    ["GET", "sales/412/", () => wireDetail({ sent })],
    ["GET", "shop-settings/", () => answer],
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

test("in a filed month the e-way bill, Renumber and the tax heads' fix are locked with the reason, as the menu has them; an open month's e-way bill can be changed, its number in fours", async () => {
  const dup = { id: 388, invoice_number: "KGH/2026-27/31", invoice_date: "2026-09-10", customer_name: "Hemant Dave", status: "active" };
  const EWAY = { eway_bill_number: "", transporter_name: "Shree Transport", transporter_gstin: "", vehicle_number: "RJ14AB1234", vehicle_type: "Regular", transport_mode: "Road", distance_km: 120, may_be_needed: true };
  salesServer([
    ["GET", "sales/412/", () => wireDetail({ locked: true, checks: ["duplicate", "heads_mismatch"], duplicates: [dup], eway: EWAY, igst: "2536.40", cgst: "0.00", sgst: "0.00",
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
  const heads = within(status("Tax is under IGST, but this is a local sale")).getByRole("button", { name: "Fix the tax heads" });
  expect(heads).toBeDisabled();
  expect(heads).toHaveAttribute("title", LOCKED_REASON);
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

/* ── Fix round 1 (the review) ── */

/** As mount, with a cache the test holds: to seed it before the page opens, or to ask again from outside. */
const mountWith = (qc: QueryClient, path: string) => render(
  <QueryClientProvider client={qc}><AuthContext.Provider value={stubAuth()}><RoleContext.Provider value="owner">
    <MemoryRouter initialEntries={[path]}><ToastProvider><Routes>
      <Route path="/sales/new" element={<Where />} />
      <Route path="/sales/:id" element={<><BillPage /><Where /></>} />
    </Routes></ToastProvider></MemoryRouter>
  </RoleContext.Provider></AuthContext.Provider></QueryClientProvider>,
);
const PAPER_34 = { id: 413, invoice_number: "KGH/2026-27/34", counter: 34, paper: true, invoice_date: "2026-09-30" };
/** September's paper book with `counter` next. */
const paperBook = (counter: number) => ({
  business: 3, month: "2026-09", fy: "2026-27", bills: [], entered: 1, runs: [[34, 34]], missing: [], explained: [], twice: [], after: [], after_months: [],
  next: { counter, invoice_number: `KGH/2026-27/${counter}`, invoice_date: "2026-09-30" }, locked: false, gstr1_due: "2026-10-11",
});
/** The paper book from before the save, when 34 was next: the save then asked every bill screen again (keepBill, invalidateSales). */
async function savedOver(qc: QueryClient) {
  qc.setQueryData(salesKeys.paperBook(3, "2026-09"), toPaperBook(paperBook(34)));
  await qc.invalidateQueries({ queryKey: salesKeys.all });
}

test("right after a paper save the panel waits for the paper book it asked again, never offering the number just saved, then the next one takes focus", async () => {
  let fresh: (w: unknown) => void = () => {};
  salesServer([
    ["GET", "sales/413/", () => wireDetail(PAPER_34)],
    ["GET", "sales/paper-book/", () => new Promise((resolve) => { fresh = resolve; })],
  ]);
  const qc = testQueryClient();
  await savedOver(qc);
  mountWith(qc, "/sales/413?saved=new");
  await screen.findByText("Saved KGH/2026-27/34");
  const panel = status("Saved KGH/2026-27/34");
  expect(within(panel).getByRole("link", { name: "Back to the paper book" })).toBeInTheDocument();
  expect(within(panel).queryByRole("link", { name: /^Next paper bill/ })).not.toBeInTheDocument();
  await act(async () => { fresh(paperBook(35)); });
  const next = await within(panel).findByRole("link", { name: "Next paper bill · 35" });
  expect(next).toHaveAttribute("href", "/sales/new?paper=1&firm=3&date=2026-09-30&number=35");
  await waitFor(() => expect(next).toHaveFocus());
});

test("the next paper bill takes focus when the paper book asked again answers, even with the same book as before", async () => {
  let fresh: (w: unknown) => void = () => {};
  salesServer([
    ["GET", "sales/413/", () => wireDetail(PAPER_34)],
    ["GET", "sales/paper-book/", () => new Promise((resolve) => { fresh = resolve; })],
  ]);
  const qc = testQueryClient();
  // the book on this device already names 35, and asking again answers the same: its data stays the very same object
  qc.setQueryData(salesKeys.paperBook(3, "2026-09"), toPaperBook(paperBook(35)));
  await qc.invalidateQueries({ queryKey: salesKeys.all });
  mountWith(qc, "/sales/413?saved=new");
  await screen.findByText("Saved KGH/2026-27/34");
  const panel = status("Saved KGH/2026-27/34");
  // while it's asked, focus waits rather than landing on the way back and jumping to Next a moment later
  expect(within(panel).getByRole("link", { name: "Back to the paper book" })).not.toHaveFocus();
  await act(async () => { fresh(paperBook(35)); });
  const next = await within(panel).findByRole("link", { name: "Next paper bill · 35" });
  await waitFor(() => expect(next).toHaveFocus());
});

test("a paper book that can't be asked again after a paper save offers no next number, only the way back to it", async () => {
  const { calls } = salesServer([
    ["GET", "sales/413/", () => wireDetail(PAPER_34)],
    ["GET", "sales/paper-book/", () => refuse(500, {})],
  ]);
  const qc = testQueryClient();
  await savedOver(qc);
  mountWith(qc, "/sales/413?saved=new");
  await screen.findByText("Saved KGH/2026-27/34");
  await waitFor(() => expect(calls.some((c) => c.url === "sales/paper-book/")).toBe(true));
  const panel = status("Saved KGH/2026-27/34");
  await waitFor(() => expect(within(panel).getByRole("link", { name: "Back to the paper book" })).toHaveFocus());
  expect(within(panel).queryByRole("link", { name: /^Next paper bill/ })).not.toBeInTheDocument();
});

test("a bill on screen whose refresh fails stays, with an open dialog and what's typed in it, and says so; Try again asks again", async () => {
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  let down = false;
  const { calls } = salesServer([["GET", "sales/412/", () => (down ? refuse(500, {}) : wireDetail())]]);
  const qc = testQueryClient();
  mountWith(qc, "/sales/412");
  await screen.findByText("Payment and sending");
  await userEvent.click(screen.getByRole("button", { name: "More actions for KGH/2026-27/31" }));
  await userEvent.click(await screen.findByRole("menuitem", { name: /^E-way bill/ }));
  const dialog = await screen.findByRole("dialog", { name: "E-way bill for KGH/2026-27/31" });
  act(() => { vi.advanceTimersByTime(400); }); // past the dialog's guard against the tail of the click that opened it
  fireEvent.change(within(dialog).getByLabelText("Transporter"), { target: { value: "Shree Transport" } });
  // asked again (after a send, a cancel, a reconnect…), and the server can't answer
  down = true;
  await act(async () => { await qc.invalidateQueries({ queryKey: billQuery(412).queryKey }); });
  expect(await screen.findByText("Couldn't refresh this bill")).toBeInTheDocument();
  expect(screen.getByText("The app couldn't reach the shop's records just now, so this is what was last loaded.")).toBeInTheDocument();
  expect(screen.getByText("Payment and sending")).toBeInTheDocument();
  expect(within(dialog).getByLabelText("Transporter")).toHaveValue("Shree Transport");
  await userEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  down = false;
  const before = calls.filter((c) => c.url === "sales/412/").length;
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(screen.queryByText("Couldn't refresh this bill")).not.toBeInTheDocument());
  expect(calls.filter((c) => c.url === "sales/412/")).toHaveLength(before + 1);
  vi.useRealTimers();
});

/** A deleted bill's page whose Restore the server answers with `answer`; GET sales/205/ answers `after` once Restore was pressed. */
function restoreServer(answer: () => unknown, after: () => unknown) {
  let pressed = false;
  const server = salesServer([
    ["GET", "sales/205/", () => (pressed ? after() : refuse(404, { detail: "This bill was deleted.", code: "deleted", binned: wireBin() }))],
    ["POST", "bin/4/restore/", () => { pressed = true; return answer(); }],
  ]);
  mount("/sales/205");
  return server;
}
const STILL_DELETED = () => refuse(404, { detail: "This bill was deleted.", code: "deleted", binned: wireBin() });
const BACK = () => wireDetail({ id: 205, invoice_number: "KGH/2026-27/27" });

test("a Restore whose bin row has gone says the server's words, not the app's, and asks for the bill again", async () => {
  const { calls } = restoreServer(() => refuse(404, { detail: "That deleted bill isn't in the bin any more." }), STILL_DELETED);
  await screen.findByText("This bill was deleted");
  const banner = status("This bill was deleted");
  await userEvent.click(within(banner).getByRole("button", { name: "Restore it" }));
  expect(await screen.findByText("That deleted bill isn't in the bin any more.")).toBeInTheDocument();
  expect(screen.queryByText("That isn't there any more.")).not.toBeInTheDocument();
  await waitFor(() => expect(calls.filter((c) => c.url === "sales/205/")).toHaveLength(2));
});

test.each([
  ["its bin row has gone (404)", () => refuse(404, { detail: "That deleted bill isn't in the bin any more." })],
  ["it's back in Sales already (already_restored)", () => refuse(409, { detail: "KGH/2026-27/27 is back in Sales already.", code: "already_restored" })],
])("a bill someone restored meanwhile, so %s, shows once Restore is pressed, never a Try again that can only fail", async (_why, answer) => {
  restoreServer(answer, BACK);
  await screen.findByText("This bill was deleted");
  const banner = status("This bill was deleted");
  await userEvent.click(within(banner).getByRole("button", { name: "Restore it" }));
  expect(await screen.findByText("Payment and sending")).toBeInTheDocument();
  expect(screen.queryByText("This bill was deleted")).not.toBeInTheDocument();
});

test("a lasting refusal of Restore says the server's words and keeps Restore it; a failure to get through offers Try again", async () => {
  let tries = 0;
  restoreServer(() => {
    tries += 1;
    return tries === 1 ? refuse(409, { detail: "Anil Gupta was deleted, so this bill can't come back. Restore the customer first.", code: "customer_gone" }) : refuse(500, {});
  }, STILL_DELETED);
  await screen.findByText("This bill was deleted");
  const banner = status("This bill was deleted");
  await userEvent.click(within(banner).getByRole("button", { name: "Restore it" }));
  expect(await screen.findByText("Anil Gupta was deleted, so this bill can't come back. Restore the customer first.")).toBeInTheDocument();
  expect(within(banner).queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  await userEvent.click(within(banner).getByRole("button", { name: "Restore it" }));
  expect(await screen.findByText("Not restored: the app couldn't get through")).toBeInTheDocument();
  expect(within(banner).getByRole("button", { name: "Try again" })).toBeInTheDocument();
});

test("the saved panel's words follow a send made from it: a new bill's say WhatsApp opened; an edited one's say the corrected bill went", async () => {
  vi.spyOn(window, "open").mockImplementation(() => ({}) as Window); // the tab it opened (null: one the browser stopped)
  const BEFORE = { at: "2026-10-08T11:00:00+05:30", last_at: "2026-10-08T11:00:00+05:30", count: 1, via: "whatsapp", to: "" };
  let sent: typeof SENT | null = null;
  salesServer([
    ["GET", "sales/412/", () => wireDetail({ sent })],
    ["POST", "sales/412/sent/", () => { sent = sent ? { ...sent, last_at: "2026-10-08T12:41:00+05:30", count: 2 } : SENT; return { id: 412, sent }; }],
  ]);
  const view = mount("/sales/412?saved=new");
  await screen.findByText("Saved KGH/2026-27/31");
  const fresh = status("Saved KGH/2026-27/31");
  const send = within(fresh).getByRole("button", { name: "Send on WhatsApp" });
  await waitFor(() => expect(send).toBeEnabled());
  await userEvent.click(send);
  expect(await within(fresh).findByText("WhatsApp opened the chat with Anil Gupta, with the bill's message typed in.")).toBeInTheDocument();
  expect(fresh).not.toHaveTextContent("Send it now, or print it.");
  expect(within(fresh).getByRole("button", { name: "Send again" })).toBe(send);
  view.unmount();
  // sent before the edit: the panel asks for the corrected bill, once
  sent = BEFORE;
  mount("/sales/412?saved=edit");
  await screen.findByText("Changes saved");
  const edited = status("Changes saved");
  expect(edited).toHaveTextContent("Written to the audit log, with what changed. Anil Gupta has the old bill; send the corrected one.");
  const corrected = within(edited).getByRole("button", { name: "Send the corrected bill" });
  await waitFor(() => expect(corrected).toBeEnabled());
  await userEvent.click(corrected);
  expect(await within(edited).findByText("Changes saved and the corrected bill sent")).toBeInTheDocument();
  expect(edited).not.toHaveTextContent("send the corrected one");
  expect(within(edited).getByRole("button", { name: "Send again" })).toBe(corrected);
});

/* ── Task 9's last minors (1B Task 10) ── */

const BOOK_KEY = salesKeys.paperBook(3, "2026-09");
/** As a paper save leaves the cache (keepBill): the saved bill in place, the paper book from before the save (34 next), every other bill screen asked again. */
function savedKeeping(qc: QueryClient) {
  const saved: BillOutcome = { kind: "bill", bill: toBillDetail(wireDetail(PAPER_34)) };
  qc.setQueryData(billQuery(413).queryKey, saved);
  qc.setQueryData(BOOK_KEY, toPaperBook(paperBook(34)));
  invalidateSales(qc, 413);
}

test("offline as the panel comes up, the paper book's ask waits: the number just saved is never offered, and the next one comes and takes focus once the device is back", async () => {
  salesServer([["GET", "sales/413/", () => wireDetail(PAPER_34)], ["GET", "sales/paper-book/", () => paperBook(35)]]);
  const qc = testQueryClient();
  savedKeeping(qc);
  onlineManager.setOnline(false);
  mountWith(qc, "/sales/413?saved=new");
  await screen.findByText("Saved KGH/2026-27/34");
  const panel = status("Saved KGH/2026-27/34");
  await waitFor(() => expect(qc.getQueryState(BOOK_KEY)?.fetchStatus).toBe("paused"));
  expect(within(panel).queryByRole("link", { name: /^Next paper bill/ })).not.toBeInTheDocument();
  act(() => { onlineManager.setOnline(true); });
  const next = await within(panel).findByRole("link", { name: "Next paper bill · 35" });
  await waitFor(() => expect(next).toHaveFocus());
});

test("a paper book ask that gets no reply, its one more try held until the device is back, never offers the number just saved", async () => {
  let drop: () => void = () => {};
  let asked = 0;
  salesServer([
    ["GET", "sales/413/", () => wireDetail(PAPER_34)],
    ["GET", "sales/paper-book/", () => { asked += 1; return asked === 1 ? new Promise((_, no) => { drop = () => no(new Refusal(0, {})); }) : paperBook(35); }],
  ]);
  // the app's own retry (once, after no reply), without its wait before the try
  const app = appClient.getDefaultOptions();
  const qc = new QueryClient({ defaultOptions: { ...app, queries: { ...app.queries, retryDelay: 0 } } });
  savedKeeping(qc);
  mountWith(qc, "/sales/413?saved=new");
  await screen.findByText("Saved KGH/2026-27/34");
  const panel = status("Saved KGH/2026-27/34");
  await waitFor(() => expect(asked).toBe(1));
  // the device goes offline and no reply comes: the one more try waits for the device to be back
  onlineManager.setOnline(false);
  act(() => { drop(); });
  await waitFor(() => expect(qc.getQueryState(BOOK_KEY)?.fetchStatus).toBe("paused"));
  expect(within(panel).queryByRole("link", { name: /^Next paper bill/ })).not.toBeInTheDocument();
  act(() => { onlineManager.setOnline(true); });
  expect(await within(panel).findByRole("link", { name: "Next paper bill · 35" })).toBeInTheDocument();
  expect(asked).toBe(2);
});

test("a paper book that can't be asked again says so in a line with Try again; once it answers, the next paper bill comes and takes focus", async () => {
  let down = true;
  const { calls } = salesServer([
    ["GET", "sales/413/", () => wireDetail(PAPER_34)],
    ["GET", "sales/paper-book/", () => (down ? refuse(500, {}) : paperBook(35))],
  ]);
  const qc = testQueryClient();
  await savedOver(qc);
  mountWith(qc, "/sales/413?saved=new");
  await screen.findByText("Saved KGH/2026-27/34");
  const panel = status("Saved KGH/2026-27/34");
  expect(await within(panel).findByText("Couldn't load the paper book's next number.")).toBeInTheDocument();
  expect(within(panel).queryByRole("link", { name: /^Next paper bill/ })).not.toBeInTheDocument();
  await waitFor(() => expect(within(panel).getByRole("link", { name: "Back to the paper book" })).toHaveFocus());
  down = false;
  await userEvent.click(within(panel).getByRole("button", { name: "Try again" }));
  const next = await within(panel).findByRole("link", { name: "Next paper bill · 35" });
  await waitFor(() => expect(next).toHaveFocus());
  expect(within(panel).queryByText("Couldn't load the paper book's next number.")).not.toBeInTheDocument();
  expect(calls.filter((c) => c.url === "sales/paper-book/")).toHaveLength(2);
});

test("focus waits for the paper book's answer, then lands once, on the next paper bill; asking again later leaves focus where it is, and Next in its place", async () => {
  let asked = 0;
  let answer: (w: unknown) => void = () => {};
  salesServer([
    ["GET", "sales/413/", () => wireDetail(PAPER_34)],
    ["GET", "sales/paper-book/", () => { asked += 1; return new Promise((resolve) => { answer = resolve; }); }],
  ]);
  const qc = testQueryClient();
  await savedOver(qc);
  mountWith(qc, "/sales/413?saved=new");
  await screen.findByText("Saved KGH/2026-27/34");
  const panel = status("Saved KGH/2026-27/34");
  const back = within(panel).getByRole("link", { name: "Back to the paper book" });
  await waitFor(() => expect(asked).toBe(1));
  // while it's asked, nothing in the panel takes focus (it would land on the way back, then jump to Next)
  expect(panel).not.toContainElement(document.activeElement as HTMLElement);
  await act(async () => { answer(paperBook(35)); });
  const next = await within(panel).findByRole("link", { name: "Next paper bill · 35" });
  await waitFor(() => expect(next).toHaveFocus());
  // asked again (a reconnect): Next stays where it is, with its focus, and takes the new number when it comes (Ruling 1B-21)
  act(() => { void qc.refetchQueries({ queryKey: BOOK_KEY }); });
  await waitFor(() => expect(asked).toBe(2));
  expect(next).toBeInTheDocument();
  expect(next).toHaveFocus();
  await act(async () => { answer(paperBook(36)); });
  await waitFor(() => expect(next).toHaveAccessibleName("Next paper bill · 36"));
  expect(next).toHaveFocus();
  // the person moves to the way back; asked again after another write on this device, focus stays there
  await userEvent.tab();
  expect(back).toHaveFocus();
  act(() => { void qc.invalidateQueries({ queryKey: BOOK_KEY }); });
  await waitFor(() => expect(asked).toBe(3));
  await act(async () => { answer(paperBook(36)); });
  expect(await within(panel).findByRole("link", { name: "Next paper bill · 36" })).toBeInTheDocument();
  expect(back).toHaveFocus();
  // on the page's title (where a closing dialog leaves it when its opener has gone), it stays there too
  const title = screen.getByRole("heading", { level: 1 });
  act(() => { title.focus(); });
  act(() => { void qc.invalidateQueries({ queryKey: BOOK_KEY }); });
  await waitFor(() => expect(asked).toBe(4));
  await act(async () => { answer(paperBook(36)); });
  expect(await within(panel).findByRole("link", { name: "Next paper bill · 36" })).toBeInTheDocument();
  expect(title).toHaveFocus();
});

test("once the paper book has answered since the save, Next stays put while it's asked again, held offline, or when asking again fails, which the panel says", async () => {
  let down = false;
  salesServer([["GET", "sales/413/", () => wireDetail(PAPER_34)], ["GET", "sales/paper-book/", () => (down ? refuse(500, {}) : paperBook(35))]]);
  const qc = testQueryClient();
  await savedOver(qc);
  mountWith(qc, "/sales/413?saved=new");
  await screen.findByText("Saved KGH/2026-27/34");
  const panel = status("Saved KGH/2026-27/34");
  const next = await within(panel).findByRole("link", { name: "Next paper bill · 35" });
  // asked again while the device is offline: held until it's back, and Next with it
  onlineManager.setOnline(false);
  act(() => { void qc.refetchQueries({ queryKey: BOOK_KEY }); });
  await waitFor(() => expect(qc.getQueryState(BOOK_KEY)?.fetchStatus).toBe("paused"));
  expect(next).toBeInTheDocument();
  act(() => { onlineManager.setOnline(true); });
  await waitFor(() => expect(qc.getQueryState(BOOK_KEY)?.fetchStatus).toBe("idle"));
  // asking again fails: Next keeps the number the book last gave, and the panel says so, with Try again
  down = true;
  act(() => { void qc.refetchQueries({ queryKey: BOOK_KEY }); });
  expect(await within(panel).findByText("Couldn't refresh the paper book, so the next number is the one it last gave.")).toBeInTheDocument();
  expect(next).toBeInTheDocument();
  expect(within(panel).queryByText("Couldn't load the paper book's next number.")).not.toBeInTheDocument();
  down = false;
  await userEvent.click(within(panel).getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(within(panel).queryByText(/^Couldn't refresh the paper book/)).not.toBeInTheDocument());
  expect(next).toBeInTheDocument();
});

test("a switch of layout mounts the panel again: Next comes back at once, from the paper book's answer since the save", async () => {
  const { calls } = salesServer([["GET", "sales/413/", () => wireDetail(PAPER_34)], ["GET", "sales/paper-book/", () => paperBook(35)]]);
  const qc = testQueryClient();
  await savedOver(qc);
  const view = mountWith(qc, "/sales/413?saved=new");
  await screen.findByText("Saved KGH/2026-27/34");
  expect(await within(status("Saved KGH/2026-27/34")).findByRole("link", { name: "Next paper bill · 35" })).toBeInTheDocument();
  view.unmount();
  (window as unknown as { __phone?: boolean }).__phone = true;
  mountWith(qc, "/sales/413?saved=new");
  await screen.findByText("Saved KGH/2026-27/34");
  expect(within(status("Saved KGH/2026-27/34")).getByRole("link", { name: "Next paper bill · 35" })).toBeInTheDocument();
  expect(calls.filter((c) => c.url === "sales/paper-book/")).toHaveLength(1);
});

test("a person who moves to the way back while the paper book is asked stays there when it answers", async () => {
  let answer: (w: unknown) => void = () => {};
  salesServer([
    ["GET", "sales/413/", () => wireDetail(PAPER_34)],
    ["GET", "sales/paper-book/", () => new Promise((resolve) => { answer = resolve; })],
  ]);
  const qc = testQueryClient();
  await savedOver(qc);
  mountWith(qc, "/sales/413?saved=new");
  await screen.findByText("Saved KGH/2026-27/34");
  const panel = status("Saved KGH/2026-27/34");
  const back = within(panel).getByRole("link", { name: "Back to the paper book" });
  act(() => { back.focus(); });
  await act(async () => { answer(paperBook(35)); });
  expect(await within(panel).findByRole("link", { name: "Next paper bill · 35" })).toBeInTheDocument();
  expect(back).toHaveFocus();
});

test("an edited bill whose corrected copy went before the panel came up (a reload, a switch of layout) isn't asked for it again; one sent only before the edit still is", async () => {
  const CREATED = { at: "2026-10-08T10:42:05+05:30", by: "Rakesh Soni", action: "created", details: "Anil Gupta · ₹87,083.21" };
  const EDITED = { at: "2026-10-08T12:00:00+05:30", by: "Kailash Mehta", action: "updated", details: "Gold Ring 22K: 12.345 gms" };
  let sent = { at: "2026-10-08T11:00:00+05:30", last_at: "2026-10-08T12:41:00+05:30", count: 2, via: "whatsapp", to: "" };
  salesServer([["GET", "sales/412/", () => wireDetail({ sent, history: { created_by: { id: 2, name: "Rakesh Soni" }, activity: [
    ...(sent.last_at > EDITED.at ? [{ at: sent.last_at, by: "Kailash Mehta", action: "sent", details: "WhatsApp" }] : []), EDITED,
    { at: sent.at, by: "Rakesh Soni", action: "sent", details: "WhatsApp" }, CREATED,
  ] } })]]);
  let view = mount("/sales/412?saved=edit");
  await screen.findByText("Changes saved and the corrected bill sent");
  const panel = status("Changes saved and the corrected bill sent");
  expect(panel).toHaveTextContent("Written to the audit log, with what changed.");
  expect(panel).not.toHaveTextContent("send the corrected one");
  expect(within(panel).getByRole("link", { name: "Print" })).toHaveAttribute("href", "/sales/412/print");
  expect(within(panel).queryByRole("button", { name: /^Send/ })).not.toBeInTheDocument();
  view.unmount();
  // a switch to the phone's layout mounts the panel again: the same
  (window as unknown as { __phone?: boolean }).__phone = true;
  view = mount("/sales/412?saved=edit");
  expect(await screen.findByText("Changes saved and the corrected bill sent")).toBeInTheDocument();
  expect(screen.queryByText(/send the corrected one/)).not.toBeInTheDocument();
  view.unmount();
  (window as unknown as { __phone?: boolean }).__phone = false;
  // sent only before the edit: the customer has the old bill
  sent = { ...sent, last_at: "2026-10-08T11:30:00+05:30" };
  mount("/sales/412?saved=edit");
  await screen.findByText("Changes saved");
  const owed = status("Changes saved");
  expect(owed).toHaveTextContent("Written to the audit log, with what changed. Anil Gupta has the old bill; send the corrected one.");
  expect(within(owed).getByRole("button", { name: "Send the corrected bill" })).toBeInTheDocument();
});

/* ── 1B Task 12, commit A: one word for "cancelled" ── */

test("among the customer's other bills, a cancelled one says so at the end of its line, as search's rows do, and its amount is struck through", async () => {
  salesServer([
    ["GET", "sales/412/", () => wireDetail()],
    ["GET", "sales/", () => wirePage([wireRow(), wireRow({ id: 300, invoice_number: "KGH/2026-27/12", invoice_date: "2026-08-14", total_amount: "45210.00", payment_mode: "bank", status: "cancelled" })])],
  ]);
  mount("/sales/412");
  const card = await screen.findByRole("region", { name: "Other bills for Anil Gupta" });
  const row = await within(card).findByRole("link", { name: /^KGH\/2026-27\/12/ });
  expect(row).toHaveTextContent(/^KGH\/2026-27\/1214 Aug 2026 · UPI \/ bank · cancelled₹45,210\.00$/);
  expect(within(row).getByText("₹45,210.00")).toHaveClass("line-through");
});
