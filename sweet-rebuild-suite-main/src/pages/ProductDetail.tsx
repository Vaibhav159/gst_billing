import { useParams, Link, useNavigate } from "react-router-dom";
import { formatCurrency, formatDate } from "@/lib/mockData";
import { useInvoices, useCustomers, useProduct } from "@/hooks/useDataStore";
import api from "@/lib/api";
import Breadcrumbs from "@/components/Breadcrumbs";
import {
  ArrowLeft, Pencil, Trash2, Package, Hash, TrendingUp, BarChart3,
  Receipt, Eye, Printer, Copy, CheckCircle2, Users, ShoppingCart, Scale,
} from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import DeleteConfirmDialog from "@/components/DeleteConfirmDialog";
import { useIsMobile } from "@/hooks/use-mobile";

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" as const } },
};
const stagger = { hidden: {}, visible: { transition: { staggerChildren: 0.06 } } };

export default function ProductDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const { item: product, isLoading: productLoading } = useProduct(id);
  const { items: invoices } = useInvoices();
  const { items: customers } = useCustomers();
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  if (productLoading) return <div className="p-8 text-muted-foreground">Loading product...</div>;
  if (!product) return <div className="p-8 text-muted-foreground">Product not found.</div>;

  const productInvoiceItems = invoices.flatMap((inv) =>
    inv.items.filter((it) => it.productId === id).map((it) => ({ ...it, invoice: inv }))
  );
  const totalRevenue = productInvoiceItems.reduce((s, it) => s + it.amount, 0);
  const totalQty = productInvoiceItems.reduce((s, it) => s + it.qty, 0);
  const totalTax = productInvoiceItems.reduce((s, it) => s + it.cgst + it.sgst + it.igst, 0);
  const usageCount = productInvoiceItems.length;
  const avgRate = totalQty > 0 ? totalRevenue / totalQty : 0;
  const initials = product.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase();

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedField(label);
    setTimeout(() => setCopiedField(null), 1500);
  };

  const monthlyData = Array.from({ length: 12 }, (_, i) => {
    const month = new Date(2024, i, 1);
    const monthStr = month.toLocaleDateString("en-IN", { month: "short" });
    const qty = productInvoiceItems
      .filter((it) => { const d = new Date(it.invoice.invoice_date || ""); return d.getMonth() === i && d.getFullYear() === 2024; })
      .reduce((s, it) => s + it.qty, 0);
    return { month: monthStr, qty };
  });

  const customerUsage = [...new Set(productInvoiceItems.map((it) => it.invoice.customerId))].map((cid) => {
    const cust = customers.find((c) => c.id === cid);
    const items = productInvoiceItems.filter((it) => it.invoice.customerId === cid);
    return { id: cid, name: cust?.name || "Unknown", qty: items.reduce((s, it) => s + it.qty, 0), revenue: items.reduce((s, it) => s + it.amount, 0) };
  }).sort((a, b) => b.revenue - a.revenue).slice(0, 6);

  const recentInvoices = [...new Set(productInvoiceItems.map((it) => it.invoice))]
    .sort((a, b) => new Date(b.invoice_date || 0).getTime() - new Date(a.invoice_date || 0).getTime()).slice(0, 8);

  return (
    <div className={cn("space-y-6 max-w-[1440px] mx-auto", isMobile ? "p-4 pb-24" : "p-6 lg:p-10 space-y-7")}>
      <Breadcrumbs items={[{ label: "Products", href: "/billing/product/list" }, { label: product.name }]} />

      {/* Hero */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}
        className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <div className={cn("rounded-2xl bg-gradient-to-br from-chart-3/25 to-chart-3/5 border border-chart-3/20 flex items-center justify-center text-chart-3 font-display font-bold shadow-lg", isMobile ? "w-12 h-12 text-base" : "w-16 h-16 text-xl")}>
            {initials}
          </div>
          <div className="min-w-0">
            <h1 className={cn("font-display font-bold text-foreground tracking-tight", isMobile ? "text-lg" : "text-3xl")}>{product.name}</h1>
            <div className="flex items-center gap-2 mt-1 text-[12px] text-muted-foreground flex-wrap">
              <span className="font-mono">HSN: {product.hsn}</span>
              <span className={cn("px-2 py-0.5 rounded-lg text-[11px] font-bold tabular-nums",
                product.gstRate <= 5 ? "bg-success/10 text-success" : product.gstRate <= 18 ? "bg-chart-4/10 text-chart-4" : "bg-destructive/10 text-destructive"
              )}>GST {product.gstRate}%</span>
            </div>
          </div>
        </div>
        {!isMobile && (
          <div className="flex items-center gap-2.5">
            <button onClick={() => navigate(-1)} className="premium-btn-ghost text-[13px] h-9"><ArrowLeft className="w-4 h-4" /> Back</button>
            <Link to={`/billing/product/edit/${id}`} className="premium-btn-outline text-[13px] h-9 border-primary/30 text-primary"><Pencil className="w-4 h-4" /> Edit</Link>
            <button onClick={() => setDeleteOpen(true)} className="premium-btn-outline text-[13px] h-9 border-destructive/30 text-destructive"><Trash2 className="w-4 h-4" /> Delete</button>
          </div>
        )}
      </motion.div>

      {/* Stats */}
      <div className={cn("grid gap-3", isMobile ? "grid-cols-2" : "grid-cols-2 lg:grid-cols-5")}>
        {[
          { label: "Revenue", value: formatCurrency(totalRevenue), color: "text-success" },
          { label: "Qty Sold", value: totalQty.toString(), color: "text-chart-3" },
          { label: "Times Used", value: usageCount.toString(), color: "text-chart-1" },
          { label: "Tax Collected", value: formatCurrency(totalTax), color: "text-chart-4" },
          { label: "Avg Rate", value: formatCurrency(avgRate), color: "text-primary" },
        ].map((s) => (
          <div key={s.label} className="elevated-card rounded-2xl p-4">
            <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">{s.label}</p>
            <p className={cn("font-display font-bold tabular-nums mt-1", s.color, isMobile ? "text-base" : "text-2xl")}>{s.value}</p>
          </div>
        ))}
      </div>

      <div className={cn("grid gap-5", isMobile ? "grid-cols-1" : "grid-cols-1 lg:grid-cols-12")}>
        <div className={cn(isMobile ? "" : "lg:col-span-4", "space-y-5")}>
          <div className="elevated-card rounded-2xl p-5 space-y-3">
            <h2 className="text-xs font-display font-semibold text-muted-foreground uppercase tracking-wider">Product Info</h2>
            {[
              { label: "Name", value: product.name },
              { label: "HSN Code", value: product.hsn },
              { label: "GST Rate", value: `${product.gstRate}%` },
              { label: "Description", value: product.description },
            ].map((f) => (
              <div key={f.label}>
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{f.label}</p>
                <p className="text-[13px] text-foreground">{f.value}</p>
              </div>
            ))}
          </div>

          {customerUsage.length > 0 && (
            <div className="elevated-card rounded-2xl p-5 space-y-3">
              <h2 className="text-xs font-display font-semibold text-muted-foreground uppercase tracking-wider">Top Buyers</h2>
              {customerUsage.map((c) => (
                <Link key={c.id} to={`/billing/customer/${c.id}`} className="flex items-center gap-3 p-2 rounded-xl hover:bg-secondary/20 group">
                  <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center text-primary text-[10px] font-bold shrink-0">
                    {c.name.split(" ").map((w) => w[0]).join("").slice(0, 2)}
                  </div>
                  <div className="flex-1 min-w-0"><p className="text-[12px] font-semibold text-foreground truncate">{c.name}</p><p className="text-[10px] text-muted-foreground">{c.qty} qty</p></div>
                  <p className="text-[11px] font-bold text-success tabular-nums">{formatCurrency(c.revenue)}</p>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className={cn(isMobile ? "" : "lg:col-span-8", "space-y-5")}>
          <div className="elevated-card rounded-2xl p-5">
            <h2 className="text-xs font-display font-semibold text-muted-foreground uppercase tracking-wider mb-3">Monthly Sales</h2>
            <ResponsiveContainer width="100%" height={180}>
              <BarChart data={monthlyData}>
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} />
                <Tooltip contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: "12px", fontSize: "12px" }} />
                <Bar dataKey="qty" fill="hsl(var(--chart-3))" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Recent Invoices */}
          <div className="elevated-card rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-border/30">
              <h2 className="text-xs font-display font-semibold text-muted-foreground uppercase tracking-wider">Recent Invoices ({recentInvoices.length})</h2>
            </div>
            {isMobile ? (
              <div className="divide-y divide-border/30">
                {recentInvoices.map((inv) => {
                  const items = inv.items.filter((it) => it.productId === id);
                  const amount = items.reduce((s, it) => s + it.amount, 0);
                  return (
                    <Link key={inv.id} to={`/billing/invoice/${inv.id}`} className="flex items-center gap-3 p-4 hover:bg-secondary/20">
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] font-semibold text-primary">{inv.invoiceNumber}</p>
                        <p className="text-[11px] text-muted-foreground">{formatDate(inv.invoice_date || "")} · {inv.customerName}</p>
                      </div>
                      <p className="text-[13px] font-bold text-success tabular-nums">{formatCurrency(amount)}</p>
                    </Link>
                  );
                })}
                {recentInvoices.length === 0 && <div className="p-8 text-center text-sm text-muted-foreground">No invoices yet</div>}
              </div>
            ) : (
              <table className="table-premium w-full">
                <thead><tr>{["Invoice #", "Date", "Customer", "Qty", "Amount", "Type", ""].map((h) => <th key={h} className="text-[11px]">{h}</th>)}</tr></thead>
                <tbody>
                  {recentInvoices.map((inv) => {
                    const items = inv.items.filter((it) => it.productId === id);
                    const qty = items.reduce((s, it) => s + it.qty, 0);
                    const amount = items.reduce((s, it) => s + it.amount, 0);
                    return (
                      <tr key={inv.id}>
                        <td><Link to={`/billing/invoice/${inv.id}`} className="text-primary hover:underline font-semibold text-[13px]">{inv.invoiceNumber}</Link></td>
                        <td className="text-muted-foreground text-[13px]">{formatDate(inv.invoice_date || "")}</td>
                        <td><Link to={`/billing/customer/${inv.customerId}`} className="text-[13px] text-foreground hover:text-primary">{inv.customerName}</Link></td>
                        <td className="text-[13px] font-semibold tabular-nums">{qty}</td>
                        <td className="text-[13px] font-bold text-success tabular-nums">{formatCurrency(amount)}</td>
                        <td><span className={cn("premium-badge text-[10px]", inv.type === "OUTWARD" ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive")}>{inv.type}</span></td>
                        <td><Link to={`/billing/invoice/${inv.id}`} className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-secondary/50 text-muted-foreground"><Eye className="w-3.5 h-3.5" /></Link></td>
                      </tr>
                    );
                  })}
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
            <Link to={`/billing/product/edit/${id}`} className="premium-btn-outline flex-1 text-[12px] h-10 border-primary/30 text-primary"><Pencil className="w-3.5 h-3.5" /> Edit</Link>
            <button onClick={() => setDeleteOpen(true)} className="premium-btn-outline flex-1 text-[12px] h-10 border-destructive/30 text-destructive"><Trash2 className="w-3.5 h-3.5" /> Delete</button>
          </div>
        </div>
      )}

      <DeleteConfirmDialog open={deleteOpen} onOpenChange={setDeleteOpen} itemName={product.name} itemType="Product"
        onConfirm={async () => {
          try {
            await api.delete(`products/${id}/`);
            toast({ title: "Product Deleted", variant: "destructive" });
            navigate("/billing/product/list");
          } catch (e) {
            toast({ title: "Failed to delete product", variant: "destructive" });
          }
        }} />
    </div>
  );
}
