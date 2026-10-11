import { handClock, tickSync } from "./clock";

afterEach(() => vi.useRealTimers());

test("a synchronous tick finishes due timers before their promise callbacks", async () => {
  handClock();
  const order: string[] = [];
  setTimeout(() => {
    order.push("first timer");
    void Promise.resolve().then(() => order.push("promise"));
  }, 10);
  setTimeout(() => order.push("second timer"), 20);
  await tickSync(20);
  expect(order).toEqual(["first timer", "second timer", "promise"]);
});
