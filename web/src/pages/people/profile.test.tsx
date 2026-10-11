import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, MemoryRouter, RouterProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { AuthContext, PasswordChangedElsewhere } from "@/core/auth/AuthProvider";
import type { Role } from "@/core/auth/role";
import { stubAuth, testQueryClient } from "@/test/render";
import { serve, type Answer, type Call, type Reply } from "@/test/server";
import Profile from "./Profile";
import { ChangePasswordForm, newPasswordValid, passwordError } from "./PasswordFields";

const profile = { id: 1, username: "kailash", first_name: "Kailash", last_name: "Mehta", email: "", role: "owner", role_label: "Owner", usual_firm: null, phone: "9829017210", phone_allowed: true, sms_reset: false, must_change_password: false };
const current = { id: "this", device: "Chrome on Windows", created_at: "2026-10-08T10:00:00+05:30", last_used_at: "2026-10-08T16:52:00+05:30", current: true };
const other = { ...current, id: "other", device: "Safari on Mac", current: false };
function mount(extra: Record<string, Answer> = {}, role: Role = "owner") {
  const calls = serve({ "GET account/": { ...profile, role, phone_allowed: role === "owner", phone: role === "owner" ? profile.phone : null }, "GET account/sessions/": { results: [current, other] }, ...extra });
  const auth = { ...stubAuth({ role }), acceptPasswordChange: vi.fn(async () => {}), refreshMe: vi.fn(async () => {}) };
  const router = createMemoryRouter([{ path: "/profile", element: <Profile /> }, { path: "/settings", element: <h1>Settings destination</h1> }], { initialEntries: ["/profile"] });
  render(<QueryClientProvider client={testQueryClient()}><AuthContext.Provider value={auth}><RouterProvider router={router} /></AuthContext.Provider></QueryClientProvider>);
  return { calls, auth, router };
}
function set(label: string | RegExp, value: string) { fireEvent.change(screen.getByLabelText(label), { target: { value } }); }
async function fillPassword() {
  await screen.findByLabelText("Current password");
  set("Current password", "Old8!phrase"); set("New password", "Quartz7!moon"); set("New password again", "Quartz7!moon");
}

describe("shared password rules", () => {
  it("requires length, letters and a digit without pretending to check the common list", () => {
    expect(passwordError("short", profile, true)).toBe("The new password needs: at least 8 characters; letters and at least one number.");
    expect(newPasswordValid("password1", "password1", profile, true)).toBe(true);
  });
  it("rejects each known name case-insensitively, repeats and unchanged passwords", () => {
    expect(passwordError("MEHTA837!", profile, true)).toBe("The new password needs: not your name or username.");
    expect(passwordError("Quartz7!moon", profile, true, "Quartz7!moon")).toBe("The new password needs: different from your current password.");
    expect(newPasswordValid("Quartz7!moon", "wrong", profile)).toBe(false);
    expect(newPasswordValid("Quartz7!moon", "Quartz7!moon", { username: "ab", first_name: "Q", last_name: "Mo" })).toBe(true);
    expect(passwordError("Pooja123", { username: "pooja_s", first_name: " Pooja ", last_name: "" })).toBe("It needs: not the person's name or username.");
  });
});

