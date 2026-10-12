import { afterEach, describe, expect, it, vi } from "vitest";
import { downscalePhoto, fileProblem, MAX_FILE_BYTES, MAX_REQUEST_BYTES, prepareFiles, scaledSize } from "./files";
import { captureFormData } from "./multipart";

const file = (name = "bill.pdf", size = 12, type = "application/pdf") => {
  const result = new File(["synthetic"], name, { type });
  Object.defineProperty(result, "size", { value: size });
  return result;
};
afterEach(() => vi.unstubAllGlobals());

describe("capture files", () => {
  it("accepts the contract's formats and exactly 20 MB; refuses larger or unrelated files by name", () => {
    for (const [name, type] of [["a.jpg", "image/jpeg"], ["b.png", "image/png"], ["c.heic", "image/heic"], ["d.HEIF", ""], ["e.pdf", "application/pdf"]]) {
      expect(fileProblem(file(name, 1, type))).toBeNull();
    }
    expect(fileProblem(file("max.pdf", MAX_FILE_BYTES))).toBeNull();
    expect(fileProblem(file("big.pdf", MAX_FILE_BYTES + 1))).toBe("big.pdf is 20.0 MB. The most is 20 MB.");
    expect(fileProblem(file("sheet.csv", 1, "text/csv"))).toContain("sheet.csv: Choose a photo (JPEG, PNG or HEIC) or a PDF.");
    expect(fileProblem(file("empty.pdf", 0))).toBe("empty.pdf is empty. Choose the file again.");
  });

  it("keeps selected page order; separate bills get separate requests", async () => {
    const files = [file("front.pdf"), file("back.pdf")];
    expect(await prepareFiles(files, true)).toEqual([files]);
    expect(await prepareFiles(files, false)).toEqual([[files[0]], [files[1]]]);
  });

  it.each([
    ["bill.pdf", "", "application/pdf"],
    ["bill.jpg", "application/octet-stream", "image/jpeg"],
    ["bill.JPEG", "image/x-camera", "image/jpeg"],
    ["bill.PNG", "", "image/png"],
    ["bill.heic", "application/octet-stream", "image/heic"],
    ["bill.HEIF", "", "image/heif"],
  ])("forwards %s with its supported MIME when the device supplies %j", async (name, type, expected) => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 800, height: 600, close: vi.fn() })));
    const original = new File(["synthetic file bytes"], name, { type, lastModified: 1700000000000 });
    const [prepared] = await prepareFiles([original], false);
    expect(prepared[0].lastModified).toBe(original.lastModified);
    const body = captureFormData({ files: prepared, client_id: "7439a752-34d4-4c98-ae27-2f4506d91df4" });
    const forwarded = body.get("files") as File;
    expect(forwarded.type).toBe(expected);
    expect(forwarded.name).toBe(name);
    expect(forwarded.size).toBe(original.size);
    expect(await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error);
      reader.readAsText(forwarded);
    })).toBe("synthetic file bytes");
  });

  it("preserves a recognized MIME despite a different supported filename extension", async () => {
    const original = new File(["synthetic JPEG bytes"], "bill.png", { type: "image/jpeg" });
    const resize = vi.fn(async (value: File) => value);
    const [prepared] = await prepareFiles([original], false, resize);
    expect(resize).toHaveBeenCalledExactlyOnceWith(original);
    expect(prepared[0]).toBe(original);
    expect((captureFormData({ files: prepared, client_id: "7439a752-34d4-4c98-ae27-2f4506d91df4" }).get("files") as File).type).toBe("image/jpeg");
  });

  it("rejects nine pages without dropping one; nine separate bills remain nine", async () => {
    const files = Array.from({ length: 9 }, (_, i) => file(`${i}.pdf`));
    await expect(prepareFiles(files, true)).rejects.toThrow("A bill can have at most 8 pages here.");
    expect(await prepareFiles(files, false)).toHaveLength(9);
  });

  it("rejects the entire selection before downscaling when a selected file is invalid", async () => {
    const resize = vi.fn(async (f: File) => f);
    await expect(prepareFiles([file("good.jpg", 2, "image/jpeg"), file("bad.exe", 2, "application/octet-stream")], true, resize)).rejects.toThrow("bad.exe");
    expect(resize).not.toHaveBeenCalled();
    await expect(prepareFiles([], false)).rejects.toThrow("Choose a photo (JPEG, PNG or HEIC) or a PDF.");
  });

  it("leaves multipart headroom under nginx's 25 MB limit, rejecting all pages together", async () => {
    const files = [file("one.pdf", MAX_REQUEST_BYTES / 2), file("two.pdf", MAX_REQUEST_BYTES / 2)];
    expect(await prepareFiles(files, true)).toEqual([files]);
    await expect(prepareFiles([...files, file("extra.pdf", 1)], true)).rejects.toThrow("These pages come to 24.0 MB. One bill can send at most 24 MB; take fewer or smaller pages.");
    await expect(prepareFiles([...files, file("extra.pdf", 1024 * 1024)], true)).rejects.toThrow("These pages come to 25.0 MB. One bill can send at most 24 MB; take fewer or smaller pages.");
    expect(await prepareFiles([...files, file("extra.pdf", 1)], false)).toHaveLength(3);
  });

  it("checks the combined size after downscaling and leaves PDFs untouched", async () => {
    const photo = file("fake-reader.jpg", 19 * 1024 * 1024, "image/jpeg");
    const pdf = file("page.pdf", 19 * 1024 * 1024);
    const resized = file(photo.name, 100, "image/jpeg");
    const resize = vi.fn(async () => resized);
    expect(await prepareFiles([photo, pdf], true, resize)).toEqual([[resized, pdf]]);
    expect(resize).toHaveBeenCalledExactlyOnceWith(photo);
  });

  it("limits either dimension to 2000 px without enlarging smaller photos", () => {
    expect(scaledSize(4000, 3000)).toEqual({ width: 2000, height: 1500 });
    expect(scaledSize(1200, 3600)).toEqual({ width: 667, height: 2000 });
    expect(scaledSize(640, 480)).toEqual({ width: 640, height: 480 });
  });

  it("resizes decoded images to JPEG while retaining the original filename for the fake reader", async () => {
    const close = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 4000, height: 3000, close })));
    const drawImage = vi.fn();
    const context = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
    const blob = vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb) => cb(new Blob(["jpeg"], { type: "image/jpeg" })));
    try {
      const result = await downscalePhoto(file("solanki.png", 500, "image/png"));
      expect(result.name).toBe("solanki.png");
      expect(result.type).toBe("image/jpeg");
      expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 2000, 1500);
      expect(close).toHaveBeenCalledOnce();
    } finally { context.mockRestore(); blob.mockRestore(); }
  });

  it("preserves HEIC/HEIF for the server when native decoding is unavailable; corrupt JPEG stays an explicit error", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => { throw new Error("unsupported decoder"); }));
    for (const [name, type] of [["bill.heic", "image/heic"], ["bill.HEIF", ""]]) {
      const original = file(name, 100, type);
      expect(await downscalePhoto(original)).toBe(original);
    }
    await expect(downscalePhoto(file("broken.jpg", 100, "image/jpeg"))).rejects.toThrow("This browser couldn't open broken.jpg. Save it as JPEG or PNG and try again.");
  });
});
