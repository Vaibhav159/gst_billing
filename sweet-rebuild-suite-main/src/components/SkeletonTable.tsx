import { Skeleton } from "@/components/ui/skeleton";

interface SkeletonTableProps {
  rows?: number;
  columns?: number;
  showSearch?: boolean;
}

export default function SkeletonTable({ rows = 5, columns = 5, showSearch = true }: SkeletonTableProps) {
  const colWidths = [140, 100, 80, 90, 70];

  return (
    <div className="space-y-4">
      {showSearch && (
        <div className="flex items-center gap-3">
          <Skeleton className="h-10 flex-1 max-w-sm rounded-xl shimmer" />
          <Skeleton className="h-10 w-24 rounded-xl" />
          <Skeleton className="h-10 w-10 rounded-xl" />
        </div>
      )}
      <div className="elevated-card rounded-2xl overflow-hidden">
        {/* Header */}
        <div className="border-b border-border/60 px-5 py-3.5 flex gap-6">
          <Skeleton className="w-5 h-5 rounded" />
          {Array.from({ length: columns }).map((_, i) => (
            <Skeleton key={i} className="h-3 rounded-full" style={{ width: `${colWidths[i % colWidths.length]}px` }} />
          ))}
        </div>
        {/* Rows */}
        <div>
          {Array.from({ length: rows }).map((_, row) => (
            <div
              key={row}
              className="flex items-center gap-6 px-5 py-4 border-b border-border/30 last:border-0"
              style={{ animationDelay: `${row * 75}ms` }}
            >
              <Skeleton className="w-5 h-5 rounded shrink-0" />
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <Skeleton className="w-9 h-9 rounded-xl shrink-0" />
                <div className="space-y-2 flex-1">
                  <Skeleton className="h-3.5 rounded-md shimmer" style={{ width: `${colWidths[row % colWidths.length] + 20}px` }} />
                  <Skeleton className="h-2.5 w-20 rounded-md" />
                </div>
              </div>
              {Array.from({ length: Math.max(0, columns - 2) }).map((_, i) => (
                <Skeleton key={i} className="h-3 rounded-md" style={{ width: `${colWidths[(row + i) % colWidths.length]}px` }} />
              ))}
              <Skeleton className="w-8 h-8 rounded-lg shrink-0" />
            </div>
          ))}
        </div>
        {/* Pagination skeleton */}
        <div className="border-t border-border/40 px-5 py-3 flex items-center justify-between">
          <Skeleton className="h-3 w-32 rounded-full" />
          <div className="flex gap-1.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="w-8 h-8 rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
