import { useNavigate } from "react-router-dom";
import {
  Building2, BarChart3, Calculator, HardDrive, Settings, History, LogOut, User, Users, ReceiptText } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import BottomSheet, { SheetLink } from "./BottomSheet";

const moreItems = [
  // Photographing a supplier bill is a phone job, but the module was only
  // in the desktop top nav — unreachable here except by typing the URL.
  { label: "Inward Bills", href: "/billing/inward-bills", icon: ReceiptText },
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
  const navigate = useNavigate();
  const { logout: authLogout } = useAuth();
  const close = () => onOpenChange(false);

  return (
    <BottomSheet open={open} onOpenChange={onOpenChange} title="More">
      <div className="p-3 space-y-1">
        {moreItems.map((item) => (
          <SheetLink key={item.href} to={item.href} icon={item.icon} label={item.label} onNavigate={close} />
        ))}
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
