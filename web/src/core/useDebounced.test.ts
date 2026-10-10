import { act, renderHook } from "@testing-library/react";
import { useDebounced } from "./useDebounced";

afterEach(() => { vi.useRealTimers(); });

test("a value settles once it has stopped changing for the pause: 250 ms, or what the caller asks", () => {
  vi.useFakeTimers();
  const start: { v: string; ms?: number } = { v: "" };
  const { result, rerender } = renderHook(({ v, ms }) => useDebounced(v, ms), { initialProps: start });
  rerender({ v: "M" });
  act(() => { vi.advanceTimersByTime(200); });
  // another key starts the pause again
  rerender({ v: "Me" });
  act(() => { vi.advanceTimersByTime(249); });
  expect(result.current).toBe("");
  act(() => { vi.advanceTimersByTime(1); });
  expect(result.current).toBe("Me");
  rerender({ v: "Meena", ms: 300 });
  act(() => { vi.advanceTimersByTime(299); });
  expect(result.current).toBe("Me");
  act(() => { vi.advanceTimersByTime(1); });
  expect(result.current).toBe("Meena");
});