describe("profile and signed-in devices", () => {
  it.each<Role>(["owner", "accountant", "staff", "viewer"])("lets %s edit their own profile and limits the phone field to owners", async (role) => {
    mount({}, role);
    expect(await screen.findByLabelText(/First name/)).toHaveValue("Kailash");
    expect(screen.getByLabelText("Username")).toBeDisabled();
    expect(Boolean(screen.queryByLabelText("Mobile number"))).toBe(role === "owner");
    if (role === "owner") expect(screen.getByText("Codes are sent once SMS is switched on")).toBeInTheDocument();
  });
  it("saves only editable details, preserves focus and acknowledges the save", async () => {
    const { calls, auth } = mount({ "PATCH account/": ({ data }: Call) => ({ status: 200, data: { ...profile, ...(data as object) } }) });
    await screen.findByLabelText(/First name/);
    set(/First name/, "  Kailash Kumar  "); set("Email", "owner@example.com"); set("Mobile number", "98290 17211");
    screen.getByLabelText("Email").focus();
    fireEvent.click(screen.getByRole("button", { name: "Save details" }));
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(calls.find((c) => c.method === "PATCH")?.data).toEqual({ first_name: "Kailash Kumar", last_name: "Mehta", email: "owner@example.com", phone: "9829017211" });
    expect(auth.refreshMe).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Email")).toHaveFocus();
  });
  it("does not call a completed detail save a failure when refreshing the header loses its connection", async () => {
    const { auth } = mount({ "PATCH account/": ({ data }: Call) => ({ status: 200, data: { ...profile, ...(data as object) } }) });
    auth.refreshMe.mockRejectedValueOnce(new Error("connection lost"));
    await screen.findByLabelText(/First name/); set("Email", "owner@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Save details" }));
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(screen.queryByText(/Not saved/)).not.toBeInTheDocument();
    expect(screen.getByText("Details saved. Your name in the app couldn't refresh; reload when the connection is back.")).toBeInTheDocument();
  });
  it("validates an owner's mobile number without truncating a mistyped number", async () => {
    const { calls } = mount(); await screen.findByLabelText("Mobile number");
    set("Mobile number", "98290172109"); fireEvent.click(screen.getByRole("button", { name: "Save details" }));
    expect(screen.getByText("A mobile number has 10 digits; this has 11.")).toBeInTheDocument();
    expect(screen.getByLabelText("Mobile number")).toHaveValue("98290172109");
    expect(calls.some((call) => call.method === "PATCH")).toBe(false);
  });
  it("omits phone in another role's payload", async () => {
    const { calls } = mount({ "PATCH account/": profile }, "viewer");
    await screen.findByLabelText(/First name/); set("Email", "viewer@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Save details" }));
    await screen.findByText("Saved");
    expect(calls.find((c) => c.method === "PATCH")?.data).not.toHaveProperty("phone");
  });
  it("focuses validation and keeps a rejected save's values available to retry", async () => {
    const { calls } = mount({ "PATCH account/": () => ({ status: 0 }) });
    await screen.findByLabelText(/First name/); set(/First name/, "");
    fireEvent.click(screen.getByRole("button", { name: "Save details" }));
    expect(screen.getByText("Enter your first name. It shows in the Audit log next to your changes.")).toBeInTheDocument();
    expect(screen.getByLabelText(/First name/)).toHaveFocus();
    expect(calls.some((c) => c.method === "PATCH")).toBe(false);
    set(/First name/, "Edited"); fireEvent.click(screen.getByRole("button", { name: "Save details" }));
    expect(await screen.findByText("Not saved: the app couldn't get through")).toBeInTheDocument();
    expect(screen.getByLabelText(/First name/)).toHaveValue("Edited");
  });
  it("shows real device descriptions, confirms revocation and removes the row only after success", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    let revoked = false;
    const { calls } = mount({ "POST account/sessions/other/sign-out/": () => { revoked = true; return { status: 204 }; }, "GET account/sessions/": () => ({ status: 200, data: { results: revoked ? [current] : [current, other] } }) });
    await screen.findByText("Safari on Mac");
    expect(screen.getByText("This device")).toBeInTheDocument();
    expect(screen.queryByText(/Udaipur|Shop desktop/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Sign out on Safari on Mac" }));
    const dialog = screen.getByRole("dialog", { name: "Sign out on Safari on Mac?" });
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
    vi.setSystemTime(Date.now() + 400);
    fireEvent.click(within(dialog).getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(calls.some((c) => c.url === "account/sessions/other/sign-out/")).toBe(true));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Sign out on Safari on Mac" })).not.toBeInTheDocument());
    vi.useRealTimers();
  });
  it("keeps the device and confirmation when revocation fails", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    mount({ "POST account/sessions/other/sign-out/": () => ({ status: 0 }) });
    fireEvent.click(await screen.findByRole("button", { name: "Sign out on Safari on Mac" }));
    const dialog = screen.getByRole("dialog", { name: "Sign out on Safari on Mac?" });
    vi.setSystemTime(Date.now() + 400); fireEvent.click(within(dialog).getByRole("button", { name: "Sign out" }));
    expect(await screen.findByText("Not signed out")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out on Safari on Mac" })).toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "Sign out on Safari on Mac?" })).toBeInTheDocument();
    vi.useRealTimers();
  });
  it("signs out all other devices through the dedicated endpoint", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { calls } = mount({ "GET account/sessions/": { results: [current, other, { ...other, id: "third", device: "Firefox on Linux" }] }, "POST account/sessions/sign-out-others/": { signed_out: 2 } });
    fireEvent.click(await screen.findByRole("button", { name: "Sign out all others" }));
    vi.setSystemTime(Date.now() + 400);
    fireEvent.click(screen.getByRole("button", { name: "Sign out 2 devices" }));
    await waitFor(() => expect(calls.some((c) => c.url === "account/sessions/sign-out-others/")).toBe(true));
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
    vi.useRealTimers();
  });
  it("keeps edited details behind the unsaved navigation guard", async () => {
    const { router } = mount();
    await screen.findByLabelText(/First name/); set("Last name", "Changed");
    await act(async () => { await router.navigate("/settings"); });
    expect(screen.getByRole("dialog", { name: "Leave without saving?" })).toBeInTheDocument();
    expect(screen.getByLabelText("Last name")).toHaveValue("Changed");
  });
});

