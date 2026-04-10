import jsPDF from "jspdf";

interface StatementInvoice {
  invoiceNumber: string;
  date: string;
  businessName: string;
  type: string;
  amount: number;
  balance: number;
}

interface StatementOptions {
  customerName: string;
  customerGST?: string;
  customerAddress?: string;
  dateRange: { from: string; to: string };
  invoices: StatementInvoice[];
  totals: { outward: number; inward: number; net: number };
}

function fmt(n: number): string {
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(n));
}

export function generateStatementPDF(opts: StatementOptions): Blob {
  const pdf = new jsPDF("p", "mm", "a4");
  const w = 210;
  let y = 15;

  // Header
  pdf.setFontSize(16);
  pdf.setFont("helvetica", "bold");
  pdf.text("CUSTOMER STATEMENT", w / 2, y, { align: "center" });
  y += 10;

  // Customer info
  pdf.setFontSize(11);
  pdf.setFont("helvetica", "bold");
  pdf.text(opts.customerName, 14, y);
  y += 5;
  pdf.setFontSize(9);
  pdf.setFont("helvetica", "normal");
  if (opts.customerGST) { pdf.text(`GSTIN: ${opts.customerGST}`, 14, y); y += 4; }
  if (opts.customerAddress) { pdf.text(opts.customerAddress, 14, y); y += 4; }

  // Date range
  pdf.text(`Period: ${opts.dateRange.from} to ${opts.dateRange.to}`, w - 14, y - 8, { align: "right" });
  y += 4;

  // Divider
  pdf.setDrawColor(100);
  pdf.setLineWidth(0.3);
  pdf.line(14, y, w - 14, y);
  y += 6;

  // Table header
  const cols = [14, 35, 65, 110, 140, 165, w - 14];
  const headers = ["#", "Date", "Invoice", "Business", "Dr/Cr", "Amount", "Balance"];

  pdf.setFillColor(40, 40, 40);
  pdf.rect(14, y - 4, w - 28, 7, "F");
  pdf.setTextColor(255, 255, 255);
  pdf.setFontSize(7);
  pdf.setFont("helvetica", "bold");
  headers.forEach((h, i) => {
    const align = i >= 4 ? "right" : "left";
    pdf.text(h, i >= 4 ? cols[i + 1] - 2 : cols[i], y, { align: align as any });
  });
  y += 6;
  pdf.setTextColor(0, 0, 0);

  // Table rows
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  opts.invoices.forEach((inv, i) => {
    if (y > 270) { pdf.addPage(); y = 15; }
    const isDebit = inv.type === "OUTWARD";

    pdf.text(`${i + 1}`, cols[0], y);
    pdf.text(inv.date, cols[1], y);
    pdf.text(inv.invoiceNumber.length > 20 ? inv.invoiceNumber.slice(0, 20) + "..." : inv.invoiceNumber, cols[2], y);
    pdf.text(inv.businessName.length > 20 ? inv.businessName.slice(0, 20) + "..." : inv.businessName, cols[3], y);
    pdf.text(isDebit ? "Dr" : "Cr", cols[5] - 2, y, { align: "right" });

    // Color amount
    if (isDebit) pdf.setTextColor(220, 50, 50);
    else pdf.setTextColor(50, 150, 50);
    pdf.text(`${fmt(inv.amount)}`, cols[6] - 30, y, { align: "right" });

    pdf.setTextColor(0, 0, 0);
    pdf.text(`${fmt(inv.balance)}`, cols[6] - 2, y, { align: "right" });
    y += 5;
  });

  // Totals
  y += 4;
  pdf.setDrawColor(100);
  pdf.line(14, y, w - 14, y);
  y += 6;

  pdf.setFontSize(9);
  const totals = [
    ["Total Outward (Sales)", `${fmt(opts.totals.outward)}`],
    ["Total Inward (Purchases)", `${fmt(opts.totals.inward)}`],
    ["Net Balance", `${fmt(opts.totals.net)}`],
  ];
  totals.forEach(([label, value], i) => {
    pdf.setFont("helvetica", i === 2 ? "bold" : "normal");
    if (i === 2) pdf.setFontSize(10);
    pdf.text(label, w - 70, y);
    pdf.text(value, w - 14, y, { align: "right" });
    y += 5;
  });

  // Footer
  y += 10;
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(7);
  pdf.setTextColor(120, 120, 120);
  pdf.text(`Generated on ${new Date().toLocaleDateString("en-IN")}`, 14, 282);
  pdf.text("This is a computer-generated statement.", w - 14, 282, { align: "right" });

  return pdf.output("blob");
}

export function downloadStatementPDF(opts: StatementOptions, filename?: string) {
  const blob = generateStatementPDF(opts);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || `statement-${opts.customerName.replace(/\s+/g, "_")}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}
