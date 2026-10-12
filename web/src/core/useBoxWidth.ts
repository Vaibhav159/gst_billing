import { useLayoutEffect, useRef, useState, type RefObject } from "react";

/** A box's content width (inside its padding, without a scrollbar), rounded, as ResizeObserver's contentRect gives it. */
function contentWidth(el: HTMLElement): number {
  const s = getComputedStyle(el);
  return Math.max(0, Math.round(el.clientWidth - (parseFloat(s.paddingLeft) || 0) - (parseFloat(s.paddingRight) || 0)));
}

/**
 * A box's width, kept up to date, for a table that picks its columns from the space it has (the bills list, a bill's
 * items): [ref to put on the box, its width in px]. Every measure is the box's content width, rounded: the first as it's
 * laid out, then each the ResizeObserver reports where the browser has one. 1400 until the box is measured (Ruling 1E-3,
 * as amended; also where nothing lays out, as in tests). The box is drawn from the first render: the hook looks for it once.
 */
export function useBoxWidth(): [RefObject<HTMLDivElement>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    setW(contentWidth(el));
    if (typeof ResizeObserver === "undefined") return undefined;
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, w || 1400];
}
