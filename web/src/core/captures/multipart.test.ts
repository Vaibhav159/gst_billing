import { describe, expect, it, vi } from "vitest";
import { assertMultipartSize, captureFormData, MAX_REQUEST_BYTES } from "./multipart";

const id = "00000000-0000-4000-8000-000000000007";
const file = (size: number, name = "bill.pdf", type = "application/pdf") => new File([new Uint8Array(size)], name, { type });
const filesNearLimit = (headroom: number, name = "bill.pdf") => [
  file(12 * 1024 * 1024, name), file(12 * 1024 * 1024 - headroom, name),
];
const message = "These pages come to 24.1 MB. One bill can send at most 24 MB; take fewer or smaller pages.";

describe("complete capture multipart size", () => {
  it("builds the same ordered files and optional fields as the capture API", () => {
    const files = [file(20, "front.pdf"), file(30, "back.pdf")];
    const data = captureFormData({ files, client_id: id, business_id: 3, hint: "Solanki", note: "counter", label: "Bill photo" });
    expect(data.getAll("files").map((entry) => ({ name: (entry as File).name, size: (entry as File).size }))).toEqual([
      { name: "front.pdf", size: 20 }, { name: "back.pdf", size: 30 },
    ]);
    expect([...data.keys()]).toEqual(["files", "files", "client_id", "business_id", "hint", "note", "label"]);
    expect(data.get("client_id")).toBe(id); expect(data.get("business_id")).toBe("3");
    expect(data.get("hint")).toBe("Solanki"); expect(data.get("note")).toBe("counter"); expect(data.get("label")).toBe("Bill photo");
    const without = captureFormData({ files: [files[0]], client_id: id, business_id: null, hint: "", note: "", label: "" });
    expect([...without.keys()]).toEqual(["files", "client_id"]);
  });

  it("rejects files that alone fit exactly 24 MiB because the multipart body is larger", () => {
    const files = filesNearLimit(0);
    expect(files.reduce((sum, value) => sum + value.size, 0)).toBe(MAX_REQUEST_BYTES);
    expect(() => captureFormData({ files, client_id: id })).toThrow(message);
    expect(() => captureFormData({ files: filesNearLimit(16 * 1024), client_id: id })).not.toThrow();
  });

  it("counts long Unicode filenames and metadata rather than using a fixed reserve alone", () => {
    const name = `${"账😀\"\n".repeat(2000)}.pdf`;
    const files = filesNearLimit(64 * 1024, name);
    expect(() => captureFormData({ files, client_id: id, note: "账😀\n".repeat(8000) })).toThrow(/One bill can send at most 24 MB; take fewer or smaller pages\./);
  });

  it("counts UTF-8 and normalized CRLF field values for other upload callers", () => {
    const data = new FormData();
    data.append("files", file(MAX_REQUEST_BYTES - 10 * 1024));
    data.append("note", "账\n".repeat(2000));
    // 8,000 source UTF-8 bytes become 10,000 after CRLF normalization, before boundaries and headers.
    expect(() => assertMultipartSize(data)).toThrow(message);
  });

  it("bounds quoted header names, filenames and MIME types without reading any file bytes", () => {
    const data = new FormData();
    data.append("part\"\r\n\\".repeat(1200), file(MAX_REQUEST_BYTES - 16 * 1024, "x\"\n".repeat(1200), `text/${"x".repeat(4000)}`));
    const entry = data.values().next().value as File;
    const arrayBuffer = vi.fn(() => { throw new Error("must not read the file"); });
    Object.defineProperty(entry, "arrayBuffer", { value: arrayBuffer });
    expect(() => assertMultipartSize(data)).toThrow(/One bill can send at most 24 MB/);
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it("accounts for every part and the closing boundary at the conservative cutoff", () => {
    const data = new FormData();
    // Each of these 1,000 empty fields still needs a boundary and disposition header.
    for (let index = 0; index < 1000; index++) data.append(`field-${index}`, "");
    data.append("file", file(MAX_REQUEST_BYTES - 500 * 1024));
    expect(() => assertMultipartSize(data)).toThrow(/One bill can send at most 24 MB/);
  });

  it("rounds the refused size up, so a refusal never reads as 24.0 MB against a 24 MB limit", () => {
    const data = new FormData(); data.append("files", file(MAX_REQUEST_BYTES - 1024 - 1024 - 3 * 5 - 3 * 8 - 3 * 15 + 1, "bill.pdf"));
    expect(() => assertMultipartSize(data)).toThrow("These pages come to 24.1 MB. One bill can send at most 24 MB; take fewer or smaller pages.");
  });
});
