import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { refuse, salesServer, wireBin, wireDetail, wireRow } from "@/core/sales/fixtures";
import { toBillDetail, toBillRow } from "@/core/sales/wire";
import { renderApp } from "@/test/render";
import { useBillDialogs, type DialogBill, type DialogKind } from "./BillDialogs";

afterEach(() => { vi.useRealTimers(); });

const row = (over: Record<string, unknown> = {}) => toBillRow(wireRow(over));
function Harness({ bill, kind, onDeleted }: { bill: DialogBill; kind: DialogKind; onDeleted?: () => void }) {
  const d = useBillDialogs({ onDeleted });
  return <><button type="button" onClick={() => d.open(kind, bill)}>open it</button>{d.element}</>;
}
/** Opens the dialog, then steps past its guard against the tail of the click that opened it (350 ms). */
async function openIt() {
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  await userEvent.click(screen.getByText("open it"));
  act(() => { vi.advanceTimersByTime(400); });
}

test("cancelling names the bill and needs a reason; a chip fills it; the toast says what stays", async () => {
  const { calls } = salesServer([["POST", "sales/412/cancel/", () => ({ id: 412, invoice_number: "KGH/2026-27/31", status: "cancelled", cancel_reason: "Customer returned it",
    cancelled_at: "2026-10-08T15:02:11+05:30", cancelled_by: { id: 1, name: "Kailash Mehta" } })]]);
  renderApp(<Harness bill={row()} kind="cancel" />);
  await openIt();
  const dialog = screen.getByRole("dialog", { name: "Cancel bill KGH/2026-27/31?" });
  for (const words of ["KIRAN GOLD HOUSE", "08 Oct 2026", "Anil Gupta", "₹87,083.21", "It stays in October 2026's GSTR-1 as a cancelled bill with its number, so the series has no gap."]) expect(dialog).toHaveTextContent(words);
  await userEvent.click(within(dialog).getByRole("button", { name: "Cancel bill" }));
  expect(within(dialog).getByText("Say why in a few words. It goes into the audit log.")).toBeInTheDocument();
  expect(calls.some((c) => c.url.endsWith("/cancel/"))).toBe(false);
  await userEvent.click(within(dialog).getByRole("button", { name: "Customer returned it" }));
  await userEvent.click(within(dialog).getByRole("button", { name: "Cancel bill" }));
  await waitFor(() => expect(calls.find((c) => c.url === "sales/412/cancel/")?.body).toEqual({ reason: "Customer returned it" }));
  expect(await screen.findByText("Cancelled KGH/2026-27/31")).toBeInTheDocument();
  expect(screen.getByText("It stays in October 2026's GSTR-1 as cancelled, with its number. Make it again from the bill if it was a mistake.")).toBeInTheDocument();
});

test("a closed month refuses the cancel in the server's words, and Try again asks again", async () => {
  let tries = 0;
  salesServer([["POST", "sales/412/cancel/", () => {
    tries += 1;
    return refuse(409, { detail: "October 2026 is filed and locked for KIRAN GOLD HOUSE, so its bills can't be cancelled. Have the owner unlock October 2026 in GST returns first.", code: "month_closed" });
  }]]);
  renderApp(<Harness bill={row()} kind="cancel" />);
  await openIt();
  const dialog = screen.getByRole("dialog");
  await userEvent.type(within(dialog).getByLabelText("Why is it cancelled?"), "Wrong customer");
  await userEvent.click(within(dialog).getByRole("button", { name: "Cancel bill" }));
  expect(await within(dialog).findByText("Not cancelled")).toBeInTheDocument();
  expect(within(dialog).getByText(/so its bills can't be cancelled/)).toBeInTheDocument();
  await userEvent.click(within(dialog).getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(tries).toBe(2));
});

test("deleting moves the bill to the bin with its reason, says what deleting does, and Undo brings it back", async () => {
  const deleted = vi.fn();
  const { calls } = salesServer([
    ["DELETE", "sales/412/", () => wireBin({ id: 11, original_id: 412, invoice_number: "KGH/2026-27/31" })],
    ["POST", "bin/11/restore/", () => wireDetail()],
  ]);
  renderApp(<Harness bill={row()} kind="delete" onDeleted={deleted} />);
  await openIt();
  const dialog = screen.getByRole("dialog", { name: "Delete bill KGH/2026-27/31?" });
  expect(dialog).toHaveTextContent("Removes it from Sales, the dashboard and October's GST figures.");
  expect(dialog).toHaveTextContent("The number KGH/2026-27/31 stays used, so no other bill gets it.");
  await userEvent.click(within(dialog).getByRole("button", { name: "Entered twice" }));
  await userEvent.click(within(dialog).getByRole("button", { name: "Delete bill" }));
  await waitFor(() => expect(calls.find((c) => c.method === "DELETE")?.body).toEqual({ reason: "Entered twice" }));
  expect(deleted).toHaveBeenCalledTimes(1);
  expect(await screen.findByText("Deleted KGH/2026-27/31")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: /^Undo/ }));
  await waitFor(() => expect(calls.some((c) => c.url === "bin/11/restore/")).toBe(true));
  expect(await screen.findByText("Restored KGH/2026-27/31")).toBeInTheDocument();
});

