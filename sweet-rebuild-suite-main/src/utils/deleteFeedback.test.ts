import { describe, it, expect, vi } from "vitest";
import { bulkDeleteToast, deleteEach, deleteWithFeedback } from "./deleteFeedback";

// What the shared axios instance rejects with when Django refuses.
const refusal = (status: number, data: unknown) =>
  Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data } });

describe("deleteWithFeedback — 'Deleted' only once the server has (H15)", () => {
  it("says Deleted after the server confirms", async () => {
    const toast = vi.fn();
    const ok = await deleteWithFeedback(() => Promise.resolve(), toast, { label: "Invoice", name: "INV-7" });
    expect(ok).toBe(true);
    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast.mock.calls[0][0]).toMatchObject({ title: "Invoice Deleted", description: "INV-7" });
  });

  it("shows the server's own reason when it refuses, and never says Deleted", async () => {
    const cases: [number, unknown, string][] = [
      [403, { detail: "You do not have permission to perform this action." }, "You do not have permission to perform this action."],
      [400, { error: "July 2026 is filed and locked." }, "July 2026 is filed and locked."],
      [409, { error: "This customer has 3 invoices." }, "This customer has 3 invoices."],
    ];
    for (const [status, data, reason] of cases) {
      const toast = vi.fn();
      const ok = await deleteWithFeedback(() => Promise.reject(refusal(status, data)), toast, { label: "Invoice", name: "INV-7" });
      expect(ok).toBe(false);
      expect(toast).toHaveBeenCalledTimes(1);
      const shown = toast.mock.calls[0][0];
      expect(shown.description).toBe(reason);
      expect(shown.title).toContain(`(${status})`);
      expect(shown.title).not.toMatch(/deleted/i);
    }
  });
});

describe("deleteEach + bulkDeleteToast — how many went, how many the server refused (H15)", () => {
  it("waits for every answer and keeps each refusal's reason", async () => {
    const remove = (id: string) =>
      id === "2" ? Promise.reject(refusal(400, { error: "Invoice 2 is in a filed month." })) : Promise.resolve();
    const result = await deleteEach(["1", "2", "3"], remove);
    expect(result).toEqual({ deleted: ["1", "3"], refused: [{ id: "2", reason: "Invoice 2 is in a filed month." }] });
    expect(bulkDeleteToast(result, "invoice")).toMatchObject({
      title: "2 invoices deleted, 1 refused",
      description: "Invoice 2 is in a filed month.",
    });
  });

  it("says plainly when everything went, and counts in the singular", () => {
    expect(bulkDeleteToast({ deleted: ["1", "2", "3"], refused: [] }, "invoice").title).toBe("3 invoices deleted");
    expect(bulkDeleteToast({ deleted: ["1"], refused: [{ id: "2", reason: "No." }] }, "invoice").title).toBe("1 invoice deleted, 1 refused");
  });

  it("names each distinct reason once", () => {
    const refused = [
      { id: "2", reason: "Filed month." }, { id: "3", reason: "Filed month." }, { id: "4", reason: "No permission." },
    ];
    expect(bulkDeleteToast({ deleted: [], refused }, "invoice").description).toBe("Filed month. · No permission.");
  });
});
