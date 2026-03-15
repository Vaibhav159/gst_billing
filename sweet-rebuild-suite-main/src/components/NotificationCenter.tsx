import { useState } from "react";
import { Bell, Check, CheckCheck, Trash2, X, Info, AlertCircle, CheckCircle2, AlertTriangle } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { useNotifications, type AppNotification } from "@/hooks/useNotifications";
import { cn } from "@/utils/utils";

const typeIcons = {
  info: Info,
  success: CheckCircle2,
  warning: AlertTriangle,
  error: AlertCircle,
};

const typeColors = {
  info: "text-chart-3",
  success: "text-success",
  warning: "text-warning",
  error: "text-destructive",
};

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function NotificationCenter() {
  const [open, setOpen] = useState(false);
  const { notifications, unreadCount, markRead, markAllRead, clear } = useNotifications();

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`Notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}
        className="relative p-2.5 rounded-xl glass-subtle text-foreground hover:bg-secondary/50 transition-all"
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center px-1 animate-scale-in">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40"
              onClick={() => setOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: -8, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -8, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className="absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] max-h-[420px] rounded-xl elevated-card z-50 overflow-hidden flex flex-col"
            >
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-border/40">
                <h3 className="text-[13px] font-display font-semibold text-foreground">Notifications</h3>
                <div className="flex items-center gap-1">
                  {unreadCount > 0 && (
                    <button
                      onClick={markAllRead}
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-secondary/40 transition-colors"
                      aria-label="Mark all read"
                      title="Mark all read"
                    >
                      <CheckCheck className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {notifications.length > 0 && (
                    <button
                      onClick={clear}
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      aria-label="Clear all"
                      title="Clear all"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* List */}
              <div className="overflow-y-auto flex-1">
                {notifications.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground">
                    <Bell className="w-8 h-8 opacity-30" />
                    <p className="text-[13px] font-medium">No notifications</p>
                    <p className="text-[11px]">You're all caught up!</p>
                  </div>
                ) : (
                  notifications.map((n) => {
                    const Icon = typeIcons[n.type];
                    return (
                      <button
                        key={n.id}
                        onClick={() => markRead(n.id)}
                        className={cn(
                          "w-full text-left px-4 py-3 border-b border-border/20 hover:bg-secondary/20 transition-colors flex gap-3",
                          !n.read && "bg-primary/5"
                        )}
                      >
                        <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5",
                          n.type === "success" ? "bg-success/10" :
                          n.type === "error" ? "bg-destructive/10" :
                          n.type === "warning" ? "bg-warning/10" :
                          "bg-chart-3/10"
                        )}>
                          <Icon className={cn("w-3.5 h-3.5", typeColors[n.type])} />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-2">
                            <p className={cn("text-[12px] font-semibold text-foreground", !n.read && "text-primary")}>{n.title}</p>
                            {!n.read && <div className="w-2 h-2 rounded-full bg-primary shrink-0 mt-1" />}
                          </div>
                          <p className="text-[11px] text-muted-foreground mt-0.5 line-clamp-2">{n.message}</p>
                          <p className="text-[10px] text-muted-foreground/60 mt-1">{timeAgo(n.timestamp)}</p>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