test("renumbering starts on the next free number, checks a typed one's shape, and shows the server's words when it's taken", async () => {
  const { calls } = salesServer([
    ["GET", "sales/412/", () => wireDetail({ checks: ["duplicate"], duplicates: [{ id: 388, invoice_number: "KGH/2026-27/31", invoice_date: "2026-09-10", customer_name: "Hemant Dave", status: "active" }] })],
    ["GET", "sales/next-number/", () => ({ business: 3, fy: "2026-27", invoice_date: "2026-10-08", counter: 35, invoice_number: "KGH/2026-27/35", full_number: true })],
    ["GET", "sales/check-number/", () => ({ invoice_number: "KGH/2026-27/34", counter: 34, code: "", problem: "", bill: null, binned: null, note: "", same_counter: null, next: { counter: 35, invoice_number: "KGH/2026-27/35" } })],
    ["POST", "sales/412/renumber/", ({ body }) => ((body as { invoice_number: string }).invoice_number === "33"
      ? refuse(409, { detail: "KGH/2026-27/33 is already used in FY 2026-27 by Meena Jain's bill of 08 Oct 2026. The next free number is KGH/2026-27/35.", code: "number_taken" })
      : { id: 412, invoice_number: "KGH/2026-27/34", previous: "KGH/2026-27/31" })],
  ]);
  renderApp(<Harness bill={row({ checks: ["duplicate"] })} kind="renumber" />);
  await openIt();
  const dialog = screen.getByRole("dialog", { name: "Give KGH/2026-27/31 a new number" });
  const field = within(dialog).getByLabelText("New number");
  await waitFor(() => expect(field).toHaveValue("KGH/2026-27/35"));
  expect(await within(dialog).findByText("This bill (Anil Gupta, 08 Oct 2026) shares its number with Hemant Dave's bill of 10 Sep 2026.")).toBeInTheDocument();
  expect(dialog).toHaveTextContent("KGH/2026-27/35 is the next free number in KIRAN GOLD HOUSE for FY 2026-27. Type 34 for KGH/2026-27/34, or any other format; numbers are unique in a year.");
  await userEvent.clear(field);
  await userEvent.type(field, "KGH 34{Enter}");
  expect(within(dialog).getByText("Use only letters, digits, \"-\" and \"/\" (GST rule 46). Spaces and other marks aren't allowed.")).toBeInTheDocument();
  await userEvent.clear(field);
  await userEvent.type(field, "33{Enter}");
  expect(await within(dialog).findByText(/^KGH\/2026-27\/33 is already used in FY 2026-27/)).toBeInTheDocument();
  await userEvent.clear(field);
  await userEvent.type(field, "34");
  expect(await within(dialog).findByText(/^Saved as KGH\/2026-27\/34\./)).toBeInTheDocument();
  await userEvent.keyboard("{Enter}");
  expect(await screen.findByText("KGH/2026-27/31 is now KGH/2026-27/34")).toBeInTheDocument();
  expect(screen.getByText("October's GSTR-1 for KIRAN GOLD HOUSE no longer has a duplicate. Send Anil Gupta the corrected bill.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
  expect(calls.filter((c) => c.url === "sales/412/renumber/").map((c) => c.body)).toEqual([{ invoice_number: "33" }, { invoice_number: "34" }]);
});

test("moving to another firm offers only the others, starts on that firm's next number, and says what's left unused", async () => {
  const { calls } = salesServer([
    ["GET", "sales/next-number/", ({ params }) => ({ business: params.business_id, fy: "2026-27", invoice_date: "2026-10-08", counter: 31, invoice_number: "MO/2026-27/31", full_number: true })],
    ["GET", "sales/check-number/", () => ({ invoice_number: "MO/2026-27/31", counter: 31, code: "", problem: "", bill: null, binned: null, note: "", same_counter: null, next: { counter: 31, invoice_number: "MO/2026-27/31" } })],
    ["POST", "sales/412/move/", () => ({ id: 412, business: 2, invoice_number: "MO/2026-27/31", previous: { business: 3, invoice_number: "KGH/2026-27/31" } })],
  ]);
  renderApp(<Harness bill={row()} kind="move" />);
  await openIt();
  const dialog = screen.getByRole("dialog", { name: "Move KGH/2026-27/31 to another firm" });
  await waitFor(() => expect(within(dialog).getByLabelText("Number in that firm's series")).toHaveValue("MO/2026-27/31"));
  expect(within(dialog).getByLabelText("Firm")).toHaveValue("2");
  expect(within(dialog).queryByRole("option", { name: "KIRAN GOLD HOUSE" })).not.toBeInTheDocument();
  expect(dialog).toHaveTextContent("Moves the bill to MEERA ORNAMENTS as MO/2026-27/31. KGH/2026-27/31 is left unused.");
  await userEvent.click(within(dialog).getByRole("button", { name: "Move bill" }));
  await waitFor(() => expect(calls.find((c) => c.url === "sales/412/move/")?.body).toEqual({ business: 2, invoice_number: "MO/2026-27/31" }));
  expect(await screen.findByText("KGH/2026-27/31 is now MO/2026-27/31")).toBeInTheDocument();
});

test("the e-way bill checks the number, a vehicle by road and the distance, then saves exactly what's typed", async () => {
  const { calls } = salesServer([
    ["GET", "sales/412/", () => wireDetail()],
    ["PUT", "sales/412/eway/", () => wireDetail()],
  ]);
  renderApp(<Harness bill={toBillDetail(wireDetail())} kind="eway" />);
  await openIt();
  const dialog = screen.getByRole("dialog", { name: "E-way bill for KGH/2026-27/31" });
  await userEvent.type(within(dialog).getByLabelText("E-way bill number"), "1234 5678");
  await userEvent.type(within(dialog).getByLabelText("Distance"), "5000");
  await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  expect(within(dialog).getByText("An e-way bill number has 12 digits; this has 8.")).toBeInTheDocument();
  expect(within(dialog).getByText("Type the distance in whole kilometres, 1 to 4,000.")).toBeInTheDocument();
  await userEvent.type(within(dialog).getByLabelText("E-way bill number"), "9012");
  await userEvent.clear(within(dialog).getByLabelText("Distance"));
  await userEvent.type(within(dialog).getByLabelText("Distance"), "120");
  await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  expect(within(dialog).getByText("By road, the e-way bill needs the vehicle number. Add it here, or later on the portal (Part B).")).toBeInTheDocument();
  await userEvent.type(within(dialog).getByLabelText("Transporter"), "Shree Transport");
  await userEvent.type(within(dialog).getByLabelText("Vehicle number"), "rj14 ab-1234");
  await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(calls.find((c) => c.method === "PUT")?.body).toEqual({
    eway_bill_number: "123456789012", transport_mode: "Road", transporter_name: "Shree Transport", transporter_gstin: "", vehicle_number: "RJ14AB1234", vehicle_type: "Regular", distance_km: 120,
  }));
  expect(await screen.findByText("E-way bill saved on KGH/2026-27/31")).toBeInTheDocument();
});

/* ── Beyond the brief: Ruling 1B-9's one number check and storedNumber, and what's stored on an e-way bill ── */

/**
 * For a test that waits on the number field's own pause (300 ms) before the server checks what's typed: a clock that
 * moves only when the test says, however long each step takes on a busy machine. Testing Library's async helpers
 * (userEvent, findBy, waitFor) wait on a 0 ms timer that this clock never runs, so these tests use fireEvent and pass().
 */
function handClock() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
}
/** The clock moves `ms` on; then what that set off reaches the screen (TanStack sends its news on a 0 ms timer). */
async function pass(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}
/** What a field holds after the person typed `value` into it. */
const typeIn = (field: HTMLElement, value: string) => fireEvent.change(field, { target: { value } });
const NEXT = { counter: 35, invoice_number: "KGH/2026-27/35" };
/** check-number for KGH's series: 29 is taken, 38 skips 35 to 37, anything else is free; digits take the firm's format. */
function checkNumber({ params }: { params: Record<string, unknown> }) {
  const n = Number(params.invoice_number);
  const free = { invoice_number: `KGH/2026-27/${n}`, counter: n, code: "", problem: "", bill: null, binned: null, note: "", same_counter: null, next: NEXT };
  if (n === 29) {
    return { ...free, code: "number_taken", problem: "KGH/2026-27/29 is already used in FY 2026-27 by Meena Jain's bill of 08 Oct 2026. The next free number is KGH/2026-27/35.",
      bill: { id: 380, invoice_number: "KGH/2026-27/29", invoice_date: "2026-10-08", customer_name: "Meena Jain", status: "active" } };
  }
  return n === 38 ? { ...free, note: "Numbers 35 to 37 would be skipped. GSTR-1 lists skipped numbers, so only do this on purpose." } : free;
}

