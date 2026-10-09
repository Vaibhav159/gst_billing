import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import type { AxiosAdapter, InternalAxiosRequestConfig } from "axios";
import axios, { AxiosError } from "axios";
import { createMemoryRouter, MemoryRouter, Route, Routes, RouterProvider, useLocation } from "react-router";
import { api, refreshAccessToken, setTokens } from "@/core/api/client";
import { renderApp } from "@/test/render";
import { AuthProvider, useAuth, type Me } from "./AuthProvider";
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

// Ruling 30: tabs share one sign-in, so another tab signing in as someone else must not quietly take this one over

const KAILASH = { id: 1, username: "kailash", full_name: "Kailash Mehta", role: "owner", role_label: "Owner", permissions: "*", v2_role: "admin", needs_role_choice: false };
const REMEMBERED = { id: 7, username: "rakesh", fullName: "Rakesh Soni", role: "staff", roleLabel: "Counter staff", permissions: ["view", "bill.create"], needsRoleChoice: false };
/** /api/me/ answers for whoever the request's token belongs to; `down` makes it unreachable. */
function server(owners: Record<string, object>) {
  const s = { asked: [] as string[], down: false };
  api.defaults.adapter = ((config) => {
    const token = String(config.headers.Authorization ?? "").replace(/^Bearer /, "");
    s.asked.push(token);
    if (s.down) return Promise.reject(new AxiosError("Network Error", "ERR_NETWORK", config));
    return owners[token] ? reply(config, 200, owners[token]) : reply(config, 500, "<html>");
  }) as AxiosAdapter;
  return s;
}
/** Another tab writes to the shared storage; then this tab hears one storage event per write, as a browser delivers them. */
function inAnotherTab(writes: [string, string | null][]) {
  const events = writes.map(([key, value]) => {
    const oldValue = localStorage.getItem(key);
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
    return new StorageEvent("storage", { key, oldValue, newValue: value });
  });
  act(() => { events.forEach((e) => window.dispatchEvent(e)); });
}
const SIGN_OUT: [string, null][] = [["gst_access_token", null], ["gst_refresh_token", null], ["gst3.me", null]];
/** A SimpleJWT-shaped access token naming `userId`; `n` tells two tokens for one person apart. */
const jwt = (userId: number, n = 1) => ["e30", btoa(JSON.stringify({ token_type: "access", user_id: userId, jti: `t${n}` })).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_"), "sig"].join(".");
const seen: unknown[] = [];
function Watch() { seen.push(useAuth().me); return null; }
function mountTab({ client = new QueryClient(), onSwitchedUser }: { client?: QueryClient; onSwitchedUser?: (m: Me) => void } = {}) {
  render(<QueryClientProvider client={client}><AuthProvider onSwitchedUser={onSwitchedUser}><Probe /><Watch /></AuthProvider></QueryClientProvider>);
  return client;
}
const mountGuarded = (onSwitchedUser?: (m: Me) => void) => render(
  <QueryClientProvider client={new QueryClient()}><AuthProvider onSwitchedUser={onSwitchedUser}><Watch /><MemoryRouter initialEntries={["/sales"]}>{guardedRoutes}</MemoryRouter></AuthProvider></QueryClientProvider>,
);
const lastSeen = () => seen[seen.length - 1];

test("another tab signing out signs this tab out: the person and their data go here too", async () => {
  setTokens("a", "r");
  server({ a: ME });
  const client = mountTab();
  await waitFor(() => expect(screen.getByText("who:Rakesh Soni")).toBeInTheDocument());
  client.setQueryData(["bills"], ["KGH/31"]);
  inAnotherTab(SIGN_OUT);
  expect(screen.getByText("status:signed-out")).toBeInTheDocument();
  expect(screen.getByText("who:-")).toBeInTheDocument();
  expect(client.getQueryData(["bills"])).toBeUndefined();
});

test("another tab clearing all storage counts as signing out (one event, with no key)", async () => {
  setTokens("a", "r");
  server({ a: ME });
  mountTab();
  await waitFor(() => expect(screen.getByText("who:Rakesh Soni")).toBeInTheDocument());
  localStorage.clear();
  act(() => { window.dispatchEvent(new StorageEvent("storage", { key: null })); });
  expect(screen.getByText("status:signed-out")).toBeInTheDocument();
});

test("another tab signing in as someone else: this tab asks who it is now, drops the old data and says who is signed in", async () => {
  setTokens("a", "r");
  const s = server({ a: ME, b: KAILASH });
  const switched = vi.fn<(m: Me) => void>();
  const client = mountTab({ onSwitchedUser: switched });
  await waitFor(() => expect(screen.getByText("who:Rakesh Soni")).toBeInTheDocument());
  client.setQueryData(["bills"], ["KGH/31"]);
  inAnotherTab([["gst_access_token", "b"], ["gst_refresh_token", "rb"]]);
  await waitFor(() => expect(screen.getByText("who:Kailash Mehta")).toBeInTheDocument());
  expect(screen.getByText("edit:true")).toBeInTheDocument(); // the owner's permissions now
  expect(client.getQueryData(["bills"])).toBeUndefined();
  expect(switched.mock.calls).toEqual([[expect.objectContaining({ id: 1, fullName: "Kailash Mehta", role: "owner" })]]);
  expect(JSON.parse(localStorage.getItem("gst3.me")!)).toMatchObject({ id: 1, fullName: "Kailash Mehta" });
  // the other tab then remembers its person too: no second question, no second notice
  inAnotherTab([["gst3.me", localStorage.getItem("gst3.me")]]);
  await act(async () => {});
  expect(s.asked).toEqual(["a", "b"]);
  expect(switched).toHaveBeenCalledTimes(1);
});

test("the same person's token refreshed in another tab: this tab checks once, and nothing on screen changes", async () => {
  setTokens("a", "r");
  const s = server({ a: ME, a2: ME });
  const switched = vi.fn<(m: Me) => void>();
  const client = mountTab({ onSwitchedUser: switched });
  await waitFor(() => expect(screen.getByText("who:Rakesh Soni")).toBeInTheDocument());
  client.setQueryData(["bills"], ["KGH/31"]);
  const person = seen[seen.length - 1];
  const renders = seen.length;
  inAnotherTab([["gst_access_token", "a2"], ["gst_refresh_token", "r2"]]);
  await waitFor(() => expect(s.asked).toEqual(["a", "a2"]));
  await act(async () => {});
  expect(switched).not.toHaveBeenCalled();
  expect(client.getQueryData(["bills"])).toEqual(["KGH/31"]);
  expect(screen.getByText("status:signed-in")).toBeInTheDocument();
  expect(seen.length).toBe(renders); // not even a re-render
  expect(seen[seen.length - 1]).toBe(person);
});

test("a sign-out heard after a newer sign-in never wipes that sign-in; this tab follows it", async () => {
  setTokens("a", "r");
  server({ a: ME, b: KAILASH });
  const switched = vi.fn<(m: Me) => void>();
  mountTab({ onSwitchedUser: switched });
  await waitFor(() => expect(screen.getByText("who:Rakesh Soni")).toBeInTheDocument());
  // the other tab signed out and Kailash signed straight back in, before this tab heard of either
  inAnotherTab([...SIGN_OUT, ["gst_access_token", "b"], ["gst_refresh_token", "rb"]]);
  await waitFor(() => expect(screen.getByText("who:Kailash Mehta")).toBeInTheDocument());
  expect(localStorage.getItem("gst_access_token")).toBe("b");
  expect(localStorage.getItem("gst_refresh_token")).toBe("rb");
  expect(switched).toHaveBeenCalledTimes(1);
});

test("a /api/me/ answer that lands after signing out doesn't sign the tab back in", async () => {
  setTokens("a", "r");
  localStorage.setItem("gst3.me", JSON.stringify(REMEMBERED));
  let answer: (() => void) | undefined;
  api.defaults.adapter = ((config) => new Promise((resolve) => { answer = () => resolve({ status: 200, data: ME, statusText: "", headers: {}, config }); })) as AxiosAdapter;
  mount();
  expect(screen.getByText("status:signed-in")).toBeInTheDocument(); // the remembered person, while /api/me/ is slow
  await waitFor(() => expect(answer).toBeDefined());
  await act(async () => { screen.getByText("out").click(); });
  await act(async () => { answer!(); });
  expect(screen.getByText("status:signed-out")).toBeInTheDocument();
  expect(localStorage.getItem("gst3.me")).toBeNull();
});

test("a remembered person opens the app only with their own token, since v2 may have signed someone else in", async () => {
  localStorage.setItem("gst3.me", JSON.stringify(REMEMBERED));
  setTokens(jwt(7), "r");
  server({}).down = true;
  const first = mountGuarded();
  expect(screen.getByText("who:Rakesh Soni")).toBeInTheDocument(); // Rakesh's own token: straight away, offline
  first.unmount();
  setTokens(jwt(1), "r"); // Kailash signed in on v2 since
  mountGuarded();
  expect(screen.queryByText("who:Rakesh Soni")).not.toBeInTheDocument();
  expect(lastSeen()).toBeNull();
  expect(await screen.findByText("Couldn't load the app")).toBeInTheDocument();
  expect(lastSeen()).toBeNull();
});

test("when the server can't say who it is now: the same person carries on; someone else's token stops the old person, with Try again", async () => {
  setTokens(jwt(7), "r");
  const s = server({ [jwt(7)]: ME, [jwt(7, 2)]: ME, [jwt(1)]: KAILASH, [jwt(1, 2)]: KAILASH });
  const switched = vi.fn<(m: Me) => void>();
  mountGuarded(switched);
  await waitFor(() => expect(screen.getByText("who:Rakesh Soni")).toBeInTheDocument());
  s.down = true;
  inAnotherTab([["gst_access_token", jwt(7, 2)]]); // Rakesh's own token, refreshed in another tab
  await waitFor(() => expect(s.asked).toHaveLength(2));
  await act(async () => {});
  expect(screen.getByText("who:Rakesh Soni")).toBeInTheDocument();
  inAnotherTab([["gst_access_token", jwt(1)]]); // Kailash signs in in another tab
  expect(await screen.findByText("Couldn't load the app")).toBeInTheDocument();
  expect(lastSeen()).toBeNull(); // Rakesh isn't kept on a token that isn't his
  inAnotherTab([["gst_access_token", jwt(7, 3)]]); // Rakesh signs back in there: on his own token he carries on, still offline
  expect(await screen.findByText("who:Rakesh Soni")).toBeInTheDocument();
  inAnotherTab([["gst_access_token", jwt(1, 2)]]); // and Kailash again
  expect(await screen.findByText("Couldn't load the app")).toBeInTheDocument();
  s.down = false;
  await userEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("who:Kailash Mehta")).toBeInTheDocument();
  expect(switched.mock.calls).toEqual([[expect.objectContaining({ id: 1, fullName: "Kailash Mehta" })]]);
});

