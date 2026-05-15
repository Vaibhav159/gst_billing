import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, FileX, Hash, Files, ArrowRight, X } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import api from "@/utils/api";
import { logger } from "@/utils/logger";
import { cn } from "@/utils/utils";

interface DataQuality {
  invoices_no_line_items: number;
  line_items_missing_hsn: number;
  duplicate_invoice_groups: number;
  has_issues: boolean;
}

/**
 * Surface data-hygiene issues that will bite at filing time, on the
 * Dashboard, with one-click drill-downs. Dismissible per-session via the
 * `gst_dq_dismissed_until` localStorage key (24-hour cooldown) so a user
 * who's already chasing the issues doesn't see the banner on every page
 * navigation.
 */
export default function DataQualityBanner() {
  const [data, setData] = useState<DataQuality | null>(null);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    // Respect the 24-hour dismissal cooldown.
    const until = parseInt(localStorage.getItem("gst_dq_dismissed_until") || "0", 10);
    if (until && Date.now() < until) {
      setHidden(true);
      return;
    }
    if (!localStorage.getItem("gst_access_token")) return;
    api.get<DataQuality>("invoices/data_quality/")
      .then((res) => setData(res.data))
      .catch((e) => logger.warn("data_quality scan failed", e));
  }, []);

  const dismiss = () => {
    // 24h cooldown — the user has acknowledged; come back tomorrow.
    localStorage.setItem("gst_dq_dismissed_until", String(Date.now() + 24 * 60 * 60 * 1000));
    setHidden(true);
  };

  if (!data || !data.has_issues || hidden) return null;

  const items: { icon: any; label: string; value: number; href: string; tone: string }[] = [];
  if (data.duplicate_invoice_groups > 0) {
    items.push({
      icon: Files,
      label: data.duplicate_invoice_groups === 1 ? "duplicate invoice number" : "duplicate invoice numbers",
      value: data.duplicate_invoice_groups,
      href: "/billing/invoice/list?dups=1",
      tone: "text-destructive",
    });
  }
  if (data.invoices_no_line_items > 0) {
    items.push({
      icon: FileX,
      label: data.invoices_no_line_items === 1 ? "empty-item invoice" : "empty-item invoices",
      value: data.invoices_no_line_items,
      href: "/billing/invoice/list?empty=1",
      tone: "text-warning",
    });
  }
  if (data.line_items_missing_hsn > 0) {
    items.push({
      icon: Hash,
      label: data.line_items_missing_hsn === 1 ? "line item missing HSN" : "line items missing HSN",
      value: data.line_items_missing_hsn,
      href: "/billing/invoice/list?no_hsn=1",
      tone: "text-warning",
    });
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        className="elevated-card rounded-2xl p-4 border-l-4 border-l-warning relative"
      >
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-foreground">Filing-blocking data hygiene issues</p>
            <p className="text-[12px] text-muted-foreground mt-0.5 mb-3">
              These will bite when you try to file GSTR-1 / GSTR-3B. Click to drill into each.
            </p>
            <div className="flex flex-wrap gap-2">
              {items.map((it) => {
                const Icon = it.icon;
                return (
                  <Link
                    key={it.label}
                    to={it.href}
                    className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-secondary/30 border border-border/40 hover:bg-secondary/50 transition-colors group"
                  >
                    <Icon className={cn("w-3.5 h-3.5", it.tone)} />
                    <span className={cn("text-[12px] font-semibold tabular-nums", it.tone)}>{it.value}</span>
                    <span className="text-[12px] text-muted-foreground">{it.label}</span>
                    <ArrowRight className="w-3 h-3 text-muted-foreground/60 group-hover:text-foreground transition-colors" />
                  </Link>
                );
              })}
            </div>
          </div>
          <button
            onClick={dismiss}
            aria-label="Dismiss for 24 hours"
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/40 transition-colors shrink-0"
            title="Dismiss for 24 hours"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