test("a typed number reads as the server stores it (034 is 34), a number the check finds taken is refused before anything is sent, and a skip is noted", async () => {
  handClock();
  const { calls } = salesServer([
    ["GET", "sales/412/", () => wireDetail()],
    ["GET", "sales/next-number/", () => ({ business: 3, fy: "2026-27", invoice_date: "2026-10-08", ...NEXT, full_number: true })],
    ["GET", "sales/check-number/", checkNumber],
    ["POST", "sales/412/renumber/", () => ({ id: 412, invoice_number: "KGH/2026-27/38", previous: "KGH/2026-27/31" })],
  ]);
  renderApp(<Harness bill={row()} kind="renumber" />);
  fireEvent.click(screen.getByText("open it"));
  await pass(400); // the next free number comes, and the dialog's guard against a double tap's second tap passes
  const dialog = screen.getByRole("dialog", { name: "Give KGH/2026-27/31 a new number" });
  const field = within(dialog).getByLabelText("New number");
  expect(field).toHaveValue("KGH/2026-27/35");
  typeIn(field, "034");
  // the server drops the leading zero as it formats the number (int(text)), and the field says so before the check answers
  expect(within(dialog).getByText(/^Saved as KGH\/2026-27\/34\. /)).toBeInTheDocument();
  typeIn(field, "29");
  await pass(300);
  expect(calls.filter((c) => c.url === "sales/check-number/").map((c) => c.params)).toContainEqual({ business_id: 3, invoice_date: "2026-10-08", invoice_number: "29", exclude_id: 412 });
  fireEvent.click(within(dialog).getByRole("button", { name: "Renumber bill" }));
  expect(within(dialog).getByText("KGH/2026-27/29 is already used in FY 2026-27 by Meena Jain's bill of 08 Oct 2026. The next free number is KGH/2026-27/35.")).toBeInTheDocument();
  expect(calls.some((c) => c.url === "sales/412/renumber/")).toBe(false);
  typeIn(field, "38");
  await pass(300);
  expect(within(dialog).getByText("Saved as KGH/2026-27/38. Numbers 35 to 37 would be skipped. GSTR-1 lists skipped numbers, so only do this on purpose.")).toBeInTheDocument();
  fireEvent.keyDown(field, { key: "Enter" });
  await pass(0);
  expect(calls.filter((c) => c.url === "sales/412/renumber/").map((c) => c.body)).toEqual([{ invoice_number: "38" }]);
  expect(screen.getByText("KGH/2026-27/31 is now KGH/2026-27/38")).toBeInTheDocument();
});

