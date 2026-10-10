import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderApp } from "@/test/render";
import { canShareFiles, shareFile } from "./files";
import { sharePdf, ShareHost, tellAboutPdf } from "./ShareHost";

const FILE = { blob: new Blob(["%PDF-1.3"], { type: "application/pdf" }), name: "KGH_2026-27_31.pdf", sheets: 1 };
/** A phone's share sheet that takes files; active: whether the press that asked still counts. */
function sheet(active: boolean) {
  const share = vi.fn(async () => {});
  Object.assign(navigator, { share, canShare: () => true, userActivation: { isActive: active, hasBeenActive: true } });
  return share;
}
afterEach(() => { vi.useRealTimers(); Object.assign(navigator, { share: undefined, canShare: undefined, userActivation: undefined }); });

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

test("a press that ran out while the PDF was made: the host asks for one more press, then shares; Not now cancels", async () => {
  const share = sheet(false);
  renderApp(<ShareHost />);
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  const first = sharePdf(FILE, { title: "KGH/2026-27/31" });
  expect(await screen.findByRole("dialog", { name: "Your PDF is ready" })).toHaveTextContent("KGH_2026-27_31.pdf took a moment to make, so the phone asks once more");
  act(() => { vi.advanceTimersByTime(400); }); // the dialog's guard against the press that opened it
  Object.assign(navigator, { userActivation: { isActive: true, hasBeenActive: true } });
  await userEvent.click(screen.getByRole("button", { name: "Share" }));
  expect(await first).toBe("shared");
  expect(share).toHaveBeenCalledTimes(1);
  Object.assign(navigator, { userActivation: { isActive: false, hasBeenActive: true } });
  const second = sharePdf(FILE, { title: "KGH/2026-27/31" });
  await screen.findByRole("dialog", { name: "Your PDF is ready" });
  act(() => { vi.advanceTimersByTime(400); });
  await userEvent.click(screen.getByRole("button", { name: "Not now" }));
  expect(await second).toBe("cancelled");
});

test("a share sheet that refuses the host's own press too can't share here: unsupported, so the caller downloads the PDF instead", async () => {
  const share = sheet(false);
  renderApp(<ShareHost />);
  vi.useFakeTimers({ toFake: ["Date"], shouldAdvanceTime: true });
  const asked = sharePdf(FILE, { title: "KGH/2026-27/31" });
  await screen.findByRole("dialog", { name: "Your PDF is ready" });
  act(() => { vi.advanceTimersByTime(400); });
  Object.assign(navigator, { userActivation: { isActive: true, hasBeenActive: true } });
  share.mockRejectedValueOnce(Object.assign(new Error("not allowed here"), { name: "NotAllowedError" }));
  await userEvent.click(screen.getByRole("button", { name: "Share" }));
  expect(await asked).toBe("unsupported");
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
