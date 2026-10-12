import { useRef, useState, type ReactNode } from "react";
import { FileSpreadsheet, Lock, Upload } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useSearchParams } from "react-router";
import { useAuth } from "@/core/auth/AuthProvider";
import { problemOf } from "@/core/api/errors";
import { checkRecordRows, saveRecordRows, type RecordCells, type RecordImportKind, type RecordImportRow } from "@/core/api/recordsImport";
import { plural } from "@/core/format";
import { Banner, Button, ButtonLink, Card, Field, Input, Page, Segmented, Select, Table, Td, Th, Tr } from "@/core/ui";

/** Plan 2D owns file decoding. Its route supplies the same decoded sheet shape for CSV and XLSX. */
export type ReadRecordWorkbook = (file: File) => Promise<{ name: string; rows: unknown[][] }[]>;
type Props = { kind: RecordImportKind; readWorkbook: ReadRecordWorkbook };
type Column = { heading: string; field: string; index: number };
type FieldSpec = { key: string; label: string; aliases?: string[]; required?: boolean };
export const RECORD_IMPORT_OPTIONS = [{ value: "customers", label: "Customers" }, { value: "products", label: "Products" }, { value: "firms", label: "Firms" }] as const;
const common: FieldSpec[] = [
  { key: "name", label: "Name", aliases: ["customer", "party", "product name", "firm name", "business name"], required: true },
  { key: "mobile_number", label: "Mobile", aliases: ["phone", "mobile number", "contact"] },
  { key: "gst_number", label: "GSTIN", aliases: ["gstin uin", "gst number"] },
  { key: "email", label: "Email", aliases: ["e mail"] },
];
const FIELDS: Record<RecordImportKind, FieldSpec[]> = {
  customers: [...common.map((field) => field.key === "mobile_number" ? { ...field, required: true } : field),
    { key: "pan_number", label: "PAN" }, { key: "address", label: "Address" }, { key: "city", label: "City" }, { key: "state_name", label: "State" }],
  products: [common[0], { key: "hsn_code", label: "HSN code", aliases: ["hsn", "hsn sac"], required: true },
    { key: "gst_percent", label: "GST rate", aliases: ["gst rate %", "gst rate percent", "tax rate"], required: true },
    { key: "unit", label: "Unit", aliases: ["uom"] }, { key: "kind", label: "Kind" }, { key: "purity", label: "Purity" },
    { key: "usual_rate", label: "Usual rate" }, { key: "purchase_only", label: "Bought only" }, { key: "description", label: "Description" }],
  firms: [...common.map((field) => field.key === "gst_number" || field.key === "mobile_number" ? { ...field, required: true } : field),
    { key: "address", label: "Address", required: true }, { key: "short_name", label: "Short name" }, { key: "city", label: "City" }, { key: "pin_code", label: "PIN code", aliases: ["pin", "pincode"] },
    { key: "bank_name", label: "Bank", aliases: ["bank name"] }, { key: "bank_account_number", label: "Account number", aliases: ["account no", "account", "a c"] },
    { key: "bank_ifsc_code", label: "IFSC" }, { key: "bank_branch_name", label: "Branch" }, { key: "invoice_prefix", label: "Invoice prefix", aliases: ["bill prefix"] },
    { key: "paper_full_number_from", label: "Paper full number from" }, { key: "signature_on_bills", label: "Signature on bills" }, { key: "jurisdiction", label: "Jurisdiction" }, { key: "declaration", label: "Declaration" }],
};
const PERMISSION = { customers: "customer.edit", products: "product.edit", firms: "firm.edit" } as const;
const ONE = { customers: "customer", products: "product", firms: "firm" };
const normal = (value: unknown) => String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Remount on kind changes so a file or a late answer never crosses from products into customers. */
export default function RecordsImport(props: Props) { return <RecordsImportSession key={props.kind} {...props} />; }

