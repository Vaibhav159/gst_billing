// The cold records download has its own module gate, independent of the pending-page probe (Ruling 1E-20).
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router";
import { AuthContext } from "@/core/auth/AuthProvider";
import { salesServer } from "@/core/sales/fixtures";
import { Page, ToastProvider } from "@/core/ui";
import { fakeToday } from "@/pages/sales/form/testing";
import { stubAuth, testQueryClient } from "@/test/render";
import { appRoutes } from "./routes";

const records = vi.hoisted(() => {
  let release!: () => void;
  return { waiting: new Promise<void>((resolve) => { release = resolve; }), arrive: () => release() };
});
vi.mock("@/core/shell/PaletteRecords", async (real) => { await records.waiting; return real(); });

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

function mount(routes: RouteObject[], path: string) {
  const qc = testQueryClient();
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<QueryClientProvider client={qc}><AuthContext.Provider value={stubAuth()}><ToastProvider><RouterProvider router={router} /></ToastProvider></AuthContext.Provider></QueryClientProvider>);
  return { router, qc };
}

function inAppLayout(pages: RouteObject[]): RouteObject[] {
  const root = appRoutes[0];
  const signedIn = root.children!.find((r) => !r.path)!;
  return [{ element: root.element, errorElement: root.errorElement, children: [{ element: signedIn.element, children: pages }] }];
}

test("Ctrl K immediately owns the keys while records load, then searches every letter already typed", async () => {
  const user = fakeToday();
  const { calls } = salesServer([["GET", "search/quick/", () => ({ customers: [{ id: 7, name: "Meena Jain", mobile_number: "9414126508", gst_number: "", recent_invoices: [] }], invoices: [], products: [] })]]);
  // The review probe's focused page box; keep the records download as this test's only uncontrolled code load.
  const { qc } = mount(inAppLayout([{ path: "/sales", element: <Page title="Bills"><input type="search" aria-label="Search sales bills" /></Page> }]), "/sales");
  try {
    const pageBox = await screen.findByRole("searchbox", { name: /Search sales bills/ }, { timeout: 5000 });
    act(() => { vi.advanceTimersByTime(400); pageBox.focus(); });
    fireEvent.keyDown(pageBox, { key: "k", ctrlKey: true });
    const dialog = screen.getByRole("dialog", { name: "Search" });
    const box = within(dialog).getByRole("combobox");
    expect(box).toHaveFocus();
    await user.keyboard("meena");
    expect(box).toHaveValue("meena");
    expect(pageBox).toHaveValue("");
    expect(within(dialog).getByText("Loading search…")).toBeInTheDocument();
    expect(calls.filter((c) => c.url === "search/quick/")).toHaveLength(0);
    await act(async () => records.arrive());
    expect(await within(dialog).findByRole("option", { name: /^Meena Jain/ }, { timeout: 5000 })).toBeInTheDocument();
    expect(calls.filter((c) => c.url === "search/quick/").map((c) => c.params.q)).toEqual(["meena"]);
    expect(box).toHaveFocus();
    expect(box).toHaveValue("meena");
  } finally { await act(async () => records.arrive()); qc.clear(); }
});
