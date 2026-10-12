// Ruling 1B-4: Selling's pages load on demand, so the app's first download stays under Vite's 500 kB warning and
// react-pdf (1.2 MB) never comes with it.
import { isValidElement, useState, type ComponentType, type ReactElement } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router";
import { QueryClientProvider } from "@tanstack/react-query";
import { AppRoutes } from "@/App";
import { queryClient } from "@/core/api/query";
import { AuthContext } from "@/core/auth/AuthProvider";
import { salesServer, wireDetail } from "@/core/sales/fixtures";
import { Button, Dialog, Page, ToastProvider } from "@/core/ui";
import Placeholder from "@/pages/core/Placeholder";
import CustomerPage from "@/pages/customers/CustomerPage";
import BillPage from "@/pages/sales/BillPage";
import PurchaseList from "@/pages/purchases/PurchaseList";
import { SupplierList } from "@/pages/suppliers/Suppliers";
import { fakeToday } from "@/pages/sales/form/testing";
import { stubAuth, testQueryClient } from "@/test/render";
import { lazyPage, loadedPage, type LazyPage } from "./lazyPage";
import { appRoutes } from "./routes";

// the print page's PDF is core/print's (and its own tests'): here a stand-in made at once (Ruling 1E-4)
vi.mock("@/core/print/make", async (real) => ({
  ...(await real<typeof import("@/core/print/make")>()),
  billFile: vi.fn(async () => ({ blob: new Blob(["%PDF-1.3"], { type: "application/pdf" }), name: "KGH_2026-27_31.pdf", sheets: 1 })),
}));

const all = (routes: RouteObject[]): RouteObject[] => routes.flatMap((r) => [r, ...all(r.children ?? [])]);
const isLazy = (el: unknown) => isValidElement(el) && (el.type as { $$typeof?: symbol }).$$typeof === Symbol.for("react.lazy");
const route = (path: string) => all(appRoutes).find((r) => r.path === path);

test("home keeps loading up front, so the shell's shown effect cannot mistake its skeleton for home", () => {
  expect(isValidElement(route("/")?.element)).toBe(true);
  expect(isLazy(route("/")?.element)).toBe(false);
});

/** The whole app at `path` (or `routes` in place of the app's own), signed in as the owner, as App renders it. */
function mount(path: string, routes: RouteObject[] = appRoutes) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<QueryClientProvider client={testQueryClient()}><AuthContext.Provider value={stubAuth()}><ToastProvider><RouterProvider router={router} /></ToastProvider></AuthContext.Provider></QueryClientProvider>);
  return router;
}
/**
 * The app's own root, sign-in page and signed-in layout (RequireAuth around AppLayout), nested as appRoutes nests them,
 * with `pages` inside the layout.
 */
function inAppLayout(pages: RouteObject[]): RouteObject[] {
  const [root] = appRoutes;
  const login = root.children!.find((r) => r.path === "/login")!;
  const signedIn = root.children!.find((r) => !r.path)!;
  return [{ element: root.element, errorElement: root.errorElement, children: [login, { element: signedIn.element, children: pages }] }];
}
/** A page whose code comes only when the test says: the lazy page, and what lets its code in once React has asked for it. */
function heldBack<T extends ComponentType<object>>(page: T): [LazyPage<T>, () => void] {
  let arrive = () => {};
  return [lazyPage(() => new Promise<{ default: T }>((resolve) => { arrive = () => resolve({ default: page }); })), () => arrive()];
}

test("every built sales and purchase page loads on demand, including customers and v2's number links (placeholders aside)", () => {
  const pages = all(appRoutes).filter((r) => /^\/(sales|customers|purchases)(\/|$)|^\/billing\/invoice\/:bizSlug/.test(r.path ?? "") && (r.element as ReactElement | undefined)?.type !== Placeholder);
  expect(pages.map((r) => r.path)).toEqual(expect.arrayContaining(["/sales", "/sales/:id", "/customers", "/customers/:id", "/purchases", "/purchases/:id", "/purchases/new", "/purchases/:id/edit"]));
  expect(pages.filter((r) => !isLazy(r.element)).map((r) => r.path)).toEqual([]);
});

