import { useState, useEffect, useCallback, useRef } from "react";

const DRAFT_PREFIX = "gst_draft_";

export function useAutoSave<T>(key: string, initialData: T, intervalMs: number = 30000) {
  const storageKey = DRAFT_PREFIX + key;
  const [hasDraft, setHasDraft] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const dirtyRef = useRef(false);
  const dataRef = useRef<T>(initialData);

  // Check for existing draft on mount
  useEffect(() => {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      try {
        JSON.parse(stored);
        setHasDraft(true);
      } catch { /* ignore */ }
    }
  }, [storageKey]);

  // Auto-save interval
  useEffect(() => {
    const timer = setInterval(() => {
      if (dirtyRef.current) {
        localStorage.setItem(storageKey, JSON.stringify(dataRef.current));
        setLastSaved(new Date());
        dirtyRef.current = false;
      }
    }, intervalMs);
    return () => clearInterval(timer);
  }, [storageKey, intervalMs]);

  const markDirty = useCallback((data: T) => {
    dataRef.current = data;
    dirtyRef.current = true;
  }, []);

  const restoreDraft = useCallback((): T | null => {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setHasDraft(false);
        return parsed;
      } catch { /* ignore */ }
    }
    return null;
  }, [storageKey]);

  const clearDraft = useCallback(() => {
    localStorage.removeItem(storageKey);
    setHasDraft(false);
    setLastSaved(null);
    dirtyRef.current = false;
  }, [storageKey]);

  const saveDraftNow = useCallback(() => {
    localStorage.setItem(storageKey, JSON.stringify(dataRef.current));
    setLastSaved(new Date());
    dirtyRef.current = false;
  }, [storageKey]);

  return { hasDraft, lastSaved, markDirty, restoreDraft, clearDraft, saveDraftNow };
}
