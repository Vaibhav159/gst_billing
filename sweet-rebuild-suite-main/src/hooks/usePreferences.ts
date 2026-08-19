import api from "@/utils/api";

/**
 * Per-user preferences, persisted server-side (/api/preferences/) so the
 * Settings page roams across devices, with localStorage as the offline
 * mirror. Device-local concerns (theme, mobile mode) stay in their own
 * localStorage keys on purpose.
 */

export const SETTINGS_STORAGE_KEY = "gst_app_settings";

let cache: Record<string, any> | null = null;
let inflight: Promise<Record<string, any>> | null = null;

function readMirror(): Record<string, any> {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function writeMirror(data: Record<string, any>) {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // storage full or unavailable — server copy is authoritative anyway
  }
}

/** Server copy, memoized per page load; falls back to the local mirror offline. */
export function fetchPreferences(): Promise<Record<string, any>> {
  if (cache) return Promise.resolve(cache);
  if (!inflight) {
    inflight = api
      .get("preferences/")
      .then((res) => {
        cache = res.data?.data || {};
        writeMirror(cache!);
        return cache!;
      })
      .catch(() => {
        inflight = null; // retry on next call
        return readMirror();
      });
  }
  return inflight;
}

/** Shallow-merge a patch server-side; null values remove keys. */
export async function patchPreferences(patch: Record<string, any>): Promise<Record<string, any>> {
  const res = await api.patch("preferences/", patch);
  cache = res.data?.data || {};
  writeMirror(cache!);
  return cache!;
}
