/**
 * Tally-Style GST Tax Invoice PDF Template — 2-Page Format
 * Page 1: Title + QR/IRN + Business/Consignee/Buyer + Items + Taxes + "continued to page 2"
 * Page 2: "TAX INVOICE (Page 2)" + repeated header + Rounding + Total + Words + HSN + Declaration
 */
import {
  Document,
  Page,
  Text,
  View,
  Image,
  StyleSheet,
} from "@react-pdf/renderer";
import type { Invoice } from "@/utils/mockData";
import type { Business, Customer } from "@/hooks/useDataStore";
import { amountToWords } from "@/utils/mockData";

// ── Helpers ──────────────────────────────────────────────

const STATE_CODES: Record<string, string> = {
  "01": "Jammu & Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh",
  "05": "Uttarakhand", "06": "Haryana", "07": "Delhi", "08": "Rajasthan",
  "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh",
  "13": "Nagaland", "14": "Manipur", "15": "Mizoram", "16": "Tripura",
  "17": "Meghalaya", "18": "Assam", "19": "West Bengal", "20": "Jharkhand",
  "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat",
  "25": "Daman & Diu", "26": "Dadra & Nagar Haveli", "27": "Maharashtra",
  "29": "Karnataka", "30": "Goa", "32": "Kerala", "33": "Tamil Nadu",
  "34": "Puducherry", "35": "Andaman & Nicobar Islands", "36": "Telangana",
  "37": "Andhra Pradesh", "38": "Ladakh",
};

function getStateInfo(gst: string | undefined, stateName: string): { name: string; code: string } {
  if (gst && gst.length >= 2) {
    const code = gst.slice(0, 2);
    const name = STATE_CODES[code] || stateName;
    return { name, code };
  }
  return { name: stateName, code: "" };
}

function formatINR(n: number): string {
  const fixed = Math.abs(n).toFixed(2);
  const [intPart, decPart] = fixed.split(".");
  const lastThree = intPart.slice(-3);
  const rest = intPart.slice(0, -3);
  const formatted = rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + (rest ? "," : "") + lastThree;
  return formatted + "." + decPart;
}

function formatQty(qty: number): string {
  // Show up to 5 decimals but trim trailing zeros (min 3 decimals)
  const fixed5 = qty.toFixed(5);
  const trimmed = fixed5.replace(/0+$/, "");
  const parts = trimmed.split(".");
  if (!parts[1] || parts[1].length < 3) return qty.toFixed(3);
  return trimmed;
}

function formatRounding(n: number): string {
  if (n < 0) return `(-)${formatINR(Math.abs(n))}`;
  if (n > 0) return `(+)${formatINR(n)}`;
  return "0.00";
}

function formatDate(dateStr: string): string {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  try {
    const [y, m, d] = dateStr.split("-");
    return `${d}-${months[parseInt(m) - 1]}-${y.slice(-2)}`;
  } catch {
    return dateStr;
  }
}

// ── Styles ──────────────────────────────────────────────

const B = "1pt solid #000";
const B_THIN = "0.5pt solid #999";

