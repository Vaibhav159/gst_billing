import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router";
import { AuthContext } from "@/core/auth/AuthProvider";
import { ScopeProvider, useScope } from "@/core/scope";
import { dueNextKeys, type DueItem, type DueNext } from "@/core/api/dashboard";
import { testQueryClient, stubAuth } from "@/test/render";
import { serve, type Answer } from "@/test/server";
import { handClock, pass } from "@/test/clock";
import { AttentionButton } from "./AttentionButton";

const item: DueItem = { kind: "unsent", due: null, count: 27, title: "27 of today's bills haven't been sent",
  detail: "31 · Anil Gupta", firm: null, month: null, draft_id: null, from: null, to: null, badge: null };
const answer: DueNext = { today: "2026-10-08", items: [item], returns: null };
function ScopeControls() {
  const scope = useScope();
  return <><button onClick={() => scope.setFirmId(4)}>Meera</button><button onClick={() => scope.setFy("2025-26")}>Past year</button></>;
}
function setup({ cached, rich = false, age = 0, reply = answer }: { cached?: DueNext; rich?: boolean; age?: number; reply?: Answer } = {}) {
  const qc = testQueryClient();
  if (cached) qc.setQueryData(dueNextKeys.one(3, rich), cached, { updatedAt: Date.now() - age });
  const calls = serve({ "GET preferences/": { data: {} }, "GET businesses/": { results: [
    { id: 3, name: "KIRAN GOLD HOUSE" }, { id: 4, name: "MEERA ORNAMENTS" },
  ] }, "GET due-next/": reply });
  const router = createMemoryRouter([{ path: "*", element: <ScopeProvider><AttentionButton /><ScopeControls /></ScopeProvider> }], { initialEntries: ["/sales"] });
  const view = render(<QueryClientProvider client={qc}><AuthContext.Provider value={stubAuth()}><RouterProvider router={router} /></AuthContext.Provider></QueryClientProvider>);
  return { ...view, qc, router, calls, reads: () => calls.filter(c => c.url === "due-next/") };
}
beforeEach(() => { handClock(new Date("2026-10-08T11:00:00+05:30")); localStorage.clear(); localStorage.setItem("gst3.scope.1", "3"); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

test("a cold closed bell never fetches and does not claim all clear before loading", async () => {
  const h = setup(); await pass();
  expect(screen.getByRole("button", { name: "Needs attention" })).toBeInTheDocument();
  expect(h.reads()).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Needs attention" })); await pass();
  expect(h.reads()).toHaveLength(1);
  expect(h.reads()[0].params).toEqual({ business_id: 3 });
  expect(screen.getByRole("button", { name: "Needs attention: 1" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /27 of today's bills/ })).toHaveAttribute("href", "/sales?when=today&status=unsent");
});
test.each([false, true])("fresh plain/rich cache opens without a second request (rich=%s)", async rich => {
  const h = setup({ cached: answer, rich, age: 59_000 }); await pass();
  fireEvent.click(screen.getByRole("button", { name: "Needs attention: 1" })); await pass();
  expect(h.reads()).toHaveLength(0);
  expect(screen.getByText("1 thing across KIRAN GOLD HOUSE")).toBeInTheDocument();
});
test("stale rich cache refreshes its own key only on opening", async () => {
  const h = setup({ cached: answer, rich: true, age: 60_001 }); await pass();
  expect(h.reads()).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Needs attention: 1" })); await pass();
  expect(h.reads()).toHaveLength(1);
  expect(h.reads()[0].params).toEqual({ business_id: 3, returns: 1 });
});
test("cached answer changes and clears reach the bell without a request", async () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const h = setup({ cached: answer }); await pass();
  act(() => h.qc.setQueryData(dueNextKeys.one(3, false), { ...answer, items: [] })); await pass();
  expect(screen.getByRole("button", { name: "Nothing needs attention" })).toBeInTheDocument();
  act(() => h.qc.removeQueries({ queryKey: ["due-next"] })); await pass();
  expect(screen.getByRole("button", { name: "Needs attention" })).toBeInTheDocument();
  expect(h.reads()).toHaveLength(0);
  expect(errors).not.toHaveBeenCalled();
});
test("FY has no effect; another firm's cached answer never leaks", async () => {
  const h = setup({ cached: answer }); await pass();
  fireEvent.click(screen.getByText("Past year")); await pass();
  expect(screen.getByRole("button", { name: "Needs attention: 1" })).toBeInTheDocument();
  fireEvent.click(screen.getByText("Meera")); await pass();
  expect(screen.getByRole("button", { name: "Needs attention" })).toBeInTheDocument();
  expect(h.reads()).toHaveLength(0);
});
test("only the open sheet refreshes after invalidation, and Escape restores bell focus", async () => {
  const h = setup({ cached: answer }); await pass();
  await act(() => h.qc.invalidateQueries({ queryKey: ["due-next"] })); await pass();
  expect(h.reads()).toHaveLength(0);
  const bell = screen.getByRole("button", { name: "Needs attention: 1" }); bell.focus(); fireEvent.click(bell); await pass(400);
  expect(h.reads()).toHaveLength(1);
  await act(() => h.qc.invalidateQueries({ queryKey: ["due-next"] })); await pass();
  expect(h.reads()).toHaveLength(2);
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" }); await pass(400);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); expect(bell).toHaveFocus();
  await act(() => h.qc.invalidateQueries({ queryKey: ["due-next"] })); await pass();
  expect(h.reads()).toHaveLength(2);
});
test("a failed first read offers retry, never All clear; a failed refresh retains rows", async () => {
  const h = setup({ reply: () => ({ status: 500, data: { detail: "Unavailable" } }) }); await pass();
  fireEvent.click(screen.getByRole("button", { name: "Needs attention" })); await pass();
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  expect(screen.queryByText("All clear")).not.toBeInTheDocument();
  act(() => h.qc.setQueryData(dueNextKeys.one(3, false), answer)); await pass();
  await act(() => h.qc.invalidateQueries({ queryKey: ["due-next"] })); await pass();
  expect(screen.getByRole("link", { name: /27 of today's bills/ })).toBeInTheDocument();
  expect(screen.getByText("Couldn't refresh today's figures")).toBeInTheDocument();
});
test("following a row closes the sheet and navigates; an empty answer uses the prototype words", async () => {
  const h = setup({ cached: answer }); await pass();
  fireEvent.click(screen.getByRole("button", { name: "Needs attention: 1" })); await pass(400);
  fireEvent.click(screen.getByRole("link", { name: /27 of today's bills/ })); await pass(400);
  expect(h.router.state.location.search).toBe("?when=today&status=unsent");
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  act(() => h.qc.setQueryData(dueNextKeys.one(3, false), { ...answer, items: [] })); await pass();
  fireEvent.click(screen.getByRole("button", { name: "Nothing needs attention" })); await pass();
  const dialog = screen.getByRole("dialog", { name: "Needs attention" });
  expect(within(dialog).getByText("All clear")).toBeInTheDocument();
  expect(within(dialog).getByText("New captured bills, filing problems and deadlines show up here.")).toBeInTheDocument();
});

test.each([false, true])("the last answer stays visible after ten closed minutes (rich=%s)", async rich => {
  const h = setup({ cached: answer, rich }); await pass();
  await pass(600_000);
  expect(screen.getByRole("button", { name: "Needs attention: 1" })).toBeInTheDocument();
  expect(h.reads()).toHaveLength(0);
});