test("moving checks the number in the new firm's series with the same check, and a refusal about the month says so in the server's words", async () => {
  handClock();
  let tries = 0;
  const { calls } = salesServer([
    ["GET", "sales/next-number/", () => ({ business: 2, fy: "2026-27", invoice_date: "2026-10-08", counter: 31, invoice_number: "MO/2026-27/31", full_number: true })],
    ["GET", "sales/check-number/", ({ params }) => (params.invoice_number === "29"
      ? { invoice_number: "MO/2026-27/29", counter: 29, code: "number_deleted", problem: "MO/2026-27/29 belonged to a bill that was deleted (it can be restored from the Audit log), so it can't be used again. The next free number is MO/2026-27/31.",
        bill: null, binned: null, note: "", same_counter: null, next: { counter: 31, invoice_number: "MO/2026-27/31" } }
      : { invoice_number: `MO/2026-27/${Number(params.invoice_number)}`, counter: 30, code: "", problem: "", bill: null, binned: null, note: "", same_counter: null, next: { counter: 31, invoice_number: "MO/2026-27/31" } })],
    ["POST", "sales/412/move/", () => { tries += 1; return refuse(409, { detail: "October 2026 is filed and locked for MEERA ORNAMENTS, so its bills can't move to another firm. Have the owner unlock October 2026 in GST returns first.", code: "month_closed" }); }],
  ]);
  renderApp(<Harness bill={row()} kind="move" />);
  fireEvent.click(screen.getByText("open it"));
  await pass(400); // the firms and that firm's next free number come, and the dialog's guard passes
  const dialog = screen.getByRole("dialog", { name: "Move KGH/2026-27/31 to another firm" });
  const field = within(dialog).getByLabelText("Number in that firm's series");
  expect(field).toHaveValue("MO/2026-27/31");
  typeIn(field, "29");
  await pass(300);
  expect(within(dialog).getByText("Moves the bill to MEERA ORNAMENTS as MO/2026-27/29. KGH/2026-27/31 is left unused.")).toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "Move bill" }));
  expect(within(dialog).getByText(/^MO\/2026-27\/29 belonged to a bill that was deleted/)).toBeInTheDocument();
  expect(tries).toBe(0);
  typeIn(field, "30");
  await pass(300);
  fireEvent.click(within(dialog).getByRole("button", { name: "Move bill" }));
  await pass(0);
  expect(within(dialog).getByText("Not moved")).toBeInTheDocument();
  expect(within(dialog).getByText(/so its bills can't move to another firm/)).toBeInTheDocument();
  expect(calls.filter((c) => c.url === "sales/412/move/").map((c) => c.body)).toEqual([{ business: 2, invoice_number: "30" }]);
});

