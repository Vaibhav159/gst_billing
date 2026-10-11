import { useEffect } from "react";

/** Closing dialogs and menus have let go of the bill's keyboard shortcuts. */
export const openFormOverlays = () => [...document.querySelectorAll<HTMLElement>('[role="dialog"]:not([data-closing]), [role="menu"]:not([data-closing])')];

const commandKey = (e: KeyboardEvent) => (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey;
export const isSaveKey = (e: KeyboardEvent) => commandKey(e) && e.key.toLowerCase() === "s";

/** Both form views check on Ctrl S; the desktop also adds a line on Ctrl Enter. The review owns its Save. */
export function useFormShortcuts(reviewOpen: boolean, review: () => void, addLine?: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isSaveKey(e)) {
        e.preventDefault();
        if (!reviewOpen && !openFormOverlays().length) review();
      } else if (addLine && commandKey(e) && e.key === "Enter" && !openFormOverlays().length) {
        e.preventDefault();
        addLine();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });
}
