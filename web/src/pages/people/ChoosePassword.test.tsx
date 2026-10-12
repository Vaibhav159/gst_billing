import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes } from "react-router";
import { api } from "@/core/api/client";
import { AuthContext } from "@/core/auth/AuthProvider";
import { stubAuth, testQueryClient } from "@/test/render";
import { serve } from "@/test/server";
import ChoosePassword from "./ChoosePassword";

const adapter = api.defaults.adapter;
let user: ReturnType<typeof userEvent.setup>;
beforeEach(() => { user = userEvent.setup({ delay: null }); });
afterEach(() => { api.defaults.adapter = adapter; });
function mount(path = "/password") {
  const calls = serve({ "GET account/": { id: 2, username: "pooja_s", first_name: "Pooja", last_name: "Sharma", email: "", role: "staff", role_label: "Counter staff", usual_firm: null, phone: null, phone_allowed: false, sms_reset: false, must_change_password: true },
    "POST account/password/": { detail: "Password changed. Your other devices are signed out.", changed_at: "2026-10-12T14:00:00+05:30", access: "fresh", refresh: "fresh-r" } });
  const acceptPasswordChange = vi.fn(async () => {});
  const signOut = vi.fn(async () => {});
  const auth = { ...stubAuth({ username: "pooja_s", role: "staff", mustChangePassword: true }), acceptPasswordChange, signOut };
  render(<QueryClientProvider client={testQueryClient()}><AuthContext.Provider value={auth}><MemoryRouter initialEntries={[path]}><Routes>
    <Route path="/password" element={<ChoosePassword />} /><Route path="/" element={<p>Home opened</p>} /><Route path="/sales/31" element={<p>Bill 31 opened</p>} />
  </Routes></MemoryRouter></AuthContext.Provider></QueryClientProvider>);
  return { calls, acceptPasswordChange, signOut };
}
test("the mandatory page explains the gate and offers only password and sign-out", async () => {
  const { signOut } = mount();
  expect(screen.getByRole("heading", { name: "Choose your own password" })).toBeInTheDocument();
  expect(screen.getByText("Choose your own password first. The owner set this one for you.")).toBeInTheDocument();
  await screen.findByLabelText("Current password");
  expect(screen.queryByRole("link")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Sign out" }));
  expect(signOut).toHaveBeenCalledOnce();
});
async function savePassword() {
  fireEvent.change(await screen.findByLabelText("Current password"), { target: { value: "Temporary927" } });
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: "Sunrise927" } });
  fireEvent.change(screen.getByLabelText("New password again"), { target: { value: "Sunrise927" } });
  await user.click(screen.getByRole("button", { name: "Save my password" }));
}
test("after choosing a password the original safe destination opens", async () => {
  mount("/password?next=%2Fsales%2F31"); await savePassword();
  expect(await screen.findByText("Bill 31 opened")).toBeInTheDocument();
});
test.each(["//evil.example/", "/\\evil.example/", "/login", "/%70assword"])("password completion rejects unsafe or looping next %s", async (next) => {
  mount(`/password?next=${encodeURIComponent(next)}`); await savePassword();
  expect(await screen.findByText("Home opened")).toBeInTheDocument();
});
test("saving uses the owner-set password and adopts the new tokens before leaving", async () => {
  const { calls, acceptPasswordChange } = mount();
  fireEvent.change(await screen.findByLabelText("Current password"), { target: { value: "Temporary927" } });
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: "Sunrise927" } });
  fireEvent.change(screen.getByLabelText("New password again"), { target: { value: "Sunrise927" } });
  await user.click(screen.getByRole("button", { name: "Save my password" }));
  await waitFor(() => expect(acceptPasswordChange).toHaveBeenCalledWith(expect.objectContaining({ access: "fresh", refresh: "fresh-r", requestAccess: null })));
  expect(await screen.findByText("Home opened")).toBeInTheDocument();
  expect(calls.find((c) => c.method === "POST")?.data).toEqual({ current: "Temporary927", password: "Sunrise927" });
});
