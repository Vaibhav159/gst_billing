import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { renderApp } from "@/test/render";
import { serve } from "@/test/server";
import Audit from "./Audit";
import type { AuditEntry } from "@/core/api/audit";

const entry: AuditEntry = {
  id: 9012, at: "2026-10-07T15:14:00+05:30", by: { id: 1, name: "Kailash Mehta" }, action: "updated", entity: "customer", entity_id: 7,
  kind: "records", group: "change", words: { text: "Edited customer", target: "Priya Sharma", after: "" }, link: "/customers/7", note: "", details: "phone",
  changes: [{ key: "mobile_number", field: "Phone", from: "98290 41122", to: "98290 41123" }], result: null,
  can: { kind: "revert", label: "Revert…", disabled: "", hint: "Shows what goes back before anything changes", effect: "" },
};
const page = (e = entry) => ({ count: 1, next: null, previous: null, results: [e], total: 1, counts: { all: 1, records: 1 }, people: [] });
const effect = "Meera's September sales go up by ₹1,31,830.52 and its tax by ₹3,839.72. September 2026 was filed before and is open for a correction, so this change needs an amendment in the next return.";
const binned = { id: 11, original_id: 205, invoice_number: "MO/2026-27/27", invoice_date: "2026-09-30", customer: { id: 7, name: "Priya Sharma" }, total_amount: "131830.52", deleted_at: "2026-10-03T18:40:00+05:30", deleted_by: { id: 1, name: "Kailash Mehta" } };
beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-08T11:00:00+05:30")); });
afterEach(() => vi.useRealTimers());
const opened = () => vi.setSystemTime(Date.now() + 400);

test("revert names every field going back; it sends nothing before confirmation and shows a raced refusal", async () => {
  const calls = serve({ "GET audit/": page(), "POST audit/9012/revert/": () => ({ status: 409, data: { code: "changed_since", detail: "Phone changed again since. Revert the later change first." } }) });
  renderApp(<Audit />);
  fireEvent.click(await screen.findByRole("button", { name: "Revert Priya Sharma" }));
  const dialog = screen.getByRole("dialog", { name: "Put back Priya Sharma as it was?" });
  expect(within(dialog).getByText("98290 41123 → 98290 41122")).toBeInTheDocument();
  expect(within(dialog).getByText("Only these fields go back. Bills already made keep what they were made with. The revert is recorded too, so it can be reverted in turn.")).toBeInTheDocument();
  expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  opened(); fireEvent.click(within(dialog).getByRole("button", { name: "Revert" }));
  expect(await within(dialog).findByText("Phone changed again since. Revert the later change first.")).toBeInTheDocument();
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "Revert" })).toBeDisabled();
  expect(within(dialog).queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
  expect(screen.getByRole("button", { name: "Revert Priya Sharma" })).toBeDisabled();
});

test("undo an unused record confirms, refreshes and shows Undone without a toast", async () => {
  const original: AuditEntry = { ...entry, action: "created", changes: [], can: { kind: "undo", label: "Undo…", disabled: "", hint: "", effect: "" } };
  let current = original;
  const calls = serve({ "GET audit/": () => ({ status: 200, data: page(current) }), "POST audit/9012/undo/": () => { current = { ...original, result: "undone", can: null }; return { status: 200, data: { entry: current, new_entry: { ...entry, id: 9013 } } }; } });
  renderApp(<Audit />);
  fireEvent.click(await screen.findByRole("button", { name: "Undo Priya Sharma" }));
  const dialog = screen.getByRole("dialog", { name: "Undo adding Priya Sharma?" });
  expect(within(dialog).getByText("It goes off the lists and the bill form. It can be restored here.")).toBeInTheDocument();
  expect(within(dialog).queryByText("On bills")).not.toBeInTheDocument();
  opened(); fireEvent.click(within(dialog).getByRole("button", { name: "Remove Priya Sharma" }));
  expect(await screen.findByText("Undone")).toBeInTheDocument();
  expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
});

