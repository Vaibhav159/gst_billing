import { handClock, pass } from "@/test/clock";
import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { onlineManager } from "@tanstack/react-query";
import { useCustomer, useCustomerSearch } from "@/core/api/customers";
import { __setNetState } from "@/core/api/network";
import { ShareHost } from "@/core/print/ShareHost";
import CustomerStatement from "./CustomerStatement";
import { makeStatementPdf } from "./statementPdf";
import { ANIL, FIRMS, mount, serve, type Call } from "./testing";

// the real PDF is statementPdf.test.tsx's: here a small stand-in comes back at once
vi.mock("./statementPdf", () => ({ makeStatementPdf: vi.fn(async () => new Blob(["%PDF-1.3"], { type: "application/pdf" })) }));

const routes = [
  { path: "/customers", element: <p>all customers</p> },
  { path: "/customers/:id", element: <p>the customer page</p> },
  { path: "/customers/:id/statement", element: <><CustomerStatement /><ShareHost /></> },
  { path: "/sales/:id", element: <p>the bill</p> },
];
const b = (id: number, date: string, total: string, paid: string, mode: string, status = "active") => ({
  id, business: 3, business_name: "KIRAN GOLD HOUSE", invoice_number: `KGH/2026-27/${id}`, invoice_date: date, payment_mode: mode, taxable: total, tax: "0.00", total_amount: total, status, cancel_reason: "", paid, itax: [],
});
const STATEMENT = {
  customer: {}, start_date: "2026-04-01", end_date: "2026-10-08", business: 3,
  bills: [b(17, "2026-09-02", "45210.00", "billing", "cash"), b(18, "2026-09-10", "20000.00", "udhaar", "credit"), b(19, "2026-09-12", "3000.00", "cancelled", "cash", "cancelled"), b(20, "2026-09-20", "1000.00", "not_recorded", "")],
  totals: { bills: 3, billed: "66210.00", taxable: "66210.00", tax: "0.00", cancelled: 1, paid_at_billing: { bills: 1, total: "45210.00" }, udhaar: { bills: 1, total: "20000.00" }, not_recorded: { bills: 1, total: "1000.00" } },
  months: [],
};
const answer = (c: Call) => ({ status: 200, data: c.params.start_date === "2026-10-01" ? { ...STATEMENT, bills: [], totals: { ...STATEMENT.totals, bills: 0, billed: "0.00", cancelled: 0 } } : STATEMENT });
let clicked: string[] = [];
/** The periods a PDF was asked for, in order. */
const made = () => vi.mocked(makeStatementPdf).mock.calls.map(([d]) => d.periodLabel);

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  vi.setSystemTime(new Date("2026-10-08T10:00:00+05:30"));
  clicked = [];
  // (a reset, not a clear: a test that stops early leaves no queued answer for the next)
  vi.mocked(makeStatementPdf).mockReset();
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:statement"), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { clicked.push(this.download); });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  // (here, not in the test: a test that stops part-way never reaches its end, and offline would hold every later test's requests)
  onlineManager.setOnline(true);
  act(() => __setNetState("online"));
  delete (navigator as { share?: unknown }).share;
  delete (navigator as { canShare?: unknown }).canShare;
  delete (navigator as { userActivation?: unknown }).userActivation;
  (window as unknown as { __phone?: boolean }).__phone = false;
});

