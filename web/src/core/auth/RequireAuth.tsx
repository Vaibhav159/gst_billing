import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router";
import { useAuth } from "./AuthProvider";
import { ListSkeleton, LoadError } from "@/core/ui";

export function RequireAuth({ children }: { children: ReactNode }) {
  const { status, startProblem, expiredFrom, retryStart } = useAuth();
  const loc = useLocation();
  if (status === "loading") return <div className="p-6"><ListSkeleton what="the app" /></div>;
  if (status === "error" && startProblem) return <div className="p-6"><LoadError problem={startProblem} what="the app" retry={retryStart} /></div>;
  if (status === "signed-out") {
    const next = expiredFrom || loc.pathname + loc.search;
    return <Navigate to={`/login?next=${encodeURIComponent(next)}${expiredFrom ? "&reason=expired" : ""}`} replace />;
  }
  return <>{children}</>;
}
