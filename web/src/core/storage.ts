/** A refused read keeps the caller's fallback; a missing key still reads as null. */
export function readStored(key: string, fallback: string | null = null): string | null {
  try { return localStorage.getItem(key); } catch { return fallback; }
}

/** Null removes a key. The result lets drafts keep their memory copy if storage refuses a write. */
export function writeStored(key: string, value: string | null): boolean {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
    return true;
  } catch { return false; }
}