test("the year's register from the server: billed, paid at billing, on udhaar, and each bill oldest first with how it was settled", async () => {
  const calls = serve({ "GET customers/7/": ANIL, "GET customers/7/statement/": answer });
  mount(routes, ["/customers/7/statement"]);
  expect(await screen.findByRole("heading", { level: 1, name: "Statement" })).toBeInTheDocument();
  expect(await screen.findByText("Anil Gupta · 98290 41122 · bills register · KIRAN GOLD HOUSE")).toBeInTheDocument();
  expect(await screen.findByText("Billed · FY 2026-27")).toBeInTheDocument();
  expect(screen.getByText("Billed · FY 2026-27").parentElement).toHaveTextContent("₹66,210.003 bills · 1 cancelled bill not counted");
  expect(screen.getByText("Paid at billing · FY 2026-27").parentElement).toHaveTextContent("₹45,210.001 bill · cash, UPI or both");
  expect(screen.getByText("On udhaar · FY 2026-27").parentElement).toHaveTextContent("₹20,000.001 bill · payment not recorded in the app");
  expect(screen.getByText("1 bill (₹1,000.00) came in from Tally without a payment mode, so it isn't counted as paid or on udhaar.")).toBeInTheDocument();
  const rows = within(screen.getByRole("table")).getAllByRole("row");
  expect(rows.slice(1, -1).map((r) => r.textContent)).toEqual([
    "02 Sep 2026KGH/2026-27/17KIRAN GOLD HOUSECash₹45,210.00Paid at billing",
    "10 Sep 2026KGH/2026-27/18KIRAN GOLD HOUSEUdhaar₹20,000.00On udhaar · payment not recorded in the app",
    "12 Sep 2026KGH/2026-27/19KIRAN GOLD HOUSECash₹3,000.00Cancelled · not counted",
    "20 Sep 2026KGH/2026-27/20KIRAN GOLD HOUSENot recorded₹1,000.00Payment mode not recorded (from Tally)",
  ]);
  expect(rows.at(-1)).toHaveTextContent("₹45,210.00 paid at billing · ₹20,000.00 on udhaar · ₹1,000.00 not recorded");
  expect(calls.find((c) => c.url === "customers/7/statement/")!.params).toEqual({ start_date: "2026-04-01", end_date: "2026-10-08", business_id: 3 });
});

test("this month, last month and own dates ask for their period; a start after the end says so and asks nothing", async () => {
  const calls = serve({ "GET customers/7/": ANIL, "GET customers/7/statement/": answer });
  mount(routes, ["/customers/7/statement"]);
  await screen.findByText("Billed · FY 2026-27");
  const asked = () => calls.filter((c) => c.url === "customers/7/statement/").map((c) => `${c.params.start_date}..${c.params.end_date}`);
  await userEvent.click(screen.getByRole("radio", { name: "October 2026" }));
  expect(await screen.findByText("No bills to Anil Gupta in October 2026")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Download PDF" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Download PDF" })).toHaveAttribute("title", "No bills in this period");
  await userEvent.click(screen.getByRole("radio", { name: "September 2026" }));
  await waitFor(() => expect(asked()).toEqual(["2026-04-01..2026-10-08", "2026-10-01..2026-10-08", "2026-09-01..2026-09-30"]));
  // a PDF is made once for each period with bills, and never for one without (Print, Download and Share are off there)
  await waitFor(() => expect(made()).toEqual(["FY 2026-27", "September 2026"]));
  await userEvent.click(screen.getByRole("radio", { name: "Choose dates" }));
  // own dates are the boxes once they pause: the clock moves when the test says
  handClock();
  fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-05" } });
  fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-10-01" } });
  await pass(249, 1);
  expect(screen.queryByText("The start date is after the end date.")).not.toBeInTheDocument();
  await pass(1, 1);
  expect(screen.getByText("The start date is after the end date.")).toBeInTheDocument();
  expect(screen.getByText("Fix the dates to see bills")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Download PDF" })).toHaveAttribute("title", "Fix the dates first");
  expect(asked().filter((a) => a.endsWith("..2026-10-01"))).toEqual([]);
});

test("own dates ask once the boxes pause: a year typed a digit at a time is a date at every digit, and only the last is asked for", async () => {
  const calls = serve({ "GET customers/7/": ANIL, "GET customers/7/statement/": answer });
  mount(routes, ["/customers/7/statement"]);
  await screen.findByText("Billed · FY 2026-27");
  await userEvent.click(screen.getByRole("radio", { name: "Choose dates" }));
  const asked = () => calls.filter((c) => c.url === "customers/7/statement/").map((c) => `${c.params.start_date}..${c.params.end_date}`);
  handClock();
  // as desktop Chrome does while a year is typed into a date box: a change at each digit, each one a date, a quick
  // typist's 100 ms apart
  const fromBox = screen.getByLabelText("From");
  for (const year of ["0002", "0020", "0202", "2026"]) {
    fireEvent.change(fromBox, { target: { value: `${year}-09-01` } });
    await pass(100, 1);
  }
  await pass(149, 1);
  expect(asked()).toEqual(["2026-04-01..2026-10-08"]);
  await pass(1, 1);
  expect(asked()).toEqual(["2026-04-01..2026-10-08", "2026-09-01..2026-10-08"]);
  expect(made()).toEqual(["FY 2026-27", "1 Apr to 8 Oct 2026", "1 Sep to 8 Oct 2026"]);
});

