import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import Breadcrumbs from "@/components/Breadcrumbs";
import { Settings as SettingsIcon, Save, Building2, Calendar, FileText, Calculator, Keyboard, Sparkles, RotateCcw, Database, Download, Trash2, HardDrive, Info, AlertTriangle, Check } from "lucide-react";
import { financialYears } from "@/utils/mockData";
import { useBusinesses } from "@/hooks/useDataStore";
import api from "@/utils/api";
import { useToast } from "@/hooks/use-toast";
import { motion } from "framer-motion";
import { cn } from "@/utils/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { useMobileMode } from "@/contexts/MobileModeContext";
import { Switch } from "@/components/ui/switch";
import { resetOnboarding } from "@/components/OnboardingWizard";
// Invoice template removed — Tally format is the standard

const SETTINGS_STORAGE_KEY = "gst_app_settings";

function getCurrentFinancialYear(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-indexed, so March = 2
  // Indian FY runs Apr–Mar: if month >= March (index 3), FY starts this year
  const startYear = month >= 3 ? year : year - 1;
  const endYear = startYear + 1;
  return `${startYear}-${String(endYear).slice(-2)}`;
}

function loadSettings(fallbackBusinessId: string) {
  const defaults = {
    defaultBusinessId: fallbackBusinessId,
    defaultFinancialYear: getCurrentFinancialYear(),
    invoicePrefix: "SGJ",
    invoiceStartNumber: 108,
    defaultGstRate: 3,
    currency: "INR",
    autoDetectIGST: true,
    showHSN: true,
    amountInWords: true,
  };
  try {
    const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (stored) {
      return { ...defaults, ...JSON.parse(stored) };
    }
  } catch {
    // ignore corrupt data
  }
  return defaults;
}

