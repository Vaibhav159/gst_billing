import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router";
import { AuthContext } from "@/core/auth/AuthProvider";
import { dueNextKeys } from "@/core/due/keys";
import { ScopeProvider } from "@/core/scope";
import { handClock, pass } from "@/test/clock";
import { stubAuth, testQueryClient } from "@/test/render";
import { serve } from "@/test/server";
import { PhoneShell } from "./PhoneShell";

const badgeLoad = vi.hoisted(() => {
  let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; });
  return { wait, release: () => release() };
});
vi.mock("./TabBadges", async importOriginal => {
  await badgeLoad.wait;
  return importOriginal();
});

beforeEach(() => {
  handClock(new Date("2026-10-08T11:00:00+05:30"));
  localStorage.clear(); sessionStorage.clear();
  localStorage.setItem("gst3.scope.1", "3");
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

test("loading phone badges keeps the navigation and focused tab mounted", async () => {
  const qc = testQueryClient();
  qc.setQueryData(dueNextKeys.one(3), { today: "2026-10-08", returns: null, items: [{
    kind: "captures", count: 8, title: "8 captures to check", detail: "From your phone",
    due: null, firm: null, month: null, from: null, to: null, draft_id: null, badge: null,
  }] });
  const calls = serve({
    "GET preferences/": { data: {} },
    "GET firms/": { results: [{ id: 3, name: "KIRAN GOLD HOUSE" }] },
  });
  const router = createMemoryRouter([{ path: "*", element:
    <ScopeProvider><PhoneShell easy={false}><main>Today</main></PhoneShell></ScopeProvider>,
  }]);
  render(<QueryClientProvider client={qc}><AuthContext.Provider value={stubAuth()}>
    <RouterProvider router={router} />
  </AuthContext.Provider></QueryClientProvider>);
  await pass();
  const tabs = screen.getByRole("navigation", { name: "Tabs" });
  const capture = within(tabs).getByRole("link", { name: "Capture" });
  capture.focus();
  expect(capture).toHaveFocus();

  await act(async () => { badgeLoad.release(); await vi.dynamicImportSettled(); });
  await pass();
  expect(capture).toHaveFocus();
  expect(screen.getByRole("navigation", { name: "Tabs" })).toBe(tabs);
  expect(screen.getByRole("link", { name: "Capture, 8 waiting" })).toBe(capture);
  expect(calls.some(call => call.url === "due-next/")).toBe(false);
  fireEvent.click(capture);
  await pass();
  expect(router.state.location.pathname).toBe("/capture");
});
