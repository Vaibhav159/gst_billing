import { billMessage, DEFAULT_SHARE_MESSAGE, mobileOf, sentToast, waLink } from "./share";

// total: the bill's exact total in paise; nothing rounds it to the rupee (Ruling 1B-12)
const bill = { invoice_number: "KGH/2026-27/31", invoice_date: "2026-10-08", total: 8708321, firm: "KIRAN GOLD HOUSE", customer: { name: "Anil Gupta", type: "person" as const } };

test("the message fills every placeholder from the shop's settings; a walk-in is “ji”", () => {
  expect(billMessage(DEFAULT_SHARE_MESSAGE, bill)).toBe("Namaste Anil Gupta, your bill KGH/2026-27/31 for ₹87,083.21 from KIRAN GOLD HOUSE is attached. Thank you!");
  expect(billMessage("", bill)).toBe(billMessage(DEFAULT_SHARE_MESSAGE, bill));
  expect(billMessage("Namaste {customer} ji, bill {number} dated {date}.", { ...bill, customer: { name: "Walk-in Customer", type: "walkin" } })).toBe("Namaste ji, bill KGH/2026-27/31 dated 08 Oct 2026.");
});

test("a mobile number from what was typed, as it's read out; anything else is no number", () => {
  expect(mobileOf("98290 41122")).toBe("98290 41122");
  expect(mobileOf("+91 98290-41122")).toBe("98290 41122");
  expect(mobileOf("09829041122")).toBe("98290 41122");
  expect(mobileOf("5829041122")).toBe("");
  expect(mobileOf("12345")).toBe("");
});

test("the WhatsApp link carries the number with 91 and the message", () => {
  expect(waLink("98290 41122", "Hi there")).toBe("https://wa.me/919829041122?text=Hi%20there");
  expect(waLink("", "x")).toBe("https://wa.me/?text=x");
});

test("what sending did, in the app's words, with and without a PDF", () => {
  expect(sentToast({ number: "KGH/2026-27/31", again: false, who: "Anil Gupta", mobile: "98290 41122", file: null, isPhone: false }))
    .toEqual({ title: "KGH/2026-27/31 sent", body: "WhatsApp opens a chat with Anil Gupta (+91 98290 41122), with the bill's message typed in." });
  expect(sentToast({ number: "KGH/2026-27/33", again: true, who: "+91 98290 41122", mobile: "", file: "KGH_2026-27_33.pdf", isPhone: false }))
    .toEqual({ title: "KGH/2026-27/33 sent again", body: "KGH_2026-27_33.pdf downloads and WhatsApp opens a chat with +91 98290 41122. Attach the PDF there." });
});
