import { afterEach, expect, it, vi } from "vitest";
import { toBoard } from "@/core/dashboard/wire";
import * as shared from "@/core/rates/slip";
import { toSaleProduct } from "@/pages/sales/form/products";
import { easyRateSlip, rateNote, rateSlip } from "./rates";

const product = { id: 5, name: "Gold Ring 22K", kind: "gold", kind_effective: "gold", purity: "22K" };
const board = toBoard({
  id: 41, on: "2026-09-30", set_at: "2026-09-30T10:05:12+05:30", set_by: { id: 1, name: "Kailash Mehta" },
  quoted: { "gold-24K": "71040.00", "gold-22K": "65125.00", "gold-18K": "53280.00", "silver-999": "78500.00", "silver-925": "72610.00" },
  per_gram: { "gold-24K": "7104.000", "gold-22K": "6512.500", "gold-18K": "5328.000", "silver-999": "78.500", "silver-925": "72.610" },
});

afterEach(() => vi.restoreAllMocks());

it("uses the landed product mapper and slip correction without filling from the board", () => {
  const mapped = toSaleProduct({ ...product, kind: null, default_unit: "gms", gst_tax_rate: "0.0300" });
  const input = { product: mapped, board, unit: mapped.unit, rate: "66000", name: mapped.name };
  expect(easyRateSlip(input)).toEqual({
    ...shared.rateSlip({ ...input, easy: true }),
    fix: "6600.000", tick: "Yes, ₹66,000.00 a gram is right for Gold Ring 22K",
  });
  expect(easyRateSlip({ ...input, rate: "" })).toBeNull();
  expect(easyRateSlip({ ...input, board: null })).toBeNull();
  expect(easyRateSlip({ ...input, product: { ...mapped, purity: "" } })).toBeNull();
});

it("re-exports the original shared functions without wrappers", () => {
  expect(rateSlip).toBe(shared.rateSlip);
  expect(rateNote).toBe(shared.rateNote);
});

it("passes the original product and dated board with easy=true, preserving the corrected typed rate", () => {
  const correction = { text: "Rates here are per gram", fix: "6600.000", label: "Use ₹6,600.00" };
  const producer = vi.spyOn(shared, "rateSlip").mockReturnValue(correction);
  const input: Parameters<typeof easyRateSlip>[0] = { product, board, unit: "gms", rate: "66000", name: "Gold Ring 22K", easy: false };
  expect(easyRateSlip(input)).toEqual({
    ...correction, tick: "Yes, ₹66,000.00 a gram is right for Gold Ring 22K",
  });
  expect(producer).toHaveBeenCalledOnce();
  expect(producer).toHaveBeenCalledWith({ ...input, easy: true });
  expect(producer.mock.calls[0][0].product).toBe(product);
  expect(producer.mock.calls[0][0].board).toBe(board);
  expect(input.easy).toBe(false);
  // The correction is 66,000 / 10, rather than the board's 6,512.500.
  expect(correction.fix).not.toBe(board?.per_gram["gold-22K"]);
});

it("keeps the shared no-warning answer, including when no board was in force", () => {
  const producer = vi.spyOn(shared, "rateSlip").mockReturnValue(null);
  expect(easyRateSlip({ product, board: null, unit: "gms", rate: "6600", name: "Gold Ring 22K" })).toBeNull();
  expect(producer).toHaveBeenCalledOnce();
  expect(producer.mock.calls[0][0]).toMatchObject({ board: null, easy: true });
});
