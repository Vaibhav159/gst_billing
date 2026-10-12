import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { AuthContext } from "@/core/auth/AuthProvider";
import { dueNextKeys, type DueData } from "@/core/api/dashboard";
import { ToastProvider } from "@/core/ui";
import { salesServer, wirePage } from "@/core/sales/fixtures";
import { stubAuth, testQueryClient } from "@/test/render";
import Home from "./Home";
const choice = vi.hoisted(() => ({ firmId: 3 as number | null, loading: false, error: false }));
vi.mock("./state", async (importOriginal) => ({
  ...await importOriginal<typeof import("./state")>(),
  useEasyFirm: () => ({ loading: choice.loading, error: choice.error, firmId: choice.firmId, firm: choice.firmId === null ? null : { id: choice.firmId, name: `Firm ${choice.firmId}` } }),
  useWelcome: () => ({ seen: true, done: vi.fn(), reset: vi.fn() }),
}));
// The rates component owns its network/render tests in 5C. This verifies the required placement/variant only.
vi.mock("@/core/rates/RatesCard", () => ({ RatesCard: ({ variant }: { variant: string }) => <section aria-label={`Rates ${variant}`} /> }));
const answer: DueData = { today: "2026-10-08", items: [{ kind: "unsent", count: 121, due: null, title: "121 of today's bills haven't been sent", detail: "", firm: 3, month: null, draft_id: null, from: null, to: null, badge: null }], returns: null };
beforeEach(() => { choice.firmId = 3; choice.loading = false; choice.error = false; vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-08T18:01:00+05:30")); });
afterEach(() => { cleanup(); vi.useRealTimers(); });
function setup(age?: number, rich = false) {
  const qc = testQueryClient();
  if (age !== undefined) qc.setQueryData(dueNextKeys.one(3, rich), answer, { updatedAt: Date.now() - age });
  const s = salesServer([["GET", "sales/", () => wirePage([])], ["GET", "drafts/", () => ({ count: 0, results: [] })], ["GET", "due-next/", () => answer],
    ["GET", "gst/month/", () => ({ business: choice.firmId, month: "2026-09", stage: "ready", due: { gstr1: "2026-10-11", gstr3b: "2026-10-20" }, record: {}, checks: { blockers: [] } })]]);
  const ui = () => <QueryClientProvider client={qc}><AuthContext.Provider value={stubAuth()}><MemoryRouter initialEntries={["/e"]}><ToastProvider><Home /></ToastProvider></MemoryRouter></AuthContext.Provider></QueryClientProvider>;
  const view = render(ui());
  return { ...view, qc, calls: s.calls, again: () => view.rerender(ui()) };
}
test("an Easy-only cold opening fills the shared scoped badge cache exactly once", async () => {
  const h = setup(); await screen.findByText("121 not sent");
  expect(h.calls.filter((c) => c.url === "due-next/")).toEqual([expect.objectContaining({ params: { business_id: 3 } })]);
  expect(h.qc.getQueryData(dueNextKeys.one(3, false))).toMatchObject(answer);
  expect(h.calls.filter((c) => c.url === "drafts/")).toEqual([expect.objectContaining({ params: { business_id: 3 } })]);
  expect(screen.getByRole("region", { name: "Rates easy" })).toBeInTheDocument();
});
test("Home places the real GST card after rates and uses a scoped monthly summary", async () => {
  const h = setup();
  const card = await screen.findByRole("link", { name: /GST on October's sales so far/ });
  expect(card).toHaveAttribute("href", "/e/gst");
  expect(screen.getByRole("region", { name: "Rates easy" }).compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(h.calls.filter(c => c.url === "gst/month/")).toEqual([expect.objectContaining({ params: { business_id: 3, month: "2026-09" } })]);
  expect(h.calls.find(c => c.url === "sales/" && c.params.month)?.params).toMatchObject({ business_id: 3, month: "2026-10", page_size: 1 });
});
test.each([false, true])("a fresh scoped cached answer is reused, including rich=%s", async (rich) => {
  const h = setup(59_999, rich); await screen.findByText("121 not sent");
  expect(h.calls.filter((c) => c.url === "due-next/")).toHaveLength(0);
});
test("an answer over 60 seconds old refreshes on opening", async () => {
  const h = setup(60_001); await waitFor(() => expect(h.calls.filter((c) => c.url === "due-next/")).toHaveLength(1));
});
test("another firm cannot borrow the previous firm's count", async () => {
  const h = setup(); await screen.findByText("121 not sent");
  choice.firmId = 4; h.again();
  await waitFor(() => expect(h.calls.filter((c) => c.url === "due-next/").at(-1)?.params).toEqual({ business_id: 4 }));
});
test("there is no unscoped request while the firm is unknown", async () => {
  choice.firmId = null; const h = setup(); await act(async () => {});
  expect(h.calls.filter((c) => ["sales/", "drafts/", "due-next/"].includes(c.url))).toEqual([]);
});
test("a minute idle and focus do not read the database", async () => {
  const h = setup(); await screen.findByText("121 not sent");
  const before = h.calls.length;
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  await act(async () => vi.advanceTimersByTimeAsync(60_001)); fireEvent(window, new Event("focus"));
  expect(h.calls).toHaveLength(before);
});

test.each(["loading", "error"] as const)("a firm %s leaves a visible way to More without an unscoped read", async (state) => {
  choice.firmId = null; choice[state] = true;
  const h = setup(); await act(async () => {});
  expect(screen.getByRole("link", { name: "Go to More" })).toHaveAttribute("href", "/e/more");
  expect(screen.queryByRole("heading", { name: "Sales today" })).not.toBeInTheDocument();
  expect(h.calls.filter((c) => ["sales/", "drafts/", "due-next/"].includes(c.url))).toEqual([]);
});
