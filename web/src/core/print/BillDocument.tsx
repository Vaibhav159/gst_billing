// The Tally A4 tax invoice as a PDF (react-pdf): v2's TallyInvoicePDF.tsx (Times, its borders, columns and sizes) with
// the prototype's boxes (PROTO sales/BillPrint.jsx:245-447): the copy's mark on every page, the QR code, the e-way
// boxes, tax rows by slab, the total to the paisa, the HSN summary, the bank block and the CANCELLED stamp. It draws the
// print model (model.ts) as the paper on screen does (Paper.tsx), every word and figure worked out there. Loaded only on
// demand (make.ts imports it), so react-pdf never reaches the app's first download.
import type { ReactElement } from "react";
import { Document, Image, Page, Path, StyleSheet, Svg, Text, View, type Styles } from "@react-pdf/renderer";
import type { CopyMark, PrintBill, PrintPage, Run } from "./model";
import { RupeeText } from "./pdfRupee";
import { qrPath } from "./qr";

type Style = Styles[string];

const B = "1pt solid #000";
const B_THIN = "0.5pt solid #999";
const GREY = "#555";
const NBSP = "\u00a0"; // PROTO's " ": an empty box or line keeps its height
const s = StyleSheet.create({
  page: { fontFamily: "Times-Roman", fontSize: 9, paddingTop: 14, paddingBottom: 14, paddingHorizontal: 20, color: "#000" },
  top: { flexDirection: "row", justifyContent: "space-between", fontSize: 7.5, marginBottom: 3 },
  outer: { border: B, flexGrow: 1 },
  bold: { fontFamily: "Times-Bold" },
  italic: { fontFamily: "Times-Italic" },
  boldItalic: { fontFamily: "Times-BoldItalic" },
  small: { fontSize: 7.5 },
  label: { fontSize: 7, color: GREY },
  titleRow: { flexDirection: "row", borderBottom: B, minHeight: 22 },
  title: { flexGrow: 1, flexBasis: 0, justifyContent: "center", alignItems: "center", paddingVertical: 5 },
  titleText: { fontFamily: "Times-Bold", fontSize: 12 },
  titleSide: { width: 80 },
  qrBox: { width: 80, borderLeft: B, alignItems: "center", justifyContent: "center", paddingVertical: 3 },
  info: { flexDirection: "row", borderBottom: B },
  infoLeft: { flexGrow: 1, flexBasis: 0, borderRight: B },
  infoRight: { width: 240 },
  block: { padding: 5 },
  blockRule: { padding: 5, borderBottom: B },
  metaRow: { flexDirection: "row", borderBottom: B, minHeight: 22 },
  metaRowLast: { flexDirection: "row", minHeight: 22 },
  metaLeft: { flexGrow: 1, flexBasis: 0, borderRight: B, padding: 3 },
  metaRight: { flexGrow: 1, flexBasis: 0, padding: 3 },
  metaValue: { fontFamily: "Times-Bold", fontSize: 9 },
  shortHead: { flexDirection: "row", borderBottom: B, padding: 5, fontSize: 8.5 },
  items: { flexGrow: 1 },
  row: { flexDirection: "row", minHeight: 18 },
  colSl: { width: 26, padding: 3, borderRight: B, textAlign: "center" },
  colDesc: { flexGrow: 1, flexBasis: 0, padding: 3, borderRight: B },
  colHsn: { width: 50, padding: 3, borderRight: B, textAlign: "center" },
  colQty: { width: 62, padding: 3, borderRight: B, textAlign: "right" },
  colRate: { width: 58, padding: 3, borderRight: B, textAlign: "right" },
  colPer: { width: 30, padding: 3, borderRight: B, textAlign: "center" },
  colAmt: { width: 80, padding: 3, textAlign: "right" },
  fill: { flexGrow: 1, flexDirection: "row" },
  totalRow: { flexDirection: "row", borderTop: B, minHeight: 20 },
  words: { borderTop: B, borderBottom: B, paddingHorizontal: 5, paddingVertical: 3 },
  wordsHead: { flexDirection: "row", justifyContent: "space-between" },
  hsnHead: { flexDirection: "row", borderBottom: B, backgroundColor: "#f2f2f2" },
  hsnRow: { flexDirection: "row", borderBottom: B_THIN },
  hsnTotal: { flexDirection: "row", borderBottom: B },
  cell: { padding: 2.5, borderRight: B, textAlign: "right", fontSize: 8 },
  cellLast: { padding: 2.5, textAlign: "right", fontSize: 8 },
  taxWords: { flexDirection: "row", borderBottom: B, padding: 3, fontSize: 8 },
  foot: { flexDirection: "row", borderBottom: B },
  footLeft: { flexGrow: 1, flexBasis: 0, borderRight: B, padding: 5, justifyContent: "space-between", fontSize: 8 },
  footRight: { width: 240 },
  bank: { padding: 5, borderBottom: B, fontSize: 8 },
  bankRow: { flexDirection: "row" },
  sign: { padding: 5, minHeight: 58, justifyContent: "space-between", alignItems: "flex-end", fontSize: 8 },
  center: { textAlign: "center", paddingVertical: 3, fontSize: 7.5 },
  stamp: { position: "absolute", top: 380, left: 0, right: 0, alignItems: "center" },
  stampText: { transform: "rotate(-16deg)", border: "4pt solid #c62828", color: "#c62828", fontFamily: "Times-Bold", fontSize: 54, letterSpacing: 6, paddingHorizontal: 20, paddingVertical: 2, opacity: 0.8 },
});