test("restore deep link resolves the original bill and shows its exact month effect before posting the audit id", async () => {
  const deleted: AuditEntry = { ...entry, id: 9008, entity: "invoice", entity_id: 205, kind: "sales", group: "delete", action: "deleted", changes: [], words: { text: "Deleted bill", target: "MO/2026-27/27", after: "" }, link: null, can: { kind: "restore", label: "Restore", disabled: "", hint: "", effect } };
  const calls = serve({ "GET bin/": { count: 1, next: null, results: [binned] }, "GET audit/": page(deleted), "POST audit/9008/restore/": () => ({ status: 409, data: { code: "month_closed", detail: "September 2026 is filed and locked for Meera, so a deleted bill can't go back into it. Have the owner unlock September 2026 in GST returns first." } }) });
  renderApp(<Audit />, { path: "/audit?restore=11" });
  const dialog = await screen.findByRole("dialog", { name: "Restore MO/2026-27/27?" });
  expect(within(dialog).getByText(effect)).toBeInTheDocument();
  expect(within(dialog).getByText("₹1,31,830.52")).toBeInTheDocument();
  expect(within(dialog).getByText("Priya Sharma")).toBeInTheDocument();
  expect(calls.some((c) => c.method === "POST")).toBe(false);
  opened(); fireEvent.click(within(dialog).getByRole("button", { name: "Restore the bill" }));
  expect(await within(dialog).findByText(/a deleted bill can't go back into it/)).toBeInTheDocument();
  expect(calls.find((c) => c.method === "POST")?.url).toBe("audit/9008/restore/");
});

test("a disabled restore shows its reason instead of opening from a deep link", async () => {
  const disabled = "September 2026's GSTR-1 is filed for Meera Ornaments, so its sales can't change. Unlock the month in GST returns first (owner only).";
  const deleted: AuditEntry = { ...entry, kind: "sales", entity_id: 205, can: { kind: "restore", label: "Restore", disabled, hint: "", effect } };
  const calls = serve({ "GET audit/": page(deleted), "GET bin/": { count: 1, next: null, results: [binned] } });
  renderApp(<Audit />, { path: "/audit?restore=11" });
  await waitFor(() => expect(calls.some((c) => c.url === "bin/")).toBe(true));
  expect(await screen.findAllByText(disabled)).not.toHaveLength(0);
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Restore Priya Sharma" })).toBeDisabled();
});

test("a sale restore from the log loads the original bill by id, not its combined display target", async () => {
  const target = "#MO/2026-27/27 - Priya Sharma";
  const sale: AuditEntry = { ...entry, id: 9008, entity: "invoice", entity_id: 205, kind: "sales", group: "delete", action: "deleted", changes: [],
    words: { text: "Deleted bill", target, after: "" }, link: null, can: { kind: "restore", label: "Restore", disabled: "", hint: "", effect } };
  const calls = serve({ "GET audit/": page(sale), "GET bin/": { count: 0, next: null, results: [] },
    "GET sales/205/": () => ({ status: 404, data: { code: "deleted", binned } }),
    "POST audit/9008/restore/": { entry: { ...sale, result: "restored", can: null }, new_entry: { ...sale, id: 9010 } } });
  renderApp(<Audit />);
  fireEvent.click(await screen.findByRole("button", { name: `Restore ${target}` }));
  const dialog = screen.getByRole("dialog", { name: `Restore ${target}?` });
  expect(await within(dialog).findByText("₹1,31,830.52")).toBeInTheDocument();
  expect(within(dialog).getByText("Priya Sharma")).toBeInTheDocument();
  expect(within(dialog).getByText(effect)).toBeInTheDocument();
  opened(); fireEvent.click(within(dialog).getByRole("button", { name: "Restore the bill" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(calls.filter((call) => call.method === "POST")).toMatchObject([{ url: "audit/9008/restore/" }]);
  expect(calls.some((call) => call.url === "bin/")).toBe(false);
});

test("offline action fails in its dialog without queuing or losing the field comparison", async () => {
  serve({ "GET audit/": page(), "POST audit/9012/revert/": () => ({ status: 0 }) });
  renderApp(<Audit />);
  fireEvent.click(await screen.findByRole("button", { name: "Revert Priya Sharma" }));
  const dialog = screen.getByRole("dialog");
  Object.defineProperty(navigator, "onLine", { configurable: true, value: false });
  opened(); fireEvent.click(within(dialog).getByRole("button", { name: "Revert" }));
  expect(await within(dialog).findByText("You're offline, so this wasn't saved")).toBeInTheDocument();
  expect(within(dialog).getByText("98290 41123 → 98290 41122")).toBeInTheDocument();
  Object.defineProperty(navigator, "onLine", { configurable: true, value: true });
});

test("a deleted purchase uses its own deleted-bill response, and names input tax credit before restoring", async () => {
  const purchase: AuditEntry = { ...entry, id: 9009, entity: "invoice", entity_id: 77, kind: "purchases", group: "delete", action: "deleted", changes: [], words: { text: "Deleted purchase", target: "UBS/26-27/0850", after: "" }, link: null,
    can: { kind: "restore", label: "Restore", disabled: "", hint: "", effect: "Kiran's October input tax credit goes up by ₹14,348.88." } };
  const calls = serve({ "GET audit/": page(purchase), "GET purchases/77/": () => ({ status: 404, data: { detail: "This purchase was deleted.", code: "deleted", binned: { ...binned, id: 12, original_id: 77, type: "purchase", invoice_number: "UBS/26-27/0850", customer: undefined, supplier: { id: 8, name: "Udaipur Bullion" } } } }),
    "POST audit/9009/restore/": { entry: { ...purchase, result: "restored", can: null }, new_entry: { ...purchase, id: 9010 } } });
  renderApp(<Audit />);
  fireEvent.click(await screen.findByRole("button", { name: "Restore UBS/26-27/0850" }));
  const dialog = screen.getByRole("dialog", { name: "Restore purchase UBS/26-27/0850?" });
  expect(await within(dialog).findByText("Udaipur Bullion")).toBeInTheDocument();
  expect(within(dialog).getByText("Kiran's October input tax credit goes up by ₹14,348.88.")).toBeInTheDocument();
  expect(within(dialog).getByRole("button", { name: "Restore the purchase bill" })).toBeEnabled();
  opened(); fireEvent.click(within(dialog).getByRole("button", { name: "Restore the purchase bill" }));
  await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  expect(calls.filter((c) => c.method === "POST")).toMatchObject([{ url: "audit/9009/restore/" }]);
  expect(calls.some((c) => c.url === "bin/")).toBe(false);
});

test.each(["purchase", "sale"] as const)("a bin-id link never opens a purchase restore from a %s bin row", async (type) => {
  const purchase: AuditEntry = { ...entry, entity: "invoice", entity_id: 205, kind: "purchases", group: "delete", action: "deleted", changes: [],
    can: { kind: "restore", label: "Restore", disabled: "", hint: "", effect: "" } };
  const calls = serve({ "GET audit/": page(purchase), "GET bin/": { count: 1, next: null, results: [{ ...binned, type }] } });
  renderApp(<Audit />, { path: "/audit?restore=11" });
  expect(await screen.findByText("That deleted bill isn't in the bin any more.")).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(calls.some((c) => c.url.startsWith("purchases/") || c.method === "POST")).toBe(false);
});

test("a purchase bin row whose original id matches a deleted sales bill never opens that sales restore", async () => {
  const sale: AuditEntry = { ...entry, id: 9020, entity: "invoice", entity_id: 205, kind: "sales", group: "delete", action: "deleted", changes: [],
    words: { text: "Deleted bill", target: "MO/2026-27/27", after: "" }, link: null, can: { kind: "restore", label: "Restore", disabled: "", hint: "", effect: "" } };
  const purchaseRow = { ...binned, type: "purchase", invoice_number: "UBS/26-27/0850", customer: undefined, supplier: { id: 8, name: "Udaipur Bullion" } };
  const calls = serve({ "GET audit/": page(sale), "GET bin/": { count: 1, next: null, results: [purchaseRow] } });
  renderApp(<Audit />, { path: "/audit?restore=11" });
  expect(await screen.findByText("That deleted bill isn't in the bin any more.")).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(screen.queryByText("UBS/26-27/0850")).not.toBeInTheDocument();
  expect(calls.some((c) => c.method === "POST")).toBe(false);
});

test("an undo button's accessible name contains its visible text whatever the server's label", async () => {
  serve({ "GET audit/": page({ ...entry, action: "created", changes: [], can: { kind: "undo", label: "Remove addition…", disabled: "", hint: "", effect: "" } }) });
  renderApp(<Audit />);
  const button = await screen.findByRole("button", { name: /Priya Sharma$/ });
  expect(button.getAttribute("aria-label")).toContain(button.textContent!.replace("…", ""));
});

test("restoring a record is immediate, and a server refusal stays on its row", async () => {
  const restored: AuditEntry = { ...entry, action: "deleted", changes: [], can: { kind: "restore", label: "Restore", disabled: "", hint: "", effect: "" } };
  const calls = serve({ "GET audit/": page(restored), "POST audit/9012/restore/": () => ({ status: 409, data: { code: "name_taken", detail: "A customer called Priya Sharma was added since. Rename one of them first." } }) });
  renderApp(<Audit />);
  fireEvent.click(await screen.findByRole("button", { name: "Restore Priya Sharma" }));
  expect(await screen.findByText("A customer called Priya Sharma was added since. Rename one of them first.")).toBeInTheDocument();
  expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
});

test.each(["NaN", "-1", "1.5", "99999999999999999"])("a malformed restore id %s never reads the bin", async (id) => {
  const calls = serve({ "GET audit/": page() });
  renderApp(<Audit />, { path: `/audit?restore=${id}` });
  expect(screen.getByText("That restore link isn't valid. Open the deleted bill from the log.")).toBeInTheDocument();
  await screen.findByRole("link", { name: "Priya Sharma" });
  expect(calls.some((c) => c.url === "bin/")).toBe(false);
});
