import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "@/core/api/client";
import { renderApp } from "@/test/render";
import { serve, type Call } from "@/test/server";
import { ScopeProvider } from "@/core/scope";
import Backup from "./Backup";
import Restore from "./Restore";

const adapter = api.defaults.adapter;
const empty = () => ({ add: [], skip: [], fail: [], add_count: 0, skip_count: 0, fail_count: 0 });
function plan(words = "1 customer") { return {
  firms: empty(), customers: { ...empty(), add: [{ name: "Synthetic Customer" }], add_count: 1 }, products: empty(), bills: empty(), purchases: empty(), adds: 1, skips: 0, fails: 0, words,
}; }
const metadata = { name: "old.json", kind: "old_v4", kind_words: "Old app backup (v4.0)", size: "38 KB", made: "2026-03-12T19:40:00+05:30", by: "" };
function preview() { return { file: metadata, plan: plan(), fingerprint: "first-fingerprint" }; }
function choose(file = new File(['{"version":"4.0"}'], "old.json", { type: "application/json" })) {
  fireEvent.change(screen.getByLabelText("Backup file to restore"), { target: { files: [file] } }); return file;
}
async function confirm(words = "1 customer") {
  fireEvent.click(await screen.findByRole("button", { name: `Add ${words}` }));
  const dialog = screen.getByRole("dialog", { name: "Restore from this backup?" });
  act(() => { vi.setSystemTime(Date.now() + 1000); });
  const button = within(dialog).getByRole("button", { name: `Add ${words}` });
  expect(button).toBeDisabled();
  fireEvent.click(within(dialog).getByRole("checkbox"));
  fireEvent.click(button);
}
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-08T12:00:00+05:30")); });
afterEach(() => { api.defaults.adapter = adapter; vi.useRealTimers(); vi.restoreAllMocks(); });

it("previews and applies the same multipart File with its fingerprint after a checked confirmation", async () => {
  const calls = serve({ "POST backup/restore/preview/": preview(), "POST backup/restore/": { plan: plan(), added: { firms: [], customers: [7], products: [], bills: [], purchases: [] } } });
  renderApp(<Restore />); const file = choose();
  expect(await screen.findByText(/Old app backup \(v4.0\)/)).toBeVisible();
  expect(calls.filter((c) => c.url === "backup/restore/")).toHaveLength(0);
  await confirm();
  expect(await screen.findByText("Added 1 customer")).toBeVisible();
  expect(screen.getByRole("link", { name: "Open the new customer" })).toHaveAttribute("href", "/customers/7");
  const upload = calls.find((c) => c.url === "backup/restore/preview/")?.data as FormData;
  const restore = calls.find((c) => c.url === "backup/restore/")?.data as FormData;
  expect(upload.get("fy")).toBeNull(); expect(restore.get("fy")).toBeNull();
  expect(upload.get("file")).toBe(file); expect(restore.get("file")).toBe(file); expect(restore.get("fingerprint")).toBe("first-fingerprint");
});

it("replaces a changed plan, obtains its fingerprint, and requires another checked confirmation", async () => {
  let previews = 0; let applies = 0;
  const changed = { ...plan("2 customers"), customers: { ...empty(), add: [{ name: "Another Customer" }, { name: "Synthetic Customer" }], add_count: 2 }, adds: 2 };
  const calls = serve({
    "POST backup/restore/preview/": () => ({ status: 200, data: ++previews === 1 ? preview() : { ...preview(), plan: changed, fingerprint: "second-fingerprint" } }),
    "POST backup/restore/": () => ++applies === 1 ? { status: 409, data: { code: "plan_changed", detail: "The books changed since the preview. Check the new plan, then restore.", plan: changed } } : { status: 200, data: { plan: changed, added: { firms: [], customers: [7, 8], products: [], bills: [], purchases: [] } } },
  });
  renderApp(<Restore />); const file = choose(); await confirm();
  expect(await screen.findByText("The books changed since the preview. Check the new plan, then restore.")).toBeVisible();
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(applies).toBe(1);
  await confirm("2 customers");
  expect(await screen.findByText("Added 2 customers")).toBeVisible();
  expect(screen.queryByText("The books changed since the preview. Check the new plan, then restore.")).not.toBeInTheDocument();
  const apply = calls.filter((c) => c.url === "backup/restore/");
  expect((apply[1].data as FormData).get("fingerprint")).toBe("second-fingerprint");
  expect(calls.filter((c) => c.url.endsWith("preview/")).every((c) => (c.data as FormData).get("file") === file)).toBe(true);
});

