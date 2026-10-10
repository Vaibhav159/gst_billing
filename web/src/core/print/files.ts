// Handing a file to the person: a download, a tab that prints it, or the phone's share sheet. The app's one copy of
// each (Ruling 1E-6): 1C's customer screens use them under their own names. A browser opens a tab or the share sheet
// only within a person's press, so callers make the file first and call these from the press itself.

/** The browser downloads `blob` as `name`. */
export function saveFile(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // the browser may still be reading it a moment later
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Opens the PDF in a new tab and asks it to print. False when the browser stopped the tab. */
export function printFile(blob: Blob): boolean {
  const url = URL.createObjectURL(blob);
  const w = window.open(url, "_blank");
  if (!w) { URL.revokeObjectURL(url); return false; }
  w.addEventListener("load", () => { try { w.print(); } catch { /* the PDF viewer has its own Print */ } });
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return true;
}

/** Whether this browser's share sheet takes a PDF file (phones do; most computers don't). Decided without waiting. */
export function canShareFiles(): boolean {
  if (typeof navigator.share !== "function" || typeof navigator.canShare !== "function") return false;
  try {
    return navigator.canShare({ files: [new File([""], "bill.pdf", { type: "application/pdf" })] });
  } catch {
    return false;
  }
}

/**
 * The share sheet with the PDF, and `text` with it when there is some. "late": the press that asked no longer counts
 * (making the PDF took too long), so it needs another press; "unsupported": no share sheet for files here (download it).
 */
export async function shareFile(blob: Blob, name: string, { title, text }: { title: string; text?: string }): Promise<"shared" | "cancelled" | "late" | "unsupported"> {
  const file = new File([blob], name, { type: "application/pdf" });
  if (typeof navigator.share !== "function" || typeof navigator.canShare !== "function" || !navigator.canShare({ files: [file] })) return "unsupported";
  if (navigator.userActivation && !navigator.userActivation.isActive) return "late";
  try {
    await navigator.share({ files: [file], title, ...(text ? { text } : {}) });
    return "shared";
  } catch (e) {
    const why = (e as Error)?.name;
    return why === "AbortError" ? "cancelled" : why === "NotAllowedError" ? "late" : "unsupported";
  }
}
