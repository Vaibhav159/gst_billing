import { useState } from "react";
import Breadcrumbs from "@/components/Breadcrumbs";
import { Settings as SettingsIcon, Save, Building2, Calendar, FileText, Calculator, Keyboard, Sparkles } from "lucide-react";
import { financialYears } from "@/lib/mockData";
import { useBusinesses } from "@/hooks/useDataStore";
import { useToast } from "@/hooks/use-toast";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { useMobileMode } from "@/contexts/MobileModeContext";
import { Switch } from "@/components/ui/switch";

export default function Settings() {
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const { mobileMode, setMobileMode } = useMobileMode();
  const { items: businesses } = useBusinesses();
  const [settings, setSettings] = useState({
    defaultBusinessId:[0]?.id || "",
    defaultFinancialYear: "2024-25",
    invoicePrefix: "SGJ",
    invoiceStartNumber: 108,
    defaultGstRate: 3,
    currency: "INR",
    autoDetectIGST: true,
    showHSN: true,
    amountInWords: true,
  });

  const set = (field: string, val: any) => setSettings((p) => ({ ...p, [field]: val }));
  const handleSave = () => { toast({ title: "Settings Saved", description: "Your preferences have been updated." }); };

  const sections = [
    ...(isMobile ? [{
      title: "Mobile Mode", icon: Sparkles,
      fields: (
        <div className="flex items-center justify-between p-4 rounded-xl bg-secondary/20">
          <div>
            <p className="text-[13px] font-semibold text-foreground">{mobileMode === "easy" ? "Easy Mode" : "Expert Mode"}</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {mobileMode === "easy" ? "Simplified daily workflow" : "Full features & reports"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">Easy</span>
            <Switch
              checked={mobileMode === "expert"}
              onCheckedChange={(checked) => setMobileMode(checked ? "expert" : "easy")}
            />
            <span className="text-[11px] text-muted-foreground">Expert</span>
          </div>
        </div>
      ),
    }] : []),
    {
      title: "Business Defaults", icon: Building2,
      fields: (
        <div className={cn("grid gap-4", isMobile ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2")}>
          <div className="space-y-1.5"><label className="text-[11px] font-semibold text-foreground uppercase tracking-wider">Default Business</label><select value={settings.defaultBusinessId} onChange={(e) => set("defaultBusinessId", e.target.value)} className="premium-select w-full">{businesses.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
          <div className="space-y-1.5"><label className="text-[11px] font-semibold text-foreground uppercase tracking-wider">Financial Year</label><select value={settings.defaultFinancialYear} onChange={(e) => set("defaultFinancialYear", e.target.value)} className="premium-select w-full">{financialYears.map((fy) => <option key={fy} value={fy}>FY {fy}</option>)}</select></div>
        </div>
      ),
    },
    {
      title: "Invoice Config", icon: FileText,
      fields: (
        <div className={cn("grid gap-4", isMobile ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2")}>
          <div className="space-y-1.5"><label className="text-[11px] font-semibold text-foreground uppercase tracking-wider">Invoice Prefix</label><input type="text" value={settings.invoicePrefix} onChange={(e) => set("invoicePrefix", e.target.value.toUpperCase())} className="premium-input font-mono uppercase" /><p className="text-[10px] text-muted-foreground">Preview: {settings.invoicePrefix}/{settings.defaultFinancialYear}/{settings.invoiceStartNumber}</p></div>
          <div className="space-y-1.5"><label className="text-[11px] font-semibold text-foreground uppercase tracking-wider">Next Number</label><input type="number" value={settings.invoiceStartNumber} onChange={(e) => set("invoiceStartNumber", Number(e.target.value))} className="premium-input" min={1} /></div>
          <div className="space-y-1.5"><label className="text-[11px] font-semibold text-foreground uppercase tracking-wider">Currency</label><select value={settings.currency} onChange={(e) => set("currency", e.target.value)} className="premium-select w-full"><option value="INR">₹ INR</option><option value="USD">$ USD</option></select></div>
        </div>
      ),
    },
    {
      title: "Tax Config", icon: Calculator,
      fields: (
        <div className={cn("grid gap-4", isMobile ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2")}>
          <div className="space-y-1.5"><label className="text-[11px] font-semibold text-foreground uppercase tracking-wider">Default GST</label><select value={settings.defaultGstRate} onChange={(e) => set("defaultGstRate", Number(e.target.value))} className="premium-select w-full">{[0, 3, 5, 12, 18, 28].map((r) => <option key={r} value={r}>{r}%</option>)}</select></div>
          <div className="space-y-3 pt-1">
            <label className="flex items-center gap-3 cursor-pointer"><input type="checkbox" checked={settings.autoDetectIGST} onChange={(e) => set("autoDetectIGST", e.target.checked)} className="accent-primary w-4 h-4" /><span className="text-[13px] text-foreground">Auto-detect IGST</span></label>
            <label className="flex items-center gap-3 cursor-pointer"><input type="checkbox" checked={settings.showHSN} onChange={(e) => set("showHSN", e.target.checked)} className="accent-primary w-4 h-4" /><span className="text-[13px] text-foreground">Show HSN codes</span></label>
            <label className="flex items-center gap-3 cursor-pointer"><input type="checkbox" checked={settings.amountInWords} onChange={(e) => set("amountInWords", e.target.checked)} className="accent-primary w-4 h-4" /><span className="text-[13px] text-foreground">Amount in words</span></label>
          </div>
        </div>
      ),
    },
    ...(!isMobile ? [{
      title: "Keyboard Shortcuts", icon: Keyboard,
      fields: (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[{ keys: "N", desc: "New Invoice" }, { keys: "D", desc: "Dashboard" }, { keys: "C", desc: "Customers" }, { keys: "I", desc: "Invoices" }, { keys: "P", desc: "Products" }, { keys: "⌘S", desc: "Save form" }, { keys: "Esc", desc: "Close modal" }].map((s) => (
            <div key={s.keys} className="flex items-center justify-between p-3 rounded-xl bg-secondary/20">
              <span className="text-[13px] text-muted-foreground">{s.desc}</span>
              <kbd className="px-2.5 py-1 rounded-lg bg-secondary/50 border border-border/50 text-[11px] font-mono font-bold text-foreground">{s.keys}</kbd>
            </div>
          ))}
        </div>
      ),
    }] : []),
  ];

  return (
    <div className={cn("space-y-5 animate-fade-in max-w-4xl mx-auto", isMobile ? "p-4 pb-20" : "p-6 lg:p-8 space-y-6")}>
      <Breadcrumbs items={[{ label: "Settings" }]} />
      <div className="flex items-center gap-3">
        <div className={cn("rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center", isMobile ? "w-10 h-10" : "w-12 h-12")}><SettingsIcon className="w-5 h-5 text-primary" /></div>
        <div><h1 className={cn("font-display font-bold text-foreground tracking-tight", isMobile ? "text-xl" : "text-3xl")}>Settings</h1></div>
      </div>
      <div className="space-y-4">
        {sections.map((section, i) => {
          const Icon = section.icon;
          return (
            <motion.div key={section.title} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }} className="elevated-card rounded-2xl p-5 space-y-4">
              <div className="flex items-center gap-2"><Icon className="w-4 h-4 text-primary" /><h2 className="text-[13px] font-display font-semibold text-foreground">{section.title}</h2></div>
              {section.fields}
            </motion.div>
          );
        })}
      </div>
      <div className={cn("flex", isMobile ? "justify-center" : "justify-end")}>
        <button onClick={handleSave} className={cn("premium-btn-primary text-[13px]", isMobile && "w-full")}><Save className="w-4 h-4" /> Save Settings</button>
      </div>
    </div>
  );
}
