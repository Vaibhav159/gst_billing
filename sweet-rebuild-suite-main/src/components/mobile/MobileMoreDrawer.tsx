import { Link, useLocation, useNavigate } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
import {
  Building2, BarChart3, Calculator, HardDrive, Settings, History, LogOut, X, User, FileText, Users, Truck,
} from "lucide-react";
import { cn } from "@/utils/utils";
import { useAuth } from "@/contexts/AuthContext";

const moreItems = [
  { label: "Profile", href: "/billing/profile", icon: User },
  { label: "Businesses", href: "/billing/business/list", icon: Building2 },
  { label: "Reports", href: "/billing/reports", icon: BarChart3 },
  { label: "GST", href: "/billing/gst-summary", icon: Calculator },
  { label: "Backup", href: "/billing/backup", icon: HardDrive },
  { label: "Audit Log", href: "/billing/audit-log", icon: History },
  { label: "User Management", href: "/billing/users", icon: Users },
  { label: "Settings", href: "/billing/settings", icon: Settings },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function MobileMoreDrawer({ open, onOpenChange }: Props) {
  const location = useLocation();
  const navigate = useNavigate();
  const { logout: authLogout } = useAuth();

  const isActive = (href: string) => location.pathname.startsWith(href);

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
            className="fixed bottom-0 left-0 right-0 z-[61] elevated-card rounded-t-2xl max-h-[70vh] overflow-y-auto safe-area-bottom"
          >
            {/* Handle */}
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
              {moreItems.map((item) => {
                const Icon = item.icon;
                const active = isActive(item.href);
                return (
                  <Link
                    key={item.href}
                    to={item.href}
                    onClick={() => onOpenChange(false)}
                    className={cn(
                      "flex items-center gap-3.5 px-4 py-3.5 rounded-xl transition-all",
                      active ? "bg-primary/10 text-primary" : "text-foreground hover:bg-secondary/30"
                    )}
                  >
                    <div className={cn(
                      "w-9 h-9 rounded-xl flex items-center justify-center",
                      active ? "bg-primary/15" : "bg-secondary/40"
                    )}>
                      <Icon className="w-4.5 h-4.5" />
                    </div>
                    <span className="text-[14px] font-medium">{item.label}</span>
                  </Link>
                );
              })}
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
