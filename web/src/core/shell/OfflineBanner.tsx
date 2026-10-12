import { CloudOff, WifiOff } from "lucide-react";
import { cn } from "@/core/cn";
import { useNetwork, type NetState } from "@/core/api/network";
import { useView } from "@/core/view";

/** Whether the banner shows: the device is offline, or the app's server doesn't answer. */
export const bannerShows = (net: NetState) => net !== "online";

/**
 * Shown while the device is offline, or while the app's server doesn't answer (learned from real requests only).
 * True to what the app does: nothing queues, so saving waits. On a phone it's the topmost thing, so it clears the notch.
 */
export function OfflineBanner() {
  const net = useNetwork();
  const { isPhone, isEasy } = useView();
  if (!bannerShows(net)) return null;
  const offline = net === "offline";
  const Icon = offline ? WifiOff : CloudOff;
  return (
    <div role="status" data-offline="" className={cn("shrink-0 flex items-center gap-2 px-4 pb-2 bg-neg-tint border-b border-neg-line anim-rise", isEasy ? "text-[15px] leading-[21px]" : "text-sm", isPhone ? "pt-[calc(8px+env(safe-area-inset-top,0px))]" : "pt-2")}>
      <Icon size={16} className="text-neg shrink-0" aria-hidden="true" />
      {offline
        ? <span className="text-fg"><b className="font-semibold">You're offline.</b> <span className="text-fg2">What you're making stays on this device. Saving, sending and uploads need the internet.</span></span>
        // the prototype's words for the server not answering (PROTO/pages/core/Login.jsx:61)
        : <span className="text-fg"><b className="font-semibold">The app couldn't get through.</b> <span className="text-fg2">It's probably restarting after an update. Wait a minute and try again.</span></span>}
    </div>
  );
}
