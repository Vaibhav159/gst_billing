import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mount as mountRoutes } from "@/pages/customers/testing";
import type { Me } from "@/core/auth/AuthProvider";
import { serve as serveAll, type Call, type Answer } from "@/test/server";
import PhotoImport, { type PhotoEditorProps } from "./PhotoImport";
import { firms, read } from "./fixtures";
import * as captureFiles from "@/core/captures/files";
import type { ImportBody } from "../batch";
const meter = { used: 1212, month: "2026-10" };
function answer(c: Call) { const body = c.data as ImportBody; return { status: 200, data: { dry_run: body.dry_run, ok: true, bills: body.bills.map((b, i) => ({ ref: b.ref, ok: true, id: body.dry_run ? null : 901 + i, problems: [], duplicate: null, credit: null })), totals: { bills: body.bills.length, total_amount: "298817.46", credit: "8703.42" } } }; }
const serve = (answers: Record<string, Answer>) => serveAll({ "POST purchases/import/": answer, "POST sales/import/": answer, ...answers });
function Editor({ row, onApply }: PhotoEditorProps) { return <button onClick={() => onApply({ ...row, read: { ...row.read!, invoice_number: "EDITED-7" } })}>Use these details</button>; }
const mount = (me?: Partial<Me>) => mountRoutes([{ path: "/purchases/ai-import", element: <PhotoImport firms={firms} Editor={Editor} /> }, { path: "/purchases", element: <p>Purchase list</p> }], ["/purchases/ai-import"], { me });
function upload(names = ["synthetic.jpg"]) { fireEvent.change(screen.getByLabelText("Choose files"), { target: { files: names.map((n) => new File([`synthetic bill: ${n}`], n, { type: "image/jpeg" })) } }); }
beforeEach(() => { vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 100, height: 100, close: vi.fn() }))); URL.createObjectURL = vi.fn(() => "blob:synthetic"); URL.revokeObjectURL = vi.fn(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); (window as unknown as { __phone?: boolean }).__phone = false; });
it("denies the phone before any AI read and gives the capture route", () => {
  (window as unknown as { __phone?: boolean }).__phone = true;
  const calls = serve({}); mount(); expect(screen.getByText("Imports are done on the computer")).toBeVisible(); expect(screen.getByRole("link", { name: "Capture a bill" })).toHaveAttribute("href", "/capture"); expect(calls.filter((c) => c.url === "ai-reads/" || c.url === "purchases/read/")).toHaveLength(0);
});
it("hides upload from a viewer", () => {
  const calls = serve({}); mount({ role: "viewer", permissions: ["view"] }); expect(screen.queryByRole("button", { name: "Choose files" })).not.toBeInTheDocument(); expect(calls.filter((c) => c.url === "ai-reads/" || c.url === "purchases/read/")).toHaveLength(0);
});
it("reads multipart, validates then imports exact data, and frees its preview", async () => {
  const calls = serve({ "GET ai-reads/": meter, "POST purchases/read/": read, "POST purchases/import/": answer }); const view = mount(); upload();
  const button = await screen.findByRole("button", { name: "Import 1 purchase bill" });
  const form = calls.find((c) => c.url === "purchases/read/")!.data as FormData;
  expect(form.get("kind")).toBe("photos"); expect((form.get("files") as File).name).toBe("synthetic.jpg");
  fireEvent.click(button); expect(await screen.findByRole("link", { name: "Open purchase" })).toHaveAttribute("href", "/purchases/901");
  expect(calls.filter((c) => c.url === "purchases/import/").map((c) => (c.data as ImportBody).dry_run)).toEqual([true, true, false]);
  view.unmount(); expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:synthetic");
});
it("opens the shared editor beside the photo and applies only to that row", async () => {
  serve({ "GET ai-reads/": meter, "POST purchases/read/": read }); mount(); upload();
  await screen.findByRole("button", { name: "Import 1 purchase bill" });
  fireEvent.click(screen.getByRole("button", { name: "Check and edit" }));
  const dialog = screen.getByRole("dialog", { name: "Check purchase bill · synthetic.jpg" }); expect(within(dialog).getByRole("img", { name: "Photo synthetic.jpg, page 1" })).toBeVisible();
  const now = Date.now(); vi.spyOn(Date, "now").mockReturnValue(now + 400);
  fireEvent.click(within(dialog).getByRole("button", { name: "Use these details" })); expect(await screen.findByText("EDITED-7")).toBeVisible();
});
it("never sends a pair as a separate sale and blocks it for an accountant", async () => {
  const pair = { ...read, seller_business: 2 };
  const calls = serve({ "GET ai-reads/": meter, "POST purchases/read/": pair, "POST purchases/import/": answer }); mount(); upload();
  fireEvent.click(await screen.findByRole("button", { name: "Import 1 purchase bill and 1 sales bill" }));
  await screen.findByRole("link", { name: "Open purchase" }); expect(calls.some((c) => c.url === "sales/import/")).toBe(false);
  expect((calls.find((c) => c.url === "purchases/import/")!.data as ImportBody).bills[0].pair?.seller).toBe(2);
  cleanup(); const denied = serve({ "GET ai-reads/": meter, "POST purchases/read/": pair }); mount({ role: "accountant", permissions: ["view", "purchase.import"] }); upload();
  await screen.findAllByText("Not for your role"); expect(screen.getByRole("button", { name: "Nothing ready yet" })).toBeDisabled();
  expect(denied.filter((c) => c.url === "purchases/import/" || c.url === "sales/import/")).toHaveLength(0);
});
it("shows the server's failed-read words and retries only on a user's press", async () => {
  const detail = "This bill couldn't be read just now. Nothing was filled in; try again in a moment."; let attempts = 0;
  const calls = serve({ "GET ai-reads/": meter, "POST purchases/read/": () => ++attempts === 1 ? { status: 502, data: { detail, code: "read_failed" } } : { status: 200, data: read } }); mount(); upload();
  expect(await screen.findByText(detail)).toBeVisible(); expect(calls.filter((c) => c.url === "purchases/read/")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Try again" })); await screen.findByRole("button", { name: "Import 1 purchase bill" }); expect(attempts).toBe(2);
});
it("shows the read count without a cap and never refuses a read for volume", async () => {
  const calls = serve({ "GET ai-reads/": { ...meter, used: 50000 }, "POST purchases/read/": read }); mount(); await screen.findByText("50,000");
  expect(calls.filter((c) => c.url === "purchases/read/")).toHaveLength(0); upload();
  await screen.findByRole("button", { name: "Import 1 purchase bill" }); expect(calls.filter((c) => c.url === "purchases/read/")).toHaveLength(1); expect(screen.queryByText(/used up/)).not.toBeInTheDocument();
});

it("runs at most two file reads at once without polling", async () => {
  const settle: (() => void)[] = [];
  const calls = serve({ "GET ai-reads/": meter, "POST purchases/read/": () => new Promise((resolve) => settle.push(() => resolve({ status: 200, data: read }))) }); mount(); upload(["one.jpg", "two.jpg", "three.jpg"]);
  await waitFor(() => expect(settle).toHaveLength(2)); expect(calls.filter((c) => c.url === "purchases/read/")).toHaveLength(2);
  await act(async () => settle[0]()); await waitFor(() => expect(settle).toHaveLength(3)); await act(async () => { settle[1](); settle[2](); });
});
it("maps dry-run refusals and duplicates to the row without a save", async () => {
  const calls = serve({ "GET ai-reads/": meter, "POST purchases/read/": read, "POST purchases/import/": (c: Call) => ({ status: 200, data: { ...answer(c).data, ok: false, bills: [{ ref: (c.data as ImportBody).bills[0].ref, ok: false, id: null, problems: [{ field: "itc_month", detail: "Choose an open credit month." }], duplicate: { id: 84, invoice_number: "UBS/26-27/0866" }, credit: null }] } }) });
  mount(); upload();
  expect(await screen.findByText("Choose an open credit month.")).toBeVisible();
  expect(screen.getByRole("link", { name: "Open it" })).toHaveAttribute("href", "/purchases/84");
  expect(calls.filter((c) => c.url === "purchases/import/")).toHaveLength(1);
});
it("validates Add more files as well as the first upload", async () => {
  const calls = serve({ "GET ai-reads/": meter, "POST purchases/read/": read }); mount(); upload(); await screen.findByRole("button", { name: "Import 1 purchase bill" });
  fireEvent.change(screen.getByLabelText("Add more bill photos or PDFs"), { target: { files: [new File(["synthetic"], "bad.txt", { type: "text/plain" })] } });
  expect(await screen.findByText("bad.txt: Choose a photo (JPEG, PNG or HEIC) or a PDF.")).toBeVisible(); expect(calls.filter((c) => c.url === "purchases/read/")).toHaveLength(1);
});
it("asks before leaving unread or unimported photos", async () => {
  serve({ "GET ai-reads/": meter, "POST purchases/read/": read }); const view = mount(); upload(); await screen.findByRole("button", { name: "Import 1 purchase bill" });
  await act(async () => view.router.navigate("/purchases")); expect(screen.getByRole("dialog", { name: "Leave without saving?" })).toBeVisible();
});
it("reuses a successful read when the browser returns a new File object for the same page", async () => {
  const calls = serve({ "GET ai-reads/": meter, "POST purchases/read/": read }); mount();
  const choose = () => fireEvent.change(screen.getByLabelText("Choose files"), { target: { files: [new File(["synthetic"], "same.jpg", { type: "image/jpeg", lastModified: 123 })] } });
  choose(); await screen.findByRole("button", { name: "Import 1 purchase bill" });
  await act(async () => { window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); });
  expect(calls.filter((c) => c.url === "purchases/read/")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Remove" })); choose();
  await screen.findByRole("button", { name: "Import 1 purchase bill" }); expect(calls.filter((c) => c.url === "purchases/read/")).toHaveLength(1);
});
it("reads distinct bytes even when file name, size and modification time are identical", async () => {
  const calls = serve({ "GET ai-reads/": meter, "POST purchases/read/": read }); mount();
  const choose = (bytes: string) => fireEvent.change(screen.getByLabelText("Choose files"), { target: { files: [new File([bytes], "same.jpg", { type: "image/jpeg", lastModified: 123 })] } });
  choose("first"); await screen.findByRole("button", { name: "Import 1 purchase bill" });
  fireEvent.click(screen.getByRole("button", { name: "Remove" })); choose("other");
  await screen.findByRole("button", { name: "Import 1 purchase bill" });
  expect(calls.filter((c) => c.url === "purchases/read/")).toHaveLength(2);
});
it("shares one pending read between identical pages selected together", async () => {
  let finish!: () => void;
  const calls = serve({ "GET ai-reads/": meter, "POST purchases/read/": () => new Promise((resolve) => { finish = () => resolve({ status: 200, data: read }); }) }); mount();
  fireEvent.change(screen.getByLabelText("Choose files"), { target: { files: ["first.jpg", "copy.jpg"].map((name) => new File(["same original page"], name, { type: "image/jpeg" })) } });
  await waitFor(() => expect(calls.filter((c) => c.url === "purchases/read/")).toHaveLength(1));
  await act(async () => { finish(); });
  await screen.findByRole("button", { name: "Import 2 purchase bills" });
  expect(calls.filter((c) => c.url === "purchases/read/")).toHaveLength(1);
});
it("links a sales photo to the existing customer and preserves partial success across endpoints", async () => {
  const saleRead = { ...read, seller_business: 2, buyer: { name: "Anil Gupta", gst_number: read.supplier.gst_number, business: null } };
  const calls = serve({ "GET ai-reads/": meter, "GET customers/": { results: [{ id: 51, name: "Anil Gupta", gst_number: read.supplier.gst_number }], count: 1, next: null }, "POST purchases/read/": (c: Call) => ({ status: 200, data: (c.data as FormData).get("files") instanceof File && ((c.data as FormData).get("files") as File).name === "sale.jpg" ? saleRead : read }), "POST purchases/import/": answer, "POST sales/import/": (c: Call) => (c.data as ImportBody).dry_run ? answer(c) : { status: 403, data: { detail: "Only the owner and counter staff can make bills." } } });
  mount(); upload(["purchase.jpg", "sale.jpg"]); fireEvent.click(await screen.findByRole("button", { name: "Import 1 purchase bill and 1 sales bill" }, { timeout: 5000 }));
  expect(await screen.findByRole("link", { name: "Open purchase" })).toHaveAttribute("href", "/purchases/901");
  expect(await screen.findByText("Some bills were imported")).toBeVisible();
  const sales = calls.filter((c) => c.url === "sales/import/"); expect((sales[0].data as ImportBody).bills[0].customer).toBe(51); expect((sales[0].data as ImportBody).customers).toHaveLength(0);
  expect(screen.getByRole("button", { name: "Import 1 sales bill" })).toBeEnabled();
});
it("automatically prechecks one batch only after every queued photo settles", async () => {
  const settle: (() => void)[] = [];
  const calls = serve({ "GET ai-reads/": meter, "POST purchases/read/": () => new Promise((resolve) => settle.push(() => resolve({ status: 200, data: read }))), "POST purchases/import/": answer });
  mount(); upload(["one.jpg", "two.jpg", "three.jpg"]);
  await waitFor(() => expect(settle).toHaveLength(2)); await act(async () => settle[0]()); await waitFor(() => expect(settle).toHaveLength(3));
  await act(async () => settle[1]()); expect(calls.filter((c) => c.url === "purchases/import/")).toHaveLength(0);
  await act(async () => settle[2]());
  await waitFor(() => expect(calls.filter((c) => c.url === "purchases/import/")).toHaveLength(1));
  expect((calls.find((c) => c.url === "purchases/import/")!.data as ImportBody).bills).toHaveLength(3);
  await waitFor(() => expect(screen.getByRole("button", { name: "Import 3 purchase bills" })).toBeEnabled());
  expect(calls.filter((c) => c.url === "purchases/import/").map((c) => (c.data as ImportBody).dry_run)).toEqual([true]);
  expect(calls.filter((c) => c.url === "purchases/read/")).toHaveLength(3);
});
it("invalidates automatic prechecks on selection and edits without rereading photos", async () => {
  const calls = serve({ "GET ai-reads/": meter, "POST purchases/read/": read, "POST purchases/import/": answer }); mount(); upload(["one.jpg", "two.jpg"]);
  await waitFor(() => expect(calls.filter((c) => c.url === "purchases/import/")).toHaveLength(1));
  await waitFor(() => expect(screen.getByRole("button", { name: "Import 2 purchase bills" })).toBeEnabled());
  fireEvent.click(screen.getByRole("checkbox", { name: `Import ${read.invoice_number} from two.jpg` }));
  await waitFor(() => expect(calls.filter((c) => c.url === "purchases/import/")).toHaveLength(2));
  await waitFor(() => expect(screen.getByRole("button", { name: "Import 1 purchase bill" })).toBeEnabled());
  fireEvent.click(within(screen.getByRole("region", { name: "one.jpg" })).getByRole("button", { name: "Check and edit" }));
  const dialog = screen.getByRole("dialog"), now = Date.now(); vi.spyOn(Date, "now").mockReturnValue(now + 400); fireEvent.click(within(dialog).getByRole("button", { name: "Use these details" }));
  await waitFor(() => expect(calls.filter((c) => c.url === "purchases/import/")).toHaveLength(3));
  const checked = calls.filter((c) => c.url === "purchases/import/").map((c) => c.data as ImportBody);
  expect(checked.map((b) => b.bills.length)).toEqual([2, 1, 1]); expect(checked[2].bills[0].invoice_number).toBe("EDITED-7"); expect(checked.every((b) => b.dry_run)).toBe(true);
  expect(calls.filter((c) => c.url === "purchases/read/")).toHaveLength(2);
});
it("prepares the upload through capture core and keeps the original file for shared viewing and read reuse", async () => {
  const original = new File(["synthetic original"], "shared.jpg", { type: "image/jpeg" });
  const prepared = new File(["synthetic resized"], "shared.jpg", { type: "image/jpeg" });
  const prepare = vi.spyOn(captureFiles, "prepareFiles").mockResolvedValue([[prepared]]);
  const calls = serve({ "GET ai-reads/": meter, "POST purchases/read/": read }); mount();
  const choose = () => fireEvent.change(screen.getByLabelText("Choose files"), { target: { files: [original] } }); choose();
  await screen.findByRole("button", { name: "Import 1 purchase bill" });
  expect(prepare).toHaveBeenCalledWith([original], true);
  expect((calls.find((c) => c.url === "purchases/read/")!.data as FormData).get("files")).toBe(prepared);
  fireEvent.click(screen.getByRole("button", { name: "Check and edit" }));
  const dialog = screen.getByRole("dialog"); expect(within(dialog).getByRole("button", { name: "Zoom in" })).toBeVisible();
  expect(within(dialog).getByRole("link", { name: "Open original" })).toHaveAttribute("href", "blob:synthetic");
});
it("shows the server's late credit month and claimed amount, then clears them while an edit is checked", async () => {
  const credit = { month: "2026-11", chosen: "2026-11", late: true, eligible: true, lapsed: false, claimed: "17.23", state: "open", filed_on: null, deadline: "2027-11-30" };
  let finish!: () => void;
  let checks = 0;
  const reply = (c: Call) => ({ status: 200, data: { ...answer(c).data, bills: answer(c).data.bills.map((b) => ({ ...b, credit })) } });
  serve({ "GET ai-reads/": meter, "POST purchases/read/": read, "POST purchases/import/": (c: Call) => ++checks === 1 ? reply(c) : new Promise((resolve) => { finish = () => resolve(reply(c)); }) });
  mount(); upload();
  const creditGroup = await screen.findByRole("group", { name: "Input tax credit for synthetic.jpg" });
  expect(creditGroup).toHaveTextContent("₹17.23"); expect(creditGroup).not.toHaveTextContent("₹8,703.42");
  expect(creditGroup).toHaveTextContent("In Kiran's GSTR-3B for November 2026 (entered late)"); expect(creditGroup).toHaveTextContent("November 2026 · not filed yet");
  expect(creditGroup).toHaveTextContent("net credit, 4(C)");
  fireEvent.click(screen.getByRole("button", { name: "Check and edit" })); const dialog = screen.getByRole("dialog"), now = Date.now(); vi.spyOn(Date, "now").mockReturnValue(now + 400);
  fireEvent.click(within(dialog).getByRole("button", { name: "Use these details" })); await waitFor(() => expect(checks).toBe(2));
  expect(screen.queryByRole("group", { name: "Input tax credit for synthetic.jpg" })).not.toBeInTheDocument();
  await act(async () => finish()); expect(await screen.findByRole("group", { name: "Input tax credit for synthetic.jpg" })).toHaveTextContent("₹17.23");
});
it("shows server-decided lapsed, unclaimed and filed credit without turning tax into credit", async () => {
  const lapsed = { month: "2026-10", chosen: "2026-10", late: true, eligible: true, lapsed: true, claimed: "0.00", state: "filed", filed_on: "2026-11-20", deadline: "2025-11-30" };
  const unclaimed = { ...lapsed, late: false, eligible: false, lapsed: false, state: "open", filed_on: null };
  serve({ "GET ai-reads/": meter, "POST purchases/read/": read, "POST purchases/import/": (c: Call) => ({ status: 200, data: { ...answer(c).data, bills: answer(c).data.bills.map((b, i) => ({ ...b, credit: i === 0 ? lapsed : unclaimed })) } }) });
  mount(); upload(["lapsed.jpg", "unclaimed.jpg"]);
  const first = await screen.findByRole("group", { name: "Input tax credit for lapsed.jpg" });
  expect(first).toHaveTextContent("₹0.00"); expect(first).toHaveTextContent("October 2026 · GSTR-3B filed"); expect(first).toHaveTextContent("Filed on 20 Nov 2026");
  expect(first).toHaveTextContent("Its credit had to be claimed in a return filed by 30 Nov 2025, so this bill carries no credit now. It still counts in purchases.");
  const second = screen.getByRole("group", { name: "Input tax credit for unclaimed.jpg" }); expect(second).toHaveTextContent("₹0.00"); expect(second).toHaveTextContent("Not claimed on this bill"); expect(second).toHaveTextContent("October 2026 · not filed yet");
});
it("shows nullable outside-ledger credit without inventing a claim month", async () => {
  const credit = { month: null, chosen: null, late: false, eligible: true, lapsed: false, claimed: "0.00", state: "outside", filed_on: null, deadline: "2025-11-30" };
  const calls = serve({ "GET ai-reads/": meter, "POST purchases/read/": { ...read, invoice_date: "2025-03-31" }, "POST purchases/import/": (c: Call) => ({ status: 200, data: { ...answer(c).data, bills: answer(c).data.bills.map((b) => ({ ...b, credit })) } }) });
  mount(); upload();
  const creditGroup = await screen.findByRole("group", { name: "Input tax credit for synthetic.jpg" });
  expect(creditGroup).toHaveTextContent("This bill is before April 2025. Its credit is in the opening balance or lapsed.");
  expect(creditGroup).toHaveTextContent("₹0.00"); expect(creditGroup).not.toHaveTextContent("not filed yet"); expect(creditGroup).not.toHaveTextContent("GSTR-3B for");
  expect((calls.find((c) => c.url === "purchases/import/")!.data as ImportBody).bills[0].itc_month).toBeNull();
});
it("labels the read fields and their confidence beside a manually zoomed real photo", async () => {
  serve({ "GET ai-reads/": meter, "POST purchases/read/": read }); mount(); upload(); await screen.findByRole("button", { name: "Import 1 purchase bill" });
  fireEvent.click(screen.getByRole("button", { name: "Check and edit" }));
  const dialog = screen.getByRole("dialog");
  const dateGroup = within(dialog).getByRole("group", { name: "date" });
  expect(dateGroup).toHaveTextContent("2026-10-07"); expect(dateGroup).toHaveTextContent("Needs a check");
  expect(within(dialog).getByRole("group", { name: "bill number" })).toHaveTextContent(read.invoice_number);
  expect(within(dialog).getByRole("group", { name: "quantities and rates" })).toHaveTextContent("₹2,98,817.46");
  const photo = within(dialog).getByRole("group", { name: "Photo synthetic.jpg. Use + and − to zoom, drag or scroll to move around." });
  expect(within(photo).getByRole("img")).toHaveAttribute("src", "blob:synthetic");
  expect(photo.querySelector("[data-focused], [data-field], [data-box]")).toBeNull();
  const now = Date.now(); vi.spyOn(Date, "now").mockReturnValue(now + 400);
  fireEvent.click(within(dialog).getByRole("button", { name: "Zoom in" })); expect(within(dialog).getByText("150%")).toBeVisible();
});
it("keeps the shared total upload refusal on the row without sending it to AI", async () => {
  const prepare = captureFiles.prepareFiles;
  vi.spyOn(captureFiles, "prepareFiles").mockImplementation((files, asPages) => prepare(files, asPages, async (file) => {
    const resized = new File(["synthetic prepared bytes"], file.name, { type: "image/jpeg" });
    Object.defineProperty(resized, "size", { value: 25 * 1024 * 1024 }); return resized;
  }));
  const calls = serve({ "GET ai-reads/": meter }); mount(); upload();
  expect(await screen.findByText("These pages come to 25.0 MB. One bill can send at most 24 MB; take fewer or smaller pages.")).toBeVisible();
  expect(calls.filter((c) => c.url === "purchases/read/")).toHaveLength(0);
  expect(screen.getByRole("button", { name: "Try again" })).toBeEnabled();
});
