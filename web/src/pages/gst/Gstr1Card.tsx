import { useState, type ReactNode } from "react";
import { Link } from "react-router";
import { useAuth } from "@/core/auth/AuthProvider";
import { date, monthLabel, plural } from "@/core/format";
import { GST_STATES, stateTitle } from "@/core/ids";
import type { BillRef, Gstr1, Month } from "@/core/gst/types";
import { Badge, Button, Card, DL, EmptyState, Money, Segmented, Sheet, Table, Tabs, Td, Th, Tr } from "@/core/ui";

export type Gstr1Section = "b2b" | "b2cl" | "b2c" | "rate" | "hsn" | "docs" | "cancelled";
export const HSN_NOTE = "UQC is the portal's unit code: GMS for grams, PCS for pieces, NOS for numbers, CTM for carats, NA for services (SAC 99xx, no quantity). B2B and B2C are listed apart, as the portal asks.";
export const DOCS_RULE = "Numbers missing from the series are reported as cancelled in Table 13 (a deleted bill used its number). Check none is a paper bill not entered yet before filing.";
const titles: Record<Gstr1Section, string> = { b2b: "B2B bills", b2cl: "B2CL bills", b2c: "B2C summary", rate: "By rate", hsn: "HSN summary", docs: "Documents issued", cancelled: "Cancelled bills" };
const labels: Record<Gstr1Section, string> = { b2b: "B2B", b2cl: "B2CL", b2c: "B2C", rate: "By rate", hsn: "HSN", docs: "Documents", cancelled: "Cancelled" };
const sections = Object.keys(titles) as Gstr1Section[];
const heads = ["igst", "cgst", "sgst"] as const;
const money = (value: number, strong = false) => <Money value={value} strong={strong} />;
const pos = (code: string, name?: string) => `${stateTitle(name || GST_STATES[code] || code)} (${code})`;
const rate = (value: string) => `${value}%`;
const Note = ({ children }: { children: ReactNode }) => <p className="px-5 pt-3 text-sm text-muted">{children}</p>;

type DisplayRow = { key: string; cells: ReactNode[]; title?: ReactNode; total?: boolean };
function Rows({ label, columns, rows, phone = false }: { label: string; columns: string[]; rows: DisplayRow[]; phone?: boolean }) {
  if (phone) return <div>{rows.map((row) => <div key={row.key} className="py-3 border-t border-rule first:border-t-0">{row.title ? <div className="font-medium">{row.title}</div> : null}<DL className="mt-1 text-sm" rows={columns.map((col, i) => [col, row.cells[i], { strong: row.total }])} /></div>)}</div>;
  return <Table label={label}><thead><tr>{columns.map((col, i) => <Th key={col} align={i && /value|tax|IGST|CGST|SGST|Rate|Quantity|Bills|Total|Cancelled|Net/.test(col) ? "right" : undefined}>{col}</Th>)}</tr></thead><tbody>{rows.map((row) => <Tr key={row.key} className={row.total ? "border-t border-line font-semibold" : undefined}>{row.cells.map((cell, i) => <Td key={columns[i]} align={i && /value|tax|IGST|CGST|SGST|Rate|Quantity|Bills|Total|Cancelled|Net/.test(columns[i]) ? "right" : undefined}>{cell}</Td>)}</Tr>)}</tbody></Table>;
}

