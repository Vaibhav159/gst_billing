import { AlertTriangle, RefreshCw } from "lucide-react";

/**
 * "The server is down" and "you have no invoices" are different facts. Every
 * list page rendered both as "No … found", which in a billing app invites
 * panic or duplicate data entry (audit E3).
 */
export default function DataError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-2 py-10 text-center">
      <AlertTriangle className="w-6 h-6 text-destructive" />
      <p className="text-sm font-medium text-foreground">Couldn't load this data</p>
      <p className="text-[12px] text-muted-foreground max-w-md">{message}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="premium-btn-ghost text-[12px] h-9 mt-1">
          <RefreshCw className="w-3.5 h-3.5" /> Try again
        </button>
      )}
    </div>
  );
}
