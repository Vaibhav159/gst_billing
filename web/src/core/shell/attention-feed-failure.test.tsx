import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router";
import { AuthContext } from "@/core/auth/AuthProvider";
import { salesServer } from "@/core/sales/fixtures";
import { ToastProvider } from "@/core/ui";
import { handClock, pass } from "@/test/clock";
import { stubAuth, testQueryClient } from "@/test/render";
import { AppLayout, RootLayout } from "./AppLayout";

const missing = vi.hoisted(() => {
  let fail!: (error: Error) => void;
  return { arrival: new Promise<never>((_resolve, reject) => { fail = reject; }), fail: (error: Error) => fail(error) };
});
vi.mock("./AttentionPalette", () => missing.arrival);
vi.mock("./AttentionButton", () => ({ default: () => null }));
// Keep record loading pending: this regression concerns the independent passive feed, not record data.
vi.mock("./PaletteRecords", () => new Promise(() => {}));

test("a rejected passive attention chunk preserves the working page and open search", async () => {
  handClock();
  const reported = vi.spyOn(console, "error").mockImplementation(() => {});
  const qc = testQueryClient();
  try {
    salesServer();
    const router = createMemoryRouter([{
      element: <RootLayout />, errorElement: <p>App failed</p>, children: [{
        element: <AppLayout />, children: [{ path: "/", element: <label>Unsaved note<input /></label> }],
      }],
    }]);
    render(<QueryClientProvider client={qc}><AuthContext.Provider value={stubAuth()}><ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider></AuthContext.Provider></QueryClientProvider>);
    await pass();
    const main = screen.getByRole("main");
    const note = screen.getByRole("textbox", { name: "Unsaved note" });
    fireEvent.change(note, { target: { value: "Keep this unsaved work" } });
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const box = screen.getByRole("combobox");
    fireEvent.change(box, { target: { value: "meena" } });
    await pass();

    await act(async () => { missing.fail(new TypeError("Failed to fetch dynamically imported module")); });
    expect(screen.queryByText("App failed")).not.toBeInTheDocument();
    expect(screen.getByRole("main")).toBe(main);
    expect(note).toHaveValue("Keep this unsaved work");
    expect(within(screen.getByRole("dialog", { name: "Search" })).getByRole("combobox")).toBe(box);
    expect(box).toHaveValue("meena");
    expect(box).toHaveFocus();
    await pass(351);
    fireEvent.keyDown(box, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(note).toBeInTheDocument();
  } finally { reported.mockRestore(); vi.useRealTimers(); qc.clear(); }
});