/** 2D remains the route owner and supplies its existing bill element and decoder after it lands. */
export function RecordsImportRoute({ bills, readWorkbook }: { bills: ReactNode; readWorkbook: ReadRecordWorkbook }) {
  const [params] = useSearchParams();
  const kind = params.get("type");
  return kind === "customers" || kind === "products" || kind === "firms" ? <RecordsImport kind={kind} readWorkbook={readWorkbook} /> : <>{bills}</>;
}

function RecordsImportSession({ kind, readWorkbook }: Props) {
  const { can, whyNot } = useAuth();
  const allowed = can(PERMISSION[kind]);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const chooser = useRef<HTMLInputElement>(null);
  const readId = useRef(0);
  const [sheets, setSheets] = useState<Awaited<ReturnType<ReadRecordWorkbook>>>([]);
  const [sheet, setSheet] = useState(0);
  const [columns, setColumns] = useState<Column[]>([]);
  const [cells, setCells] = useState<{ row: number; cells: unknown[] }[]>([]);
  const [fileName, setFileName] = useState("");
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [step, setStep] = useState(1);
  const [rows, setRows] = useState<RecordImportRow[]>([]);
  const [checked, setChecked] = useState(false);
  const [savedCount, setSavedCount] = useState<number | null>(null);
  const fields = FIELDS[kind];
  const checkedRows = useMutation({ mutationFn: (values: RecordCells[]) => checkRecordRows(kind, values), retry: false, networkMode: "always" });
  const save = useMutation({
    mutationFn: () => saveRecordRows(kind, rows), retry: false, networkMode: "always",
    onSettled: () => { void qc.invalidateQueries({ predicate: (query) => ["customers", "products", "catalog", "firms", "audit", "backup", "setup", "search", "sales"].includes(String(query.queryKey[0])) }); },
  });
  const busy = reading || checkedRows.isPending || save.isPending;
  const ready = rows.filter((row) => row.state === "ready").length;
  const used = columns.map((column) => column.field).filter(Boolean);
  const duplicate = new Set(used).size !== used.length;
  const missing = fields.filter((field) => field.required && !used.includes(field.key));

  const applySheet = (source: Awaited<ReturnType<ReadRecordWorkbook>>, index: number) => {
    const table = source[index]?.rows || [];
    const head = table.findIndex((row) => row.filter((value) => String(value ?? "").trim()).length >= 2);
    if (head < 0) throw new Error(`No ${kind} were found in this sheet. The first row should name the columns, with one ${ONE[kind]} on each row below it.`);
    setSheet(index);
    const assigned = new Set<string>();
    setColumns(table[head].map((value, i) => {
      const heading = String(value ?? "").trim();
      const spec = fields.find((field) => !assigned.has(field.key) && [field.key, field.label, ...(field.aliases || [])].some((alias) => normal(alias) === normal(heading)));
      if (spec) assigned.add(spec.key);
      return { heading, field: spec?.key || "", index: i };
    }).filter((column) => column.heading));
    const data = table.slice(head + 1).map((cells, index) => ({ row: head + index + 2, cells })).filter((row) => row.cells.some((value) => String(value ?? "").trim()));
    if (!data.length) throw new Error(`No ${kind} were found in this sheet. The first row should name the columns, with one ${ONE[kind]} on each row below it.`);
    setCells(data); setRows([]); setChecked(false); setSavedCount(null); setStep(2);
  };
  const take = async (file?: File) => {
    if (!file || !allowed || save.isPending) return;
    const id = ++readId.current;
    setReading(true); setError("");
    try {
      if (file.size > 20 * 1024 * 1024) throw new Error(`${file.name}: file too large (${(file.size / 1048576).toFixed(1)} MB). The most is 20 MB.`);
      if (/\.xls$/i.test(file.name)) throw new Error(`${file.name} is in the old Excel format (.xls). In Excel, use File › Save as › Excel Workbook (.xlsx), or CSV, and choose that file.`);
      if (!/\.(xlsx|csv)$/i.test(file.name)) throw new Error(`${file.name}: unsupported file type. Choose an Excel (.xlsx) or CSV file.`);
      const source = await readWorkbook(file);
      if (id !== readId.current) return;
      applySheet(source, 0); setSheets(source); setFileName(file.name);
    } catch (problem) { if (id === readId.current) setError(problem instanceof Error ? problem.message : "This file couldn't be used."); }
    finally { if (id === readId.current) setReading(false); }
  };
  const check = async (values: RecordCells[]) => {
    setChecked(false); setError("");
    try { setRows(await checkedRows.mutateAsync(values)); setChecked(true); setSavedCount(null); setStep(3); }
    catch (problem) { setError(problemOf(problem).message); }
  };
  const mapped = () => cells.map((row) => ({ ...Object.fromEntries(columns.filter((column) => column.field).map((column) => [column.field, String(row.cells[column.index] ?? "").trim()])), __row: String(row.row) }));
  const reset = () => { readId.current++; setSheets([]); setRows([]); setColumns([]); setFileName(""); setSavedCount(null); setChecked(false); setError(""); setStep(1); };

  return <Page icon={FileSpreadsheet} title={`Import ${kind} from Excel or Tally`} breadcrumbs={[{ label: kind[0].toUpperCase() + kind.slice(1), to: `/${kind}` }]}
    context={`A list of ${kind} from a spreadsheet. You check every row before anything is added.`}
    actions={<ButtonLink to="/import?type=purchases" variant="ghost">Sales and purchase bills</ButtonLink>}>
    <Card><ol className="flex flex-wrap gap-4 text-sm text-fg2" aria-label="Import steps">{["Choose the file", "Match the columns", "Check the rows", "Import"].map((label, index) => <li key={label} aria-current={step === index + 1 ? "step" : undefined} className={step === index + 1 ? "text-brand font-semibold" : ""}>{index + 1}. {label}</li>)}</ol></Card>
    {!allowed ? <Banner tone="muted" icon={Lock}>{whyNot(PERMISSION[kind])}</Banner> : null}
    {error ? <Banner tone="neg" title="This file couldn't be used">{error}</Banner> : null}
    {step === 1 ? <Card title="1. What are you importing?" subtitle={`One ${ONE[kind]} on each row.`}>
      <div className="flex flex-col gap-5">
        <Segmented label="What are you importing" value={kind} options={RECORD_IMPORT_OPTIONS} onChange={(value) => navigate(`/import?type=${value}`)} />
        <div onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void take(event.dataTransfer.files[0]); }} className="rounded-card border-2 border-dashed border-line px-4 py-5 flex flex-col items-center gap-3">
          <Upload aria-hidden="true" className="text-muted" />
          <p className="text-fg2">Drop the Excel or CSV file here, or choose it</p>
          <input ref={chooser} type="file" accept=".xlsx,.xls,.csv" aria-label="Excel or CSV file to import" className="hidden" disabled={!allowed || busy}
            onChange={(event) => { void take(event.target.files?.[0]); event.target.value = ""; }} />
          <Button onClick={() => chooser.current?.click()} disabled={!allowed || busy}>Choose a file</Button>
          <p className="text-sm text-muted">Excel (.xlsx) or CSV, up to 20 MB, with a row of column names on top.</p>
        </div>
        {reading ? <p role="status" aria-busy="true">Reading the file…</p> : null}
      </div>
    </Card> : null}
    {step === 2 ? <Card title="2. Match the columns" subtitle={fileName}>
      <div className="flex flex-col gap-4">
        {sheets.length > 1 ? <Field label="Sheet" htmlFor="records-sheet"><Select id="records-sheet" value={String(sheet)} options={sheets.map((item, index) => ({ value: String(index), label: item.name }))}
          onChange={(event) => { try { applySheet(sheets, Number(event.target.value)); setError(""); } catch (problem) { setError(problem instanceof Error ? problem.message : "This sheet couldn't be read."); } }} /></Field> : null}
        {columns.map((column, index) => <Field key={column.index} label={`${column.heading} means`} htmlFor={`record-column-${index}`}><Select id={`record-column-${index}`} value={column.field}
          options={[{ value: "", label: "Skip this column" }, ...fields.map((field) => ({ value: field.key, label: field.label }))]}
          onChange={(event) => setColumns((before) => before.map((item, i) => i === index ? { ...item, field: event.target.value } : item))} /></Field>)}
        {duplicate ? <p role="alert" className="text-neg">Use each field once. Two columns cannot fill the same field.</p> : null}
        {missing.length ? <p className="text-neg">Match these columns: {missing.map((field) => field.label).join(", ")}.</p> : null}
        <div className="flex flex-wrap justify-between gap-3"><Button onClick={reset} disabled={busy}>Back</Button><Button variant="primary" loading={checkedRows.isPending} disabled={!allowed || busy || duplicate || Boolean(missing.length)} onClick={() => void check(mapped())}>Check the rows</Button></div>
      </div>
    </Card> : null}
    {step === 3 || savedCount !== null ? <Card title={savedCount !== null ? `Imported ${plural(savedCount, ONE[kind])}` : "3. Check the rows"} subtitle={fileName} pad={false}>
      <Table label={`Check ${kind} to import`}><thead><Tr><Th>Row</Th>{fields.filter((field) => used.includes(field.key)).map((field) => <Th key={field.key}>{field.label}</Th>)}<Th>Check</Th></Tr></thead><tbody>
        {rows.map((row, index) => <Tr key={row.row}><Td>{row.row}</Td>{fields.filter((field) => used.includes(field.key)).map((field) => <Td key={field.key}><Input aria-label={`Row ${row.row} ${field.label}`} value={row.values[field.key] || ""} disabled={busy || savedCount !== null}
          onChange={(event) => { setChecked(false); setRows((before) => before.map((item, i) => i === index ? { ...item, values: { ...item.values, [field.key]: event.target.value } } : item)); }} /></Td>)}<Td><span className={row.state === "fix" || row.state === "uncertain" ? "text-neg" : "text-fg2"}>{row.note}</span></Td></Tr>)}
      </tbody></Table>
      <div className="flex flex-wrap justify-between gap-3 p-4">
        <Button disabled={busy} onClick={() => { setStep(2); setSavedCount(null); }}>Back</Button>
        <Button disabled={busy || !allowed} loading={checkedRows.isPending} onClick={() => void check(rows.map((row) => row.values))}>Check rows again</Button>
        {savedCount === null ? <Button variant="primary" disabled={busy || !allowed || !checked || !ready} onClick={() => setStep(4)}>Continue to import</Button>
          : <ButtonLink to={`/${kind}`}>Open {kind}</ButtonLink>}
      </div>
    </Card> : null}
    {step === 4 && savedCount === null ? <Card title="4. Import" subtitle={`From ${fileName}`}>
      <div className="flex flex-col gap-4">
        <p>{plural(ready, ONE[kind])} will be added.</p>
        <p className="text-sm text-muted">{rows.filter((row) => row.state === "skip").length} already on file or repeated rows will be skipped. {rows.filter((row) => row.state === "fix").length} rows still need a fix and will be left out.</p>
        <p className="text-sm text-muted">Each row is saved separately. If a save stops, the report shows which rows were saved. Check the rows again before another import.</p>
        <div className="flex flex-wrap justify-between gap-3"><Button disabled={busy} onClick={() => setStep(3)}>Back</Button><Button variant="primary" loading={save.isPending} disabled={busy || !allowed || !checked || !ready}
          onClick={async () => { try { const result = await save.mutateAsync(); setRows(result.rows); setSavedCount(result.saved); setChecked(false); setStep(3); } catch (problem) { setError(problemOf(problem).message); } }}>Import {plural(ready, ONE[kind])}</Button></div>
      </div>
    </Card> : null}
  </Page>;
}
