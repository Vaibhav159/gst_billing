import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { onlineManager, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, Route, RouterProvider, Routes, type RouteObject } from "react-router";
import { AuthContext } from "@/core/auth/AuthProvider";
import { printBill } from "@/core/print/model";
import { loadedPage } from "@/core/router/lazyPage";
import { appRoutes } from "@/core/router/routes";
import { FIRM, OTHER_FIRM, refuse, salesServer, wireDetail, wirePage, wireRow } from "@/core/sales/fixtures";
import { toBillDetail } from "@/core/sales/wire";
import { ToastProvider } from "@/core/ui";
import { renderApp, stubAuth, testQueryClient } from "@/test/render";
import { checkQr, QrCheckButton, useQrCheck } from "./QrCheck";
import ScanPage from "./ScanPage";

const FIRMS = [FIRM, OTHER_FIRM].map((f) => ({ id: f.id, name: f.name, short: f.name.split(" ")[0], gstin: f.gst_number, state: f.state_name }));
const CODE = "KGH/2026-27/31|08ABCPK1234F1Z5|2026-10-08|87083.21";
const NONE = { invoice_number: "KGH/2026-27/40", counter: 40, code: "", problem: "", bill: null, binned: null, note: "", same_counter: null, next: { counter: 35, invoice_number: "KGH/2026-27/35" } };
const DELETED = { ...NONE, invoice_number: "KGH/2026-27/27", code: "number_deleted", binned: { id: 4, original_id: 205, invoice_number: "KGH/2026-27/27", invoice_date: "2026-09-24", reason: "Entered twice by mistake", deleted_at: "2026-10-03T18:40:00+05:30" } };

/** The server's bills by number: the contract's KGH/2026-27/31, and whatever `over` says for other numbers. */
function serve(over: Record<string, Record<string, unknown> | null> = {}) {
  return salesServer([
    ["GET", "sales/", ({ params }) => {
      const n = String(params.number);
      const row = n in over ? over[n] : n === "KGH/2026-27/31" ? wireRow() : null;
      return wirePage(row ? [row] : []);
    }],
    ["GET", "sales/check-number/", ({ params }) => (params.invoice_number === "KGH/2026-27/27" ? DELETED : NONE)],
  ]);
}

test("a code that matches a bill: same firm, number, date and the total printed, to the paisa", async () => {
  const { calls } = serve();
  expect(await checkQr(CODE, FIRMS)).toMatchObject({ kind: "match", firm: { id: 3 }, bill: { id: 412 }, diffs: [] });
  expect(calls.find((c) => c.url === "sales/")?.params).toEqual({ business_id: 3, number: "KGH/2026-27/31", fy: "2026-27", page: 1, page_size: 10 });
  // v2's printouts until 2 Sep 2026 carried the total rounded to the rupee: that matches too
  expect(await checkQr("KGH/2026-27/31|08ABCPK1234F1Z5|2026-10-08|87083", FIRMS)).toMatchObject({ kind: "match" });
});

test("what doesn't match is named; a cancelled bill, a deleted number, an unknown number, another firm and junk say so", async () => {
  serve({ "KGH/2026-27/32": wireRow({ id: 413, invoice_number: "KGH/2026-27/32", status: "cancelled", cancel_reason: "Customer returned it" }) });
  expect(await checkQr("KGH/2026-27/31|08ABCPK1234F1Z5|2026-10-07|90000.00", FIRMS)).toMatchObject({
    kind: "mismatch", diffs: ["the date is 08 Oct 2026, the QR says 07 Oct 2026", "the total is ₹87,083.21, the QR says ₹90,000.00"],
  });
  expect(await checkQr("KGH/2026-27/32|08ABCPK1234F1Z5|2026-10-08|87083.21", FIRMS)).toMatchObject({ kind: "cancelled", bill: { id: 413 } });
  expect(await checkQr("KGH/2026-27/27|08ABCPK1234F1Z5|2026-09-24|45000.00", FIRMS)).toMatchObject({ kind: "deleted", binned: { original_id: 205 } });
  expect(await checkQr("KGH/2026-27/40|08ABCPK1234F1Z5|2026-10-08|100.00", FIRMS)).toMatchObject({ kind: "unknown", firm: { id: 3 } });
  expect(await checkQr("X/1|27AAACK1234L1ZN|2026-10-08|100.00", FIRMS)).toMatchObject({ kind: "otherfirm" });
  expect(await checkQr("hello", FIRMS)).toEqual({ kind: "unreadable" });
  // v2's bulk PDFs printed JSON with the firm's name and no date: the number and the total find the bill
  expect(await checkQr('{"inv":"KGH/2026-27/31","biz":"KIRAN GOLD HOUSE","total":87083.21}', FIRMS)).toMatchObject({ kind: "match", bill: { id: 412 } });
});

