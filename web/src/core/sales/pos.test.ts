import { autoPos, effectiveType, gstinNote, isInterState, posOptions, segmentOf, stateNameOf, taxType } from "./pos";

test("a customer's type: as stored, else business with a GSTIN and person without", () => {
  expect(effectiveType("walkin", "")).toBe("walkin");
  expect(effectiveType("", "08ABCPK1234F1Z5")).toBe("business");
  expect(effectiveType("", "")).toBe("person");
});

test("a counter sale is taxed where it's handed over: the firm's state unless a registered buyer is elsewhere", () => {
  expect(autoPos("08", { type: "person", gst_number: "", state_code: "24" })).toBe("08");
  expect(autoPos("08", { type: "walkin", gst_number: "", state_code: "" })).toBe("08");
  expect(autoPos("08", { type: "business", gst_number: "27AAACK1234L1ZN", state_code: "27" })).toBe("27");
  expect(autoPos("08", null)).toBe("08");
  expect(isInterState("08", "27")).toBe(true);
  expect(isInterState("08", "08")).toBe(false);
  expect(taxType("08", "08", { type: "person", gst_number: "", state_code: "24" })).toEqual({ inter: false, short: "Local sale · CGST + SGST", why: "sold at the counter in Rajasthan" });
  expect(taxType("08", "08", { type: "business", gst_number: "27AAACK1234L1ZN", state_code: "27" }).why).toBe("handed over at the counter in Rajasthan");
  expect(taxType("08", "27", { type: "business", gst_number: "27AAACK1234L1ZN", state_code: "27" })).toEqual({ inter: true, short: "Inter-state · IGST", why: "delivered to Maharashtra" });
});

test("a registered buyer's state is their GSTIN's first two digits, whatever state is stored, as the server reads it", () => {
  const blank = { type: "business" as const, gst_number: "27AAACK1234L1ZN", state_code: "" };
  const stale = { type: "business" as const, gst_number: "27AAACK1234L1ZN", state_code: "08" };
  const inter = { inter: true, short: "Inter-state · IGST", why: "delivered to Maharashtra" };
  expect(autoPos("08", blank)).toBe("27");
  expect(taxType("08", autoPos("08", blank), blank)).toEqual(inter);
  expect(autoPos("08", stale)).toBe("27");
  expect(taxType("08", autoPos("08", stale), stale)).toEqual(inter);
  // handed over at the counter here, though the buyer is registered in Maharashtra; and a Rajasthan GSTIN is local whatever is stored
  expect(taxType("08", "08", stale).why).toBe("handed over at the counter in Rajasthan");
  expect(taxType("08", "08", { type: "business", gst_number: "08ABCPK1234F1Z5", state_code: "27" }).why).toBe("both in Rajasthan");
});

test("with no firm state known, no place of supply makes a sale inter-state (the server: bool(firm) and chosen != firm)", () => {
  expect(isInterState("", "27")).toBe(false);
  expect(isInterState("", "")).toBe(false);
});

test("GSTR-1's table: any GSTIN is B2B (a failing check digit too); an inter-state sale over ₹1 lakh without one is B2CL", () => {
  expect(segmentOf("08AAKFS4821M1Z5", false, 100)).toBe("b2b");
  expect(segmentOf("", true, 10000001)).toBe("b2cl");
  expect(segmentOf("", true, 10000000)).toBe("b2cs");
  expect(segmentOf("", false, 50000000)).toBe("b2cs");
});

test("a GSTIN that doesn't check out says what to fix, and the GSTR-1 table the bill files in (Ruling 1B-11)", () => {
  expect(gstinNote("08ABCPK1234F1Z5")).toBe("");
  expect(gstinNote("")).toBe("");
  // only its check character fails: still B2B (design decision 3)
  expect(gstinNote("08AAKFS4821M1Z5")).toBe("Its last character doesn't match, so you may have mistyped one character. The bill still files as B2B; check the GSTIN on the customer.");
  expect(segmentOf("08AAKFS4821M1Z5", false, 100)).toBe("b2b");
  // short, over-long or not starting with two digits: no GSTIN to GSTR-1 (the server's has_gstin), so B2C
  expect(gstinNote("08AAKFS4821M1Z")).toBe("A GSTIN has 15 characters; this has 14. The bill files as B2C until you fix the GSTIN on the customer.");
  expect(segmentOf("08AAKFS4821M1Z", false, 100)).toBe("b2cs");
  expect(gstinNote("08AAKFS4821M1Z55")).toBe("A GSTIN has 15 characters; this has 16. The bill files as B2C until you fix the GSTIN on the customer.");
  expect(gstinNote("AAAAKFS4821M1Z5")).toBe("This doesn't follow the GSTIN pattern (2 digits, PAN, entity number, Z, check character). The bill files as B2C until you fix the GSTIN on the customer.");
  expect(segmentOf("AAAAKFS4821M1Z5", false, 100)).toBe("b2cs");
  // 15 characters starting with two digits, off the pattern: the server still files it as B2B, so the note says so
  expect(gstinNote("08AAKFS4821M1X5")).toBe("This doesn't follow the GSTIN pattern (2 digits, PAN, entity number, Z, check character). The bill still files as B2B; fix the GSTIN on the customer.");
  expect(segmentOf("08AAKFS4821M1X5", false, 100)).toBe("b2b");
});

test("places of supply by code, the firm's state first; a code reads as its state's name", () => {
  expect(stateNameOf("08")).toBe("Rajasthan");
  expect(stateNameOf("25")).toBe("Daman and Diu");
  expect(stateNameOf("xx")).toBe("Unknown state");
  const opts = posOptions("08");
  expect(opts[0]).toEqual({ value: "08", label: "Rajasthan (08)" });
  expect(opts[1]).toEqual({ value: "35", label: "Andaman and Nicobar Islands (35)" });
  expect(opts).toHaveLength(39);
});
