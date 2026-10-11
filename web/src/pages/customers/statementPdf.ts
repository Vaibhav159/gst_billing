// The statement's PDF. react-pdf and the document load on demand, the first time a PDF is made, so neither
// is in the app's first download.
import { createElement } from "react";
import type { StatementPdfData } from "./statementDoc";

export type { StatementPdfData };

/** The statement as a PDF file. */
export async function makeStatementPdf(data: StatementPdfData): Promise<Blob> {
  const [{ pdf }, { StatementDocument }] = await Promise.all([import("@react-pdf/renderer"), import("./statementDoc")]);
  return pdf(createElement(StatementDocument, { data }) as Parameters<typeof pdf>[0]).toBlob();
}
