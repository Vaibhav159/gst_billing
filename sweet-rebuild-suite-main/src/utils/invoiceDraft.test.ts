import { describe, expect, it } from "vitest";
import { draftFromDuplicate, draftFromSaved, draftFromStored, lineMoney, lineToSave, storedLineKey, withProduct } from "./invoiceDraft";

// H17: line items have no product link, and the form used each line's own id
// as its "product id". Where that id matched a catalog product, saving the
// invoice (even to change the payment mode) rewrote the line's name, HSN and
// rate from that product. Duplicates came out as "Item" at 0%, and editing an
// amount-only line zeroed it.

const stored = {
  id: 7, product_name: "Ruby (Cut)", hsn_code: "710391", gst_tax_rate: "0.0025",
  quantity: "2.000", rate: "20000.000", amount: "40100.000", cgst: "50.000", sgst: "50.000", igst: "0.000", unit: "ct",
};
// The catalog product that happens to share the line's id.
const catalog7 = { id: "7", name: "Gold Ornaments 22K", hsn: "711319", gstRate: 3 };

describe("invoice drafts carry each line's own product (H17)", () => {
  it("keys a stored line apart from every catalog product", () => {
    expect(storedLineKey(7)).not.toBe(catalog7.id);
  });

  it("keeps a stored line's name, HSN and rate however its id collides", () => {
    const draft = draftFromStored(stored, "k1");
    expect(draft).toMatchObject({ productId: "line:7", productName: "Ruby (Cut)", hsn: "710391", gstRate: 0.25, qty: "2", rate: "20000", unit: "ct" });
    expect(lineToSave(draft, false)).toMatchObject({
      productName: "Ruby (Cut)", hsn: "710391", gstRate: 0.25, amount: 40100, cgst: 50, sgst: 50, igst: 0,
    });
  });

  it("keeps a duplicate's names and rates", () => {
    const item = { productId: "7", productName: "Ruby (Cut)", hsn: "710391", gstRate: 0.25, qty: 2, rate: 20000, unit: "ct",
                   amount: 40100, cgst: 50, sgst: 50, igst: 0 };
    expect(lineToSave(draftFromDuplicate(item, "k2"), false)).toMatchObject({ productName: "Ruby (Cut)", gstRate: 0.25, amount: 40100 });
  });

  it("loads an amount-only line as one unit at its taxable value, so saving keeps its amount", () => {
    const amountOnly = { ...stored, quantity: "0.000", rate: "0.000", amount: "10300.000", cgst: "150.000", sgst: "150.000", gst_tax_rate: "0.03" };
    const draft = draftFromStored(amountOnly, "k3");
    expect([draft.qty, draft.rate]).toEqual(["1", "10000"]);
    expect(lineToSave(draft, false).amount).toBe(10300);
  });

  it("keeps a weighed line's weight when it has no rate (review of H8)", () => {
    // 10 x 0 for Rs 10,000 of taxable is 10 x 1,000, not 1 x 10,000.
    const weighed = { ...stored, quantity: "10.000", rate: "0.000", amount: "10300.000", cgst: "150.000", sgst: "150.000", gst_tax_rate: "0.03" };
    const draft = draftFromStored(weighed, "k6");
    expect([draft.qty, draft.rate]).toEqual(["10", "1000"]);
    expect(lineToSave(draft, false).amount).toBe(10300);
  });

  it("takes name, HSN and rate from a product the user picks", () => {
    const draft = withProduct(draftFromStored(stored, "k4"), { ...catalog7, defaultUnit: "gms" });
    expect(draft).toMatchObject({ productId: "7", productName: "Gold Ornaments 22K", hsn: "711319", gstRate: 3, unit: "gms" });
  });

  it("files the tax under IGST when the invoice is inter-state", () => {
    expect(lineToSave(draftFromStored(stored, "k5"), true)).toMatchObject({ cgst: 0, sgst: 0, igst: 100, amount: 40100 });
  });
});

describe("a draft saved before H17 (review of H17)", () => {
  // Saved drafts held only each line's product id; the form looked the rest
  // up when it saved. Restored after H17, they were saved as "Item", no HSN, 0%.
  it("takes its name, HSN and rate from the product it names", () => {
    const old = { _key: "k1", productId: "7", qty: 2, rate: 6000, unit: "gms" as const };
    expect(draftFromSaved(old, [catalog7])).toMatchObject({
      productId: "7", productName: "Gold Ornaments 22K", hsn: "711319", gstRate: 3, qty: "2", rate: "6000",
    });
  });

  it("keeps a line that carries its own", () => {
    const line = { _key: "k2", productId: "line:7", productName: "Ruby (Cut)", hsn: "710391", gstRate: 0.25, qty: "1", rate: "20000", unit: "gms" as const };
    expect(draftFromSaved(line, [catalog7])).toEqual(line);
  });
});

describe("a line holds what was typed (UX7)", () => {
  // qty and rate were numbers in inputs that started at "1" and "0", so typing
  // "10.5" into a fresh quantity gave "10.51", a rate came out "06543.21", and
  // clearing a field put the 0 back. Lines keep the typed text; the money,
  // the save and the drafts read it.
  it("reads typed text for the money", () => {
    expect(lineMoney({ qty: "10.5", rate: "1000", gstRate: 3 })).toEqual({ amount: 10500, tax: 315 });
    expect(lineMoney({ qty: "1", rate: "6543.21", gstRate: 3 })).toEqual({ amount: 6543.21, tax: 196.3 });
  });

  it("counts an empty quantity as the 1 its placeholder shows, an empty rate as nothing", () => {
    expect(lineMoney({ qty: "", rate: "1000", gstRate: 3 })).toEqual({ amount: 1000, tax: 30 });
    expect(lineMoney({ qty: "2", rate: "", gstRate: 3 })).toEqual({ amount: 0, tax: 0 });
  });

  it("saves numbers", () => {
    const line = { ...draftFromStored(stored, "k7"), qty: "10.5", rate: "1000" };
    expect(lineToSave(line, false)).toMatchObject({ qty: 10.5, rate: 1000, amount: 10526.25, cgst: 13.13, sgst: 13.12 });
  });

  it("loads a stored line's figures as text", () => {
    expect(draftFromStored(stored, "k8")).toMatchObject({ qty: "2", rate: "20000" });
  });

  it("restores a draft saved while lines held numbers", () => {
    const saved = { _key: "k9", productId: "line:7", productName: "Ruby (Cut)", hsn: "710391", gstRate: 0.25, qty: 2, rate: 20000, unit: "ct" as const };
    const restored = draftFromSaved(saved, []);
    expect([restored.qty, restored.rate]).toEqual(["2", "20000"]);
    expect(lineToSave(restored, false).amount).toBe(40100);
  });
});