it("keeps the replacement plan visible and cannot apply when its new preview fails", async () => {
  let previews = 0;
  const changed = { ...plan("2 customers"), adds: 2 };
  const calls = serve({
    "POST backup/restore/preview/": () => ++previews === 1 ? { status: 200, data: preview() } : { status: 0 },
    "POST backup/restore/": () => ({ status: 409, data: { code: "plan_changed", detail: "The books changed since the preview. Check the new plan, then restore.", plan: changed } }),
  });
  renderApp(<Restore />); choose(); await confirm();
  expect(await screen.findByRole("button", { name: "Check the plan again" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Add 2 customers" })).toBeDisabled();
  expect(screen.queryByText("That file can't be restored")).not.toBeInTheDocument();
  expect(screen.getByText("The check didn't finish")).toBeVisible();
  expect(calls.filter((c) => c.url === "backup/restore/")).toHaveLength(1);
});

it("uses whole counts and explains the first 200 rows instead of treating them as the whole plan", async () => {
  const many = { ...plan("240 customers"), customers: { ...empty(), add: Array.from({ length: 200 }, (_, i) => ({ name: `Customer ${i + 1}` })), add_count: 240 }, adds: 240 };
  serve({ "POST backup/restore/preview/": { ...preview(), plan: many } });
  renderApp(<Restore />); choose();
  expect(await screen.findByRole("cell", { name: "240" })).toBeVisible();
  expect(screen.getByText("Showing the first 200 of 240 records.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Add 240 customers" })).toBeEnabled();
});

it.each([
  ["no-name.json", "No name in the file"], ["closed.json", "September 2026 is filed for Kiran. Have the owner unlock September 2026 in GST returns first."],
  ["purchase.json", "Purchase bills from the old app go through Purchases → Import, which checks each supplier's GSTIN and the credit month"],
])("shows server refusal reasons for %s and offers no empty restore", async (_name, why) => {
  const refused = { ...plan(""), customers: empty(), bills: { ...empty(), fail: [{ name: "KGH/2026-27/108", why }], fail_count: 1 }, adds: 0, fails: 1 };
  serve({ "POST backup/restore/preview/": { ...preview(), plan: refused } });
  renderApp(<Restore />); choose();
  expect(await screen.findByText("Nothing to add")).toBeVisible();
  expect(screen.getByText(why, { exact: false })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /^Add / })).not.toBeInTheDocument();
});

it("checks extension and 25 MB limit without reading or uploading the rejected file", async () => {
  const calls = serve({}); renderApp(<Restore />);
  choose(new File(["pdf"], "paper.pdf"));
  expect(screen.getByText("paper.pdf isn't a backup file. Backups are .json files, named like gst-backup-2026-10-08.json.")).toBeVisible();
  const large = new File(["{}"], "large.json"); Object.defineProperty(large, "size", { value: 26 * 1024 * 1024 });
  choose(large);
  expect(screen.getByText("That file is 26 MB. A backup this app can restore is at most 25 MB.")).toBeVisible();
  expect(calls).toHaveLength(0);
});

it("lets the server validate malformed JSON and lets a person choose the file again", async () => {
  const calls = serve({ "POST backup/restore/preview/": () => ({ status: 400, data: { file: ["bad.json is a .json file, but not a backup. Pick a file named like gst-backup-2026-10-08.json."] } }) });
  renderApp(<Restore />); choose(new File(["not json"], "bad.json"));
  expect(await screen.findByText(/bad.json is a .json file, but not a backup/)).toBeVisible();
  expect(calls).toHaveLength(1); expect(screen.getByRole("button", { name: "Choose a backup file" })).toBeEnabled();
});

