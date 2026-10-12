import { cleanup, fireEvent, render, screen, waitFor, act } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { AuthContext, type Me } from "@/core/auth/AuthProvider";
import { ToastProvider } from "@/core/ui";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { OWNER, renderApp, stubAuth, testQueryClient } from "@/test/render";
import { serve } from "@/test/server";
import CapturePage from "./CapturePage";
import { AddPhotosCard, DeviceRows } from "./parts";
import type { QueuedCapture } from "@/core/captures/store";
import { captureFixture, readFixture } from "@/core/captures/fixtures";

const upload = vi.hoisted(() => ({ items: [], loading: false, error: null, busy: null, add: vi.fn(), retry: vi.fn(), remove: vi.fn() }));
vi.mock("@/core/captures/useUploads", () => ({ useUploads: () => upload }));
vi.mock("@/core/scope", () => ({ useFirms: () => ({ firms: [{ id: 3, name: "Kiran Gold House" }], loading: false, error: false }), useScope: () => ({ firmId: 3, ready: true }) }));
vi.mock("@/core/prefs", () => ({ usePrefs: () => ({ prefs: { defaultBusinessId: "3" }, ready: true }) }));
const empty = { results: [], count: 0, counts: { reading: 0, ready: 0, failed: 0, no_firm: 0 } };
beforeEach(() => { localStorage.clear(); upload.add.mockReset().mockResolvedValue(undefined); serve({ "GET captures/": empty }); });
afterEach(() => { cleanup(); vi.useRealTimers(); (window as unknown as { __phone: boolean }).__phone = false; });
it("keeps firm, hint and note with the chosen bill and clears them after durable queueing", async () => {
  renderApp(<CapturePage />);
  fireEvent.change(await screen.findByLabelText("Buying firm"), { target: { value: "" } });
  fireEvent.change(screen.getByLabelText("Supplier (optional)"), { target: { value: "Solanki Jewellers" } });
  fireEvent.change(screen.getByLabelText("Note (optional)"), { target: { value: "Stall 9" } });
  const file = new File(["bill"], "bill.png", { type: "image/png" });
  fireEvent.change(screen.getByLabelText("Choose files"), { target: { files: [file] } });
  await waitFor(() => expect(upload.add).toHaveBeenCalledWith([file], { businessId: null, hint: "Solanki Jewellers", note: "Stall 9", asPages: false }));
  await waitFor(() => expect(screen.getByLabelText("Note (optional)")).toHaveValue(""));
  expect(screen.getByLabelText("Supplier (optional)")).toHaveValue("");
  expect(localStorage.getItem("gst3.capture.firm.1")).toBe("later");
});
it("asks pages or bills and keeps all files together when one bill is chosen", async () => {
  renderApp(<CapturePage />);
  await screen.findByLabelText("Choose files");
  vi.useFakeTimers({ toFake: ["Date"] });
  const files = [1, 2].map((n) => new File(["bill"], `${n}.png`, { type: "image/png" }));
  fireEvent.change(screen.getByLabelText("Choose files"), { target: { files } });
  expect(screen.getByRole("dialog", { name: "You chose 2 files" })).toBeVisible();
  vi.setSystemTime(Date.now() + 400);
  await act(async () => fireEvent.click(screen.getByRole("button", { name: "One bill with 2 pages" })));
  expect(upload.add).toHaveBeenCalledWith(files, expect.objectContaining({ asPages: true }));
});
it("does not clear capture notes when device storage refuses the files", async () => {
  upload.add.mockRejectedValue(new Error("This browser couldn't keep the files. Keep this page open and try again."));
  renderApp(<CapturePage />);
  fireEvent.change(await screen.findByLabelText("Note (optional)"), { target: { value: "Stall 9" } });
  fireEvent.change(screen.getByLabelText("Choose files"), { target: { files: [new File(["bill"], "bill.png", { type: "image/png" })] } });
  expect(await screen.findByText("This browser couldn't keep the files. Keep this page open and try again.")).toBeVisible();
  expect(screen.getByLabelText("Note (optional)")).toHaveValue("Stall 9");
});
it("phone exposes the camera and gallery with their original accessible names", async () => {
  (window as unknown as { __phone: boolean }).__phone = true;
  renderApp(<CapturePage />);
  expect(await screen.findByRole("heading", { name: "Capture a supplier's bill" })).toBeVisible();
  expect(screen.getByLabelText("Take a photo of the bill")).toHaveAttribute("capture", "environment");
  expect(screen.getByLabelText("Choose bill photos or PDFs")).toHaveAttribute("multiple");
});
it("viewer can see captures but cannot choose or upload files", async () => {
  renderApp(<CapturePage />, { me: { role: "viewer", permissions: ["view"] } });
  expect(await screen.findByText("Only the owner, the accountant and counter staff can take photos of supplier bills. Ask the owner if you need it.")).toBeVisible();
  expect(screen.queryByLabelText("Choose files")).not.toBeInTheDocument();
});