/** A search's rows on screen, as the bill form's customer box or Ctrl K shows them: once they've come, Anil's row is in the cache. */
function Searched() {
  return <p>{useCustomerSearch("Anil").data ? "searched" : "searching"}</p>;
}
/** Whether the statement's customer is still the row standing in for him, or the customer the server sent. */
function Whose() {
  const one = useCustomer(7);
  return <p>{one.isPlaceholderData ? "the row stands in" : one.data ? "the customer came" : "nothing yet"}</p>;
}

test("opened from a row already on screen, the PDF is made once: the row stands in for the customer, then the customer comes", async () => {
  let customerComes = () => {};
  const held = new Promise<void>((resolve) => { customerComes = resolve; });
  serve({
    "GET customers/": { count: 1, next: null, results: [ANIL] },
    "GET customers/7/": async () => { await held; return { status: 200, data: ANIL }; },
    "GET customers/7/statement/": answer,
  });
  const { router } = mount([{ path: "/customers", element: <Searched /> }, { path: "/customers/:id/statement", element: <><CustomerStatement /><Whose /></> }], ["/customers"]);
  await screen.findByText("searched");
  await act(async () => { await router.navigate("/customers/7/statement"); });
  expect(await screen.findByText("the row stands in")).toBeInTheDocument();
  await waitFor(() => expect(made()).toEqual(["FY 2026-27"]));
  await act(async () => { customerComes(); });
  expect(await screen.findByText("the customer came")).toBeInTheDocument();
  // the same name, phone, GSTIN, PAN and address: the PDF already made stands
  expect(made()).toEqual(["FY 2026-27"]);
});

test("offline, the buttons say the bills need the internet, not that they're loading", async () => {
  let customerComes = () => {};
  const held = new Promise<void>((resolve) => { customerComes = resolve; });
  const calls = serve({ "GET customers/7/": async () => { await held; return { status: 200, data: ANIL }; }, "GET customers/7/statement/": answer });
  mount(routes, ["/customers/7/statement"]);
  await waitFor(() => expect(calls.some((c) => c.url === "customers/7/")).toBe(true));
  // the connection drops while the customer is on its way: the bills, asked for once it comes, wait for the internet
  onlineManager.setOnline(false);
  await act(async () => { customerComes(); });
  const download = await screen.findByRole("button", { name: "Download PDF" });
  // (the reply that landed marks the server reachable; a real browser that's offline stays offline, jsdom's never is)
  act(() => __setNetState("offline"));
  expect(download).toHaveAttribute("title", "Needs the internet");
  expect(screen.getByRole("button", { name: "Share PDF" })).toHaveAttribute("title", "Needs the internet");
  expect(calls.some((c) => c.url === "customers/7/statement/")).toBe(false);
});

test("Download PDF hands over the file, named after the customer and the period", async () => {
  // a PAN field v2 left as "N/A" is no PAN: the PDF gets the server's pan, which is ""
  serve({ "GET customers/7/": { ...ANIL, pan_number: "N/A" }, "GET customers/7/statement/": answer });
  mount(routes, ["/customers/7/statement"]);
  const download = await screen.findByRole("button", { name: "Download PDF" });
  await waitFor(() => expect(download).toBeEnabled());
  await userEvent.click(download);
  expect(clicked).toEqual(["Anil-Gupta_statement_FY-2026-27.pdf"]);
  expect(await screen.findByText("Downloaded Anil-Gupta_statement_FY-2026-27.pdf")).toBeInTheDocument();
  expect(screen.getByText("4 bills · FY 2026-27 · KIRAN GOLD HOUSE.")).toBeInTheDocument();
  expect(makeStatementPdf).toHaveBeenCalledTimes(1);
  expect(vi.mocked(makeStatementPdf).mock.calls[0][0]).toMatchObject({
    periodLabel: "FY 2026-27", periodRange: "1 Apr to 8 Oct 2026", scope: "KIRAN GOLD HOUSE", made: "08 Oct 2026",
    customer: { name: "Anil Gupta", mobile: "98290 41122", gstin: "", pan: "", address: "15 Demo Road, Udaipur, Rajasthan" },
  });
});

