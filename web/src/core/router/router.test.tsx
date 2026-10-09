import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createMemoryRouter, Link, RouterProvider } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthContext } from "@/core/auth/AuthProvider";
import { Page, ToastProvider } from "@/core/ui";
import { AppLayout } from "@/core/shell/AppLayout";
import { stubAuth } from "@/test/render";
import { appRoutes, V2_REDIRECTS } from "./routes";
import { useUnsavedGuard } from "./useUnsavedGuard";

function mount(path: string, signedIn = true) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  render(<QueryClientProvider client={new QueryClient()}><AuthContext.Provider value={stubAuth(signedIn ? undefined : null)}><ToastProvider><RouterProvider router={router} /></ToastProvider></AuthContext.Provider></QueryClientProvider>);
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
