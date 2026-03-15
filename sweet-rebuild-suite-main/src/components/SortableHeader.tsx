import { ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import { cn } from "@/utils/utils";

interface SortableHeaderProps {
  label: string;
  sortKey: string;
  currentSort: string;
  currentDir: "asc" | "desc";
  onSort: (key: string) => void;
  className?: string;
}

export default function SortableHeader({ label, sortKey, currentSort, currentDir, onSort, className }: SortableHeaderProps) {
  const isActive = currentSort === sortKey;

  return (
    <th className={cn("cursor-pointer select-none group", className)}>
      <button
        onClick={() => onSort(sortKey)}
        className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors w-full"
        aria-label={`Sort by ${label}`}
      >
        {label}
        <span className={cn("transition-opacity", isActive ? "opacity-100" : "opacity-0 group-hover:opacity-50")}>
          {isActive ? (
            currentDir === "asc" ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
          ) : (
            <ArrowUpDown className="w-3 h-3" />
          )}
        </span>
      </button>
    </th>
  );
}
