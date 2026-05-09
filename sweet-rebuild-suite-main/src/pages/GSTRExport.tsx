import { logger } from "@/utils/logger";
import { useState, useEffect, useCallback } from "react";
import { useOutletContext } from "react-router-dom";
import { Download, FileJson, FileSpreadsheet, Loader2, BarChart3, CheckCircle2, AlertTriangle } from "lucide-react";
import Breadcrumbs from "@/components/Breadcrumbs";
import { formatCurrency, financialYears } from "@/utils/mockData";
import { useBusinesses } from "@/hooks/useDataStore";
import { useToast } from "@/hooks/use-toast";
import { cn, pluralize } from "@/utils/utils";
import { motion } from "framer-motion";
import api from "@/utils/api";

interface OutletCtx { selectedFY: string }

const MONTHS = ["April","May","June","July","August","September","October","November","December","January","February","March"];

export default function GSTRExport() {
  const { selectedFY } = useOutletContext<OutletCtx>();
  const { toast } = useToast();
  const { items: businesses } = useBusinesses();
  const [bizFilter, setBizFilter] = useState("all");
  const [period, setPeriod] = useState("full"); // "full" or month name
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<"gstr1" | "gstr3b" | "gstr2b">("gstr1");

  const fyStart = parseInt(selectedFY.split("-")[0]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (period === "full") {
        params.set("start_date", `${fyStart}-04-01`);
        params.set("end_date", `${fyStart + 1}-03-31`);
      } else {
        const idx = MONTHS.indexOf(period);
        const y = idx < 9 ? fyStart : fyStart + 1;
        const m = idx < 9 ? idx + 4 : idx - 8;
        const lastDay = new Date(y, m, 0).getDate();
        params.set("start_date", `${y}-${String(m).padStart(2, "0")}-01`);
        params.set("end_date", `${y}-${String(m).padStart(2, "0")}-${lastDay}`);
      }
      if (bizFilter !== "all") params.set("business_id", bizFilter);

      const res = await api.get(`invoices/gstr_export/?${params.toString()}`);
      setData(res.data);
    } catch (e) {
      logger.error("Failed to fetch GSTR data", e);
      toast({ title: "Failed", description: "Could not fetch GSTR data", variant: "destructive" });
    }
    setLoading(false);
  }, [selectedFY, bizFilter, period, fyStart]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleDownloadJSON = (section: string) => {
    if (!data) return;
    const exportData = section === "gstr1" ? data.gstr1 : section === "gstr3b" ? data.gstr3b : data.gstr2b;
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `${section.toUpperCase()}_${period === "full" ? selectedFY : period}_${selectedFY}.json`; a.click();
    URL.revokeObjectURL(url);
    toast({ title: "Downloaded", description: `${section.toUpperCase()} JSON exported` });
  };

  const gstr1 = data?.gstr1;
  const gstr3b = data?.gstr3b;
  const gstr2b = data?.gstr2b;

  return (
    <div className="space-y-5 p-6 lg:p-8 max-w-[1440px] mx-auto">
      <Breadcrumbs items={[{ label: "Reports", href: "/billing/reports" }, { label: "GSTR Filing Export" }]} />

      <div className="flex items-center gap-3">
        <div className="w-12 h-12 rounded-2xl bg-chart-1/10 border border-chart-1/20 flex items-center justify-center">
          <BarChart3 className="w-5 h-5 text-chart-1" />
        </div>
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground tracking-tight">GSTR Filing Export</h1>
          <p className="text-sm text-muted-foreground">Export data in GST portal JSON format for filing</p>
        </div>
      </div>

      {/* Filters */}
      <div className="elevated-card rounded-2xl p-4 flex items-center gap-3 flex-wrap">
        <select value={bizFilter} onChange={(e) => setBizFilter(e.target.value)} className="premium-select text-[13px]">
          <option value="all">All Businesses</option>
          {businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <select value={period} onChange={(e) => setPeriod(e.target.value)} className="premium-select text-[13px]">
          <option value="full">Full Year (FY {selectedFY})</option>
          {MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <span className="text-[11px] text-muted-foreground ml-auto">FY {selectedFY}</span>
      </div>

      {/* Tabs */}
      <div className="elevated-card rounded-2xl overflow-hidden">
        <div className="flex border-b border-border/50">
          {(["gstr1", "gstr3b", "gstr2b"] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={cn("px-5 py-3 text-[12px] font-semibold border-b-2 -mb-px transition-all",
                activeTab === tab ? "border-primary text-primary" : "border-transparent text-muted-foreground")}>
              {tab === "gstr1" ? "GSTR-1 (Outward)" : tab === "gstr3b" ? "GSTR-3B (Tax)" : "GSTR-2B (Inward Matching)"}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="p-16 text-center"><Loader2 className="w-6 h-6 animate-spin mx-auto text-muted-foreground" /></div>
        ) : (
          <div className="p-5">
            {/* GSTR-1 */}
            {activeTab === "gstr1" && gstr1 && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-[14px] font-semibold">GSTR-1 — Outward Supplies</h3>
                  <button onClick={() => handleDownloadJSON("gstr1")} className="premium-btn-primary text-[12px] h-9">
                    <FileJson className="w-3.5 h-3.5" /> Download JSON
                  </button>
                </div>

                {/* B2B Summary */}
                <div className="space-y-2">
                  <h4 className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">B2B — Registered Dealers ({pluralize(gstr1.b2b?.length || 0, "party", "parties")})</h4>
                  {(gstr1.b2b || []).length > 0 ? (
                    <div className="overflow-x-auto"><table className="table-premium text-[12px] min-w-[480px]">
                      <thead><tr><th>GSTIN</th><th className="text-right">Invoices</th><th className="text-right">Total Value</th></tr></thead>
                      <tbody>
                        {gstr1.b2b.map((party: any) => (
                          <tr key={party.ctin}>
                            <td className="font-mono">{party.ctin}</td>
                            <td className="text-right">{party.inv.length}</td>
                            <td className="text-right font-semibold">{formatCurrency(party.inv.reduce((s: number, i: any) => s + i.val, 0))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table></div>
                  ) : <p className="text-[12px] text-muted-foreground">No B2B invoices</p>}
                </div>

                {/* B2CS Summary */}
                <div className="space-y-2">
                  <h4 className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">B2CS — Unregistered Intra-State ({pluralize(gstr1.b2cs?.length || 0, "entry", "entries")})</h4>
                  {(gstr1.b2cs || []).length > 0 ? (
                    <div className="overflow-x-auto"><table className="table-premium text-[12px] min-w-[480px]">
                      <thead><tr><th>State</th><th>Rate</th><th className="text-right">Taxable</th><th className="text-right">CGST</th><th className="text-right">SGST</th></tr></thead>
                      <tbody>
                        {gstr1.b2cs.map((row: any, i: number) => (
                          <tr key={i}><td>{row.pos}</td><td>{row.rt}%</td><td className="text-right">{formatCurrency(row.txval)}</td><td className="text-right">{formatCurrency(row.camt)}</td><td className="text-right">{formatCurrency(row.samt)}</td></tr>
                        ))}
                      </tbody>
                    </table></div>
                  ) : <p className="text-[12px] text-muted-foreground">No B2CS invoices</p>}
                </div>

                {/* HSN */}
                <div className="space-y-2">
                  <h4 className="text-[12px] font-semibold text-muted-foreground uppercase tracking-wider">HSN Summary ({pluralize(gstr1.hsn?.data?.length || 0, "code")})</h4>
                  {(gstr1.hsn?.data || []).length > 0 ? (
                    <div className="overflow-x-auto"><table className="table-premium text-[12px] min-w-[480px]">
                      <thead><tr><th>HSN</th><th className="text-right">Qty</th><th className="text-right">Taxable</th><th className="text-right">CGST</th><th className="text-right">SGST</th><th className="text-right">IGST</th></tr></thead>
                      <tbody>
                        {gstr1.hsn.data.map((h: any) => (
                          <tr key={h.hsn_sc}><td className="font-mono">{h.hsn_sc}</td><td className="text-right">{h.qty.toFixed(3)}</td><td className="text-right">{formatCurrency(h.txval)}</td><td className="text-right">{formatCurrency(h.camt)}</td><td className="text-right">{formatCurrency(h.samt)}</td><td className="text-right">{formatCurrency(h.iamt)}</td></tr>
                        ))}
                      </tbody>
                    </table></div>
                  ) : <p className="text-[12px] text-muted-foreground">No HSN data</p>}
                </div>
              </div>
            )}

            {/* GSTR-3B */}
            {activeTab === "gstr3b" && gstr3b && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-[14px] font-semibold">GSTR-3B — Tax Summary</h3>
                  <button onClick={() => handleDownloadJSON("gstr3b")} className="premium-btn-primary text-[12px] h-9">
                    <FileJson className="w-3.5 h-3.5" /> Download JSON
                  </button>
                </div>
                <div className="overflow-x-auto"><table className="table-premium text-[13px] min-w-[420px]">
                  <thead><tr><th></th><th className="text-right">CGST</th><th className="text-right">SGST</th><th className="text-right">IGST</th></tr></thead>
                  <tbody>
                    <tr>
                      <td className="font-medium">3.1 — Outward Supplies</td>
                      <td className="text-right">{formatCurrency(gstr3b.sup_details?.osup_det?.camt || 0)}</td>
                      <td className="text-right">{formatCurrency(gstr3b.sup_details?.osup_det?.samt || 0)}</td>
                      <td className="text-right">{formatCurrency(gstr3b.sup_details?.osup_det?.iamt || 0)}</td>
                    </tr>
                    <tr>
                      <td className="font-medium text-success">4 — Eligible ITC</td>
                      <td className="text-right text-success">{formatCurrency(gstr3b.itc_elg?.itc_avl?.[0]?.camt || 0)}</td>
                      <td className="text-right text-success">{formatCurrency(gstr3b.itc_elg?.itc_avl?.[0]?.samt || 0)}</td>
                      <td className="text-right text-success">{formatCurrency(gstr3b.itc_elg?.itc_avl?.[0]?.iamt || 0)}</td>
                    </tr>
                    <tr className="border-t-2 border-border font-bold">
                      <td>6.1 — Net Tax Payable</td>
                      <td className={cn("text-right", (gstr3b.tax_pmt?.cgst || 0) >= 0 ? "text-destructive" : "text-success")}>{formatCurrency(Math.abs(gstr3b.tax_pmt?.cgst || 0))}</td>
                      <td className={cn("text-right", (gstr3b.tax_pmt?.sgst || 0) >= 0 ? "text-destructive" : "text-success")}>{formatCurrency(Math.abs(gstr3b.tax_pmt?.sgst || 0))}</td>
                      <td className={cn("text-right", (gstr3b.tax_pmt?.igst || 0) >= 0 ? "text-destructive" : "text-success")}>{formatCurrency(Math.abs(gstr3b.tax_pmt?.igst || 0))}</td>
                    </tr>
                  </tbody>
                </table></div>
              </div>
            )}

            {/* GSTR-2B */}
            {activeTab === "gstr2b" && gstr2b && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-[14px] font-semibold">GSTR-2B — Inward Supply Matching</h3>
                  <button onClick={() => handleDownloadJSON("gstr2b")} className="premium-btn-primary text-[12px] h-9">
                    <FileJson className="w-3.5 h-3.5" /> Download JSON
                  </button>
                </div>
                <p className="text-[12px] text-muted-foreground">{gstr2b.inward_invoices?.length || 0} inward invoices for matching</p>
                {(gstr2b.inward_invoices || []).length > 0 ? (
                  <div className="overflow-x-auto"><table className="table-premium text-[12px] min-w-[640px]">
                    <thead><tr><th>Invoice #</th><th>Date</th><th>Supplier</th><th>GSTIN</th><th className="text-right">Taxable</th><th className="text-right">Tax</th><th className="text-right">Total</th></tr></thead>
                    <tbody>
                      {gstr2b.inward_invoices.map((inv: any, i: number) => (
                        <tr key={i}>
                          <td className="font-medium">{inv.invoice_number}</td>
                          <td>{inv.invoice_date}</td>
                          <td>{inv.supplier_name}</td>
                          <td className="font-mono text-[10px]">{inv.supplier_gstin || "-"}</td>
                          <td className="text-right">{formatCurrency(inv.taxable_value)}</td>
                          <td className="text-right">{formatCurrency(inv.tax_amount)}</td>
                          <td className="text-right font-semibold">{formatCurrency(inv.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table></div>
                ) : <p className="text-[12px] text-muted-foreground">No inward invoices</p>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
