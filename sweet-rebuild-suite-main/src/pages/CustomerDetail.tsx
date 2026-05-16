import { logger } from "@/utils/logger";
import { useParams, Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft, Pencil, FileText, Trash2, Plus, Phone, Mail, MapPin,
  Tag, Building2, TrendingUp, TrendingDown, Activity, Calendar,
  Eye, Printer, ExternalLink, Copy, CheckCircle2, Download, Loader2, FileArchive,
} from "lucide-react";
import { motion } from "framer-motion";
import { ResponsiveContainer, AreaChart, Area } from "recharts";
import { formatCurrency, formatCompactCurrency, formatDate } from "@/utils/mockData";
import { useCustomer, useCustomers, useBusinesses, useInvoices } from "@/hooks/useDataStore";
import Breadcrumbs from "@/components/Breadcrumbs";
import { cn } from "@/utils/utils";
import { useToast } from "@/hooks/use-toast";
import DeleteConfirmDialog from "@/components/DeleteConfirmDialog";
import { useState } from "react";
import { useIsMobile } from "@/hooks/use-mobile";

const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.06 } } };
const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" as const } },
};

export default function CustomerDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const [showDelete, setShowDelete] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [dlProgress, setDlProgress] = useState({ current: 0, total: 0 });
  const { item: customer, isLoading } = useCustomer(id);
  const { remove: removeCustomer } = useCustomers();
  const { items: businesses } = useBusinesses();
  const { items: invoices, isLoading: isLoadingInvoices } = useInvoices({ customerId: id });

  if (isLoading) return <div className="p-10 text-muted-foreground">Loading customer...</div>;
  if (!customer) return (
    <div className="p-10 flex flex-col items-center gap-4 text-muted-foreground">
      <p className="text-lg font-display font-semibold">Customer not found</p>
      <Link to="/billing/customer/list" className="premium-btn-ghost text-sm"><ArrowLeft className="w-4 h-4" /> Back</Link>
    </div>
  );

  const custInvoices = invoices.filter((inv) => String(inv.customerId) === String(id));
  const totalSales = custInvoices.filter((i) => i.type === "OUTWARD").reduce((s, i) => s + i.total, 0);
  const totalPurchases = custInvoices.filter((i) => i.type === "INWARD").reduce((s, i) => s + i.total, 0);
  const netAmount = totalSales - totalPurchases;
  const sortedInvoices = [...custInvoices].sort((a, b) => new Date(b.invoice_date || "").getTime() - new Date(a.invoice_date || "").getTime());

  const monthlyMap: Record<string, number> = {};
  custInvoices.filter((i) => i.type === "OUTWARD").forEach((inv) => {
    const month = (inv.invoice_date || "").slice(0, 7);
    monthlyMap[month] = (monthlyMap[month] || 0) + inv.total;
  });
  const trendData = Object.entries(monthlyMap).sort().map(([k, v]) => ({ month: k, value: v }));

  const handleDownloadAll = async () => {
    if (custInvoices.length === 0) return;
    setDownloading(true);
    setDlProgress({ current: 0, total: custInvoices.length });
    toast({ title: "Generating PDFs", description: `Creating ${custInvoices.length} invoice PDFs...` });
    try {
      const { generateBulkPDFZip } = await import("@/utils/generateBulkPDF");
      const zipBlob = await generateBulkPDFZip(
        custInvoices,
        businesses,
        (current, total) => setDlProgress({ current, total })
      );
      const url = window.URL.createObjectURL(zipBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${customer.name.replace(/[^a-zA-Z0-9]/g, "_")}_invoices.zip`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
      toast({ title: "Download Complete", description: `${custInvoices.length} PDFs downloaded as ZIP.` });
    } catch (err) {
      logger.error("Bulk PDF failed", err);
      toast({ title: "Download Failed", description: "Could not generate PDFs.", variant: "destructive" });
    }
    setDownloading(false);
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(label);
    setTimeout(() => setCopiedField(null), 2000);
    toast({ title: "Copied", description: `${label} copied` });
  };

  const productMap: Record<string, { name: string; qty: number; amount: number }> = {};
  custInvoices.forEach((inv) => {
    inv.items.forEach((item) => {
      if (!productMap[item.productId]) productMap[item.productId] = { name: item.productName, qty: 0, amount: 0 };
      productMap[item.productId].qty += item.qty;
      productMap[item.productId].amount += item.amount;
    });
  });
  const topProducts = Object.entries(productMap).sort((a, b) => b[1].amount - a[1].amount).slice(0, 5);

  return (
    <div className={cn("space-y-6 max-w-[1440px] mx-auto", isMobile ? "p-4 pb-24" : "p-6 lg:p-10 space-y-7")}>
      <Breadcrumbs items={[{ label: "Customers", href: "/billing/customer/list" }, { label: customer.name }]} />

      {/* Hero */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        className="elevated-card rounded-2xl p-5">
        <div className="flex items-start gap-4">
          <div className={cn("rounded-2xl bg-gradient-to-br from-primary/25 to-primary/5 border border-primary/20 flex items-center justify-center text-primary font-bold font-display shrink-0", isMobile ? "w-12 h-12 text-base" : "w-16 h-16 text-xl")}>
            {customer.name.split(" ").map((w) => w[0]).join("").slice(0, 2)}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className={cn("font-display font-bold text-foreground tracking-tight", isMobile ? "text-lg" : "text-2xl lg:text-3xl")}>{customer.name}</h1>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              {(customer.tags || []).map((t) => (
                <span key={t} className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold uppercase tracking-wider",
                  t === "VIP" ? "bg-chart-4/12 text-chart-4" : t === "Wholesale" ? "bg-chart-3/12 text-chart-3" : t === "Retail" ? "bg-success/12 text-success" : "bg-primary/10 text-primary"
                )}><Tag className="w-2.5 h-2.5" />{t}</span>
              ))}
            </div>
          </div>
        </div>
        {!isMobile && (
          <div className="flex items-center gap-2 mt-4">
            <button onClick={() => navigate(-1)} className="premium-btn-ghost text-[13px] h-9"><ArrowLeft className="w-4 h-4" /> Back</button>
            <Link to={`/billing/customer/${id}/statement`} className="premium-btn-ghost text-[13px] h-9"><FileText className="w-4 h-4" /> Statement</Link>
            <button onClick={handleDownloadAll} disabled={downloading || custInvoices.length === 0} className="premium-btn-ghost text-[13px] h-9">
              {downloading ? <><Loader2 className="w-4 h-4 animate-spin" /> {dlProgress.current}/{dlProgress.total}</> : <><Download className="w-4 h-4" /> Download All PDFs</>}
            </button>
            <Link to={`/billing/customer/edit/${id}`} className="premium-btn-outline text-[13px] h-9 border-primary/30 text-primary"><Pencil className="w-4 h-4" /> Edit</Link>
            <button onClick={() => setShowDelete(true)} className="premium-btn-outline text-[13px] h-9 border-destructive/30 text-destructive"><Trash2 className="w-4 h-4" /> Delete</button>
          </div>
        )}
      </motion.div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Sales", value: formatCompactCurrency(totalSales), full: formatCurrency(totalSales), icon: TrendingUp, color: "text-success" },
          { label: "Purchases", value: formatCompactCurrency(totalPurchases), full: formatCurrency(totalPurchases), icon: TrendingDown, color: "text-warning" },
          { label: "Net", value: formatCompactCurrency(netAmount), full: formatCurrency(netAmount), icon: Activity, color: netAmount >= 0 ? "text-success" : "text-destructive" },
          { label: "Invoices", value: custInvoices.length.toLocaleString("en-IN"), full: `${custInvoices.length} invoices`, icon: FileText, color: "text-chart-4" },
        ].map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="stat-card rounded-2xl p-4" title={stat.full}>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">{stat.label}</p>
                <Icon className={cn("w-3.5 h-3.5", stat.color)} />
              </div>
              <p className={cn("font-display font-bold tabular-nums", stat.color, isMobile ? "text-base" : "text-xl")}>{stat.value}</p>
            </div>
          );
        })}
      </div>

      {/* Content */}
      <div className={cn("grid gap-5", isMobile ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-12")}>
        <div className={cn(isMobile ? "" : "lg:col-span-4", "space-y-5")}>
          {/* Contact */}
          <div className="elevated-card rounded-2xl p-5 space-y-3">
            <h2 className="text-xs font-display font-semibold text-foreground uppercase tracking-wider">Contact</h2>
            {[
              { icon: Phone, label: "Mobile", value: customer.mobile_number },
              { icon: Mail, label: "Email", value: customer.email },
              { icon: MapPin, label: "State", value: customer.state_name },
            ].map((f) => (
              <div key={f.label} className="flex items-center gap-3 p-2 rounded-xl">
                <f.icon className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <div className="min-w-0"><p className="text-[10px] text-muted-foreground uppercase">{f.label}</p><p className="text-[13px] text-foreground truncate">{f.value || "—"}</p></div>
              </div>
            ))}
          </div>

          {/* Tax Info */}
          <div className="elevated-card rounded-2xl p-5 space-y-3">
            <h2 className="text-xs font-display font-semibold text-foreground uppercase tracking-wider">Tax Info</h2>
            {[{ label: "GST", value: customer.gst_number }, { label: "PAN", value: customer.pan_number }].map((f) => (
              <div key={f.label} className="flex items-center justify-between p-2.5 rounded-xl bg-secondary/15 border border-border/30">
                <div><p className="text-[10px] text-muted-foreground uppercase">{f.label}</p><code className="text-[12px] font-mono text-foreground">{f.value || "—"}</code></div>
                {f.value && (
                  <button onClick={() => copyToClipboard(f.value, f.label)} className="w-7 h-7 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground">
                    {copiedField === f.label ? <CheckCircle2 className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                )}
              </div>
            ))}
          </div>

          {topProducts.length > 0 && (
            <div className="elevated-card rounded-2xl p-5 space-y-3">
              <h2 className="text-xs font-display font-semibold text-foreground uppercase tracking-wider">Top Products</h2>
              {topProducts.map(([pid, data], i) => (
                <Link key={pid} to={`/billing/product/${pid}`} className="flex items-center gap-3 group">
                  <span className="w-5 h-5 rounded bg-success/10 flex items-center justify-center text-success text-[10px] font-bold">{i + 1}</span>
                  <div className="flex-1 min-w-0"><p className="text-[12px] font-medium text-foreground truncate">{data.name}</p></div>
                  <span className="text-[12px] font-bold text-foreground tabular-nums">{formatCurrency(data.amount)}</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className={cn(isMobile ? "" : "lg:col-span-8", "space-y-5")}>
          {trendData.length > 1 && (
            <div className="elevated-card rounded-2xl p-5">
              <h2 className="text-xs font-display font-semibold text-foreground uppercase tracking-wider mb-3">Revenue Trend</h2>
              <ResponsiveContainer width="100%" height={120}>
                <AreaChart data={trendData} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                  <defs>
                    <linearGradient id="custTrend" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                      <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Area type="monotone" dataKey="value" stroke="hsl(var(--primary))" strokeWidth={2} fill="url(#custTrend)" dot={{ fill: "hsl(var(--primary))", r: 3, strokeWidth: 0 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Invoices */}
          <div className="elevated-card rounded-2xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-border/40">
              <h2 className="text-xs font-display font-semibold text-foreground uppercase tracking-wider">Invoices ({custInvoices.length})</h2>
              {!isMobile && <Link to="/billing/invoice/add" className="premium-btn-primary text-[12px] h-8 px-3 gap-1"><Plus className="w-3.5 h-3.5" /> New</Link>}
            </div>
            {isMobile ? (
              <div className="divide-y divide-border/30">
                {sortedInvoices.slice(0, 10).map((inv) => (
                  <Link key={inv.id} to={`/billing/invoice/${inv.id}`} className="flex items-center gap-3 p-4 hover:bg-secondary/20">
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-primary">{inv.invoiceNumber}</p>
                      <p className="text-[11px] text-muted-foreground">{formatDate(inv.invoice_date || "")} · {inv.businessName}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[13px] font-bold text-foreground tabular-nums">{formatCurrency(inv.total)}</p>
                      <span className={cn("text-[10px] font-bold uppercase", inv.type === "OUTWARD" ? "text-success" : "text-warning")}>{inv.type}</span>
                    </div>
                  </Link>
                ))}
                {custInvoices.length === 0 && <div className="p-8 text-center text-sm text-muted-foreground">No invoices yet</div>}
              </div>
            ) : (
              <table className="table-premium">
                <thead><tr>{["Invoice #", "Date", "Business", "Amount", "Tax", "Type", ""].map((h) => <th key={h}>{h}</th>)}</tr></thead>
                <tbody>
                  {sortedInvoices.map((inv) => (
                    <tr key={inv.id}>
                      <td><Link to={`/billing/invoice/${inv.id}`} className="text-primary hover:underline font-semibold text-[13px]">{inv.invoiceNumber}</Link></td>
                      <td className="text-muted-foreground text-[13px]">{formatDate(inv.invoice_date || "")}</td>
                      <td className="text-foreground text-[13px]">{inv.businessName}</td>
                      <td className="font-bold text-foreground tabular-nums text-[13px]">{formatCurrency(inv.total)}</td>
                      <td className="text-muted-foreground text-[12px] tabular-nums">{formatCurrency(inv.totalTax)}</td>
                      <td><span className={cn("premium-badge text-[10px]", inv.type === "OUTWARD" ? "bg-success/12 text-success" : "bg-warning/12 text-warning")}>{inv.type}</span></td>
                      <td><Link to={`/billing/invoice/${inv.id}`} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-secondary/40 text-muted-foreground"><Eye className="w-3.5 h-3.5" /></Link></td>
                    </tr>
                  ))}
                  {custInvoices.length === 0 && <tr><td colSpan={7} className="text-center py-12 text-muted-foreground">No invoices</td></tr>}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Mobile Bottom Actions */}
      {isMobile && (
        <div className="fixed bottom-16 left-0 right-0 z-40 bg-card/95 backdrop-blur-md border-t border-border/50 px-4 py-3 safe-area-bottom">
          <div className="flex items-center gap-2">
            <Link to={`/billing/customer/edit/${id}`} className="premium-btn-outline flex-1 text-[12px] h-10 border-primary/30 text-primary"><Pencil className="w-3.5 h-3.5" /> Edit</Link>
            <button onClick={handleDownloadAll} disabled={downloading || custInvoices.length === 0} className="premium-btn-outline flex-1 text-[12px] h-10 border-chart-3/30 text-chart-3">
              {downloading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {dlProgress.current}/{dlProgress.total}</> : <><Download className="w-3.5 h-3.5" /> PDFs</>}
            </button>
            <Link to={`/billing/customer/${id}/statement`} className="premium-btn-primary flex-1 text-[12px] h-10"><FileText className="w-3.5 h-3.5" /> Statement</Link>
            <button onClick={() => setShowDelete(true)} className="premium-btn-outline h-10 px-3 text-[12px] border-destructive/30 text-destructive"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        </div>
      )}

      <DeleteConfirmDialog open={showDelete} onOpenChange={setShowDelete} itemName={customer.name} itemType="Customer"
        onConfirm={() => { removeCustomer(id!); toast({ title: "Customer Deleted", variant: "destructive" }); navigate("/billing/customer/list"); }} />
    </div>
  );
}
