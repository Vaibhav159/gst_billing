import { useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { useAuth } from "@/core/auth/AuthProvider";
import type { Action } from "@/core/auth/permissions";
import { useToast } from "@/core/ui";
import { MOD } from "./nav";

/**
 * Desktop shortcuts. They never fire inside a field or while a menu or dialog is open, except Ctrl K. They follow the
 * role: a shortcut to something this person can't do says why. Ctrl Z runs the last Undo a toast offered (30 s).
 */
export function useShortcuts({ enabled, openPalette, openShortcuts }: { enabled: boolean; openPalette(): void; openShortcuts(): void }) {
  const navigate = useNavigate();
  const { can, whyNot } = useAuth();
  const { show, undoLast } = useToast();
  // the latest of each, without listening again on every render
  const live = useRef({ can, whyNot, show, undoLast, openPalette, openShortcuts });
  live.current = { can, whyNot, show, undoLast, openPalette, openShortcuts };
  useEffect(() => {
    if (!enabled) return undefined;
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as Element | null)?.closest?.("input, textarea, select, [contenteditable=true]");
      const L = live.current;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); L.openPalette(); return; }
      // a menu or dialog open has the keys (the shortcuts list would open under a menu, a new bill behind a dialog);
      // one on its way out doesn't (data-closing, as PageFrame reads dialogs)
      if (typing || document.querySelector('[role="menu"]:not([data-closing]), [role="dialog"]:not([data-closing])')) return;
      // Undo (PROTO core/shell.jsx:576-580): the last delete, discard or removed line, for 30 s; in a field, the field's own
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (!L.undoLast()) L.show({ tone: "brand", title: "Nothing to undo", body: `${MOD} Z undoes a delete, a discard or a removed line for 30 seconds after it.` });
        return;
      }
      const go = (perm: Action, to: string, what: string) => { if (L.can(perm)) navigate(to); else L.show({ tone: "brand", title: `You can't ${what}`, body: L.whyNot(perm) }); };
      // e.code, not e.key: on a Mac, Option+N types a dead key and Option+P types π
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === "KeyN") { e.preventDefault(); go("bill.create", "/sales/new", "make bills"); }
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.code === "KeyP") { e.preventDefault(); go("purchase.create", "/purchases/new", "add purchases"); }
      if (e.key === "/" && !e.ctrlKey && !e.metaKey) {
        const box = document.querySelector<HTMLElement>("[data-page-search]");
        if (box) { e.preventDefault(); box.focus(); }
      }
      if (e.key === "?" && !e.ctrlKey && !e.metaKey) { e.preventDefault(); L.openShortcuts(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, navigate]);
}
