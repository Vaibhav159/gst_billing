import { pass } from "@/test/clock";
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { Route, Routes, useLocation } from "react-router";
import { salesServer, wireBin, wireDetail, wireFacets, wirePage, wireRow } from "@/core/sales/fixtures";
// Resolve the PDF stand-in before the fake clock; production loads the maker on the first send.
import "@/core/print/make";
import { ScopeProvider } from "@/core/scope";
import { renderApp } from "@/test/render";
import SalesList from "../SalesList";

vi.mock("@/core/print/make", async (real) => ({
  ...(await real<typeof import("@/core/print/make")>()),
  billFile: vi.fn(async () => ({ blob: new Blob(["%PDF-1.3"], { type: "application/pdf" }), name: "bill.pdf", sheets: 1 })),
}));

const ROWS = [413, 412, 411].map((id) => wireRow({ id, invoice_number: `KGH/2026-27/${id - 381}`, counter: id - 381 }));
const SENT = { at: "2026-10-08T12:31:00+05:30", last_at: "2026-10-08T12:31:00+05:30", count: 1, via: "whatsapp", to: "" };
function Where() { const l = useLocation(); return <p data-testid="where">{l.pathname + l.search}</p>; }
function mount(path = "/sales") {
  return renderApp(<ScopeProvider><Routes>
    <Route path="/sales" element={<main id="app-main"><SalesList /><Where /></main>} />
    <Route path="/sales/:id" element={<Where />} />
    <Route path="/sales/:id/print" element={<Where />} />
  </Routes></ScopeProvider>, { path });
}
function row(id: number) { return document.querySelector<HTMLElement>(`tr[data-row="${id}"]`)!; }
function server(initial = ROWS) {
  let rows = initial;
  let answerRefresh: (() => void) | null = null;
  const { calls } = salesServer([
    ["GET", "sales/", (c) => c.params.facets ? { ...wirePage([]), facets: wireFacets() }
      : answerRefresh ? new Promise((resolve) => { answerRefresh = () => { resolve(wirePage(rows)); answerRefresh = null; }; }) : wirePage(rows)],
    ["GET", /^sales\/\d+\/$/, (c) => wireDetail({ ...ROWS.find((b) => `sales/${b.id}/` === c.url) })],
    ["POST", /^sales\/\d+\/sent\/$/, (c) => {
      const id = Number(c.url.split("/")[1]); rows = rows.filter((b) => b.id !== id); return { id, sent: SENT };
    }],
    ["DELETE", /^sales\/\d+\/$/, (c) => {
      const id = Number(c.url.split("/")[1]); rows = rows.filter((b) => b.id !== id); answerRefresh = () => {};
      return wireBin({ original_id: id });
    }],
  ]);
  return { calls, release: () => answerRefresh?.() };
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ now: new Date("2026-10-08T12:30:00+05:30") });
  vi.spyOn(window, "open").mockReturnValue({} as Window);
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:pdf"), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); });

test.each([413, 411])("S in Not sent today keeps focus at the removed row's clamped position (%s)", async (id) => {
  const { calls } = server();
  mount("/sales?month=today&status=unsent");
  await pass(400);
  act(() => row(id).focus());
  fireEvent.keyDown(row(id), { key: "s" });
  await pass(0);
  expect(calls.filter((c) => c.url === `sales/${id}/sent/`)).toHaveLength(1);
  expect(row(id)).toBeNull();
  expect(row(412)).toHaveFocus();
  expect(row(412)).toHaveAttribute("tabindex", "0");
});

test("a row's menu Delete returns focus to the row at its position once the refreshed list arrives", async () => {
  const api = server();
  mount();
  await pass(400);
  const opener = within(row(412)).getByRole("button", { name: "Actions for KGH/2026-27/31" });
  act(() => opener.focus());
  fireEvent.click(opener);
  await pass(0);
  fireEvent.click(screen.getByRole("menuitem", { name: /^Delete/ }));
  await pass(0);
  await pass(400);
  const dialog = screen.getByRole("dialog", { name: "Delete bill KGH/2026-27/31?" });
  fireEvent.click(within(dialog).getByRole("button", { name: "Delete bill" }));
  await pass(200);
  expect(opener).toHaveFocus();
  await act(async () => api.release());
  await pass(0);
  expect(row(412)).toBeNull();
  expect(row(411)).toHaveFocus();
  expect(row(411)).toHaveAttribute("tabindex", "0");
}, 15_000); // the menu, dialog and list each render on the shared test worker

test("sending the last Not sent today bill returns focus to the page title", async () => {
  server([ROWS[0]]);
  mount("/sales?month=today&status=unsent");
  await pass(400);
  act(() => row(413).focus());
  fireEvent.keyDown(row(413), { key: "s" });
  await pass(0);
  expect(screen.getByRole("heading", { name: "Sales", level: 1 })).toHaveFocus();
});

test.each(["s", "S", "p", "P", " ", "Enter", "."])("a repeated %j never acts on a focused bill", async (key) => {
  const { calls } = server();
  mount();
  await pass(400);
  act(() => row(412).focus());
  fireEvent.keyDown(row(412), { key, repeat: true });
  await pass(0);
  expect(screen.getByTestId("where")).toHaveTextContent(/^\/sales$/);
  expect(screen.queryByRole("region", { name: "Selected bills" })).not.toBeInTheDocument();
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  expect(window.open).not.toHaveBeenCalled();
});

test("held down-arrow still moves between bills", async () => {
  server();
  mount();
  await pass(400);
  act(() => row(413).focus());
  fireEvent.keyDown(row(413), { key: "ArrowDown", repeat: true });
  await pass(20);
  expect(row(412)).toHaveFocus();
});

test.each([413, 411])("the preview Send in Not sent today returns focus to the removed bill's clamped row (%s)", async (id) => {
  const { calls } = server();
  mount(`/sales?month=today&status=unsent&bill=${id}`);
  await pass(400);
  const send = within(screen.getByRole("complementary")).getByRole("button", { name: "Send" });
  act(() => send.focus()); fireEvent.click(send); await pass(0);
  expect(calls.filter((c) => c.url === `sales/${id}/sent/`)).toHaveLength(1);
  expect(row(id)).toBeNull();
  expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  expect(row(412)).toHaveFocus();
  expect(row(412)).toHaveAttribute("tabindex", "0");
});

test("the preview Send on the last Not sent today bill returns focus to the page title", async () => {
  server([ROWS[0]]);
  mount("/sales?month=today&status=unsent&bill=413"); await pass(400);
  const send = within(screen.getByRole("complementary")).getByRole("button", { name: "Send" });
  act(() => send.focus()); fireEvent.click(send); await pass(0);
  expect(screen.queryByRole("complementary")).not.toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "Sales", level: 1 })).toHaveFocus();
});
