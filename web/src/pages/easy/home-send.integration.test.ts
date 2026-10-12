import { describe, expect, it } from "vitest";
import { salesServer, wirePage, wireRow, refuse } from "@/core/sales/fixtures";
import { fetchEasyUnsent } from "./queries";
const day = "2026-10-08";
const row = (id: number) => wireRow({ id, invoice_number: `KGH/2026-27/${id}` });
describe("Home's shared complete send list", () => {
  it("gathers all 121 rows before a send can shrink the list, with 50 per request", async () => {
    const s = salesServer([["GET", "sales/", ({ params }) => {
      const page = Number(params.page);
      const start = (page - 1) * 50;
      return wirePage(Array.from({ length: Math.min(50, 121 - start) }, (_, i) => row(start + i + 1)), { count: 121, next: page < 3 ? `https://ignored.invalid/?page=${page + 1}` : null });
    }]]);
    const rows = await fetchEasyUnsent(3, day);
    expect(rows).toHaveLength(121);
    expect(rows.at(-1)?.id).toBe(121);
    expect(s.calls).toHaveLength(3);
    s.calls.forEach((c, i) => expect(c).toMatchObject({ method: "GET", url: "sales/", params: {
      business_id: 3, start_date: day, end_date: day, unsent: 1, page_size: 50, page: i + 1,
    } }));
  });
  it("deduplicates shifting boundaries and leaves invalid mobile, sent and cancelled rows out", async () => {
    salesServer([["GET", "sales/", ({ params }) => wirePage(Number(params.page) === 1 ? [row(1), row(2)] : [row(2), row(3),
      wireRow({ id: 4, customer: { id: 9, name: "Walk-in", type: "walkin", mobile_number: "" } }),
      wireRow({ id: 6, status: "cancelled" }), wireRow({ id: 9, sent: { at: day, count: 1 } }),
    ], { next: Number(params.page) === 1 ? "next" : null })]]);
    expect((await fetchEasyUnsent(3, day)).map((b) => b.id)).toEqual([1, 2, 3]);
  });
  it("a later-page failure returns no partial list", async () => {
    salesServer([["GET", "sales/", ({ params }) => Number(params.page) === 1 ? wirePage([row(1)], { next: "next" }) : refuse(503, { detail: "Try again" })]]);
    await expect(fetchEasyUnsent(3, day)).rejects.toBeDefined();
  });
  it("never reads without a known firm", async () => {
    const s = salesServer();
    expect(await fetchEasyUnsent(null, day)).toEqual([]);
    expect(s.calls).toEqual([]);
  });
});
