import { useParams, Link, useNavigate } from "react-router-dom";
import { formatCurrency, formatDate } from "@/lib/mockData";
import { useInvoice, useInvoices, useBusinesses, useCustomers } from "@/hooks/useDataStore";
import Breadcrumbs from "@/components/Breadcrumbs";

import {
  ArrowLeft, Pencil, Printer, Copy, Plus, Clock, Package, IndianRupee,
  Receipt, TrendingUp, Building2, User, MapPin, Phone, Mail, Hash,
  FileText, Share2, Download, MessageCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { motion } from "framer-motion";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { useIsMobile } from "@/hooks/use-mobile";
import { shareInvoice, shareViaWhatsApp } from "@/lib/shareInvoice";

export default function InvoiceDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const { item: inv, isLoading } = useInvoice(id);
  const { items: invoices } = useInvoices();
  const { items: businesses } = useBusinesses();
  const { items: customers } = useCustomers();

  if (isLoading) return <div className="p-8 text-muted-foreground">Loading invoice...</div>;
  if (!inv) return <div className="p-8 text-muted-foreground">Invoice not found.</div>;
  const biz = businesses.find((b) => b.id === inv.businessId);
  const customer = customers.find((c) => c.id === inv.customerId);

  const itemChartData = inv.items.map((item) => ({
    name: item.productName.length > 12 ? item.productName.slice(0, 12) + "…" : item.productName,
    amount: item.amount,
    tax: inv.isIGST ? item.igst : item.cgst + item.sgst,
  }));

  const customerInvoices = invoices.filter((i) => i.customerId === inv.customerId && i.id !== inv.id).slice(0, 5);

  const summaryCards = [
    { label: "Subtotal", value: formatCurrency(inv.subtotal), icon: Package, color: "text-foreground" },
    { label: "Total Tax", value: formatCurrency(inv.totalTax), icon: Receipt, color: "text-chart-3" },
    { label: "Grand Total", value: formatCurrency(inv.total), icon: IndianRupee, color: "text-primary" },
    { label: "Items", value: `${inv.items.length} products`, icon: TrendingUp, color: "text-success" },
  ];

  return (
    <div className={cn("space-y-6 animate-fade-in", isMobile ? "p-4 pb-24" : "p-6 lg:p-8")}>
      <Breadcrumbs items={[{ label: "Invoices", href: "/billing/invoice/list" }, { label: inv.invoiceNumber }]} />

      {/* Header */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <div className={cn("rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center", isMobile ? "w-11 h-11" : "w-14 h-14")}>
            <FileText className={cn("text-primary", isMobile ? "w-5 h-5" : "w-6 h-6")} />
          </div>
          <div>
            <h1 className={cn("font-display font-bold text-foreground tracking-tight", isMobile ? "text-xl" : "text-3xl")}>{inv.invoiceNumber}</h1>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" />{formatDate(inv.invoice_date || "")}</span>
              <span className={cn("premium-badge text-[10px]", inv.type === "OUTWARD" ? "bg-success/12 text-success" : "bg-warning/12 text-warning")}>{inv.type}</span>
              {inv.isIGST && <span className="premium-badge bg-warning/12 text-warning text-[10px]">IGST</span>}
            </div>
          </div>
        </div>
        {!isMobile && (
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => navigate(-1)} className="premium-btn-ghost text-[13px]"><ArrowLeft className="w-4 h-4" /> Back</button>
            <Link to={`/billing/invoice/edit/${id}`} className="premium-btn-outline text-[13px] border-primary/30 text-primary"><Pencil className="w-4 h-4" /> Edit</Link>
            <button onClick={() => { toast({ title: "Duplicated", description: `Copy of ${inv.invoiceNumber} created` }); navigate("/billing/invoice/add"); }} className="premium-btn-ghost text-[13px]"><Copy className="w-4 h-4" /> Duplicate</button>
            <Link to={`/billing/invoice/${id}/print`} className="premium-btn-primary text-[13px] bg-success"><Printer className="w-4 h-4" /> View Bill</Link>
            <Link to="/billing/invoice/add" className="premium-btn-primary text-[13px]"><Plus className="w-4 h-4" /> New</Link>
          </div>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-3">
        {summaryCards.map((card, i) => (
          <motion.div key={card.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.06 }}
            className="stat-card rounded-2xl p-4">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{card.label}</p>
              <card.icon className={cn("w-3.5 h-3.5", card.color)} />
            </div>
            <p className={cn("font-display font-bold", card.color, isMobile ? "text-base" : "text-xl")}>{card.value}</p>
          </motion.div>
        ))}
      </div>

      <div className={cn("grid gap-6", isMobile ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-3")}>
        {/* Left: Parties + Items */}
        <div className={cn(isMobile ? "" : "lg:col-span-2", "space-y-6")}>
          {/* Parties */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="elevated-card rounded-2xl p-5 space-y-2">
              <div className="flex items-center gap-2 mb-1">
                <Building2 className="w-4 h-4 text-primary" />
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">From</p>
              </div>
              <p className="text-[14px] font-display font-bold text-foreground">{inv.businessName}</p>
              {biz && (
                <div className="space-y-1 text-[12px] text-muted-foreground">
                  <p className="flex items-center gap-1.5"><Hash className="w-3 h-3" /><span className="font-mono">{biz.gst_number}</span></p>
                  <p className="flex items-center gap-1.5"><MapPin className="w-3 h-3" />{biz.address}</p>
                </div>
              )}
            </div>
            <div className="elevated-card rounded-2xl p-5 space-y-2">
              <div className="flex items-center gap-2 mb-1">
                <User className="w-4 h-4 text-chart-3" />
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">To</p>
              </div>
              <Link to={`/billing/customer/${inv.customerId}`} className="text-[14px] font-display font-bold text-primary hover:underline">{inv.customerName}</Link>
              {customer && (
                <div className="space-y-1 text-[12px] text-muted-foreground">
                  <p className="flex items-center gap-1.5"><Hash className="w-3 h-3" /><span className="font-mono">{customer.gst_number}</span></p>
                  <p className="flex items-center gap-1.5"><MapPin className="w-3 h-3" />{customer.address}</p>
                </div>
              )}
            </div>
          </div>

          {/* Line Items */}
          <div className="elevated-card rounded-2xl overflow-hidden">
            <div className="px-5 py-3 border-b border-border/50 flex items-center justify-between">
              <h2 className="text-[13px] font-display font-semibold text-foreground">Line Items ({inv.items.length})</h2>
              <span className="text-[11px] text-muted-foreground">{inv.isIGST ? "IGST" : "CGST+SGST"}</span>
            </div>
            {isMobile ? (
              <div className="divide-y divide-border/30">
                {inv.items.map((item, i) => (
                  <div key={i} className="p-4 space-y-2">
                    <div className="flex items-start justify-between">
                      <div>
                        <p className="text-[13px] font-semibold text-foreground">{item.productName}</p>
                        <p className="text-[11px] text-muted-foreground font-mono">HSN: {item.hsn}</p>
                      </div>
                      <span className="premium-badge bg-success/12 text-success text-[10px]">{item.gstRate}%</span>
                    </div>
                    <div className="flex items-center justify-between text-[12px]">
                      <span className="text-muted-foreground">{item.qty} × {formatCurrency(item.rate)}</span>
                      <span className="font-bold text-foreground">{formatCurrency(item.amount)}</span>
                    </div>
                    <div className="text-[11px] text-muted-foreground text-right">
                      Tax: {inv.isIGST ? formatCurrency(item.igst) : `${formatCurrency(item.cgst)} + ${formatCurrency(item.sgst)}`}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <table className="table-premium">
                <thead><tr>
                  <th>#</th><th>Product</th><th>HSN</th><th>GST%</th><th>Qty</th><th>Rate</th><th>Amount</th><th>{inv.isIGST ? "IGST" : "CGST/SGST"}</th>
                </tr></thead>
                <tbody>{inv.items.map((item, i) => (
                  <tr key={i}>
                    <td className="text-muted-foreground">{i + 1}</td>
                    <td className="font-medium text-foreground">{item.productName}</td>
                    <td className="font-mono text-muted-foreground text-[11px]">{item.hsn}</td>
                    <td><span className="premium-badge bg-success/12 text-success">{item.gstRate}%</span></td>
                    <td className="text-foreground font-medium">{item.qty}</td>
                    <td className="text-foreground">{formatCurrency(item.rate)}</td>
                    <td className="font-bold text-foreground">{formatCurrency(item.amount)}</td>
                    <td className="text-muted-foreground">{inv.isIGST ? formatCurrency(item.igst) : `${formatCurrency(item.cgst)} + ${formatCurrency(item.sgst)}`}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>

          {/* Chart */}
          {inv.items.length > 1 && (
            <div className="elevated-card rounded-2xl p-5">
              <h2 className="text-[13px] font-display font-semibold text-foreground mb-3">Item Breakdown</h2>
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={itemChartData}>
                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={50} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                    <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "12px", fontSize: "12px" }} formatter={(value: number) => formatCurrency(value)} />
                    <Bar dataKey="amount" radius={[6, 6, 0, 0]} fill="hsl(var(--primary))" />
                    <Bar dataKey="tax" radius={[6, 6, 0, 0]} fill="hsl(var(--chart-3))" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>

        {/* Right Sidebar */}
        <div className="space-y-5">
          {/* Summary */}
          <div className="elevated-card rounded-2xl p-5 space-y-3">
            <h2 className="text-[13px] font-display font-semibold text-foreground">Financial Summary</h2>
            <div className="space-y-2 text-[13px]">
              {[
                { label: "Subtotal", value: formatCurrency(inv.subtotal) },
                inv.isIGST ? { label: "IGST", value: formatCurrency(inv.totalIGST) } : null,
                !inv.isIGST ? { label: "CGST", value: formatCurrency(inv.totalCGST) } : null,
                !inv.isIGST ? { label: "SGST", value: formatCurrency(inv.totalSGST) } : null,
                { label: "Total Tax", value: formatCurrency(inv.totalTax) },
              ].filter(Boolean).map((row) => row && (
                <div key={row.label} className="flex justify-between"><span className="text-muted-foreground">{row.label}</span><span className="text-foreground">{row.value}</span></div>
              ))}
              <div className="border-t border-border/50 pt-3 flex justify-between font-bold">
                <span className="text-foreground">Grand Total</span>
                <span className="text-primary text-lg font-display">{formatCurrency(inv.total)}</span>
              </div>
            </div>
          </div>

          {!isMobile && (
            <>
              <div className="elevated-card rounded-2xl p-5 space-y-2.5">
                <h3 className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider mb-3">Quick Actions</h3>
                <Link to={`/billing/invoice/${id}/print`} className="premium-btn-primary w-full text-[13px]"><Printer className="w-4 h-4" /> Print / PDF</Link>
                <button onClick={() => shareViaWhatsApp(inv, customer?.mobile_number)} className="premium-btn-outline w-full text-[13px] border-success/30 text-success"><MessageCircle className="w-4 h-4" /> WhatsApp {customer?.mobile_number ? `(${customer.mobile_number})` : ""}</button>
                <Link to={`/billing/invoice/${id}/print`} className="premium-btn-ghost w-full text-[13px]"><Download className="w-4 h-4" /> Download PDF</Link>
              </div>

              <div className="elevated-card rounded-2xl p-5 space-y-2 text-[13px]">
                <h3 className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Details</h3>
                {[
                  { label: "Financial Year", value: inv.financialYear },
                  { label: "Type", value: inv.type },
                  { label: "GST Type", value: inv.isIGST ? "IGST (Interstate)" : "CGST/SGST (Intrastate)" },
                  { label: "Items", value: `${inv.items.length} line items` },
                  { label: "Created", value: formatDate(inv.createdAt) },
                ].map((d) => (
                  <div key={d.label} className="flex justify-between"><span className="text-muted-foreground">{d.label}</span><span className="text-foreground font-medium">{d.value}</span></div>
                ))}
              </div>
            </>
          )}

          {customerInvoices.length > 0 && (
            <div className="elevated-card rounded-2xl p-5 space-y-3">
              <h3 className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">Other invoices for {inv.customerName}</h3>
              <div className="space-y-2">
                {customerInvoices.map((ci) => (
                  <Link key={ci.id} to={`/billing/invoice/${ci.id}`} className="flex items-center justify-between p-2.5 rounded-xl hover:bg-secondary/30 transition-colors group">
                    <div>
                      <p className="text-[12px] font-semibold text-primary group-hover:underline">{ci.invoiceNumber}</p>
                      <p className="text-[10px] text-muted-foreground">{formatDate(ci.invoice_date || "")}</p>
                    </div>
                    <span className="text-[12px] font-bold text-foreground">{formatCurrency(ci.total)}</span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Mobile Bottom Action Bar */}
      {isMobile && (
        <div className="fixed bottom-16 left-0 right-0 z-40 bg-card/95 backdrop-blur-md border-t border-border/50 px-4 py-3 safe-area-bottom">
          <div className="flex items-center gap-2">
            <Link to={`/billing/invoice/edit/${id}`} className="premium-btn-outline flex-1 text-[12px] h-10 border-primary/30 text-primary"><Pencil className="w-3.5 h-3.5" /> Edit</Link>
            <Link to={`/billing/invoice/${id}/print`} className="premium-btn-primary flex-1 text-[12px] h-10 bg-success"><Printer className="w-3.5 h-3.5" /> Print</Link>
            <button onClick={() => shareViaWhatsApp(inv, customer?.mobile_number)} className="premium-btn-outline h-10 px-3 text-[12px] border-success/30 text-success" title={customer?.mobile_number ? `WhatsApp ${customer.mobile_number}` : "WhatsApp"}><MessageCircle className="w-3.5 h-3.5" /></button>
            <button onClick={() => shareInvoice(inv)} className="premium-btn-outline h-10 px-3 text-[12px] border-border text-muted-foreground"><Share2 className="w-3.5 h-3.5" /></button>
          </div>
        </div>
      )}
    </div>
  );
}
