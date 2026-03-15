import { useRef, ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

interface VirtualizedListProps<T> {
  items: T[];
  estimateSize: number;
  renderItem: (item: T, index: number) => ReactNode;
  className?: string;
  overscan?: number;
}

export default function VirtualizedList<T>({
  items,
  estimateSize,
  renderItem,
  className = "",
  overscan = 5,
}: VirtualizedListProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan,
  });

  return (
    <div
      ref={parentRef}
      className={className}
      style={{ overflow: "auto" }}
    >
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualItem) => (
          <div
            key={virtualItem.key}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: "100%",
              transform: `translateY(${virtualItem.start}px)`,
            }}
          >
            {renderItem(items[virtualItem.index], virtualItem.index)}
          </div>
        ))}
      </div>
    </div>
  );
}
