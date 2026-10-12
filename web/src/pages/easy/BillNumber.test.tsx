import { useState } from "react";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { __setNetState } from "@/core/api/network";
import { startNew, startPaper } from "@/pages/sales/form/model";
import { formServer, mountForm, TODAY, wireBook, wireNext } from "@/pages/sales/form/testing";
import { useBillForm } from "@/pages/sales/form/useBillForm";
import { tick } from "@/test/clock";
import { BillNumber } from "./BillNumber";

function Harness({ paper = false }: { paper?: boolean }) {
  const [start] = useState(() => paper
    ? startPaper({ firmId: 3, date: "", number: "", remembered: "", lastMonth: "2026-09" })
    : startNew({ firmId: 3, firmSource: "scope", today: TODAY }));
  const F = useBillForm(start, "number-proof");
  const [focus, setFocus] = useState<{ field: "number" | "date"; key: number }>();
  return <><BillNumber F={F} focus={focus} /><output data-testid="form-state">{JSON.stringify(F.f)}</output>
    <button onClick={() => setFocus((old) => ({ field: "number", key: (old?.key ?? 0) + 1 }))}>Focus refused number</button>
    <button onClick={() => setFocus((old) => ({ field: "date", key: (old?.key ?? 0) + 1 }))}>Focus refused date</button>
  </>;
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(new Date("2026-10-08T10:00:00+05:30"));
});
afterEach(() => { cleanup(); vi.useRealTimers(); act(() => __setNetState("online")); });

async function drawn(check: () => void) {
  for (let n = 0; n < 20; n++) {
    await tick(50);
    try { check(); return; } catch (error) { if (n === 19) throw error; }
  }
}
function mount(paper = false) { return mountForm("/number-proof", { routes: [{ path: "/number-proof", element: <Harness paper={paper} /> }] }); }
const state = () => JSON.parse(screen.getByTestId("form-state").textContent ?? "{}");
async function open() {
  await drawn(() => expect(screen.getByText("No. 34 · the number on the paper bill")).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: /Bill number.*Change/ }));
  await tick(400);
  return screen.getByRole("dialog", { name: "Bill number" });
}

test("the paper-day choice keeps date and paper together, then returns to today's next number", async () => {
  const { calls } = formServer(); mount(); const dialog = await open();
  expect(within(dialog).queryByLabelText(/Date on the paper bill/)).not.toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("switch", { name: "A bill from an earlier day" }));
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Date on the paper bill" }), { target: { value: "30/9/2026" } });
  expect(state()).toMatchObject({ date: "2026-09-30", paper: true, number: "", numberTyped: false });
  await tick(400);
  expect(calls.some((c) => c.url === "sales/next-number/" && c.params.invoice_date === "2026-09-30")).toBe(true);
  expect(calls.some((c) => c.url === "sales/paper-book/" && c.params.month === "2026-09")).toBe(true);
  fireEvent.click(within(dialog).getByRole("switch", { name: "A bill from an earlier day" }));
  expect(state()).toMatchObject({ date: TODAY, paper: false, number: "", numberTyped: false });
  expect(within(dialog).queryByRole("textbox", { name: "Date on the paper bill" })).not.toBeInTheDocument();
});

test("changing the date drops a number typed for the old day, and typing today clears paper", async () => {
  const { calls } = formServer(); mount(); const dialog = await open();
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Bill number" }), { target: { value: "40" } });
  expect(state()).toMatchObject({ number: "40", numberTyped: true });
  fireEvent.click(within(dialog).getByRole("switch", { name: "A bill from an earlier day" }));
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Date on the paper bill" }), { target: { value: "30/9/2026" } });
  expect(state()).toMatchObject({ date: "2026-09-30", paper: true, number: "", numberTyped: false });
  await tick(400);
  expect(calls.some((c) => c.url === "sales/check-number/" && c.params.invoice_date === "2026-09-30" && c.params.invoice_number === "40")).toBe(false);
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Date on the paper bill" }), { target: { value: "8/10/2026" } });
  expect(state()).toMatchObject({ date: TODAY, paper: false, number: "", numberTyped: false });
});

