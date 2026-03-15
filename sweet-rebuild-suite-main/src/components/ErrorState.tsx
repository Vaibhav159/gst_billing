import { AlertCircle, RefreshCw } from "lucide-react";
import { cn } from "@/utils/utils";

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
  compact?: boolean;
}

export default function ErrorState({
  title = "Something went wrong",
  message = "An unexpected error occurred. Please try again.",
  onRetry,
  className,
  compact,
}: ErrorStateProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-4 text-center", compact ? "py-12" : "py-24", className)}>
      <div className="w-14 h-14 rounded-2xl bg-destructive/10 border border-destructive/20 flex items-center justify-center">
        <AlertCircle className="w-6 h-6 text-destructive" />
      </div>
      <div>
        <h3 className="text-base font-display font-semibold text-foreground mb-1">{title}</h3>
        <p className="text-sm text-muted-foreground max-w-[300px] leading-relaxed">{message}</p>
      </div>
      {onRetry && (
        <button onClick={onRetry} className="premium-btn-outline text-[13px] gap-1.5">
          <RefreshCw className="w-4 h-4" /> Try Again
        </button>
      )}
    </div>
  );
}
