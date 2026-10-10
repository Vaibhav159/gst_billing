import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderApp } from "@/test/render";
import { AuthContext, type AuthValue } from "@/core/auth/AuthProvider";
import { MemoryRouter, Route, Routes } from "react-router";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/core/ui";
import Login from "./Login";
// Beyond the brief: the real AuthProvider and a router the tests can watch, for sign-ins here and on another tab
import { act, waitFor } from "@testing-library/react";
import type { AxiosAdapter } from "axios";
import { createMemoryRouter, RouterProvider, useLocation } from "react-router";
import { api } from "@/core/api/client";
import { AuthProvider } from "@/core/auth/AuthProvider";

function mountWith(result: Awaited<ReturnType<AuthValue["signIn"]>>, path = "/login") {
  const auth = { me: null, status: "signed-out", startProblem: null, expiredFrom: null, signIn: vi.fn(async () => result), signOut: () => {}, retryStart: () => {}, can: () => false, whyNot: () => "" } as unknown as AuthValue;
  render(<QueryClientProvider client={new QueryClient()}><AuthContext.Provider value={auth}><ToastProvider><MemoryRouter initialEntries={[path]}>
    <Routes><Route path="/login" element={<Login />} /><Route path="/sales/31" element={<p>bill 31</p>} /><Route path="/" element={<p>home</p>} /></Routes>
  </MemoryRouter></ToastProvider></AuthContext.Provider></QueryClientProvider>);
  return auth;
}

test("the username field has focus and the page names itself", () => {
  mountWith({ ok: true });
  expect(screen.getByLabelText("Username")).toHaveFocus();
  expect(screen.getByRole("heading", { level: 1 })).toBeInTheDocument();
});

test("a wrong password says so, next to the password, and keeps the username", async () => {
  mountWith({ ok: false, problem: { kind: "auth", message: "" } });
  await userEvent.type(screen.getByLabelText("Username"), "rakesh");
  await userEvent.type(screen.getByLabelText("Password"), "nope");
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect(await screen.findByText("That username and password don't match")).toBeInTheDocument();
  expect(screen.getByLabelText("Username")).toHaveValue("rakesh");
  expect(screen.getByLabelText("Password")).toHaveFocus();
});

test("offline and server trouble are told apart", async () => {
  mountWith({ ok: false, problem: { kind: "offline", message: "" } });
  await userEvent.type(screen.getByLabelText("Username"), "a");
  await userEvent.type(screen.getByLabelText("Password"), "b");
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect(await screen.findByText("You're offline")).toBeInTheDocument();
});

test("after a long break it says why, and signing in returns to the same page", async () => {
  mountWith({ ok: true }, "/login?next=%2Fsales%2F31&reason=expired");
  expect(screen.getByText("You were signed out after a long break")).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText("Username"), "a");
  await userEvent.type(screen.getByLabelText("Password"), "b");
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect(await screen.findByText("bill 31")).toBeInTheDocument();
});

test("forgot password explains today's way", async () => {
  renderApp(<Login />, { path: "/login", me: null });
  await userEvent.click(screen.getByRole("button", { name: "Forgot your password?" }));
  expect(await screen.findByRole("dialog", { name: "Forgot your password?" })).toBeInTheDocument();
  expect(screen.getByText(/the owner/i)).toBeInTheDocument();
});

/* ── Beyond the brief ── */

const realAdapter = api.defaults.adapter;
afterEach(() => { api.defaults.adapter = realAdapter; localStorage.clear(); });