it.each([false, true])("requires another preview of the same File after an uncertain apply (offline: %s)", async (disconnect) => {
  let previews = 0;
  const addedAlready = { ...plan(""), customers: { ...empty(), skip: [{ name: "Synthetic Customer", why: "same name as Synthetic Customer" }], skip_count: 1 }, adds: 0, skips: 1 };
  const calls = serve({
    "POST backup/restore/preview/": () => ({ status: 200, data: ++previews === 1 ? preview() : { ...preview(), plan: addedAlready, fingerprint: "after-uncertain-apply" } }),
    "POST backup/restore/": () => {
      if (disconnect) vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
      return { status: 0 };
    },
  });
  renderApp(<Restore />); const file = choose(); await confirm();
  expect(await screen.findByText("The restore answer didn't arrive")).toBeVisible();
  expect(screen.getByText("The restore may have finished. Check the plan again before trying to restore.")).toBeVisible();
  expect(screen.queryByText("Added 1 customer")).not.toBeInTheDocument();
  expect(screen.queryByText(/Nothing was changed/)).not.toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.getByRole("button", { name: "Add 1 customer" })).toBeDisabled();
  expect(previews).toBe(1);
  if (disconnect) vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  fireEvent.click(screen.getByRole("button", { name: "Check the plan again" }));
  expect(await screen.findByText("Nothing to add")).toBeVisible();
  expect(screen.queryByText("The restore answer didn't arrive")).not.toBeInTheDocument();
  const checks = calls.filter((c) => c.url === "backup/restore/preview/");
  expect(checks).toHaveLength(2);
  expect(checks.every((c) => (c.data as FormData).get("file") === file)).toBe(true);
  expect(calls.filter((c) => c.url === "backup/restore/")).toHaveLength(1);
});

it("keeps restore reachable when the backup summary fails", async () => {
  serve({ "GET backup/summary/": () => ({ status: 500 }), "GET firms/": { results: [] }, "GET preferences/": { data: {} }, "POST backup/restore/preview/": preview() });
  renderApp(<ScopeProvider><Backup /></ScopeProvider>);
  expect(await screen.findByRole("button", { name: "Choose a backup file" })).toBeEnabled();
  choose();
  expect(await screen.findByRole("button", { name: "Add 1 customer" })).toBeEnabled();
});

it("only lets the owner choose or drop a file", () => {
  const calls: Call[] = serve({}); renderApp(<Restore />, { me: { role: "accountant", permissions: ["view", "backup.download"] } });
  expect(screen.getByText("Only the owner can restore a backup. Ask the owner if you need it.")).toBeVisible();
  expect(screen.queryByLabelText("Backup file to restore")).not.toBeInTheDocument(); expect(calls).toHaveLength(0);
});

it("accepts a dropped JSON file and shows server bin and amendment details verbatim", async () => {
  const p = { ...plan("1 sales bill"), customers: empty(), bills: { ...empty(), add: [{ name: "MO/2026-27/27", detail: "deleted 03 Oct 2026; comes back from the bin; needs an amendment" }], add_count: 1 } };
  serve({ "POST backup/restore/preview/": { ...preview(), plan: p } }); renderApp(<Restore />);
  fireEvent.drop(screen.getByText(/Drop a backup file here/).parentElement!, { dataTransfer: { files: [new File(["{}"], "drop.json")] } });
  expect(await screen.findByText(/deleted 03 Oct 2026; comes back from the bin; needs an amendment/)).toBeInTheDocument();
});

it("accepts exactly 25 MB and leaves JSON and record validation to the server", async () => {
  const calls = serve({ "POST backup/restore/preview/": preview() }); renderApp(<Restore />);
  const file = new File(["{}"], "maximum.json"); Object.defineProperty(file, "size", { value: 25 * 1024 * 1024 });
  choose(file); await screen.findByRole("button", { name: "Add 1 customer" });
  expect((calls[0].data as FormData).get("file")).toBe(file);
});

it("distinguishes sales and credit months and leaves pre-ledger purchase planning to the server", async () => {
  const purchasePlan = { ...plan("1 purchase bill"), customers: empty(), purchases: { ...empty(), add: [{ name: "UBS/2024-25/1" }], add_count: 1 } };
  const calls = serve({
    "POST backup/restore/preview/": { ...preview(), plan: purchasePlan },
    "POST backup/restore/": { plan: purchasePlan, added: { firms: [], customers: [], products: [], bills: [], purchases: [77] } },
  });
  renderApp(<Restore />);
  const file = new File([JSON.stringify({ version: "5.0", invoices: [{ type_of_invoice: "inward", invoice_date: "2025-03-31", itc_month: null }] })], "pre-ledger.json", { type: "application/json" });
  const read = vi.fn(); Object.defineProperty(file, "text", { value: read });
  choose(file);
  fireEvent.click(await screen.findByRole("button", { name: "Add 1 purchase bill" }));
  const dialog = screen.getByRole("dialog", { name: "Restore from this backup?" });
  expect(within(dialog).getByText("Records that match what's on file are skipped. Sales need their sales month open, and purchases need their credit month open. A restored bill in an open month changes that month's GST figures.")).toBeInTheDocument();
  expect(calls.filter((c) => c.url === "backup/restore/")).toHaveLength(0);
  act(() => { vi.setSystemTime(Date.now() + 1000); });
  fireEvent.click(within(dialog).getByRole("checkbox"));
  fireEvent.click(within(dialog).getByRole("button", { name: "Add 1 purchase bill" }));
  expect(await screen.findByText("Added 1 purchase bill")).toBeVisible();
  expect(read).not.toHaveBeenCalled();
  expect(calls.filter((c) => c.url.startsWith("backup/restore/")).every((c) => (c.data as FormData).get("file") === file)).toBe(true);
});


