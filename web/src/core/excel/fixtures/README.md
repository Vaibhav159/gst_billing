# v2 CA workbook golden

`caWorkbook.v2.golden.json` was generated on 12 October 2026 from the real v2
sources at commit `ecf652381b9e511d1eaa35e7b537b3477bf5a6ac`, before they were
removed. Its provenance records the complete source files' SHA-256 hashes,
their paths within v2, the input hashes, timezone and runtime dependencies.

Generation used TypeScript to extract the unchanged `getFinancialYear` and
`mapDjangoInvoice` declarations from `src/hooks/useDataStore.ts`, avoiding the
unrelated React hooks. It executed those declarations with the original
`src/utils/gstRate.ts`, then executed the complete original
`src/utils/generateReportExcel.ts` with `date-fns` 3.6.0 and `xlsx-js-style`
1.2.0 in `Asia/Kolkata`. No workbook logic or date formatter was substituted.

The inputs are `../__fixtures__/caWorkbook.books.json` and
`../__fixtures__/caWorkbook.responses.json`. The backend parity test checks
these responses against the real API and CA builder. All mapped invoices had
an undefined `roundedOff`; firm and customer IDs were converted to strings,
as in the former parity test. The seven generated workbooks also matched the
former frozen-source oracle before it was removed.

Each XLSX blob was read with `{ type: "array", cellNF: true }`. The golden
retains sheet names in order, each sheet's `!ref`, and all cell values, types
and number formats. Each JSON line is a spreadsheet row; a cell is
`[value, type, numberFormat?]`, with omitted formats meaning `General` and
`null` meaning an absent cell. Styles and other metadata were not part of the
existing parity guard and are omitted.

The tests preserve the CA's column order, figures, blank cells, units, payment
splits and formats, with only X-84's accepted differences: excluding cancelled
sales and rounding old three-decimal lines per line to the paisa. The golden
and its inputs are hash-pinned by `v2Adapter.source.test.ts`; never regenerate
the expected v2 output from v3's writer.
