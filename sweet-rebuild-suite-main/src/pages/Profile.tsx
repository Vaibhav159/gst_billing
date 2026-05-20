import { useState, useEffect, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import Breadcrumbs from "@/components/Breadcrumbs";
import {
  User, Mail, Phone, Bell, Save, Check,
  Settings, History, Building2, Globe, Clock
} from "lucide-react";
import { motion } from "framer-motion";
import { cn } from "@/utils/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import api from "@/utils/api";

const PROFILE_KEY = "gst_app_profile";
const NOTIFICATIONS_KEY = "gst_app_notifications";

const ROLE_LABELS: Record<string, string> = {
  admin: "Administrator",
  editor: "Editor",
  viewer: "Viewer",
};

export default function Profile() {
  const isMobile = useIsMobile();
  const { user } = useAuth();
  const { toast } = useToast();

  const [profile, setProfile] = useState(() => {
    const saved = localStorage.getItem(PROFILE_KEY);
    if (saved) {
      try { return { ...JSON.parse(saved) }; } catch { /* ignore */ }
    }
    return {
      name: "",
      email: "",
      phone: "",
      company: "",
      timezone: "Asia/Kolkata",
      language: "English",
    };
  });

  const [notifications, setNotifications] = useState(() => {
    const saved = localStorage.getItem(NOTIFICATIONS_KEY);
    if (saved) {
      try { return { ...JSON.parse(saved) }; } catch { /* ignore */ }
    }
    return {
      invoiceCreated: true,
      dailySummary: false,
      backupReminder: true,
    };
  });

  // `dirty` flips on any user-initiated edit; programmatic hydration from
  // the API in the mount effect skips this flag so the user doesn't open
  // the page already showing "Unsaved changes". Mirrors Settings.tsx.
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  // Track whether the initial API hydration has happened — otherwise the
  // user's offline edits could be silently overwritten on remount.
  const hydratedRef = useRef(false);

  useEffect(() => {
    // Fetch profile from backend — non-blocking; on failure fall back to
    // whatever's already in state (which came from localStorage / auth ctx).
    api.get("profile/").then(res => {
      const d = res.data;
      setProfile(prev => ({
        ...prev,
        name: d.full_name || d.username || prev.name,
        email: d.email || prev.email,
      }));
      hydratedRef.current = true;
    }).catch(() => {
      if (user) setProfile(prev => ({ ...prev, name: prev.name || user.username }));
      hydratedRef.current = true;
    });
  }, [user]);

  // Wrapped setters — every user edit goes through these so `dirty` stays
  // truthful. Programmatic updates inside the API effect bypass these.
  const setP = (field: string, val: unknown) => {
    setProfile((p) => ({ ...p, [field]: val }));
    setDirty(true);
  };
  const setN = (key: string, val: boolean) => {
    setNotifications((n) => ({ ...n, [key]: val }));
    setDirty(true);
  };

  const handleSaveProfile = async () => {
    if (!dirty || saving) return;
    setSaving(true);
    try {
      const nameParts = (profile.name || "").trim().split(/\s+/);
      await api.patch("profile/", {
        first_name: nameParts[0] || "",
        last_name: nameParts.slice(1).join(" ") || "",
        email: profile.email || "",
      });
      localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
      localStorage.setItem(NOTIFICATIONS_KEY, JSON.stringify(notifications));
      setDirty(false);
      toast({ title: "Profile Saved", description: "Your profile has been updated." });
    } catch (err: unknown) {
      // Surface the actual server error when possible — generic "Save Failed"
      // hides validation issues like duplicate email or bad format.
      const e = err as { response?: { data?: Record<string, unknown> } };
      const detail = e?.response?.data
        ? Object.values(e.response.data).flat().join(" · ")
        : "Could not update profile.";
      toast({ title: "Save Failed", description: detail || "Could not update profile.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  // Initial shown from the first letter of the name; if name is empty we
  // try username then fall back to "U". Memo so the avatar doesn't churn
  // when other state changes.
  const initial = useMemo(() => {
    const source = (profile.name || user?.username || "U").trim();
    return source.charAt(0).toUpperCase() || "U";
  }, [profile.name, user?.username]);

  const roleLabel = user?.role ? (ROLE_LABELS[user.role] || user.role) : "User";

  const fadeUp = {
    hidden: { opacity: 0, y: 12 },
    visible: (i: number) => ({
      opacity: 1, y: 0,
      transition: { delay: i * 0.08, duration: 0.4, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] },
    }),
  };

  return (
    <div className={cn("space-y-5 animate-fade-in max-w-4xl mx-auto", isMobile ? "p-4 pb-28" : "p-6 lg:p-8 space-y-6")}>
      <Breadcrumbs items={[{ label: "Profile" }]} />

      {/* Header — avatar, name, role, and unsaved-changes indicator. The
          indicator gives peripheral feedback so the user doesn't navigate
          away mid-edit. Pattern mirrors Settings.tsx. */}
      <div className="flex items-center gap-4">
        <div className="relative group shrink-0">
          <div className={cn(
            "rounded-2xl bg-gradient-to-br from-primary/80 to-primary flex items-center justify-center text-primary-foreground font-bold font-display glow-sm",
            isMobile ? "w-16 h-16 text-xl" : "w-20 h-20 text-2xl"
          )}>
            {initial}
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <h1 className={cn("font-display font-bold text-foreground tracking-tight truncate", isMobile ? "text-xl" : "text-3xl")}>
            {profile.name || user?.username || "User"}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">{roleLabel}</p>
        </div>
        {dirty && !isMobile && (
          <span className="text-[11px] font-semibold text-warning bg-warning/10 px-2.5 py-1 rounded-full shrink-0">
            Unsaved changes
          </span>
        )}
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
              className="flex items-center gap-3 p-4 rounded-xl border border-border/40 bg-secondary/10 hover:bg-primary/8 hover:border-primary/30 transition-all"
            >
              <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/15 flex items-center justify-center shrink-0">
                <link.icon className="w-5 h-5 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-foreground truncate">{link.label}</p>
                <p className="text-[10px] text-muted-foreground truncate">{link.desc}</p>
              </div>
            </Link>
          </motion.div>
        ))}
      </div>

      {/* Profile Details */}
      <motion.div custom={0} variants={fadeUp} initial="hidden" animate="visible"
        className="elevated-card rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-2">
          <User className="w-4 h-4 text-primary" />
          <h2 className="text-[13px] font-display font-semibold text-foreground">Personal Information</h2>
        </div>
        <div className={cn("grid gap-4", isMobile ? "grid-cols-1" : "grid-cols-2")}>
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-foreground uppercase tracking-wider">Full Name</label>
            <div className="relative">
              <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input type="text" value={profile.name} onChange={(e) => setP("name", e.target.value)}
                className="premium-input pl-10" placeholder="Enter your name" />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-foreground uppercase tracking-wider">Email</label>
            <div className="relative">
              <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input type="email" value={profile.email} onChange={(e) => setP("email", e.target.value)}
                className="premium-input pl-10" placeholder="Enter email" />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-foreground uppercase tracking-wider">Phone</label>
            <div className="relative">
              <Phone className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input type="tel" value={profile.phone} onChange={(e) => setP("phone", e.target.value)}
                className="premium-input pl-10" placeholder="Enter phone" />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-foreground uppercase tracking-wider">Company</label>
            <div className="relative">
              <Building2 className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input type="text" value={profile.company} onChange={(e) => setP("company", e.target.value)}
                className="premium-input pl-10" placeholder="Enter company" />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-foreground uppercase tracking-wider">Timezone</label>
            <div className="relative">
              <Clock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <select value={profile.timezone} onChange={(e) => setP("timezone", e.target.value)}
                className="premium-select w-full pl-10">
                <option value="Asia/Kolkata">Asia/Kolkata (IST)</option>
              </select>
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-foreground uppercase tracking-wider">Language</label>
            <div className="relative">
              <Globe className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <select value={profile.language} onChange={(e) => setP("language", e.target.value)}
                className="premium-select w-full pl-10">
                <option value="English">English</option>
              </select>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Notifications */}
      <motion.div custom={1} variants={fadeUp} initial="hidden" animate="visible"
        className="elevated-card rounded-2xl p-5 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Bell className="w-4 h-4 text-primary" />
          <h2 className="text-[13px] font-display font-semibold text-foreground">Notifications</h2>
          <span className="text-[9px] text-muted-foreground bg-secondary/30 px-1.5 py-0.5 rounded">Preferences saved locally</span>
        </div>
        <div className="space-y-3">
          {[
            { key: "invoiceCreated" as const, label: "Invoice Created", desc: "Get notified when a new invoice is generated" },
            { key: "dailySummary" as const, label: "Daily Summary", desc: "Receive a daily sales summary report" },
            { key: "backupReminder" as const, label: "Backup Reminder", desc: "Weekly reminder to backup your data" },
          ].map((item) => (
            <div key={item.key} className="flex items-center justify-between gap-3 p-3 rounded-xl bg-secondary/20">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-foreground">{item.label}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{item.desc}</p>
              </div>
              <Switch
                checked={notifications[item.key]}
                onCheckedChange={(checked) => setN(item.key, checked)}
              />
            </div>
          ))}
        </div>
      </motion.div>

      {/* Sticky save bar — disabled when nothing's pending. Label flips so
          the bar is informative even at rest, mirroring Settings.tsx. */}
      <div className={cn(
        "sticky bottom-0 z-30 py-3 bg-card/95 backdrop-blur-md border-t border-border/50",
        isMobile ? "-mx-4 px-4" : "-mx-6 lg:-mx-8 px-6 lg:px-8"
      )}>
        <div className={cn("flex items-center gap-3 max-w-4xl mx-auto", isMobile ? "justify-between" : "justify-end")}>
          {!dirty && (
            <span className="text-[11px] text-muted-foreground flex items-center gap-1.5">
              <Check className="w-3.5 h-3.5 text-success" /> All changes saved
            </span>
          )}
          <button
            onClick={handleSaveProfile}
            disabled={!dirty || saving}
            className={cn("premium-btn-primary text-[13px] disabled:opacity-40 disabled:cursor-not-allowed", isMobile && "flex-1")}
          >
            <Save className="w-4 h-4" /> {saving ? "Saving…" : dirty ? "Save Profile" : "Saved"}
          </button>
        </div>
      </div>
    </div>
  );
}