const years = [
  { fy: "2025-26", bills: 1204, words: "Adding 2025-26: 1,204 bills…" },
  { fy: "2026-27", bills: 1800, words: "Adding 2026-27: 1,800 bills…" },
];
function yearPlan(fy: string) {
  const count = years.find((year) => year.fy === fy)!.bills;
  return { ...plan(`${count.toLocaleString("en-IN")} sales bills`), customers: { ...empty(), skip: [{ name: "Synthetic Customer" }], skip_count: 1 }, bills: { ...empty(), add: [{ name: `BILL/${fy}/1` }], add_count: count }, adds: count, skips: 1 };
}
function yearPreview(fy: string | null) {
  return { ...preview(), years, fy, plan: fy ? yearPlan(fy) : { ...plan("3,004 sales bills"), adds: 3004 }, fingerprint: fy ? `fingerprint-${fy}` : "overview-never-apply" };
}
function yearResult(fy: string) {
  return { plan: yearPlan(fy), added: { firms: [], customers: [], products: [], bills: [fy === years[0].fy ? 101 : 201], purchases: [] } };
}
const requestedYear = (call: Call) => (call.data as FormData).get("fy") as string | null;
const applies = (calls: Call[]) => calls.filter((call) => call.url === "backup/restore/");
const previews = (calls: Call[]) => calls.filter((call) => call.url === "backup/restore/preview/");

