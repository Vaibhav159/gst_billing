import { useEffect, type ReactNode } from "react";
import { useBlocker } from "react-router";
import { ConfirmDialog } from "@/core/ui";

/** Ask before leaving a page with unsaved changes (links, Back, and closing the tab). Render what it returns. */
export function useUnsavedGuard(dirty: boolean, message = "Your changes aren't saved. Leave this page and lose them?"): ReactNode {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);
  useEffect(() => {
    if (!dirty) return undefined;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);
  if (blocker.state !== "blocked") return null;
  return (
    <ConfirmDialog open title="Leave without saving?" confirmLabel="Leave" cancelLabel="Stay" tone="danger"
      onClose={() => blocker.reset?.()} onConfirm={() => blocker.proceed?.()}>{message}</ConfirmDialog>
  );
}
