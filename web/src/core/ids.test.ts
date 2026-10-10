import { checkGstin, cleanGstin, cleanPan, effectivePan, emailProblem, formatMobile, GST_STATES, gstinCheckDigit, gstinPan, hasGstin, looksLikePhone, mobileDigits, mobileProblem, panProblem, stateCodeOf, stateLabel, stateOptions, stateTitle } from "./ids";

// Known-real: v2's test vectors (a firm's own GSTIN and GSTN's documented example), and the prototype's Kulkarni Jewellers
const REAL = ["08AAGPL3375F1ZO", "27AAPFU0939F1ZV", "27XTZPS7585P1ZB"];

test("the check character matches the server's (billing/gstin.py) on known GSTINs", () => {
  expect(gstinCheckDigit("08AAGPL3375F1Z")).toBe("O");
  expect(gstinCheckDigit("27AAPFU0939F1Z")).toBe("V");
  // the total that comes to a multiple of 36 gives "0" (the % 36 after 36 - …), the server's answer too
  expect(gstinCheckDigit("08AAGPL3375FPZ")).toBe("0");
  // typed in lower case, the same character: the check reads it upper-cased
  expect(gstinCheckDigit("08aagpl3375f1z")).toBe("O");
  for (const g of REAL) expect(checkGstin(g), g).toMatchObject({ status: "valid" });
});

test("a GSTIN that fails only its check character is a warning that keeps the state, not a refusal, and gives no PAN", () => {
  const c = checkGstin("08AAAAA0000A1Z5");
  expect(c).toEqual({ status: "check", warning: expect.stringContaining("still go to GSTR-1 as B2B"), code: "08", state: "RAJASTHAN" });
  expect(gstinPan("08AAAAA0000A1Z5")).toBe("");
  expect(gstinPan("27XTZPS7585P1ZB")).toBe("XTZPS7585P");
});

test("short, misshapen and unknown-state GSTINs say what's wrong in plain words", () => {
  expect(checkGstin("")).toEqual({ status: "empty" });
  expect(checkGstin("08AAGPL33")).toEqual({ status: "short", length: 9, problem: "A GSTIN has 15 characters; this has 9." });
  expect(checkGstin("08AAGPL3375F1XO")).toMatchObject({ status: "invalid", problem: "This doesn't follow the GSTIN pattern (2 digits, PAN, entity number, Z, check character)." });
  expect(checkGstin("28AAGPL3375F1ZO")).toMatchObject({ status: "invalid", problem: "28 isn't a state code." });
  expect(checkGstin("08AAGPL3375F1ZO9")).toEqual({ status: "invalid", problem: "A GSTIN has 15 characters; this has 16." });
  expect(checkGstin(" 27aapfu0939f1zv ")).toMatchObject({ status: "valid", code: "27", state: "MAHARASHTRA", pan: "AAPFU0939F" });
});

test("hasGstin is the server's loose test; cleanGstin keeps what a GSTIN box may hold", () => {
  expect(hasGstin("08ABCDE1234A1Z5")).toBe(true);
  for (const v of ["", "NA", "URP", "UNREGISTERED123", "08AAGPL3375F1Z", null, undefined]) expect(hasGstin(v), String(v)).toBe(false);
  expect(cleanGstin("08 aagpl-3375f1zo99")).toBe("08AAGPL3375F1ZO");
});

test("PAN: the pattern, upper case, and the PAN that counts (typed, else from a GSTIN that passes)", () => {
  expect(panProblem("")).toBe("");
  expect(panProblem("abcde1234f")).toBe("");
  expect(panProblem("ABCDE12345")).toBe("A PAN has 10 characters: 5 letters, 4 digits, then a letter (like ABCDE1234F).");
  expect(cleanPan("abcde 1234 f9")).toBe("ABCDE1234F");
  expect(effectivePan("", "27XTZPS7585P1ZB")).toBe("XTZPS7585P");
  expect(effectivePan("AAKFS4821M", "27XTZPS7585P1ZB")).toBe("AAKFS4821M");
  expect(effectivePan(" aakfs4821m ", "")).toBe("AAKFS4821M");
  expect(effectivePan("", "08AAAAA0000A1Z5")).toBe("");
});

test("a typed PAN counts only with a PAN's shape: a placeholder v2's imports kept falls through to the GSTIN's PAN (Ruling 1A-20)", () => {
  for (const junk of ["N/A", "NA", "-", ""]) {
    expect(effectivePan(junk, ""), junk).toBe("");
    expect(effectivePan(junk, "27XTZPS7585P1ZB"), junk).toBe("XTZPS7585P");
  }
  expect(effectivePan("ABCDE12345", "27XTZPS7585P1ZB")).toBe("XTZPS7585P");
  expect(effectivePan(" abcde 1234f ", "")).toBe("ABCDE1234F");
  expect(effectivePan(null, undefined)).toBe("");
});

