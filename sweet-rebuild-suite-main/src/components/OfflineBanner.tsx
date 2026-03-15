import { WifiOff } from "lucide-react";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { AnimatePresence, motion } from "framer-motion";

export default function OfflineBanner() {
  const isOnline = useOnlineStatus();

  return (
    <AnimatePresence>
      {!isOnline && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="bg-destructive/90 text-destructive-foreground overflow-hidden"
        >
          <div className="flex items-center justify-center gap-2 py-2 px-4 text-[12px] font-medium">
            <WifiOff className="w-3.5 h-3.5" />
            <span>You're offline. Changes will sync when connection returns.</span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
