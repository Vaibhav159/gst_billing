import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { stubAuth } from "@/test/render";
import { AuthContext } from "./AuthProvider";
import { SIGN_OUT_FAILED, useSignOutAction } from "./useSignOutAction";

function withSignOut(signOut: () => Promise<void>) {
  const auth = { ...stubAuth({ role: "owner" }), signOut };
  return ({ children }: { children: ReactNode }) => <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

test("one sign-out at a time, and success says so", async () => {
  let finish!: () => void;
  const signOut = vi.fn(() => new Promise<void>((resolve) => { finish = resolve; }));
  const { result } = renderHook(() => useSignOutAction(), { wrapper: withSignOut(signOut) });
  let first!: Promise<boolean>, second!: Promise<boolean>;
  act(() => { first = result.current.leave(); });
  expect(result.current.busy).toBe(true);
  act(() => { second = result.current.leave(); });
  await act(async () => { finish(); });
  expect(await first).toBe(true);
  expect(await second).toBe(false);
  expect(signOut).toHaveBeenCalledOnce();
  expect(result.current.busy).toBe(false);
});

test("a sign-out that didn't finish keeps the session and gives the same words everywhere", async () => {
  const { result } = renderHook(() => useSignOutAction(), { wrapper: withSignOut(async () => { throw new Error("offline"); }) });
  let done!: boolean;
  await act(async () => { done = await result.current.leave(); });
  expect(done).toBe(false);
  expect(result.current.error).toBe(SIGN_OUT_FAILED);
  expect(SIGN_OUT_FAILED).toBe("Sign out didn't finish. Try again when the app can connect.");
});
