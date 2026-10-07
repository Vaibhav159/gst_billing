/**
 * The toast for a CSV import, from what the server says it did.
 *
 * The import screen ignored the answer and said "Import Successful" whatever
 * it was, so rows the server refused (a mistyped GSTIN, an invoice whose every
 * line failed and was removed) were never shown to anyone (review of M27).
 */
type CsvImportResult = {
  customers_created?: number;
  products_created?: number;
  invoices_created?: number;
  line_items_created?: number;
  errors?: string[];
};

const COUNTS: [keyof CsvImportResult, string][] = [
  ["customers_created", "customers"],
  ["products_created", "products"],
  ["invoices_created", "invoices"],
  ["line_items_created", "line items"],
];

export function csvImportSummary(result: CsvImportResult, fileName: string) {
  const made = COUNTS.filter(([key]) => typeof result[key] === "number" && (result[key] as number) > 0)
    .map(([key, label]) => `${result[key]} ${label}`);
  const errors = result.errors ?? [];
  const shown = errors.slice(0, 3).join(" ");
  const more = errors.length > 3 ? ` …and ${errors.length - 3} more.` : "";
  const imported = made.length ? `${made.join(", ")} imported.` : "Nothing was imported.";
  if (!errors.length) return { ok: true, title: "Import done", description: `${fileName}: ${imported}` };
  return {
    ok: false,
    title: made.length ? "Imported with problems" : "Nothing imported",
    description: `${fileName}: ${imported} ${shown}${more}`,
  };
}