const COLS = [s.colSl, s.colDesc, s.colHsn, s.colQty, s.colRate, s.colPer, s.colAmt];

/**
 * The bill's note as it was typed, a text for each line: Times has no line-break character, and react-pdf would set a
 * break inside a text in Helvetica. An empty line keeps its height, as the paper on screen shows it (and the plan counts it).
 */
const noteLines = (note: string) => note.split(/\r?\n/);

/** One row of the items table: seven cells, each our own words or figures (a string) or a drawn cell. */
function Row({ cells, style, bold }: { cells: (string | ReactElement)[]; style?: Style; bold?: boolean }) {
  return (
    <View style={style ? [s.row, style] : s.row} wrap={false}>
      {cells.map((c, i) => (typeof c === "string" ? <Text key={i} style={bold ? [COLS[i], s.bold] : COLS[i]}>{c}</Text> : <View key={i} style={COLS[i]}>{c}</View>))}
    </View>
  );
}

/** A line in runs, the bold ones bold: a later page's short header (Ruling 1E-10). */
function Runs({ runs }: { runs: Run[] }) {
  return <Text>{runs.map((r, i) => <RupeeText key={i} style={r.bold ? s.bold : undefined}>{r.text}</RupeeText>)}</Text>;
}

function Qr({ text }: { text: string }) {
  const q = qrPath(text);
  if (!q) return null;
  return (
    <Svg width={58} height={58} viewBox={`0 0 ${q.size} ${q.size}`}>
      <Path d={q.d} fill="#000" />
    </Svg>
  );
}

function Header({ b, page }: { b: PrintBill; page: PrintPage }) {
  const first = page.first;
  return (
    <>
      <View style={s.titleRow}>
        {first ? <View style={s.titleSide} /> : null}
        <View style={s.title}><Text style={s.titleText}>Tax Invoice{first ? null : <Text style={[s.small, { fontFamily: "Times-Roman", color: GREY }]}> (continued, page {page.index + 1})</Text>}</Text></View>
        {first ? <View style={s.qrBox}><Qr text={b.qr} /><Text style={{ fontSize: 6.5, color: GREY }}>Scan to check</Text></View> : null}
      </View>
      {first ? (
        <View style={s.info}>
          <View style={s.infoLeft}>
            <View style={s.blockRule}>
              <RupeeText style={[s.bold, { fontSize: 11, marginBottom: 1 }]}>{b.firm.name}</RupeeText>
              {b.firm.lines.map((l, i) => <RupeeText key={i}>{l}</RupeeText>)}
            </View>
            {b.parties.map((p, i) => (
              <View key={i} style={i === 0 ? s.blockRule : s.block}>
                <Text style={s.label}>{p.label}</Text>
                <RupeeText style={s.bold}>{p.name}</RupeeText>
                {p.lines.map((l, j) => <RupeeText key={j}>{l}</RupeeText>)}
              </View>
            ))}
          </View>
          <View style={s.infoRight}>
            {Array.from({ length: b.meta.length / 2 }, (_, r) => (
              <View key={r} style={r === b.meta.length / 2 - 1 ? s.metaRowLast : s.metaRow}>
                {[b.meta[r * 2], b.meta[r * 2 + 1]].map(([k, v], c) => (
                  <View key={c} style={c === 0 ? s.metaLeft : s.metaRight}>
                    <Text style={s.label}>{k}</Text>
                    <RupeeText style={s.metaValue}>{v || NBSP}</RupeeText>
                  </View>
                ))}
              </View>
            ))}
          </View>
        </View>
      ) : (
        <View style={s.shortHead}>
          <View style={{ flexGrow: 1, flexBasis: 0 }}><Runs runs={b.short[0]} /><Runs runs={b.short[2]} /></View>
          <View style={{ flexGrow: 1, flexBasis: 0, alignItems: "flex-end" }}><Runs runs={b.short[1]} /><Runs runs={b.short[3]} /></View>
        </View>
      )}
    </>
  );
}