async function signInAs(username: string, password: string) {
  await userEvent.type(screen.getByLabelText("Username"), username);
  await userEvent.type(screen.getByLabelText("Password"), password);
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

const ME = { id: 7, username: "rakesh", full_name: "Rakesh Soni", role: "staff", role_label: "Counter staff", permissions: ["view", "bill.create"], needs_role_choice: false };
/** The server: token/ hands out tokens (with `hold`, only once released) and me/ says who they belong to. `asked` lists the calls. */
function server({ hold = false } = {}) {
  const s = { asked: [] as string[], release: () => {} };
  const gate = hold ? new Promise<void>((r) => { s.release = r; }) : Promise.resolve();
  api.defaults.adapter = (async (config) => {
    s.asked.push(String(config.url));
    if (config.url === "token/") await gate;
    return { status: 200, statusText: "", headers: {}, config, data: config.url === "token/" ? { access: "mine", refresh: "r-mine" } : ME };
  }) as AxiosAdapter;
  return s;
}
/** Another tab signs in: it stores its token, and this tab hears it as a storage event. */
function inAnotherTab() {
  act(() => {
    localStorage.setItem("gst_access_token", "theirs");
    window.dispatchEvent(new StorageEvent("storage", { key: "gst_access_token", oldValue: null, newValue: "theirs" }));
  });
}
/** Signed out, with the real AuthProvider, on a router the test can watch: `navigate` sees every navigation. */
function mountSignedOut(path: string) {
  const router = createMemoryRouter([
    { path: "/login", element: <Login /> }, { path: "/sales/31", element: <p>bill 31</p> }, { path: "/customers", element: <p>customers</p> }, { path: "/", element: <p>home</p> },
  ], { initialEntries: [path] });
  const navigate = vi.spyOn(router, "navigate");
  render(<QueryClientProvider client={new QueryClient()}><AuthProvider><ToastProvider><RouterProvider router={router} /></ToastProvider></AuthProvider></QueryClientProvider>);
  return { router, navigate };
}

// Task 12's hand-off: tabs share one sign-in, so this page follows a sign-in made on another tab
test("when another tab signs in, this page goes on to where it was going", async () => {
  server();
  mountSignedOut("/login?next=%2Fsales%2F31");
  await userEvent.type(screen.getByLabelText("Username"), "rak"); // half-way through signing in here
  inAnotherTab();
  expect(await screen.findByText("bill 31")).toBeInTheDocument();
});

// The review's Minors 1 and 2: the page leaves once, however many things tell it to
test("signing in here goes on exactly once, though the tab now counts as signed in too", async () => {
  server();
  const { navigate } = mountSignedOut("/login?next=%2Fsales%2F31");
  await signInAs("rakesh", "pw");
  expect(await screen.findByText("bill 31")).toBeInTheDocument();
  expect(navigate).toHaveBeenCalledTimes(1);
});

test("a sign-in here that finishes after another tab's doesn't pull the person back", async () => {
  const s = server({ hold: true });
  const { router, navigate } = mountSignedOut("/login?next=%2Fsales%2F31");
  await signInAs("rakesh", "pw"); // this tab's sign-in waits on the server
  inAnotherTab();
  expect(await screen.findByText("bill 31")).toBeInTheDocument();
  await act(async () => { await router.navigate("/customers"); }); // the person moves on
  const before = navigate.mock.calls.length;
  s.release(); // this tab's own sign-in comes back late
  await waitFor(() => expect(s.asked.filter((u) => u === "me/")).toHaveLength(2));
  await act(() => new Promise((r) => setTimeout(r, 0))); // and finishes
  expect(router.state.location.pathname).toBe("/customers");
  expect(navigate).toHaveBeenCalledTimes(before);
});

// Ruling 34: nothing on the page promises what the app can't do
test("the page promises nothing it can't keep: a plain line, and no keep-me-signed-in box", () => {
  mountWith({ ok: true });
  expect(screen.getByText("Sign in with your username and password.")).toBeInTheDocument();
  expect(screen.queryByText(/Kiran|Meera|Aarav/)).not.toBeInTheDocument();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
});

test("a next with a query string is kept whole", async () => {
  function Where() { const l = useLocation(); return <p>at:{l.pathname + l.search}</p>; }
  renderApp(<Routes><Route path="/login" element={<Login />} /><Route path="/sales" element={<Where />} /></Routes>, { path: "/login?next=%2Fsales%3Ftab%3Dtoday", me: null });
  await signInAs("a", "b");
  expect(await screen.findByText("at:/sales?tab=today")).toBeInTheDocument();
});

test("without reason=expired there's no word of a long break", () => {
  mountWith({ ok: true }, "/login?next=%2Fsales%2F31");
  expect(screen.queryByText("You were signed out after a long break")).not.toBeInTheDocument();
  expect(screen.queryByText(/Nothing you saved is affected/)).not.toBeInTheDocument();
});

// With one navigation per visit, a next back to this page would leave a signed-in person on it.
// Ruling 37: the router reads extra slashes and %-escapes as the same page, so those spellings are refused too.
test.each(["/login", "/LOGIN/?next=%2Fsales%2F31", "/login//", "/LOGIN//", "/%6Cogin", "/l%6Fgin?x=1"])("a next back to the sign-in page (%j) is ignored: signing in goes home", async (next) => {
  mountWith({ ok: true }, `/login?next=${encodeURIComponent(next)}`);
  await signInAs("a", "b");
  expect(await screen.findByText("home")).toBeInTheDocument();
});

test("a next whose %-escapes don't read goes home too", async () => {
  mountWith({ ok: true }, `/login?next=${encodeURIComponent("/sales/%E0%A4%A")}`);
  await signInAs("a", "b");
  expect(await screen.findByText("home")).toBeInTheDocument();
});

test("opened while signed in, it goes straight on to where it was going", async () => {
  renderApp(<Routes><Route path="/login" element={<Login />} /><Route path="/sales/31" element={<p>bill 31</p>} /></Routes>, { path: "/login?next=%2Fsales%2F31" });
  expect(await screen.findByText("bill 31")).toBeInTheDocument();
});

test.each(["//evil.example/x", "/\\evil.example/x", "/\t/evil.example/x", "https://evil.example/x"])("a next that leaves the app (%j) is ignored: signing in goes home", async (next) => {
  mountWith({ ok: true }, `/login?next=${encodeURIComponent(next)}`);
  await signInAs("a", "b");
  expect(await screen.findByText("home")).toBeInTheDocument();
});

test("an empty form says what's missing under the field it belongs to, and doesn't try to sign in", async () => {
  const auth = mountWith({ ok: true });
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect(screen.getByLabelText("Username")).toHaveAccessibleDescription("Enter your username and password.");
  expect(screen.getByLabelText("Username")).toHaveFocus();
  await userEvent.type(screen.getByLabelText("Username"), "rakesh");
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect(screen.getByLabelText("Password")).toHaveAccessibleDescription("Enter your password.");
  expect(screen.getByLabelText("Password")).toHaveFocus();
  expect(auth.signIn).not.toHaveBeenCalled();
});

test.each([
  ["throttled", "Too many tries", "Wait a minute, then try again."],
  ["unreachable", "The app couldn't get through", "It's probably restarting after an update. Wait a minute and try again."],
  ["server", "The app couldn't get through", "It's probably restarting after an update. Wait a minute and try again."],
] as const)("a %s problem reads: %s", async (kind, title, text) => {
  mountWith({ ok: false, problem: { kind, message: "" } });
  await signInAs("a", "b");
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent(title);
  expect(alert).toHaveTextContent(text);
});
