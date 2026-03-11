import { AnimatePresence, motion } from "framer-motion";
import { X, SlidersHorizontal } from "lucide-react";

interface FilterOption {
  label: string;
  value: string;
  options: { label: string; value: string }[];
  onChange: (value: string) => void;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  filters: FilterOption[];
  onClear: () => void;
  title?: string;
}

export default function MobileFilterSheet({ open, onOpenChange, filters, onClear, title = "Filters" }: Props) {
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm"
            onClick={() => onOpenChange(false)}
          />
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 350 }}
            className="fixed bottom-0 left-0 right-0 z-[61] elevated-card rounded-t-2xl max-h-[70vh] overflow-y-auto safe-area-bottom"
          >
            {/* Handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
            </div>

            <div className="flex items-center justify-between px-5 py-3 border-b border-border/30">
              <div className="flex items-center gap-2">
                <SlidersHorizontal className="w-4 h-4 text-primary" />
                <h2 className="text-base font-display font-semibold text-foreground">{title}</h2>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={onClear} className="text-[12px] text-destructive font-medium">Clear All</button>
                <button onClick={() => onOpenChange(false)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            <div className="p-5 space-y-5">
              {filters.map((filter) => (
                <div key={filter.label} className="space-y-2">
                  <label className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">{filter.label}</label>
                  <select
                    value={filter.value}
                    onChange={(e) => filter.onChange(e.target.value)}
                    className="premium-select w-full h-12 text-[14px]"
                  >
                    {filter.options.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            <div className="p-5 pt-0">
              <button
                onClick={() => onOpenChange(false)}
                className="premium-btn-primary w-full h-12 text-[14px]"
              >
                Apply Filters
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
