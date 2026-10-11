// The customer statement as an A4 PDF page (react-pdf). Loaded only when a statement is opened (statementPdf.ts imports
// it on demand), so @react-pdf/renderer stays out of the app's first download. A register of bills, not a ledger: no
// balance, cancelled bills listed and not counted, udhaar named as billed on credit (PROTO CustomerStatement.jsx).
import { Document, Page, StyleSheet, Text, View } from "@react-pdf/renderer";
import type { Statement } from "@/core/api/customers";
import { date, inr, plural } from "@/core/format";
import { hasGstin } from "@/core/ids";
import { PAY } from "@/core/sales/words";
// The built-in Helvetica has no ₹ (it would print as "¹"): the one-glyph Tinos font carries it, as v2's Tally invoice
// does, registered once for every PDF by core/print (Ruling 1E-6), whose RupeeText draws typed text that can hold one
import { RUPEE_FONT, RupeeText } from "@/core/print/pdfRupee";
import { notCounted, SETTLED } from "./lib";

/** What the PDF shows: the statement as the page has it, and the words around it. */
export type StatementPdfData = {
  customer: { name: string; mobile: string; gstin: string; pan: string; address: string };
  periodLabel: string; periodRange: string; scope: string; made: string; statement: Statement;
};

const s = StyleSheet.create({
  page: { paddingTop: 36, paddingBottom: 48, paddingHorizontal: 36, fontFamily: "Helvetica", fontSize: 9, color: "#1a1a1a" },
  head: { flexDirection: "row", justifyContent: "space-between", marginBottom: 14 },
  // the customer takes what the period leaves, so a long name or address wraps rather than running into it
  who: { flex: 1, paddingRight: 16 },
  title: { fontFamily: "Helvetica-Bold", fontSize: 15, marginBottom: 6 },
  name: { fontFamily: "Helvetica-Bold", fontSize: 11, marginBottom: 2 },
  muted: { color: "#555555" },
  right: { maxWidth: "45%", alignItems: "flex-end", textAlign: "right" },
  note: { borderWidth: 1, borderColor: "#cccccc", borderRadius: 4, padding: 8, marginBottom: 12, color: "#333333" },
  row: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#dddddd", paddingVertical: 4 },
  th: { fontFamily: "Helvetica-Bold", borderBottomWidth: 1, borderBottomColor: "#888888" },
  cDate: { width: "13%" }, cNo: { width: "19%" }, cFirm: { width: "21%" }, cMode: { width: "13%" }, cAmt: { width: "13%", textAlign: "right" }, cPaid: { width: "21%", paddingLeft: 8 },
  struck: { textDecoration: "line-through", color: "#888888" },
  totals: { marginTop: 12, alignSelf: "flex-end", width: "60%" },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 2 },
  bold: { fontFamily: "Helvetica-Bold" },
  foot: { position: "absolute", bottom: 24, left: 36, right: 36, flexDirection: "row", justifyContent: "space-between", fontSize: 8, color: "#777777" },
  // the name wraps before the page number, which is drawn after layout and so holds its own room
  footWho: { flex: 1, paddingRight: 16 }, footPage: { width: 72, textAlign: "right" },
});

/** ₹ in its own font, then the amount: "₹87,083.21". */
function Rupees({ paise, bold }: { paise: number; bold?: boolean }) {
  return <Text style={bold ? s.bold : undefined}><Text style={{ fontFamily: RUPEE_FONT }}>₹</Text>{inr(paise).replace("₹", "")}</Text>;
}

export function StatementDocument({ data }: { data: StatementPdfData }) {
  const { customer: c, statement: st } = data;
  const t = st.totals;
  const ids = [c.mobile ? `Mobile ${c.mobile}` : "", hasGstin(c.gstin) ? `GSTIN ${c.gstin}` : c.pan ? `PAN ${c.pan} · No GSTIN` : "No GSTIN"].filter(Boolean).join(" · ");
  return (
    <Document title={`Statement · ${c.name} · ${data.periodLabel}`} author="GST Billing">
      <Page size="A4" style={s.page}>
        <View style={s.head}>
          <View style={s.who}>
            <Text style={s.title}>Statement of bills</Text>
            <RupeeText style={s.name}>{c.name}</RupeeText>
            {ids ? <Text style={s.muted}>{ids}</Text> : null}
            {c.address ? <RupeeText style={s.muted}>{c.address}</RupeeText> : null}
          </View>
          <View style={s.right}>
            <Text style={s.bold}>{data.periodLabel}</Text>
            {data.periodRange && data.periodRange !== data.periodLabel ? <Text style={s.muted}>{data.periodRange}</Text> : null}
            <RupeeText style={s.muted}>{data.scope}</RupeeText>
            <Text style={s.muted}>Made on {data.made}</Text>
          </View>
        </View>
        <Text style={s.note}>A register of bills, not a ledger. Cash and UPI bills were paid when they were made. Udhaar bills are listed as billed on credit: the app doesn't record payments received, so it can't say what is still owed and shows no balance.</Text>
        <View style={[s.row, s.th]} fixed>
          <Text style={s.cDate}>Date</Text><Text style={s.cNo}>Bill no.</Text><Text style={s.cFirm}>Firm</Text><Text style={s.cMode}>Payment mode</Text>
          <Text style={s.cAmt}>Amount (<Text style={{ fontFamily: RUPEE_FONT }}>₹</Text>)</Text><Text style={s.cPaid}>Payment</Text>
        </View>
        {st.bills.map((b) => (
          <View key={b.id} style={s.row} wrap={false}>
            <Text style={s.cDate}>{date(b.invoice_date)}</Text>
            <Text style={s.cNo}>{b.invoice_number}</Text>
            <RupeeText style={s.cFirm}>{b.business_name}</RupeeText>
            <Text style={s.cMode}>{PAY[b.payment_mode] ?? PAY[""]}</Text>
            <Text style={b.status === "cancelled" ? [s.cAmt, s.struck] : s.cAmt}>{inr(b.total_amount).replace("₹", "")}</Text>
            <Text style={s.cPaid}>{SETTLED[b.paid]}</Text>
          </View>
        ))}
        {!st.bills.length ? <RupeeText style={[s.muted, { paddingVertical: 8 }]}>{`No bills to ${c.name} in ${data.periodLabel}.`}</RupeeText> : null}
        <View style={s.totals} wrap={false}>
          <View style={s.totalRow}><Text style={s.bold}>Billed · {plural(t.bills, "bill")}{notCounted(t.cancelled)}</Text><Rupees paise={t.billed} bold /></View>
          <View style={s.totalRow}><Text>Paid at billing · {plural(t.paid_at_billing.bills, "bill")} · cash, UPI or both</Text><Rupees paise={t.paid_at_billing.total} /></View>
          <View style={s.totalRow}><Text>On udhaar · {plural(t.udhaar.bills, "bill")} · payment not recorded in the app</Text><Rupees paise={t.udhaar.total} /></View>
          {t.not_recorded.bills ? <View style={s.totalRow}><Text>Not recorded (from Tally) · {plural(t.not_recorded.bills, "bill")}</Text><Rupees paise={t.not_recorded.total} /></View> : null}
        </View>
        <View style={s.foot} fixed>
          <RupeeText style={s.footWho}>{`${c.name} · ${data.periodLabel} · ${data.scope}`}</RupeeText>
          <Text style={s.footPage} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
