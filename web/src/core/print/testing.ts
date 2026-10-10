// What printing's tests share (only tests import this file): a react-pdf document's element tree, a real PDF's plain
// parts, and bills at the edges of the page plan, as overrides of the contract's example (core/sales/fixtures).
import { Fragment, isValidElement, type ReactElement, type ReactNode } from "react";
import { wireDetail, WIRE_LINES } from "@/core/sales/fixtures";

/* ── A document's element tree ─────────────────────────── */
export type PdfNode = { type: string; props: Record<string, unknown>; children: (PdfNode | string)[] };
/** The tree react-pdf would lay out: function components called, primitives ("PAGE", "TEXT"…) kept with their props. */
export function expand(node: ReactNode): (PdfNode | string)[] {
  if (node == null || typeof node === "boolean") return [];
  if (typeof node === "string" || typeof node === "number") return [String(node)];
  if (Array.isArray(node)) return node.flatMap(expand);
  if (!isValidElement(node)) return [];
  const el = node as ReactElement<Record<string, unknown>>;
  if (el.type === Fragment) return expand(el.props.children as ReactNode);
  if (typeof el.type === "function") return expand((el.type as (p: unknown) => ReactNode)(el.props));
  const { children, ...props } = el.props;
  return [{ type: String(el.type), props, children: expand(children as ReactNode) }];
}
/** Every node of a type under `n`, itself included, in reading order. */
export const nodes = (n: PdfNode | string, type: string): PdfNode[] => (typeof n === "string" ? [] : [...(n.type === type ? [n] : []), ...n.children.flatMap((c) => nodes(c, type))]);
/** A node's words: each TEXT's strings run together as react-pdf draws them, one space between separate texts. */
export function raw(n: PdfNode | string): string {
  return typeof n === "string" ? n : n.children.map(raw).join(n.type === "TEXT" ? "" : " ");
}
export const words = (n: PdfNode | string) => raw(n).replace(/\s+/g, " ").trim();
/** A style as react-pdf reads it: a list of styles merged, the later winning. */
export const flat = (style: unknown): Record<string, unknown> => Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
/** The texts that hold a ₹ someone could see: each must hold only that ₹, in the RupeeSign font (Ruling 1E-5). */
export const rupeeTexts = (n: PdfNode) => nodes(n, "TEXT").filter((t) => t.children.some((c) => typeof c === "string" && c.includes("₹")));

/* ── A real file ───────────────────────────────────────── */
/** A PDF's bytes as text (jsdom's Blob reads through a FileReader; compressed streams don't survive, plain objects do). */
export async function pdfText(blob: Blob): Promise<string> {
  const buf = await new Promise<ArrayBuffer>((done) => { const r = new FileReader(); r.onload = () => done(r.result as ArrayBuffer); r.readAsArrayBuffer(blob); });
  return new TextDecoder("latin1").decode(buf);
}
/** The sheets react-pdf made: its page tree's count. */
export const sheetsIn = (pdf: string) => Number(pdf.match(/\/Type \/Pages\s*\/Count (\d+)/)?.[1]);

/* ── Bills at the edges of the page plan ───────────────── */
/** n rows of the contract's ring, each named on one line; over: what a row changes, by its place. */
export const rows = (n: number, over: (i: number) => Record<string, unknown> = () => ({})) =>
  Array.from({ length: n }, (_, i) => ({ ...WIRE_LINES[0], id: i + 1, product_name: `Gold Ring 22K ${i + 1}`, ...over(i) }));
export const firmWith = (over: Record<string, unknown>) => ({ ...(wireDetail().firm as object), ...over });
export const buyerWith = (over: Record<string, unknown>) => ({ ...(wireDetail().customer as object), ...over });
/** A counter sale in the firm's own state: no name, address or GSTIN on the bill. */
export const WALKIN = { id: 9, name: "Walk-in Customer", type: "walkin", address: "", city: "", state_name: "RAJASTHAN", state_code: "08", gst_number: "", gstin_valid: null, pan_number: "", pan: "", mobile_number: "", email: "" };
/** A business buyer whose name, in capitals as the GST portal spells it, is too long for one line of its block. */
export const LONG_BUYER = buyerWith({ type: "business", name: "M/S SHREE MAHAVEER JEWELLERS AND ORNAMENT MANUFACTURERS", gst_number: "08AAKFS4821M1ZQ" });
/** Goods sent by road with a transporter whose name and GSTIN wrap in their box. */
export const TRANSPORTED = {
  eway_bill_number: "123456789012", transporter_name: "SHREE GANESH ROADWAYS AND LOGISTICS COMPANY", transporter_gstin: "08AAKFS4821M1ZQ",
  vehicle_number: "RJ14AB1234", vehicle_type: "Regular", transport_mode: "Road", distance_km: 1200, may_be_needed: false,
};
/** Ruling 1E-9's bill: the firm's and the buyer's addresses typed on two lines each, and 30 one-line rows (23 and 7). */
export const TWO_LINE_ADDRESSES = {
  firm: firmWith({ address: "12 Sandbox Bazaar\nJaipur, Rajasthan" }),
  customer: buyerWith({ address: "Shop 12, Ground Floor\nBapu Bazaar" }),
  lines: rows(30),
};
/** The contract's bill sent to Gujarat: IGST on each line, by slab and by HSN. */
export const IGST = {
  interstate: true, cgst: "0.00", sgst: "0.00", igst: "2536.40", place_of_supply: "24",
  lines: WIRE_LINES.map((l) => ({ ...l, cgst: "0.00", sgst: "0.00", igst: l.tax })),
  slabs: [{ gst_percent: "3", taxable: "84546.81", cgst: "0.00", sgst: "0.00", igst: "2536.40", tax: "2536.40" }],
  hsn_summary: [
    { hsn_code: "711319", gst_percent: "3", unit: "gms", quantity: "12.345", taxable: "80396.81", cgst: "0.00", sgst: "0.00", igst: "2411.90", tax: "2411.90" },
    { hsn_code: "711319", gst_percent: "3", unit: "pcs", quantity: "1.000", taxable: "4150.00", cgst: "0.00", sgst: "0.00", igst: "124.50", tax: "124.50" },
  ],
};