describe("own password", () => {
  it("does not navigate a later user's screen after an unmounted forced form finishes", async () => {
    let finish: (reply: Reply) => void = () => {};
    const calls = serve({ "POST account/password/": () => new Promise<Reply>((resolve) => { finish = resolve; }) });
    const changed = vi.fn();
    const auth = { ...stubAuth(), acceptPasswordChange: vi.fn(async () => {}) };
    const view = render(<QueryClientProvider client={testQueryClient()}><AuthContext.Provider value={auth}><MemoryRouter><ChangePasswordForm person={profile} forced onChanged={changed} /></MemoryRouter></AuthContext.Provider></QueryClientProvider>);
    await fillPassword(); fireEvent.click(screen.getByRole("button", { name: "Save my password" }));
    await waitFor(() => expect(calls).toHaveLength(1)); view.unmount();
    await act(async () => { finish({ status: 200, data: { detail: "Password changed. Your other devices are signed out.", changed_at: "2026-10-08T16:52:00+05:30", access: "new-access", refresh: "new-refresh" } }); });
    expect(changed).not.toHaveBeenCalled();
  });
  it("installs both rotated tokens before clearing fields, announcing the server outcome", async () => {
    const answer = { detail: "Password changed. Your other devices are signed out.", changed_at: "2026-10-08T16:52:00+05:30", access: "new-access", refresh: "new-refresh" };
    const { calls, auth } = mount({ "POST account/password/": answer });
    await fillPassword();
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
    expect(await screen.findByText(answer.detail)).toBeInTheDocument();
    expect(screen.getByText("Password changed at 16:52")).toBeInTheDocument();
    expect(auth.acceptPasswordChange).toHaveBeenCalledWith(expect.objectContaining({ access: answer.access, refresh: answer.refresh }));
    expect(screen.getByLabelText("Current password")).toHaveValue("");
    expect(calls.find((c) => c.url === "account/password/")?.data).toEqual({ current: "Old8!phrase", password: "Quartz7!moon" });
  });
  it("says the password changed but this tab is signed in differently, and never offers to resend the old password", async () => {
    const answer = { detail: "Password changed. Your other devices are signed out.", changed_at: "2026-10-08T16:52:00+05:30", access: "new-access", refresh: "new-refresh" };
    const { auth } = mount({ "POST account/password/": answer });
    auth.acceptPasswordChange.mockRejectedValue(new PasswordChangedElsewhere("signed in differently"));
    await fillPassword();
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
    expect(await screen.findByText(/This tab signed in differently while the password was saving/)).toBeInTheDocument();
    expect(screen.getByText("Password changed at 16:52")).toBeInTheDocument();
    expect(screen.getByLabelText("Current password")).toHaveValue("");
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
  });
  it("shows the server's current and common-password errors under the correct fields without losing input", async () => {
    mount({ "POST account/password/": () => ({ status: 400, data: { current: ["That isn't your current password. Check Caps Lock and try again."], password: ["The new password needs: not a common password."] } }) });
    await fillPassword();
    expect(screen.getByText(/Not a common password/)).toHaveTextContent("checked when saved");
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
    expect(await screen.findByText("That isn't your current password. Check Caps Lock and try again.")).toBeInTheDocument();
    expect(screen.getByLabelText("Current password")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("New password")).toHaveValue("Quartz7!moon");
    expect(screen.getByText("The new password needs: not a common password.")).toBeInTheDocument();
  });
  it("never submits mismatched passwords and toggles visibility accessibly", async () => {
    const { calls } = mount(); await fillPassword(); set("New password again", "Quartz7!moooon");
    fireEvent.click(screen.getByRole("button", { name: "Change password" }));
    expect(screen.getByText("The two new passwords don't match. Type it again carefully.")).toBeInTheDocument();
    expect(calls.some((c) => c.url === "account/password/")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Show passwords" }));
    expect(screen.getByRole("button", { name: "Hide passwords" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("New password")).toHaveAttribute("type", "text");
    expect(screen.getByLabelText("Current password")).toHaveAttribute("type", "text");
  });
});