test("a sign-in that fails here never removes the sign-in another tab made; one that works isn't announced back", async () => {
  let password = "wrong";
  api.defaults.adapter = ((config) => {
    if (config.url === "token/") return password === "right" ? reply(config, 200, { access: "a", refresh: "r" }) : reply(config, 401, { detail: "No active account found with the given credentials" });
    return reply(config, 200, config.headers.Authorization === "Bearer a" ? ME : KAILASH);
  }) as AxiosAdapter;
  const switched = vi.fn<(m: Me) => void>();
  const client = mountTab({ onSwitchedUser: switched });
  expect(screen.getByText("status:signed-out")).toBeInTheDocument();
  inAnotherTab([["gst_access_token", "b"], ["gst_refresh_token", "rb"]]); // Kailash signs in in another tab: this one follows
  await waitFor(() => expect(screen.getByText("who:Kailash Mehta")).toBeInTheDocument());
  expect(switched).not.toHaveBeenCalled(); // no one was signed in here, so nothing was taken over
  await act(async () => { screen.getByText("in").click(); }); // a wrong password typed here
  expect(localStorage.getItem("gst_access_token")).toBe("b");
  expect(localStorage.getItem("gst_refresh_token")).toBe("rb");
  expect(screen.getByText("who:Kailash Mehta")).toBeInTheDocument();
  client.setQueryData(["bills"], ["KGH/31"]);
  password = "right";
  await act(async () => { screen.getByText("in").click(); }); // Rakesh signs in here: his own doing, so no notice, but Kailash's data goes
  await waitFor(() => expect(screen.getByText("who:Rakesh Soni")).toBeInTheDocument());
  expect(switched).not.toHaveBeenCalled();
  expect(client.getQueryData(["bills"])).toBeUndefined();
});