test("the dialog: a USB scanner types the code and presses Enter; a match opens its bill", async () => {
  serve();
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  try {
    renderApp(<Routes><Route path="/sales" element={<QrCheckButton />} /><Route path="/sales/:id" element={<p>the bill page</p>} /></Routes>, { path: "/sales" });
    await userEvent.click(screen.getByRole("button", { name: "Check a QR code" }));
    act(() => { vi.advanceTimersByTime(400); });
    const field = await screen.findByLabelText("Or type or paste what it says");
    await waitFor(() => expect(field).toHaveFocus());
    await userEvent.type(field, `${CODE}{Enter}`);
    expect(await screen.findByText("Matches KGH/2026-27/31")).toBeInTheDocument();
    expect(screen.getByText("KIRAN GOLD HOUSE · Anil Gupta · 08 Oct 2026 · ₹87,083.21. The bill is genuine and unchanged.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Open the bill" }));
    expect(await screen.findByText("the bill page")).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

test("a phone that reads codes with its camera: the code found is checked, and the camera stops", async () => {
  serve();
  const stop = vi.fn();
  const detect = vi.fn().mockResolvedValueOnce([]).mockResolvedValue([{ rawValue: CODE }]);
  Object.assign(globalThis, { BarcodeDetector: Object.assign(class { detect = detect; }, { getSupportedFormats: async () => ["qr_code"] }) });
  Object.assign(navigator, { mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] })) } });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"], shouldAdvanceTime: true });
  function Phone() { const q = useQrCheck(); return <><button type="button" onClick={q.item.onSelect}>{q.item.label}</button>{q.dialog}</>; }
  try {
    renderApp(<Phone />);
    await userEvent.click(screen.getByText("Check a QR code"));
    act(() => { vi.advanceTimersByTime(400); });
    await userEvent.click(await screen.findByRole("button", { name: "Scan with the camera" }));
    expect(screen.getByLabelText("The camera: hold the bill's QR code in the square")).toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(250); });
    await act(async () => { vi.advanceTimersByTime(250); });
    expect(await screen.findByText("Matches KGH/2026-27/31")).toBeInTheDocument();
    expect(detect).toHaveBeenCalledTimes(2);
    expect(stop).toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
    vi.restoreAllMocks();
    Object.assign(globalThis, { BarcodeDetector: undefined });
    Object.assign(navigator, { mediaDevices: undefined });
  }
});

/* ── Beyond the brief: the dispatch's rulings and carries ── */

const all = (routes: RouteObject[]): RouteObject[] => routes.flatMap((r) => [r, ...all(r.children ?? [])]);
/** The dialog as the list opens it, past its 350 ms guard: the field a USB scanner types into, focused. */
async function openDialog() {
  renderApp(<QrCheckButton />, { path: "/sales" });
  await userEvent.click(screen.getByRole("button", { name: "Check a QR code" }));
  act(() => { vi.advanceTimersByTime(400); });
  const field = await screen.findByLabelText("Or type or paste what it says");
  await waitFor(() => expect(field).toHaveFocus());
  return field as HTMLInputElement;
}
/** A browser that reads QR codes from the camera: `detect` answers each look, and stopping the camera calls `stop`. */
function aCamera(detect: () => Promise<{ rawValue: string }[]>, stop = vi.fn()) {
  Object.assign(globalThis, { BarcodeDetector: Object.assign(class { detect = detect; }, { getSupportedFormats: async () => ["qr_code"] }) });
  Object.assign(navigator, { mediaDevices: { getUserMedia: vi.fn(async () => ({ getTracks: () => [{ stop }] })) } });
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  return stop;
}
function noCamera() {
  vi.restoreAllMocks();
  Object.assign(globalThis, { BarcodeDetector: undefined });
  Object.assign(navigator, { mediaDevices: undefined });
}
/** The whole app at `path`, signed in as the owner, as App renders it. */
function mountApp(path: string) {
  const router = createMemoryRouter(appRoutes, { initialEntries: [path] });
  render(<QueryClientProvider client={testQueryClient()}><AuthContext.Provider value={stubAuth()}><ToastProvider><RouterProvider router={router} /></ToastProvider></AuthContext.Provider></QueryClientProvider>);
  return router;
}
/**
 * From here the clock moves only when the test says, however busy the machine (as 1B's list tests do it): Testing
 * Library's async helpers wait on timers this clock never runs, so the steps after it are fireEvent and pass().
 */
