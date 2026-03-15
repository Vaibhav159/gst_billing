import { motion, AnimatePresence } from "framer-motion";
import { X, Download, Trash2, Tag } from "lucide-react";
import { cn } from "@/utils/utils";

interface BulkActionBarProps {
  selectedCount: number;
  totalCount: number;
  onSelectAll: () => void;
  onClear: () => void;
  onExport: () => void;
  onDelete: () => void;
  entityName: string;
  extraActions?: { label: string; icon: React.ElementType; onClick: () => void; variant?: "default" | "destructive" }[];
}

export default function BulkActionBar({
  selectedCount, totalCount, onSelectAll, onClear, onExport, onDelete, entityName, extraActions
}: BulkActionBarProps) {
  return (
    <AnimatePresence>
      {selectedCount > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 40 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-5 py-3 rounded-2xl elevated-card border border-primary/20 shadow-2xl"
        >
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 rounded-xl bg-primary/15 flex items-center justify-center text-primary text-[13px] font-bold">
              {selectedCount}
            </span>
            <div>
              <p className="text-[12px] font-semibold text-foreground">{selectedCount} {entityName}{selectedCount > 1 ? "s" : ""} selected</p>
              <button onClick={selectedCount < totalCount ? onSelectAll : onClear}
                className="text-[10px] text-primary hover:underline font-medium">
                {selectedCount < totalCount ? "Select all" : "Clear selection"}
              </button>
            </div>
          </div>
          <div className="w-px h-8 bg-border/40 mx-1" />
          <div className="flex items-center gap-1.5">
            <button onClick={onExport}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-medium text-foreground hover:bg-secondary/50 transition-colors">
              <Download className="w-3.5 h-3.5" /> Export
            </button>
            {extraActions?.map((a) => {
              const Icon = a.icon;
              return (
                <button key={a.label} onClick={a.onClick}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-medium transition-colors",
                    a.variant === "destructive"
                      ? "text-destructive hover:bg-destructive/10"
                      : "text-foreground hover:bg-secondary/50"
                  )}>
                  <Icon className="w-3.5 h-3.5" /> {a.label}
                </button>
              );
            })}
            <button onClick={onDelete}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[12px] font-medium text-destructive hover:bg-destructive/10 transition-colors">
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </button>
          </div>
          <button onClick={onClear} className="p-1.5 rounded-lg hover:bg-secondary/50 text-muted-foreground transition-colors ml-1">
            <X className="w-3.5 h-3.5" />
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
