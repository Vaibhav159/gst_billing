import { MAX_REQUEST_BYTES, tooLarge } from "./multipart";
export { MAX_REQUEST_BYTES } from "./multipart";

export const MAX_FILES = 8;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
export const CAPTURE_ACCEPT = "image/jpeg,image/png,image/heic,image/heif,application/pdf";
const TYPES = /^(image\/(jpeg|jpg|png|heic|heif)|application\/pdf)$/i;
const EXTENSIONS = /\.(pdf|jpe?g|png|heic|heif)$/i;
export const isPdf = (file: File) => file.type === "application/pdf" || /\.pdf$/i.test(file.name);
const isHeic = (file: File) => /^image\/hei[cf]$/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
const CHOOSE = "Choose a photo (JPEG, PNG or HEIC) or a PDF.";

export function fileProblem(file: File): string | null {
  if (!TYPES.test(file.type) && !EXTENSIONS.test(file.name)) return `${file.name}: ${CHOOSE}`;
  if (file.size === 0) return `${file.name} is empty. Choose the file again.`;
  if (file.size > MAX_FILE_BYTES) return `${file.name} is ${(file.size / 1048576).toFixed(1)} MB. The most is 20 MB.`;
  return null;
}

export function scaledSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, 2000 / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

async function decode(file: File): Promise<{ image: CanvasImageSource; width: number; height: number; close(): void }> {
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(file);
    return { image: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close() };
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve(); image.onerror = () => reject(new Error("Image decoding failed")); image.src = url;
    });
    return { image, width: image.naturalWidth, height: image.naturalHeight, close: () => URL.revokeObjectURL(url) };
  } catch (error) { URL.revokeObjectURL(url); throw error; }
}

export async function downscalePhoto(file: File): Promise<File> {
  if (isPdf(file)) return file;
  let decoded: Awaited<ReturnType<typeof decode>>;
  try { decoded = await decode(file); }
  catch {
    // ponytail: browsers without HEIC decoding send the original; the server normalizes it. The total-size check still applies.
    if (isHeic(file)) return file;
    throw new Error(`This browser couldn't open ${file.name}. Save it as JPEG or PNG and try again.`);
  }
  try {
    if (Math.max(decoded.width, decoded.height) <= 2000) return file;
    const canvas = document.createElement("canvas");
    const size = scaledSize(decoded.width, decoded.height);
    canvas.width = size.width; canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error(`This browser couldn't resize ${file.name}. Try another browser.`);
    context.drawImage(decoded.image, 0, 0, size.width, size.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => {
      if (value) resolve(value); else reject(new Error(`This browser couldn't resize ${file.name}. Try another browser.`));
    }, "image/jpeg", 0.85));
    // Keep the file's name: the sandbox reader's synthetic examples use it as their key.
    return new File([blob], file.name, { type: "image/jpeg", lastModified: file.lastModified });
  } finally { decoded.close(); }
}

/** Preliminary file-byte check; captureFormData also bounds multipart framing/metadata before persistence and HTTP. */
export async function prepareFiles(files: File[], asPages: boolean, resize = downscalePhoto): Promise<File[][]> {
  if (!files.length) throw new Error(CHOOSE);
  if (asPages && files.length > MAX_FILES) throw new Error("A bill can have at most 8 pages here.");
  const problems = files.map(fileProblem).filter(Boolean);
  if (problems.length) throw new Error(problems.join(" "));
  const prepared: File[] = [];
  // Serial decoding avoids holding eight full-resolution phone photos in memory at once.
  for (let file of files) {
    // Some devices omit MIME types. Keep recognized types; the server validates the actual file bytes.
    if (!TYPES.test(file.type)) {
      const extension = file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase();
      const type = extension === "pdf" ? "application/pdf" : `image/${extension === "jpg" ? "jpeg" : extension}`;
      file = new File([file], file.name, { type, lastModified: file.lastModified });
    }
    prepared.push(isPdf(file) ? file : await resize(file));
  }
  const groups = asPages ? [prepared] : prepared.map((file) => [file]);
  for (const group of groups) {
    const total = group.reduce((sum, file) => sum + file.size, 0);
    if (total > MAX_REQUEST_BYTES) {
      throw new Error(tooLarge(total));
    }
  }
  return groups;
}