test("a sign-in whose person can't be loaded leaves no tokens behind and says why", async () => {
  api.defaults.adapter = ((config) => (config.url === "token/" ? reply(config, 200, { access: "a", refresh: "r" }) : Promise.reject(new AxiosError("Network Error", "ERR_NETWORK", config)))) as AxiosAdapter;
  let result: unknown;
  function SignInHere() { const a = useAuth(); return <button onClick={async () => { result = await a.signIn("rakesh", "pw"); }}>sign in</button>; }
  render(<QueryClientProvider client={new QueryClient()}><AuthProvider><SignInHere /><Probe /></AuthProvider></QueryClientProvider>);
  await act(async () => { screen.getByText("sign in").click(); });
  await waitFor(() => expect(result).toMatchObject({ ok: false, problem: { kind: "unreachable" } }));
  expect(localStorage.getItem("gst_access_token")).toBeNull();
  expect(localStorage.getItem("gst_refresh_token")).toBeNull();
  expect(screen.getByText("status:signed-out")).toBeInTheDocument();
});

// Ruling 31: Sign out sticks mid-refresh, and a switch refreshes what's on screen

test("Sign out sticks while a refresh is out: the late refresh brings no one back, here, in other tabs or after a reload", async () => {
  setTokens("a", "r");
  let land: ((r: unknown) => void) | undefined;
  vi.spyOn(axios, "post").mockImplementation(() => new Promise((resolve) => { land = resolve; })); // the refresh, held open
  api.defaults.adapter = ((config) => (config.headers.Authorization === "Bearer a" ? reply(config, 401, { detail: "Token expired" }) : reply(config, 200, ME))) as AxiosAdapter;
  const first = mount();
  await waitFor(() => expect(land).toBeDefined()); // the start's /api/me/ got a 401, and the refresh is out
  await act(async () => { screen.getByText("out").click(); });
  await act(async () => { land!({ data: { access: "a2", refresh: "r2" } }); await new Promise((r) => setTimeout(r, 10)); });
  expect(screen.getByText("status:signed-out")).toBeInTheDocument();
  // other tabs follow what's stored, and a reload reads it: nothing is
  expect(localStorage.getItem("gst_access_token")).toBeNull();
  expect(localStorage.getItem("gst_refresh_token")).toBeNull();
  expect(localStorage.getItem("gst3.me")).toBeNull();
  first.unmount();
  mount();
  expect(screen.getByText("status:signed-out")).toBeInTheDocument();
});

