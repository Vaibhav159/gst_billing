import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import Settings from "./Settings";
import { messageProblem } from "./settingsModel";
import { mount, VIEWER } from "@/pages/customers/testing";
import { serve, type Call } from "@/test/server";
import { DEFAULT_SHARE_MESSAGE } from "@/core/sales/share";
import { MORE_NAV } from "@/core/shell/nav";
import { formServer, mountForm } from "@/pages/sales/form/testing";

const FIRMS = [
  { id: 3, name: "KIRAN GOLD HOUSE", short: "Kiran", short_name: "", gst_number: "08VRHFA2322D1ZI", state_code: "08", state_name: "RAJASTHAN", invoice_prefix: "KGH", city: "Udaipur", paper_full_number_from: null, numbers: { fy: "2026-27", last: null, next: { counter: 34, invoice_number: "KGH/2026-27/34" }, full_number: false } },
  { id: 4, name: "MEERA ORNAMENTS", short: "Meera", short_name: "Meera", gst_number: "08AAMFR5567K1ZG", state_code: "08", state_name: "RAJASTHAN", invoice_prefix: "MO", city: "Udaipur", paper_full_number_from: "2027-04-01", numbers: { fy: "2026-27", last: null, next: { counter: 9, invoice_number: "MO/2026-27/9" }, full_number: false } },
];
const SETUP = { firms: { count: 2, names: FIRMS.map((firm) => firm.name) }, customers: { count: 1, names: ["Anil"] }, products: { count: 1, names: ["Gold"] }, bills: { count: 1, cancelled: 0 }, people: 1, last_backup_at: null };
function server({ fail = false, prefs = {} as Record<string, unknown>, last = null as import("@/core/sales/types").BillRef | null } = {}) {
  let settings = { copies: "original", show_bank: true, share_message: DEFAULT_SHARE_MESSAGE, updated_at: null, updated_by: null, default_business: 3, default_business_name: FIRMS[0].name, warnings: [] };
  let preferences = { ...prefs };
  return serve({
    "GET firms/": { results: FIRMS.map((firm, i) => i ? firm : { ...firm, numbers: { ...firm.numbers, last } }) }, "GET preferences/": { data: preferences }, "GET setup/": SETUP, "GET shop-settings/": settings,
    "PUT shop-settings/": ({ data }: Call) => { if (fail) return { status: 0 }; settings = { ...settings, ...(data as object) }; return { status: 200, data: settings }; },
    "PATCH preferences/": ({ data }: Call) => { if (fail) return { status: 0 }; preferences = { ...preferences, ...(data as object) }; return { status: 200, data: { data: preferences } }; },
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