function Footer({ b }: { b: PrintBill }) {
  const heads = b.igst ? ["HSN/SAC", "Taxable Value", "IGST Rate", "IGST Amount", "Total Tax Amount"] : ["HSN/SAC", "Taxable Value", "CGST Rate", "CGST Amount", "SGST/UTGST Rate", "SGST/UTGST Amount", "Total Tax Amount"];
  // SGST/UTGST Rate's column holds "SGST/UTGST" on one line, so react-pdf doesn't hyphenate it
  const widths = b.igst ? [0, 100, 60, 90, 90] : [0, 90, 44, 72, 58, 72, 80];
  const cells = (h: (typeof b.hsn)[number]) => (b.igst ? [h.hsn, h.taxable, h.rate, h.igst, h.tax] : [h.hsn, h.taxable, h.rate, h.cgst, h.rate, h.sgst, h.tax]);
  const cellStyle = (i: number, n: number, extra: Style = {}): Style[] => [i === n - 1 ? s.cellLast : s.cell, widths[i] ? { width: widths[i] } : { flexGrow: 1, flexBasis: 0 }, extra];
  return (
    <View wrap={false}>
      <View style={s.words}>
        <View style={s.wordsHead}><Text style={s.label}>Amount Chargeable (in words)</Text><Text style={[s.small, s.italic]}>E. & O.E</Text></View>
        <Text style={s.bold}>{b.words}</Text>
      </View>
      <View style={s.hsnHead}>
        {heads.map((h, i) => <Text key={h} style={cellStyle(i, heads.length, { textAlign: "center", fontFamily: "Times-Bold" })}>{h}</Text>)}
      </View>
      {b.hsn.map((h) => (
        <View key={h.key} style={s.hsnRow}>
          {cells(h).map((v, i, a) => <Text key={i} style={cellStyle(i, a.length, i === 0 ? { textAlign: "left" } : i === 2 || (i === 4 && !b.igst) ? { textAlign: "center" } : {})}>{v}</Text>)}
        </View>
      ))}
      <View style={s.hsnTotal}>
        {cells(b.hsnTotal).map((v, i, a) => <Text key={i} style={cellStyle(i, a.length, { fontFamily: "Times-Bold" })}>{v}</Text>)}
      </View>
      <View style={s.taxWords}><Text>Tax Amount (in words) : </Text><Text style={[s.bold, { flexGrow: 1, flexBasis: 0 }]}>{b.taxWords}</Text></View>
      <View style={s.foot}>
        <View style={s.footLeft}>
          <Text>Company&apos;s PAN : <Text style={s.bold}>{b.firm.pan}</Text></Text>
          <View>
            <Text style={[s.bold, { textDecoration: "underline" }]}>Declaration</Text>
            <Text style={{ fontSize: 7.5 }}>{b.declaration}</Text>
          </View>
        </View>
        <View style={s.footRight}>
          {b.firm.bank ? (
            <View style={s.bank}>
              <Text>Company&apos;s Bank Details</Text>
              {b.firm.bank.map(([k, v]) => <View key={k} style={s.bankRow}><Text style={{ width: 82 }}>{k}</Text><Text style={s.bold}>: <RupeeText>{v}</RupeeText></Text></View>)}
            </View>
          ) : null}
          <View style={s.sign}>
            <Text style={s.bold}>for <RupeeText>{b.firm.name}</RupeeText></Text>
            {b.firm.signature ? <Image src={b.firm.signature} style={{ width: 90, height: 30, objectFit: "contain" }} /> : null}
            <Text>Authorised Signatory</Text>
          </View>
        </View>
      </View>
      <Text style={[s.center, { borderBottom: B }]}>SUBJECT TO {b.jurisdiction.toUpperCase()} JURISDICTION</Text>
      <Text style={[s.center, { color: GREY, fontSize: 7 }]}>This is a Computer Generated Invoice</Text>
    </View>
  );
}