test("a route still says which screen it opens: a lazy page's loaded component, a placeholder's own", async () => {
  expect(await loadedPage(route("/sales/:id")?.element)).toBe(BillPage);
  expect(await loadedPage(route("/purchases")?.element)).toBe(PurchaseList);
  expect(await loadedPage(route("/suppliers")?.element)).toBe(SupplierList);
  expect(await loadedPage(route("/audit")?.element)).toBe(Placeholder);
  expect(await loadedPage(undefined)).toBeUndefined();
});

test("a page that loads on demand opens through the app's router: a bill's page", async () => {
  fakeToday();
  try {
    salesServer([["GET", "sales/412/", () => wireDetail()]]);
    mount("/sales/412");
    expect(await screen.findByRole("heading", { level: 1, name: "KGH/2026-27/31" }, { timeout: 5000 })).toBeInTheDocument();
  } finally { vi.useRealTimers(); }
});

test("a page that loads on demand opens through the app's router: a customer's page", async () => {
  salesServer([["GET", "customers/7/", () => ({ id: 7, name: "Anil Gupta", businesses: [3], city: "Udaipur", state_name: "RAJASTHAN", created_at: "2025-08-04T11:00:00+05:30" })]]);
  mount("/customers/7");
  expect(await screen.findByRole("heading", { level: 1, name: "Anil Gupta" }, { timeout: 5000 })).toBeInTheDocument();
});

test("a lazy page is React's own lazy wrapper, and says which screen it opens once its code is in", async () => {
  const Lazy = lazyPage(() => import("@/pages/customers/CustomerPage"));
  expect(isLazy(<Lazy />)).toBe(true);
  expect(await loadedPage(<Lazy />)).toBe(CustomerPage);
});

test("until a page's code is in, the app shows with a skeleton in the page's place, then the page: AppLayout's one Suspense", async () => {
  salesServer();
  const [Later, arrive] = heldBack(() => <h1>Opened on demand</h1>);
  mount("/later", inAppLayout([{ path: "/later", element: <Later /> }]));
  // the app is up at once, the skeleton where the page goes: without the Suspense, React would wait for the page's code
  // and show nothing at all until then
  const main = screen.getByRole("main");
  expect(within(main).getByRole("status")).toHaveTextContent("Loading this page…");
  await act(async () => arrive());
  expect(await within(main).findByRole("heading", { level: 1, name: "Opened on demand" })).toBeInTheDocument();
  expect(within(main).queryByRole("status")).not.toBeInTheDocument();
});

test("a move to a page whose code isn't in yet keeps the page on screen, no skeleton, until it's in: React Router's moves are transitions", async () => {
  salesServer();
  const [Next, arrive] = heldBack(() => <h1>The next page</h1>);
  const router = mount("/first", inAppLayout([{ path: "/first", element: <h1>The first page</h1> }, { path: "/next", element: <Next /> }]));
  const main = screen.getByRole("main");
  expect(within(main).getByRole("heading", { level: 1, name: "The first page" })).toBeInTheDocument();
  await act(async () => { await router.navigate("/next"); });
  expect(within(main).getByRole("heading", { level: 1, name: "The first page" })).toBeInTheDocument();
  expect(within(main).queryByRole("status")).not.toBeInTheDocument();
  await act(async () => arrive());
  expect(await within(main).findByRole("heading", { level: 1, name: "The next page" })).toBeInTheDocument();
  expect(within(main).queryByRole("heading", { level: 1, name: "The first page" })).not.toBeInTheDocument();
});

test.each(["/later", "/first"])("a delayed page starts its 300 ms click guard when code arrives, and its dialog keeps 350 ms: from %s", async (start) => {
  fakeToday();
  let now = Date.now();
  const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
  const confirmed = vi.fn();
  function Probe() {
    const [open, setOpen] = useState(false);
    return <Page title="Guarded page"><Button onClick={() => setOpen(true)}>Open dialog</Button><Dialog open={open} onClose={() => setOpen(false)} title="Guarded dialog"><Button onClick={confirmed}>Confirm</Button></Dialog></Page>;
  }
  try {
    salesServer();
    const [Later, arrive] = heldBack(Probe);
    const router = mount(start, inAppLayout([{ path: "/first", element: <h1>First page</h1> }, { path: "/later", element: <Later /> }]));
    if (start === "/first") await act(async () => { await router.navigate("/later"); });
    now += 1000; // code takes longer than either guard; neither may be spent while it is missing
    await act(async () => arrive());
    const open = await screen.findByRole("button", { name: "Open dialog" }, { timeout: 5000 });
    now += 299;
    fireEvent.click(open);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    now += 1;
    fireEvent.click(open);
    const dialog = screen.getByRole("dialog", { name: "Guarded dialog" });
    const confirm = within(dialog).getByRole("button", { name: "Confirm" });
    now += 349;
    fireEvent.click(confirm);
    expect(confirmed).not.toHaveBeenCalled();
    now += 1;
    fireEvent.click(confirm);
    expect(confirmed).toHaveBeenCalledTimes(1);
  } finally { clock.mockRestore(); vi.useRealTimers(); }
});

