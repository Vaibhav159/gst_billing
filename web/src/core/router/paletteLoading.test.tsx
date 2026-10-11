import { act, fireEvent, render, screen, within } from "@testing-library/react";
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
vi.mock("@/core/shell/PaletteRecords", () => missing.arrival);

test("a failed records chunk keeps Search's box and shows its own FailNote without changing the page", async () => {
  fakeToday();
  const reported = vi.spyOn(console, "error").mockImplementation(() => {});
  const qc = testQueryClient();
  try {
    salesServer();
    const router = createMemoryRouter(appRoutes, { initialEntries: ["/"] });
    render(<QueryClientProvider client={qc}><AuthContext.Provider value={stubAuth()}><ToastProvider><RouterProvider router={router} /></ToastProvider></AuthContext.Provider></QueryClientProvider>);
    const main = screen.getByRole("main");
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const box = screen.getByRole("combobox");
    fireEvent.change(box, { target: { value: "meena" } });
    await act(async () => missing.fail(new TypeError("Failed to fetch dynamically imported module")));
    const note = await screen.findByRole("alert", {}, { timeout: 5000 });
    const dialog = screen.getByRole("dialog", { name: "Search" });
    expect(dialog).toContainElement(note);
    expect(note).toHaveTextContent("Search couldn't load");
    expect(note).toHaveTextContent("Reload the page");
    expect(within(dialog).getByRole("combobox")).toHaveFocus();
    expect(box).toHaveValue("meena");
    expect(within(dialog).getByRole("button", { name: "Reload the page" })).toBeInTheDocument();
    expect(screen.queryByText("Something went wrong on this page")).not.toBeInTheDocument();
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("main")).toBe(main);
    expect(screen.getByRole("heading", { level: 1, name: "Dashboard" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/");
    fireEvent.keyDown(within(dialog).getByRole("combobox"), { key: "Escape" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Dashboard" })).toBeInTheDocument();
  } finally { reported.mockRestore(); vi.useRealTimers(); qc.clear(); }
});
