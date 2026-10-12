import { afterEach, expect, it, vi } from "vitest";
import { api } from "./client";
import { downloadBackupFile } from "./backup";
import { problemOf } from "./errors";
import { serve } from "@/test/server";
const adapter = api.defaults.adapter;
afterEach(() => { api.defaults.adapter = adapter; vi.restoreAllMocks(); });
it("downloads the server blob with its filename, stream progress and a ten-minute timeout", async () => {
  const blob = new Blob(['{"version":"5.0"}'], { type: "application/json" });
  const progress = vi.fn();
  api.defaults.adapter = async (config) => {
    expect(config.url).toBe("backup/full/"); expect(config.responseType).toBe("blob"); expect(config.timeout).toBe(600_000);
    config.onDownloadProgress?.({ loaded: 2048, bytes: 2048, lengthComputable: false });
    return { status: 200, statusText: "", config, headers: { "content-disposition": 'attachment; filename="gst-backup-2026-10-08.json"' }, data: blob };
  };
  expect(await downloadBackupFile("backup/full/", {}, "backup.json", progress)).toEqual({ blob, name: "gst-backup-2026-10-08.json" });
  expect(progress).toHaveBeenCalledWith(2048);
});
it("keeps server export parameters and reads an encoded filename", async () => {
  api.defaults.adapter = async (config) => {
    expect(config.params).toEqual({ format: "csv", start_date: "2026-10-01", end_date: "2026-10-08", business_id: 3 }); expect(config.timeout).toBe(600_000);
    return { status: 200, statusText: "", config, headers: { "content-disposition": "attachment; filename*=UTF-8''Sales%20October.csv" }, data: new Blob(["Date,Total"]) };
  };
  expect((await downloadBackupFile("exports/sales/", { format: "csv", start_date: "2026-10-01", end_date: "2026-10-08", business_id: 3 }, "sales.csv")).name).toBe("Sales October.csv");
});
it("passes server download refusals to the shared error formatter", async () => {
  serve({ "GET exports/sales/": () => ({ status: 400, data: { end_date: ["The start date is after the end date."] } }) });
  const error = await downloadBackupFile("exports/sales/", {}, "sales.csv").catch((e: unknown) => e);
  expect(problemOf(error).message).toBe("The start date is after the end date.");
});

it("unwraps a JSON blob refusal so its exact server words reach the page", async () => {
  const payload = new Blob(['{"detail":"Only the owner can restore a backup."}'], { type: "application/json" });
  Object.defineProperty(payload, "text", { value: async () => '{"detail":"Only the owner can restore a backup."}' });
  serve({ "GET backup/full/": () => ({ status: 403, data: payload }) });
  const error = await downloadBackupFile("backup/full/", {}, "backup.json").catch((e: unknown) => e);
  expect(problemOf(error).message).toBe("Only the owner can restore a backup.");
});