export default function Settings() {
  const { toast } = useToast();
  const isMobile = useIsMobile();
  const { mobileMode, setMobileMode } = useMobileMode();
  const { items: businesses } = useBusinesses();
  const [settings, setSettings] = useState(() => loadSettings(businesses[0]?.id || ""));
  const [nextInvoiceInfo, setNextInvoiceInfo] = useState<string>("");
  // `dirty` tracks whether any field has changed since the last save.
  // Drives the save bar's enabled state + label, so the sticky button isn't
  // a phantom CTA when nothing's pending.
  const [dirty, setDirty] = useState(false);

  // useState initializer runs before businesses load (async fetch), so
  // defaultBusinessId starts empty and stays empty even after the dropdown
  // visually shows the first business. Sync state once businesses arrive.
  useEffect(() => {
    if (!settings.defaultBusinessId && businesses.length > 0) {
      setSettings((p) => ({ ...p, defaultBusinessId: String(businesses[0].id) }));
    }
  }, [businesses, settings.defaultBusinessId]);

  // Fetch real next invoice number when business changes
  useEffect(() => {
    if (!settings.defaultBusinessId) return;
    api.get(`invoices/next_invoice_number/?business_id=${settings.defaultBusinessId}&type_of_invoice=outward`)
      .then(res => {
        const next = res.data?.next_invoice_number || "";
        setNextInvoiceInfo(next);
        // Extract prefix and number from format like "SGJ/2026-27/1" or plain "125"
        const match = next.match(/^([A-Za-z]+\/)\d{4}-\d{2}\/(\d+)$/);
        if (match) {
          setSettings(p => ({ ...p, invoicePrefix: match[1].replace("/", ""), invoiceStartNumber: parseInt(match[2]) }));
        } else {
          const num = parseInt(next);
          if (!isNaN(num)) setSettings(p => ({ ...p, invoicePrefix: "", invoiceStartNumber: num }));
        }
      })
      .catch(() => {});
  }, [settings.defaultBusinessId]);

  const set = (field: string, val: any) => {
    setSettings((p) => ({ ...p, [field]: val }));
    setDirty(true);
  };
  const handleSave = () => {
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // storage full or unavailable
    }
    setDirty(false);
    toast({ title: "Settings Saved", description: "Your preferences have been updated." });
  };

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
          <div className="space-y-1.5"><label className="text-[11px] font-semibold text-foreground uppercase tracking-wider">Next Invoice Number</label><div className="premium-input bg-secondary/20 cursor-default flex items-center">{nextInvoiceInfo || "Select a business above"}</div><p className="text-[10px] text-muted-foreground">Invoice prefix is set per business (edit business to change)</p></div>
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
      // Collapsed by default — this is reference info, not a setting.
      // Saves ~150px of vertical space on the typical render.
      fields: (
        <details className="group">
          <summary className="flex items-center justify-between cursor-pointer list-none [&::-webkit-details-marker]:hidden text-[12px] text-muted-foreground hover:text-foreground transition-colors">
            <span>Show 7 shortcuts</span>
            <span className="text-[10px] group-open:rotate-90 transition-transform">›</span>
          </summary>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
            {[{ keys: "N", desc: "New Invoice" }, { keys: "D", desc: "Dashboard" }, { keys: "C", desc: "Customers" }, { keys: "I", desc: "Invoices" }, { keys: "P", desc: "Products" }, { keys: "⌘S", desc: "Save form" }, { keys: "Esc", desc: "Close modal" }].map((s) => (
              <div key={s.keys} className="flex items-center justify-between p-2.5 rounded-lg bg-secondary/20">
                <span className="text-[12px] text-muted-foreground">{s.desc}</span>
                <kbd className="px-2 py-0.5 rounded bg-secondary/50 border border-border/50 text-[11px] font-mono font-bold text-foreground">{s.keys}</kbd>
              </div>
            ))}
          </div>
        </details>
      ),
    }] : []),
    // Invoice template removed — using Tally Classic format
    // Data Management + Setup folded into one card — the "Setup" card had
    // a single row, and the actions are cousins anyway. Destructive action
    // ("Clear Local Settings") lives in its own dedicated Danger Zone
    // card below so a misclick is less likely.
    {
      title: "Data Management", icon: Database,
      fields: (
        <div className="space-y-3">
          <div className="flex items-center justify-between p-3 rounded-xl bg-secondary/20">
            <div>
              <p className="text-[13px] font-semibold text-foreground">Export Settings</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Download a JSON snapshot of your preferences</p>
            </div>
            <button onClick={() => {
              const data = { settings, exportedAt: new Date().toISOString() };
              const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a"); a.href = url; a.download = `gst-app-settings-export-${new Date().toISOString().split("T")[0]}.json`; a.click();
              URL.revokeObjectURL(url);
              toast({ title: "Settings Exported", description: "Settings backup downloaded." });
            }}
              className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors flex items-center gap-1.5">
              <Download className="w-3.5 h-3.5" /> Export
            </button>
          </div>
          <div className="flex items-center justify-between p-3 rounded-xl bg-secondary/20">
            <div>
              <p className="text-[13px] font-semibold text-foreground">Backup & Restore</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Full database backup (invoices, customers, products)</p>
            </div>
            <Link to="/billing/backup"
              className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-chart-3/10 text-chart-3 hover:bg-chart-3/20 transition-colors flex items-center gap-1.5">
              <HardDrive className="w-3.5 h-3.5" /> Open
            </Link>
          </div>
          <div className="flex items-center justify-between p-3 rounded-xl bg-secondary/20">
            <div>
              <p className="text-[13px] font-semibold text-foreground">Onboarding Wizard</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">Re-run the getting-started flow</p>
            </div>
            <button onClick={() => { resetOnboarding(); toast({ title: "Onboarding Reset", description: "Visit Dashboard to see the wizard." }); }}
              className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-primary/10 text-primary hover:bg-primary/20 transition-colors flex items-center gap-1.5">
              <RotateCcw className="w-3.5 h-3.5" /> Reset
            </button>
          </div>
        </div>
      ),
    },
    {
      title: "Danger Zone", icon: AlertTriangle,
      danger: true,
      fields: (
        <div className="flex items-center justify-between p-3 rounded-xl bg-destructive/5 border border-destructive/15">
          <div>
            <p className="text-[13px] font-semibold text-foreground">Clear Local Settings</p>
            <p className="text-[11px] text-muted-foreground mt-0.5">Reset all preferences to defaults. Doesn't delete server data — just your local browser config.</p>
          </div>
          <button onClick={() => {
            if (!confirm("Clear all local settings and reset to defaults? This affects only your browser, not server data.")) return;
            localStorage.removeItem(SETTINGS_STORAGE_KEY);
            setSettings(loadSettings(businesses[0]?.id || ""));
            setDirty(false);
            toast({ title: "Settings Cleared", description: "Preferences reset to defaults.", variant: "destructive" });
          }}
            className="px-3 py-1.5 rounded-lg text-[12px] font-medium bg-destructive/10 text-destructive hover:bg-destructive/20 transition-colors flex items-center gap-1.5 shrink-0">
            <Trash2 className="w-3.5 h-3.5" /> Clear
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className={cn("space-y-5 animate-fade-in max-w-4xl mx-auto", isMobile ? "p-4 pb-28" : "p-6 lg:p-8 space-y-6")}>
      <Breadcrumbs items={[{ label: "Settings" }]} />
      <div className="flex items-center gap-3 flex-wrap">
        <div className={cn("rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center", isMobile ? "w-10 h-10" : "w-12 h-12")}><SettingsIcon className="w-5 h-5 text-primary" /></div>
        <div className="flex-1 min-w-0">
          <h1 className={cn("font-display font-bold text-foreground tracking-tight", isMobile ? "text-xl" : "text-3xl")}>Settings</h1>
          <p className="text-xs text-muted-foreground mt-0.5">App preferences and defaults · saved locally to your browser</p>
        </div>
        {/* Unsaved-changes indicator — gives the user a peripheral signal so
            they don't navigate away mid-edit and lose the change. */}
        {dirty && !isMobile && (
          <span className="text-[11px] font-semibold text-warning bg-warning/10 px-2.5 py-1 rounded-full">
            Unsaved changes
          </span>
        )}
      </div>
      <div className="space-y-4">
        {sections.map((section, i) => {
          const Icon = section.icon;
          const danger = (section as any).danger;
          return (
            <motion.div key={section.title} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}
              className={cn("elevated-card rounded-2xl p-5 space-y-4", danger && "border-destructive/30")}>
              <div className="flex items-center gap-2">
                <Icon className={cn("w-4 h-4", danger ? "text-destructive" : "text-primary")} />
                <h2 className={cn("text-[13px] font-display font-semibold", danger ? "text-destructive" : "text-foreground")}>{section.title}</h2>
              </div>
              {section.fields}
            </motion.div>
          );
        })}
      </div>
      {/* Sticky save bar — disabled when nothing's pending. Label flips to
          "All changes saved" so the bar is informative even at rest. */}
      <div className={cn(
        "sticky bottom-0 z-30 -mx-4 px-4 py-3 bg-card/95 backdrop-blur-md border-t border-border/50",
        isMobile ? "-mx-4 px-4" : "-mx-6 lg:-mx-8 px-6 lg:px-8"
      )}>
        <div className={cn("flex items-center gap-3 max-w-4xl mx-auto", isMobile ? "justify-between" : "justify-end")}>
          {!dirty && (
            <span className="text-[11px] text-muted-foreground flex items-center gap-1.5">
              <Check className="w-3.5 h-3.5 text-success" /> All changes saved
            </span>
          )}
          <button onClick={handleSave} disabled={!dirty} className={cn("premium-btn-primary text-[13px] disabled:opacity-40 disabled:cursor-not-allowed", isMobile && "flex-1")}>
            <Save className="w-4 h-4" /> {dirty ? "Save Settings" : "Saved"}
          </button>
        </div>
      </div>
    </div>
  );
}