/** /api/me/'s answer for the owner, as the sign-in state reads it. */
const OWNER_ME = { id: 1, username: "kailash", full_name: "Kailash Mehta", role: "owner", role_label: "Owner", permissions: "*", needs_role_choice: false };

test("signing in onto a page whose code isn't in yet greets that page once its code is in, not the skeleton before it: its title takes focus, its name is read out, it comes in (Ruling 1E-11)", async () => {
  salesServer([["POST", "token/", () => ({ access: "a", refresh: "r" })], ["GET", "me/", () => OWNER_ME]]);
  const [Later, arrive] = heldBack(() => <Page title="Opened on demand"><p>Its code came when it opened.</p></Page>);
  const router = createMemoryRouter(inAppLayout([{ path: "/later", element: <Later /> }]), { initialEntries: ["/login?next=%2Flater"] });
  try {
    // signing in through the app's own providers and sign-in page, which goes on to `next` itself
    render(<AppRoutes router={router} />);
    await userEvent.type(await screen.findByLabelText("Username"), "kailash");
    await userEvent.type(screen.getByLabelText("Password"), "pw");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    const main = await screen.findByRole("main");
    expect(within(main).getByRole("status")).toHaveTextContent("Loading this page…");
    await act(async () => arrive());
    const h1 = await within(main).findByRole("heading", { level: 1, name: "Opened on demand" });
    await waitFor(() => expect(h1).toHaveFocus());
    await waitFor(() => expect(document.getElementById("route-announcer")).toHaveTextContent("Opened on demand"));
    expect(main.firstElementChild).toHaveClass("h-full anim-page-rise", { exact: true });
  } finally {
    queryClient.clear();
    localStorage.clear();
  }
});

test.each([["a first open", "/broken"], ["a move", "/first"]])("a page whose code can't load shows Reload the app in its own place, inside <main>, with the app around it: %s", async (_, start) => {
  const reported = vi.spyOn(console, "error").mockImplementation(() => {}); // React and the page's own boundary report the failure, as they should
  try {
    salesServer();
    const Broken = lazyPage(() => Promise.reject(new TypeError("Failed to fetch dynamically imported module")));
    const router = mount(start, inAppLayout([{ path: "/first", element: <h1>The first page</h1> }, { path: "/broken", element: <Broken /> }]));
    const main = screen.getByRole("main");
    if (start !== "/broken") await act(async () => { await router.navigate("/broken"); });
    const alert = await within(main).findByRole("alert");
    expect(alert).toHaveTextContent("Something went wrong on this page");
    expect(within(alert).getByRole("button", { name: "Reload the app" })).toBeInTheDocument();
    // the app stays around it: the same <main>, under the desktop's header
    expect(screen.getByRole("main")).toBe(main);
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(reported).toHaveBeenCalledWith("Screen failed to draw:", expect.any(TypeError));
  } finally {
    reported.mockRestore();
  }
});

test("the print page loads on demand too, and hides the phone's tabs as a form does", async () => {
  salesServer([["GET", "sales/412/", () => wireDetail()], ["GET", "shop-settings/", () => ({ copies: "original", show_bank: true, share_message: "", updated_at: null, updated_by: null })]]);
  mount("/sales/412/print");
  expect(await screen.findByRole("document", { name: "Bill KGH/2026-27/31 on paper, original copy" }, { timeout: 5000 })).toBeInTheDocument();
  expect(route("/sales/:id/print")?.handle).toEqual({ hideNav: true });
  expect(isLazy(route("/sales/:id/print")?.element)).toBe(true);
});

test("batch print is a page of its own, loaded on demand", () => {
  expect(isLazy(route("/sales/batch")?.element)).toBe(true);
});

test("bulk PDFs is a page of its own, loaded on demand", () => {
  expect(isLazy(route("/sales/export")?.element)).toBe(true);
});