function Bills() {
  const q = useQuery({ queryKey: ["bills"], queryFn: async () => (await api.get("bills/")).data as string[], staleTime: Infinity });
  return <p>bills:{q.data?.join(",") ?? "…"}</p>;
}

test("a switch refreshes what's on screen: a list that doesn't read useAuth refetches for the new person", async () => {
  setTokens("a", "r");
  api.defaults.adapter = ((config) => {
    const rakesh = config.headers.Authorization === "Bearer a";
    if (config.url === "me/") return reply(config, 200, rakesh ? ME : KAILASH);
    return reply(config, 200, rakesh ? ["KGH/31 for Rakesh"] : ["KGH/32 for Kailash"]);
  }) as AxiosAdapter;
  const client = new QueryClient();
  client.getMutationCache().build(client, { mutationFn: async () => "Rakesh's change" });
  render(<QueryClientProvider client={client}><AuthProvider><Probe /><Bills /></AuthProvider></QueryClientProvider>);
  expect(await screen.findByText("bills:KGH/31 for Rakesh")).toBeInTheDocument();
  inAnotherTab([["gst_access_token", "b"], ["gst_refresh_token", "rb"]]); // Kailash signs in in another tab
  await waitFor(() => expect(screen.getByText("who:Kailash Mehta")).toBeInTheDocument());
  expect(await screen.findByText("bills:KGH/32 for Kailash")).toBeInTheDocument();
  expect(client.getMutationCache().getAll()).toEqual([]);
});

// Ruling 35: a sign-out on purpose leaves no page behind for whoever signs in next; an expiry and a first visit keep it

/** The sign-in page and every other page behind the sign-in check, on a router the test can move. */
function mountRouted(entries: string[]) {
  const router = createMemoryRouter([
    { path: "/login", element: <><Where /><Probe /></> },
    { path: "*", element: <RequireAuth><Where /><Probe /></RequireAuth> },
  ], { initialEntries: entries, initialIndex: entries.length - 1 });
  render(<QueryClientProvider client={new QueryClient()}><AuthProvider><RouterProvider router={router} /></AuthProvider></QueryClientProvider>);
  return router;
}

