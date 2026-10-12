// The pending-page probe owns and releases its records gate; cold typing is in paletteTyping.test.
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router";
import { AuthContext } from "@/core/auth/AuthProvider";
import { salesServer } from "@/core/sales/fixtures";
import { Page, ToastProvider } from "@/core/ui";
import { fakeToday } from "@/pages/sales/form/testing";
import { stubAuth, testQueryClient } from "@/test/render";
import { lazyPage } from "./lazyPage";
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

test("Search opens synchronously while a lazy page move is still pending", async () => {
  fakeToday();
  await act(async () => records.arrive());
  salesServer();
  let arrive!: () => void;
  const Later = lazyPage(() => new Promise<{ default: () => JSX.Element }>((resolve) => { arrive = () => resolve({ default: () => <Page title="Later page">later</Page> }); }));
  const { router, qc } = mount(inAppLayout([{ path: "/first", element: <Page title="First page">first</Page> }, { path: "/later", element: <Later /> }]), "/first");
  try {
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const warm = await screen.findByRole("dialog", { name: "Search" }, { timeout: 5000 });
    await waitFor(() => expect(within(warm).queryByText("Loading search…")).not.toBeInTheDocument(), { timeout: 5000 });
    fireEvent.keyDown(within(warm).getByRole("combobox"), { key: "Escape" });
    await act(async () => { await vi.advanceTimersByTimeAsync(400); });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await act(async () => { await router.navigate("/later"); });
    expect(screen.getByRole("heading", { level: 1, name: "First page" })).toBeInTheDocument();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    const dialog = screen.getByRole("dialog", { name: "Search" });
    expect(within(dialog).getByRole("combobox")).toHaveFocus();
    expect(screen.getByRole("heading", { level: 1, name: "First page" })).toBeInTheDocument();
    await act(async () => arrive());
    expect(await screen.findByRole("heading", { level: 1, name: "Later page" }, { timeout: 5000 })).toBeInTheDocument();
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByRole("combobox")).toHaveFocus();
  } finally { qc.clear(); }
});
