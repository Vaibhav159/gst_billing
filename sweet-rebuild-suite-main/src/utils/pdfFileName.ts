/**
 * Invoice PDF file names (UX2). Every PDF was saved as "<invoice number>.pdf",
 * and #1 exists in all three firms and in every year: a ZIP of #1 from three
 * firms held a single 1.pdf (JSZip overwrites a name it already has) while
 * the toast said "3 PDFs downloaded as ZIP", and single downloads of "30.pdf"
 * overwrote each other in the Downloads folder.
 */
import JSZip from "jszip";

type Named = { invoiceNumber?: string; invoice_date?: string; businessName?: string };
type Firm = { name?: string | null; invoice_prefix?: string | null } | null | undefined;

/**
 * A piece of a file name. Letters and digits (any script), ".", "_" and "-"
 * stay; any run of anything else (spaces, "/", ":", brackets, control
 * characters) becomes one "-", which every file system and share sheet takes.
 */
function safe(part: string, max: number): string {
  const trim = (s: string) => s.replace(/^[-.]+|[-.]+$/g, "");
  return trim(trim(part.replace(/[^\p{L}\p{N}._-]+/gu, "-")).slice(0, max));
}

/** "2026-27" for "2026-05-01": April to March, read off the string (no Date, no timezone). */
export function fyOf(isoDate?: string): string {
  const [y, m] = (isoDate || "").split("-").map(Number);
  if (!y || !m) return "";
  const start = m >= 4 ? y : y - 1;
  return `${start}-${String(start + 1).slice(2)}`;
}

/**
 * "LODHA-JEWELLERS_2026-27_30.pdf": the firm (its invoice prefix when it has
 * one), the financial year and the number. A number that already carries the
 * prefix and the year ("SGJ/2026-27/108") stands alone.
 */
export function invoicePdfName(inv: Named, firm?: Firm): string {
  const firmPart = safe(firm?.invoice_prefix || firm?.name || inv.businessName || "", 40);
  const fy = fyOf(inv.invoice_date);
  const number = safe(inv.invoiceNumber || "", 60) || "invoice";
  const saysItAll = !!firmPart && !!fy && number.toUpperCase().startsWith(firmPart.toUpperCase()) && number.includes(fy);
  return `${(saysItAll ? [number] : [firmPart, fy, number].filter(Boolean)).join("_")}.pdf`;
}

/** A namer that never hands out a name twice, comparing as Windows and macOS do (ignoring case). */
export function uniqueNames(): (name: string) => string {
  const taken = new Set<string>();
  return (name) => {
    const dot = name.lastIndexOf(".");
    const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ""];
    let candidate = name;
    for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${stem}-${n}${ext}`;
    taken.add(candidate.toLowerCase());
    return candidate;
  };
}

/** A ZIP of the files, each under its own name; `written` counts the files it holds. */
export async function zipPdfs(files: { name: string; blob: Blob }[]): Promise<{ zip: Blob; written: number }> {
  const zip = new JSZip();
  const unique = uniqueNames();
  for (const f of files) zip.file(unique(f.name), f.blob);
  const written = Object.values(zip.files).filter((f) => !f.dir).length;
  return { zip: await zip.generateAsync({ type: "blob" }), written };
}

/** The toast after a ZIP: what it holds, and an error when that is fewer than were picked. */
export function zipResultToast(written: number, picked: number, missing: string[] = []) {
  if (written >= picked) return { title: "Download Complete", description: `${written} PDF${written === 1 ? "" : "s"} downloaded as ZIP.` };
  return {
    title: "Some PDFs are missing",
    description: `The ZIP holds ${written} of ${picked} PDFs${missing.length ? `; couldn't make #${missing.join(", #")}` : ""}.`,
    variant: "destructive" as const,
  };
}
