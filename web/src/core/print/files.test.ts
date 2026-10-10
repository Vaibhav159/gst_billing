// Handing a file out, with jsdom's missing pieces stood in for: object URLs, a download's click, and a phone's share
// sheet. Print (printFile) is tested where it was first written, through 1C's printPdf (statementFiles.test.tsx).
import { saveFile, shareFile } from "./files";

const PDF = new Blob(["%PDF-1.3"], { type: "application/pdf" });
const objectUrls = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Object.assign(URL, objectUrls);
  Object.assign(navigator, { share: undefined, canShare: undefined, userActivation: undefined });
});

test("a download hands the browser the file under its name, and lets its address go a minute later", () => {
  vi.useFakeTimers();
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:bill"), revokeObjectURL: vi.fn() });
  const clicked: [string, string, boolean][] = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { clicked.push([this.href, this.download, this.isConnected]); });
  saveFile(PDF, "KGH_2026-27_31.pdf");
  expect(URL.createObjectURL).toHaveBeenCalledWith(PDF);
  expect(clicked).toEqual([["blob:bill", "KGH_2026-27_31.pdf", true]]);
  expect(document.querySelector("a[download]")).toBeNull();
  // the browser may still be reading it
  vi.advanceTimersByTime(59_999);
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:bill");
});

test("a share asked for after its press ran out is late, and the share sheet isn't tried; one the browser refuses as not allowed is late too", async () => {
  const share = vi.fn(async (_: ShareData) => {});
  Object.assign(navigator, { share, canShare: () => true, userActivation: { isActive: false, hasBeenActive: true } });
  expect(await shareFile(PDF, "KGH_2026-27_31.pdf", { title: "KGH/2026-27/31" })).toBe("late");
  expect(share).not.toHaveBeenCalled();
  // a browser that doesn't say whether the press counts (no userActivation) is asked, and its refusal read
  Object.assign(navigator, { userActivation: undefined });
  share.mockRejectedValueOnce(Object.assign(new Error("needs a press"), { name: "NotAllowedError" }));
  expect(await shareFile(PDF, "KGH_2026-27_31.pdf", { title: "KGH/2026-27/31" })).toBe("late");
  // the message goes with the file only when there is one
  expect(await shareFile(PDF, "KGH_2026-27_31.pdf", { title: "KGH/2026-27/31", text: "Namaste" })).toBe("shared");
  expect(await shareFile(PDF, "KGH_2026-27_31.pdf", { title: "KGH/2026-27/31", text: "" })).toBe("shared");
  expect(share.mock.calls.slice(1).map(([d]) => Object.keys(d).sort())).toEqual([["files", "text", "title"], ["files", "title"]]);
});
