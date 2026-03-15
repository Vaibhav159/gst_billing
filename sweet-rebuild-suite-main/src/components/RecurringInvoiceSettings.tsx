import { useState } from "react";
import { Repeat, Calendar, AlertCircle } from "lucide-react";
import { cn } from "@/utils/utils";

export type RecurrenceFrequency = "none" | "weekly" | "monthly" | "quarterly" | "yearly";

export interface RecurrenceConfig {
  frequency: RecurrenceFrequency;
  startDate: string;
  endDate: string;
  autoSend: boolean;
}

interface RecurringInvoiceSettingsProps {
  config: RecurrenceConfig;
  onChange: (config: RecurrenceConfig) => void;
}

const frequencies: { value: RecurrenceFrequency; label: string; desc: string }[] = [
  { value: "none", label: "One-time", desc: "No recurrence" },
  { value: "weekly", label: "Weekly", desc: "Every 7 days" },
  { value: "monthly", label: "Monthly", desc: "Same date each month" },
  { value: "quarterly", label: "Quarterly", desc: "Every 3 months" },
  { value: "yearly", label: "Yearly", desc: "Once per year" },
];

export default function RecurringInvoiceSettings({ config, onChange }: RecurringInvoiceSettingsProps) {
  const set = (field: keyof RecurrenceConfig, val: any) => onChange({ ...config, [field]: val });

  return (
    <div className="elevated-card rounded-2xl p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Repeat className="w-4 h-4 text-chart-3" />
        <h2 className="text-[13px] font-display font-semibold text-foreground">Recurring Invoice</h2>
      </div>

      <div className="grid grid-cols-5 gap-1.5">
        {frequencies.map((f) => (
          <button
            key={f.value}
            type="button"
            onClick={() => set("frequency", f.value)}
            className={cn(
              "p-2.5 rounded-xl text-center transition-all border",
              config.frequency === f.value
                ? "border-primary/40 bg-primary/10 text-primary"
                : "border-border/30 bg-secondary/10 text-muted-foreground hover:border-primary/20"
            )}
          >
            <p className="text-[11px] font-semibold">{f.label}</p>
            <p className="text-[9px] mt-0.5 opacity-70">{f.desc}</p>
          </button>
        ))}
      </div>

      {config.frequency !== "none" && (
        <>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-foreground uppercase tracking-wider flex items-center gap-1">
                <Calendar className="w-3 h-3 text-muted-foreground" /> Start Date
              </label>
              <input
                type="date"
                value={config.startDate}
                onChange={(e) => set("startDate", e.target.value)}
                className="premium-input"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[11px] font-semibold text-foreground uppercase tracking-wider flex items-center gap-1">
                <Calendar className="w-3 h-3 text-muted-foreground" /> End Date
              </label>
              <input
                type="date"
                value={config.endDate}
                onChange={(e) => set("endDate", e.target.value)}
                className="premium-input"
              />
            </div>
          </div>

          <label className="flex items-center gap-3 p-3 rounded-xl bg-secondary/20 cursor-pointer">
            <input
              type="checkbox"
              checked={config.autoSend}
              onChange={(e) => set("autoSend", e.target.checked)}
              className="accent-primary w-4 h-4"
            />
            <div>
              <p className="text-[12px] font-semibold text-foreground">Auto-generate invoices</p>
              <p className="text-[10px] text-muted-foreground">Automatically create invoices on schedule</p>
            </div>
          </label>

          <div className="flex items-start gap-2 text-[11px] text-chart-3 bg-chart-3/5 rounded-lg p-3">
            <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>Recurring invoices will be generated based on this template. You can edit or cancel anytime.</span>
          </div>
        </>
      )}
    </div>
  );
}

