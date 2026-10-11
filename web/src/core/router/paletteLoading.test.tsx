import { act, fireEvent, render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router";
import { AuthContext } from "@/core/auth/AuthProvider";
import { salesServer } from "@/core/sales/fixtures";
import { ToastProvider } from "@/core/ui";
import { fakeToday } from "@/pages/sales/form/testing";
import { stubAuth, testQueryClient } from "@/test/render";
import { appRoutes } from "./routes";

const missing = vi.hoisted(() => {
  let fail!: (e: Error) => void;
  return { arrival: new Promise<never>((_resolve, reject) => { fail = reject; }), fail: (e: Error) => fail(e) };
});
vi.mock("@/core/shell/Palette", () => missing.arrival);

test("Search code that cannot load keeps the page and shell, and can recover to home", async () => {
  fakeToday();
  vi.stubGlobal("requestIdleCallback", vi.fn()); // the first press, before idle could fetch Search
  const reported = vi.spyOn(console, "error").mockImplementation(() => {});
  const qc = testQueryClient();
  try {
    salesServer();
    const router = createMemoryRouter(appRoutes, { initialEntries: ["/"] });
    render(<QueryClientProvider client={qc}><AuthContext.Provider value={stubAuth()}><ToastProvider><RouterProvider router={router} /></ToastProvider></AuthContext.Provider></QueryClientProvider>);
    const main = screen.getByRole("main");
    fireEvent.click(screen.getByRole("button", { name: "Search (Ctrl K)" }));
    expect(screen.getByRole("heading", { level: 1, name: "Dashboard" })).toBeInTheDocument();
    await act(async () => missing.fail(new TypeError("Failed to fetch dynamically imported module")));
    expect(await screen.findByRole("button", { name: "Reload the app" }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("main")).toBe(main);
    expect(screen.getByRole("heading", { level: 1, name: "Dashboard" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Go to the home page" }));
    expect(screen.queryByRole("button", { name: "Reload the app" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Dashboard" })).toBeInTheDocument();
  } finally { reported.mockRestore(); vi.unstubAllGlobals(); vi.useRealTimers(); qc.clear(); }
});
