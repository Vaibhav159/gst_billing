import { useEffect } from "react";
import { useIsPhone } from "@/core/device";

/**
 * The phone's on-screen keyboard height (0 when closed), as --kb on the app (#root), so sheets and action bars sit
 * above it. The overlay layer copies it from #root. It's in the app's own pixels: with Large or Larger text #root is
 * zoomed, and a screen-pixel value inside it would lift the bar that much too far. While it's up #root carries
 * data-kb, and the tabs make way (styles.css): under the keyboard they'd only hold the page's action bar a tab bar's
 * height above it.
 */
export function useKeyboardInset(): void {
  const phone = useIsPhone();
  useEffect(() => {
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    const root = document.getElementById("root");
    if (!phone || !vv || !root) return undefined;
    const set = () => {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      root.style.setProperty("--kb", kb > 80 ? `${Math.round(kb / (Number(root.style.zoom) || 1))}px` : "0px");
      root.toggleAttribute("data-kb", kb > 80);
    };
    set();
    vv.addEventListener("resize", set);
    vv.addEventListener("scroll", set);
    return () => { vv.removeEventListener("resize", set); vv.removeEventListener("scroll", set); root.removeAttribute("data-kb"); };
  }, [phone]);
}
