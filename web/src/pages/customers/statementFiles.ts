// What the statement page does with its PDF: names it, makes it as soon as the statement shows, prints it and shares
// it. Made ahead, so Print and Share act inside the press itself: a browser opens a tab or the share sheet for a page
// only straight from a person's press.
import { useEffect, useState } from "react";
import { shareFile } from "@/core/print/files";
import { makeStatementPdf, type StatementPdfData } from "./statementPdf";

/** "Anil-Gupta_statement_FY-2026-27.pdf"; own dates: "Anil-Gupta_statement_2026-10-01_to_2026-10-05.pdf". */
export function statementFileName(name: string, label: string, dates?: { from: string; to: string }): string {
  const slug = name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "Customer";
  return `${slug}_statement_${dates ? `${dates.from}_to_${dates.to}` : label.replace(/\s+/g, "-")}.pdf`;
}

/** The PDF for `data` (null: nothing to make yet), remade when `data` changes. Keep `data` stable (useMemo). */
export function useStatementPdf(data: StatementPdfData | null): { blob: Blob | null; failed: boolean } {
  const [made, setMade] = useState<{ for: StatementPdfData | null; blob: Blob | null; failed: boolean }>({ for: null, blob: null, failed: false });
  useEffect(() => {
    if (!data) return undefined;
    let live = true;
    makeStatementPdf(data).then((blob) => { if (live) setMade({ for: data, blob, failed: false }); }, () => { if (live) setMade({ for: data, blob: null, failed: true }); });
    return () => { live = false; };
  }, [data]);
  // only the PDF of what shows now: a period just picked waits for its own
  return data && made.for === data ? { blob: made.blob, failed: made.failed } : { blob: null, failed: false };
}

/** Opens the PDF in a new tab and asks it to print. False when the browser stopped the tab. */
export { printFile as printPdf } from "@/core/print/files";

/** The share sheet with the PDF, where the browser has one for files; "unsupported" elsewhere (download it instead). */
export function sharePdf(blob: Blob, name: string, title: string): Promise<"shared" | "cancelled" | "unsupported"> {
  return shareFile(blob, name, { title }).then((r) => (r === "late" ? "unsupported" : r));
}
