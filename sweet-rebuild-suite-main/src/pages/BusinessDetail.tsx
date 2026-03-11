import { useParams, Link, useNavigate } from "react-router-dom";
import { formatCurrency, formatDate } from "@/lib/mockData";
import { useBusinesses, useCustomers, useInvoices } from "@/hooks/useDataStore";
import Breadcrumbs from "@/components/Breadcrumbs";
import {
  ArrowLeft, Pencil, Trash2, Phone, Mail, Building2, CreditCard,
  Plus, MapPin, Hash, TrendingUp, TrendingDown, Scale, Receipt,
  Copy, CheckCircle2, Eye, Users, FileText, Landmark,
} from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import DeleteConfirmDialog from "@/components/DeleteConfirmDialog";
import { useIsMobile } from "@/hooks/use-mobile";

const fadeUp = { hidden: { opacity: 0, y: 16 }, visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" as const } } };
const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.06 } } };

export default function BusinessDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const { items: businesses, remove: removeBusiness } = useBusinesses();
  const { items: customers } = useCustomers();
  const { items: invoices } = useInvoices();
  const biz = businesses.find((b) => b.id === id);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  if (!biz) return <div className="p-8 text-muted-foreground">Business not found.</div>;

  const bizInvoices = invoices.filter((inv) => inv.businessId === id);
  const bizCustomers = customers.filter((c) => (c.businesses || []).some(bid => String(bid) === String(id)));
  const totalOutward = bizInvoices.filter((i) => i.type === "OUTWARD").reduce((s, i) => s + i.total, 0);
  const totalInward = bizInvoices.filter((i) => i.type === "INWARD").reduce((s, i) => s + i.total, 0);
  const netAmount = totalOutward - totalInward;
  const initials = biz.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text); setCopiedField(label); setTimeout(() => setCopiedField(null), 1500);
  };

  const monthlyData = Array.from({ length: 12 }, (_, i) => {
    const month = new Date(2024, i, 1);
    const monthStr = month.toLocaleDateString("en-IN", { month: "short" });
    const outward = bizInvoices.filter((inv) => { const d = new Date(inv.date); return d.getMonth() === i && d.getFullYear() === 2024 && inv.type === "OUTWARD"; }).reduce((s, inv) => s + inv.total, 0);
    const inward = bizInvoices.filter((inv) => { const d = new Date(inv.date); return d.getMonth() === i && d.getFullYear() === 2024 && inv.type === "INWARD"; }).reduce((s, inv) => s + inv.total, 0);
    return { month: monthStr, outward, inward };
  });

  const topCustomers = bizCustomers.map((c) => ({
    ...c,
    revenue: bizInvoices.filter((inv) => inv.customerId === c.id && inv.type === "OUTWARD").reduce((s, i) => s + i.total, 0),
    invCount: bizInvoices.filter((inv) => inv.customerId === c.id).length,
  })).sort((a, b) => b.revenue - a.revenue).slice(0, 6);

  return (
    <div className={cn("space-y-6 max-w-[1440px] mx-auto", isMobile ? "p-4 pb-24" : "p-6 lg:p-10 space-y-7")}>
      <Breadcrumbs items={[{ label: "Businesses", href: "/billing/business/list" }, { label: biz.name }]} />

      {/* Hero */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <div className={cn("rounded-2xl bg-gradient-to-br from-chart-4/25 to-chart-4/5 border border-chart-4/20 flex items-center justify-center text-chart-4 font-display font-bold shadow-lg", isMobile ? "w-12 h-12 text-base" : "w-16 h-16 text-xl")}>
            {initials}
          </div>
          <div className="min-w-0">
            <h1 className={cn("font-display font-bold text-foreground tracking-tight", isMobile ? "text-lg" : "text-3xl")}>{biz.name}</h1>
            <div className="flex items-center gap-2 mt-1 text-[12px] text-muted-foreground flex-wrap">
              <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{biz.state_name}</span>
              <span className="font-mono">{biz.gst_number}</span>
            </div>
          </div>
        </div>
        {!isMobile && (
          <div className="flex items-center gap-2.5">
            <button onClick={() => navigate(-1)} className="premium-btn-ghost text-[13px] h-9"><ArrowLeft className="w-4 h-4" /> Back</button>
            <Link to={`/billing/business/edit/${id}`} className="premium-btn-outline text-[13px] h-9 border-primary/30 text-primary"><Pencil className="w-4 h-4" /> Edit</Link>
            <button onClick={() => setDeleteOpen(true)} className="premium-btn-outline text-[13px] h-9 border-destructive/30 text-destructive"><Trash2 className="w-4 h-4" /> Delete</button>
          </div>
        )}
      </motion.div>

      {/* Stats */}
      <div className={cn("grid gap-3", isMobile ? "grid-cols-2" : "grid-cols-2 lg:grid-cols-5")}>
        {[
          { label: "Outward", value: formatCurrency(totalOutward), color: "text-success" },
          { label: "Inward", value: formatCurrency(totalInward), color: "text-destructive" },
          { label: "Net", value: formatCurrency(netAmount), color: netAmount >= 0 ? "text-success" : "text-destructive" },
          { label: "Invoices", value: bizInvoices.length.toString(), color: "text-chart-1" },
          { label: "Customers", value: bizCustomers.length.toString(), color: "text-chart-4" },
        ].map((s) => (
          <div key={s.label} className="elevated-card rounded-2xl p-4">
            <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">{s.label}</p>
            <p className={cn("font-display font-bold tabular-nums mt-1", s.color, isMobile ? "text-base" : "text-2xl")}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className={cn("grid gap-5", isMobile ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-12")}>
        <div className={cn(isMobile ? "" : "lg:col-span-4", "space-y-5")}>
          {/* Business Info */}
          <div className="elevated-card rounded-2xl p-5 space-y-3">
            <h2 className="text-xs font-display font-semibold text-muted-foreground uppercase tracking-wider">Business Info</h2>
            {[
              { label: "GST", value: biz.gst_number, copyable: true },
              { label: "PAN", value: biz.pan_number, copyable: true },
              { label: "State", value: biz.state_name },
              { label: "Address", value: biz.address },
            ].map((f) => (
              <div key={f.label} className="flex items-start justify-between">
                <div><p className="text-[10px] text-muted-foreground uppercase">{f.label}</p><p className="text-[13px] text-foreground">{f.value}</p></div>
                {f.copyable && <button onClick={() => copyToClipboard(f.value, f.label)} className="mt-2 text-muted-foreground hover:text-foreground">{copiedField === f.label ? <CheckCircle2 className="w-3.5 h-3.5 text-success" /> : <Copy className="w-3.5 h-3.5" />}</button>}
              </div>
            ))}
          </div>
          {/* Contact */}
          <div className="elevated-card rounded-2xl p-5 space-y-3">
            <h2 className="text-xs font-display font-semibold text-muted-foreground uppercase tracking-wider">Contact</h2>
            <div><p className="text-[10px] text-muted-foreground uppercase">Phone</p><p className="text-[13px] text-foreground tabular-nums">{biz.mobile_number}</p></div>
            <div><p className="text-[10px] text-muted-foreground uppercase">Email</p><p className="text-[13px] text-foreground">{biz.email}</p></div>
          </div>
          {/* Bank */}
          <div className="elevated-card rounded-2xl p-5 space-y-3">
            <h2 className="text-xs font-display font-semibold text-muted-foreground uppercase tracking-wider">Bank Details</h2>
            {[{ label: "Bank", value: biz.bank_name }, { label: "Account", value: biz.bank_account_number }, { label: "IFSC", value: biz.bank_ifsc_code }, { label: "Branch", value: biz.bank_branch_name }].map((f) => (
              <div key={f.label}><p className="text-[10px] text-muted-foreground uppercase">{f.label}</p><p className="text-[13px] text-foreground">{f.value}</p></div>
            ))}
          </div>
        </div>

        <div className={cn(isMobile ? "" : "lg:col-span-8", "space-y-5")}>
          {/* Chart */}
          <div className="elevated-card rounded-2xl p-5">
            <h2 className="text-xs font-display font-semibold text-muted-foreground uppercase tracking-wider mb-3">Revenue Trend</h2>
            <ResponsiveContainer width="100%" height={180}>
              <AreaChart data={monthlyData}>
                <defs>
                  <linearGradient id="bizOutGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="hsl(var(--success))" stopOpacity={0.2} /><stop offset="95%" stopColor="hsl(var(--success))" stopOpacity={0} /></linearGradient>
                </defs>
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "12px", fontSize: "12px" }} formatter={(value: number) => [formatCurrency(value)]} />
                <Area type="monotone" dataKey="outward" stroke="hsl(var(--success))" strokeWidth={2} fill="url(#bizOutGrad)" />
                <Area type="monotone" dataKey="inward" stroke="hsl(var(--destructive))" strokeWidth={1.5} fill="transparent" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Top Customers */}
          <div className="elevated-card rounded-2xl p-5 space-y-3">
            <h2 className="text-xs font-display font-semibold text-muted-foreground uppercase tracking-wider">Top Customers ({bizCustomers.length})</h2>
            <div className={cn("grid gap-3", isMobile ? "grid-cols-1" : "grid-cols-1 md:grid-cols-2")}>
              {topCustomers.map((c) => (
                <Link key={c.id} to={`/billing/customer/${c.id}`} className="flex items-center gap-3 p-3 rounded-xl border border-border/40 hover:bg-secondary/20 group">
                  <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center text-primary text-[11px] font-bold shrink-0">{c.name.split(" ").map((w) => w[0]).join("").slice(0, 2)}</div>
                  <div className="flex-1 min-w-0"><p className="text-[12px] font-semibold text-foreground truncate">{c.name}</p><p className="text-[10px] text-muted-foreground">{c.invCount} inv</p></div>
                  <p className="text-[11px] font-bold text-success tabular-nums">{formatCurrency(c.revenue)}</p>
                </Link>
              ))}
            </div>
          </div>

          {/* Recent Invoices */}
          <div className="elevated-card rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-border/30">
              <h2 className="text-xs font-display font-semibold text-muted-foreground uppercase tracking-wider">Recent Invoices ({bizInvoices.length})</h2>
            </div>
            {isMobile ? (
              <div className="divide-y divide-border/30">
                {bizInvoices.slice(0, 8).map((inv) => (
                  <Link key={inv.id} to={`/billing/invoice/${inv.id}`} className="flex items-center gap-3 p-4 hover:bg-secondary/20">
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-primary">{inv.invoiceNumber}</p>
                      <p className="text-[11px] text-muted-foreground">{formatDate(inv.date)} · {inv.customerName}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-[13px] font-bold text-foreground tabular-nums">{formatCurrency(inv.total)}</p>
                      <span className={cn("text-[10px] font-bold uppercase", inv.type === "OUTWARD" ? "text-primary" : "text-destructive")}>{inv.type}</span>
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <table className="table-premium w-full">
                <thead><tr>{["Invoice #", "Date", "Customer", "Total", "Type", ""].map((h) => <th key={h} className="text-[11px]">{h}</th>)}</tr></thead>
                <tbody>
                  {bizInvoices.slice(0, 8).map((inv) => (
                    <tr key={inv.id}>
                      <td><Link to={`/billing/invoice/${inv.id}`} className="text-primary hover:underline font-semibold text-[13px]">{inv.invoiceNumber}</Link></td>
                      <td className="text-muted-foreground text-[13px]">{formatDate(inv.date)}</td>
                      <td className="text-foreground text-[13px]">{inv.customerName}</td>
                      <td className="font-bold text-foreground tabular-nums text-[13px]">{formatCurrency(inv.total)}</td>
                      <td><span className={cn("premium-badge text-[10px]", inv.type === "OUTWARD" ? "bg-primary/12 text-primary" : "bg-destructive/12 text-destructive")}>{inv.type}</span></td>
                      <td><Link to={`/billing/invoice/${inv.id}`} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-secondary/40 text-muted-foreground"><Eye className="w-3.5 h-3.5" /></Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {isMobile && (
        <div className="fixed bottom-16 left-0 right-0 z-40 bg-card/95 backdrop-blur-md border-t border-border/50 px-4 py-3 safe-area-bottom">
          <div className="flex items-center gap-2">
            <Link to={`/billing/business/edit/${id}`} className="premium-btn-outline flex-1 text-[12px] h-10 border-primary/30 text-primary"><Pencil className="w-3.5 h-3.5" /> Edit</Link>
            <button onClick={() => setDeleteOpen(true)} className="premium-btn-outline flex-1 text-[12px] h-10 border-destructive/30 text-destructive"><Trash2 className="w-3.5 h-3.5" /> Delete</button>
          </div>
        </div>
      )}

      <DeleteConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} itemName={biz.name} itemType="Business"
        onConfirm={() => { removeBusiness(id!); toast({ title: "Business Deleted", variant: "destructive" }); navigate("/billing/business/list"); }} />
    </div>
  );
}
