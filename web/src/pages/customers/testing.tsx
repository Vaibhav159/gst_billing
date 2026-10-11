// Test helpers for the customer screens: the shared fake server with the firms and preferences answered, the screens
// mounted in a data router (useUnsavedGuard needs one) with the app's providers, a clock the test moves by hand, and what
// a screen reader hears from a live region. Used by the *.test.tsx files beside it only.
import { fireEvent, render } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createBrowserRouter, createMemoryRouter, Outlet, RouterProvider, type RouteObject } from "react-router";
import { AuthContext, type Me } from "@/core/auth/AuthProvider";
import { RoleContext } from "@/core/auth/role";
import { ScopeProvider } from "@/core/scope";
import { ToastProvider } from "@/core/ui";
import { stubAuth, testQueryClient } from "@/test/render";
import { serve as serveAll, type Answer, type Call } from "@/test/server";

export type { Answer, Call, Reply } from "@/test/server";

export const FIRMS = [
  { id: 3, name: "KIRAN GOLD HOUSE", gst_number: "08ABCPK1234F1Z5", state_name: "RAJASTHAN" },
  { id: 4, name: "MEERA ORNAMENTS", gst_number: "08AAMFR5567K1ZG", state_name: "RAJASTHAN" },
];
/** Anil Gupta as customers/7/ answers him (contract §6.1). */
export const ANIL = {
  id: 7, name: "Anil Gupta", address: "15 Demo Road", gst_number: "", businesses: [3], pan_number: "", mobile_number: "9829041122", email: "",
  state_name: "RAJASTHAN", created_at: "2025-08-04T11:00:00+05:30", customer_type: "", city: "Udaipur", type: "person", pan: "",
};
/** A statement with no bills, for pages that only need one to answer. */
export const NO_BILLS = { customer: {}, start_date: null, end_date: null, business: null, bills: [], totals: {}, months: [] };

/** The fake server (@/test/server), with the firms and the person's preferences answered unless a test answers them itself. */
export function serve(answers: Record<string, Answer>): Call[] {
  return serveAll({ "GET businesses/": { results: FIRMS }, "GET preferences/": { data: { defaultBusinessId: "3" } }, ...answers });
}

/**
 * The screens under test in a data router, with the app's providers and the firm scope; signed in as the owner unless
 * `me` says. browser: the browser's own history (jsdom's), whose entries carry React Router's index as the app's do,
 * starting at entries[0] alone; the test goes on with router.navigate and ends with router.dispose().
 */
export function mount(routes: RouteObject[], entries: string[], { me, browser = false }: { me?: Partial<Me>; browser?: boolean } = {}) {
  const auth = stubAuth(me);
  // toasts inside the router, so the provider shows them itself (as renderApp's do)
  const tree: RouteObject[] = [{ element: <ToastProvider><ScopeProvider><Outlet /></ScopeProvider></ToastProvider>, children: routes }];
  if (browser) window.history.replaceState(null, "", entries[0]);
  const router = browser ? createBrowserRouter(tree) : createMemoryRouter(tree, { initialEntries: entries, initialIndex: entries.length - 1 });
  const view = render(
    <QueryClientProvider client={testQueryClient()}>
      <AuthContext.Provider value={auth}><RoleContext.Provider value={auth.me?.role ?? null}>
        <RouterProvider router={router} />
      </RoleContext.Provider></AuthContext.Provider>
    </QueryClientProvider>,
  );
  return { router, ...view };
}
export const VIEWER: Partial<Me> = { role: "viewer", roleLabel: "View only", permissions: ["view", "reports.export"] };
export const STAFF: Partial<Me> = { role: "staff", roleLabel: "Counter staff", permissions: ["view", "bill.create", "bill.send", "customer.edit"] };

/** Types `text` a key at a time with no time between the keys: each key a change of its own, as a quick typist's are. */
export function typeQuickly(box: HTMLElement, text: string) {
  for (let i = 1; i <= text.length; i++) fireEvent.change(box, { target: { value: text.slice(0, i) } });
}

/**
 * What a screen reader reads out while the cursor stays where it is: the words added to a polite live region already on
 * the page, each time they come, so the same words twice are heard twice (a region added with its words already in it
 * isn't reliably read).
 */
export function liveWords(): { said: string[]; stop: () => void } {
  const said: string[] = [];
  const watch = new MutationObserver((records) => {
    for (const r of records) {
      const at = r.target instanceof Element ? r.target : r.target.parentElement;
      if (!at?.closest('[aria-live="polite"], [role="status"]')) continue;
      if (r.type === "characterData" && r.target.textContent) said.push(r.target.textContent);
      for (const n of r.addedNodes) if (n.textContent) said.push(n.textContent);
    }
  });
  watch.observe(document.body, { subtree: true, childList: true, characterData: true });
  return { said, stop: () => watch.disconnect() };
}
