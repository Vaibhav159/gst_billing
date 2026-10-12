// How much of the table redraws as the preview moves. Each row draws its Send cell, so a stand-in Send cell counts the
// rows drawn, by bill.
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router";
import { salesServer, wireDetail, wireFacets, wirePage, wireRow, type Call } from "@/core/sales/fixtures";
import { ScopeProvider } from "@/core/scope";
import { renderApp } from "@/test/render";
import SalesList from "../SalesList";

const { drawn } = vi.hoisted(() => ({ drawn: new Map<number, number>() }));
vi.mock("../actions/SendCell", () => ({
  SendCell: ({ bill }: { bill: { id: number } }) => { drawn.set(bill.id, (drawn.get(bill.id) ?? 0) + 1); return null; },
}));

const ROWS = [wireRow({ id: 413, invoice_number: "KGH/2026-27/32", counter: 32 }), wireRow(), wireRow({ id: 405, invoice_number: "KGH/2026-27/30", counter: 30, invoice_date: "2026-10-07" })];
const isFacets = (c: Call) => c.params.facets === 1 && c.params.page_size === 1;

beforeEach(() => { localStorage.clear(); vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true }); vi.setSystemTime(new Date("2026-10-08T12:30:00+05:30")); });
afterEach(() => { vi.useRealTimers(); });

test("moving the preview from one bill to the next redraws those two rows, not the whole table", async () => {
  salesServer([
    ["GET", "sales/", (c) => (isFacets(c) ? { ...wirePage([]), facets: wireFacets() } : wirePage(ROWS))],
    ["GET", /^sales\/\d+\/$/, (c) => wireDetail({ ...ROWS.find((r) => `sales/${r.id}/` === c.url) })],
  ]);
  renderApp(<ScopeProvider><Routes><Route path="/sales" element={<SalesList />} /></Routes></ScopeProvider>, { path: "/sales?bill=413" });
  await screen.findByRole("complementary", { name: "Preview of bill KGH/2026-27/32" });
  const first = await waitFor(() => { const r = document.querySelector<HTMLElement>('tr[data-row="413"]'); expect(r).not.toBeNull(); return r!; });
  act(() => first.focus());
  await waitFor(() => expect(first).toHaveFocus());
  drawn.clear();
  await userEvent.keyboard("{ArrowDown}");
  await screen.findByRole("complementary", { name: "Preview of bill KGH/2026-27/31" });
  await waitFor(() => expect(document.querySelector('tr[data-row="412"]')).toHaveFocus());
  expect(drawn.get(412)).toBeGreaterThan(0);
  // the third bill isn't the one left or the one reached: its row stays as it was drawn
  expect(drawn.get(405) ?? 0).toBe(0);
});
