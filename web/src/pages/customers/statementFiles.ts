// Small statements are made ahead; large statements wait for a press. A completed file belongs only to the period
// still on screen. Sharing uses the app's host when making the PDF outlasts the phone's user activation.
import { useCallback, useEffect, useRef, useState } from "react";
import { sharePdf as shareMadePdf } from "@/core/print/ShareHost";
import { makeStatementPdf, type StatementPdfData } from "./statementPdf";

/** "Anil-Gupta_statement_FY-2026-27.pdf"; own dates: "Anil-Gupta_statement_2026-10-01_to_2026-10-05.pdf". */
export function statementFileName(name: string, label: string, dates?: { from: string; to: string }): string {
  const slug = name.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "Customer";
  return `${slug}_statement_${dates ? `${dates.from}_to_${dates.to}` : label.replace(/\s+/g, "-")}.pdf`;
}

export const STATEMENT_PDF_AHEAD = 150;

/** The PDF for stable `data`: made ahead up to 150 bills, otherwise on make(). Old periods never hand out their file. */
export function useStatementPdf(data: StatementPdfData | null) {
  const current = useRef(data);
  const pending = useRef<{ for: StatementPdfData; promise: Promise<Blob | null> } | null>(null);
  const [made, setMade] = useState<{ for: StatementPdfData | null; blob: Blob | null; failed: boolean; making: boolean }>({ for: null, blob: null, failed: false, making: false });
  const make = useCallback((): Promise<Blob | null> => {
    if (!data || current.current !== data) return Promise.resolve(null);
    if (pending.current?.for === data) return pending.current.promise;
    setMade({ for: data, blob: null, failed: false, making: true });
    const promise = makeStatementPdf(data).then((blob) => {
      if (current.current !== data) return null;
      setMade({ for: data, blob, failed: false, making: false });
      return blob;
    }, () => {
      if (current.current === data) setMade({ for: data, blob: null, failed: true, making: false });
      return null;
    });
    pending.current = { for: data, promise };
    return promise;
  }, [data]);
  useEffect(() => {
    current.current = data;
    if (data && data.statement.bills.length <= STATEMENT_PDF_AHEAD) void make();
    return () => { current.current = null; };
  }, [data, make]);
  return {
    ...(data && made.for === data ? { blob: made.blob, failed: made.failed, making: made.making } : { blob: null, failed: false, making: false }),
    make,
  };
}

/** Opens the PDF in a new tab and asks it to print. False when the browser stopped the tab. */
export { printFile as printPdf } from "@/core/print/files";

/** The share sheet with the PDF, where the browser has one for files; "unsupported" elsewhere (download it instead). */
export function sharePdf(blob: Blob, name: string, title: string): Promise<"shared" | "cancelled" | "unsupported"> {
  return shareMadePdf({ blob, name, sheets: 0 }, { title });
}
