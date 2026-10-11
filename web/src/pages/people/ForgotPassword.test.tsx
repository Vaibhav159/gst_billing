import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { api } from "@/core/api/client";
import { renderApp } from "@/test/render";
import { serve, type Answer } from "@/test/server";
import ForgotPassword from "./ForgotPassword";

const adapter = api.defaults.adapter;
const OFF = "Password codes by SMS aren't switched on yet. Ask the owner to set a new password for you. If you are the owner, ask the person who looks after the app.";
const SENT = "If @kailash is an owner with a mobile number saved, a 6-digit code is on its way by SMS. It works for 10 minutes.";
const DONE = "Password changed. Sign in with the new one. Every other device is signed out.";
let user: ReturnType<typeof userEvent.setup>;
beforeEach(() => { user = userEvent.setup({ delay: null }); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-12T09:00:00Z")); });
afterEach(() => { api.defaults.adapter = adapter; vi.useRealTimers(); });
function opened() { act(() => vi.setSystemTime(Date.now() + 400)); }
function mount(extra: Record<string, Answer> = {}) {
  const calls = serve({ "GET auth/options/": { sms_reset: true }, "POST auth/reset/start/": { detail: SENT }, "POST auth/reset/finish/": { detail: DONE }, ...extra });
  const close = vi.fn();
  renderApp(<ForgotPassword open onClose={close} />, { me: null });
  return { calls, close };
}
async function start() {
  await screen.findByRole("button", { name: /^The owner/ }); opened();
  await user.click(screen.getByRole("button", { name: /^The owner/ })); opened();
  fireEvent.change(screen.getByLabelText("Username"), { target: { value: "kailash" } });
  await user.click(screen.getByRole("button", { name: "Send a code" }));
  await screen.findByLabelText("Code from the SMS"); opened();
}
async function finish() {
  fireEvent.change(screen.getByLabelText("Code from the SMS"), { target: { value: "123456" } });
  fireEvent.change(screen.getByLabelText("New password"), { target: { value: "Sunrise927" } });
  fireEvent.change(screen.getByLabelText("New password again"), { target: { value: "Sunrise927" } });
  await user.click(screen.getByRole("button", { name: "Set the new password" }));
}
test("SMS off uses the exact words and offers no reset request", async () => {
  const { calls } = mount({ "GET auth/options/": { sms_reset: false } });
  expect(await screen.findByText(OFF)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Send a code" })).not.toBeInTheDocument();
  expect(calls.map((c) => c.url)).toEqual(["auth/options/"]);
});
test("failed options show a retry and never pretend SMS is off", async () => {
  mount({ "GET auth/options/": () => ({ status: 503 }) });
  expect(await screen.findByRole("button", { name: "Try again" })).toBeInTheDocument();
  expect(screen.queryByText(OFF)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Send a code" })).not.toBeInTheDocument();
});
test("staff ask the owner without sending a code", async () => {
  const { calls } = mount();
  await screen.findByRole("button", { name: /Staff, accountant or family/ }); opened();
  await user.click(screen.getByRole("button", { name: /Staff, accountant or family/ }));
  expect(screen.getByText("The owner sets a new password for you in Users and roles. Ask them; it takes a minute.")).toBeInTheDocument();
  expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
});
test("owner start remains generic, resend is explicit, finish has the contracted body", async () => {
  const { calls, close } = mount(); await start();
  expect(screen.getByText(SENT)).toBeInTheDocument();
  expect(screen.queryByText(/\+91|•/)).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Send a new code" }));
  await waitFor(() => expect(calls.filter((c) => c.url === "auth/reset/start/")).toHaveLength(2));
  await finish();
  expect(await screen.findByText(DONE)).toBeInTheDocument();
  expect(calls.find((c) => c.url === "auth/reset/finish/")?.data).toEqual({ username: "kailash", code: "123456", password: "Sunrise927" });
  expect(screen.queryByLabelText("New password")).not.toBeInTheDocument();
  opened(); await user.click(screen.getByRole("button", { name: "Back to sign in" }));
  expect(close).toHaveBeenCalledOnce();
});
test.each(["That code isn't right. 4 tries left.", "That code has run out or been used. Ask for a new one."])("server attempt error stays beside code: %s", async (words) => {
  mount({ "POST auth/reset/finish/": () => ({ status: 400, data: { code: [words] } }) }); await start(); await finish();
  expect(await screen.findByText(words)).toBeInTheDocument();
  expect(screen.getByLabelText("Code from the SMS")).toHaveAttribute("aria-invalid", "true");
  expect(screen.getByLabelText("New password")).toHaveValue("Sunrise927");
  expect(screen.getByRole("button", { name: "Send a new code" })).toBeEnabled();
});
test("a malformed code does not submit", async () => {
  const { calls } = mount(); await start();
  fireEvent.change(screen.getByLabelText("Code from the SMS"), { target: { value: "12" } });
  await user.click(screen.getByRole("button", { name: "Set the new password" }));
  expect(screen.getByText("The code has 6 digits. Check the SMS.")).toBeInTheDocument();
  expect(calls.filter((c) => c.url === "auth/reset/finish/")).toHaveLength(0);
});
test("provider failure preserves its exact useful words", async () => {
  const detail = "The SMS couldn't be sent. Try again in a few minutes, or ask the person who looks after the app.";
  mount({ "POST auth/reset/start/": () => ({ status: 503, data: { code: "sms_failed", detail } }) });
  await screen.findByRole("button", { name: /^The owner/ }); opened();
  await user.click(screen.getByRole("button", { name: /^The owner/ })); opened();
  fireEvent.change(screen.getByLabelText("Username"), { target: { value: "kailash" } });
  await user.click(screen.getByRole("button", { name: "Send a code" }));
  expect(await screen.findByText(detail)).toBeInTheDocument();
  expect(screen.getByLabelText("Username")).toHaveValue("kailash");
});
test("resend failure is visible even before a code has been typed", async () => {
  const detail = "The SMS couldn't be sent. Try again in a few minutes, or ask the person who looks after the app.";
  let starts = 0;
  mount({ "POST auth/reset/start/": () => ++starts === 1 ? { status: 200, data: { detail: SENT } } : { status: 503, data: { code: "sms_failed", detail } } });
  await start();
  await user.click(screen.getByRole("button", { name: "Send a new code" }));
  expect(await screen.findByText(detail)).toBeInTheDocument();
  expect(screen.queryByText("The code has 6 digits. Check the SMS.")).not.toBeInTheDocument();
});
test.each([
  [409, { code: "sms_off", detail: OFF }, OFF],
  [429, { detail: "Request was throttled." }, "Too many tries. Wait a minute, then try again."],
] as const)("a reset start refusal %s remains visible", async (status, data, words) => {
  mount({ "POST auth/reset/start/": () => ({ status, data }) });
  await screen.findByRole("button", { name: /^The owner/ }); opened();
  await user.click(screen.getByRole("button", { name: /^The owner/ })); opened();
  fireEvent.change(screen.getByLabelText("Username"), { target: { value: "kailash" } });
  await user.click(screen.getByRole("button", { name: "Send a code" }));
  expect(await screen.findByText(words)).toBeInTheDocument();
});
test("a server common-password refusal belongs under the password", async () => {
  const words = "The new password needs: not a common password.";
  mount({ "POST auth/reset/finish/": () => ({ status: 400, data: { password: [words] } }) }); await start(); await finish();
  expect(await screen.findByText(words)).toBeInTheDocument();
  expect(screen.getByLabelText("New password")).toHaveAttribute("aria-invalid", "true");
});
