import { motion } from "framer-motion";
import { LucideIcon, Plus } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description: string;
  actionLabel?: string;
  actionHref?: string;
  compact?: boolean;
}

export default function EmptyState({ icon: Icon, title, description, actionLabel, actionHref, compact }: EmptyStateProps) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
      className={cn("flex flex-col items-center text-center", compact ? "py-12" : "py-20")}
    >
      <div className="relative mb-5">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 border border-primary/15 flex items-center justify-center">
          <Icon className="w-7 h-7 text-primary/60" />
        </div>
        <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-muted border border-border flex items-center justify-center">
          <span className="text-[10px] text-muted-foreground font-bold">0</span>
        </div>
      </div>
      <h3 className="text-base font-display font-semibold text-foreground mb-1.5">{title}</h3>
      <p className="text-sm text-muted-foreground max-w-[280px] leading-relaxed">{description}</p>
      {actionLabel && actionHref && (
        <Link to={actionHref} className="premium-btn-primary text-[13px] mt-5 gap-1.5">
          <Plus className="w-4 h-4" /> {actionLabel}
        </Link>
      )}
    </motion.div>
  );
}