const s = StyleSheet.create({
  page: {
    fontFamily: "Times-Roman",
    fontSize: 9,
    paddingTop: 14,
    paddingBottom: 14,
    paddingHorizontal: 20,
  },
  outer: { border: B, flex: 1 },
  bold: { fontFamily: "Times-Bold" },
  italic: { fontFamily: "Times-Italic" },
  boldItalic: { fontFamily: "Times-BoldItalic" },
  small: { fontSize: 7.5 },
  tiny: { fontSize: 7 },

  // ── Title ──
  titleRow: { flexDirection: "row", borderBottom: B, minHeight: 22 },
  titleText: { fontSize: 12, fontFamily: "Times-Bold", textAlign: "center", flex: 1, paddingVertical: 4 },
  eInvoiceBox: { borderLeft: B, width: 80, alignItems: "center", justifyContent: "center", padding: 4 },

  // ── IRN ──
  irnSection: { borderBottom: B, paddingHorizontal: 10, paddingVertical: 4 },
  irnRow: { flexDirection: "row", marginBottom: 1 },
  irnLabel: { width: 60, fontFamily: "Times-Bold", fontSize: 8 },
  irnColon: { width: 10, fontSize: 8 },
  irnValue: { flex: 1, fontSize: 8, fontFamily: "Times-Bold" },

  // ── Combined Info Section ──
  infoSection: { flexDirection: "row", borderBottom: B },
  infoLeft: { flex: 1, borderRight: B },
  infoRight: { width: 240 },

  bizBlock: { padding: 5, borderBottom: B },
  shipBlock: { padding: 5, borderBottom: B },
  billBlock: { padding: 5 },

  metaRow: { flexDirection: "row", borderBottom: B, minHeight: 22 },
  metaRowLast: { flexDirection: "row", minHeight: 22 },
  metaCellLeft: { flex: 1, borderRight: B, padding: 3 },
  metaCellRight: { flex: 1, padding: 3 },
  metaCellFull: { flex: 1, padding: 3 },
  metaLabel: { fontSize: 7, color: "#555", marginBottom: 1 },
  metaValue: { fontSize: 9, fontFamily: "Times-Bold" },

  // ── Items Table ──
  tableHeader: { flexDirection: "row", borderBottom: B, backgroundColor: "#f5f5f5" },
  row: { flexDirection: "row", borderBottom: B_THIN, minHeight: 18 },
  rowNoBorder: { flexDirection: "row", minHeight: 18 },

  colSl: { width: 24, padding: 3, borderRight: B, textAlign: "center" },
  colDesc: { flex: 1, padding: 3, borderRight: B },
  colHSN: { width: 50, padding: 3, borderRight: B, textAlign: "center" },
  colQty: { width: 62, padding: 3, borderRight: B, textAlign: "right" },
  colRate: { width: 58, padding: 3, borderRight: B, textAlign: "right" },
  colPer: { width: 30, padding: 3, borderRight: B, textAlign: "center" },
  colAmt: { width: 80, padding: 3, textAlign: "right" },

  // ── Total row ──
  totalRow: { flexDirection: "row", borderTop: B, borderBottom: B },

  // ── Amount in words ──
  wordsSection: { borderBottom: B, paddingHorizontal: 5, paddingVertical: 3 },
  wordsRow: { flexDirection: "row", justifyContent: "space-between" },

  // ── Tax Summary ──
  taxHeader: { flexDirection: "row", borderBottom: B, backgroundColor: "#f5f5f5" },
  taxRow: { flexDirection: "row", borderBottom: B_THIN },
  taxRowBold: { flexDirection: "row", borderBottom: B },
  taxCell: { padding: 3, borderRight: B, textAlign: "right" },
  taxCellLast: { padding: 3, textAlign: "right" },

  // ── Footer ──
  panRow: { borderBottom: B, padding: 4, flexDirection: "row" },
  footerRow: { flexDirection: "row", borderBottom: B },
  declaration: { flex: 1, padding: 5, borderRight: B, fontSize: 7.5 },
  signatory: { width: 180, padding: 5, textAlign: "right" },
  jurisdiction: { textAlign: "center", fontSize: 7.5, paddingVertical: 3, borderBottom: B },
  computerGen: { textAlign: "center", fontSize: 7, color: "#666", paddingVertical: 3 },
});

// ── Types ──────────────────────────────────────────────

interface TallyInvoicePDFProps {
  invoice: Invoice & Record<string, any>;
  business: Business;
  customer: Customer;
  qrDataUrl?: string;
}

interface HSNSummary {
  hsn: string;
  taxableValue: number;
  gstRate: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalTax: number;
}

function buildHSNSummary(invoice: Invoice): HSNSummary[] {
  const map = new Map<string, HSNSummary>();
  for (const item of invoice.items) {
    const key = `${item.hsn}-${item.gstRate}`;
    const existing = map.get(key);
    if (existing) {
      existing.taxableValue += item.amount;
      existing.cgst += item.cgst;
      existing.sgst += item.sgst;
      existing.igst += item.igst;
      existing.totalTax += item.cgst + item.sgst + item.igst;
    } else {
      map.set(key, {
        hsn: item.hsn,
        taxableValue: item.amount,
        gstRate: item.gstRate,
        cgst: item.cgst,
        sgst: item.sgst,
        igst: item.igst,
        totalTax: item.cgst + item.sgst + item.igst,
      });
    }
  }
  return Array.from(map.values());
}