test("+91 typed a key at a time into a box that tidies each key (the customer form's): the + goes at once, the 91 stays until an 11th digit", () => {
  // the form's Mobile number box puts formatMobile(what's there + the key) back in the box at every key
  let box = "";
  const shown = [..."+91 98290 41122"].map((key) => (box = formatMobile(box + key)));
  expect(shown).toEqual([
    "", "9", "91", "91", "919", "9198", "91982", "91982 9", "91982 90", "91982 90", "91982 904", "91982 9041",
    // ten digits read as a number that starts with 91, as one may (91166 12345): only the 11th says the 91 was the country code
    "91982 90411", "98290 4112", "98290 41122",
  ]);
  // a pasted number, + and all, is its ten digits at once
  expect(formatMobile("+91 98290 41122")).toBe("98290 41122");
  // the other side of the rule: an 11th digit typed by mistake after a number that starts with 91 takes the 91 away, and
  // the 9 digits left are refused in words
  expect(formatMobile("91166 123456")).toBe("16612 3456");
  expect(mobileProblem("91166 123456")).toBe("A mobile number has 10 digits; this has 9.");
});

test("mobile numbers: +91 and a leading 0 drop, ten digits read in two groups, and the problems in words", () => {
  expect(mobileDigits("+91 98290 41122")).toBe("9829041122");
  expect(mobileDigits("098290 41122")).toBe("9829041122");
  expect(formatMobile("+91 98290 41123")).toBe("98290 41123");
  expect(formatMobile("98290411229999")).toBe("98290 41122");
  expect(mobileProblem("")).toBe("");
  expect(mobileProblem("98290 4112")).toBe("A mobile number has 10 digits; this has 9.");
  expect(mobileProblem("98290411229999")).toBe("A mobile number has 10 digits; this has 14.");
  expect(mobileProblem("5829041122")).toBe("Indian mobile numbers start with 6, 7, 8 or 9. Check the first digit.");
  expect(mobileProblem("98290 41122")).toBe("");
});

test("what's typed reads as a phone number when it's digits, spaces and dashes (a + in front too), 3 digits or more", () => {
  expect(["98290 41122", "+91 98290-41122", "982", " 0294 241 2345 "].map(looksLikePhone)).toEqual([true, true, true, true]);
  expect(["98", "Anil", "Shop 123", "27XTZPS7585P1ZB", "", null].map(looksLikePhone)).toEqual([false, false, false, false, false, false]);
});

test("email: empty is fine; a half-typed one says how it should look", () => {
  expect(emailProblem("")).toBe("");
  expect(emailProblem("anil@example.com")).toBe("");
  expect(emailProblem("anil@example")).toBe("That email looks incomplete. It should look like name@example.com.");
});

test("states: the server's names, read as words with their codes, home first in the picker", () => {
  expect(Object.keys(GST_STATES)).toHaveLength(39);
  expect(stateTitle("JAMMU AND KASHMIR")).toBe("Jammu and Kashmir");
  expect(stateCodeOf("Rajasthan")).toBe("08");
  expect(stateCodeOf("JAMMU & KASHMIR")).toBe("01");
  // the server reads "&" as " AND " (tax_rules.normalize_state_name), so an "&" with no spaces round it is the same state
  expect(stateCodeOf("JAMMU&KASHMIR")).toBe("01");
  expect(stateLabel("MAHARASHTRA")).toBe("Maharashtra (27)");
  expect(stateLabel("")).toBe("No state");
  // a name the table doesn't have reads in title case, as the table's own names do (kept as the person typed it, it would
  // shout "NARNIA" beside "Rajasthan (08)")
  expect(stateLabel("Narnia")).toBe("Narnia");
  expect(stateLabel("NARNIA")).toBe("Narnia");
  expect(stateLabel("  narnia &  beyond ")).toBe("Narnia and Beyond");
  const opts = stateOptions("RAJASTHAN");
  expect(opts[0]).toEqual({ value: "RAJASTHAN", label: "Rajasthan (08)" });
  expect(opts[1]).toEqual({ value: "ANDAMAN AND NICOBAR ISLANDS", label: "Andaman and Nicobar Islands (35)" });
  expect(opts).toHaveLength(39);
});
