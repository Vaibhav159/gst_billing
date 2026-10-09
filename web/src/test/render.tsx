import type { ReactNode } from "react";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import { AuthContext, type AuthValue, type Me } from "@/core/auth/AuthProvider";
import { RoleContext } from "@/core/auth/role";
import { can, whyNot } from "@/core/auth/permissions";
import { ToastProvider } from "@/core/ui";

export const OWNER: Me = { id: 1, username: "kailash", fullName: "Kailash Mehta", role: "owner", roleLabel: "Owner", permissions: "*", needsRoleChoice: false };

/** A sign-in state for tests: signed in as `me` (the owner by default, merged over OWNER), or signed out with null. */
export function stubAuth(me: Partial<Me> | null = OWNER): AuthValue {
  const who = me ? ({ ...OWNER, ...me } as Me) : null;
  return {
    me: who, status: who ? "signed-in" : "signed-out", startProblem: null, expiredFrom: null, signedOutOnPurpose: false,
    signIn: async () => ({ ok: true }), signOut: () => {}, retryStart: () => {},
    can: (a) => can(who?.permissions, a), whyNot: (a, w) => (who ? whyNot(who.role, a, w) : ""),
  };
}

/**
 * Render inside the app's providers, signed in as `me` (the owner by default; null = signed out).
 * ToastProvider sits inside the router, so it shows its own toasts and page tests can see them.
 */
export function renderApp(ui: ReactNode, { path = "/", me = OWNER as Partial<Me> | null } = {}) {
  const auth = stubAuth(me);
  const who = auth.me;
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <AuthContext.Provider value={auth}><RoleContext.Provider value={who?.role ?? null}>
        <MemoryRouter initialEntries={[path]}><ToastProvider>{ui}</ToastProvider></MemoryRouter>
      </RoleContext.Provider></AuthContext.Provider>
    </QueryClientProvider>,
  );
}
