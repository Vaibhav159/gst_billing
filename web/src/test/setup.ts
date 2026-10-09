import "@testing-library/jest-dom/vitest";

// jsdom has no layout: give the kit the few browser features it calls.
Element.prototype.scrollTo = function (this: HTMLElement, a?: number | ScrollToOptions, b?: number) {
  this.scrollTop = typeof a === "object" ? a.top ?? 0 : b ?? 0;
} as typeof Element.prototype.scrollTo;
Element.prototype.scrollIntoView = function () {};
const g = globalThis as unknown as Record<string, unknown>;
g.CSS ??= { escape: (s: string) => s.replace(/["\\\]\[]/g, "\\$&"), supports: () => false };
class NoopObserver { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
g.ResizeObserver ??= NoopObserver;
g.IntersectionObserver ??= NoopObserver;

// Node 25 has its own localStorage (no methods without --localstorage-file) and sessionStorage, and
// vitest 3 keeps a global that already exists, so jsdom's never arrive. Tests get jsdom's, as on Node 20.
const { jsdom } = globalThis as unknown as { jsdom: { window: Window } };
for (const k of ["localStorage", "sessionStorage"] as const) Object.defineProperty(globalThis, k, { configurable: true, value: jsdom.window[k] });

// jsdom has no matchMedia; tests that need a phone set window.__phone = true before rendering.
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: query.includes("max-width: 767px") ? Boolean((window as unknown as { __phone?: boolean }).__phone) : false,
    media: query, onchange: null,
    addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }),
});
