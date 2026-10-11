import { useState } from "react";
import { act, fireEvent, screen } from "@testing-library/react";
import { Route, Routes } from "react-router";
import { salesServer, wireDetail, wireFacets, wirePage, wireRow, type Call } from "@/core/sales/fixtures";
import { ScopeProvider } from "@/core/scope";
import { renderApp } from "@/test/render";
import SalesList from "../SalesList";
// Resolve the PDF stand-in before the fake clock; production loads the maker on the first send (1E Task 1b).
import "@/core/print/make";

vi.mock("@/core/print/make", async (real) => ({
  ...(await real<typeof import("@/core/print/make")>()),
  billFile: vi.fn(async () => ({ blob: new Blob(["%PDF-1.3"], { type: "application/pdf" }), name: "bill.pdf", sheets: 1 })),
}));
beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now: new Date("2026-10-08T12:30:00+05:30") });
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:pdf"), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  vi.spyOn(window, "open").mockImplementation(() => ({}) as Window);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
async function pass(ms = 0) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  for (let n = 0; n < 6; n++) await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}
const asks = (calls: Call[]) => calls.filter((c) => c.url.startsWith("sales/"));
function setup(path = "/sales") {
  const { calls } = salesServer([
    ["GET", "sales/", ({ params }) => ({ ...wirePage(params.q === "missing" ? [] : [wireRow()]), ...(params.facets ? { facets: wireFacets({ elsewhere: [{ fy: "2025-26", bills: 2 }] }) } : {}) })],
    ["GET", "sales/412/", () => wireDetail()],
    ["POST", "sales/412/sent/", () => ({ id: 412, sent: { at: "2026-10-08T12:31:00+05:30", last_at: "2026-10-08T12:31:00+05:30", count: 1, via: "whatsapp", to: "" } })],
  ]);
  function Visit() {
    const [here, setHere] = useState(true);
    return <><button onClick={() => setHere(!here)}>Toggle list</button>{here && <SalesList />}</>;
  }
  renderApp(<ScopeProvider><Routes><Route path="/sales" element={<Visit />} /></Routes></ScopeProvider>, { path });
  return calls;
}

test("request budget: opening, matched and empty searches, and returning after one minute", async () => {
  const calls = setup();
  await pass();
  const opening = asks(calls).length;
  let before = asks(calls).length;
  fireEvent.change(screen.getByRole("searchbox", { name: /Search sales bills/ }), { target: { value: "anil" } });
  await pass(300);
  const matched = asks(calls).slice(before);
  before = asks(calls).length;
  fireEvent.change(screen.getByRole("searchbox", { name: /Search sales bills/ }), { target: { value: "missing" } });
  await pass(300);
  const empty = asks(calls).slice(before);
  fireEvent.change(screen.getByRole("searchbox", { name: /Search sales bills/ }), { target: { value: "" } });
  await pass(300);
  fireEvent.click(screen.getByRole("button", { name: "Toggle list" }));
  await pass(60_000);
  before = asks(calls).length;
  fireEvent.click(screen.getByRole("button", { name: "Toggle list" }));
  await pass();
  const returning = asks(calls).slice(before);
  expect({ opening, matched: matched.length, matchedFacets: matched[0]?.params.facets, empty: empty.length, emptyFacets: empty.map((c) => c.params.facets), returning: returning.length })
    .toEqual({ opening: 2, matched: 1, matchedFacets: undefined, empty: 2, emptyFacets: [undefined, "elsewhere"], returning: 1 });
}, 20_000);

test("request budget: one Send from a row with its preview open and an older cached bill", async () => {
  const calls = setup("/sales?bill=412");
  await pass(200);
  await pass(31_000);
  const before = asks(calls).length;
  const row = document.querySelector<HTMLElement>('tr[data-row="412"]')!;
  act(() => row.focus());
  fireEvent.keyDown(row, { key: "s" });
  await pass();
  expect(asks(calls).slice(before).map((c) => [c.method, c.url, c.params.facets])).toEqual([
    ["GET", "sales/412/", undefined], ["POST", "sales/412/sent/", undefined],
    ["GET", "sales/412/", undefined], ["GET", "sales/", undefined], ["GET", "sales/", 1],
  ]);
});

test("an all-years empty search never asks elsewhere", async () => {
  const calls = setup("/sales?month=years&q=missing");
  await pass();
  expect(asks(calls).filter((c) => c.params.q).map((c) => c.params.facets)).toEqual([undefined]);
});
