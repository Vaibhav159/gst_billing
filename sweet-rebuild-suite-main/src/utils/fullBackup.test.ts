/**
 * The full backup (UX1). "JSON Backup" applied the page's FY filter and
 * "Export All Data" took the invoice list's first page, so a "full backup"
 * held 149 of 435 invoices (or the latest 50) while the toast counted 197
 * records. These pin that a backup walks every page of every list, with no
 * FY, firm or type filter, counts what it actually holds, and is a file the
 * restore path reads.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const post = vi.fn();
vi.mock("@/utils/api", () => ({ default: { get: (url: string) => get(url), post: (url: string, body: unknown) => post(url, body) } }));

import { backupToast, buildFullBackup, describeCounts, restorePrompt, saveFullBackup } from "./fullBackup";
import { restoreBackup } from "./restoreBackup";

const line = { id: 1, product_name: "Gold Chain", hsn_code: "711319", gst_tax_rate: "0.0300", quantity: "10.000",
  rate: "6000.00", amount: "61800.00", cgst: "900.00", sgst: "900.00", igst: "0.00", unit: "gms" };
const invoice = (id: number, type: "outward" | "inward", date: string) => ({
  id, invoice_number: String(id), invoice_date: date, type_of_invoice: type, business: 1, business_name: "LODHA JEWELLERS",
  customer: 7, customer_name: "A BUYER", total_amount: "61800.00", line_items: [{ ...line, id: id * 10 }],
});

// Invoices over three pages and two financial years, sales and purchases;
// customers over two pages. DRF's `next` is an absolute URL.
const next = (path: string, page: number) => `http://testserver/api/${path}?include_items=true&page=${page}&page_size=200`;
const lists: Record<string, Record<string, { results: unknown[]; next: string | null }>> = {
  "invoices/": {
    "1": { results: [invoice(1, "outward", "2026-05-01"), invoice(2, "inward", "2026-04-15")], next: next("invoices/", 2) },
    "2": { results: [invoice(3, "outward", "2025-12-01"), invoice(4, "outward", "2025-04-01")], next: next("invoices/", 3) },
    "3": { results: [invoice(5, "inward", "2025-05-10")], next: null },
  },
  "businesses/": { "1": { results: [{ id: 1, name: "LODHA JEWELLERS", gst_number: "08ABCDE1234A1Z5", state_name: "RAJASTHAN" }], next: null } },
  "customers/": {
    "1": { results: [{ id: 7, name: "A BUYER", gst_number: "08AAAAA0000A1Z5" }], next: "http://testserver/api/customers/?page=2&page_size=1000" },
    "2": { results: [{ id: 8, name: "B BUYER", gst_number: "" }], next: null },
  },
  "products/": { "1": { results: [{ id: 3, name: "Gold Chain", hsn_code: "711319", gst_tax_rate: "0.0300" }], next: null } },
};

const requested = () => get.mock.calls.map(([url]) => new URL(url as string, "http://testserver/api/"));
// What the server says it holds, per list (DRF's `count`, on every page).
const counts: Record<string, number> = { "invoices/": 5, "businesses/": 1, "customers/": 2, "products/": 1 };

beforeEach(() => {
  get.mockReset();
  get.mockImplementation((url: string) => {
    const u = new URL(url, "http://testserver/api/");
    const path = u.pathname.replace(/^\/api\//, "");
    const page = lists[path]?.[u.searchParams.get("page") || "1"];
    return page ? Promise.resolve({ data: { count: counts[path], ...page } }) : Promise.reject(new Error(`unexpected ${url}`));
  });
});

describe("buildFullBackup — everything on file, whatever the page's filters say (UX1)", () => {
  it("walks every page of every list", async () => {
    const backup = await buildFullBackup();
    expect(backup.invoices.map((i) => i.id)).toEqual([1, 2, 3, 4, 5]);
    expect(backup.customers.map((c) => c.id)).toEqual([7, 8]);
    expect(backup.businesses.map((b) => b.name)).toEqual(["LODHA JEWELLERS"]);
    expect(backup.products.map((p) => p.name)).toEqual(["Gold Chain"]);
    const invoicePages = requested().filter((u) => u.pathname.endsWith("/invoices/"));
    expect(invoicePages.map((u) => u.searchParams.get("page") || "1")).toEqual(["1", "2", "3"]);
    expect(invoicePages[0].searchParams.get("include_items")).toBe("true");
  });

  it("asks for no financial year, date range, firm or invoice type", async () => {
    await buildFullBackup();
    for (const u of requested()) {
      for (const filter of ["start_date", "end_date", "business_id", "type_of_invoice", "fy", "month"]) {
        expect(u.searchParams.has(filter), `${u.pathname}${u.search} carries ${filter}`).toBe(false);
      }
    }
  });

  it("counts what the file holds, purchases included", async () => {
    const backup = await buildFullBackup();
    expect(backup.counts).toEqual({ businesses: 1, customers: 2, products: 1, invoices: 5, inwardBills: 2 });
    expect(backup.totalRecords).toBe(9);
    expect(describeCounts(backup.counts)).toBe("1 business, 2 customers, 1 product, 5 invoices (2 inward bills)");
  });

  it("keeps an invoice once when a page walk sees it twice", async () => {
    // A bill saved at the counter while the backup runs pushes every row one
    // place down the newest-first list: the last row of a page comes back as
    // the first of the next.
    lists["invoices/"]["2"].results.unshift(invoice(2, "inward", "2026-04-15"));
    try {
      const backup = await buildFullBackup();
      expect(backup.invoices.map((i) => i.id)).toEqual([1, 2, 3, 4, 5]);
      expect(backup.counts.invoices).toBe(5);
    } finally {
      lists["invoices/"]["2"].results.shift();
    }
  });

  it("is a file restore reads: every invoice reaches bulk import with its firm, party and lines", async () => {
    const backup = JSON.parse(JSON.stringify(await buildFullBackup()));
    const posts: { url: string; body: any }[] = [];
    const api = {
      get: vi.fn(async () => ({ data: { results: [], next: null } })),
      post: vi.fn(async (url: string, body: any) => {
        posts.push({ url, body });
        return { data: url.includes("bulk-import") ? { created: 5, skipped: 0, errors: [] } : { id: posts.length } };
      }),
    };
    const report = await restoreBackup(backup, api as any);
    expect([report.businesses, report.customers, report.products]).toEqual([1, 2, 1]);
    const sent = posts.filter((p) => p.url === "invoices/bulk-import/").flatMap((p) => p.body.invoices);
    expect(sent.map((r: any) => [r.invoiceNumber, r.type])).toEqual([
      ["1", "OUTWARD"], ["2", "INWARD"], ["3", "OUTWARD"], ["4", "OUTWARD"], ["5", "INWARD"],
    ]);
    expect(sent[0]).toMatchObject({ firmName: "LODHA JEWELLERS", firmGSTIN: "08ABCDE1234A1Z5", customerName: "A BUYER",
      customerGST: "08AAAAA0000A1Z5", total: 61800 });
    expect(sent[0].items[0]).toMatchObject({ productName: "Gold Chain", hsn: "711319", gstRate: 3, qty: 10, rate: 6000, amount: 61800 });
    // The product's stored fraction goes back as stored, not through a percent.
    expect(posts.find((p) => p.url === "products/")!.body.gst_tax_rate).toBe("0.0300");
  });
});

describe("a backup checks itself against the server's counts (R1)", () => {
  it("notes nothing when every list came back whole", async () => {
    const backup = await buildFullBackup();
    expect(backup.warnings).toEqual([]);
    expect(backupToast(backup)).toMatchObject({ title: "Backup Downloaded" });
  });

  it("writes a shortfall into the file and says so", async () => {
    // A row deleted mid-walk moves the next one past a page boundary unseen.
    counts["invoices/"] = 6;
    try {
      const backup = await buildFullBackup();
      expect(backup.warnings).toEqual([
        "invoices: 5 saved, but the server counted 6. Records changed while the backup ran; take another.",
      ]);
      expect(JSON.parse(JSON.stringify(backup)).warnings).toHaveLength(1);
      expect(backupToast(backup)).toMatchObject({
        title: "Backup Downloaded, with a warning", variant: "destructive",
        description: expect.stringContaining("invoices: 5 saved, but the server counted 6"),
      });
    } finally {
      counts["invoices/"] = 5;
    }
  });
});

describe("saveFullBackup (M7)", () => {
  beforeEach(() => {
    post.mockReset();
    Object.assign(window.URL, { createObjectURL: vi.fn(() => "blob:backup"), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  it("records the backup in the audit log, as Bulk PDF records its downloads", async () => {
    post.mockResolvedValue({ data: { status: "logged" } });
    const { backup } = await saveFullBackup();
    expect(backup.counts.invoices).toBe(5);
    expect(post).toHaveBeenCalledWith("audit-logs/log/", expect.objectContaining({
      action: "exported", entity: "invoice", entity_id: 0,
      entity_name: "Full backup (9 records)",
      details: expect.stringContaining("1 business, 2 customers, 1 product, 5 invoices (2 inward bills)"),
    }));
  });

  it("still saves the file when the audit log can't be written", async () => {
    post.mockRejectedValue(new Error("offline"));
    await expect(saveFullBackup()).resolves.toMatchObject({ backup: { totalRecords: 9 } });
  });
});

describe("the backup file (R2)", () => {
  const readText = (blob: Blob) => new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsText(blob);
  });

  it("is written without indentation, a third smaller", async () => {
    let saved: Blob | undefined;
    Object.assign(window.URL, { createObjectURL: vi.fn((b: Blob) => { saved = b; return "blob:backup"; }), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    post.mockResolvedValue({ data: {} });
    const { backup, bytes } = await saveFullBackup();
    const text = await readText(saved!);
    expect(text).not.toContain("\n");
    expect(JSON.parse(text)).toEqual(JSON.parse(JSON.stringify(backup)));
    expect(bytes).toBeLessThan(JSON.stringify(backup, null, 2).length * 0.8);
  });

  it("restores the same from an indented file, as older backups were written", async () => {
    const backup = await buildFullBackup();
    const restoreFrom = async (text: string) => {
      const posts: { url: string; body: any }[] = [];
      const api = {
        get: vi.fn(async () => ({ data: { results: [], next: null } })),
        post: vi.fn(async (url: string, body: any) => {
          posts.push({ url, body });
          return { data: url.includes("bulk-import") ? { created: 5, skipped: 0, errors: [] } : { id: posts.length } };
        }),
      };
      await restoreBackup(JSON.parse(text), api as any);
      return posts;
    };
    const fromIndented = await restoreFrom(JSON.stringify(backup, null, 2));
    expect(fromIndented.filter((p) => p.url === "invoices/bulk-import/").flatMap((p) => p.body.invoices)).toHaveLength(5);
    expect(fromIndented).toEqual(await restoreFrom(JSON.stringify(backup)));
  });
});

describe("restorePrompt — the confirmation states true counts (UX1)", () => {
  it("says what the file holds and what is on file now", () => {
    const text = restorePrompt(
      "gst-backup-2026-10-08.json",
      { businesses: 3, customers: 35, products: 10, invoices: 435, inwardBills: 110 },
      { businesses: 3, customers: 35, products: 10, invoices: 435, inwardBills: 110 },
    );
    expect(text).toContain('Restore from "gst-backup-2026-10-08.json"?');
    expect(text).toContain("This backup holds: 3 businesses, 35 customers, 10 products, 435 invoices (110 inward bills)");
    expect(text).toContain("On file now: 3 businesses, 35 customers, 10 products, 435 invoices (110 inward bills)");
    expect(text).toContain("Nothing is deleted.");
  });

  it("groups digits the Indian way", () => {
    expect(describeCounts({ businesses: 3, customers: 1234, products: 0, invoices: 123456, inwardBills: 0 }))
      .toBe("3 businesses, 1,234 customers, 0 products, 1,23,456 invoices");
  });
});