test("Share PDF opens the share sheet where there is one; elsewhere the file downloads and WhatsApp opens the chat", async () => {
  serve({ "GET customers/7/": ANIL, "GET customers/7/statement/": answer });
  const share = vi.fn(async () => {});
  Object.assign(navigator, { share, canShare: () => true });
  mount(routes, ["/customers/7/statement"]);
  const button = await screen.findByRole("button", { name: "Share PDF" });
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.click(button);
  await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
  expect((share.mock.calls[0] as unknown as [{ files: File[] }])[0].files[0].name).toBe("Anil-Gupta_statement_FY-2026-27.pdf");
  Object.assign(navigator, { share: undefined, canShare: undefined });
  const open = vi.spyOn(window, "open").mockReturnValue({ opener: {} } as Window);
  await userEvent.click(button);
  expect(open).toHaveBeenCalledWith("https://wa.me/919829041122", "_blank");
  expect(clicked).toEqual(["Anil-Gupta_statement_FY-2026-27.pdf"]);
  expect(await screen.findByText("WhatsApp opens a chat with Anil Gupta (+91 98290 41122). Attach the PDF there.")).toBeInTheDocument();
});

test("Print opens the PDF to print; a tab the browser stops says how to allow it", async () => {
  serve({ "GET customers/7/": ANIL, "GET customers/7/statement/": answer });
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  mount(routes, ["/customers/7/statement"]);
  const print = await screen.findByRole("button", { name: "Print" });
  await waitFor(() => expect(print).toBeEnabled());
  await userEvent.click(print);
  expect(open).toHaveBeenCalledWith("blob:statement", "_blank");
  expect(await screen.findByText("The PDF didn't open")).toBeInTheDocument();
});

test("while the PDF is being made, Share PDF spins and the buttons say so; then they're on", async () => {
  let ready = (_: Blob) => {};
  vi.mocked(makeStatementPdf).mockImplementationOnce(() => new Promise<Blob>((resolve) => { ready = resolve; }));
  serve({ "GET customers/7/": ANIL, "GET customers/7/statement/": answer });
  mount(routes, ["/customers/7/statement"]);
  const share = await screen.findByRole("button", { name: "Share PDF" });
  await waitFor(() => expect(share).toHaveAttribute("aria-busy", "true"));
  expect(screen.getByRole("button", { name: "Download PDF" })).toHaveAttribute("title", "Making the PDF…");
  await act(async () => { ready(new Blob(["%PDF-1.3"], { type: "application/pdf" })); });
  expect(share).toBeEnabled();
  expect(share).not.toHaveAttribute("aria-busy");
  expect(screen.getByRole("button", { name: "Download PDF" })).not.toHaveAttribute("title");
});

test("a PDF that couldn't be made leaves the buttons off, saying why, and nothing spinning", async () => {
  vi.mocked(makeStatementPdf).mockRejectedValueOnce(new Error("the font didn't load"));
  serve({ "GET customers/7/": ANIL, "GET customers/7/statement/": answer });
  mount(routes, ["/customers/7/statement"]);
  const download = await screen.findByRole("button", { name: "Download PDF" });
  await waitFor(() => expect(download).toHaveAttribute("title", "The PDF couldn't be made. Reload the page and try again."));
  expect(download).toBeDisabled();
  expect(screen.getByRole("button", { name: "Share PDF" })).not.toHaveAttribute("aria-busy");
});

