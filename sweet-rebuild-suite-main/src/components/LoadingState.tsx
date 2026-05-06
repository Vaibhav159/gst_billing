import { Loader2 } from "lucide-react";
import { cn } from "@/utils/utils";

interface LoadingStateProps {
  message?: string;
  className?: string;
  compact?: boolean;
}

export default function LoadingState({ message = "Loading...", className, compact }: LoadingStateProps) {
  return (
    <div
      className={cn("flex flex-col items-center justify-center gap-4", compact ? "py-12" : "py-24", className)}
      role="status"
      aria-live="polite"
      aria-label={message}
    >
      <div className="relative">
        <div className="absolute inset-0 rounded-full bg-primary/20 animate-ping" />
        <div className="relative w-10 h-10 rounded-full bg-primary/10 border border-primary/20 flex items-center justify-center">
          <Loader2 className="w-5 h-5 text-primary animate-spin" />
        </div>
      </div>
      <p className="text-sm text-muted-foreground font-medium">{message}</p>
    </div>
  );
}
