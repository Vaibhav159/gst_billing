import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router";
import { AuthContext } from "@/core/auth/AuthProvider";
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
vi.mock("./TabBadges", async () => {
  await badgeLoad.wait;
  throw new Error("The badge chunk could not load");
});

beforeEach(() => {
  handClock(new Date("2026-10-08T11:00:00+05:30"));
  localStorage.clear(); sessionStorage.clear();
  localStorage.setItem("gst3.scope.1", "3");
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

test("a rejected badge chunk preserves the Easy page, tabs and keyboard focus", async () => {
  const errors = vi.spyOn(console, "error").mockImplementation(() => {});
  const calls = serve({
    "GET preferences/": { data: {} },
    "GET businesses/": { results: [{ id: 3, name: "KIRAN GOLD HOUSE" }] },
  });
  const router = createMemoryRouter([{ path: "*", element:
    <ScopeProvider><PhoneShell easy><main><input aria-label="Bill note" /></main></PhoneShell></ScopeProvider>,
  }], { initialEntries: ["/e"] });
  render(<QueryClientProvider client={testQueryClient()}><AuthContext.Provider value={stubAuth()}>
    <RouterProvider router={router} />
  </AuthContext.Provider></QueryClientProvider>);
  await pass();
  const note = screen.getByRole("textbox", { name: "Bill note" });
  fireEvent.change(note, { target: { value: "Keep this unsaved note" } });
  const tabs = screen.getByRole("navigation", { name: "Tabs" });
  const capture = within(tabs).getByRole("link", { name: "Capture" });
  capture.focus();

  await act(async () => { badgeLoad.release(); await vi.dynamicImportSettled(); });
  await pass();
  expect(capture).toHaveFocus();
  expect(screen.getByRole("navigation", { name: "Tabs" })).toBe(tabs);
  expect(screen.getByRole("link", { name: "Capture" })).toBe(capture);
  expect(screen.getByRole("textbox", { name: "Bill note" })).toBe(note);
  expect(note).toHaveValue("Keep this unsaved note");
  expect(calls.some(call => call.url === "due-next/")).toBe(false);
  expect(errors).toHaveBeenCalled();
  fireEvent.click(capture);
  await pass();
  expect(router.state.location.pathname).toBe("/e/capture");
});
