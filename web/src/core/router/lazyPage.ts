// Pages that load on demand (Ruling 1B-4). Each keeps its loader, so a test can still say which screen an address
// opens (a lazy page's own type is React's wrapper, not the screen).
import { isValidElement, lazy, type ComponentType, type LazyExoticComponent } from "react";

export type LazyPage<T extends ComponentType<object>> = LazyExoticComponent<T> & { load: () => Promise<{ default: T }> };

/** A page whose code loads when it first opens: `lazy`, with its loader kept as `load`. */
export function lazyPage<T extends ComponentType<object>>(load: () => Promise<{ default: T }>): LazyPage<T> {
  return Object.assign(lazy(load), { load });
}

/** Called once the shell shows: fetch only page code in idle time, once per app load (Ruling 1E-12). */
export function idlePages(pages: { load: () => Promise<unknown> }[]): () => void {
  let scheduled = false;
  return () => {
    if (scheduled) return;
    scheduled = true;
    const load = () => {
      // A failed warm-up stays quiet; opening that page uses the normal lazy-page boundary and its Reload action.
      for (const page of pages) void page.load().catch(() => {});
    };
    if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(load);
    else window.setTimeout(load, 0);
  };
}

/** The screen a route's element shows: a lazy page's component once loaded, else the element's own type. For tests. */
export async function loadedPage(element: unknown): Promise<unknown> {
  if (!isValidElement(element)) return undefined;
  const load = (element.type as { load?: () => Promise<{ default: unknown }> }).load;
  return load ? (await load()).default : element.type;
}
