/**
 * Format an error from an `api.*` call (axios) into a human-readable message
 * that surfaces the actual backend response, not generic "Something went wrong".
 *
 * Handles:
 * - DRF validation errors: { field: ["msg"] }
 * - DRF detail: { detail: "msg" }
 * - Custom error: { error: "msg" } / { message: "msg" }
 * - Plain string body
 * - Network errors (no response)
 */
export function formatApiError(err: any, fallback = "Something went wrong"): string {
  if (!err) return fallback;
  // Network error — no response from server
  if (!err.response) {
    return err.message || fallback;
  }
  const { status, data } = err.response;
  if (typeof data === "string") return `[${status}] ${data}`;
  if (!data || typeof data !== "object") return `[${status}] ${err.message || fallback}`;

  // DRF detail
  if (typeof data.detail === "string") return data.detail;
  // Custom error / message field
  if (typeof data.error === "string") return data.error;
  if (typeof data.message === "string") return data.message;
  // Array of errors
  if (Array.isArray(data.errors)) return data.errors.slice(0, 3).map(String).join("; ");
  // DRF field errors: { field: ["msg1", "msg2"], ... }
  const fieldErrors: string[] = [];
  for (const [k, v] of Object.entries(data)) {
    if (Array.isArray(v)) {
      fieldErrors.push(`${k}: ${v.join(", ")}`);
    } else if (typeof v === "string") {
      fieldErrors.push(`${k}: ${v}`);
    }
  }
  if (fieldErrors.length) return fieldErrors.slice(0, 3).join(" | ");
  // Last resort — dump JSON
  try {
    return JSON.stringify(data).slice(0, 300);
  } catch {
    return `[${status}] ${err.message || fallback}`;
  }
}

/**
 * Status code as a short tag, e.g. "(401)" or "(network)".
 */
export function errorTag(err: any): string {
  if (!err) return "";
  if (!err.response) return "(network)";
  return `(${err.response.status})`;
}
