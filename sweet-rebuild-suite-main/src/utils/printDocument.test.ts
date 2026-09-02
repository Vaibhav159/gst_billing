import { describe, expect, it } from "vitest";
import { documentTitle, partyLabels, declarationText, withSignatureForPdf } from "./printDocument";

describe("purchase bills are not our tax invoices (audit B5)", () => {
  it("an outward invoice is a TAX INVOICE to a buyer", () => {
    expect(documentTitle({ type: "OUTWARD" })).toBe("TAX INVOICE");
    expect(partyLabels({ type: "OUTWARD" }).billTo).toBe("Buyer (Bill to)");
  });
  it("an inward bill is a PURCHASE RECORD from a supplier", () => {
    expect(documentTitle({ type: "INWARD" })).toBe("PURCHASE RECORD");
    expect(partyLabels({ type: "inward" }).billTo).toBe("Supplier (Bill from)");
    expect(declarationText({ type: "INWARD" })).toMatch(/not a tax invoice issued by us/);
  });
  it("a custom declaration still wins", () => {
    expect(declarationText({ type: "OUTWARD" }, "Goods once sold…")).toBe("Goods once sold…");
  });
});

describe("withSignatureForPdf (audit B9)", () => {
  it("uses the embedded base64 image, never a URL the renderer would have to fetch", () => {
    const biz = { id: 1, signature_image: "/media/sig.png", signature_image_base64: "data:image/png;base64,AAAA" };
    expect(withSignatureForPdf(biz).signature_image).toBe("data:image/png;base64,AAAA");
  });
  it("drops a raw URL when no base64 is available", () => {
    expect(withSignatureForPdf({ id: 1, signature_image: "/media/sig.png" }).signature_image).toBeNull();
  });
  it("survives a missing business", () => {
    expect(withSignatureForPdf(undefined).signature_image).toBeNull();
  });
});