export function Gstr1Card({ data, month, section, onSection, asFiled = false, onAsFiled, phone = false, actions }: {
  data: Gstr1; month?: Month; section: Gstr1Section; onSection: (section: Gstr1Section) => void; asFiled?: boolean; onAsFiled?: (asFiled: boolean) => void; phone?: boolean; actions?: ReactNode;
}) {
  const [sheet, setSheet] = useState<Gstr1Section | null>(null);
  const long = month ? monthLabel(month.month, { long: true }) : "this month";
  const current = sections.includes(section) ? section : "b2b";
  const counts: Record<Gstr1Section, number> = { b2b: data.b2b.length, b2cl: data.b2cl.length, b2c: data.b2cs.reduce((a, row) => a + row.bills, 0) + data.nil.reduce((a, row) => a + row.bills, 0), rate: data.by_rate.length, hsn: data.hsn.b2b.length + data.hsn.b2c.length, docs: data.docs.reduce((a, row) => a + row.total, 0), cancelled: data.cancelled.length };
  const filed = month?.record.gstr1;
  const billCount = asFiled ? month?.gstr1?.as_filed?.bills : month?.gstr1?.bills;
  const subtitle = `${long}${month?.stage === "open" ? " so far" : ""}${billCount !== undefined ? ` · ${plural(billCount, "sales bill")}` : ""}${asFiled ? " · as filed" : month?.stage === "unlocked" ? " · in the books now" : ""}${filed ? ` · filed ${date(filed.filed_on)}` : ""} · what the portal file carries`;
  return <Card pad={false} id="gst-gstr1" className="scroll-mt-6" title="GSTR-1 · sales return" subtitle={subtitle} actions={actions}>
    {filed && onAsFiled ? <div className="px-5 pt-3"><Segmented label="GSTR-1 figures" options={[{ value: "books", label: "Books now" }, { value: "filed", label: "As filed" }]} value={asFiled ? "filed" : "books"} onChange={(value) => onAsFiled(value === "filed")} /></div> : null}
    {phone ? <>
      <div className="p-4 flex flex-col">{sections.map((key) => <Button key={key} variant="ghost" className="justify-between" onClick={() => { onSection(key); setSheet(key); }}>{titles[key]} <span className="text-muted tnum">{counts[key]}</span></Button>)}</div>
      <Sheet open={sheet !== null} onClose={() => setSheet(null)} title={sheet ? titles[sheet] : ""} description={`${month?.firm.name ? `${month.firm.name} · ` : ""}${long}`}>
        {sheet ? <Section data={data} month={month} section={sheet} billCount={billCount} phone /> : null}
      </Sheet>
    </> : <>
      <Tabs tabs={sections.map((key) => ({ value: key, label: labels[key], count: counts[key] }))} value={current} onChange={onSection} label="GSTR-1 sections" idBase="g1" panelId="g1-panel" className="px-3 mt-1" />
      <div id="g1-panel" role="tabpanel" aria-labelledby={`g1-${current}`} className="pb-2 min-w-0"><Section data={data} month={month} section={current} billCount={billCount} /></div>
    </>}
  </Card>;
}