// ── Shared Sub-Components ──────────────────────────────

function InfoBlock({ invoice, business, customer, bizState, custState, shipState }: {
  invoice: Invoice; business: Business; customer: Customer;
  bizState: { name: string; code: string }; custState: { name: string; code: string }; shipState: { name: string; code: string };
}) {
  return (
    <View style={s.infoSection}>
      {/* LEFT: Business + Consignee + Buyer */}
      <View style={s.infoLeft}>
        <View style={s.bizBlock}>
          <Text style={[s.bold, { fontSize: 11, marginBottom: 2 }]}>{business.name}</Text>
          <Text>{business.address}</Text>
          {bizState.code && <Text>{bizState.name} - Code-{bizState.code}</Text>}
          <Text>GSTIN/UIN: {business.gst_number}</Text>
          {bizState.code && <Text>State Name : {bizState.name}, Code : {bizState.code}</Text>}
          {business.email && <Text>E-Mail : {business.email}</Text>}
        </View>
        <View style={s.shipBlock}>
          <Text style={s.small}>Consignee (Ship to)</Text>
          <Text style={[s.bold, { marginTop: 1 }]}>{invoice.shippingName || customer.name}</Text>
          <Text>{invoice.shippingAddress || customer.address}</Text>
          <Text style={s.bold}>GSTIN/UIN : {invoice.shippingGst || customer.gst_number || "-"}</Text>
          {shipState.code && <Text>State Name : {shipState.name}, Code : {shipState.code}</Text>}
        </View>
        <View style={s.billBlock}>
          <Text style={s.small}>Buyer (Bill to)</Text>
          <Text style={[s.bold, { marginTop: 1 }]}>{customer.name}</Text>
          <Text>{customer.address}</Text>
          <Text style={s.bold}>GSTIN/UIN : {customer.gst_number || "-"}</Text>
          {custState.code && <Text>State Name : {custState.name}, Code : {custState.code}</Text>}
        </View>
      </View>

      {/* RIGHT: 7 metadata rows */}
      <View style={s.infoRight}>
        <View style={s.metaRow}>
          <View style={s.metaCellLeft}>
            <Text style={s.metaLabel}>Invoice No.</Text>
            <Text style={s.metaValue}>{invoice.invoiceNumber}</Text>
          </View>
          <View style={s.metaCellRight}>
            <Text style={s.metaLabel}>Dated</Text>
            <Text style={s.metaValue}>{formatDate(invoice.invoice_date)}</Text>
          </View>
        </View>
        <View style={s.metaRow}>
          <View style={s.metaCellLeft}>
            <Text style={s.metaLabel}>Delivery Note</Text>
            <Text>{invoice.deliveryNote || ""}</Text>
          </View>
          <View style={s.metaCellRight}>
            <Text style={s.metaLabel}>Mode/Terms of Payment</Text>
            <Text>{invoice.modeOfPayment || ""}</Text>
          </View>
        </View>
        <View style={s.metaRow}>
          <View style={s.metaCellLeft}>
            <Text style={s.metaLabel}>Reference No. & Date.</Text>
            <Text>{invoice.referenceNo || ""}</Text>
          </View>
          <View style={s.metaCellRight}>
            <Text style={s.metaLabel}>Other References</Text>
            <Text>{invoice.referenceDate || ""}</Text>
          </View>
        </View>
        <View style={s.metaRow}>
          <View style={s.metaCellLeft}>
            <Text style={s.metaLabel}>Buyer's Order No.</Text>
            <Text>{invoice.buyersOrderNo || ""}</Text>
          </View>
          <View style={s.metaCellRight}>
            <Text style={s.metaLabel}>Dated</Text>
            <Text>{invoice.buyersOrderDate || ""}</Text>
          </View>
        </View>
        <View style={s.metaRow}>
          <View style={s.metaCellLeft}>
            <Text style={s.metaLabel}>Dispatch Doc No.</Text>
            <Text>{invoice.dispatchDocNo || ""}</Text>
          </View>
          <View style={s.metaCellRight}>
            <Text style={s.metaLabel}>Delivery Note Date</Text>
            <Text>{invoice.deliveryNoteDate || ""}</Text>
          </View>
        </View>
        <View style={s.metaRow}>
          <View style={s.metaCellLeft}>
            <Text style={s.metaLabel}>Dispatched through</Text>
            <Text>{invoice.dispatchedThrough || ""}</Text>
          </View>
          <View style={s.metaCellRight}>
            <Text style={s.metaLabel}>Destination</Text>
            <Text>{invoice.destination || ""}</Text>
          </View>
        </View>
        <View style={s.metaRowLast}>
          <View style={s.metaCellFull}>
            <Text style={s.metaLabel}>Terms of Delivery</Text>
            <Text>{invoice.termsOfDelivery || ""}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

function TableHeader() {
  return (
    <View style={s.tableHeader}>
      <Text style={[s.colSl, s.bold]}>Sl{"\n"}No.</Text>
      <Text style={[s.colDesc, s.bold]}>Description of Goods</Text>
      <Text style={[s.colHSN, s.bold]}>HSN/SAC</Text>
      <Text style={[s.colQty, s.bold]}>Quantity</Text>
      <Text style={[s.colRate, s.bold]}>Rate</Text>
      <Text style={[s.colPer, s.bold]}>per</Text>
      <Text style={[s.colAmt, s.bold]}>Amount</Text>
    </View>
  );
}

// ── Main Component ──────────────────────────────────────

export default function TallyInvoicePDF({ invoice, business, customer, qrDataUrl }: TallyInvoicePDFProps) {
  const hsnSummary = buildHSNSummary(invoice);
  const totalHSNTax = hsnSummary.reduce((a, h) => a + h.totalTax, 0);
  const totalHSNTaxable = hsnSummary.reduce((a, h) => a + h.taxableValue, 0);
  const bizState = getStateInfo(business.gst_number, business.state_name);
  const custState = getStateInfo(customer.gst_number, customer.state_name);
  const shipState = invoice.shippingGst
    ? getStateInfo(invoice.shippingGst, invoice.shippingState || customer.state_name)
    : custState;

  const units = [...new Set(invoice.items.map((i) => i.unit || "pcs"))];
  const singleUnit = units.length === 1 ? units[0] : null;
  const totalQty = invoice.items.reduce((a, i) => a + i.qty, 0);

  const infoProps = { invoice, business, customer, bizState, custState, shipState };

  return (
    <Document title={`Invoice ${invoice.invoiceNumber}`} author={business.name}>
      {/* ════════════════════ PAGE 1 ════════════════════ */}
      <Page size="A4" style={s.page}>
        <View style={s.outer}>
          {/* TITLE */}
          <View style={s.titleRow}>
            <Text style={s.titleText}>TAX INVOICE</Text>
            {(qrDataUrl || invoice.irn) && (
              <View style={s.eInvoiceBox}>
                {invoice.irn && <Text style={{ fontSize: 8, fontFamily: "Times-Bold" }}>e-Invoice</Text>}
                {qrDataUrl ? (
                  <Image src={qrDataUrl} style={{ marginTop: 3, width: 55, height: 55 }} />
                ) : null}
              </View>
            )}
          </View>

          {/* IRN / ACK */}
          {invoice.irn && (
            <View style={s.irnSection}>
              <View style={s.irnRow}>
                <Text style={s.irnLabel}>IRN</Text>
                <Text style={s.irnColon}>:</Text>
                <Text style={s.irnValue}>{invoice.irn}</Text>
              </View>
              {invoice.ackNo && (
                <View style={s.irnRow}>
                  <Text style={s.irnLabel}>Ack No.</Text>
                  <Text style={s.irnColon}>:</Text>
                  <Text style={s.irnValue}>{invoice.ackNo}</Text>
                </View>
              )}
              {invoice.ackDate && (
                <View style={s.irnRow}>
                  <Text style={s.irnLabel}>Ack Date</Text>
                  <Text style={s.irnColon}>:</Text>
                  <Text style={s.irnValue}>{invoice.ackDate}</Text>
                </View>
              )}
            </View>
          )}

          {/* BUSINESS / CONSIGNEE / BUYER + METADATA */}
          <InfoBlock {...infoProps} />

          {/* ITEMS TABLE HEADER */}
          <TableHeader />

          {/* ITEM ROWS */}
          {invoice.items.map((item, i) => (
            <View key={i} style={s.row} wrap={false}>
              <Text style={s.colSl}>{i + 1}</Text>
              <View style={s.colDesc}>
                <Text style={s.bold}>{item.productName}</Text>
                {item.description && (
                  <Text style={[s.small, s.italic]}>{item.description}</Text>
                )}
              </View>
              <Text style={s.colHSN}>{item.hsn}</Text>
              <Text style={s.colQty}>
                {formatQty(item.qty)} {item.unit || "pcs"}
              </Text>
              <Text style={s.colRate}>{formatINR(item.rate)}</Text>
              <Text style={s.colPer}>{item.unit || "pcs"}</Text>
              <Text style={[s.colAmt, s.bold]}>{formatINR(item.amount)}</Text>
            </View>
          ))}

          {/* TAX ROWS (IGST or CGST+SGST) */}
          {invoice.isIGST ? (
            <View style={s.row} wrap={false}>
              <Text style={s.colSl}></Text>
              <Text style={[s.colDesc, s.boldItalic, { textAlign: "right" }]}>IGST</Text>
              <Text style={s.colHSN}></Text>
              <Text style={s.colQty}></Text>
              <Text style={s.colRate}></Text>
              <Text style={s.colPer}></Text>
              <Text style={[s.colAmt, s.bold]}>{formatINR(invoice.totalIGST)}</Text>
            </View>
          ) : (
            <>
              <View style={s.row} wrap={false}>
                <Text style={s.colSl}></Text>
                <Text style={[s.colDesc, s.boldItalic, { textAlign: "right" }]}>CGST</Text>
                <Text style={s.colHSN}></Text>
                <Text style={s.colQty}></Text>
                <Text style={s.colRate}></Text>
                <Text style={s.colPer}></Text>
                <Text style={[s.colAmt, s.bold]}>{formatINR(invoice.totalCGST)}</Text>
              </View>
              <View style={s.row} wrap={false}>
                <Text style={s.colSl}></Text>
                <Text style={[s.colDesc, s.boldItalic, { textAlign: "right" }]}>SGST</Text>
                <Text style={s.colHSN}></Text>
                <Text style={s.colQty}></Text>
                <Text style={s.colRate}></Text>
                <Text style={s.colPer}></Text>
                <Text style={[s.colAmt, s.bold]}>{formatINR(invoice.totalSGST)}</Text>
              </View>
            </>
          )}

          {/* SPACER — fills remaining page 1 space */}
          <View style={{ flex: 1, borderBottom: B_THIN }} />

          {/* "Continued to page 2" */}
          <View style={{ borderBottom: B, paddingVertical: 3, paddingHorizontal: 5 }} wrap={false}>
            <Text style={[s.italic, { textAlign: "right", fontSize: 8 }]}>Continued to page number : 2</Text>
          </View>

          {/* JURISDICTION (page 1 footer) */}
          <View style={s.jurisdiction}>
            <Text>SUBJECT TO {(invoice.jurisdictionCity || business.state_name || "").toUpperCase()} JURISDICTION</Text>
          </View>

          <View style={s.computerGen}>
            <Text>This is a Computer Generated Invoice</Text>
          </View>
        </View>
      </Page>

      {/* ════════════════════ PAGE 2 ════════════════════ */}
      <Page size="A4" style={s.page}>
        <View style={s.outer}>
          {/* TITLE — "(Page 2)" */}
          <View style={s.titleRow}>
            <Text style={s.titleText}>TAX INVOICE (Page 2)</Text>
          </View>

          {/* REPEATED HEADER: Business / Consignee / Buyer + Metadata */}
          <InfoBlock {...infoProps} />

          {/* TABLE HEADER (repeated) */}
          <TableHeader />

          {/* ROUNDING ROW */}
          {invoice.roundedOff !== undefined && invoice.roundedOff !== 0 && (
            <View style={s.row} wrap={false}>
              <Text style={[s.colSl, s.italic]}>Less :</Text>
              <Text style={[s.colDesc, s.boldItalic, { textAlign: "right" }]}>Rounded Off</Text>
              <Text style={s.colHSN}></Text>
              <Text style={s.colQty}></Text>
              <Text style={s.colRate}></Text>
              <Text style={s.colPer}></Text>
              <Text style={[s.colAmt, s.bold]}>{formatRounding(invoice.roundedOff)}</Text>
            </View>
          )}

          {/* SPACER — fills space before total */}
          <View style={{ flex: 1, borderBottom: B_THIN }} />

          {/* TOTAL ROW */}
          <View style={s.totalRow} wrap={false}>
            <Text style={s.colSl}></Text>
            <Text style={[s.colDesc, s.bold, { textAlign: "right" }]}>Total</Text>
            <Text style={s.colHSN}></Text>
            <Text style={[s.colQty, s.bold]}>
              {singleUnit ? `${formatQty(totalQty)} ${singleUnit}` : ""}
            </Text>
            <Text style={s.colRate}></Text>
            <Text style={s.colPer}></Text>
            <Text style={[s.colAmt, s.bold]}>{"\u20B9"} {formatINR(invoice.total)}</Text>
          </View>

          {/* AMOUNT CHARGEABLE (in words) */}
          <View style={s.wordsSection} wrap={false}>
            <View style={s.wordsRow}>
              <Text style={s.small}>Amount Chargeable (in words)</Text>
              <Text style={[s.small, { textAlign: "right" }]}>E. & O.E</Text>
            </View>
            <Text style={[s.bold, { fontSize: 9, marginTop: 1 }]}>
              INR {amountToWords(Number(invoice.total) || 0)}
            </Text>
          </View>

          {/* HSN TAX SUMMARY TABLE */}
          <View wrap={false}>
            {invoice.isIGST ? (
              <>
                <View style={s.taxHeader}>
                  <Text style={[s.taxCell, { width: 65, textAlign: "center" }]}>HSN/SAC</Text>
                  <Text style={[s.taxCell, { flex: 1, textAlign: "center" }]}>Taxable{"\n"}Value</Text>
                  <Text style={[s.taxCell, { width: 40, textAlign: "center" }]}>Rate</Text>
                  <Text style={[s.taxCell, { width: 70, textAlign: "center" }]}>IGST{"\n"}Amount</Text>
                  <Text style={[s.taxCellLast, { width: 70, textAlign: "center" }]}>Total{"\n"}Tax Amount</Text>
                </View>
                {hsnSummary.map((h, i) => (
                  <View key={i} style={s.taxRow}>
                    <Text style={[s.taxCell, { width: 65, textAlign: "left" }]}>{h.hsn}</Text>
                    <Text style={[s.taxCell, { flex: 1 }]}>{formatINR(h.taxableValue)}</Text>
                    <Text style={[s.taxCell, { width: 40, textAlign: "center" }]}>{h.gstRate}%</Text>
                    <Text style={[s.taxCell, { width: 70 }]}>{formatINR(h.igst)}</Text>
                    <Text style={[s.taxCellLast, { width: 70 }]}>{formatINR(h.totalTax)}</Text>
                  </View>
                ))}
                <View style={s.taxRowBold}>
                  <Text style={[s.taxCell, { width: 65, textAlign: "right" }, s.bold]}>Total</Text>
                  <Text style={[s.taxCell, { flex: 1 }, s.bold]}>{formatINR(totalHSNTaxable)}</Text>
                  <Text style={[s.taxCell, { width: 40 }]}></Text>
                  <Text style={[s.taxCell, { width: 70 }, s.bold]}>{formatINR(invoice.totalIGST)}</Text>
                  <Text style={[s.taxCellLast, { width: 70 }, s.bold]}>{formatINR(totalHSNTax)}</Text>
                </View>
              </>
            ) : (
              <>
                <View style={s.taxHeader}>
                  <Text style={[s.taxCell, { width: 55, textAlign: "center" }]}>HSN/SAC</Text>
                  <Text style={[s.taxCell, { flex: 1, textAlign: "center" }]}>Taxable{"\n"}Value</Text>
                  <Text style={[s.taxCell, { width: 30, textAlign: "center", fontSize: 8 }]}>Rate</Text>
                  <Text style={[s.taxCell, { width: 55, textAlign: "center", fontSize: 8 }]}>CGST{"\n"}Amount</Text>
                  <Text style={[s.taxCell, { width: 30, textAlign: "center", fontSize: 8 }]}>Rate</Text>
                  <Text style={[s.taxCell, { width: 55, textAlign: "center", fontSize: 8 }]}>SGST{"\n"}Amount</Text>
                  <Text style={[s.taxCellLast, { width: 60, textAlign: "center", fontSize: 8 }]}>Total{"\n"}Tax Amount</Text>
                </View>
                {hsnSummary.map((h, i) => (
                  <View key={i} style={s.taxRow}>
                    <Text style={[s.taxCell, { width: 55, textAlign: "left" }]}>{h.hsn}</Text>
                    <Text style={[s.taxCell, { flex: 1 }]}>{formatINR(h.taxableValue)}</Text>
                    <Text style={[s.taxCell, { width: 30, textAlign: "center" }]}>{h.gstRate / 2}%</Text>
                    <Text style={[s.taxCell, { width: 55 }]}>{formatINR(h.cgst)}</Text>
                    <Text style={[s.taxCell, { width: 30, textAlign: "center" }]}>{h.gstRate / 2}%</Text>
                    <Text style={[s.taxCell, { width: 55 }]}>{formatINR(h.sgst)}</Text>
                    <Text style={[s.taxCellLast, { width: 60 }]}>{formatINR(h.totalTax)}</Text>
                  </View>
                ))}
                <View style={s.taxRowBold}>
                  <Text style={[s.taxCell, { width: 55, textAlign: "right" }, s.bold]}>Total</Text>
                  <Text style={[s.taxCell, { flex: 1 }, s.bold]}>{formatINR(totalHSNTaxable)}</Text>
                  <Text style={[s.taxCell, { width: 30 }]}></Text>
                  <Text style={[s.taxCell, { width: 55 }, s.bold]}>{formatINR(invoice.totalCGST)}</Text>
                  <Text style={[s.taxCell, { width: 30 }]}></Text>
                  <Text style={[s.taxCell, { width: 55 }, s.bold]}>{formatINR(invoice.totalSGST)}</Text>
                  <Text style={[s.taxCellLast, { width: 60 }, s.bold]}>{formatINR(totalHSNTax)}</Text>
                </View>
              </>
            )}
          </View>

          {/* TAX AMOUNT IN WORDS */}
          <View style={{ borderBottom: B, padding: 4, flexDirection: "row" }} wrap={false}>
            <Text style={s.small}>Tax Amount (in words) : </Text>
            <Text style={[s.small, s.bold, { flex: 1 }]}>
              INR {amountToWords(Number(invoice.totalTax) || 0)}
            </Text>
          </View>

          {/* COMPANY PAN */}
          <View style={s.panRow} wrap={false}>
            <Text style={s.small}>Company's PAN</Text>
            <Text style={[s.small, s.bold, { marginLeft: 20 }]}>: {business.pan_number}</Text>
          </View>

          {/* DECLARATION + SIGNATORY */}
          <View style={s.footerRow} wrap={false}>
            <View style={s.declaration}>
              <Text style={[s.bold, { marginBottom: 2 }]}>Declaration</Text>
              <Text>
                {invoice.declaration ||
                  "We declare that this invoice shows the actual price of the goods described and that all particulars are true and correct. No E-Way Bill is required to be generated as the goods covered under this invoice are exempted as per serial no. 150 & 151 to the rule 138(14) of the CGST rule 2017."}
              </Text>
            </View>
            <View style={s.signatory}>
              <Text style={[s.bold, { fontSize: 8 }]}>for {business.name}</Text>
              <Text style={{ marginTop: 35, fontSize: 8 }}>Authorised Signatory</Text>
            </View>
          </View>

          {/* JURISDICTION */}
          <View style={s.jurisdiction}>
            <Text>SUBJECT TO {(invoice.jurisdictionCity || business.state_name || "").toUpperCase()} JURISDICTION</Text>
          </View>

          {/* COMPUTER GENERATED */}
          <View style={s.computerGen}>
            <Text>This is a Computer Generated Invoice</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}
