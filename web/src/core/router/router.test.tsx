import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, Link, matchRoutes, RouterProvider } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthContext } from "@/core/auth/AuthProvider";
import { Page, ToastProvider, useToast, type ToastApi } from "@/core/ui";
import { AppLayout } from "@/core/shell/AppLayout";
import { stubAuth } from "@/test/render";
import { appRoutes, V2_REDIRECTS } from "./routes";
import { useUnsavedGuard } from "./useUnsavedGuard";

/** `extra` renders beside the router, inside the toast provider, as App's own providers do. */
function mount(path: string, signedIn = true, extra: ReactNode = null) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  render(<QueryClientProvider client={new QueryClient()}><AuthContext.Provider value={stubAuth(signedIn ? undefined : null)}><ToastProvider>{extra}<RouterProvider router={router} /></ToastProvider></AuthContext.Provider></QueryClientProvider>);
  return router;
}

test("a screen from a later part says which part brings it", async () => {
  mount("/sales");
  expect(await screen.findByRole("heading", { level: 1, name: "Bills" })).toBeInTheDocument();
  expect(screen.getByText(/comes in part 1/i)).toBeInTheDocument();
});

test("signed out, any page goes to sign-in and remembers where it was going", async () => {
  const router = mount("/customers/7", false);
  await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
  expect(router.state.location.search).toBe("?next=%2Fcustomers%2F7");
});

test("v2's addresses still work", async () => {
  const router = mount("/billing/invoice/edit/42");
  await waitFor(() => expect(router.state.location.pathname).toBe("/sales/42/edit"));
  expect(V2_REDIRECTS.length).toBeGreaterThanOrEqual(40);
});

test("a new page puts focus on its title and announces it", async () => {
  const router = mount("/sales");
  await screen.findByRole("heading", { level: 1, name: "Bills" });
  await act(async () => { await router.navigate("/customers"); });
  const h1 = await screen.findByRole("heading", { level: 1, name: "Customers" });
  await waitFor(() => expect(h1).toHaveFocus());
  // Ruling 6: announce() sets the text in a frame after the 90 ms timer, so wait for it
  await waitFor(() => expect(document.getElementById("route-announcer")).toHaveTextContent("Customers"));
});

