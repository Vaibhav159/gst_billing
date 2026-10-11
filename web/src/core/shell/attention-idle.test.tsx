import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router";
import { useState } from "react";
import { dueNextKeys, useDueNext, type DueNext } from "@/core/api/dashboard";
import { AuthContext } from "@/core/auth/AuthProvider";
import { ScopeProvider, useScope } from "@/core/scope";
import { testQueryClient, stubAuth } from "@/test/render";
import { serve } from "@/test/server";
import { pass } from "@/test/clock";
import { AttentionButton, attentionCode } from "./AttentionButton";
import { AttentionPalette } from "./AttentionPalette";
import { badgeCode, PhoneShell } from "./PhoneShell";
import { paletteCode } from "./Palette";

const empty: DueNext = { today: "2026-10-08", items: [], returns: null };
function VisibleDue() {
  const { firmId } = useScope();
  const q = useDueNext(firmId, true);
  return <p>{q.data ? "Due ready" : "Loading due"}</p>;
}
function Surface({ showing }: { showing: "bell" | "palette" | "phone" | "dashboard" }) {
  const [reader, setReader] = useState(showing === "dashboard");
  return <>{showing === "bell" ? <AttentionButton /> : showing === "palette" ? <AttentionPalette open onClose={() => {}} /> : <PhoneShell easy={false}><main>Today</main></PhoneShell>}
    <button onClick={() => setReader(x => !x)}>Toggle reader</button>{reader ? <VisibleDue /> : null}</>;
}
function setup(showing: "bell" | "palette" | "phone" | "dashboard", cached = true) {
  const qc = testQueryClient();
  if (cached) qc.setQueryData(dueNextKeys.one(3, true), empty);
  const calls = serve({ "GET preferences/": { data: {} }, "GET businesses/": { results: [{ id: 3, name: "KIRAN" }] },
    "GET sales/": { count: 0, results: [] }, "GET due-next/": empty });
  const router = createMemoryRouter([{ path: "*", element: <ScopeProvider><Surface showing={showing} /></ScopeProvider> }]);
  render(<QueryClientProvider client={qc}><AuthContext.Provider value={stubAuth()}><RouterProvider router={router} /></AuthContext.Provider></QueryClientProvider>);
  return { qc, calls };
}
beforeAll(async () => { await Promise.all([paletteCode.load(), attentionCode.load(), badgeCode.load()]); });
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"], now: new Date("2026-10-08T11:00:00+05:30") }); localStorage.clear(); localStorage.setItem("gst3.scope.1", "3"); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

test.each(["bell", "palette", "phone", "dashboard"] as const)("ten minutes idle and window focus make no request: %s", async showing => {
  const h = setup(showing); await pass(400);
  const initial = h.calls.length;
  await pass(600_000);
  fireEvent.focus(window); fireEvent(window, new Event("visibilitychange")); await pass();
  expect(h.calls).toHaveLength(initial);
});
test("an open bell is also idle; remounting the visible reader after ten minutes asks once", async () => {
  const h = setup("bell"); await pass();
  fireEvent.click(screen.getByRole("button", { name: "Nothing needs attention" })); await pass(400);
  const initial = h.calls.length;
  await pass(600_000); fireEvent.focus(window); await pass();
  expect(h.calls).toHaveLength(initial);
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" }); await pass(400);
  fireEvent.click(screen.getByRole("button", { name: "Toggle reader" })); await pass();
  expect(h.calls.filter(c => c.url === "due-next/")).toHaveLength(1);
  expect(screen.getByText("Due ready")).toBeInTheDocument();
});
test("a newer plain response wins over older rich data; cache removal clears every passive view", async () => {
  const h = setup("phone"); await pass();
  await pass(1);
  act(() => h.qc.setQueryData(dueNextKeys.one(3, false), { ...empty, items: [
    { kind: "unsent", count: 6, title: "6 of today's bills haven't been sent", detail: "", due: null, firm: null, month: null, draft_id: null, from: null, to: null, badge: null },
  ] })); await pass();
  expect(screen.getByRole("link", { name: "Bills, 6 not sent" })).toBeInTheDocument();
  act(() => h.qc.removeQueries({ queryKey: ["due-next"] })); await pass();
  expect(screen.getByRole("link", { name: "Bills" })).toBeInTheDocument();
  expect(h.calls.some(c => c.url === "due-next/")).toBe(false);
});
