import { useState } from "react";
import { Link } from "react-router-dom";
import { invoices, formatCurrency, formatDate } from "@/lib/mockData";
import Breadcrumbs from "@/components/Breadcrumbs";
import {
  Download, FileArchive, ArrowLeft, Calendar, Building2, Filter,
  FileText, CheckSquare, Square, Printer, Package,
} from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

export default function BulkPDF() {
  const { toast } = useToast();
  const [month, setMonth] = useState("April");
  const [year, setYear] = useState("2024");
  const [bizFilter, setBizFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [selectedInvoices, setSelectedInvoices] = useState<Set<string>>(new Set());
  const MONTHS = ["April", "May", "June", "July", "August", "September", "October", "November", "December", "January", "February", "March"];

  // Filter invoices based on selections
  const monthIndex = MONTHS.indexOf(month);
  const actualMonth = monthIndex < 9 ? monthIndex + 4 : monthIndex - 8;
  const matchingInvoices = invoices.filter((inv) => {
    const d = new Date(inv.date);
    const monthMatch = d.getMonth() + 1 === actualMonth;
    const yearMatch = d.getFullYear().toString() === year;
    const bizMatch = bizFilter === "all" || inv.businessId === bizFilter;
    const typeMatch = typeFilter === "all" || inv.type === typeFilter;
    return monthMatch && yearMatch && bizMatch && typeMatch;
  });

  const toggleInvoice = (id: string) => {
    const next = new Set(selectedInvoices);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedInvoices(next);
  };
  const toggleAll = () => {
    selectedInvoices.size === matchingInvoices.length
      ? setSelectedInvoices(new Set())
      : setSelectedInvoices(new Set(matchingInvoices.map((i) => i.id)));
  };

  const handleDownload = () => {
    const count = selectedInvoices.size > 0 ? selectedInvoices.size : matchingInvoices.length;
    toast({ title: "Generating PDFs", description: `${count} invoices will be downloaded as ZIP` });
  };

  return (
    <div className="p-6 lg:p-8 space-y-6 animate-fade-in">
      <Breadcrumbs items={[{ label: "Invoices", href: "/billing/invoice/list" }, { label: "Bulk PDF" }]} />

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <FileArchive className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground tracking-tight">Bulk PDF Download</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Download multiple invoices as a ZIP file</p>
          </div>
        </div>
        <Link to="/billing/invoice/list" className="premium-btn-ghost text-[13px]"><ArrowLeft className="w-4 h-4" /> Back</Link>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Filters */}
        <div className="space-y-5">
          <div className="elevated-card rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-primary" />
              <h2 className="text-[14px] font-display font-semibold text-foreground">Filters</h2>
            </div>
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-[12px] font-semibold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Calendar className="w-3 h-3 text-muted-foreground" /> Month
                </label>
                <select value={month} onChange={(e) => setMonth(e.target.value)} className="premium-select w-full">
                  {MONTHS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-[12px] font-semibold text-foreground uppercase tracking-wider">Year</label>
                <select value={year} onChange={(e) => setYear(e.target.value)} className="premium-select w-full">
                  {["2024", "2025"].map((y) => <option key={y} value={y}>{y}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-[12px] font-semibold text-foreground uppercase tracking-wider flex items-center gap-1.5">
                  <Building2 className="w-3 h-3 text-muted-foreground" /> Business
                </label>
                <select value={bizFilter} onChange={(e) => setBizFilter(e.target.value)} className="premium-select w-full">
                  <option value="all">All Businesses</option>
                  {businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-[12px] font-semibold text-foreground uppercase tracking-wider">Type</label>
                <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="premium-select w-full">
                  <option value="all">All Types</option>
                  <option value="OUTWARD">Outward (Sales)</option>
                  <option value="INWARD">Inward (Purchases)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Download Action */}
          <div className="elevated-card rounded-2xl p-6 space-y-4">
            <div className="text-center space-y-2">
              <p className="text-3xl font-display font-bold text-primary">{matchingInvoices.length}</p>
              <p className="text-[12px] text-muted-foreground">invoices match your filters</p>
            </div>
            {selectedInvoices.size > 0 && (
              <p className="text-[12px] text-center text-chart-3 font-medium">{selectedInvoices.size} selected for download</p>
            )}
            <button onClick={handleDownload} disabled={matchingInvoices.length === 0}
              className={cn("w-full h-12 rounded-xl text-[14px] font-semibold flex items-center justify-center gap-2 transition-all",
                matchingInvoices.length > 0 ? "bg-primary text-primary-foreground hover:brightness-110 glow-sm" : "bg-secondary/40 text-muted-foreground cursor-not-allowed"
              )}>
              <Download className="w-5 h-5" /> Download {selectedInvoices.size > 0 ? `${selectedInvoices.size} PDFs` : "All PDFs"}
            </button>
          </div>

          {/* How It Works */}
          <div className="elevated-card rounded-2xl p-5 space-y-3">
            <h3 className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">How it works</h3>
            <ol className="space-y-2.5 text-[12px] text-muted-foreground">
              {[
                "Select month, year, and optional filters",
                "Preview matching invoices in the table",
                "Optionally select specific invoices",
                "Click download to get a ZIP file",
              ].map((step, i) => (
                <li key={i} className="flex items-start gap-2.5">
                  <span className="w-5 h-5 rounded-lg bg-primary/10 flex items-center justify-center text-[10px] font-bold text-primary shrink-0 mt-0.5">{i + 1}</span>
                  {step}
                </li>
              ))}
            </ol>
          </div>
        </div>

        {/* Invoice Preview Table */}
        <div className="lg:col-span-2">
          <div className="elevated-card rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-border/50 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Package className="w-4 h-4 text-chart-3" />
                <h2 className="text-[14px] font-display font-semibold text-foreground">Matching Invoices ({matchingInvoices.length})</h2>
              </div>
              {matchingInvoices.length > 0 && (
                <button onClick={toggleAll} className="text-[12px] text-primary hover:underline font-medium">
                  {selectedInvoices.size === matchingInvoices.length ? "Deselect All" : "Select All"}
                </button>
              )}
            </div>
            {matchingInvoices.length > 0 ? (
              <table className="table-premium">
                <thead><tr>
                  <th className="w-10"></th><th>Invoice #</th><th>Date</th><th>Customer</th><th>Amount</th><th>Type</th>
                </tr></thead>
                <tbody>
                  {matchingInvoices.map((inv, i) => (
                    <motion.tr key={inv.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}
                      className={cn(selectedInvoices.has(inv.id) && "!bg-primary/5 ")}>
                      <td>
                        <button onClick={() => toggleInvoice(inv.id)} className="text-muted-foreground hover:text-primary">
                          {selectedInvoices.has(inv.id) ? <CheckSquare className="w-4 h-4 text-primary" /> : <Square className="w-4 h-4" />}
                        </button>
                      </td>
                      <td><Link to={`/billing/invoice/${inv.id}`} className="text-primary hover:underline font-semibold text-[13px]">{inv.invoiceNumber}</Link></td>
                      <td className="text-muted-foreground text-[12px]">{formatDate(inv.date)}</td>
                      <td className="text-foreground text-[13px]">{inv.customerName}</td>
                      <td className="font-bold text-foreground">{formatCurrency(inv.total)}</td>
                      <td><span className={cn("premium-badge text-[10px]", inv.type === "OUTWARD" ? "bg-primary/12 text-primary" : "bg-destructive/12 text-destructive")}>{inv.type}</span></td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div className="p-16 text-center text-muted-foreground">
                <FileText className="w-10 h-10 mx-auto mb-3 opacity-20" />
                <p className="text-[14px] font-medium">No invoices found</p>
                <p className="text-[12px] mt-1">Try changing the month, year, or filters</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
