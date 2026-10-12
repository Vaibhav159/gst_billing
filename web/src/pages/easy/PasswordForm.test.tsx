import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { AxiosAdapter } from "axios";
import { MemoryRouter } from "react-router";
import { api, clearTokens, getTokens, setTokens } from "@/core/api/client";
import { AuthProvider, useAuth } from "@/core/auth/AuthProvider";
import { testQueryClient } from "@/test/render";
import { serve, type Answer } from "@/test/server";
import { EasyPasswordForm } from "./PasswordForm";

const identity = { username: "kailash", first_name: "Kailash", last_name: "Mehta" };
const me = { id: 1, username: "kailash", full_name: "Kailash Mehta", role: "owner", role_label: "Owner", permissions: "*", needs_role_choice: false, must_change_password: false, session_id: "synthetic-session" };
const answer = { detail: "Password changed. Your other devices are signed out.", changed_at: "2026-10-08T16:52:00+05:30", access: "new-access", refresh: "new-refresh" };
function Status() { const auth = useAuth(); return <span aria-label="Authentication">{auth.status}</span>; }
async function mount(passwordAnswer: Answer = answer) {
  setTokens("old-access", "old-refresh");
  const calls = serve({ "GET me/": me, "POST account/password/": passwordAnswer, "GET account/": identity });
  const onDirty = vi.fn();
  const view = render(<QueryClientProvider client={testQueryClient()}><AuthProvider><MemoryRouter initialEntries={["/e/profile"]}>
    <Status /><EasyPasswordForm person={identity} onDirty={onDirty} />
  </MemoryRouter></AuthProvider></QueryClientProvider>);
  await waitFor(() => expect(screen.getByLabelText("Authentication")).toHaveTextContent("signed-in"));
  return { ...view, calls, onDirty };
}
function fill(again = "Quartz7!moon") {
  fireEvent.change(screen.getByLabelText("Current password"), { target: { value: "Old8!phrase" } });
  fireEvent.change(screen.getByLabelText("New password", { exact: true }), { target: { value: "Quartz7!moon" } });
  fireEvent.change(screen.getByLabelText("New password again"), { target: { value: again } });
}
function submit() { fireEvent.click(screen.getByRole("button", { name: "Change password" })); }
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); clearTokens(); });
afterEach(() => { cleanup(); clearTokens(); vi.restoreAllMocks(); });

test("Easy adopts both returned tokens, uses changed_at and authenticates the next request", async () => {
  const { calls, onDirty } = await mount(); fill(); submit();
  expect(await screen.findByRole("status")).toHaveTextContent("Password changed. Your other devices are signed out.");
  expect(screen.getByText("16:52")).toHaveAttribute("datetime", answer.changed_at);
  expect(getTokens()).toEqual({ access: "new-access", refresh: "new-refresh" });
  let nextAuthorization = "";
  const adapter = api.defaults.adapter as AxiosAdapter;
  api.defaults.adapter = async (config) => { nextAuthorization = String(config.headers.Authorization); return adapter(config); };
  try { await api.get("account/"); } finally { api.defaults.adapter = adapter; }
  expect(nextAuthorization).toBe("Bearer new-access");
  expect(calls.filter((call) => call.method === "POST").map((call) => call.data)).toEqual([{ current: "Old8!phrase", password: "Quartz7!moon" }]);
  expect(screen.getByLabelText("Current password")).toHaveValue(""); expect(onDirty).toHaveBeenLastCalledWith(false);
});
test("wrong current password keeps the inputs and points to the server's exact field words", async () => {
  await mount(() => ({ status: 400, data: { current: ["That isn't your current password. Check Caps Lock and try again."] } })); fill(); submit();
  expect(await screen.findByText("That isn't your current password. Check Caps Lock and try again.")).toBeVisible();
  expect(screen.getByLabelText("Current password")).toHaveValue("Old8!phrase"); expect(screen.getByLabelText("Current password")).toHaveFocus();
  expect(getTokens().access).toBe("old-access");
});
test("the common-password rule remains a server check and its refusal stays under the new password", async () => {
  await mount(() => ({ status: 400, data: { password: ["The new password needs: not a common password."] } })); fill();
  expect(screen.getByText("Not a common password · checked when saved")).toBeVisible(); submit();
  expect(await screen.findByText("The new password needs: not a common password.")).toBeVisible();
  expect(screen.getByLabelText("New password", { exact: true })).toHaveValue("Quartz7!moon");
});
test("mismatched confirmation prevents a request and focuses confirmation", async () => {
  const { calls } = await mount(); fill("Quartz7!sun"); submit();
  expect(screen.getByText("The two new passwords don't match. Type it again carefully.")).toBeVisible();
  expect(screen.getByLabelText("New password again")).toHaveFocus(); expect(calls.filter((call) => call.method === "POST")).toEqual([]);
});
test("offline keeps the old password and the exact Easy words, without a queued mutation", async () => {
  const { calls } = await mount(); fill(); vi.spyOn(navigator, "onLine", "get").mockReturnValue(false); submit();
  expect(screen.getByRole("alert")).toHaveTextContent("Not changed yet: you're offline. Your old password still works.");
  expect(calls.filter((call) => call.method === "POST")).toEqual([]); expect(screen.getByLabelText("Current password")).toHaveValue("Old8!phrase");
});
test("two submits while the answer is pending change the password only once", async () => {
  let finish!: (reply: { status: number; data: unknown }) => void;
  const { calls } = await mount(() => new Promise((resolve) => { finish = resolve; })); fill();
  const form = screen.getByLabelText("Current password").closest("form")!;
  fireEvent.submit(form); fireEvent.submit(form);
  await waitFor(() => expect(finish).toBeDefined()); expect(calls.filter((call) => call.method === "POST")).toHaveLength(1);
  await act(async () => { finish({ status: 200, data: answer }); });
  expect(await screen.findByRole("status")).toHaveTextContent("Your other devices are signed out.");
});

test("a completed password change preserves a newer session and clears the saved passwords", async () => {
  let finish!: (reply: { status: number; data: unknown }) => void;
  const { onDirty } = await mount(() => new Promise((resolve) => { finish = resolve; }));
  fill(); submit();
  await waitFor(() => expect(finish).toBeDefined());
  setTokens("another-session-access", "another-session-refresh");
  await act(async () => { finish({ status: 200, data: answer }); });
  expect(await screen.findByRole("status")).toHaveTextContent("This tab signed in differently while the password was saving. If you are asked to sign in, use your new password.");
  expect(screen.getByText("16:52")).toHaveAttribute("datetime", answer.changed_at);
  expect(getTokens()).toEqual({ access: "another-session-access", refresh: "another-session-refresh" });
  expect(screen.getByLabelText("Current password")).toHaveValue("");
  expect(screen.getByLabelText("New password", { exact: true })).toHaveValue("");
  expect(screen.getByLabelText("New password again")).toHaveValue("");
  expect(onDirty).toHaveBeenLastCalledWith(false);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
