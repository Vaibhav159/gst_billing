import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "@/core/api/client";
import perms from "@/core/auth/perms.json";
import type { Action } from "@/core/auth/permissions";
import { serve } from "@/test/server";
import { renderApp } from "@/test/render";
import { ScopeProvider } from "@/core/scope";
import { saveFile } from "@/core/print/files";
import Backup from "./Backup";

vi.mock("@/core/print/files", () => ({ saveFile: vi.fn() }));
const adapter = api.defaults.adapter;
export const summary = {
  counts: { firms: 3, customers: 29, suppliers: 8, products: 17, sales: 332, cancelled: 2, purchases: 111, people: 4, audit: 5123, bin: 3 },
  years: [{ fy: "2025-26", sales: 228, cancelled: 1, purchases: 74 }, { fy: "2026-27", sales: 104, cancelled: 1, purchases: 37 }],
  recent: [{ audit_id: 9001, at: "2026-10-01T21:05:00+05:30", by: { id: 1, name: "Kailash Mehta" }, file: "gst-backup-2026-10-01.json", size: "1.9 MB" }],
  last_backup_at: "2026-10-01T21:05:00+05:30", estimated_size: "2.0 MB",
};
function server(extra = {}) { return serve({
  "GET preferences/": { data: {} }, "GET businesses/": [{ id: 3, name: "AARAV JEWELLERS" }], "GET backup/summary/": summary,
  "GET backup/full/": new Blob(["backup"]), "GET exports/sales/": new Blob(["csv"]), "GET exports/customers/": new Blob(["csv"]), ...extra,
}); }
function open(role: "owner" | "accountant" | "staff" | "viewer" = "owner") {
  return renderApp(<ScopeProvider><Backup /></ScopeProvider>, { me: { role, permissions: perms.perms[role] as "*" | Action[] } });
}
beforeEach(() => { localStorage.clear(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-10-08T12:00:00+05:30")); });
afterEach(() => { api.defaults.adapter = adapter; vi.useRealTimers(); vi.clearAllMocks(); });

it("shows whole summary counts, years, recent backups and truthful exclusions", async () => {
  server(); open();
  expect(await screen.findByText(/FY 2025-26: 228 sales bills/)).toBeVisible();
  expect(screen.getByText(/5,123 audit entries/)).toBeVisible();
  expect(screen.getByText("gst-backup-2026-10-01.json")).toBeVisible();
  expect(screen.getByText(/signature pictures, passwords and PDFs/)).toBeVisible();
  expect(screen.queryByText(/every night, for 30 days/)).not.toBeInTheDocument();
});

it("makes a full server backup without a firm or year filter and saves the blob", async () => {
  const calls = server(); open();
  fireEvent.click(await screen.findByRole("button", { name: "Download full backup" }));
  await waitFor(() => expect(saveFile).toHaveBeenCalledTimes(1));
  expect(calls.find((c) => c.url === "backup/full/")?.params).toEqual({});
  expect(screen.getByText("gst-backup-2026-10-08.json is ready")).toBeVisible();
});

it.each(["accountant", "staff", "viewer"] as const)("gates the full backup for %s while keeping exports", async (role) => {
  server(); open(role);
  const button = await screen.findByRole("button", { name: "Download full backup" });
  if (role === "accountant") expect(button).toBeEnabled(); else expect(button).toBeDisabled();
  expect(screen.getByRole("button", { name: "Customers as CSV" })).toBeEnabled();
});

it("sends only the selected export scope and disables bad date ranges", async () => {
  const calls = server(); open();
  const period = await screen.findByLabelText("Period");
  fireEvent.change(period, { target: { value: "dates" } });
  fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-09" } });
  expect(screen.getByRole("button", { name: "Sales bills as CSV" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Customers as CSV" })).toBeEnabled();
  fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-10-01" } });
  fireEvent.change(screen.getByLabelText("Firm"), { target: { value: "3" } });
  fireEvent.click(screen.getByRole("button", { name: "Sales bills as CSV" }));
  await waitFor(() => expect(saveFile).toHaveBeenCalled());
  expect(calls.find((c) => c.url === "exports/sales/")?.params).toEqual({ format: "csv", business_id: 3, start_date: "2026-10-01", end_date: "2026-10-08" });
  fireEvent.click(screen.getByRole("button", { name: "Customers as CSV" }));
  await waitFor(() => expect(calls.some((c) => c.url === "exports/customers/")).toBe(true));
  expect(calls.find((c) => c.url === "exports/customers/")?.params).toEqual({ format: "csv" });
});

it("keeps a failed download retryable and never saves a failed response", async () => {
  server({ "GET backup/full/": () => ({ status: 403, data: { detail: "Only the owner and accountant can download backups." } }) }); open();
  fireEvent.click(await screen.findByRole("button", { name: "Download full backup" }));
  expect(await screen.findByText("Only the owner and accountant can download backups.")).toBeVisible();
  expect(screen.getByRole("button", { name: "Download full backup" })).toBeEnabled();
  expect(saveFile).not.toHaveBeenCalled();
});

it("has a phone layout and refreshes summary only after a real download", async () => {
  (window as unknown as { __phone?: boolean }).__phone = true;
  const calls = server(); open();
  await screen.findByText("Full backup");
  act(() => { vi.setSystemTime(new Date("2026-10-09T12:00:00+05:30")); window.dispatchEvent(new Event("focus")); });
  expect(calls.filter((c) => c.url === "backup/summary/")).toHaveLength(1);
  (window as unknown as { __phone?: boolean }).__phone = false;
});
