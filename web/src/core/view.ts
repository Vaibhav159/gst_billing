import { useLocation } from "react-router";
import { useIsPhone } from "./device";

export type View = "desktop" | "expert" | "easy";

/** Desktop, or on a phone: Easy for /e and /e/..., Expert for everything else. */
export function useView(): { view: View; isPhone: boolean; isDesktop: boolean; isEasy: boolean; isExpert: boolean } {
  const isPhone = useIsPhone();
  const { pathname } = useLocation();
  const view: View = !isPhone ? "desktop" : pathname === "/e" || pathname.startsWith("/e/") ? "easy" : "expert";
  return { view, isPhone, isDesktop: view === "desktop", isEasy: view === "easy", isExpert: view === "expert" };
}