test("on a phone: the periods short, Share PDF in the bar, Print and Download in the ⋮ menu", async () => {
  (window as unknown as { __phone?: boolean }).__phone = true;
  serve({ "GET customers/7/": ANIL, "GET customers/7/statement/": answer });
  mount(routes, ["/customers/7/statement"]);
  expect(await screen.findByRole("radio", { name: "This FY" })).toBeInTheDocument();
  expect(screen.getByRole("radio", { name: "Oct" })).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole("button", { name: "Share PDF" })).toBeEnabled());
  await userEvent.click(screen.getByRole("button", { name: "Print or download the statement" }));
  const menu = await screen.findByRole("dialog", { name: "Statement" });
  act(() => { vi.advanceTimersByTime(400); }); // past the sheet's guard against a double tap's second tap
  await userEvent.click(within(menu).getByRole("menuitem", { name: /Download the PDF/ }));
  await waitFor(() => expect(clicked).toEqual(["Anil-Gupta_statement_FY-2026-27.pdf"]));
});

test("the statement waits for the firm's name, so neither the page nor the PDF says “the firm picked”", async () => {
  // the person picked Kiran on this device, so the firm is known before the list of firms comes
  localStorage.setItem("gst3.scope.1", "3");
  let firmsCome = () => {};
  const held = new Promise<void>((resolve) => { firmsCome = resolve; });
  const calls = serve({
    "GET businesses/": async () => { await held; return { status: 200, data: { results: FIRMS } }; },
    "GET customers/7/": ANIL, "GET customers/7/statement/": answer,
  });
  mount(routes, ["/customers/7/statement"]);
  expect(await screen.findByText("Anil Gupta · 98290 41122 · bills register")).toBeInTheDocument();
  expect(screen.getByText("1 Apr to 8 Oct 2026")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Download PDF" })).toHaveAttribute("title", "Waits for the bills to load");
  expect(calls.filter((c) => c.url === "customers/7/statement/")).toEqual([]);
  expect(screen.queryByText(/the firm picked/)).not.toBeInTheDocument();
  await act(async () => { firmsCome(); });
  expect(await screen.findByText("Anil Gupta · 98290 41122 · bills register · KIRAN GOLD HOUSE")).toBeInTheDocument();
  expect(screen.getByText("1 Apr to 8 Oct 2026 · KIRAN GOLD HOUSE")).toBeInTheDocument();
  await waitFor(() => expect(made()).toEqual(["FY 2026-27"]));
  expect(vi.mocked(makeStatementPdf).mock.calls[0][0].scope).toBe("KIRAN GOLD HOUSE");
});

test("when the list of firms can't load, the bills still show, and the PDF isn't made without the firm's name", async () => {
  localStorage.setItem("gst3.scope.1", "3");
  serve({ "GET businesses/": () => ({ status: 503 }), "GET customers/7/": ANIL, "GET customers/7/statement/": answer });
  mount(routes, ["/customers/7/statement"]);
  expect(await screen.findByText("Billed · FY 2026-27")).toBeInTheDocument();
  expect(screen.getAllByRole("row")).toHaveLength(6);
  const download = screen.getByRole("button", { name: "Download PDF" });
  expect(download).toBeDisabled();
  expect(download).toHaveAttribute("title", "The firms didn't load. Reload the page to make the PDF.");
  expect(screen.getByRole("button", { name: "Share PDF" })).not.toHaveAttribute("aria-busy");
  expect(makeStatementPdf).not.toHaveBeenCalled();
});

test("bills that didn't load say so, with Try again, and the buttons say why they're off", async () => {
  serve({ "GET customers/7/": ANIL, "GET customers/7/statement/": () => ({ status: 503 }) });
  mount(routes, ["/customers/7/statement"]);
  expect(await screen.findByText("Couldn't load the statement")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Download PDF" })).toHaveAttribute("title", "The bills didn't load. Use Try again.");
});

test("an address that names no customer on file says so, with the way to all customers", async () => {
  const calls = serve({});
  mount(routes, ["/customers/99/statement"]);
  expect(await screen.findByText("This customer isn't on file", { selector: "p" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "All customers" })).toHaveAttribute("href", "/customers");
  expect(calls.filter((c) => c.url.includes("statement"))).toEqual([]);
});


const manyBills = (count: number) => ({ ...STATEMENT, bills: Array.from({ length: count }, (_, i) => b(i + 1, "2026-09-02", "100.00", "billing", "cash")) });
function heldPdf() {
  let ready!: (blob: Blob) => void;
  vi.mocked(makeStatementPdf).mockImplementationOnce(() => new Promise<Blob>((resolve) => { ready = resolve; }));
  return () => ready(new Blob(["%PDF-1.3 held"], { type: "application/pdf" }));
}

test("a 200-bill period opens without making a PDF; Download makes one on press and saves it", async () => {
  handClock();
  const ready = heldPdf();
  serve({ "GET customers/7/": ANIL, "GET customers/7/statement/": manyBills(200) });
  mount(routes, ["/customers/7/statement"]);
  await pass(400, 1);
  screen.getByRole("table");
  expect(makeStatementPdf).not.toHaveBeenCalled();
  const download = screen.getByRole("button", { name: "Download PDF" });
  expect(download).toBeEnabled();
  fireEvent.click(download);
  expect(makeStatementPdf).toHaveBeenCalledTimes(1);
  expect(download).toHaveAttribute("title", "Making the PDF…");
  expect(clicked).toEqual([]);
  await act(async () => { ready(); });
  expect(clicked).toEqual(["Anil-Gupta_statement_FY-2026-27.pdf"]);
  fireEvent.click(download);
  expect(makeStatementPdf).toHaveBeenCalledTimes(1);
  expect(clicked).toHaveLength(2);
});

test.each([100, 150])("a %i-bill period still makes its PDF ahead", async (count) => {
  handClock();
  serve({ "GET customers/7/": ANIL, "GET customers/7/statement/": manyBills(count) });
  mount(routes, ["/customers/7/statement"]);
  await pass(400, 1);
  screen.getByRole("table");
  await pass(0, 1);
  expect(makeStatementPdf).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Download PDF" })).toBeEnabled();
});

test("a 200-bill phone Share makes its PDF on press and uses the host's late path", async () => {
  handClock();
  (window as unknown as { __phone?: boolean }).__phone = true;
  const ready = heldPdf();
  const share = vi.fn(async () => {});
  Object.assign(navigator, { share, canShare: () => true, userActivation: { isActive: false } });
  serve({ "GET customers/7/": ANIL, "GET customers/7/statement/": manyBills(200) });
  mount(routes, ["/customers/7/statement"]);
  await pass(400, 1);
  screen.getByText("Bills · FY 2026-27");
  expect(makeStatementPdf).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Share PDF" }));
  expect(makeStatementPdf).toHaveBeenCalledTimes(1);
  await act(async () => { ready(); });
  const dialog = screen.getByRole("dialog", { name: "Your PDF is ready" });
  expect(share).not.toHaveBeenCalled();
  expect(clicked).toEqual([]);
  await pass(400, 1); // past the sheet's 350 ms click guard
  Object.assign(navigator, { userActivation: { isActive: true } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Share" }));
  await pass(0, 1);
  expect(share).toHaveBeenCalledTimes(1);
  expect(share).toHaveBeenCalledWith(expect.objectContaining({ files: [expect.objectContaining({ name: "Anil-Gupta_statement_FY-2026-27.pdf" })] }));
});

test.each(["Download PDF", "Print", "Share PDF"])("a period switch while %s makes the PDF never offers the old period", async (action) => {
  handClock();
  const ready = heldPdf();
  const share = vi.fn(async () => {});
  Object.assign(navigator, { share, canShare: () => true, userActivation: { isActive: false } });
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  serve({ "GET customers/7/": ANIL, "GET customers/7/statement/": (c: Call) => c.params.start_date === "2026-04-01" ? { status: 200, data: manyBills(200) } : answer(c) });
  mount(routes, ["/customers/7/statement"]);
  await pass(400, 1);
  screen.getByRole("table");
  fireEvent.click(screen.getByRole("button", { name: action }));
  expect(makeStatementPdf).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("radio", { name: "October 2026" }));
  await pass(0, 1);
  screen.getByText("No bills to Anil Gupta in October 2026");
  await act(async () => { ready(); });
  expect(clicked).toEqual([]);
  expect(open).not.toHaveBeenCalled();
  expect(share).not.toHaveBeenCalled();
  expect(screen.queryByRole("dialog", { name: "Your PDF is ready" })).not.toBeInTheDocument();
  expect(screen.queryByText("The PDF is ready.")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Download PDF" })).toBeDisabled();
});

test("a big period's first Print makes the file without opening a tab; a second press prints synchronously", async () => {
  handClock();
  const ready = heldPdf();
  const open = vi.spyOn(window, "open").mockReturnValue({ addEventListener: vi.fn() } as unknown as Window);
  serve({ "GET customers/7/": ANIL, "GET customers/7/statement/": manyBills(200) });
  mount(routes, ["/customers/7/statement"]);
  await pass(400, 1);
  screen.getByRole("table");
  expect(makeStatementPdf).not.toHaveBeenCalled();
  const print = screen.getByRole("button", { name: "Print" });
  fireEvent.click(print);
  await act(async () => { ready(); });
  expect(open).not.toHaveBeenCalled();
  expect(screen.getByText("The PDF is ready.")).toHaveAttribute("role", "status");
  expect(print).toHaveFocus();
  fireEvent.click(print);
  expect(open).toHaveBeenCalledWith("blob:statement", "_blank");
  expect(makeStatementPdf).toHaveBeenCalledTimes(1);
});

test("switching periods between Print presses drops the ready file and status", async () => {
  handClock();
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  serve({ "GET customers/7/": ANIL, "GET customers/7/statement/": manyBills(200) });
  mount(routes, ["/customers/7/statement"]);
  await pass(400, 1);
  screen.getByRole("table");
  fireEvent.click(screen.getByRole("button", { name: "Print" }));
  await pass(0, 1);
  expect(screen.getByText("The PDF is ready.")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("radio", { name: "September 2026" }));
  await pass(0, 1);
  screen.getByText("Bills · September 2026");
  expect(screen.queryByText("The PDF is ready.")).not.toBeInTheDocument();
  expect(makeStatementPdf).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "Print" }));
  expect(makeStatementPdf).toHaveBeenCalledTimes(2);
  expect(open).not.toHaveBeenCalled();
  await pass(0, 1);
  expect(screen.getByText("The PDF is ready.")).toBeInTheDocument();
});

test("the phone's first Print offers and focuses a visible Print button for the second press", async () => {
  handClock();
  (window as unknown as { __phone?: boolean }).__phone = true;
  const ready = heldPdf();
  const open = vi.spyOn(window, "open").mockReturnValue({ addEventListener: vi.fn() } as unknown as Window);
  serve({ "GET customers/7/": ANIL, "GET customers/7/statement/": manyBills(200) });
  mount(routes, ["/customers/7/statement"]);
  await pass(400, 1);
  screen.getByText("Bills · FY 2026-27");
  fireEvent.click(screen.getByRole("button", { name: "Print or download the statement" }));
  const menu = screen.getByRole("dialog", { name: "Statement" });
  await pass(400, 1); // past the sheet's 350 ms click guard
  fireEvent.click(within(menu).getByRole("menuitem", { name: /^Print / }));
  await pass(0, 1);
  expect(makeStatementPdf).toHaveBeenCalledTimes(1);
  await act(async () => { ready(); });
  expect(open).not.toHaveBeenCalled();
  const print = screen.getByRole("button", { name: "Print" });
  expect(print).toHaveFocus();
  fireEvent.click(print);
  expect(open).toHaveBeenCalledWith("blob:statement", "_blank");
});


test("a large statement's busy Download keeps keyboard focus and ignores repeated presses", async () => {
  handClock();
  const ready = heldPdf();
  serve({ "GET customers/7/": ANIL, "GET customers/7/statement/": manyBills(200) });
  mount(routes, ["/customers/7/statement"]);
  await pass(400, 1);
  const download = screen.getByRole("button", { name: "Download PDF" });
  act(() => download.focus());
  fireEvent.click(download);
  expect(download).not.toBeDisabled();
  expect(download).toHaveAttribute("aria-busy", "true");
  expect(download).toHaveFocus();
  fireEvent.click(download);
  expect(makeStatementPdf).toHaveBeenCalledTimes(1);
  await act(async () => ready());
  expect(download).toHaveFocus();
  expect(clicked).toHaveLength(1);
});

test("a large statement's desktop Share opens WhatsApp within the press before the PDF is made", async () => {
  handClock();
  const ready = heldPdf();
  const open = vi.spyOn(window, "open").mockReturnValue({ opener: {} } as Window);
  serve({ "GET customers/7/": ANIL, "GET customers/7/statement/": manyBills(200) });
  mount(routes, ["/customers/7/statement"]);
  await pass(400, 1);
  fireEvent.click(screen.getByRole("button", { name: "Share PDF" }));
  expect(open).toHaveBeenCalledWith("https://wa.me/919829041122", "_blank");
  expect(clicked).toEqual([]);
  await act(async () => ready());
  expect(clicked).toEqual(["Anil-Gupta_statement_FY-2026-27.pdf"]);
  expect(open).toHaveBeenCalledTimes(1);
});

test.each([150, 151])("at %i bills, Print and Download spin only when the PDF is made on press", async (count) => {
  handClock();
  const ready = heldPdf();
  serve({ "GET customers/7/": ANIL, "GET customers/7/statement/": manyBills(count) });
  mount(routes, ["/customers/7/statement"]);
  await pass(400, 1);
  const print = screen.getByRole("button", { name: "Print" });
  const download = screen.getByRole("button", { name: "Download PDF" });
  const share = screen.getByRole("button", { name: "Share PDF" });
  if (count === 151) {
    expect(makeStatementPdf).not.toHaveBeenCalled();
    act(() => download.focus());
    fireEvent.click(download);
  }
  expect(makeStatementPdf).toHaveBeenCalledTimes(1);
  for (const button of [print, download]) {
    expect(button).toHaveAttribute("title", "Making the PDF…");
    if (count === 150) {
      expect(button).toBeDisabled();
      expect(button).not.toHaveAttribute("aria-busy");
      expect(button.querySelector(".anim-spin")).toBeNull();
    } else {
      expect(button).not.toBeDisabled();
      expect(button).toHaveAttribute("aria-busy", "true");
      expect(button.querySelector(".anim-spin")).not.toBeNull();
    }
  }
  expect(share).toHaveAttribute("aria-busy", "true");
  if (count === 150) expect(share).toBeDisabled();
  else {
    expect(share).not.toBeDisabled();
    expect(download).toHaveFocus();
  }
  await act(async () => ready());
  for (const button of [print, download, share]) {
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute("aria-busy");
  }
  if (count === 151) expect(download).toHaveFocus();
});

test.each([150, 151])("at %i bills, phone Share keeps its spinner and small statements remain natively disabled", async (count) => {
  handClock();
  (window as unknown as { __phone?: boolean }).__phone = true;
  const ready = heldPdf();
  Object.assign(navigator, { share: vi.fn(async () => {}), canShare: () => true });
  serve({ "GET customers/7/": ANIL, "GET customers/7/statement/": manyBills(count) });
  mount(routes, ["/customers/7/statement"]);
  await pass(400, 1);
  const share = screen.getByRole("button", { name: "Share PDF" });
  if (count === 151) {
    expect(makeStatementPdf).not.toHaveBeenCalled();
    act(() => share.focus());
    fireEvent.click(share);
  }
  expect(makeStatementPdf).toHaveBeenCalledTimes(1);
  expect(share).toHaveAttribute("aria-busy", "true");
  if (count === 150) expect(share).toBeDisabled();
  else {
    expect(share).not.toBeDisabled();
    expect(share).toHaveFocus();
  }
  await act(async () => ready());
  expect(share).toBeEnabled();
  expect(share).not.toHaveAttribute("aria-busy");
});
