import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { useAuth } from "./AuthProvider";
import { ListSkeleton, LoadError } from "@/core/ui";

/**
 * Pages need someone signed in. Signed out, the sign-in page comes next: after a session ran out it goes back to that
 * page and says why; on a first visit it goes on to the address asked for; after a sign-out on purpose it starts plain.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, startProblem, expiredFrom, signedOutOnPurpose, retryStart } = useAuth();
  const loc = useLocation();
  if (status === "loading") return <div className="p-6"><ListSkeleton what="the app" /></div>;
  if (status === "error" && startProblem) return <div className="p-6"><LoadError problem={startProblem} what="the app" retry={retryStart} /></div>;
  if (status === "signed-out") {
    // whoever signs in next on this computer starts at home, not on the last person's page (a late expiry doesn't change that)
    if (signedOutOnPurpose) return <Navigate to="/login" replace />;
    const next = expiredFrom || loc.pathname + loc.search;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}${expiredFrom ? "&reason=expired" : ""}`} replace />;
  }
  return <>{children}</>;
}
