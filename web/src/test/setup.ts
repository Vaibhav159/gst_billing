import "@testing-library/jest-dom/vitest";

// jsdom has no layout: give the kit the few browser features it calls. A file that runs under
// `// @vitest-environment node` (to read a PDF's bytes as they are) has no DOM, so the DOM's parts are left out there.
const dom = typeof window !== "undefined";
if (dom) Element.prototype.scrollTo = function (this: HTMLElement, a?: number | ScrollToOptions, b?: number) {
  this.scrollTop = typeof a === "object" ? a.top ?? 0 : b ?? 0;
} as typeof Element.prototype.scrollTo;
if (dom) Element.prototype.scrollIntoView = function () {};
// Router tests leave idle page preloads pending; idle.test installs and advances its own scheduler.
if (dom) window.requestIdleCallback = () => 0;
const g = globalThis as unknown as Record<string, unknown>;
g.CSS ??= { escape: (s: string) => s.replace(/["\\\]\[]/g, "\\$&"), supports: () => false };
class NoopObserver { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } }
g.ResizeObserver ??= NoopObserver;
// Cards are in view by default. A visibility test installs its own observer to keep them below the viewport.
g.IntersectionObserver ??= class {
  constructor(private callback: IntersectionObserverCallback) {}
  observe(target: Element) { this.callback([{ target, isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver); }
  unobserve() {}
  disconnect() {}
  takeRecords() { return []; }
};

// Node 25 has its own localStorage (no methods without --localstorage-file) and sessionStorage, and
// vitest 3 keeps a global that already exists, so jsdom's never arrive. Tests get jsdom's, as on Node 20.
const { jsdom } = globalThis as unknown as { jsdom?: { window: Window } };
if (jsdom) for (const k of ["localStorage", "sessionStorage"] as const) Object.defineProperty(globalThis, k, { configurable: true, value: jsdom.window[k] });

// React Router's data routers make a Request for each navigation, with an AbortSignal. Under jsdom the signal is jsdom's,
// and Node 24+'s Request (undici 7) takes only Node's own, so every navigation in a test would throw; Node 20 takes any.
// Where it throws, Node's Request gets no signal and the request keeps jsdom's: the router only reads request.signal.
try { new Request("http://localhost/", { signal: new AbortController().signal }); } catch {
  const NodeRequest = globalThis.Request;
  globalThis.Request = class Request extends NodeRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      super(input, init?.signal ? { ...init, signal: undefined } : init);
      if (init?.signal) Object.defineProperty(this, "signal", { value: init.signal });
    }
  };
}

// jsdom has no matchMedia; tests that need a phone set window.__phone = true before rendering.
if (dom) Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: query.includes("max-width: 767px") ? Boolean((window as unknown as { __phone?: boolean }).__phone) : false,
    media: query, onchange: null,
    addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }),
});