test("a number refusal marks the card and keeps the server's words available", async () => {
  formServer(); mount(); const dialog = await open();
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Bill number" }), { target: { value: "31" } });
  await drawn(() => expect(within(dialog).getByRole("textbox", { name: "Bill number" })).toHaveAttribute("aria-invalid", "true"));
  fireEvent.click(within(dialog).getByRole("button", { name: "Done" })); await tick(250);
  const card = screen.getByRole("button", { name: /Bill number.*Change/ });
  expect(card).toHaveClass("border-neg-line");
  expect(card).toHaveAttribute("aria-describedby", "easy-bill-number-error");
  expect(screen.getByText(/KGH\/2026-27\/31 is already used/)).toBeInTheDocument();
});

test("a chosen prior financial year drives the next-number request", async () => {
  const { calls } = formServer([["GET", "sales/next-number/", ({ params }) => ({ ...wireNext(3, String(params.invoice_date)), fy: String(params.invoice_date) < "2026-04-01" ? "2025-26" : "2026-27" })]]);
  mount(); const dialog = await open();
  fireEvent.click(within(dialog).getByRole("switch", { name: "A bill from an earlier day" }));
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Date on the paper bill" }), { target: { value: "31/3/2026" } });
  expect(state()).toMatchObject({ date: "2026-03-31", paper: true });
  await tick(400);
  expect(calls.some((c) => c.url === "sales/next-number/" && c.params.invoice_date === "2026-03-31")).toBe(true);
  expect(calls.some((c) => c.url === "sales/paper-book/" && c.params.month === "2026-03")).toBe(true);
});

test("a delayed paper-book answer never replaces the date typed in Easy", async () => {
  let answer: (book: ReturnType<typeof wireBook>) => void = () => {};
  const waiting = new Promise<ReturnType<typeof wireBook>>((resolve) => { answer = resolve; });
  const { calls } = formServer([["GET", "sales/paper-book/", () => waiting]]);
  mount(true);
  await drawn(() => expect(calls.some((c) => c.url === "sales/paper-book/")).toBe(true));
  fireEvent.click(screen.getByRole("button", { name: /Bill number.*Change/ })); await tick(400);
  const dialog = screen.getByRole("dialog", { name: "Bill number" });
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Date on the paper bill" }), { target: { value: "30/9/2026" } });
  expect(state()).toMatchObject({ date: "2026-09-30", paper: true });
  await act(async () => { answer(wireBook()); }); await tick(400);
  expect(state()).toMatchObject({ date: "2026-09-30", paper: true });
});

test("external refusal focus opens the number field again for each request", async () => {
  formServer(); mount();
  await drawn(() => expect(screen.getByText("No. 34 · the number on the paper bill")).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "Focus refused number" })); await tick(50);
  let dialog=screen.getByRole("dialog", { name: "Bill number" });
  expect(within(dialog).getByRole("textbox", { name: "Bill number" })).toHaveFocus();
  await tick(400); fireEvent.click(within(dialog).getByRole("button", { name: "Done" })); await tick(250);
  expect(screen.queryByRole("dialog", { name: "Bill number" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Focus refused number" })); await tick(50);
  dialog=screen.getByRole("dialog", { name: "Bill number" });
  expect(within(dialog).getByRole("textbox", { name: "Bill number" })).toHaveFocus();
  expect(state()).toMatchObject({ date: TODAY, paper: false });
});

test("external date focus reveals the date without changing it and preserves a later chosen day", async () => {
  formServer(); mount();
  await drawn(() => expect(screen.getByText("No. 34 · the number on the paper bill")).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "Focus refused date" })); await tick(50);
  const dialog=screen.getByRole("dialog", { name: "Bill number" });
  expect(within(dialog).getByRole("textbox", { name: "Date on the paper bill" })).toHaveFocus();
  expect(state()).toMatchObject({ date: TODAY, paper: false });
  await tick(400);
  fireEvent.change(within(dialog).getByRole("textbox", { name: "Date on the paper bill" }), { target: { value: "30/9/2026" } });
  fireEvent.click(within(dialog).getByRole("button", { name: "Done" })); await tick(250);
  fireEvent.click(screen.getByRole("button", { name: "Focus refused date" })); await tick(50);
  expect(within(screen.getByRole("dialog", { name: "Bill number" })).getByRole("textbox", { name: "Date on the paper bill" })).toHaveFocus();
  expect(state()).toMatchObject({ date: "2026-09-30", paper: true });
});
