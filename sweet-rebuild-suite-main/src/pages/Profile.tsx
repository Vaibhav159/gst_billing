import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import Breadcrumbs from "@/components/Breadcrumbs";
import {
  User, Mail, Phone, Camera, Bell,
  Settings, History, Building2, Globe, Clock, AlertCircle
} from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/contexts/AuthContext";

export default function Profile() {
  const isMobile = useIsMobile();
  const { user } = useAuth();
  
  const [profile, setProfile] = useState({
    name: "",
    email: "",
    phone: "",
    company: "",
    timezone: "Asia/Kolkata",
    language: "English",
  });

  useEffect(() => {
    if (user) {
      setProfile({
        name: user.username, // Just default to username since we don't fetch full profile yet
        email: "",
        phone: "",
        company: "",
        timezone: "Asia/Kolkata",
        language: "English",
      });
    }
  }, [user]);

  const [notifications, setNotifications] = useState({
    invoiceCreated: true,
    dailySummary: false,
    backupReminder: true,
  });

  const fadeUp = {
    hidden: { opacity: 0, y: 12 },
    visible: (i: number) => ({
      opacity: 1, y: 0,
      transition: { delay: i * 0.08, duration: 0.4, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
    }),
  };

  return (
    <div className={cn("space-y-5 animate-fade-in max-w-4xl mx-auto", isMobile ? "p-4 pb-20" : "p-6 lg:p-8 space-y-6")}>
      <Breadcrumbs items={[{ label: "Profile" }]} />

      <div className="bg-chart-4/10 border border-chart-4/20 text-chart-4 p-4 rounded-xl flex gap-3 text-sm">
        <AlertCircle className="w-5 h-5 shrink-0" />
        <p>Profile and Settings modifications are not yet supported by the backend. This page is currently read-only.</p>
      </div>

      {/* Header */}
      <div className="flex items-center gap-4">
        <div className="relative group opacity-80">
          <div className={cn(
            "rounded-2xl bg-gradient-to-br from-primary/80 to-primary flex items-center justify-center text-primary-foreground font-bold font-display glow-sm",
            isMobile ? "w-16 h-16 text-xl" : "w-20 h-20 text-2xl"
          )}>
            {profile.name.charAt(0).toUpperCase() || "U"}
          </div>
        </div>
        <div>
          <h1 className={cn("font-display font-bold text-foreground tracking-tight opacity-80", isMobile ? "text-xl" : "text-3xl")}>
            {profile.name || "User"}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Admin User
          </p>
        </div>
      </div>

      {/* Quick Links */}
      <div className={cn("grid gap-3", isMobile ? "grid-cols-2" : "grid-cols-3")}>
        {[
          { label: "Settings", href: "/billing/settings", icon: Settings, desc: "App configuration" },
          { label: "Audit Log", href: "/billing/audit-log", icon: History, desc: "Activity history" },
          { label: "Businesses", href: "/billing/business/list", icon: Building2, desc: "Manage" },
        ].map((link, i) => (
          <motion.div key={link.href} custom={i} variants={fadeUp} initial="hidden" animate="visible">
            <Link
              to={link.href}
              className="flex items-center gap-3 p-4 rounded-xl border border-border/40 bg-secondary/10 hover:bg-primary/8 hover:border-primary/30 transition-all opacity-80"
            >
              <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/15 flex items-center justify-center">
                <link.icon className="w-5 h-5 text-primary" />
              </div>
              <div>
                <p className="text-[13px] font-semibold text-foreground">{link.label}</p>
                <p className="text-[10px] text-muted-foreground">{link.desc}</p>
              </div>
            </Link>
          </motion.div>
        ))}
      </div>

      {/* Profile Details */}
      <motion.div custom={0} variants={fadeUp} initial="hidden" animate="visible"
        className="elevated-card rounded-2xl p-5 space-y-4 opacity-70 pointer-events-none">
        <div className="flex items-center gap-2">
          <User className="w-4 h-4 text-primary" />
          <h2 className="text-[13px] font-display font-semibold text-foreground">Personal Information</h2>
        </div>
        <div className={cn("grid gap-4", isMobile ? "grid-cols-1" : "grid-cols-2")}>
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-foreground uppercase tracking-wider">Username</label>
            <div className="relative">
              <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input type="text" value={profile.name} readOnly disabled
                className="premium-input pl-10 bg-secondary/30" />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-foreground uppercase tracking-wider">Email</label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input type="email" value={profile.email} readOnly disabled
                className="premium-input pl-10 bg-secondary/30" placeholder="Not configured" />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-foreground uppercase tracking-wider">Phone</label>
            <div className="relative">
              <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input type="tel" value={profile.phone} readOnly disabled
                className="premium-input pl-10 bg-secondary/30" placeholder="Not configured" />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-foreground uppercase tracking-wider">Company</label>
            <div className="relative">
              <Building2 className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input type="text" value={profile.company} readOnly disabled
                className="premium-input pl-10 bg-secondary/30" placeholder="Not configured" />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-foreground uppercase tracking-wider">Timezone</label>
            <div className="relative">
              <Clock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <select value={profile.timezone} disabled
                className="premium-select w-full pl-10 bg-secondary/30">
                <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-foreground uppercase tracking-wider">Language</label>
            <div className="relative">
              <Globe className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <select value={profile.language} disabled
                className="premium-select w-full pl-10 bg-secondary/30">
                <option value="English">English</option>
              </select>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Notifications */}
      <motion.div custom={1} variants={fadeUp} initial="hidden" animate="visible"
        className="elevated-card rounded-2xl p-5 space-y-4 opacity-70 pointer-events-none">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-primary" />
          <h2 className="text-[13px] font-display font-semibold text-foreground">Notifications</h2>
        </div>
        <div className="space-y-3">
          {[
            { key: "invoiceCreated" as const, label: "Invoice Created", desc: "Get notified when a new invoice is generated" },
            { key: "dailySummary" as const, label: "Daily Summary", desc: "Receive a daily sales summary report" },
            { key: "backupReminder" as const, label: "Backup Reminder", desc: "Weekly reminder to backup your data" },
          ].map((item) => (
            <div key={item.key} className="flex items-center justify-between p-3 rounded-xl bg-secondary/20">
              <div>
                <p className="text-[13px] font-medium text-foreground">{item.label}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{item.desc}</p>
              </div>
              <Switch
                disabled
                checked={notifications[item.key]}
                onCheckedChange={(checked) => setNotifications((n) => ({ ...n, [item.key]: checked }))}
              />
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}
