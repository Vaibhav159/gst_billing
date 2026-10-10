// Ruling 1B-4: Selling's pages load on demand, so the app's first download stays under Vite's 500 kB warning and
// react-pdf (1.2 MB) never comes with it.
import { isValidElement, type ComponentType } from "react";
import { act, render, screen, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider, type RouteObject } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthContext } from "@/core/auth/AuthProvider";
import { salesServer } from "@/core/sales/fixtures";
import { ToastProvider } from "@/core/ui";
import Placeholder from "@/pages/core/Placeholder";
import CustomerPage from "@/pages/customers/CustomerPage";
import { stubAuth } from "@/test/render";
import { lazyPage, loadedPage, type LazyPage } from "./lazyPage";
import { appRoutes } from "./routes";

const all = (routes: RouteObject[]): RouteObject[] => routes.flatMap((r) => [r, ...all(r.children ?? [])]);
const isLazy = (el: unknown) => isValidElement(el) && (el.type as { $$typeof?: symbol }).$$typeof === Symbol.for("react.lazy");
const route = (path: string) => all(appRoutes).find((r) => r.path === path);
/** The whole app at `path` (or `routes` in place of the app's own), signed in as the owner, as App renders it. */
function mount(path: string, routes: RouteObject[] = appRoutes) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<QueryClientProvider client={new QueryClient()}><AuthContext.Provider value={stubAuth()}><ToastProvider><RouterProvider router={router} /></ToastProvider></AuthContext.Provider></QueryClientProvider>);
  return router;
}
/** The app's own root and signed-in layout (RequireAuth around AppLayout), nested as appRoutes nests them, around `pages`. */
function inAppLayout(pages: RouteObject[]): RouteObject[] {
  const [root] = appRoutes;
  const signedIn = root.children!.find((r) => !r.path)!;
  return [{ element: root.element, errorElement: root.errorElement, children: [{ element: signedIn.element, children: pages }] }];
}
/** A page whose code comes only when the test says: the lazy page, and what lets its code in once React has asked for it. */
function heldBack<T extends ComponentType<object>>(page: T): [LazyPage<T>, () => void] {
  let arrive = () => {};
  return [lazyPage(() => new Promise<{ default: T }>((resolve) => { arrive = () => resolve({ default: page }); })), () => arrive()];
}

// Plan 1B's bill page isn't built yet, so in the next two tests 1C's customer page stands in for it: it's routed today,
// and it loads on demand with the rest of Selling's pages once their imports in the routes change.
test("a route still says which screen it opens: a lazy page's loaded component, a placeholder's own", async () => {
  expect(await loadedPage(route("/customers/:id")?.element)).toBe(CustomerPage);
  expect(await loadedPage(route("/purchases")?.element)).toBe(Placeholder);
  expect(await loadedPage(undefined)).toBeUndefined();
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