test("an unknown address shows the not-found page with a way home", async () => {
  mount("/no/such/page");
  expect(await screen.findByRole("heading", { level: 1, name: /isn't here/i })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: /home/i })).toHaveAttribute("href", "/");
});

test("the second click of a double click doesn't land on the page that just opened", async () => {
  const router = mount("/sales");
  await screen.findByRole("heading", { level: 1, name: "Bills" });
  await act(async () => { await router.navigate("/customers"); });
  const h1 = await screen.findByRole("heading", { level: 1, name: "Customers" });
  const spy = vi.fn();
  h1.addEventListener("click", spy);
  await userEvent.click(h1);
  expect(spy).not.toHaveBeenCalled();
});

/* ── Beyond the brief: the page frame's Back and the unsaved-changes guard ── */

/** Past the guards that drop the second tap of a double tap (300 ms for a new page, 350 ms for a dialog). */
const afterADoubleTap = () => act(() => { vi.advanceTimersByTime(400); });

test("Back returns to the same scroll and to the row that opened the page; a new page starts at the top", async () => {
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  try {
    const router = createMemoryRouter([{ element: <AppLayout />, children: [
      { path: "/customers", element: <Page title="Customers"><Link to="/customers/7" data-row="7">Anil Gupta</Link></Page> },
      { path: "/customers/7", element: <Page title="Anil Gupta">His bills</Page> },
    ] }], { initialEntries: ["/customers"] });
    render(<ToastProvider><RouterProvider router={router} /></ToastProvider>);
    await screen.findByRole("heading", { level: 1, name: "Customers" });
    const main = document.getElementById("app-main")!;
    main.scrollTop = 480;
    fireEvent.scroll(main);
    afterADoubleTap();
    await userEvent.click(screen.getByRole("link", { name: "Anil Gupta" }));
    const title = await screen.findByRole("heading", { level: 1, name: "Anil Gupta" });
    await waitFor(() => expect(main.scrollTop).toBe(0));
    await waitFor(() => expect(title).toHaveFocus());

    await act(async () => { await router.navigate(-1); });
    const row = await screen.findByRole("link", { name: "Anil Gupta" });
    await waitFor(() => expect(main.scrollTop).toBe(480));
    await waitFor(() => expect(row).toHaveFocus());
  } finally {
    vi.useRealTimers();
  }
});

test("leaving a page with unsaved changes asks first: Stay keeps the page, Leave goes", async () => {
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  try {
    function NewBill() { return <>{useUnsavedGuard(true)}<p>the form</p></>; }
    const router = createMemoryRouter([{ path: "/sales", element: <p>the list</p> }, { path: "/sales/new", element: <NewBill /> }], { initialEntries: ["/sales", "/sales/new"], initialIndex: 1 });
    render(<ToastProvider><RouterProvider router={router} /></ToastProvider>);
    // closing the tab asks too
    const unload = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);

    await act(async () => { await router.navigate("/sales"); });
    let dialog = await screen.findByRole("dialog", { name: "Leave without saving?" });
    expect(dialog).toHaveTextContent("Your changes aren't saved. Leave this page and lose them?");
    afterADoubleTap();
    fireEvent.click(within(dialog).getByRole("button", { name: "Stay" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(router.state.location.pathname).toBe("/sales/new");

    // the browser's Back asks the same
    await act(async () => { await router.navigate(-1); });
    dialog = await screen.findByRole("dialog", { name: "Leave without saving?" });
    afterADoubleTap();
    fireEvent.click(within(dialog).getByRole("button", { name: "Leave" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/sales"));
    expect(screen.getByText("the list")).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

/* ── The review's rulings ── */

test("one toast host covers sign-in and the app: a toast shows exactly once on either", async () => {
  let toast!: ToastApi;
  function Grab() { toast = useToast(); return null; }
  mount("/login", false, <Grab />);
  await screen.findByRole("heading", { level: 1, name: "Sign in" });
  act(() => { toast.show({ title: "Shown on the sign-in page" }); });
  expect(await screen.findAllByText("Shown on the sign-in page")).toHaveLength(1);
  cleanup();

  mount("/sales", true, <Grab />);
  await screen.findByRole("heading", { level: 1, name: "Bills" });
  act(() => { toast.show({ title: "Shown in the app" }); });
  expect(await screen.findAllByText("Shown in the app")).toHaveLength(1);
});

const phone = (on: boolean) => { (window as unknown as { __phone?: boolean }).__phone = on; };

test("on a phone, Back up to the page above slides back, even with no page before it in the tab", async () => {
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  phone(true);
  try {
    const router = createMemoryRouter([{ element: <AppLayout />, children: [
      { path: "/sales/7", element: <Page title="Bill 7" back="/sales">The bill</Page> },
      { path: "/sales/7/edit", element: <Page title="Edit bill 7" back="/sales/7">The form</Page> },
    ] }], { initialEntries: ["/sales/7/edit"] });
    render(<ToastProvider><RouterProvider router={router} /></ToastProvider>);
    await screen.findByRole("heading", { level: 1, name: "Edit bill 7" });
    const frame = () => document.getElementById("app-main")!.firstElementChild;
    afterADoubleTap();
    // opened straight from a link: Back goes up to the bill, in this entry's place
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await screen.findByRole("heading", { level: 1, name: "Bill 7" });
    expect(router.state.historyAction).toBe("REPLACE");
    expect(frame()).toHaveClass("anim-page-pop");

    await act(async () => { await router.navigate("/sales/7/edit"); });
    await screen.findByRole("heading", { level: 1, name: "Edit bill 7" });
    expect(frame()).toHaveClass("anim-page-push");
  } finally {
    phone(false);
    vi.useRealTimers();
  }
});

test("forms and print hide the phone's tabs; every other page keeps them", () => {
  const hidesTabs = (path: string) => {
    const m = matchRoutes(appRoutes, path);
    return Boolean(m && m[m.length - 1].route.handle?.hideNav);
  };
  const hidden = [
    "/sales/new", "/sales/7/edit", "/sales/7/print", "/customers/new", "/customers/7/edit", "/purchases/new", "/purchases/9/edit", "/purchases/inbox/4",
    "/products/new", "/products/5/edit", "/firms/new", "/firms/3/edit", "/e/new", "/e/new/items", "/e/customers/new", "/e/customers/7/edit",
  ];
  for (const path of hidden) expect(hidesTabs(path), path).toBe(true);
  const shown = [
    "/", "/sales", "/sales/7", "/sales/paper", "/customers/7", "/customers/7/statement", "/purchases/inbox", "/purchases/9", "/products/5", "/firms/3",
    "/e", "/e/bills", "/e/customers", "/e/bill/5", "/more", "/login", "/no/such/page",
  ];
  for (const path of shown) expect(hidesTabs(path), path).toBe(false);
});