/** One A4 sheet: a page of one copy of one bill. Lines are keyed by their place: an address can repeat a line. */
export function BillPage({ b, copy, page }: { b: PrintBill; copy: CopyMark; page: PrintPage }) {
  return (
    <Page size="A4" style={s.page}>
      <View style={s.top}>
        <Text style={{ color: GREY }}>{page.count > 1 ? `Page ${page.index + 1} of ${page.count}` : NBSP}</Text>
        <Text style={s.italic}>({copy.tag})</Text>
      </View>
      <View style={s.outer}>
        <Header b={b} page={page} />
        <View style={s.items}>
          <Row style={{ borderBottom: B, backgroundColor: "#f2f2f2" }} bold cells={["Sl No.", "Description of Goods", "HSN/SAC", "Quantity", "Rate", "per", "Amount"]} />
          {page.lines.map((i) => {
            const l = b.lines[i];
            return (
              <Row key={i} cells={[l.sl, (
                <View key="d">
                  <RupeeText style={s.bold}>{l.name}</RupeeText>
                  {l.note ? <RupeeText style={[s.small, s.italic, { paddingLeft: 8 }]}>{l.note}</RupeeText> : null}
                </View>
              ), l.hsn, l.qty, l.rate, l.per, <Text key="a" style={s.bold}>{l.amount}</Text>]} />
            );
          })}
          {page.last ? (
            <>
              {b.taxes.map((t) => <Row key={t.key} cells={["", <Text key="h" style={[s.boldItalic, { textAlign: "right" }]}>{t.head}</Text>, "", "", t.rate, "", <Text key="a" style={s.bold}>{t.amount}</Text>]} />)}
              {b.note ? <Row cells={["", <View key="n">{noteLines(b.note).map((l, i) => <Text key={i} style={[s.italic, { fontSize: 8.5 }]}>{i ? null : "Note: "}<RupeeText>{l || NBSP}</RupeeText></Text>)}</View>, "", "", "", "", ""]} /> : null}
            </>
          ) : null}
          <View style={s.fill}>{COLS.map((c, i) => <View key={i} style={[c, { padding: 0 }]} />)}</View>
          {page.last ? (
            <Row style={s.totalRow} bold cells={["", <Text key="t" style={[s.bold, { textAlign: "right" }]}>Total</Text>, "", b.total.qty, "", "", <RupeeText key="g" style={[s.bold, { fontSize: 10 }]}>{`₹ ${b.total.amount}`}</RupeeText>]} />
          ) : (
            <Row style={s.totalRow} cells={["", <Text key="c" style={[s.italic, { textAlign: "right" }]}>continued on page {page.index + 2}</Text>, "", "", "", "", ""]} />
          )}
        </View>
        {page.last ? <Footer b={b} /> : null}
      </View>
      {b.cancelled ? <View style={s.stamp} fixed><Text style={s.stampText}>CANCELLED</Text></View> : null}
    </Page>
  );
}

/** Every bill, each copy of it, each of its pages, in that order: one bill's set stays together when printed. */
export function BillDocument({ bills, copies, title, subject }: { bills: PrintBill[]; copies: CopyMark[]; title: string; subject?: string }) {
  return (
    <Document title={title} author={bills.length === 1 ? bills[0].firm.name : "GST Billing"} subject={subject} creator="GST Billing" producer="GST Billing">
      {bills.flatMap((b) => copies.flatMap((c) => b.pages.map((p) => <BillPage key={`${b.id}-${c.value}-${p.index}`} b={b} copy={c} page={p} />)))}
    </Document>
  );
}
