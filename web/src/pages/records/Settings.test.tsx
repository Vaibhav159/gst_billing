import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import Settings from "./Settings";
import { messageLength, messageProblem } from "./settingsModel";
import { mount, VIEWER } from "@/pages/customers/testing";
import { serve, type Answer, type Call, type Reply } from "@/test/server";
import permissions from "@/core/auth/perms.json";
import type { Action } from "@/core/auth/permissions";
import { DEFAULT_SHARE_MESSAGE } from "@/core/sales/share";
import { MORE_NAV } from "@/core/shell/nav";
import { formServer, mountForm } from "@/pages/sales/form/testing";

const FIRMS = [
  { id: 3, name: "KIRAN GOLD HOUSE", short: "Kiran", short_name: "", gst_number: "08VRHFA2322D1ZI", state_code: "08", state_name: "RAJASTHAN", invoice_prefix: "KGH", city: "Udaipur", paper_full_number_from: null, numbers: { fy: "2026-27", last: null, next: { counter: 34, invoice_number: "KGH/2026-27/34" }, full_number: false } },
  { id: 4, name: "MEERA ORNAMENTS", short: "Meera", short_name: "Meera", gst_number: "08AAMFR5567K1ZG", state_code: "08", state_name: "RAJASTHAN", invoice_prefix: "MO", city: "Udaipur", paper_full_number_from: "2027-04-01", numbers: { fy: "2026-27", last: null, next: { counter: 9, invoice_number: "MO/2026-27/9" }, full_number: false } },
];
const SETUP = { firms: { count: 2, names: FIRMS.map((firm) => firm.name) }, customers: { count: 1, names: ["Anil"] }, products: { count: 1, names: ["Gold"] }, bills: { count: 1, cancelled: 0 }, people: 1, last_backup_at: null };
function server({ fail = false, prefs = {} as Record<string, unknown>, last = null as import("@/core/sales/types").BillRef | null, filed = { months: ["2025-04"], count: 1 } as Answer } = {}) {
  let settings = { copies: "original", show_bank: true, share_message: DEFAULT_SHARE_MESSAGE, updated_at: null, updated_by: null, default_business: 3, default_business_name: FIRMS[0].name, warnings: [] };
  let preferences = { ...prefs };
  return serve({
    "GET firms/": { results: FIRMS.map((firm, i) => i ? firm : { ...firm, numbers: { ...firm.numbers, last } }) }, "GET preferences/": { data: preferences }, "GET setup/": SETUP, "GET shop-settings/": settings,
    "PUT shop-settings/": ({ data }: Call) => { if (fail) return { status: 0 }; settings = { ...settings, ...(data as object) }; return { status: 200, data: settings }; },
    "PATCH preferences/": ({ data }: Call) => { if (fail) return { status: 0 }; preferences = { ...preferences, ...(data as object) }; return { status: 200, data: { data: preferences } }; },
    "POST gst/months/filed-before/": filed,
  });
}
function mountSettings(me = {} as Parameters<typeof mount>[2]) {
  return mount([{ path: "/settings", element: <Settings /> }, { path: "/setup", element: <p>Setup route</p> }], ["/settings"], me);
}
beforeEach(() => { localStorage.clear(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-08T10:00:00+05:30")); });
afterEach(() => vi.useRealTimers());

test("message validation keeps 500 characters, every placeholder and the nonblocking number warning", () => {
  expect(messageProblem("{number}" + "x".repeat(492))).toEqual({});
  expect(messageProblem("{number}" + "x".repeat(493))).toEqual({ error: "Keep the message to 500 characters." });
  // the server counts characters as Python does, so an emoji is one, not two
  expect(messageProblem("{number}" + "🙏".repeat(492))).toEqual({});
  expect(messageLength("🙏 {number}")).toBe(10);
  expect(messageProblem("{customer} {number} {total} {firm} {date}")).toEqual({});
  expect(messageProblem("{bad} {oops}")).toEqual({ error: "{bad}, {oops} aren't something the app can fill in. Use {customer}, {number}, {total}, {firm} or {date}." });
  expect(messageProblem("Hello {customer")).toEqual({ error: "A brace is left open. Each placeholder needs { and }." });
  expect(messageProblem("Hello")).toEqual({ warning: "Customers find bills by number. Consider adding {number}." });
});
test("every role can open Settings; a viewer changes their own preference but cannot write shop rows", async () => {
  const calls = server();
  mountSettings({ me: VIEWER });
  const own = await screen.findByLabelText("Your default firm");
  expect(own).toBeEnabled();
  expect(screen.getByLabelText("The shop's default firm")).toBeDisabled();
  expect(screen.getByLabelText("Copies to print")).toBeDisabled();
  expect(screen.getByRole("switch", { name: "Bank details on bills" })).toBeDisabled();
  expect(MORE_NAV.find((item) => item.to === "/settings")?.need).toBeUndefined();
  fireEvent.change(own, { target: { value: "4" } });
  await waitFor(() => expect(calls.some((call) => call.method === "PATCH" && JSON.stringify(call.data) === '{"defaultBusinessId":"4"}')).toBe(true));
  expect(calls.some((call) => call.method === "PUT")).toBe(false);
});
test("all four print copies save and message preview fills the same placeholders as sending", async () => {
  const calls = server();
  mountSettings();
  const copies = await screen.findByLabelText("Copies to print");
  expect(within(copies).getAllByRole("option").map((option) => option.textContent)).toEqual(["Original", "Duplicate", "Triplicate", "All three"]);
  fireEvent.change(copies, { target: { value: "triplicate" } });
  await waitFor(() => expect(calls.some((call) => call.method === "PUT" && JSON.stringify(call.data) === '{"copies":"triplicate"}')).toBe(true));
  fireEvent.change(screen.getByLabelText("WhatsApp message with each bill"), { target: { value: "{customer} {number} {total} {firm} {date}" } });
  expect(screen.getByText(/Anil Gupta KGH\/2026-27\/34 ₹1,234.56 KIRAN GOLD HOUSE/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open GST settings" })).toHaveAttribute("href", "/gst?tab=credit&firm=3#opening");
});
test("failed choices stay on their row and this person's device across reload; retry sends only that row", async () => {
  server({ fail: true });
  const view = mountSettings();
  fireEvent.change(await screen.findByLabelText("The shop's default firm"), { target: { value: "4" } });
  await screen.findByText(/Not saved yet/);
  expect(screen.getByText(/Your new bills start with the shop's default, KIRAN GOLD HOUSE/)).toBeInTheDocument();
  view.unmount(); view.router.dispose();
  const calls = server();
  mountSettings();
  expect(await screen.findByLabelText("The shop's default firm")).toHaveValue("4");
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(screen.queryByText(/Not saved yet/)).not.toBeInTheDocument());
  expect(calls.filter((call) => call.method === "PUT").map((call) => call.data)).toEqual([{ default_business: 4 }]);
  expect(await screen.findByText(/Your new bills start with the shop's default, MEERA ORNAMENTS/)).toBeInTheDocument();
});
test("reset sends exact nulls, clears personal pending choices, and leaves the theme and pending shop rows", async () => {
  localStorage.setItem("gst3.theme", "pearl");
  localStorage.setItem("gst3.pending-settings.1", JSON.stringify({ myFirm: { scope: "me", patch: { defaultBusinessId: "4" } }, copies: { scope: "shop", patch: { copies: "all" } } }));
  const calls = server({ prefs: { defaultBusinessId: "4", phoneMode: "expert", setup: { dismissed: true, skipped: ["product"] } } });
  mountSettings();
  fireEvent.click(await screen.findByRole("button", { name: "Reset my preferences" }));
  const dialog = await screen.findByRole("dialog", { name: "Reset your preferences?" });
  act(() => vi.setSystemTime(Date.now() + 400));
  fireEvent.click(within(dialog).getByRole("button", { name: "Reset my preferences" }));
  await waitFor(() => expect(calls.some((call) => call.method === "PATCH" && JSON.stringify(call.data) === '{"defaultBusinessId":null,"phoneMode":null,"setup":null}')).toBe(true));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(JSON.parse(localStorage.getItem("gst3.pending-settings.1") ?? "{}")).toEqual({ copies: { scope: "shop", patch: { copies: "all" } } });
  expect(localStorage.getItem("gst3.theme")).toBe("pearl");
});
test("pending choices never leak into another person's Settings", async () => {
  localStorage.setItem("gst3.pending-settings.2", JSON.stringify({ myFirm: { scope: "me", patch: { defaultBusinessId: "4" } } }));
  server();
  mountSettings();
  expect(await screen.findByLabelText("Your default firm")).toHaveValue("");
  expect(screen.queryByText(/Not saved yet/)).not.toBeInTheDocument();
});
test("an All firms list still opens a new bill under the person's default, before the shop's", async () => {
  localStorage.setItem("gst3.scope.1", "all");
  const { calls } = formServer([
    ["GET", "firms/", () => ({ results: FIRMS })],
    ["GET", "preferences/", () => ({ data: { defaultBusinessId: "4" } })],
    ["GET", "shop-settings/", () => ({ copies: "original", show_bank: true, share_message: DEFAULT_SHARE_MESSAGE, updated_at: null, updated_by: null, default_business: 3, default_business_name: FIRMS[0].name })],
  ]);
  mountForm("/sales/new");
  await screen.findByRole("combobox", { name: /Customer/ });
  await waitFor(() => expect(calls.find((call) => call.url === "sales/next-number/")?.params.business_id).toBe(4));
  expect(screen.getByText("Your default firm, from Settings")).toBeInTheDocument();
});

test("late personal-row responses preserve the other row's saved preference", async () => {
  let release: ((reply: { status: number; data: unknown }) => void) | undefined;
  serve({
    "GET firms/": { results: FIRMS }, "GET preferences/": { data: {} }, "GET setup/": SETUP,
    "GET shop-settings/": { copies: "original", show_bank: true, share_message: DEFAULT_SHARE_MESSAGE, default_business: 3 },
    "PATCH preferences/": ({ data }: Call) => "defaultBusinessId" in (data as object) ? new Promise((resolve) => { release = resolve; }) : { status: 200, data: { data: { defaultBusinessId: "4", phoneMode: "expert" } } },
  });
  mountSettings();
  fireEvent.change(await screen.findByLabelText("Your default firm"), { target: { value: "4" } });
  await waitFor(() => expect(release).toBeDefined());
  fireEvent.click(screen.getByRole("radio", { name: /^Expert/ }));
  await waitFor(() => expect(screen.getByText("Saved")).toBeInTheDocument());
  await act(async () => release?.({ status: 200, data: { data: { defaultBusinessId: "4" } } }));
  expect(screen.getByRole("radio", { name: /^Expert/ })).toHaveAttribute("aria-checked", "true");
  expect(screen.getByLabelText("Your default firm")).toHaveValue("4");
});

test("retrying a kept reset clears personal pending rows", async () => {
  localStorage.setItem("gst3.pending-settings.1", JSON.stringify({ reset: { scope: "me", patch: { defaultBusinessId: null, phoneMode: null, setup: null } }, myFirm: { scope: "me", patch: { defaultBusinessId: "4" } } }));
  server({ prefs: { defaultBusinessId: "4" } }); mountSettings();
  await screen.findByLabelText("Your default firm");
  const row = screen.getAllByText("Reset my preferences")[0].closest(".border-t")!;
  fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(JSON.parse(localStorage.getItem("gst3.pending-settings.1") ?? "{}")).toEqual({}));
  expect(await screen.findByLabelText("Your default firm")).toHaveValue("");
});
test("a nonowner cannot retry a kept shop write", async () => {
  localStorage.setItem("gst3.pending-settings.1", JSON.stringify({ copies: { scope: "shop", patch: { copies: "all" } } }));
  server(); mountSettings({ me: VIEWER });
  await screen.findByLabelText("Copies to print");
  expect(screen.getByRole("button", { name: "Try again" })).toBeDisabled();
});
test("a late preferences read cannot roll a successful personal save back", async () => {
  localStorage.setItem("gst3.prefs.1", JSON.stringify({ phoneMode: "easy" }));
  let release: ((reply: { status: number; data: unknown }) => void) | undefined;
  serve({
    "GET firms/": { results: FIRMS }, "GET setup/": SETUP,
    "GET shop-settings/": { copies: "original", show_bank: true, share_message: DEFAULT_SHARE_MESSAGE },
    "GET preferences/": () => new Promise((resolve) => { release = resolve; }),
    "PATCH preferences/": { data: { phoneMode: "expert" } },
  });
  mountSettings(); await screen.findByLabelText("Your default firm");
  fireEvent.click(screen.getByRole("radio", { name: /^Expert/ }));
  await screen.findByText("Saved");
  await act(async () => release?.({ status: 200, data: { data: { phoneMode: "easy" } } }));
  expect(screen.getByRole("radio", { name: /^Expert/ })).toHaveAttribute("aria-checked", "true");
});

test.each([[false, false], [false, true], [true, false], [true, true]])("deleted numbering reference (phone %s, viewer %s)", async (phone, viewer) => {
  (window as unknown as { __phone: boolean }).__phone = phone;
  server({ last: { id: 205, invoice_number: "KGH/2026-27/33", invoice_date: "2026-10-01", customer_name: "Anil", status: "deleted" } });
  mountSettings(viewer ? { me: VIEWER } : {});
  expect(await screen.findByText("Deleted")).toBeInTheDocument();
  if (viewer) expect(screen.queryByRole("link", { name: "KGH/2026-27/33 · Deleted" })).not.toBeInTheDocument();
  else expect(screen.getByRole("link", { name: "KGH/2026-27/33 · Deleted" })).toHaveAttribute("href", "/sales/205");
});
afterEach(() => { (window as unknown as { __phone: boolean }).__phone = false; });
test("a row that is saving keeps the keyboard on its control and ignores further changes", async () => {
  const calls = serve({
    "GET firms/": { results: FIRMS }, "GET preferences/": { data: {} }, "GET setup/": SETUP,
    "GET shop-settings/": { copies: "original", show_bank: true, share_message: DEFAULT_SHARE_MESSAGE, default_business: 3 },
    "PATCH preferences/": () => new Promise<never>(() => {}),
  });
  mountSettings();
  const select = await screen.findByLabelText("Your default firm");
  select.focus();
  fireEvent.change(select, { target: { value: "4" } });
  await waitFor(() => expect(select).toHaveAttribute("aria-disabled", "true"));
  expect(select).toBeEnabled();
  expect(select).toHaveFocus();
  fireEvent.change(select, { target: { value: "3" } });
  const easy = screen.getByRole("radio", { name: /^Easy/ });
  easy.focus();
  fireEvent.click(easy);
  await waitFor(() => expect(easy).toHaveAttribute("aria-disabled", "true"));
  expect(easy).toBeEnabled();
  expect(easy).toHaveFocus();
  fireEvent.click(screen.getByRole("radio", { name: /^Expert/ }));
  expect(calls.filter((call) => call.method === "PATCH").map((call) => call.data)).toEqual([{ defaultBusinessId: "4" }, { phoneMode: "easy" }]);
});
test("a choice the server refused says why and is not kept on the device to be sent again", async () => {
  serve({
    "GET firms/": { results: FIRMS }, "GET preferences/": { data: {} }, "GET setup/": SETUP,
    "GET shop-settings/": { copies: "original", show_bank: true, share_message: DEFAULT_SHARE_MESSAGE, default_business: 3 },
    "PUT shop-settings/": () => ({ status: 400, data: { default_business: ["Pick a firm from the list."] } }),
  });
  mountSettings();
  const select = await screen.findByLabelText("The shop's default firm");
  fireEvent.change(select, { target: { value: "4" } });
  expect(await screen.findByText(/Pick a firm from the list\./)).toBeInTheDocument();
  expect(screen.queryByText(/Not saved yet/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  expect(select).toHaveValue("3");
  expect(Object.keys(localStorage).filter((key) => key.startsWith("gst3.pending-settings.")).map((key) => localStorage.getItem(key))).not.toContainEqual(expect.stringContaining("default_business"));
});

const filedLabel = (firm = FIRMS[0]) => "Filed before the app: up to · " + firm.name;
async function previewFiled(firm = FIRMS[0], month = "2026-06") {
  fireEvent.change(await screen.findByLabelText(filedLabel(firm)), { target: { value: month } });
  fireEvent.click(screen.getByRole("button", { name: "Preview filed months for " + firm.name }));
  const dialog = await screen.findByRole("dialog", { name: "Mark months filed before the app?" });
  act(() => vi.setSystemTime(Date.now() + 400));
  return dialog;
}
const filedCalls = (calls: Call[]) => calls.filter((call) => call.url === "gst/months/filed-before/");

test.each([false, true])("filed-before has one owner control per firm and previews the inclusive range without saving (phone %s)", async (phone) => {
  (window as unknown as { __phone: boolean }).__phone = phone;
  const calls = server(); mountSettings();
  for (const firm of FIRMS) {
    const input = await screen.findByLabelText(filedLabel(firm));
    expect(input).toHaveAttribute("type", "month");
    expect(input).toHaveAttribute("min", "2025-04");
    expect(input).toHaveAttribute("max", "2026-09");
    expect(input).toHaveValue("");
    expect(input).toHaveAccessibleDescription("Choose a completed month from April 2025 to September 2026.");
  }
  const dialog = await previewFiled(FIRMS[1]);
  expect(within(dialog).getByText(FIRMS[1].name)).toBeInTheDocument();
  expect(within(dialog).getByText("April 2025 to June 2026, inclusive")).toBeInTheDocument();
  expect(within(dialog).getByText(/Months with filing records, already filed months and months you unlocked stay as they are/)).toBeInTheDocument();
  expect(filedCalls(calls)).toHaveLength(0);
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(filedCalls(calls)).toHaveLength(0);
  expect(screen.getByLabelText(filedLabel(FIRMS[1]))).toHaveValue("2026-06");
});

test.each(["accountant", "staff", "viewer"] as const)("%s cannot mark months filed before the app", async (role) => {
  const calls = server(); mountSettings({ me: { role, permissions: permissions.perms[role] as Action[] } });
  await screen.findByLabelText("Copies to print");
  expect(screen.queryByLabelText(/Filed before the app: up to/)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /Preview filed months/ })).not.toBeInTheDocument();
  expect(filedCalls(calls)).toHaveLength(0);
});

test("filed-before bounds use the completed IST month and invalid choices cannot open a preview", async () => {
  vi.setSystemTime(new Date("2026-03-31T18:30:00Z")); // April starts in IST while UTC is still in March.
  const calls = server(); mountSettings();
  const input = await screen.findByLabelText(filedLabel());
  const preview = screen.getByRole("button", { name: "Preview filed months for " + FIRMS[0].name });
  expect(input).toHaveAttribute("max", "2026-03");
  for (const value of ["", "2025-03", "2026-04"]) {
    fireEvent.change(input, { target: { value } });
    expect(preview).toBeDisabled();
    fireEvent.click(preview);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  }
  for (const value of ["2025-04", "2026-03"]) {
    fireEvent.change(input, { target: { value } });
    expect(preview).toBeEnabled();
  }
  expect(filedCalls(calls)).toHaveLength(0);
});

test.each([0, 1, 3])("filed-before sends the selected firm and month and reports the server's %s newly marked months", async (count) => {
  const calls = server({ filed: { months: ["2025-04", "2025-05", "2025-06"].slice(0, count), count } });
  mountSettings();
  const dialog = await previewFiled(FIRMS[1]);
  fireEvent.click(within(dialog).getByRole("button", { name: "Mark as filed" }));
  const words = count === 0 ? "No new months were marked for MEERA ORNAMENTS." : `${count} ${count === 1 ? "month" : "months"} marked as filed before the app for MEERA ORNAMENTS.`;
  expect(await screen.findByText(words)).toBeInTheDocument();
  expect(filedCalls(calls).map(({ method, data }) => ({ method, data }))).toEqual([{ method: "POST", data: { business: 4, up_to: "2026-06" } }]);
  expect(screen.queryByRole("button", { name: /Undo/ })).not.toBeInTheDocument();
  expect(screen.queryByText(/18 months marked/)).not.toBeInTheDocument();
});

test("filed-before keeps a pending confirmation open and sends duplicate presses only once", async () => {
  let release: ((reply: Reply) => void) | undefined;
  const calls = server({ filed: () => new Promise<Reply>((resolve) => { release = resolve; }) });
  mountSettings();
  const dialog = await previewFiled();
  const confirm = within(dialog).getByRole("button", { name: "Mark as filed" });
  act(() => { fireEvent.click(confirm); fireEvent.click(confirm); fireEvent.click(within(dialog).getByRole("button", { name: "Close" })); });
  await waitFor(() => expect(release).toBeDefined());
  expect(screen.getByRole("dialog", { name: "Mark months filed before the app?" })).toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "Saving…" })).toHaveAttribute("aria-busy", "true");
  expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeDisabled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  expect(dialog).toBeInTheDocument();
  expect(screen.getByLabelText(filedLabel())).toBeDisabled();
  expect(filedCalls(calls)).toHaveLength(1);
  await act(async () => release?.({ status: 200, data: { months: ["2025-04"], count: 1 } }));
  expect(await screen.findByText("1 month marked as filed before the app for KIRAN GOLD HOUSE.")).toBeInTheDocument();
});

test.each([
  { status: 400, data: { up_to: ["Pick a month that is over."] }, words: "Pick a month that is over." },
  { status: 403, data: { detail: "Your role can't do this." }, words: "Your role can't do this." },
  { status: 0, words: "Not saved: the app couldn't get through" },
])("filed-before preserves the firm and month after a $status failure and lets the owner retry", async ({ status, data, words }) => {
  let failed = true;
  const calls = server({ filed: () => failed ? { status, data } : { status: 200, data: { months: [], count: 0 } } });
  mountSettings();
  const dialog = await previewFiled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Mark as filed" }));
  expect(await within(dialog).findByText(words)).toBeInTheDocument();
  expect(screen.getByLabelText(filedLabel())).toHaveValue("2026-06");
  expect(within(dialog).getByText("April 2025 to June 2026, inclusive")).toBeInTheDocument();
  expect(screen.queryByText(/months? marked as filed before the app for/)).not.toBeInTheDocument();
  expect(filedCalls(calls)).toHaveLength(1);
  failed = false;
  fireEvent.click(within(dialog).getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("No new months were marked for KIRAN GOLD HOUSE.")).toBeInTheDocument();
  expect(filedCalls(calls).map((call) => call.data)).toEqual([{ business: 3, up_to: "2026-06" }, { business: 3, up_to: "2026-06" }]);
});
