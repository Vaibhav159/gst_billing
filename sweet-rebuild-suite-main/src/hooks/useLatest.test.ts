import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useLatest } from "./useLatest";

// Review of H18: the customer page's totals and Bulk PDF's list kept whatever
// answer came back last, so a slow answer for the previous customer (or FY)
// replaced the current one, and a failed fetch left the old figures showing.
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("useLatest", () => {
  it("keeps the answer for the latest request, not the one that came back last", async () => {
    const calls: Record<string, ReturnType<typeof deferred<string>>> = { a: deferred(), b: deferred() };
    const { result, rerender } = renderHook(({ id }) => useLatest(() => calls[id].promise, [id]), { initialProps: { id: "a" } });
    rerender({ id: "b" });
    await act(async () => { calls.b.resolve("totals of b"); });
    await act(async () => { calls.a.resolve("totals of a"); });
    expect(result.current).toMatchObject({ data: "totals of b", failed: false, loading: false });
  });

  it("clears the old answer when the request changes, and says when one fails", async () => {
    const calls: Record<string, ReturnType<typeof deferred<string>>> = { a: deferred(), b: deferred() };
    const { result, rerender } = renderHook(({ id }) => useLatest(() => calls[id].promise, [id]), { initialProps: { id: "a" } });
    await act(async () => { calls.a.resolve("totals of a"); });
    rerender({ id: "b" });
    expect(result.current.data).toBeNull();
    await act(async () => { calls.b.reject(new Error("500")); });
    await waitFor(() => expect(result.current).toMatchObject({ data: null, failed: true, loading: false }));
  });
});