test("the e-way bill opened from a list waits for what's stored on the bill, then shows it, the number in fours, so a save keeps it", async () => {
  let answer: (w: unknown) => void = () => {};
  const STORED = { eway_bill_number: "123456789012", transporter_name: "Shree Transport", transporter_gstin: "", vehicle_number: "RJ14AB1234", vehicle_type: "Regular", transport_mode: "Road", distance_km: 120, may_be_needed: false };
  const { calls } = salesServer([
    ["GET", "sales/412/", () => new Promise((resolve) => { answer = resolve; })],
    ["PUT", "sales/412/eway/", () => wireDetail({ eway: STORED })],
  ]);
  renderApp(<Harness bill={row()} kind="eway" />);
  await openIt();
  const dialog = screen.getByRole("dialog", { name: "E-way bill for KGH/2026-27/31" });
  // a list's row doesn't carry the e-way details: nothing can be typed over them before they come
  expect(within(dialog).queryByLabelText("E-way bill number")).not.toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "Save" })).toBeDisabled();
  await act(async () => { answer(wireDetail({ eway: STORED })); });
  await waitFor(() => expect(within(dialog).getByLabelText("E-way bill number")).toHaveValue("1234 5678 9012"));
  expect(within(dialog).getByLabelText("Transporter")).toHaveValue("Shree Transport");
  expect(within(dialog).getByLabelText("Vehicle number")).toHaveValue("RJ14AB1234");
  expect(within(dialog).getByLabelText("Distance")).toHaveValue("120");
  await userEvent.click(within(dialog).getByRole("button", { name: "Save" }));
  await waitFor(() => expect(calls.find((c) => c.method === "PUT")?.body).toEqual({
    eway_bill_number: "123456789012", transport_mode: "Road", transporter_name: "Shree Transport", transporter_gstin: "", vehicle_number: "RJ14AB1234", vehicle_type: "Regular", distance_km: 120,
  }));
  expect(await screen.findByText("E-way bill saved on KGH/2026-27/31")).toBeInTheDocument();
});
