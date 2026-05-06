import { useCallback, useRef, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";

interface UndoDeleteOptions {
  onDelete: (id: string) => void;
  entityName: string;
  undoWindowMs?: number;
}

export function useUndoDelete({ onDelete, entityName, undoWindowMs = 5000 }: UndoDeleteOptions) {
  const { toast } = useToast();
  const pendingRef = useRef<{ id: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const onDeleteRef = useRef(onDelete);
  onDeleteRef.current = onDelete;

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pendingRef.current) {
        clearTimeout(pendingRef.current.timer);
        pendingRef.current = null;
      }
    };
  }, []);

  const deleteWithUndo = useCallback((id: string, name: string) => {
    // Clear any existing pending delete
    if (pendingRef.current) {
      clearTimeout(pendingRef.current.timer);
      // Execute the previous pending delete immediately
      onDeleteRef.current(pendingRef.current.id);
    }

    const timer = setTimeout(() => {
      onDeleteRef.current(id);
      pendingRef.current = null;
    }, undoWindowMs);

    pendingRef.current = { id, timer };

    toast({
      title: `${entityName} Deleted`,
      description: `"${name}" will be removed in ${undoWindowMs / 1000}s`,
      action: (
        <button
          onClick={() => {
            if (pendingRef.current?.id === id) {
              clearTimeout(pendingRef.current.timer);
              pendingRef.current = null;
            }
          }}
          className="px-3 py-1.5 rounded-lg bg-primary text-primary-foreground text-[11px] font-semibold hover:brightness-110 transition-all"
        >
          Undo
        </button>
      ),
    });
  }, [onDelete, entityName, undoWindowMs, toast]);

  return { deleteWithUndo };
}
