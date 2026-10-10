import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderApp } from "@/test/render";
import { canShareFiles, shareFile } from "./files";
import { sharePdf, ShareHost, tellAboutPdf } from "./ShareHost";

const FILE = { blob: new Blob(["%PDF-1.3"], { type: "application/pdf" }), name: "KGH_2026-27_31.pdf", sheets: 1 };
/** A phone's share sheet that takes files; active: whether the press that asked still counts. */
function sheet(active: boolean) {
  const share = vi.fn(async (): Promise<void> => {});
  Object.assign(navigator, { share, canShare: () => true, userActivation: { isActive: active, hasBeenActive: true } });
  return share;
}
const undo: (() => void)[] = [];
/**
 * From here on a press counts only while its click is being dispatched, as a browser's does: a share asked for inside
 * the click opens, one asked for after an await (or with no click) is late.
 */
function pressesCountInTheClickOnly() {
  let pressing = false;
  const start = () => { pressing = true; };
  const end = () => { pressing = false; };
  window.addEventListener("click", start, true);
  window.addEventListener("click", end);
  undo.push(() => { window.removeEventListener("click", start, true); window.removeEventListener("click", end); });
  Object.assign(navigator, { userActivation: { get isActive() { return pressing; }, hasBeenActive: true } });
}
afterEach(() => {
  vi.useRealTimers();
  undo.splice(0).forEach((u) => u());
  Object.assign(navigator, { share: undefined, canShare: undefined, userActivation: undefined });
});

test("a computer's browser has no share sheet for files: nothing opens, and the caller downloads instead", async () => {
  expect(canShareFiles()).toBe(false);
  expect(await shareFile(FILE.blob, FILE.name, { title: "KGH/2026-27/31" })).toBe("unsupported");
});

test("the share sheet takes the PDF at once while the press counts; closing it is cancelled", async () => {
  const share = sheet(true);
  expect(canShareFiles()).toBe(true);
  expect(await sharePdf(FILE, { title: "KGH/2026-27/31", text: "Namaste" })).toBe("shared");
  expect(share).toHaveBeenCalledWith({ files: [expect.objectContaining({ name: "KGH_2026-27_31.pdf", type: "application/pdf" })], title: "KGH/2026-27/31", text: "Namaste" });
  share.mockRejectedValueOnce(Object.assign(new Error("closed"), { name: "AbortError" }));
  expect(await sharePdf(FILE, { title: "KGH/2026-27/31" })).toBe("cancelled");
});

test("a press that ran out while the PDF was made: the host asks for one more press and shares within it; Not now cancels", async () => {
  const share = sheet(false);
  renderApp(<ShareHost />);
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  const first = sharePdf(FILE, { title: "KGH/2026-27/31" });
  expect(await screen.findByRole("dialog", { name: "Your PDF is ready" })).toHaveTextContent("KGH_2026-27_31.pdf took a moment to make, so the phone asks once more");
  expect(share).not.toHaveBeenCalled();
  act(() => { vi.advanceTimersByTime(400); }); // the dialog's guard against the press that opened it
  pressesCountInTheClickOnly();
  await userEvent.click(screen.getByRole("button", { name: "Share" }));
  expect(await first).toBe("shared");
  expect(share).toHaveBeenCalledTimes(1);
  const second = sharePdf(FILE, { title: "KGH/2026-27/31" });
  await screen.findByRole("dialog", { name: "Your PDF is ready" });
  act(() => { vi.advanceTimersByTime(400); });
  await userEvent.click(screen.getByRole("button", { name: "Not now" }));
  expect(await second).toBe("cancelled");
  expect(share).toHaveBeenCalledTimes(1);
});

test("a share sheet that refuses the host's own press too can't share here: unsupported, so the caller downloads the PDF instead", async () => {
  const share = sheet(false);
  renderApp(<ShareHost />);
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  const asked = sharePdf(FILE, { title: "KGH/2026-27/31" });
  await screen.findByRole("dialog", { name: "Your PDF is ready" });
  act(() => { vi.advanceTimersByTime(400); });
  pressesCountInTheClickOnly();
  share.mockRejectedValueOnce(Object.assign(new Error("not allowed here"), { name: "NotAllowedError" }));
  await userEvent.click(screen.getByRole("button", { name: "Share" }));
  expect(await asked).toBe("unsupported");
  expect(share).toHaveBeenCalledTimes(1);
});

test("a newer ask takes the place of one still showing, which is cancelled; Share shows it's busy until the share sheet closes", async () => {
  const share = sheet(false);
  let close = () => {};
  share.mockImplementationOnce(() => new Promise<void>((done) => { close = done; }));
  renderApp(<ShareHost />);
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  const older = sharePdf(FILE, { title: "KGH/2026-27/31" });
  await screen.findByRole("dialog", { name: "Your PDF is ready" });
  let newer = Promise.resolve<string>("");
  await act(async () => { newer = sharePdf({ ...FILE, name: "KGH_2026-27_32.pdf" }, { title: "KGH/2026-27/32" }); });
  expect(await older).toBe("cancelled");
  await waitFor(() => expect(screen.getByRole("dialog", { name: "Your PDF is ready" })).toHaveTextContent("KGH_2026-27_32.pdf took a moment to make"));
  act(() => { vi.advanceTimersByTime(400); });
  pressesCountInTheClickOnly();
  const button = screen.getByRole("button", { name: "Share" });
  await userEvent.click(button);
  expect(share).toHaveBeenCalledTimes(1);
  expect(button).toHaveAttribute("aria-busy", "true");
  // a second press while the share sheet is up asks for nothing more
  await userEvent.click(button);
  expect(share).toHaveBeenCalledTimes(1);
  await act(async () => { close(); });
  expect(await newer).toBe("shared");
  await waitFor(() => expect(screen.queryByRole("dialog", { name: "Your PDF is ready" })).not.toBeInTheDocument());
});

test("a host that leaves the screen while it asks settles the ask as cancelled, so nothing waits for ever", async () => {
  sheet(false);
  const { unmount } = renderApp(<ShareHost />);
  const asked = sharePdf(FILE, { title: "KGH/2026-27/31" });
  await screen.findByRole("dialog", { name: "Your PDF is ready" });
  unmount();
  expect(await asked).toBe("cancelled");
});

test("code with no screen of its own can say what happened: the host shows it", async () => {
  renderApp(<ShareHost />);
  act(() => tellAboutPdf({ tone: "neg", title: "The PDF wasn't made", body: "Try again in a minute." }));
  expect(await screen.findByText("The PDF wasn't made")).toBeInTheDocument();
});
