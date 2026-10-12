import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router";
import { AuthContext } from "@/core/auth/AuthProvider";
import { salesServer } from "@/core/sales/fixtures";
import { wireDashboard, wireDue } from "@/core/dashboard/fixtures";
import { wireRates } from "@/core/rates/testing";
import { ToastProvider } from "@/core/ui";
import { fakeToday } from "@/pages/sales/form/testing";
import { stubAuth, testQueryClient } from "@/test/render";
import { appRoutes } from "./routes";

const missing = vi.hoisted(() => {
  let fail!: (e: Error) => void;
  return { arrival: new Promise<never>((_resolve, reject) => { fail = reject; }), fail: (e: Error) => fail(e) };
});
vi.mock("@/core/shell/PaletteRecords", () => missing.arrival);
// This test fails Search's chunk; Today itself is loaded before its fake clock.
beforeAll(async () => { await import("@/pages/core/DashboardPage"); });

test.each(["meena", ""])("a failed records chunk keeps Search's box (%j) and gives truthful reload words, including after reopening", async (typed) => {
  fakeToday();
  const reported = vi.spyOn(console, "error").mockImplementation(() => {});
  const qc = testQueryClient();
  const router = createMemoryRouter(appRoutes, { initialEntries: ["/"] });
  let view: ReturnType<typeof render> | undefined;
  try {
    salesServer([["GET", "dashboard/", wireDashboard], ["GET", "due-next/", wireDue], ["GET", "rates/", () => wireRates()]]);
    view = render(<QueryClientProvider client={qc}><AuthContext.Provider value={stubAuth()}><ToastProvider><RouterProvider router={router} /></ToastProvider></AuthContext.Provider></QueryClientProvider>);
    await screen.findByRole("heading", { level: 1, name: "Today" });
    const main = screen.getByRole("main");
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const box = screen.getByRole("combobox");
    fireEvent.change(box, { target: { value: typed } });
    await act(async () => missing.fail(new TypeError("Failed to fetch dynamically imported module")));
    const note = await screen.findByRole("alert", {}, { timeout: 5000 });
    const dialog = screen.getByRole("dialog", { name: "Search" });
    expect(dialog).toContainElement(note);
    expect(note).toHaveTextContent("Search couldn't load");
    expect(note).toHaveTextContent("Reload the page");
    if (typed) expect(note).toHaveTextContent("What you typed is still in the box.");
    else expect(note).not.toHaveTextContent("What you typed is still in the box.");
    expect(within(dialog).getByRole("combobox")).toHaveFocus();
    expect(box).toHaveValue(typed);
    expect(within(dialog).queryByRole("button", { name: "Reload the page" })).not.toBeInTheDocument();
    expect(screen.queryByText("Something went wrong on this page")).not.toBeInTheDocument();
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("main")).toBe(main);
    expect(screen.getByRole("heading", { level: 1, name: "Today" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/");
    fireEvent.keyDown(within(dialog).getByRole("combobox"), { key: "Escape" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Today" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const reopened = screen.getByRole("dialog", { name: "Search" });
    expect(within(reopened).getByRole("combobox")).toHaveValue("");
    const reopenedNote = await within(reopened).findByRole("alert", {}, { timeout: 5000 });
    expect(reopenedNote).toHaveTextContent("Reload the page to search again.");
    expect(reopenedNote).not.toHaveTextContent("What you typed is still in the box.");
    expect(within(reopened).queryByRole("button", { name: "Reload the page" })).not.toBeInTheDocument();
  } finally { view?.unmount(); router.dispose(); qc.clear(); reported.mockRestore(); vi.useRealTimers(); }
});