function handClock() {
  const now = Date.now();
  vi.useRealTimers();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now });
}
/** The hand clock moves `ms` on; then what that set off reaches the screen (TanStack sends its news on a 0 ms timer). */
async function pass(ms: number) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
  for (let i = 0; i < 4; i += 1) await act(async () => { await vi.advanceTimersByTimeAsync(0); });
}
/**
 * The hand clock moves `step` ms at a time (none by default) until `seen()` holds: a check (and its requests) answers
 * over many turns of the promise queue. A check started inside a timer needs steps of 1 ms: the fake clock puts a 0 ms
 * timer set during its tick (TanStack's news) 1 ms on.
 */
async function until(seen: () => boolean, step = 0) {
  for (let i = 0; i < 20 && !seen(); i += 1) await pass(step);
}
/** Whatever is due settles on the hand clock, which doesn't move: so an answer that isn't there wasn't coming yet. */
const settle = () => until(() => false);

test("/scan holds the same check on a page of its own, and v2's QR scanner link lands on it (Ruling 1E-7)", async () => {
  const { calls } = serve();
  const scans = all(appRoutes).filter((r) => r.path === "/scan");
  expect(scans).toHaveLength(1); // no placeholder for part 2 behind it
  expect(await loadedPage(scans[0].element)).toBe(ScanPage);
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  try {
    const router = mountApp("/billing/qr-scanner");
    expect(await screen.findByRole("heading", { level: 1, name: "Check a bill's QR code" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/scan");
    // the page puts focus on its title, as every page does, so on a computer its card says how a USB scanner reads in
    // (PROTO's words): a scan made before the field is clicked would be lost
    expect(screen.getByRole("region", { name: "Scan" })).toHaveTextContent("A USB scanner works like a keyboard: click the field and scan.");
    act(() => { vi.advanceTimersByTime(400); });
    await userEvent.type(screen.getByLabelText("Or type or paste what it says"), `${CODE}{Enter}`);
    expect(await screen.findByText("Matches KGH/2026-27/31")).toBeInTheDocument();
    // a page, not the list under a dialog: the bills aren't asked for just to sit behind it
    expect(calls.filter((c) => c.url === "sales/").map((c) => c.params.number)).toEqual(["KGH/2026-27/31"]);
  } finally {
    vi.useRealTimers();
  }
});

test("a firm whose GSTIN was saved with a stray space, a line break or small letters still owns its bills' codes (Task 1a's carry 1)", async () => {
  serve();
  const saved = (gstin: string) => FIRMS.map((f) => (f.id === 3 ? { ...f, gstin } : f));
  for (const gstin of ["08ABCPK1234F1Z5\n", " 08abcpk1234f1z5", "08ABCPK\n1234F1Z5", "08ABCPK  1234F1Z5"]) {
    expect(await checkQr(CODE, saved(gstin)), JSON.stringify(gstin)).toMatchObject({ kind: "match", firm: { id: 3 } });
  }
  // the code itself: v3 prints such a GSTIN on one line, a break read as a space; v2 printed it as it was saved
  expect(await checkQr("KGH/2026-27/31|08ABCPK 1234F1Z5|2026-10-08|87083.21", saved("08ABCPK\n1234F1Z5"))).toMatchObject({ kind: "match" });
  expect(await checkQr("KGH/2026-27/31|08ABCPK\n1234F1Z5|2026-10-08|87083.21", saved("08ABCPK\n1234F1Z5"))).toMatchObject({ kind: "match" });
});

test("a code with no GSTIN belongs to the firms saved without one, whichever has the bill; when every firm has a GSTIN, it says so plainly", async () => {
  const AARAV = { id: 5, name: "AARAV JEWELS", short: "Aarav", gstin: "", state: "RAJASTHAN" };
  const DEV = { id: 6, name: "DEV CRAFTS", short: "Dev", gstin: " ", state: "RAJASTHAN" };
  const { calls } = salesServer([["GET", "sales/", ({ params }) => wirePage(params.business_id === 6 && params.number === "41"
    ? [wireRow({ id: 600, business: 6, business_name: "DEV CRAFTS", invoice_number: "41", counter: 41, total_amount: "566.05" })] : [])]]);
  const NO_GSTIN = "41||2026-10-08|566.05";
  expect(await checkQr(NO_GSTIN, [...FIRMS, AARAV, DEV])).toMatchObject({ kind: "match", firm: { id: 6 }, bill: { id: 600 } });
  expect(calls.filter((c) => c.params.number === "41").map((c) => c.params.business_id)).toEqual([5, 6]);
  expect(await checkQr(NO_GSTIN, FIRMS)).toMatchObject({ kind: "otherfirm" });
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  try {
    const field = await openDialog();
    await userEvent.type(field, `${NO_GSTIN}{Enter}`);
    expect(await screen.findByText("Not one of your firms")).toBeInTheDocument();
    expect(screen.getByText("The QR code carries no GSTIN, and all your firms have one.")).toBeInTheDocument();
    // another firm's GSTIN: which it isn't, as PROTO says it
    await userEvent.clear(field);
    await userEvent.type(field, "X/1|27AAACK1234L1ZN|2026-10-08|100.00{Enter}");
    expect(await screen.findByText("The QR code carries GSTIN 27AAACK1234L1ZN, which isn't KIRAN GOLD HOUSE or MEERA ORNAMENTS.")).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

/** These bills, as the contract's server finds them: `number` is the stored number but for case; `q`, the numbers that contain it. */
function numbersServer(stored: Record<string, unknown>[]) {
  return salesServer([["GET", "sales/", ({ params }) => {
    const n = (r: Record<string, unknown>) => String(r.invoice_number).toUpperCase();
    const t = String(params.number ?? params.q).trim().toUpperCase();
    return wirePage(stored.filter((r) => (params.number ? n(r) === t : n(r).includes(t))));
  }]]);
}

test("a bill number saved with a line break (v2's import): new codes carry it on one line, as the paper prints it, so a scanner reads them whole; they check, and so do codes printed with the break, read whole or with it dropped (Task 1a's carry 2)", async () => {
  const { calls } = numbersServer([wireRow({ invoice_number: "KGH/2026-27/\n31" }), wireRow({ id: 431, invoice_number: "KGH/2026-27/131" }), wireRow({ id: 444, invoice_number: "KGH/2026-27/44 " })]);
  const printed = printBill(toBillDetail(wireDetail({ invoice_number: "KGH/2026-27/\n31" })), { showBank: true }).qr;
  expect(printed).toBe("KGH/2026-27/ 31|08ABCPK1234F1Z5|2026-10-08|87083.21");
  // printed now; printed by v2 or by v3 until now, its break read whole (a camera) or dropped (a USB scanner, a paste)
  for (const code of [printed, "KGH/2026-27/\n31|08ABCPK1234F1Z5|2026-10-08|87083.21", "KGH/2026-27/31|08ABCPK1234F1Z5|2026-10-08|87083.21"]) {
    expect(await checkQr(code, FIRMS), JSON.stringify(code)).toMatchObject({ kind: "match", bill: { id: 412 } });
  }
  // a number saved with a space at its end, from a code without it; never a number that only contains the code's
  expect(await checkQr("KGH/2026-27/44|08ABCPK1234F1Z5|2026-10-08|87083.21", FIRMS)).toMatchObject({ kind: "match", bill: { id: 444 } });
  expect(await checkQr("KGH/2026-27/13|08ABCPK1234F1Z5|2026-10-08|87083.21", FIRMS)).toMatchObject({ kind: "unknown" });
  // the look-alike search is only for a number the exact one missed, by its digits, in the firm's year
  expect(calls.filter((c) => c.params.q).map((c) => c.params)).toContainEqual({ business_id: 3, q: "31", fy: "2026-27", ordering: "number", page: 1, page_size: 40 });
});

test("such a code printed before now reaches a USB scanner's Enter halfway: the box keeps the first half, the rest joins it, and the whole code checks", async () => {
  numbersServer([wireRow({ invoice_number: "KGH/2026-27/\n31" })]);
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  try {
    const field = await openDialog();
    await userEvent.type(field, "KGH/2026-27/{Enter}31|08ABCPK1234F1Z5|2026-10-08|87083.21{Enter}");
    expect(await screen.findByText("Matches KGH/2026-27/ 31")).toBeInTheDocument();
    expect(field).toHaveValue("KGH/2026-27/31|08ABCPK1234F1Z5|2026-10-08|87083.21");
  } finally {
    vi.useRealTimers();
  }
});

test("the same code read again within a few seconds asks the server nothing more: a scanner's second read, a second Enter, the camera again; a failed check asks again at once (Neon's free plan)", async () => {
  let fail = true;
  const { calls } = salesServer([["GET", "sales/", () => (fail ? refuse(503, {}) : wirePage([wireRow()]))]]);
  const asked = () => calls.filter((c) => c.url === "sales/").length;
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  try {
    const field = await openDialog();
    await userEvent.type(field, `${CODE}{Enter}`);
    expect(await screen.findByText("It wasn't checked")).toBeInTheDocument();
    fail = false;
    await userEvent.keyboard("{Enter}");
    expect(await screen.findByText("Matches KGH/2026-27/31")).toBeInTheDocument();
    expect(asked()).toBe(2);
    // the code stays selected, so a scanner's next read replaces it rather than adding to it
    expect([field.selectionStart, field.selectionEnd]).toEqual([0, CODE.length]);
    await userEvent.keyboard(`${CODE}{Enter}`);
    expect(await screen.findByText("Matches KGH/2026-27/31")).toBeInTheDocument();
    expect(field).toHaveValue(CODE);
    await userEvent.keyboard("{Enter}");
    expect(await screen.findByText("Matches KGH/2026-27/31")).toBeInTheDocument();
    expect(asked()).toBe(2);
    // a few seconds on, it's a new look
    act(() => { vi.advanceTimersByTime(6000); });
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(asked()).toBe(3));
  } finally {
    vi.useRealTimers();
  }
});

test("the camera asks the server once for the code it finds, not once a look; the same bill held up again at once asks nothing", async () => {
  const { calls } = serve();
  const detect = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValue([{ rawValue: CODE }]);
  const stop = aCamera(detect);
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"], shouldAdvanceTime: true });
  try {
    await openDialog();
    for (let round = 1; round <= 2; round += 1) {
      await userEvent.click(await screen.findByRole("button", { name: "Scan with the camera" }));
      // a new look starts without the last answer
      expect(screen.queryByText("Matches KGH/2026-27/31")).not.toBeInTheDocument();
      for (let i = 0; i < 3; i += 1) await act(async () => { vi.advanceTimersByTime(250); });
      expect(await screen.findByText("Matches KGH/2026-27/31")).toBeInTheDocument();
      expect(stop).toHaveBeenCalledTimes(round);
    }
    expect(calls.filter((c) => c.url === "sales/")).toHaveLength(1);
  } finally {
    vi.useRealTimers();
    noCamera();
  }
});

test("Stop the camera stops it; a camera the browser blocked says how to allow it", async () => {
  serve();
  const stop = aCamera(async () => []);
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  try {
    await openDialog();
    await userEvent.click(await screen.findByRole("button", { name: "Scan with the camera" }));
    expect(screen.getByLabelText("The camera: hold the bill's QR code in the square")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Stop the camera" }));
    expect(screen.queryByLabelText("The camera: hold the bill's QR code in the square")).not.toBeInTheDocument();
    await waitFor(() => expect(stop).toHaveBeenCalled());
    Object.assign(navigator, { mediaDevices: { getUserMedia: vi.fn(async () => { throw Object.assign(new Error("Permission denied"), { name: "NotAllowedError" }); }) } });
    await userEvent.click(screen.getByRole("button", { name: "Scan with the camera" }));
    expect(await screen.findByText("The camera is blocked for this app. Allow it in the browser's settings, or type what the code says.")).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
    noCamera();
  }
});

test("a browser that can't read codes from the camera (an iPhone's, most computers') offers the box alone", async () => {
  serve();
  Object.assign(navigator, { mediaDevices: { getUserMedia: vi.fn() } }); // a camera, but no code reader
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  try {
    await openDialog();
    await act(async () => {});
    expect(screen.queryByRole("button", { name: "Scan with the camera" })).not.toBeInTheDocument();
  } finally {
    vi.useRealTimers();
    noCamera();
  }
});

test("while the firms haven't come (the app opened offline), a code isn't called another firm's: it isn't checked, and Check asks for them again", async () => {
  let up = false;
  const { calls } = salesServer([
    ["GET", "businesses/", () => (up ? { results: [FIRM, OTHER_FIRM] } : refuse(503, {}))],
    ["GET", "sales/", () => wirePage([wireRow()])],
  ]);
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  try {
    const field = await openDialog();
    await userEvent.type(field, `${CODE}{Enter}`);
    expect(await screen.findByText("It wasn't checked")).toBeInTheDocument();
    expect(screen.queryByText("Not one of your firms")).not.toBeInTheDocument();
    expect(calls.filter((c) => c.url === "sales/")).toHaveLength(0);
    up = true;
    await userEvent.click(screen.getByRole("button", { name: "Check" }));
    expect(await screen.findByText("Matches KGH/2026-27/31")).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

test("offline with the firms not in, Check says so at once: it doesn't wait for the internet to ask for them", async () => {
  salesServer([["GET", "businesses/", () => refuse(0, null)]]);
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
  try {
    const field = await openDialog();
    act(() => { onlineManager.setOnline(false); }); // as after the browser's "offline" event
    await userEvent.type(field, `${CODE}{Enter}`);
    expect(await screen.findByText("You're offline, so it wasn't checked")).toBeInTheDocument();
  } finally {
    act(() => { onlineManager.setOnline(true); });
    onLine.mockRestore();
    vi.useRealTimers();
  }
});

/* ── Review fix 1 ── */

test("/scan on a phone: Back, PROTO's subtitle, and no USB scanner's cue (that's a computer's)", async () => {
  serve();
  (window as unknown as { __phone?: boolean }).__phone = true;
  try {
    renderApp(<ScanPage />, { path: "/scan" });
    expect(await screen.findByRole("heading", { level: 1, name: "Check a bill's QR code" })).toBeInTheDocument();
    expect(screen.getByText("Bills printed by this app")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
    expect(screen.queryByText("A USB scanner works like a keyboard: click the field and scan.")).not.toBeInTheDocument();
  } finally {
    (window as unknown as { __phone?: boolean }).__phone = false;
  }
});

test("a code left under a scanner that reads it again once a second asks the server once, however long it stays: each read renews the few seconds (Neon's free plan)", async () => {
  const { calls } = salesServer([["GET", "sales/", () => wirePage([wireRow()])]]);
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  try {
    const field = await openDialog();
    await userEvent.type(field, `${CODE}{Enter}`);
    expect(await screen.findByText("Matches KGH/2026-27/31")).toBeInTheDocument();
    for (let s = 1; s <= 15; s += 1) {
      act(() => { vi.advanceTimersByTime(1000); });
      fireEvent.keyDown(field, { key: "Enter" }); // the scanner's next read: the same code over the selected one, then Enter
      expect(await screen.findByText("Matches KGH/2026-27/31")).toBeInTheDocument();
    }
    expect(calls.filter((c) => c.url === "sales/")).toHaveLength(1);
  } finally {
    vi.useRealTimers();
  }
});

test("text that isn't a code waits 300 ms for its answer, so the rest of a scan split by a line break comes first: typing cancels it, and so does closing the check; it never selects the box", async () => {
  numbersServer([wireRow({ invoice_number: "KGH/2026-27/\n31" })]);
  const NOT_A_CODE = "This isn't a bill's QR code";
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  const field = await openDialog();
  handClock();
  try {
    // half a scan: its Enter waits; the rest arrives meanwhile and cancels it; the whole code checks at once
    fireEvent.change(field, { target: { value: "KGH/2026-27/" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await pass(250);
    await settle();
    expect(screen.queryByText(NOT_A_CODE)).not.toBeInTheDocument();
    fireEvent.change(field, { target: { value: "KGH/2026-27/31|08ABCPK1234F1Z5|2026-10-08|87083.21" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await until(() => Boolean(screen.queryByText("Matches KGH/2026-27/ 31")));
    expect(screen.getByText("Matches KGH/2026-27/ 31")).toBeInTheDocument();
    await pass(1000);
    await settle();
    expect(screen.queryByText(NOT_A_CODE)).not.toBeInTheDocument();
    // a scanner that sends no Enter after the rest: what it types cancels the wait all the same
    fireEvent.change(field, { target: { value: "KGH/2026-27/" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await pass(100);
    fireEvent.change(field, { target: { value: "KGH/2026-27/31|08ABCPK1234F1Z5|2026-10-08|87083.21" } });
    await pass(1000);
    await settle();
    expect(screen.queryByText(NOT_A_CODE)).not.toBeInTheDocument();
    // text that stays half: its answer comes 300 ms on, and the box keeps it unselected, for the rest to join it
    fireEvent.change(field, { target: { value: "hello" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await pass(299);
    await settle();
    expect(screen.queryByText(NOT_A_CODE)).not.toBeInTheDocument();
    await pass(1);
    await until(() => Boolean(screen.queryByText(NOT_A_CODE)), 1);
    expect(screen.getByText(NOT_A_CODE)).toBeInTheDocument();
    expect([field.selectionStart, field.selectionEnd]).toEqual([5, 5]);
    // the check closed while one waits: it never shows, even while the dialog is on its way out
    fireEvent.change(field, { target: { value: "KGH/2026-27/" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await pass(200);
    fireEvent.keyDown(field, { key: "Escape" });
    await pass(120);
    await settle();
    expect(screen.queryByText(NOT_A_CODE)).not.toBeInTheDocument();
    await pass(500);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

test("the camera stops when the dialog closes with it on", async () => {
  serve();
  const stop = aCamera(async () => []);
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  try {
    await openDialog();
    await userEvent.click(await screen.findByRole("button", { name: "Scan with the camera" }));
    expect(screen.getByLabelText("The camera: hold the bill's QR code in the square")).toBeInTheDocument();
    await act(async () => {}); // the camera's stream comes
    expect(stop).not.toHaveBeenCalled();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(stop).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
    noCamera();
  }
});

test("the camera stops when the person leaves /scan with it on", async () => {
  serve();
  const stop = aCamera(async () => []);
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  try {
    const router = mountApp("/scan");
    expect(await screen.findByRole("heading", { level: 1, name: "Check a bill's QR code" })).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(400); });
    await userEvent.click(await screen.findByRole("button", { name: "Scan with the camera" }));
    expect(screen.getByLabelText("The camera: hold the bill's QR code in the square")).toBeInTheDocument();
    await act(async () => {}); // the camera's stream comes
    expect(stop).not.toHaveBeenCalled();
    await act(async () => { await router.navigate("/purchases"); });
    await waitFor(() => expect(screen.queryByLabelText("The camera: hold the bill's QR code in the square")).not.toBeInTheDocument());
    expect(stop).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
    noCamera();
  }
});

test("how often each answer asks the server: a match once; an unknown code three times, as a deleted one does (the number, its look-alikes, the bin)", async () => {
  const { calls } = serve();
  expect(await checkQr(CODE, FIRMS)).toMatchObject({ kind: "match" });
  expect(calls).toHaveLength(1);
  calls.length = 0;
  expect(await checkQr("KGH/2026-27/40|08ABCPK1234F1Z5|2026-10-08|100.00", FIRMS)).toMatchObject({ kind: "unknown" });
  expect(calls).toHaveLength(3);
  expect(calls.map((c) => c.url)).toEqual(["sales/", "sales/", "sales/check-number/"]);
  calls.length = 0;
  expect(await checkQr("KGH/2026-27/27|08ABCPK1234F1Z5|2026-09-24|45000.00", FIRMS)).toMatchObject({ kind: "deleted" });
  expect(calls).toHaveLength(3);
});
