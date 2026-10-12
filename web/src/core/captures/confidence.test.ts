import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { pendingReadGroups, useReadConfidence } from "./confidence";
import { readFixture } from "./fixtures";

const photoRead = readFixture({
  confidence: { supplier: "high", gstin: "high", bill_no: "medium", date: "medium", amounts: "medium" }, notes: [],
});

describe("read confidence", () => {
  it("keeps each medium group pending until that group is confirmed", () => {
    expect(pendingReadGroups(photoRead, {})).toEqual(["bill_no", "date", "amounts"]);
    expect(pendingReadGroups(photoRead, { date: true })).toEqual(["bill_no", "amounts"]);
    expect(pendingReadGroups(null, {})).toEqual([]);
  });

  it("marks edits confirmed independently and keeps needsReview until all checks are done", () => {
    const { result } = renderHook(() => useReadConfidence(photoRead));
    act(() => result.current.confirm("bill_no"));
    expect(result.current.pending).toEqual(["date", "amounts"]);
    expect(result.current.needsReview).toBe(true);
    act(() => result.current.edited("date"));
    expect(result.current.pending).toEqual(["amounts"]);
    act(() => result.current.confirm("amounts"));
    expect(result.current.needsReview).toBe(false);
  });

  it("resets confirmations for a replacement reading, including returning to an earlier reading", () => {
    const { result, rerender } = renderHook(({ read }) => useReadConfidence(read), { initialProps: { read: photoRead } });
    act(() => result.current.confirm("date"));
    rerender({ read: { ...photoRead, invoice_number: "REPLACEMENT" } });
    expect(result.current.confirmed).toEqual({});
    expect(result.current.pending).toContain("date");
    rerender({ read: photoRead });
    expect(result.current.confirmed).toEqual({});
    act(() => result.current.confirm("date"));
    act(() => result.current.reset());
    expect(result.current.confirmed).toEqual({});
  });

  it("does not silently promote medium fields just because an IRN was read", () => {
    const { result } = renderHook(() => useReadConfidence({ ...photoRead, source: "e-invoice", irn: "a".repeat(64) }));
    expect(result.current.needsReview).toBe(true);
  });
});
