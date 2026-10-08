/**
 * The Backup page's export panel (UX1).
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

import DataExportPanel from "./DataExportPanel";

const props = {
  onFile: { businesses: 3, customers: 35, products: 10, invoices: 435, inwardBills: 110 },
  invoiceScope: { query: "page_size=200&start_date=2026-04-01&end_date=2027-03-31", label: "FY 2026-27", count: 149 },
};

describe("DataExportPanel (UX1)", () => {
  it("names each export's scope and count", () => {
    render(<DataExportPanel {...props} onFullBackup={vi.fn()} />);
    expect(screen.getByRole("button", { name: "All Data · all years (483)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Invoices · FY 2026-27 (149)" })).toBeInTheDocument();
  });

  it("says Exported only when the full backup was saved", async () => {
    const onFullBackup = vi.fn().mockResolvedValue(false); // the page toasted "Export Failed"
    render(<DataExportPanel {...props} onFullBackup={onFullBackup} />);
    fireEvent.click(screen.getByRole("button", { name: /^JSON/ }));
    fireEvent.click(screen.getByRole("button", { name: /Download Full Backup/ }));
    await waitFor(() => expect(onFullBackup).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("button", { name: /Download Full Backup/ })).toBeEnabled());
    expect(screen.queryByText("Exported!")).toBeNull();
  });

  it("starts one backup at a time", async () => {
    let finish: (saved: boolean) => void = () => {};
    const onFullBackup = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    render(<DataExportPanel {...props} onFullBackup={onFullBackup} />);
    fireEvent.click(screen.getByRole("button", { name: /^JSON/ }));
    const download = screen.getByRole("button", { name: /Download Full Backup/ });
    fireEvent.click(download);
    fireEvent.click(screen.getByRole("button", { name: /Exporting|Download Full Backup/ }));
    expect(onFullBackup).toHaveBeenCalledTimes(1);
    finish(true);
    expect(await screen.findByText("Exported!")).toBeInTheDocument();
  });
});
