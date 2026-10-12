import { api } from "@/core/api/client";
import { problemOf } from "@/core/api/errors";
import { checkGstin, emailProblem, gstinPlaceholder, mobileDigits, mobileProblem, panProblem, stateCodeOf, GST_STATES } from "@/core/ids";
import { UNITS } from "@/core/format";
import { SLABS, slabOf } from "@/pages/sales/form/model";

export type RecordImportKind = "customers" | "products" | "firms";
export type RecordCells = Record<string, string>;
export type RecordImportRow = { row: number; values: RecordCells; state: "ready" | "skip" | "fix" | "saved" | "uncertain"; note: string };
export type RecordImportResult = { saved: number; total: number; rows: RecordImportRow[]; failure?: { row: number; problem: string } };
type Wire = Record<string, unknown>;
const text = (value: unknown) => String(value ?? "").trim();
const nameKey = (value: unknown) => text(value).replace(/\s+/g, " ").toLowerCase();
// ponytail: §0.3 runtime values; 4C exports only a kind type. Reuse its allowlist if it adds one.
const PRODUCT_KINDS = ["gold", "silver", "diamond", "bullion", "service", "packing", "other"];

/** The existing slab allowlist decides both spellings; 0.25 means 0.25%, never 25%. */
function percent(raw: string): string {
  const value = text(raw);
  if (!value) return "";
  const direct = slabOf(value.replace(/%$/, ""));
  if (direct !== "" || value.endsWith("%")) return direct;
  return SLABS.find((slab) => Number(slab) / 100 === Number(value)) ?? "";
}

function productBody(v: RecordCells): Wire {
  const unit = text(v.unit || "gms").toLowerCase();
  return {
    name: text(v.name).replace(/\s+/g, " "), hsn_code: text(v.hsn_code), gst_percent: percent(v.gst_percent),
    unit: unit === "cts" ? "ct" : unit, kind: text(v.kind).toLowerCase() || null, purity: text(v.purity),
    usual_rate: text(v.usual_rate) || null, purchase_only: ["yes", "true", "1"].includes(text(v.purchase_only).toLowerCase()), description: text(v.description),
  };
}
function customerBody(v: RecordCells): Wire {
  const gst = gstinPlaceholder(v.gst_number) ? "" : text(v.gst_number).toUpperCase();
  const checked = checkGstin(gst);
  return {
    name: text(v.name).replace(/\s+/g, " "), mobile_number: mobileDigits(v.mobile_number), email: text(v.email),
    gst_number: gst, pan_number: checked.status === "valid" ? checked.pan : text(v.pan_number).toUpperCase(),
    customer_type: gst ? "business" : "person", state_name: checked.status === "valid" ? checked.state : GST_STATES[stateCodeOf(v.state_name)] || "",
    address: text(v.address), city: text(v.city),
  };
}

function firmBody(v: RecordCells): Wire {
  return {
    name: text(v.name).replace(/\s+/g, " "), short_name: text(v.short_name), gst_number: text(v.gst_number).toUpperCase(),
    address: text(v.address), city: text(v.city), pin_code: text(v.pin_code), mobile_number: mobileDigits(v.mobile_number), email: text(v.email),
    bank_name: text(v.bank_name), bank_account_number: text(v.bank_account_number), bank_ifsc_code: text(v.bank_ifsc_code).toUpperCase(), bank_branch_name: text(v.bank_branch_name),
    invoice_prefix: text(v.invoice_prefix).toUpperCase(), paper_full_number_from: text(v.paper_full_number_from) || null,
    signature_on_bills: !["no", "false", "0"].includes(text(v.signature_on_bills).toLowerCase()), jurisdiction: text(v.jurisdiction), declaration: text(v.declaration),
  };
}

