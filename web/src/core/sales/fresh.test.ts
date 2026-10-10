import { markFresh, takeFresh } from "./fresh";

afterEach(() => { vi.useRealTimers(); takeFresh(); });

test("a bill made or restored elsewhere flashes once, where it's shown", () => {
  markFresh(5);
  markFresh(9);
  expect(takeFresh([5, 6])).toEqual(new Set([5]));
  expect(takeFresh([5])).toEqual(new Set());
  expect(takeFresh()).toEqual(new Set([9]));
});

test("a mark older than two minutes is forgotten", () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  markFresh(5);
  vi.advanceTimersByTime(120_001);
  expect(takeFresh([5])).toEqual(new Set());
});
