import { act } from "@testing-library/react";

/** The clock moves only when the test says. Keep today's fake date when switching from an advancing clock. */
export function handClock(now: number | Date = Date.now()) {
  vi.useRealTimers();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now });
}

/** Advance one turn inside React's act, including the promises that the timer starts. */
export async function tick(ms = 0) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

/** Run every due timer before yielding to promise callbacks, as a synchronous clock advance does. */
export function tickSync(ms = 0) {
  return act(() => { vi.advanceTimersByTime(ms); });
}

/** Move the hand clock, then deliver the cache's 0 ms notifications without moving time further. */
export async function pass(ms = 0, turns = 4) {
  await tick(ms);
  for (let i = 0; i < turns; i++) await tick();
}

/** Past a dialog's 350 ms guard and a field's debounce, then flush React's updates. */
export const pastGuard = () => act(async () => { vi.advanceTimersByTime(400); });