it("rejects invalid files by name while queueing the accepted photo", async () => {
  renderApp(<CapturePage />);
  const good = new File(["bill"], "bill.png", { type: "image/png" });
  const bad = new File(["data"], "not-a-bill.csv", { type: "text/csv" });
  fireEvent.change(await screen.findByLabelText("Choose files"), { target: { files: [bad, good] } });
  expect(await screen.findByText("1 file wasn't added")).toBeVisible();
  expect(screen.getByText("not-a-bill.csv: Choose a photo (JPEG, PNG or HEIC) or a PDF.")).toBeVisible();
  await waitFor(() => expect(upload.add).toHaveBeenCalledWith([good], expect.anything()));
});
it("nine chosen files can be separate bills but cannot become a nine-page bill", async () => {
  renderApp(<CapturePage />);
  const files = Array.from({ length: 9 }, (_, n) => new File(["bill"], `${n}.png`, { type: "image/png" }));
  fireEvent.change(await screen.findByLabelText("Choose files"), { target: { files } });
  expect(screen.getByRole("button", { name: "One bill with 9 pages" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "9 separate bills" })).toBeEnabled();
  expect(screen.getByText("A bill can have at most 8 pages here.")).toBeVisible();
});
it("today includes filled captures without counting them as waiting in the inbox", async () => {
  const filled = captureFixture({ captured_at: new Date().toISOString(), status: 'filled', purchase: { id: 905, invoice_number: 'UBS/26-27/0866', invoice_date: '2026-10-07', supplier_name: 'Udaipur Bullion Suppliers', total_amount: '298817.46', business_name: 'Kiran Gold House' } });
  const calls = serve({ 'GET captures/': { ...empty, results: [filled], count: 1 } });
  renderApp(<CapturePage />);
  expect(await screen.findByText('Saved as a purchase')).toBeVisible();
  expect(screen.getByText('The inbox is empty')).toBeVisible();
  expect(screen.getByRole('link', { name: 'Open' })).toHaveAttribute('href', '/purchases/905');
  expect(calls[0].params.status).toBe('all');
});
it('retries the same single file and notes after IndexedDB rejects the first queue write', async () => {
  upload.add.mockRejectedValueOnce(new Error("This browser couldn't keep the files. Keep this page open and try again.")).mockResolvedValueOnce(undefined);
  renderApp(<CapturePage />);
  fireEvent.change(await screen.findByLabelText('Supplier (optional)'), { target: { value: 'Solanki Jewellers' } });
  fireEvent.change(screen.getByLabelText('Note (optional)'), { target: { value: 'Stall 9' } });
  const file = new File(['bill'], 'same-bill.png', { type: 'image/png' });
  fireEvent.change(screen.getByLabelText('Choose files'), { target: { files: [file] } });
  fireEvent.click(await screen.findByRole('button', { name: 'Try keeping this file again' }));
  await waitFor(() => expect(upload.add).toHaveBeenCalledTimes(2));
  expect(upload.add.mock.calls[0][0][0]).toBe(file);
  expect(upload.add.mock.calls[1][0][0]).toBe(file);
  expect(upload.add.mock.calls[1][1]).toEqual({ businessId: 3, hint: 'Solanki Jewellers', note: 'Stall 9', asPages: false });
  await waitFor(() => expect(screen.getByLabelText('Note (optional)')).toHaveValue(''));
  expect(screen.queryByRole('button', { name: 'Try keeping this file again' })).not.toBeInTheDocument();
});
it.each([false, true])("keeps a ready capture visible when the server could not read its date (phone=%s)", async (phone) => {
  (window as unknown as { __phone: boolean }).__phone = phone;
  const read = readFixture({ invoice_date: null, notes: ["Check the date printed on the bill."] });
  const capture = captureFixture({ captured_at: new Date().toISOString(), status: "ready", read });
  serve({ "GET captures/": { results: [capture], count: 1, counts: { reading: 0, ready: 1, failed: 0, no_firm: 0 } } });
  renderApp(<CapturePage />);
  expect(await screen.findByText("Ready to fill in")).toBeVisible();
  expect(screen.getByText(/dated —, total/)).toBeVisible();
  expect(screen.getByRole("link", { name: "Fill in" })).toHaveAttribute("href", "/purchases/inbox/12");
});