function problem(kind: RecordImportKind, v: RecordCells): string {
  if (!text(v.name)) return kind === "products" ? "This row has no product name." : kind === "firms" ? "Enter the firm's legal name, as on its GST certificate." : "This row has no name.";
  if (text(v.name).length > 255) return "Keep the name to 255 characters.";
  if (kind === "products") {
    const p = productBody(v);
    if (!/^\d{4,8}$/.test(text(v.hsn_code))) return `HSN “${v.hsn_code || ""}” has ${text(v.hsn_code).replace(/\D/g, "").length} digits; HSN codes have 4 to 8. Type it from the bill.`;
    if (p.gst_percent === "") return "Choose one of the GST rates: 0, 0.1, 0.25, 1, 1.5, 3, 5, 12, 18, 28 or 40%.";
    if (!UNITS.some((unit) => unit.value === p.unit)) return "Pick a unit from the list.";
    if (p.kind && !PRODUCT_KINDS.includes(String(p.kind))) return "Pick a kind from the list.";
    if (text(v.purity).length > 20) return "Keep the purity short, like 22K or 925 (20 characters at most).";
    if (v.usual_rate && (!/^\d+(\.\d{1,3})?$/.test(v.usual_rate) || Number(v.usual_rate) <= 0 || Number(v.usual_rate) >= 100000000)) return "Type the usual rate, like 6470.00, or leave it empty.";
    if (text(v.description).length > 1000) return "Keep the description to 1,000 characters.";
    if (!["", "yes", "no", "true", "false", "1", "0"].includes(text(v.purchase_only).toLowerCase())) return "Bought only must be Yes or No.";
    return "";
  }
  if (kind === "customers") {
    const c = customerBody(v), gst = checkGstin(String(c.gst_number));
    if (!v.mobile_number) return "Mobile is required.";
    const phone = mobileProblem(v.mobile_number);
    if (phone) return phone;
    if (gst.status === "short" || gst.status === "invalid") return gst.problem;
    if (gst.status === "check") return `${v.gst_number} doesn't check out. Check it against the GST certificate.`;
    if (panProblem(v.pan_number)) return panProblem(v.pan_number);
    if (emailProblem(v.email)) return emailProblem(v.email);
    if (v.state_name && !stateCodeOf(v.state_name) && gst.status !== "valid") return "Pick a state from the list.";
    if (text(v.address).length > 255) return "Keep the address to 255 characters.";
    if (text(v.city).length > 100) return "Keep the city to 100 characters.";
    return "";
  }
  const gst = checkGstin(v.gst_number);
  if (gst.status === "empty") return "Enter the firm's GSTIN. It prints at the top of every bill.";
  if (gst.status === "short" || gst.status === "invalid") return gst.problem;
  if (gst.status === "check") return "Check digit doesn't match — likely a typo.";
  if (!text(v.address)) return "Enter the address printed on bills.";
  if (!mobileDigits(v.mobile_number)) return "Enter a phone number for bills.";
  if (mobileProblem(v.mobile_number)) return mobileProblem(v.mobile_number);
  if (emailProblem(v.email)) return "That email looks incomplete. It should look like accounts@example.in.";
  for (const [key, max, label] of [["short_name", 20, "short name"], ["address", 255, "address"], ["city", 100, "city"], ["bank_name", 255, "bank name"], ["bank_branch_name", 255, "branch name"], ["jurisdiction", 100, "jurisdiction"], ["declaration", 500, "declaration"]] as const) {
    if (text(v[key]).length > max) return `Keep the ${label} to ${max} characters.`;
  }
  if (text(v.pin_code) && !/^\d{6}$/.test(text(v.pin_code))) return `A PIN code has 6 digits; this has ${text(v.pin_code).replace(/\D/g, "").length}.`;
  if (text(v.bank_account_number) && !/^\d{9,18}$/.test(text(v.bank_account_number))) return `Account numbers have 9 to 18 digits; this has ${text(v.bank_account_number).replace(/\D/g, "").length}.`;
  if (text(v.bank_ifsc_code) && !/^[A-Z]{4}0[A-Z0-9]{6}$/i.test(text(v.bank_ifsc_code))) return "An IFSC has 11 characters: 4 letters, a zero, then 6 letters or digits (like SBIN0UDR014).";
  if (text(v.invoice_prefix) && !/^[A-Z]{1,4}$/i.test(text(v.invoice_prefix))) return "Use 1 to 4 capital letters, like KGH. A GST bill number can have at most 16 characters.";
  const date = text(v.paper_full_number_from);
  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T00:00:00Z`).getUTCDate() !== Number(date.slice(8))) return "Type the date like 2027-04-01.";
    if (Number(date.slice(0, 4)) < 2000 || Number(date.slice(0, 4)) > 2099) return "Pick a date from 2000 to 2099.";
  }
  if (!["", "yes", "no", "true", "false", "1", "0"].includes(text(v.signature_on_bills).toLowerCase())) return "Signature on bills must be Yes or No.";
  return "";
}

/** Read each existing record once per batch, including supplier-only customers. */
async function existingRecords(kind: RecordImportKind): Promise<Wire[]> {
  const rows: Wire[] = [];
  for (let page = 1; page <= 100; page++) {
    const data = (await api.get(kind === "products" ? "catalog/" : `${kind}/`, { params: { page, page_size: 1000 } })).data as { results: Wire[]; next?: string | null } | Wire[];
    rows.push(...(Array.isArray(data) ? data : data.results));
    if (Array.isArray(data) || !data.next) return rows;
  }
  throw new Error("The record list didn't end after 100 pages.");
}

export function recordImportMessage(error: unknown): string {
  const p = problemOf(error);
  return p.kind === "throttled" ? "The daily request limit has been reached. Try again tomorrow." : p.message;
}

function checkOne(kind: RecordImportKind, row: RecordImportRow, existing: Wire[]): RecordImportRow {
  const v = row.values, bad = problem(kind, v);
  if (bad) return { ...row, state: "fix", note: bad };
  const gstin = kind === "products" || gstinPlaceholder(v.gst_number) ? "" : text(v.gst_number).toUpperCase();
  const found = existing.find(record => nameKey(record.name) === nameKey(v.name) || (gstin && text(record.gst_number).toUpperCase() === gstin));
  if (found) return { ...row, state: "skip", note: kind === "products" ? `Already in products: ${found.name}. Will be skipped.` : `Already a ${kind === "firms" ? "firm" : "customer"}: ${found.name}. Will be skipped.` };
  return { ...row, state: "ready", note: kind === "products" ? `${productBody(v).gst_percent}% · sold by ${productBody(v).unit}` : kind === "firms" ? "New firm. Will be added." : gstin ? "Business customer" : "Person, no GSTIN" };
}

export async function checkRecordRows(kind: RecordImportKind, values: RecordCells[]): Promise<RecordImportRow[]> {
  const rows: RecordImportRow[] = [];
  const seen = new Set<string>();
  const existing = values.some(cells => !problem(kind, cells)) ? await existingRecords(kind) : [];
  for (const [index, cells] of values.entries()) {
    const keys = kind === "customers" ? [cells.gst_number && !gstinPlaceholder(cells.gst_number) && `gst:${text(cells.gst_number).toUpperCase()}`, `name:${nameKey(cells.name)}`]
      : kind === "firms" ? [`gst:${text(cells.gst_number).toUpperCase()}`, `name:${nameKey(cells.name)}`] : [`name:${nameKey(cells.name)}`];
    const row: RecordImportRow = { row: Number(cells.__row) || index + 2, values: cells, state: "ready", note: "" };
    if (keys.some((key) => key && seen.has(key))) rows.push({ ...row, state: "skip", note: "Listed twice in the file. Will be skipped." });
    else {
      const checked = checkOne(kind, row, existing);
      rows.push(checked);
      if (checked.state !== "fix") for (const key of keys) if (key) seen.add(key);
    }
  }
  return rows;
}

/** CRUD has no batch transaction or idempotency token. Never retry a write; report confirmed rows and stop. */
export async function saveRecordRows(kind: RecordImportKind, preview: RecordImportRow[]): Promise<RecordImportResult> {
  const rows = preview.map((row) => ({ ...row }));
  const total = rows.filter((row) => row.state !== "skip" && row.state !== "saved").length;
  let saved = 0;
  let failure: RecordImportResult["failure"];
  let existing: Wire[] | undefined;
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].state === "skip" || rows[i].state === "saved") continue;
    if (rows[i].state === "fix" || rows[i].state === "uncertain") {
      failure = { row: rows[i].row, problem: rows[i].note };
      break;
    }
    let writing = false;
    try {
      existing ??= await existingRecords(kind);
      rows[i] = checkOne(kind, rows[i], existing);
      if (rows[i].state === "skip") continue;
      if (rows[i].state === "fix") { failure = { row: rows[i].row, problem: rows[i].note }; break; }
      const v = rows[i].values;
      writing = true;
      const body = kind === "customers" ? customerBody(v) : kind === "products" ? productBody(v) : firmBody(v);
      const answer = await api.post(kind === "customers" ? "customers/" : kind === "products" ? "catalog/" : "firms/", body);
      existing.push({ ...body, ...answer.data });
      rows[i] = { ...rows[i], state: "saved", note: "Imported" };
      saved++;
    } catch (error) {
      const p = problemOf(error);
      const uncertain = writing && !["validation", "conflict", "forbidden", "auth", "notfound", "throttled"].includes(p.kind);
      rows[i] = { ...rows[i], state: uncertain ? "uncertain" : "fix", note: uncertain ? "The answer didn't arrive, so this row may have been saved. Check the rows again before another import." : recordImportMessage(error) };
      failure = { row: rows[i].row, problem: recordImportMessage(error) };
      break;
    }
  }
  return { saved, total, rows, failure };
}
