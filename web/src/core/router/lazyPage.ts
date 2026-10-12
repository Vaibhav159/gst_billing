// Pages that load on demand (Ruling 1B-4). Each keeps its loader, so a test can still say which screen an address
// opens (a lazy page's own type is React's wrapper, not the screen).
import { isValidElement, lazy, type ComponentType, type LazyExoticComponent } from "react";

export type LazyPage<T extends ComponentType<object>> = LazyExoticComponent<T> & { load: () => Promise<{ default: T }> };

/** A page whose code loads when it first opens: `lazy`, with its loader kept as `load`. */
export function lazyPage<T extends ComponentType<object>>(load: () => Promise<{ default: T }>): LazyPage<T> {
  return Object.assign(lazy(load), { load });
}

/** Called when a real page shows: fetch only page code online and idle, once per app load (Ruling 1E-12). */
export function idlePages(pages: { load: () => Promise<unknown> }[]): () => void {
  let started = false;
  let scheduled = false;
  const schedule = () => {
    if (started || scheduled) return;
    if (navigator.onLine === false) {
      window.addEventListener("online", schedule, { once: true });
      return;
    }
    scheduled = true;
    const load = () => {
      scheduled = false;
      // The line can go away between a page showing and idle time. Leave this run for the next online event or page.
      if (navigator.onLine === false) { schedule(); return; }
      started = true;
      window.removeEventListener("online", schedule);
      // A failed warm-up stays quiet; each screen offers its own load-failure note and Reload action when opened.
      for (const page of pages) void page.load().catch(() => {});
    };
    if (typeof window.requestIdleCallback === "function") window.requestIdleCallback(load);
    else window.setTimeout(load, 2000);
  };
  return schedule;
}

/** The screen a route's element shows: a lazy page's component once loaded, else the element's own type. For tests. */
export async function loadedPage(element: unknown): Promise<unknown> {
  if (!isValidElement(element)) return undefined;
  const load = (element.type as { load?: () => Promise<{ default: unknown }> }).load;
  return load ? (await load()).default : element.type;
}