test("Sign out on purpose goes to a plain sign-in page, Back included: whoever signs in next doesn't land on this person's page", async () => {
  setTokens("a", "r");
  server({ a: ME });
  const router = mountRouted(["/users", "/sales/31?tab=items"]);
  expect(await screen.findByText("who:Rakesh Soni")).toBeInTheDocument();
  await act(async () => { screen.getByText("out").click(); });
  expect(await screen.findByText("at:/login")).toBeInTheDocument();
  await act(async () => { await router.navigate(-1); }); // Back, to the page before
  await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
  expect(router.state.location.search).toBe("");
});

test("another tab signing out takes this tab to a plain sign-in page too", async () => {
  setTokens("a", "r");
  server({ a: ME });
  mountRouted(["/sales/31"]);
  expect(await screen.findByText("who:Rakesh Soni")).toBeInTheDocument();
  inAnotherTab(SIGN_OUT);
  expect(await screen.findByText("at:/login")).toBeInTheDocument();
});

test("a first visit while signed out keeps the address it came for, to go on to after signing in", async () => {
  server({});
  mountRouted(["/sales/31?tab=items"]);
  expect(await screen.findByText("at:/login?next=%2Fsales%2F31%3Ftab%3Ditems")).toBeInTheDocument();
});

test("whoever signs in after a sign-out starts afresh: when their own session runs out, sign-in brings them back to their page", async () => {
  setTokens("a", "r");
  api.defaults.adapter = ((config) => (config.url === "token/" ? reply(config, 200, { access: "b", refresh: "rb" })
    : reply(config, 200, config.headers.Authorization === "Bearer a" ? ME : KAILASH))) as AxiosAdapter;
  const router = mountRouted(["/sales/31"]);
  expect(await screen.findByText("who:Rakesh Soni")).toBeInTheDocument();
  await act(async () => { screen.getByText("out").click(); });
  expect(await screen.findByText("at:/login")).toBeInTheDocument();
  await act(async () => { screen.getByText("in").click(); }); // Kailash signs in
  expect(await screen.findByText("who:Kailash Mehta")).toBeInTheDocument();
  await act(async () => { await router.navigate("/customers/9"); });
  expect(await screen.findByText("at:/customers/9")).toBeInTheDocument();
  // later his session runs out on that page
  window.history.pushState({}, "", "/customers/9"); // the client reports the browser's address
  const refused = new AxiosError("x", "401", {} as InternalAxiosRequestConfig, null, { status: 401, data: { detail: "Token is blacklisted" }, statusText: "", headers: {}, config: {} } as never);
  vi.spyOn(axios, "post").mockRejectedValue(refused); // the refresh
  await act(async () => { await refreshAccessToken().catch(() => {}); });
  expect(await screen.findByText("at:/login?next=%2Fcustomers%2F9&reason=expired")).toBeInTheDocument();
});

test("a refresh still out at Sign out and refused afterwards doesn't turn the sign-out into a session that ran out", async () => {
  setTokens("a", "r");
  localStorage.setItem("gst3.me", JSON.stringify(REMEMBERED));
  let refuse: ((e: unknown) => void) | undefined;
  vi.spyOn(axios, "post").mockImplementation(() => new Promise((_resolve, reject) => { refuse = reject; })); // the refresh, held open
  api.defaults.adapter = ((config) => reply(config, 401, { detail: "Token expired" })) as AxiosAdapter;
  const router = mountRouted(["/users", "/sales/31"]);
  expect(screen.getByText("who:Rakesh Soni")).toBeInTheDocument(); // remembered, while the start's question is out
  await waitFor(() => expect(refuse).toBeDefined()); // its 401 sent the refresh out
  await act(async () => { screen.getByText("out").click(); });
  expect(await screen.findByText("at:/login")).toBeInTheDocument();
  window.history.pushState({}, "", "/sales/31"); // the client reports the browser's address
  const refused = new AxiosError("x", "401", {} as InternalAxiosRequestConfig, null, { status: 401, data: { detail: "Token is blacklisted" }, statusText: "", headers: {}, config: {} } as never);
  await act(async () => { refuse!(refused); await new Promise((r) => setTimeout(r, 10)); });
  await act(async () => { await router.navigate(-1); }); // Back, to the page before
  await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
  expect(router.state.location.search).toBe("");
});