function Section({ data, month, section, billCount, phone = false }: { data: Gstr1; month?: Month; section: Gstr1Section; billCount?: number; phone?: boolean }) {
  const { can } = useAuth();
  const name = month ? monthLabel(month.month, { long: true, year: false }) : "this month";
  const long = month ? monthLabel(month.month, { long: true }) : "this month";
  const table = (label: string, columns: string[], rows: DisplayRow[]) => <Rows label={`${label}, ${long}`} columns={columns} rows={rows} phone={phone} />;
  const billCell = (bill: BillRef, showDeleted = true) => {
    const to = bill.status === "deleted" ? can("bill.delete") && bill.bin_id !== undefined ? `/audit?restore=${bill.bin_id}` : null : bill.id !== null ? `/sales/${bill.id}` : null;
    return <>{to ? <Link className="font-medium hover:text-brand tnum" to={to}>{bill.invoice_number}</Link> : <span className="font-medium tnum">{bill.invoice_number}</span>}{showDeleted && bill.status === "deleted" ? <Badge tone="neg">Deleted</Badge> : null}<span className="block text-xs text-muted tnum">{date(bill.invoice_date)}</span></>;
  };
  if (section === "b2b") {
    if (!data.b2b.length) return <EmptyState title={`No bills to registered buyers in ${name}`}>Bills to customers with a valid GSTIN go here, one by one. Bills to people without a GSTIN are under B2C, or B2CL when they're delivered to another state and over ₹1,00,000.</EmptyState>;
    const rows: DisplayRow[] = data.b2b.map((row) => ({ key: String(row.bill.id), cells: [billCell(row.bill), <><span className="block">{row.customer.name}</span><span className="block text-xs text-muted tnum break-all">{row.customer.gst_number} · {pos(row.place_of_supply)}</span></>, row.rates.map(rate).join(" · ") || "—", money(row.taxable), ...heads.map((head) => money(row[head])), <Money value={row.total} strong tone="sale" />] }));
    rows.push({ key: "total", total: true, cells: [`Total · ${plural(data.b2b.length, "bill")}`, "", "", ...(["taxable", ...heads, "total"] as const).map((key) => money(data.b2b.reduce((sum, row) => sum + row[key], 0)))] });
    return <>{table("B2B bills", ["Bill", "Buyer", "Rate", "Taxable value", "IGST", "CGST", "SGST", "Bill value"], rows)}<Note>One row per bill, as the portal wants for buyers with a GSTIN. Click a bill to open it.</Note></>;
  }
  if (section === "b2cl") {
    if (!data.b2cl.length) return <EmptyState title={`No B2CL bills in ${name}`}>B2CL is for inter-state sales (delivered outside the firm's state) to buyers without a GSTIN, with a bill value over ₹1,00,000. The portal takes them bill by bill.</EmptyState>;
    const rows: DisplayRow[] = data.b2cl.flatMap((row) => row.rates.map((slab, i) => ({ key: `${row.bill.id}:${i}`, cells: [i === 0 || phone ? billCell(row.bill) : null, i === 0 || phone ? row.customer.name : null, i === 0 || phone ? pos(row.place_of_supply, row.place_of_supply_name) : null, i === 0 || phone ? <Money value={row.total} strong tone="sale" /> : null, rate(slab.rate), money(slab.taxable), money(slab.igst)] })));
    rows.push({ key: "total", total: true, cells: [`Total · ${plural(data.b2cl.length, "bill")}`, "", "", money(data.b2cl.reduce((sum, row) => sum + row.total, 0)), "", money(data.b2cl.reduce((sum, row) => sum + row.rates.reduce((a, slab) => a + slab.taxable, 0), 0)), money(data.b2cl.reduce((sum, row) => sum + row.rates.reduce((a, slab) => a + slab.igst, 0), 0))] });
    return <>{table("B2CL bills", ["Bill", "Buyer", "Place of supply", "Bill value", "Rate", "Taxable value", "IGST"], rows)}<Note>Inter-state sales (delivered outside the firm's state) to buyers without a GSTIN, with a bill value over ₹1,00,000: the portal takes them bill by bill, with IGST. They're also in GSTR-3B Table 3.2, by state.</Note></>;
  }
  if (section === "b2c") {
    const rows: DisplayRow[] = data.b2cs.map((row, i) => ({ key: String(i), cells: [pos(row.place_of_supply, row.place_of_supply_name), row.interstate ? "To another state" : "Within the state", rate(row.rate), row.bills, money(row.taxable), ...heads.map((head) => money(row[head]))] }));
    if (rows.length) rows.push({ key: "total", total: true, cells: ["Total", "", "", data.b2cs.reduce((sum, row) => sum + row.bills, 0), ...(["taxable", ...heads] as const).map((key) => money(data.b2cs.reduce((sum, row) => sum + row[key], 0)))] });
    const supply: Record<string, string> = { INTRB2B: "To another state · buyers with a GSTIN", INTRAB2B: "Within the state · buyers with a GSTIN", INTRB2C: "To another state · people without a GSTIN", INTRAB2C: "Within the state · people without a GSTIN" };
    return <>{rows.length ? table("B2C summary", ["Place of supply", "Supply", "Rate", "Bills", "Taxable value", "IGST", "CGST", "SGST"], rows) : <EmptyState title={`No B2C bills in ${name}`}>Walk-in and other customers without a GSTIN are added up here by state and rate.</EmptyState>}
      <Note>Bills to people without a GSTIN go to the portal as totals by state and rate, not bill by bill.</Note>
      {data.nil.length ? <><h3 className="caps px-5 pt-5 pb-2">Nil-rated supplies · Table 8</h3>{table("Nil-rated supplies · Table 8", ["Supply", "Bills", "Bill value"], data.nil.map((row) => ({ key: row.supply, cells: [supply[row.supply] || row.supply, row.bills, money(row.value)] })))}</> : null}
    </>;
  }
  if (section === "rate") {
    if (!data.by_rate.length) return <EmptyState title={`No sales in ${name}`}>Each GST rate on the month's bills gets a row here.</EmptyState>;
    const rows: DisplayRow[] = data.by_rate.map((row) => ({ key: row.rate, cells: [rate(row.rate), money(row.taxable), ...heads.map((head) => money(row[head])), money(row.tax, true), <Money value={row.value} tone="sale" />, <Link className="link" aria-label={`Open the ${plural(row.bills, "bill")} at ${rate(row.rate)}`} to={`/sales?${month ? `firm=${month.business}&month=${month.month}&` : ""}gst_rate=${row.rate}`}>{row.bills}</Link>] }));
    rows.push({ key: "total", total: true, cells: ["Total", ...(["taxable", ...heads, "tax", "value"] as const).map((key) => money(data.by_rate.reduce((sum, row) => sum + row[key], 0))), billCount ?? "—"] });
    return <>{table("Sales by GST rate", ["Rate", "Taxable value", "IGST", "CGST", "SGST", "Total tax", "Bill value", "Bills"], rows)}<Note>Total tax is CGST + SGST + IGST; bill value adds the taxable value. A bill with lines at two rates counts under both. Click a count to open those bills.</Note></>;
  }
  if (section === "hsn") {
    if (!data.hsn.b2b.length && !data.hsn.b2c.length) return <EmptyState title={`No sales in ${name}`}>The HSN summary fills in from the month's sales bills.</EmptyState>;
    return <>{(["b2b", "b2c"] as const).map((group) => <div key={group}><h3 className="caps px-5 pt-5 pb-2">{group === "b2b" ? "B2B · bills to buyers with a GSTIN" : "B2C · bills to people without a GSTIN (B2CL and B2C)"}</h3>{data.hsn[group].length ? table(`HSN summary ${group.toUpperCase()}`, phone ? ["HSN", "Description", "UQC · quantity", "Rate", "Taxable value", "IGST", "CGST", "SGST"] : ["HSN", "Description", "UQC", "Quantity", "Rate", "Taxable value", "IGST", "CGST", "SGST"], data.hsn[group].map((row, i) => ({ key: `${group}:${i}`, cells: [row.hsn || "No HSN", row.description, ...(phone ? [`${row.uqc} · ${row.service ? "0" : row.quantity}`] : [row.uqc, row.service ? "0" : row.quantity]), rate(row.rate), money(row.taxable), ...heads.map((head) => money(row[head]))] }))) : <p className="px-5 py-2 text-sm text-muted">None this month</p>}</div>)}{table("HSN totals", ["Total", "Taxable value", "IGST", "CGST", "SGST"], [{ key: "total", total: true, cells: ["Total", ...(["taxable", ...heads] as const).map((key) => money([...data.hsn.b2b, ...data.hsn.b2c].reduce((sum, row) => sum + row[key], 0)))] }])}<Note>{HSN_NOTE}</Note></>;
  }
  if (section === "docs") {
    if (!data.docs.length) return <EmptyState title={`No bill numbers used in ${name}`}>Each month the portal asks which bill numbers were used, including cancelled ones.</EmptyState>;
    return <>{table("Documents issued", ["Document", "From", "To", "Total", "Cancelled", "Net issued"], data.docs.map((row, i) => ({ key: String(i), cells: ["Invoices for outward supply", row.from, row.to, row.total, row.cancelled, row.net] })))}{data.docs_notes.map((note) => <Note key={note}>{note}</Note>)}<Note>{DOCS_RULE}</Note></>;
  }
  if (!data.cancelled.length) return <EmptyState title={`No cancelled bills in ${name}`}>A cancelled bill keeps its number. It shows here and in Documents issued, and carries no tax.</EmptyState>;
  return <>{table("Cancelled bills", ["Bill", "Customer", "Bill value", "What happened"], data.cancelled.map((row, i) => ({ key: String(i), cells: [billCell(row.bill, false), row.bill.customer_name, <Money value={row.total} className="text-muted line-through decoration-1" />, <><Badge tone="neg">{row.kind === "deleted" ? "Deleted · in the bin" : "Cancelled"}</Badge><span className="block text-sm text-fg2 mt-1">{row.reason}{row.kind === "deleted" ? ` · ${date(row.on)}` : ""}</span></>] })))}<Note>Their values aren't in the return; only their numbers are, under Documents issued.{data.cancelled.some((row) => row.kind === "deleted") ? can("bill.delete") ? <> A deleted bill can be restored from the <Link to="/audit" className="link">Audit log</Link>.</> : " The owner can restore a deleted bill from the Audit log." : null}</Note></>;
}
