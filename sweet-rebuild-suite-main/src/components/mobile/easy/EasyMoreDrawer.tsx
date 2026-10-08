import { useNavigate } from "react-router-dom";
import { Settings, LogOut, Wrench, User, ReceiptText, Building2, Database, History, Users } from "lucide-react";
import { useMobileMode } from "@/contexts/MobileModeContext";
import { useAuth } from "@/contexts/AuthContext";
import BottomSheet, { SheetLink } from "../BottomSheet";

const items = [
  // Inward Bills — recording a purchase bill is a phone-first job, and this
  // drawer was the only place left to reach it from.
  { label: "Inward Bills", href: "/billing/inward-bills", icon: ReceiptText },
  { label: "Profile", href: "/billing/profile", icon: User },
  { label: "Businesses", href: "/billing/business/list", match: "/billing/business", icon: Building2 },
  { label: "Backup & Restore", href: "/billing/backup", icon: Database },
  { label: "Audit Log", href: "/billing/audit-log", icon: History },
  { label: "Users", href: "/billing/users", icon: Users },
  { label: "Settings", href: "/billing/settings", icon: Settings },
];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// As tall as Expert's drawer (70vh): at 50vh, Settings, Expert Mode and
// Logout sat below the fold.
export default function EasyMoreDrawer({ open, onOpenChange }: Props) {
  const navigate = useNavigate();
  const { setMobileMode } = useMobileMode();
  const { logout: authLogout } = useAuth();
  const close = () => onOpenChange(false);

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title="More">
      <div className="p-3 space-y-1">
        {items.map((item) => (
          <SheetLink key={item.href} to={item.href} match={item.match} icon={item.icon} label={item.label} onNavigate={close} />
        ))}

        {/* Switch to Expert */}
        <button
          onClick={() => { close(); setMobileMode("expert"); }}
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
          onClick={() => { close(); authLogout(); navigate("/login"); }}
          className="flex items-center gap-3.5 px-4 py-3.5 rounded-xl text-destructive hover:bg-destructive/10 transition-all w-full"
        >
          <div className="w-9 h-9 rounded-xl bg-destructive/10 flex items-center justify-center">
            <LogOut className="w-4.5 h-4.5" />
          </div>
          <span className="text-[14px] font-medium">Logout</span>
        </button>
      </div>
    </BottomSheet>
  );
}
