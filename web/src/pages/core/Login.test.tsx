import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderApp } from "@/test/render";
import { AuthContext, type AuthValue } from "@/core/auth/AuthProvider";
import { MemoryRouter, Route, Routes } from "react-router";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ToastProvider } from "@/core/ui";
import Login from "./Login";
// Beyond the brief: the real AuthProvider, for another tab's sign-in
import { act } from "@testing-library/react";
import type { AxiosAdapter } from "axios";
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

async function signInAs(username: string, password: string) {
  await userEvent.type(screen.getByLabelText("Username"), username);
  await userEvent.type(screen.getByLabelText("Password"), password);
  await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

// Task 12's hand-off: tabs share one sign-in, so this page follows a sign-in made on another tab
test("when another tab signs in, this page goes on to where it was going", async () => {
  localStorage.clear();
  const before = api.defaults.adapter;
  const ME = { id: 7, username: "rakesh", full_name: "Rakesh Soni", role: "staff", role_label: "Counter staff", permissions: ["view", "bill.create"], needs_role_choice: false };
  api.defaults.adapter = ((config) => Promise.resolve({ status: 200, statusText: "", headers: {}, config, data: ME })) as AxiosAdapter;
  try {
    render(<QueryClientProvider client={new QueryClient()}><AuthProvider><ToastProvider><MemoryRouter initialEntries={["/login?next=%2Fsales%2F31"]}>
      <Routes><Route path="/login" element={<Login />} /><Route path="/sales/31" element={<p>bill 31</p>} /><Route path="/" element={<p>home</p>} /></Routes>
    </MemoryRouter></ToastProvider></AuthProvider></QueryClientProvider>);
    await userEvent.type(screen.getByLabelText("Username"), "rak"); // half-way through signing in here
    act(() => {
      localStorage.setItem("gst_access_token", "from-the-other-tab");
      window.dispatchEvent(new StorageEvent("storage", { key: "gst_access_token", oldValue: null, newValue: "from-the-other-tab" }));
    });
    expect(await screen.findByText("bill 31")).toBeInTheDocument();
  } finally {
    api.defaults.adapter = before;
    localStorage.clear();
  }
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
