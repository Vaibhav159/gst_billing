import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AxiosAdapter, InternalAxiosRequestConfig } from "axios";
import axios, { AxiosError } from "axios";
import { MemoryRouter, Route, Routes, useLocation } from "react-router";
import { api, setTokens } from "@/core/api/client";
import { renderApp } from "@/test/render";
import { AuthProvider, useAuth } from "./AuthProvider";
import { RequireAuth } from "./RequireAuth";
import { can, whyNot } from "./permissions";

function reply(config: InternalAxiosRequestConfig, status: number, data: unknown) {
  if (status >= 400) return Promise.reject(new AxiosError("x", String(status), config, null, { status, data, statusText: "", headers: {}, config } as never));
  return Promise.resolve({ status, data, statusText: "", headers: {}, config });
}
const ME = { id: 7, username: "rakesh", full_name: "Rakesh Soni", role: "staff", role_label: "Counter staff", permissions: ["view", "bill.create"], v2_role: "editor", needs_role_choice: false };

function Probe() {
  const a = useAuth();
  return <div><p>status:{a.status}</p><p>who:{a.me?.fullName ?? "-"}</p><p>bill:{String(a.can("bill.create"))}</p><p>edit:{String(a.can("bill.edit"))}</p>
    <button onClick={() => a.signIn("rakesh", "pw")}>in</button><button onClick={() => a.signOut()}>out</button></div>;
}
const mount = () => render(<QueryClientProvider client={new QueryClient()}><AuthProvider><Probe /></AuthProvider></QueryClientProvider>);

beforeEach(() => localStorage.clear());
afterEach(() => { vi.restoreAllMocks(); window.history.pushState({}, "", "/"); });

test("signing in stores the tokens and loads who this is from /api/me/", async () => {
  api.defaults.adapter = ((config) => config.url === "token/" ? reply(config, 200, { access: "a", refresh: "r" }) : reply(config, 200, ME)) as AxiosAdapter;
  mount();
  expect(screen.getByText("status:signed-out")).toBeInTheDocument();
  await act(async () => { screen.getByText("in").click(); });
  await waitFor(() => expect(screen.getByText("status:signed-in")).toBeInTheDocument());
  expect(screen.getByText("who:Rakesh Soni")).toBeInTheDocument();
  expect(screen.getByText("bill:true")).toBeInTheDocument();
  expect(screen.getByText("edit:false")).toBeInTheDocument();
});

test("with a token and a remembered person, the app opens straight away even offline", async () => {
  setTokens("a", "r");
  localStorage.setItem("gst3.me", JSON.stringify({ id: 7, username: "rakesh", fullName: "Rakesh Soni", role: "staff", roleLabel: "Counter staff", permissions: ["view"], needsRoleChoice: false }));
  api.defaults.adapter = ((config) => Promise.reject(new AxiosError("Network Error", "ERR_NETWORK", config))) as AxiosAdapter;
  mount();
  expect(screen.getByText("status:signed-in")).toBeInTheDocument();
  expect(screen.getByText("who:Rakesh Soni")).toBeInTheDocument();
});

test("signing out forgets the tokens and the person", async () => {
  setTokens("a", "r");
  api.defaults.adapter = ((config) => reply(config, 200, ME)) as AxiosAdapter;
  mount();
  await waitFor(() => expect(screen.getByText("status:signed-in")).toBeInTheDocument());
  await act(async () => { screen.getByText("out").click(); });
  expect(screen.getByText("status:signed-out")).toBeInTheDocument();
  expect(localStorage.getItem("gst_access_token")).toBeNull();
  expect(localStorage.getItem("gst3.me")).toBeNull();
});

test("the role mirror matches the server's matrix and explains a no", () => {
  expect(can("*", "bill.delete")).toBe(true);
  expect(can(["view"], "bill.create")).toBe(false);
  expect(whyNot("staff", "bill.delete")).toBe("Only the owner can delete bills. Ask the owner if you need it.");
  expect(whyNot("viewer", "bill.create")).toBe("Only the owner and counter staff can make bills. Ask the owner if you need it.");
});

// Beyond the brief's four: where RequireAuth sends a signed-out person, and a start that can't find out who this is

function Where() {
  const l = useLocation();
  return <p>at:{l.pathname + l.search}</p>;
}
const guardedRoutes = (
  <Routes>
    <Route path="/login" element={<Where />} />
    <Route path="*" element={<RequireAuth><Probe /></RequireAuth>} />
  </Routes>
);

test("signed out, any page sends the person to sign in, remembering the page to come back to", () => {
  renderApp(guardedRoutes, { path: "/sales/31?tab=items", me: null });
  expect(screen.getByText("at:/login?next=%2Fsales%2F31%3Ftab%3Ditems")).toBeInTheDocument();
});

test("when the session runs out, sign-in returns to the page it ran out on and says why", async () => {
  window.history.pushState({}, "", "/sales/31?tab=items"); // the client reports the browser's address
  setTokens("a", "r");
  localStorage.setItem("gst3.me", JSON.stringify({ id: 7, username: "rakesh", fullName: "Rakesh Soni", role: "staff", roleLabel: "Counter staff", permissions: ["view"], needsRoleChoice: false }));
  const refused = new AxiosError("x", "401", {} as InternalAxiosRequestConfig, null, { status: 401, data: { detail: "Token is blacklisted" }, statusText: "", headers: {}, config: {} } as never);
  vi.spyOn(axios, "post").mockRejectedValue(refused); // the refresh
  api.defaults.adapter = ((config) => reply(config, 401, {})) as AxiosAdapter;
  render(<QueryClientProvider client={new QueryClient()}><AuthProvider><MemoryRouter initialEntries={["/sales/31?tab=items"]}>{guardedRoutes}</MemoryRouter></AuthProvider></QueryClientProvider>);
  expect(await screen.findByText("at:/login?next=%2Fsales%2F31%3Ftab%3Ditems&reason=expired")).toBeInTheDocument();
  expect(localStorage.getItem("gst_access_token")).toBeNull();
  expect(localStorage.getItem("gst3.me")).toBeNull();
});

test("a start that can't reach the server, with no one remembered, says so; Try again loads the person", async () => {
  setTokens("a", "r");
  let up = false;
  api.defaults.adapter = ((config) => (up ? reply(config, 200, ME) : Promise.reject(new AxiosError("Network Error", "ERR_NETWORK", config)))) as AxiosAdapter;
  render(<QueryClientProvider client={new QueryClient()}><AuthProvider><MemoryRouter initialEntries={["/sales"]}>{guardedRoutes}</MemoryRouter></AuthProvider></QueryClientProvider>);
  expect(screen.getByText("Loading the app…")).toBeInTheDocument();
  expect(await screen.findByText("Couldn't load the app")).toBeInTheDocument();
  up = true;
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("who:Rakesh Soni")).toBeInTheDocument();
  expect(screen.getByText("status:signed-in")).toBeInTheDocument();
});
