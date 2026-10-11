import { describe, expect, it } from "vitest";
import { salesServer, wireDetail, wireRow, refuse } from "@/core/sales/fixtures";
import { testQueryClient } from "@/test/render";
import { freshUnsent, isUnsent } from "./home-send";
import { toBillRow } from "@/core/sales/wire";

const day = "2026-10-08";
describe("Home's send list", () => {
  it("asks again before sending, despite an active cached bill, and skips cancelled or deleted bills", async () => {
    const qc = testQueryClient();
    salesServer([["GET", "sales/412/", () => wireDetail()]]);
    expect((await freshUnsent(qc, 412, 3, day))?.id).toBe(412);
    salesServer([["GET", "sales/412/", () => wireDetail({ status: "cancelled" })]]);
    expect(await freshUnsent(qc, 412, 3, day)).toBeNull();
    salesServer([["GET", "sales/412/", () => refuse(404, { detail: "Not found." })]]);
    expect(await freshUnsent(qc, 412, 3, day)).toBeNull();
    qc.clear();
  });
  it("a failed recheck refuses to send stale data", async () => {
    const qc = testQueryClient();
    salesServer([["GET", "sales/412/", () => refuse(503, { detail: "Try again" })]]);
    await expect(freshUnsent(qc, 412, 3, day)).rejects.toBeDefined();
    qc.clear();
  });
  it("uses the shared Indian mobile validation", () => {
    expect(isUnsent(toBillRow(wireRow({ customer: { mobile_number: "+91 98290 41122" } })), 3, day)).toBe(true);
    expect(isUnsent(toBillRow(wireRow({ customer: { mobile_number: "1234567890" } })), 3, day)).toBe(false);
  });
});
