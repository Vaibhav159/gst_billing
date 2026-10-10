import { useState } from "react";
import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError } from "axios";
import type { PaymentMode } from "@/core/sales/types";
import { refuse, salesServer } from "@/core/sales/fixtures";
import { Sheet } from "@/core/ui";
import { renderApp } from "@/test/render";
import { CheckList, DateField, PayPicker, RateInput, rateShown, readRate } from "./fields";
import { NewItemForm, type NewItem } from "./NewItemForm";

const TODAY = "2026-10-08";
afterEach(() => { vi.useRealTimers(); });

function DateHarness({ off = () => "" }: { off?: (iso: string) => string }) {
  const [v, setV] = useState("2026-10-08");
  return <><label htmlFor="d">Date</label><DateField id="d" value={v} today={TODAY} offReason={off} onChange={(iso) => setV(iso ?? "")} /><p>value:{v || "none"}</p></>;
}

test("a date is typed day-first and reads back in full once you leave it", async () => {
  renderApp(<DateHarness />);
  const box = screen.getByLabelText("Date");
  expect(box).toHaveValue("08 Oct 2026");
  await userEvent.clear(box);
  await userEvent.type(box, "30/9");
  expect(screen.getByText("value:2026-09-30")).toBeInTheDocument();
  await userEvent.tab();
  expect(box).toHaveValue("30 Sep 2026");
  await userEvent.clear(box);
  await userEvent.type(box, "soon");
  expect(screen.getByText("value:none")).toBeInTheDocument();
});

