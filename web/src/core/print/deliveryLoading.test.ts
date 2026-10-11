// A cold import of Sending must not fetch the PDF maker before the person's first PDF.
import { queryClient } from "@/core/api/query";
import { salesServer, wireDetail } from "@/core/sales/fixtures";
import { deliver } from "@/pages/sales/actions/deliver";
import { fakeToday } from "@/pages/sales/form/testing";

const loaded = vi.hoisted(() => vi.fn());
vi.mock("@/core/print/make", async (real) => {
  loaded();
  return {
    ...(await real<typeof import("@/core/print/make")>()),
    billFile: vi.fn(async () => ({ blob: new Blob(["pdf"]), name: "bill.pdf", sheets: 1 })),
  };
});

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); queryClient.clear(); });

test("Sending leaves the maker unloaded until the first PDF, and opens the computer's tab before loading it", async () => {
  fakeToday();
  expect(loaded).not.toHaveBeenCalled();
  salesServer([
    ["GET", "sales/412/", () => wireDetail()],
    ["GET", "shop-settings/", () => ({ copies: "original", show_bank: true })],
  ]);
  const open = vi.spyOn(window, "open").mockImplementation(() => {
    expect(loaded).not.toHaveBeenCalled();
    return { opener: null } as Window;
  });
  Object.assign(URL, { createObjectURL: vi.fn(() => "blob:pdf"), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const sent = deliver({ billId: 412, invoiceNumber: "KGH/2026-27/31", mobile: "9829041122", message: "Your bill", isPhone: false });
  expect(open).toHaveBeenCalledTimes(1);
  expect(await sent).toEqual({ via: "whatsapp", file: "bill.pdf" });
  expect(loaded).toHaveBeenCalledTimes(1);
});
