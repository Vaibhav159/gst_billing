import { useLayoutEffect, useRef, useState, type RefObject } from "react";

/**
 * A box's width, kept up to date, for a table that picks its columns from the space it has (the bills list, a bill's
 * items): [ref to put on the box, its width in px]. Measured as it's laid out, then followed by a ResizeObserver where
 * the browser has one; 1400 until measured (and where nothing lays out, as in tests). The box is drawn from the first
 * render: the hook looks for it once.
 */
export function useBoxWidth(): [RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    setW(el.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w || 1400];
}
