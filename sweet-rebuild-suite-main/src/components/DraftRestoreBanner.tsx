import { motion } from "framer-motion";
import { FileText, X, RotateCcw } from "lucide-react";

interface DraftRestoreBannerProps {
  onRestore: () => void;
  onDiscard: () => void;
}

export default function DraftRestoreBanner({ onRestore, onDiscard }: DraftRestoreBannerProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex items-center gap-3 px-5 py-3.5 rounded-xl border border-chart-3/30 bg-chart-3/8 text-chart-3 text-[13px]"
    >
      <FileText className="w-4 h-4 shrink-0" />
      <span className="flex-1">You have an unsaved draft. Would you like to restore it?</span>
      <button onClick={onRestore}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-chart-3/15 text-chart-3 text-[12px] font-semibold hover:bg-chart-3/25 transition-colors">
        <RotateCcw className="w-3 h-3" /> Restore
      </button>
      <button onClick={onDiscard} className="p-1.5 rounded-lg hover:bg-chart-3/15 transition-colors">
        <X className="w-3.5 h-3.5" />
      </button>
    </motion.div>
  );
}
