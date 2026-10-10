import { cancelledNote, failText } from "./words";

test("cancelled bills are named apart, in the caller's words, and not at all when there are none", () => {
  expect(cancelledNote(0)).toBe("");
  expect(cancelledNote(1)).toBe("1 cancelled bill also listed");
  expect(cancelledNote(2, "not counted")).toBe("2 cancelled bills not counted");
});

test("a failure says what didn't happen and what to do; only a save says that what was typed is still there", () => {
  expect(failText({ kind: "offline", message: "You're offline" })).toEqual({ title: "Not saved: you're offline", body: "Nothing was changed. What you typed is still here. Try again when the internet is back." });
  expect(failText({ kind: "unreachable", message: "The app couldn't get through" })).toEqual({ title: "Not saved: the app couldn't get through", body: "Nothing was changed. What you typed is still here. Try again in a minute." });
  expect(failText({ kind: "server", message: "The app couldn't get through" }, "deleted")).toEqual({ title: "Not deleted: the app couldn't get through", body: "Nothing was changed. Try again in a minute." });
  expect(failText({ kind: "offline", message: "You're offline" }, "cancelled")).toEqual({ title: "Not cancelled: you're offline", body: "Nothing was changed. Try again when the internet is back." });
  // a refusal says the server's own words
  expect(failText({ kind: "conflict", message: "September 2026 is filed and locked for KIRAN GOLD HOUSE, so its bills can't be cancelled." }, "cancelled"))
    .toEqual({ title: "Not cancelled", body: "September 2026 is filed and locked for KIRAN GOLD HOUSE, so its bills can't be cancelled." });
});
