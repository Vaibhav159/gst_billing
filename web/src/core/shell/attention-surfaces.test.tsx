import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router";
import { AuthContext } from "@/core/auth/AuthProvider";
import { ScopeProvider } from "@/core/scope";
import { dueNextKeys, type DueItem, type DueNext } from "@/core/api/dashboard";
import { testQueryClient, stubAuth } from "@/test/render";
import { serve } from "@/test/server";
import { handClock, pass } from "@/test/clock";
import { PhoneShell } from "./PhoneShell";
import { AttentionPalette } from "./AttentionPalette";
import { paletteCode } from "./Palette";

const item = (kind: DueItem["kind"], count: number, extra: Partial<DueItem> = {}): DueItem => ({
  kind, count, title: `${kind} from server`, detail: `${kind} detail`, due: null, firm: null, month: null,
  from: null, to: null, draft_id: null, badge: null, ...extra,
});
const answer: DueNext = { today: "2026-10-08", returns: null, items: [
  item("blocker", 12, { badge: "home_dot", firm: 3, month: "2026-09", due: "2026-10-11" }),
  item("captures", 8), item("unsent", 121), item("review", 6),
] };
function setup(easy: boolean, palette = false, data: DueNext | undefined = answer) {
  const qc = testQueryClient();
  if (data) qc.setQueryData(dueNextKeys.one(3, true), data);
  const calls = serve({ "GET preferences/": { data: {} }, "GET businesses/": { results: [{ id: 3, name: "KIRAN GOLD HOUSE" }] },
    "GET sales/": { count: 0, results: [] } });
  const close = vi.fn();
  const router = createMemoryRouter([{ path: "*", element: <ScopeProvider>{palette ? <AttentionPalette open onClose={close} /> : <PhoneShell easy={easy}><main>Today</main></PhoneShell>}</ScopeProvider> }]);
  render(<QueryClientProvider client={qc}><AuthContext.Provider value={stubAuth()}><RouterProvider router={router} /></AuthContext.Provider></QueryClientProvider>);
  return { qc, calls, close, router };
}
beforeAll(async () => { await paletteCode.load(); });
beforeEach(() => { handClock(new Date("2026-10-08T11:00:00+05:30")); localStorage.clear(); sessionStorage.clear(); localStorage.setItem("gst3.scope.1", "3"); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

test.each([false, true])("Expert/Easy tabs use server counts, never loaded-bill counts (easy=%s)", async easy => {
  const h = setup(easy); await pass();
  const tabs = screen.getByRole("navigation", { name: "Tabs" });
  expect(within(tabs).getByRole("link", { name: "Capture, 8 waiting" })).toBeInTheDocument();
  expect(within(tabs).getByRole("link", { name: "Bills, 121 not sent" })).toBeInTheDocument();
  expect(within(tabs).getByRole("link", { name: "Home, a return due soon is blocked" })).toBeInTheDocument();
  expect(h.calls.some(c => c.url === "due-next/")).toBe(false);
  act(() => h.qc.setQueryData(dueNextKeys.one(3, true), { ...answer, items: [] })); await pass();
  expect(within(tabs).getByRole("link", { name: "Capture" })).toBeInTheDocument();
  expect(within(tabs).getByRole("link", { name: "Bills" })).toBeInTheDocument();
  expect(within(tabs).getByRole("link", { name: "Home" })).toBeInTheDocument();
});
test("zero counts and a blocker without home_dot keep the tabs quiet", async () => {
  const h = setup(false, false, { ...answer, items: [item("captures", 0), item("unsent", 0), item("blocker", 12)] }); await pass();
  expect(screen.getByRole("link", { name: "Home" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Bills" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Capture" })).toBeInTheDocument();
  await act(() => h.qc.invalidateQueries({ queryKey: ["due-next"] })); await pass();
  expect(h.calls.some(c => c.url === "due-next/")).toBe(false);
});
test("empty search gets the first three server items and keyboard navigation uses their shared links", async () => {
  const h = setup(false, true); await pass(400);
  expect(screen.getByText("Needs attention")).toBeInTheDocument();
  const options = screen.getAllByRole("option");
  expect(options.slice(0, 3).map(o => o.textContent)).toEqual(expect.arrayContaining([
    expect.stringContaining("blocker from server"), expect.stringContaining("captures from server"), expect.stringContaining("unsent from server"),
  ]));
  expect(screen.queryByRole("option", { name: /review from server/ })).not.toBeInTheDocument();
  const box = screen.getByRole("combobox");
  fireEvent.keyDown(box, { key: "Home" }); fireEvent.keyDown(box, { key: "Enter" }); await pass();
  expect(h.close).toHaveBeenCalled(); expect(h.router.state.location.pathname + h.router.state.location.search).toBe("/gst?firm=3&month=2026-09&fix=1");
  expect(h.calls.some(c => c.url === "due-next/")).toBe(false);
});
test("Needs attention hides as text is typed and updates from cache when cleared", async () => {
  const h = setup(false, true); await pass(400);
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "x" } }); await pass();
  expect(screen.queryByText("Needs attention")).not.toBeInTheDocument();
  act(() => h.qc.setQueryData(dueNextKeys.one(3, true), { ...answer, items: [item("drafts", 1, { draft_id: "kept-id" })] })); await pass();
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "" } }); await pass();
  expect(screen.getByRole("option", { name: /drafts from server/ })).toBeInTheDocument();
  expect(h.calls.some(c => c.url === "due-next/")).toBe(false);
});
