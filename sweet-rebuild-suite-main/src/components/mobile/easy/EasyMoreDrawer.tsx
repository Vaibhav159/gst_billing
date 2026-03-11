import { Link, useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Settings, LogOut, X, Wrench, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useMobileMode } from "@/contexts/MobileModeContext";
import { useAuth } from "@/contexts/AuthContext";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function EasyMoreDrawer({ open, onOpenChange }: Props) {
  const location = useLocation();
  const navigate = useNavigate();
  const { setMobileMode } = useMobileMode();
  const { logout: authLogout } = useAuth();

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm"
            onClick={() => onOpenChange(false)}
          />
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 350 }}
            className="fixed bottom-0 left-0 right-0 z-[61] elevated-card rounded-t-2xl max-h-[50vh] overflow-y-auto safe-area-bottom"
          >
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
            </div>

            <div className="flex items-center justify-between px-5 py-3 border-b border-border/30">
              <h2 className="text-base font-display font-semibold text-foreground">More</h2>
              <button onClick={() => onOpenChange(false)} className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/40">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3 space-y-1">
              {/* Profile */}
              <Link
                to="/billing/profile"
                onClick={() => onOpenChange(false)}
                className={cn(
                  "flex items-center gap-3.5 px-4 py-3.5 rounded-xl transition-all",
                  location.pathname.startsWith("/billing/profile")
                    ? "bg-primary/10 text-primary"
                    : "text-foreground hover:bg-secondary/30"
                )}
              >
                <div className={cn(
                  "w-9 h-9 rounded-xl flex items-center justify-center",
                  location.pathname.startsWith("/billing/profile") ? "bg-primary/15" : "bg-secondary/40"
                )}>
                  <User className="w-4.5 h-4.5" />
                </div>
                <span className="text-[14px] font-medium">Profile</span>
              </Link>

              {/* Settings */}
              <Link
                to="/billing/settings"
                onClick={() => onOpenChange(false)}
                className={cn(
                  "flex items-center gap-3.5 px-4 py-3.5 rounded-xl transition-all",
                  location.pathname.startsWith("/billing/settings")
                    ? "bg-primary/10 text-primary"
                    : "text-foreground hover:bg-secondary/30"
                )}
              >
                <div className={cn(
                  "w-9 h-9 rounded-xl flex items-center justify-center",
                  location.pathname.startsWith("/billing/settings") ? "bg-primary/15" : "bg-secondary/40"
                )}>
                  <Settings className="w-4.5 h-4.5" />
                </div>
                <span className="text-[14px] font-medium">Settings</span>
              </Link>

              {/* Switch to Expert */}
              <button
                onClick={() => { onOpenChange(false); setMobileMode("expert"); }}
                className="flex items-center gap-3.5 px-4 py-3.5 rounded-xl text-foreground hover:bg-secondary/30 transition-all w-full"
              >
                <div className="w-9 h-9 rounded-xl bg-secondary/40 flex items-center justify-center">
                  <Wrench className="w-4.5 h-4.5" />
                </div>
                <div className="text-left">
                  <span className="text-[14px] font-medium block">Expert Mode</span>
                  <span className="text-[11px] text-muted-foreground">All features & reports</span>
                </div>
              </button>
            </div>

            {/* Logout */}
            <div className="p-3 pt-0 border-t border-border/30 mt-1">
              <button
                onClick={() => { onOpenChange(false); authLogout(); navigate("/login"); }}
                className="flex items-center gap-3.5 px-4 py-3.5 rounded-xl text-destructive hover:bg-destructive/10 transition-all w-full"
              >
                <div className="w-9 h-9 rounded-xl bg-destructive/10 flex items-center justify-center">
                  <LogOut className="w-4.5 h-4.5" />
                </div>
                <span className="text-[14px] font-medium">Logout</span>
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