it.each([false, true])('offers only local removal for a missing uploaded capture (phone=%s)', async phone => {
  (window as unknown as { __phone: boolean }).__phone = phone;
  const remove = vi.fn().mockResolvedValue(undefined);
  const item: QueuedCapture = { clientId: 'purged-receipt', userId: 1, businessId: null, hint: 'Synthetic bill', note: '',
    files: [new File(['synthetic'], 'bill.pdf', { type: 'application/pdf' })], createdAt: '2026-10-12T00:00:00Z',
    captureId: 12, phase: 'uploaded', missing: true, error: "This photo is no longer in the inbox. Remove this saved upload from this device." };
  renderApp(<DeviceRows uploads={{ ...upload, items: [item], remove }} />);
  expect(screen.queryByRole('button', { name: 'Try now' })).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Open the inbox' })).not.toBeInTheDocument();
  expect(screen.queryByText('Uploaded: waiting to be read')).not.toBeInTheDocument();
  expect(screen.queryByText(/The photo is in the inbox/)).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: `Remove from this ${phone ? 'phone' : 'computer'}` }));
  expect(remove).toHaveBeenCalledExactlyOnceWith('purged-receipt');
});

const row = (patch: Partial<QueuedCapture>): QueuedCapture => ({ clientId: 'row-1', userId: 1, businessId: null, hint: 'Synthetic bill', note: '',
  files: [new File(['synthetic'], 'bill.pdf', { type: 'application/pdf' })], createdAt: '2026-10-12T00:00:00Z',
  captureId: null, phase: 'queued', error: null, ...patch });
it('says a refused upload waits for Try now instead of promising it goes up by itself', () => {
  renderApp(<DeviceRows uploads={{ ...upload, items: [row({ error: 'Choose a firm you can buy for.', autoRetry: false })] }} />);
  expect(screen.getByText(/Choose a firm you can buy for\. It won't go up by itself: press Try now when it's fixed, or remove it from this computer\./)).toBeVisible();
  expect(screen.queryByText(/goes up by itself when the internet is back/)).not.toBeInTheDocument();
  cleanup();
  renderApp(<DeviceRows uploads={{ ...upload, items: [row({ error: "You're offline", autoRetry: true })] }} />);
  expect(screen.getByText(/You're offline\. The photo isn't lost: it goes up by itself when the internet is back\./)).toBeVisible();
});
it('names the link of an uploaded row for where it goes', () => {
  renderApp(<DeviceRows uploads={{ ...upload, items: [row({ phase: 'uploaded', captureId: 12 })] }} />);
  expect(screen.getByRole('link', { name: 'Open the photo' })).toHaveAttribute('href', '/purchases/inbox/12');
  expect(screen.queryByRole('link', { name: 'Open the inbox' })).not.toBeInTheDocument();
});
it('says so when a file is chosen while the last files are still being kept', async () => {
  upload.add.mockReturnValue(new Promise(() => {}));
  renderApp(<CapturePage />);
  const first = new File(['bill'], 'first.png', { type: 'image/png' });
  fireEvent.change(await screen.findByLabelText('Choose files'), { target: { files: [first] } });
  await waitFor(() => expect(upload.add).toHaveBeenCalledOnce());
  fireEvent.change(screen.getByLabelText('Choose files'), { target: { files: [new File(['bill'], 'second.png', { type: 'image/png' })] } });
  expect(await screen.findByText('Wait until the last files are kept on this computer, then choose this one again.')).toBeVisible();
  expect(upload.add).toHaveBeenCalledOnce();
});
it('remembers the buying firm per person when the person changes while the card stays open', () => {
  localStorage.setItem('gst3.capture.firm.1', 'later'); localStorage.setItem('gst3.capture.firm.2', '3');
  const client = testQueryClient();
  const tree = (me: Partial<Me>) => <QueryClientProvider client={client}><AuthContext.Provider value={stubAuth(me)}>
    <MemoryRouter><ToastProvider><AddPhotosCard uploads={upload} /></ToastProvider></MemoryRouter></AuthContext.Provider></QueryClientProvider>;
  const view = render(tree(OWNER));
  expect(screen.getByLabelText('Buying firm')).toHaveValue('');
  view.rerender(tree({ id: 2 }));
  expect(screen.getByLabelText('Buying firm')).toHaveValue('3');
});