it("walks large backups by year with separate confirmations, opaque uploads and server progress/counts", async () => {
  let finishFirst!: (reply: { status: number; data: unknown }) => void;
  const calls = serve({
    "POST backup/restore/preview/": (call: Call) => ({ status: 200, data: yearPreview(requestedYear(call)) }),
    "POST backup/restore/": (call: Call) => requestedYear(call) === years[0].fy
      ? new Promise((resolve) => { finishFirst = resolve; }) : { status: 200, data: yearResult(years[1].fy) },
  });
  renderApp(<Restore />);
  const file = new File(["opaque backup"], "large.json"); const read = vi.fn(); Object.defineProperty(file, "text", { value: read }); choose(file);
  expect(await screen.findByRole("button", { name: "Add 1,204 sales bills" })).toBeEnabled();
  expect(previews(calls).map(requestedYear)).toEqual([null, "2025-26"]);
  expect(applies(calls)).toHaveLength(0);
  fireEvent.click(screen.getByRole("button", { name: "Add 1,204 sales bills" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByText("2025-26")).toBeVisible();
  act(() => { vi.setSystemTime(Date.now() + 1000); });
  fireEvent.click(within(dialog).getByRole("checkbox")); fireEvent.click(within(dialog).getByRole("button", { name: "Add 1,204 sales bills" }));
  expect(await screen.findByText("Adding 2025-26: 1,204 bills…")).toBeVisible();
  expect(screen.getByRole("button", { name: "Choose another file" })).toBeDisabled();
  expect(previews(calls)).toHaveLength(2);
  await act(async () => finishFirst({ status: 200, data: yearResult(years[0].fy) }));
  expect(await screen.findByRole("button", { name: "Add 1,800 sales bills" })).toBeEnabled();
  expect(screen.getByText("2025-26 · Added 1,204 sales bills")).toBeVisible();
  expect(screen.getByText("Financial year 2026-27")).toHaveAttribute("role", "status");
  expect(screen.getByText("Financial year 2026-27")).toHaveFocus();
  expect(screen.queryByText("Finished checking 2 financial years")).not.toBeInTheDocument();
  expect(applies(calls)).toHaveLength(1);
  await confirm("1,800 sales bills");
  expect(await screen.findByText("Finished checking 2 financial years")).toBeVisible();
  expect(screen.getByText("2026-27 · Added 1,800 sales bills")).toBeVisible();
  expect(screen.getByText("Added 3,004 bills across these years.")).toBeVisible();
  expect(previews(calls).map(requestedYear)).toEqual([null, "2025-26", "2026-27"]);
  expect(applies(calls).map((call) => [requestedYear(call), (call.data as FormData).get("fingerprint")])).toEqual([["2025-26", "fingerprint-2025-26"], ["2026-27", "fingerprint-2026-27"]]);
  expect(calls.every((call) => (call.data as FormData).get("file") === file)).toBe(true);
  expect(read).not.toHaveBeenCalled();
});

it("refreshes only the changed year and needs a fresh confirmation without losing earlier results", async () => {
  let secondChecks = 0; let secondApplies = 0;
  const changed = { ...yearPlan(years[1].fy), words: "1,799 sales bills", adds: 1799 };
  const calls = serve({
    "POST backup/restore/preview/": (call: Call) => {
      const fy = requestedYear(call); const data = yearPreview(fy);
      return { status: 200, data: fy === years[1].fy && ++secondChecks > 1 ? { ...data, plan: changed, fingerprint: "fresh-second-year" } : data };
    },
    "POST backup/restore/": (call: Call) => requestedYear(call) === years[1].fy && ++secondApplies === 1
      ? { status: 409, data: { code: "plan_changed", detail: "The books changed since the preview. Check the new plan, then restore.", plan: changed } }
      : { status: 200, data: yearResult(requestedYear(call)!) },
  });
  renderApp(<Restore />); choose(); await confirm("1,204 sales bills"); await confirm("1,800 sales bills");
  expect(await screen.findByRole("button", { name: "Add 1,799 sales bills" })).toBeEnabled();
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(screen.getByText("2025-26 · Added 1,204 sales bills")).toBeVisible();
  expect(applies(calls)).toHaveLength(2);
  await confirm("1,799 sales bills");
  expect(await screen.findByText("Finished checking 2 financial years")).toBeVisible();
  expect(previews(calls).map(requestedYear)).toEqual([null, "2025-26", "2026-27", "2026-27"]);
  expect((applies(calls)[2].data as FormData).get("fingerprint")).toBe("fresh-second-year");
});

it.each([0, 500, 403])("stops after a second-year failure (%s) and retains the first year's confirmed result", async (status) => {
  const calls = serve({
    "POST backup/restore/preview/": (call: Call) => ({ status: 200, data: yearPreview(requestedYear(call)) }),
    "POST backup/restore/": (call: Call) => requestedYear(call) === years[0].fy ? { status: 200, data: yearResult(years[0].fy) } : { status, data: { detail: "Only the owner can restore a backup." } },
  });
  renderApp(<Restore />); choose(); await confirm("1,204 sales bills"); await confirm("1,800 sales bills");
  expect(await screen.findByText(status === 403 ? "Only the owner can restore a backup." : "The restore answer didn't arrive")).toBeVisible();
  expect(screen.getByText("2025-26 · Added 1,204 sales bills")).toBeVisible();
  expect(screen.queryByText("Finished checking 2 financial years")).not.toBeInTheDocument();
  expect(applies(calls)).toHaveLength(2); expect(previews(calls)).toHaveLength(3);
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  if (status !== 403) {
    expect(screen.getByRole("button", { name: "Add 1,800 sales bills" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Check the plan again" }));
    await waitFor(() => expect(previews(calls)).toHaveLength(4));
    expect(requestedYear(previews(calls)[3])).toBe("2026-27");
    expect(applies(calls)).toHaveLength(2);
  }
});

it("keeps the next year recoverable if its preview fails, without reapplying completed years", async () => {
  let secondChecks = 0;
  const calls = serve({
    "POST backup/restore/preview/": (call: Call) => requestedYear(call) === years[1].fy && ++secondChecks === 1 ? { status: 0 } : { status: 200, data: yearPreview(requestedYear(call)) },
    "POST backup/restore/": (call: Call) => ({ status: 200, data: yearResult(requestedYear(call)!) }),
  });
  renderApp(<Restore />); choose(); await confirm("1,204 sales bills");
  fireEvent.click(await screen.findByRole("button", { name: "Check the plan again" }));
  expect(await screen.findByRole("button", { name: "Add 1,800 sales bills" })).toBeEnabled();
  expect(screen.getByText("2025-26 · Added 1,204 sales bills")).toBeVisible();
  expect(applies(calls)).toHaveLength(1);
  expect(previews(calls).map(requestedYear)).toEqual([null, "2025-26", "2026-27", "2026-27"]);
});

it("can finish checking an already-present year after an uncertain answer without inventing an added result", async () => {
  let secondChecks = 0;
  const nothing = { ...yearPlan(years[1].fy), bills: { ...empty(), skip_count: 1800 }, adds: 0, skips: 1801, words: "" };
  const calls = serve({
    "POST backup/restore/preview/": (call: Call) => {
      const fy = requestedYear(call);
      return { status: 200, data: fy === years[1].fy && ++secondChecks > 1 ? { ...yearPreview(fy), plan: nothing } : yearPreview(fy) };
    },
    "POST backup/restore/": (call: Call) => requestedYear(call) === years[0].fy ? { status: 200, data: yearResult(years[0].fy) } : { status: 0 },
  });
  renderApp(<Restore />); choose(); await confirm("1,204 sales bills"); await confirm("1,800 sales bills");
  fireEvent.click(await screen.findByRole("button", { name: "Check the plan again" }));
  const finish = await screen.findByRole("button", { name: "Finish checking this backup" });
  act(() => {
    finish.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    finish.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(await screen.findByText("Finished checking 2 financial years")).toBeVisible();
  expect(screen.getByText("2026-27 · Already on file (after an unconfirmed restore)")).toBeVisible();
  expect(screen.queryByText("2026-27 · Added 1,800 sales bills")).not.toBeInTheDocument();
  expect(applies(calls)).toHaveLength(2);
});

it("uses the server's required-year manifest if apply discovers the large-file rule", async () => {
  const calls = serve({
    "POST backup/restore/preview/": (call: Call) => ({ status: 200, data: requestedYear(call) ? yearPreview(requestedYear(call)) : preview() }),
    "POST backup/restore/": () => ({ status: 409, data: { code: "restore_year_required", detail: "Restore this backup one financial year at a time.", years } }),
  });
  renderApp(<Restore />); const file = choose(); await confirm();
  expect(await screen.findByRole("button", { name: "Add 1,204 sales bills" })).toBeEnabled();
  expect(screen.getByText("Restore this backup one financial year at a time.")).toBeVisible();
  expect(previews(calls).map(requestedYear)).toEqual([null, "2025-26"]);
  expect(applies(calls)).toHaveLength(1);
  expect(calls.every((call) => (call.data as FormData).get("file") === file)).toBe(true);
});

it("blocks a large backup with no valid financial year instead of offering an inert restore", async () => {
  const calls = serve({ "POST backup/restore/preview/": { ...preview(), years: [], fy: null } });
  renderApp(<Restore />); choose();
  expect(await screen.findByText("This backup has no valid financial year.")).toBeVisible();
  expect(screen.getByText("Check the bill dates in the original app and download another backup.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Add 1 customer" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Choose another file" })).toBeEnabled();
  expect(applies(calls)).toHaveLength(0);
});

it("sends only one apply when confirmation receives two clicks before the busy render", async () => {
  const calls = serve({ "POST backup/restore/preview/": (call: Call) => ({ status: 200, data: yearPreview(requestedYear(call)) }), "POST backup/restore/": () => new Promise(() => {}) });
  renderApp(<Restore />); choose();
  fireEvent.click(await screen.findByRole("button", { name: "Add 1,204 sales bills" }));
  const dialog = screen.getByRole("dialog");
  act(() => { vi.setSystemTime(Date.now() + 1000); });
  fireEvent.click(within(dialog).getByRole("checkbox"));
  const button = within(dialog).getByRole("button", { name: "Add 1,204 sales bills" });
  act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await screen.findByText("Adding 2025-26: 1,204 bills…");
  expect(applies(calls)).toHaveLength(1);
});

it("sends only one explicit re-preview when retry receives two clicks before the busy render", async () => {
  let checks = 0;
  const calls = serve({
    "POST backup/restore/preview/": (call: Call) => ++checks > 2 ? new Promise(() => {}) : { status: 200, data: yearPreview(requestedYear(call)) },
    "POST backup/restore/": () => ({ status: 0 }),
  });
  renderApp(<Restore />); choose(); await confirm("1,204 sales bills");
  const button = await screen.findByRole("button", { name: "Check the plan again" });
  act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await waitFor(() => expect(previews(calls).length).toBeGreaterThan(2));
  expect(previews(calls)).toHaveLength(3);
});
