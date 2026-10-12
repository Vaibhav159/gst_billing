export const MAX_REQUEST_BYTES = 24 * 1024 * 1024;
export type UploadCapture = { files: File[]; client_id: string; business_id?: number | null; hint?: string; note?: string; label?: string };

/** UTF-8 length after multipart's CRLF normalization, including replacement bytes for lone surrogates. */
function textBytes(value: string): number {
  return new TextEncoder().encode(value.replace(/\r\n|\r|\n/g, "\r\n")).byteLength;
}

/**
 * Bound the complete multipart body without reading or copying Blob bytes. Each header string is budgeted at
 * three times its normalized UTF-8 length, covering percent-encoding/escaping of names, filenames and MIME types.
 * Reserve another 1,024 bytes per part and 1,024 for closing framing: well above the 70-character RFC boundary
 * and fixed browser-generated headers. This intentionally refuses some bodies just below 24 MiB; the browser
 * chooses its boundary only when sending, so a conservative bound avoids building a second full-sized body.
 * Other upload doors (purchase reading and attachments) call this after appending all their own fields.
 */
export function assertMultipartSize(data: FormData): void {
  let bytes = 1024;
  for (const [name, value] of data) {
    bytes += 1024 + 3 * textBytes(name);
    if (typeof value === "string") bytes += textBytes(value);
    else bytes += value.size + 3 * textBytes(value.name) + 3 * textBytes(value.type);
  }
  if (bytes > MAX_REQUEST_BYTES) throw new Error(tooLarge(bytes));
}

/** Round up to one decimal, so a refused size never shows as 24.0 MB against the 24 MB limit. */
export function tooLarge(bytes: number): string {
  return `These pages come to ${(Math.ceil((bytes * 10) / 1048576) / 10).toFixed(1)} MB. One bill can send at most 24 MB; take fewer or smaller pages.`;
}

export function captureFormData(input: UploadCapture): FormData {
  const data = new FormData();
  for (const file of input.files) data.append("files", file, file.name);
  data.append("client_id", input.client_id);
  if (input.business_id != null) data.append("business_id", String(input.business_id));
  for (const key of ["hint", "note", "label"] as const) if (input[key]) data.append(key, input[key]);
  assertMultipartSize(data);
  return data;
}
