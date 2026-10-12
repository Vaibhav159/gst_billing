import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AxiosError, type AxiosAdapter } from "axios";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";
import { api } from "@/core/api/client";
import { AuthProvider, useAuth } from "./AuthProvider";
import { RequireAuth } from "./RequireAuth";

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

let result: unknown;
function Where() { const l = useLocation(); return <p>at:{l.pathname + l.search}</p>; }
function SignIn() { const a = useAuth(); return <button type="button" onClick={async () => { result = await a.signIn("rakesh", "pw"); }}>in</button>; }
function mount(entries: string[]) {
  const router = createMemoryRouter([
    { path: "/login", element: <><Where /><SignIn /></> },
    { path: "*", element: <RequireAuth><Where /></RequireAuth> },
  ], { initialEntries: entries });
  render(<QueryClientProvider client={new QueryClient()}><AuthProvider><RouterProvider router={router} /></AuthProvider></QueryClientProvider>);
}

test("a sign-in whose person couldn't be loaded leaves nothing to sign out: a later sign-out on another tab keeps a link opened here (Ruling 63)", async () => {
  // token/ works, me/ can't be reached: the tokens it stored are cleared again
  api.defaults.adapter = ((config) => (config.url === "token/"
    ? Promise.resolve({ status: 200, statusText: "", headers: {}, config, data: { access: "a", refresh: "r" } })
    : Promise.reject(new AxiosError("Network Error", "ERR_NETWORK", config)))) as AxiosAdapter;
  mount(["/login"]);
  await act(async () => { screen.getByText("in").click(); });
  await waitFor(() => expect(result).toMatchObject({ ok: false }));
  expect(localStorage.getItem("gst_access_token")).toBeNull();
  // another tab signs out: its storage events reach this tab, which has no sign-in of its own to end
  act(() => {
    for (const key of ["gst_access_token", "gst_refresh_token", "gst3.me"]) window.dispatchEvent(new StorageEvent("storage", { key, oldValue: "x", newValue: null }));
  });
  expect(sessionStorage.getItem("gst3.signedOutHere")).toBeNull();
  cleanup();
  mount(["/customers/9"]); // the next link opened in this tab is a first visit
  expect(await screen.findByText("at:/login?next=%2Fcustomers%2F9")).toBeInTheDocument();
});
