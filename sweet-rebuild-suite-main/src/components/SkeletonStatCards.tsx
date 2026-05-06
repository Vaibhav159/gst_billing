import { Skeleton } from "@/components/ui/skeleton";

interface SkeletonStatCardsProps {
  count?: number;
  mobile?: boolean;
}

export default function SkeletonStatCards({ count = 4, mobile }: SkeletonStatCardsProps) {
  if (mobile) {
    return (
      <div className="flex gap-3 overflow-x-auto pb-1 -mx-4 px-4 snap-x scrollbar-hide">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="min-w-[160px] snap-center stat-card rounded-2xl p-4 shrink-0 space-y-3 animate-pulse">
            <div className="flex items-center justify-between">
              <Skeleton className="h-2 w-14 rounded-full" />
              <Skeleton className="w-4 h-4 rounded" />
            </div>
            <Skeleton className="h-6 w-20 rounded-lg" />
            <Skeleton className="h-2 w-16 rounded-full" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="stat-card rounded-2xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="space-y-2.5">
              <div className="flex items-center gap-2">
                <Skeleton className="h-2.5 w-20 rounded-full shimmer" />
                <Skeleton className="h-4 w-10 rounded-md" />
              </div>
              <Skeleton className="h-7 w-32 rounded-lg shimmer" />
            </div>
            <Skeleton className="w-11 h-11 rounded-xl" />
          </div>
          <div className="flex items-center gap-2 pt-1">
            <Skeleton className="h-2 w-16 rounded-full" />
            <Skeleton className="h-8 w-full rounded-md opacity-30" />
          </div>
        </div>
      ))}
    </div>
  );
}