test("Alt + Down opens the calendar on the day; arrows move, Enter picks; a day the form can't take says why and can't be picked", async () => {
  renderApp(<DateHarness off={(iso) => (iso > TODAY ? "after today" : iso < "2026-10-01" ? "September 2026 is filed" : "")} />);
  screen.getByLabelText("Date").focus();
  await userEvent.keyboard("{Alt>}{ArrowDown}{/Alt}");
  const grid = await screen.findByRole("grid", { name: "October 2026" });
  await waitFor(() => expect(within(grid).getByRole("button", { name: "08 Oct 2026" })).toHaveFocus());
  await userEvent.keyboard("{ArrowLeft}{ArrowLeft}{Enter}");
  expect(screen.getByText("value:2026-10-06")).toBeInTheDocument();
  expect(screen.getByLabelText("Date")).toHaveFocus();
  await userEvent.keyboard("{Alt>}{ArrowDown}{/Alt}");
  const off = within(await screen.findByRole("grid")).getByRole("button", { name: "09 Oct 2026, after today" });
  expect(off).toHaveAttribute("aria-disabled", "true");
  await userEvent.click(off);
  expect(screen.getByText("value:2026-10-06")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Next month" })).toBeDisabled();
});

/** A grid as a screen reader takes it: each child's role, then the roles of that child's own children. */
const shape = (grid: HTMLElement) => [...grid.children].map((row) => [row.getAttribute("role"), ...[...row.children].map((c) => c.getAttribute("role"))]);
const HEADER = ["row", ...Array<string>(7).fill("columnheader")];
const WEEK = ["row", ...Array<string>(7).fill("gridcell")];

test("the calendar is a grid: a row of the days' names, then a row per week, each day a cell holding its button", async () => {
  renderApp(<DateHarness />);
  await userEvent.click(screen.getByRole("button", { name: "Date: open the calendar" }));
  // every child of the grid is a row; every child of a row, a column header or a cell; seven to a row
  const october = await screen.findByRole("grid", { name: "October 2026" });
  expect(shape(october)).toEqual([HEADER, WEEK, WEEK, WEEK, WEEK, WEEK]);
  // one stop for Tab: the day the arrows start from
  expect(within(october).getAllByRole("button").filter((b) => b.tabIndex === 0).map((b) => b.getAttribute("data-day"))).toEqual(["2026-10-08"]);
  const [names, first] = within(october).getAllByRole("row");
  expect(within(names).getAllByRole("columnheader").map((h) => h.getAttribute("aria-label"))).toEqual(["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]);
  // 1 October 2026 is a Thursday: four blank cells before it
  expect(within(first).getAllByRole("gridcell").map((c) => c.textContent)).toEqual(["", "", "", "", "1", "2", "3"]);
  expect(within(first).getAllByRole("button").map((b) => b.getAttribute("data-day"))).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
  // September ends on a Wednesday: its last week is filled out with blank cells
  await userEvent.click(screen.getByRole("button", { name: "Previous month" }));
  const september = await screen.findByRole("grid", { name: "September 2026" });
  expect(shape(september)).toEqual([HEADER, WEEK, WEEK, WEEK, WEEK, WEEK]);
  expect(within(within(september).getAllByRole("row")[5]).getAllByRole("gridcell").map((c) => c.textContent)).toEqual(["27", "28", "29", "30", "", "", ""]);
});

test("Esc closes the calendar and puts the cursor back in the date", async () => {
  renderApp(<DateHarness />);
  screen.getByLabelText("Date").focus();
  await userEvent.keyboard("{Alt>}{ArrowDown}{/Alt}");
  await waitFor(() => expect(within(screen.getByRole("grid")).getByRole("button", { name: "08 Oct 2026" })).toHaveFocus());
  await userEvent.keyboard("{ArrowLeft}{Escape}");
  expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Date")).toHaveFocus();
  expect(screen.getByText("value:2026-10-08")).toBeInTheDocument();
});

/* ── The calendar by keyboard, past the month buttons ── */
/** A date that starts on `start`, with a button after it to Tab to. */
function DateThenButton({ start = TODAY }: { start?: string }) {
  const [v, setV] = useState(start);
  return (
    <>
      <label htmlFor="d">Date</label>
      <DateField id="d" value={v} today={TODAY} offReason={(iso) => (iso > TODAY ? "after today" : "")} onChange={(iso) => setV(iso ?? "")} />
      <p>value:{v || "none"}</p>
      <button type="button">After the date</button>
    </>
  );
}
/** Where the cursor is: a day by its date, else a button by its name or words. */
const cursor = () => {
  const a = document.activeElement;
  return a?.getAttribute("data-day") ?? a?.getAttribute("aria-label") ?? a?.textContent ?? "";
};
async function openCalendar(on: string) {
  screen.getByLabelText("Date").focus();
  await userEvent.keyboard("{Alt>}{ArrowDown}{/Alt}");
  await waitFor(() => expect(cursor()).toBe(on));
}

test("after Previous month, Tab reaches the same day of the month shown (or its last day), and the arrows go on from there", async () => {
  renderApp(<DateThenButton start="2025-10-31" />);
  await openCalendar("2025-10-31");
  await userEvent.tab({ shift: true });
  await userEvent.tab({ shift: true });
  expect(cursor()).toBe("Previous month");
  await userEvent.keyboard("{Enter}");
  expect(screen.getByRole("grid", { name: "September 2025" })).toBeInTheDocument();
  // the cursor stays on the button, so Enter again goes back another month
  expect(cursor()).toBe("Previous month");
  await userEvent.tab();
  expect(cursor()).toBe("Next month");
  await userEvent.tab();
  expect(cursor()).toBe("2025-09-30");
  await userEvent.keyboard("{ArrowLeft}");
  expect(cursor()).toBe("2025-09-29");
});

test("back on the chosen day's month by the month buttons, Enter goes on through the months and picks no day", async () => {
  renderApp(<DateThenButton start="2026-08-20" />);
  await openCalendar("2026-08-20");
  await userEvent.keyboard("{ArrowLeft}{ArrowLeft}");
  expect(cursor()).toBe("2026-08-18");
  await userEvent.tab({ shift: true });
  expect(cursor()).toBe("Next month");
  await userEvent.keyboard("{Enter}");
  expect(screen.getByRole("grid", { name: "September 2026" })).toBeInTheDocument();
  await userEvent.tab({ shift: true });
  expect(cursor()).toBe("Previous month");
  await userEvent.keyboard("{Enter}");
  expect(screen.getByRole("grid", { name: "August 2026" })).toBeInTheDocument();
  expect(cursor()).toBe("Previous month");
  await userEvent.keyboard("{Enter}");
  expect(screen.getByRole("grid", { name: "July 2026" })).toBeInTheDocument();
  expect(screen.getByText("value:2026-08-20")).toBeInTheDocument();
});

test("Next month onto this month turns itself off, and the cursor moves to Previous month rather than the page", async () => {
  renderApp(<DateThenButton start="2026-09-30" />);
  await openCalendar("2026-09-30");
  await userEvent.tab({ shift: true });
  expect(cursor()).toBe("Next month");
  await userEvent.keyboard("{Enter}");
  expect(screen.getByRole("grid", { name: "October 2026" })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Next month" })).toBeDisabled();
  expect(cursor()).toBe("Previous month");
});

test("Esc on a month button closes the calendar too, and puts the cursor back in the date", async () => {
  renderApp(<DateThenButton />);
  await openCalendar("2026-10-08");
  await userEvent.tab({ shift: true });
  expect(cursor()).toBe("Previous month");
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Date")).toHaveFocus();
});

test("Tab out of the calendar closes it, so it doesn't sit over the next field", async () => {
  renderApp(<DateThenButton />);
  await openCalendar("2026-10-08");
  await userEvent.tab();
  expect(cursor()).toBe("After the date");
  expect(screen.queryByRole("grid")).not.toBeInTheDocument();
});

test("on a phone the calendar is a dialog of its own: a tap on a month button inside it keeps it open", async () => {
  const phone = (on: boolean) => { (window as unknown as { __phone?: boolean }).__phone = on; };
  phone(true);
  try {
    // a clock the test moves, past the dialog's guard against a double tap's second tap
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderApp(<DateThenButton />);
    await user.click(screen.getByRole("button", { name: "Date: open the calendar" }));
    const dialog = await screen.findByRole("dialog", { name: "Date" });
    await act(() => { vi.advanceTimersByTime(400); });
    await waitFor(() => expect(cursor()).toBe("2026-10-08"));
    await user.click(within(dialog).getByRole("button", { name: "Previous month" }));
    expect(within(dialog).getByRole("grid", { name: "September 2026" })).toBeInTheDocument();
  } finally { phone(false); }
});

/** The day Tab would reach in the calendar: the one day button in its tab order. */
const tabStop = () => within(screen.getByRole("grid")).getAllByRole("button").filter((b) => b.tabIndex === 0).map((b) => b.getAttribute("data-day"));

test("the Tab stop never lands after today: from 30 Sep, Next month leaves it on today, and PageDown goes no further than today", async () => {
  renderApp(<DateThenButton start="2026-09-30" />);
  await openCalendar("2026-09-30");
  await userEvent.tab({ shift: true });
  expect(cursor()).toBe("Next month");
  await userEvent.keyboard("{Enter}");
  expect(screen.getByRole("grid", { name: "October 2026" })).toBeInTheDocument();
  expect(tabStop()).toEqual(["2026-10-08"]);
  // Previous month has the cursor (Next month is off on this month): Tab goes on to today
  await userEvent.tab();
  expect(cursor()).toBe("2026-10-08");
  // a month on from 30 Sep is today, not 30 Oct; and a month on from today stays on today
  await userEvent.keyboard("{PageUp}");
  expect(cursor()).toBe("2026-09-08");
  await userEvent.keyboard("{ArrowRight}{PageDown}");
  expect(cursor()).toBe("2026-10-08");
  await userEvent.keyboard("{PageDown}");
  expect(cursor()).toBe("2026-10-08");
  expect(screen.getByRole("grid", { name: "October 2026" })).toBeInTheDocument();
});

test("a day the cursor lands on by a click is where the arrows go on from: click 15 Oct, then the right arrow goes to 16 Oct", async () => {
  renderApp(<DateThenButton />);
  await openCalendar("2026-10-08");
  // a day after today: the click can't pick it, so the calendar stays open with the cursor on it
  await userEvent.click(screen.getByRole("button", { name: "15 Oct 2026, after today" }));
  expect(cursor()).toBe("2026-10-15");
  expect(tabStop()).toEqual(["2026-10-15"]);
  await userEvent.keyboard("{ArrowRight}");
  expect(cursor()).toBe("2026-10-16");
  expect(screen.getByText("value:2026-10-08")).toBeInTheDocument();
});

test("Esc closes the open calendar from the date box and from the calendar's button too", async () => {
  renderApp(<DateThenButton />);
  await openCalendar("2026-10-08");
  // back in the box, the calendar still open
  await userEvent.click(screen.getByLabelText("Date"));
  expect(screen.getByRole("grid")).toBeInTheDocument();
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Date")).toHaveFocus();
  await userEvent.click(screen.getByRole("button", { name: "Date: open the calendar" }));
  await waitFor(() => expect(cursor()).toBe("2026-10-08"));
  // Next month is off on this month: back past Previous month to the calendar's button
  await userEvent.tab({ shift: true });
  await userEvent.tab({ shift: true });
  expect(cursor()).toBe("Date: open the calendar");
  await userEvent.keyboard("{Escape}");
  expect(screen.queryByRole("grid")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Date: open the calendar" })).toHaveFocus();
});

test("on a phone, closing the calendar gives the cursor back to the button that opened it", async () => {
  const phone = (on: boolean) => { (window as unknown as { __phone?: boolean }).__phone = on; };
  phone(true);
  try {
    // a clock the test moves: the dialog's focus step, its guard against a double tap's second tap, and its way out
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderApp(<DateThenButton />);
    const opener = screen.getByRole("button", { name: "Date: open the calendar" });
    await user.click(opener);
    await screen.findByRole("dialog", { name: "Date" });
    await act(() => { vi.advanceTimersByTime(400); });
    // the dialog puts the cursor on the day, once it has noted what opened it
    await waitFor(() => expect(cursor()).toBe("2026-10-08"));
    await user.keyboard("{Escape}");
    await act(() => { vi.advanceTimersByTime(400); });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    // and by its Close button too
    await user.click(opener);
    const dialog = await screen.findByRole("dialog", { name: "Date" });
    await act(() => { vi.advanceTimersByTime(400); });
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    await act(() => { vi.advanceTimersByTime(400); });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  } finally { phone(false); }
});

test("PageUp and PageDown move a month, to the same day or the month's last: 31 Oct to 30 Sep, and back to 30 Oct", async () => {
  renderApp(<DateThenButton start="2025-10-31" />);
  await openCalendar("2025-10-31");
  await userEvent.keyboard("{PageUp}");
  expect(cursor()).toBe("2025-09-30");
  expect(screen.getByRole("grid", { name: "September 2025" })).toBeInTheDocument();
  await userEvent.keyboard("{PageDown}");
  expect(cursor()).toBe("2025-10-30");
  expect(screen.getByRole("grid", { name: "October 2025" })).toBeInTheDocument();
});

function PayHarness({ notRecorded = false }: { notRecorded?: boolean }) {
  const [v, setV] = useState<PaymentMode | null>(null);
  return <><p id="pay-l">Paid by</p><PayPicker labelledBy="pay-l" value={v} onChange={setV} allowNotRecorded={notRecorded} /><p>paid:{v ?? "nothing"}</p></>;
}

test("payment starts with nothing picked, and the first choice is a Tab away; arrows and Space pick", async () => {
  renderApp(<PayHarness />);
  const group = screen.getByRole("radiogroup", { name: "Paid by" });
  expect(within(group).getAllByRole("radio").map((r) => [r.textContent, r.getAttribute("aria-checked"), r.tabIndex])).toEqual([
    ["Cash", "false", 0], ["UPI / bank", "false", -1], ["Udhaar", "false", -1], ["Part cash, part UPI", "false", -1],
  ]);
  await userEvent.tab();
  await userEvent.keyboard(" ");
  expect(screen.getByText("paid:cash")).toBeInTheDocument();
  await userEvent.keyboard("{ArrowRight}");
  expect(screen.getByText("paid:bank")).toBeInTheDocument();
  expect(within(group).getByRole("radio", { name: "UPI / bank" })).toHaveFocus();
});

test("an older bill's “Not recorded” stays a choice", () => {
  renderApp(<PayHarness notRecorded />);
  expect(screen.getByRole("radio", { name: "Not recorded" })).toBeInTheDocument();
});

test("autoFocus marks the choice Tab would reach, for a dialog to put the cursor on first", async () => {
  function Pay() { const [v, setV] = useState<PaymentMode | null>(null); return <><p id="pay-l">Paid by</p><PayPicker labelledBy="pay-l" value={v} onChange={setV} autoFocus /></>; }
  renderApp(<Pay />);
  const marked = () => screen.getAllByRole("radio").filter((r) => r.hasAttribute("data-autofocus")).map((r) => r.textContent);
  expect(marked()).toEqual(["Cash"]);
  await userEvent.click(screen.getByRole("radio", { name: "Udhaar" }));
  expect(marked()).toEqual(["Udhaar"]);
});

test("checks: done, a problem, worth a look and waiting, each said in words, with a fix beside it", async () => {
  const fix = vi.fn();
  renderApp(<CheckList label="Checks on this bill" checks={[
    { key: "a", ok: true, text: "Bill number KGH/2026-27/34 is free" }, { key: "b", ok: false, text: "Line 1 needs an HSN code" },
    { key: "c", ok: "warn", text: "Over ₹2,00,000: Income Tax Rule 114B needs Anil Gupta's PAN (or Form 60).", action: { label: "Add PAN", onClick: fix } },
    { key: "d", ok: null, text: "How it was paid: asked when you check and save" },
  ]} />);
  const list = screen.getByRole("list", { name: "Checks on this bill" });
  expect(within(list).getAllByRole("listitem")).toHaveLength(4);
  await userEvent.click(within(list).getByRole("button", { name: "Add PAN" }));
  expect(fix).toHaveBeenCalled();
});

test("a rate is read as written, up to 3 decimals, and grouped the Indian way once you leave it", async () => {
  expect(readRate("6,512.50")).toBe("6512.50");
  expect(readRate("4150,50")).toBe("4150.50");
  expect(readRate(".5")).toBe("0.5");
  expect(readRate("12.3456")).toBeNull();
  expect(readRate("")).toBe("");
  expect(rateShown("6512.5")).toBe("6,512.50");
  expect(rateShown("999.995")).toBe("999.995");
  expect(rateShown("100000")).toBe("1,00,000.00");
  function Rate() { const [v, setV] = useState(""); return <><label htmlFor="r">Rate</label><RateInput id="r" value={v} onChange={setV} /><p>rate:{v}</p></>; }
  renderApp(<Rate />);
  const box = screen.getByLabelText("Rate");
  await userEvent.type(box, "6512.5");
  expect(screen.getByText("rate:6512.5")).toBeInTheDocument();
  await userEvent.type(box, "55");
  expect(box).toHaveValue("6512.555");
  expect(screen.getByText("rate:6512.555")).toBeInTheDocument();
  await userEvent.tab();
  expect(box).toHaveValue("6,512.555");
});

test("a rate typed from its point, or left at one, is the number it reads as; a blank stays blank", async () => {
  expect(readRate(".")).toBe("");
  expect(readRate("6512.")).toBe("6512");
  expect(rateShown("")).toBe("");
  function Rate() { const [v, setV] = useState(""); return <><label htmlFor="r">Rate</label><RateInput id="r" value={v} onChange={setV} /><p>rate:{v}</p></>; }
  renderApp(<Rate />);
  const box = screen.getByLabelText("Rate");
  await userEvent.type(box, ".5");
  expect(box).toHaveValue(".5");
  expect(screen.getByText("rate:0.5")).toBeInTheDocument();
  await userEvent.tab();
  expect(box).toHaveValue("0.50");
  await userEvent.clear(box);
  await userEvent.type(box, "6512.");
  expect(screen.getByText("rate:6512")).toBeInTheDocument();
  await userEvent.tab();
  expect(box).toHaveValue("6,512.00");
});

test("an item that isn't in Products: counter staff use it on this bill only", async () => {
  const done = vi.fn<(i: NewItem) => void>();
  salesServer();
  renderApp(<NewItemForm initialName="Silver idol" onDone={done} />, { me: { role: "staff", permissions: ["view", "bill.create", "bill.send", "customer.edit"] } });
  expect(screen.getByText("Used on this bill only. The owner adds products to the list.")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Use on this bill" }));
  expect(screen.getByText("Type the HSN code, 4 to 8 digits.")).toBeInTheDocument();
  expect(screen.getByText("Choose the GST rate. Gold and silver jewellery is 3%; cut diamonds are 0.25%.")).toBeInTheDocument();
  expect(screen.getByLabelText(/^HSN code/)).toHaveFocus();
  await userEvent.type(screen.getByLabelText(/^HSN code/), "7114");
  await userEvent.selectOptions(screen.getByLabelText(/^GST rate/), "3");
  await userEvent.selectOptions(screen.getByLabelText("Unit"), "pcs");
  await userEvent.type(screen.getByLabelText("Description"), "Ganesh, 50 g");
  await userEvent.click(screen.getByRole("button", { name: "Use on this bill" }));
  expect(done).toHaveBeenCalledWith({ productId: null, line: { name: "Silver idol", hsn: "7114", gst: "3", unit: "pcs", rate: "", description: "Ganesh, 50 g" } });
});

test("the owner keeps it in Products; a name Products already has is said under the name, and a lost connection keeps what was typed", async () => {
  const done = vi.fn<(i: NewItem) => void>();
  let tries = 0;
  const { calls } = salesServer([["POST", "products/", ({ body }) => {
    tries += 1;
    if (tries === 1) return refuse(400, { name: ["product with this Product Name already exists."] });
    if (tries === 2) throw new AxiosError("Network Error", "ERR_NETWORK");
    return { id: 12, ...(body as object) };
  }]]);
  renderApp(<NewItemForm initialName="Silver idol" onDone={done} />);
  expect(screen.getByRole("checkbox", { name: /Also save to Products/ })).toBeChecked();
  await userEvent.type(screen.getByLabelText(/^HSN code/), "7114");
  await userEvent.selectOptions(screen.getByLabelText(/^GST rate/), "3");
  await userEvent.click(screen.getByRole("button", { name: "Save and use on this bill" }));
  expect(await screen.findByText("Products already has Silver idol. Pick it from the list, or name this one differently.")).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText(/^Name/), " (Ganesh)");
  await userEvent.click(screen.getByRole("button", { name: "Save and use on this bill" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Not saved: the app couldn't get through");
  expect(screen.getByLabelText(/^Name/)).toHaveValue("Silver idol (Ganesh)");
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(done).toHaveBeenCalledWith({ productId: 12, line: expect.objectContaining({ name: "Silver idol (Ganesh)", hsn: "7114", gst: "3" }) }));
  expect(calls.filter((c) => c.method === "POST")).toHaveLength(3);
  expect(await screen.findByText("Silver idol (Ganesh) added to Products")).toBeInTheDocument();
});

test("the owner can use it on this bill only: unticked, nothing is sent; it needs a name either way", async () => {
  const done = vi.fn<(i: NewItem) => void>();
  const { calls } = salesServer();
  renderApp(<NewItemForm onDone={done} />);
  await userEvent.click(screen.getByRole("checkbox", { name: /Also save to Products/ }));
  expect(screen.getByText("Used on this bill only.")).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText(/^HSN code/), "7113");
  await userEvent.selectOptions(screen.getByLabelText(/^GST rate/), "3");
  await userEvent.click(screen.getByRole("button", { name: "Use on this bill" }));
  expect(screen.getByText("Type the item's name as it should print on the bill.")).toBeInTheDocument();
  expect(screen.getByLabelText(/^Name/)).toHaveFocus();
  await userEvent.type(screen.getByLabelText(/^Name/), "Gold coin 10 g");
  await userEvent.type(screen.getByLabelText("Rate per gms"), "6512.5");
  await userEvent.click(screen.getByRole("button", { name: "Use on this bill" }));
  expect(done).toHaveBeenCalledWith({ productId: null, line: { name: "Gold coin 10 g", hsn: "7113", gst: "3", unit: "gms", rate: "6512.5", description: "" } });
  expect(calls.some((c) => c.method === "POST")).toBe(false);
});

test("a problem puts the cursor on its field with its words read out: the form's own, and a name Products already has", async () => {
  salesServer([["POST", "products/", () => refuse(400, { name: ["product with this Product Name already exists."] })]]);
  renderApp(<NewItemForm initialName="Silver idol" onDone={() => {}} />);
  const name = screen.getByLabelText(/^Name/);
  const hsn = screen.getByLabelText(/^HSN code/);
  // what a screen reader reads as the cursor lands: the field's description at that moment
  const heard: string[] = [];
  for (const el of [name, hsn]) el.addEventListener("focus", () => heard.push(document.getElementById(el.getAttribute("aria-describedby") ?? "")?.textContent ?? ""));
  await userEvent.click(screen.getByRole("button", { name: "Save and use on this bill" }));
  expect(hsn).toHaveFocus();
  expect(heard).toEqual(["Type the HSN code, 4 to 8 digits."]);
  await userEvent.type(hsn, "7114");
  await userEvent.selectOptions(screen.getByLabelText(/^GST rate/), "3");
  heard.length = 0;
  await userEvent.click(screen.getByRole("button", { name: "Save and use on this bill" }));
  await waitFor(() => expect(name).toHaveFocus());
  expect(heard).toEqual(["Products already has Silver idol. Pick it from the list, or name this one differently."]);
  expect(name).toHaveAttribute("aria-invalid", "true");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("Try again takes the last failure away while it saves", async () => {
  let tries = 0;
  let answer = () => {};
  salesServer([["POST", "products/", ({ body }) => {
    tries += 1;
    if (tries === 1) throw new AxiosError("Network Error", "ERR_NETWORK");
    return new Promise((ok) => { answer = () => ok({ id: 12, ...(body as object) }); });
  }]]);
  renderApp(<NewItemForm initialName="Silver idol" onDone={() => {}} />);
  await userEvent.type(screen.getByLabelText(/^HSN code/), "7114");
  await userEvent.selectOptions(screen.getByLabelText(/^GST rate/), "3");
  await userEvent.click(screen.getByRole("button", { name: "Save and use on this bill" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Not saved: the app couldn't get through");
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(screen.getByRole("button", { name: "Saving…" })).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  answer();
  expect(await screen.findByText("Silver idol added to Products")).toBeInTheDocument();
});

/** The desktop bill form's sheet for an item that isn't in Products, opened from a button. */
function ItemSheet() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Add an item</button>
      <Sheet open={open} onClose={() => setOpen(false)} title="An item that isn't in Products">
        {open ? <NewItemForm initialName="Silver idol" onCancel={() => setOpen(false)} onDone={() => setOpen(false)} /> : null}
      </Sheet>
    </>
  );
}

test("in a sheet the cursor starts in Name, and Back or Esc gives it back to what opened the sheet", async () => {
  // a clock the test moves: the sheet's own focus step, its guard against a double tap's second tap, and its way out
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  const pass = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });
  renderApp(<ItemSheet />);
  const opener = screen.getByRole("button", { name: "Add an item" });
  await user.click(opener);
  const sheet = await screen.findByRole("dialog", { name: "An item that isn't in Products" });
  await pass(400);
  expect(within(sheet).getByLabelText(/^Name/)).toHaveFocus();
  await user.click(within(sheet).getByRole("button", { name: "Back" }));
  await pass(400);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
  await user.click(opener);
  await screen.findByRole("dialog", { name: "An item that isn't in Products" });
  await pass(400);
  await user.keyboard("{Escape}");
  await pass(400);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(opener).toHaveFocus();
});
