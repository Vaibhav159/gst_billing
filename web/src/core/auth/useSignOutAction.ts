import { useCallback, useRef, useState } from "react";
import { useAuth } from "./AuthProvider";

export const SIGN_OUT_FAILED = "Sign out didn't finish. Try again when the app can connect.";

/**
 * Sign out from a button or a confirm: one at a time, and it waits for the server (plan note 4). True when signed out;
 * false keeps the session, with `error` for the screen to show and the person to retry.
 */
export function useSignOutAction() {
  const { signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const running = useRef(false);
  const leave = useCallback(async (): Promise<boolean> => {
    if (running.current) return false;
    running.current = true; setBusy(true); setError("");
    try { await signOut(); return true; }
    catch { setError(SIGN_OUT_FAILED); return false; }
    finally { running.current = false; setBusy(false); }
  }, [signOut]);
  return { leave, busy, error };
}
